import { apiThrottler } from "@grammyjs/transformer-throttler";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { createDb } from "./db/client";
import type { QueueRow } from "./db/schema";
import { migrate } from "./db/migrate";
import { createFilter, type MatchResult } from "./filter";
import { baseFetchConfig } from "./proxy";
import { DeleteItRepository } from "./repository";
import { DELETE_REACTION, DeleteItService, MANUAL_REACTION_MATCH, VETO_REACTION } from "./service";
import { createRawTelegramTransformer, createTelemetry, trackIncomingUpdate, type Telemetry } from "./telemetry";

export const ALLOWED_UPDATES = ["message", "edited_message", "message_reaction", "callback_query"] as const;
const FORCE_PURGE_CALLBACK_PREFIX = "fp";
const WHY_ACK_CALLBACK_DATA = "why:ok";

export function createBot(input: {
  token: string;
  words: string[];
  databaseUrl?: string;
  deleteDelaySeconds: number;
  sweepIntervalSeconds: number;
  telemetry?: Telemetry;
}) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL ?? "file:./data/deleteitbot.sqlite";
  migrate(databaseUrl);
  const { db } = createDb(databaseUrl);
  const repo = new DeleteItRepository(db);
  const filter = createFilter(input.words);
  const telemetry = input.telemetry ?? createTelemetry({ project: "deleteitbot" });
  const service = new DeleteItService(repo, filter, { deleteDelaySeconds: input.deleteDelaySeconds, telemetry });
  const fetchConfig = baseFetchConfig();
  const bot = new Bot(input.token, fetchConfig ? { client: { baseFetchConfig: fetchConfig } } : undefined);
  bot.api.config.use(apiThrottler());
  bot.api.config.use(createRawTelegramTransformer(telemetry, "deleteitbot-raw-tg"));

  bot.use(async (ctx, next) => {
    trackIncomingUpdate(telemetry, "deleteitbot-raw-tg", ctx.update);
    await next();
  });

  bot.catch((error) => {
    console.error("Telegram update failed", {
      updateId: error.ctx.update.update_id,
      chatId: error.ctx.chat?.id,
      fromId: error.ctx.from?.id,
      error: error.error,
    });
  });

  bot.command("force", async (ctx) => {
    if (!ctx.chat || !ctx.from) {
      await ctx.reply("Не могу определить чат или пользователя для /force.");
      return;
    }

    if (ctx.message) await deleteMessageQuietly(ctx.api, ctx.chat.id, ctx.message.message_id);

    const isAdmin = await service.isAdmin(ctx.chat.id, ctx.from.id, ctx.api);
    if (!isAdmin) {
      const callbackData = createForcePurgeCallbackData(ctx.chat.id);
      const prompt = await ctx.reply("Только админ может запустить принудительное удаление. Попросите админа подтвердить:", {
        reply_markup: new InlineKeyboard().text("Подтвердить удаление (админ)", callbackData),
      });
      service.queueBotMessageForDeletion({ chatId: ctx.chat.id, messageId: prompt.message_id });
      return;
    }

    const progress = await ctx.reply(formatForcePurgeStarted());
    const result = await service.forcePurgePending(ctx.chat.id, ctx.api);
    await ctx.api.editMessageText(ctx.chat.id, progress.message_id, formatForcePurgeResult(result), {
      reply_markup: deleteNotificationKeyboard(),
    });
    service.queueBotMessageForDeletion({ chatId: ctx.chat.id, messageId: progress.message_id });
  });

  bot.command("why", async (ctx) => {
    if (!ctx.chat || !ctx.from || !ctx.message) {
      await ctx.reply("Не могу определить чат или пользователя для /why.");
      return;
    }

    const isAdmin = await service.isAdmin(ctx.chat.id, ctx.from.id, ctx.api);
    if (!isAdmin) {
      await ctx.reply("Только админ может смотреть причину срабатывания.");
      return;
    }

    const reply = ctx.message.reply_to_message;
    if (!reply) {
      await ctx.reply("Ответьте командой /why на сообщение, которое нужно проверить.");
      return;
    }

    const content = getMessageContent(reply);
    const row = repo.getQueueRow(ctx.chat.id, reply.message_id);
    const vetoCount = row ? repo.countVetoes(ctx.chat.id, reply.message_id) : 0;
    const liveMatch = content ? filter.match(content) : undefined;
    const explanation = await ctx.reply(formatWhyResult({ row, vetoCount, liveMatch, hasContent: Boolean(content) }), {
      reply_parameters: { message_id: reply.message_id },
      reply_markup: new InlineKeyboard().text("OK", WHY_ACK_CALLBACK_DATA),
    });
    service.queueBotMessageForDeletion({ chatId: ctx.chat.id, messageId: explanation.message_id });
    await deleteMessageQuietly(ctx.api, ctx.chat.id, ctx.message.message_id);
  });

  bot.callbackQuery(WHY_ACK_CALLBACK_DATA, async (ctx) => {
    await ctx.answerCallbackQuery();
    const message = ctx.callbackQuery.message;
    if (!message) return;
    repo.removePendingQueueRow({ chatId: message.chat.id, messageId: message.message_id });
    await deleteMessageQuietly(ctx.api, message.chat.id, message.message_id);
  });

  bot.callbackQuery(new RegExp(`^${FORCE_PURGE_CALLBACK_PREFIX}:(-?\\d+):(\\d+)$`), async (ctx) => {
    const [, chatIdRaw] = ctx.match;
    const chatId = Number(chatIdRaw);
    const messageChatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id;

    if (!Number.isSafeInteger(chatId) || messageChatId !== chatId) {
      await ctx.answerCallbackQuery({ text: "Не могу подтвердить удаление для этого чата.", show_alert: true });
      return;
    }

    const isAdmin = await service.isAdmin(chatId, ctx.from.id, ctx.api);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({ text: "Только админ может подтвердить удаление.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const message = ctx.callbackQuery.message;
    if (message) repo.removePendingQueueRow({ chatId: message.chat.id, messageId: message.message_id });
    await ctx.editMessageText(formatForcePurgeStarted());
    const result = await service.forcePurgePending(chatId, ctx.api);
    await ctx.editMessageText(formatForcePurgeResult(result), { reply_markup: deleteNotificationKeyboard() });
    if (message) service.queueBotMessageForDeletion({ chatId: message.chat.id, messageId: message.message_id });
  });

  bot.on(["message:text", "message:caption"], async (ctx) => {
    const action = service.handleMessage({
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      text: "text" in ctx.message ? ctx.message.text : undefined,
      caption: "caption" in ctx.message ? ctx.message.caption : undefined,
    });
    if (action) await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, emojiReactions(action.reactions));
  });

  bot.on(["edited_message:text", "edited_message:caption"], async (ctx) => {
    const action = service.handleEditedMessage({
      chatId: ctx.chat.id,
      messageId: ctx.editedMessage.message_id,
      text: "text" in ctx.editedMessage ? ctx.editedMessage.text : undefined,
      caption: "caption" in ctx.editedMessage ? ctx.editedMessage.caption : undefined,
    });
    if (!action) return;

    await ctx.api.setMessageReaction(
      ctx.chat.id,
      ctx.editedMessage.message_id,
      "clearReaction" in action ? [] : emojiReactions(action.reactions),
    );
  });

  bot.on("message_reaction", async (ctx) => {
    const reaction = ctx.update.message_reaction;
    const action = await service.handleReaction(
      {
        chatId: reaction.chat.id,
        messageId: reaction.message_id,
        userId: reaction.user?.id,
        userIsBot: reaction.user?.is_bot,
        hadDeleteReaction: hasEmojiReaction(reaction.old_reaction, DELETE_REACTION),
        hadVetoReaction: hasEmojiReaction(reaction.old_reaction, VETO_REACTION),
        hasDeleteReaction: hasEmojiReaction(reaction.new_reaction, DELETE_REACTION),
        hasVetoReaction: hasEmojiReaction(reaction.new_reaction, VETO_REACTION),
      },
      ctx.api,
    );
    if (action.reactions) {
      await ctx.api.setMessageReaction(reaction.chat.id, reaction.message_id, emojiReactions(action.reactions));
    } else if ("clearReaction" in action) {
      await ctx.api.setMessageReaction(reaction.chat.id, reaction.message_id, []);
    }
  });

  const interval = setInterval(() => {
    service.sweep(bot.api).catch((error) => console.error("Deletion sweep failed", error));
  }, input.sweepIntervalSeconds * 1000);
  interval.unref?.();

  return { bot, service, repo, telemetry };
}

export function hasEmojiReaction(reactions: Array<{ type: string; emoji?: string }>, emoji: string) {
  return reactions.some((reaction) => reaction.type === "emoji" && reaction.emoji === emoji);
}

function emojiReactions(reactions: ReadonlyArray<typeof DELETE_REACTION | typeof VETO_REACTION>) {
  return reactions.map((emoji) => ({ type: "emoji" as const, emoji }));
}

function deleteNotificationKeyboard() {
  return new InlineKeyboard().text("Ок, удалить уведомление", WHY_ACK_CALLBACK_DATA);
}

export function createForcePurgeCallbackData(chatId: number, now = Math.floor(Date.now() / 1000)) {
  return `${FORCE_PURGE_CALLBACK_PREFIX}:${chatId}:${now}`;
}

export function formatForcePurgeResult(result: { deleted: number; failed: number; retried: number }) {
  const parts = [`Удалено: ${result.deleted}`];
  if (result.failed > 0) parts.push(`ошибок: ${result.failed}`);
  if (result.retried > 0) parts.push(`будет повторено позже: ${result.retried}`);
  return `Принудительное удаление завершено. ${parts.join(", ")}.`;
}

export function formatForcePurgeStarted() {
  return "Начал принудительное удаление. Результат появится здесь.";
}

export function formatWhyResult(input: {
  row?: Pick<QueueRow, "matchedWord" | "status" | "lastError">;
  vetoCount?: number;
  liveMatch?: MatchResult;
  hasContent: boolean;
}) {
  if (!input.row && !input.liveMatch) {
    if (!input.hasContent) {
      return "Не нашёл причину в очереди, а Telegram не передал текст или подпись сообщения для повторной проверки.";
    }
    return "Не нашёл причину: сообщения нет в очереди, текущий текст не срабатывает на фильтр.";
  }

  const lines: string[] = [];

  if (input.row) {
    lines.push(`Запретка: ${formatMatchedEntry(input.row.matchedWord)}`);
    lines.push(`Статус: ${formatQueueStatus(input.row.status, input.vetoCount ?? 0)}`);
    if (input.row.lastError) lines.push(`Последняя ошибка: ${input.row.lastError}`);
  }

  if (input.liveMatch) {
    if (!input.row || input.liveMatch.matchedEntry !== input.row.matchedWord) {
      lines.push(`Сейчас подходит под запретку: ${formatMatchedEntry(input.liveMatch.matchedEntry)}`);
    }
    if (input.liveMatch.matchedText !== input.liveMatch.matchedEntry) {
      lines.push(`Найдено в тексте: ${input.liveMatch.matchedText}`);
    }
  } else if (input.row && input.hasContent) {
    lines.push("Сейчас текст сообщения уже не срабатывает на фильтр.");
  }

  return lines.join("\n");
}

export async function startBot(bot: Bot<Context>) {
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

function getMessageContent(message: { text?: string; caption?: string }) {
  if ("text" in message) return message.text;
  if ("caption" in message) return message.caption;
  return undefined;
}

function formatMatchedEntry(entry: string) {
  if (entry === MANUAL_REACTION_MATCH) return "ручная отметка админом 👾";
  return entry;
}

function formatQueueStatus(status: QueueRow["status"], vetoCount: number) {
  if (status === "pending" && vetoCount > 0) return `остановлено админской 🕊 (${vetoCount})`;
  if (status === "pending") return "ожидает удаления";
  if (status === "deleted") return "уже удалено";
  return "ошибка удаления";
}

async function deleteMessageQuietly(api: Pick<Context["api"], "deleteMessage">, chatId: number, messageId: number) {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch {
    // The message may already be gone, or the bot may lack delete rights.
  }
}

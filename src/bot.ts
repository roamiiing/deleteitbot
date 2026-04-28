import { apiThrottler } from "@grammyjs/transformer-throttler";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { createDb } from "./db/client";
import { migrate } from "./db/migrate";
import { createFilter } from "./filter";
import { baseFetchConfig } from "./proxy";
import { DeleteItRepository } from "./repository";
import { DeleteItService } from "./service";

export const ALLOWED_UPDATES = ["message", "edited_message", "message_reaction", "callback_query"] as const;
const FORCE_PURGE_CALLBACK_PREFIX = "fp";

export function createBot(input: {
  token: string;
  words: string[];
  databaseUrl?: string;
  deleteDelaySeconds: number;
  sweepIntervalSeconds: number;
}) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL ?? "file:./data/deleteitbot.sqlite";
  migrate(databaseUrl);
  const { db } = createDb(databaseUrl);
  const repo = new DeleteItRepository(db);
  const filter = createFilter(input.words);
  const service = new DeleteItService(repo, filter, { deleteDelaySeconds: input.deleteDelaySeconds });
  const fetchConfig = baseFetchConfig();
  const bot = new Bot(input.token, fetchConfig ? { client: { baseFetchConfig: fetchConfig } } : undefined);
  bot.api.config.use(apiThrottler());

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

    const isAdmin = await service.isAdmin(ctx.chat.id, ctx.from.id, ctx.api);
    if (!isAdmin) {
      const callbackData = createForcePurgeCallbackData(ctx.chat.id);
      await ctx.reply("Только админ может запустить принудительное удаление. Попросите админа подтвердить:", {
        reply_markup: new InlineKeyboard().text("Подтвердить удаление (админ)", callbackData),
      });
      return;
    }

    const result = await service.forcePurgePending(ctx.chat.id, ctx.api);
    await ctx.reply(formatForcePurgeResult(result));
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
    const result = await service.forcePurgePending(chatId, ctx.api);
    await ctx.editMessageText(formatForcePurgeResult(result));
  });

  bot.on(["message:text", "message:caption"], async (ctx) => {
    const action = service.handleMessage({
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      text: "text" in ctx.message ? ctx.message.text : undefined,
      caption: "caption" in ctx.message ? ctx.message.caption : undefined,
    });
    if (action) await ctx.react(action.react);
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
      "clearReaction" in action ? [] : [{ type: "emoji", emoji: action.react }],
    );
  });

  bot.on("message_reaction", async (ctx) => {
    const reaction = ctx.update.message_reaction;
    await service.handleReaction(
      {
        chatId: reaction.chat.id,
        messageId: reaction.message_id,
        userId: reaction.user?.id,
        hasDeleteItReaction: hasEmojiReaction(reaction.new_reaction, "👾"),
      },
      ctx.api,
    );
  });

  const interval = setInterval(() => {
    service.sweep(bot.api).catch((error) => console.error("Deletion sweep failed", error));
  }, input.sweepIntervalSeconds * 1000);
  interval.unref?.();

  return { bot, service, repo };
}

export function hasEmojiReaction(reactions: Array<{ type: string; emoji?: string }>, emoji: string) {
  return reactions.some((reaction) => reaction.type === "emoji" && reaction.emoji === emoji);
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

export async function startBot(bot: Bot<Context>) {
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

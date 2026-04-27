import { Bot, type Context } from "grammy";
import { createDb } from "./db/client";
import { migrate } from "./db/migrate";
import { createFilter } from "./filter";
import { baseFetchConfig } from "./proxy";
import { DeleteItRepository } from "./repository";
import { DeleteItService } from "./service";

export const ALLOWED_UPDATES = ["message", "message_reaction"] as const;

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

  bot.catch((error) => {
    console.error("Telegram update failed", {
      updateId: error.ctx.update.update_id,
      chatId: error.ctx.chat?.id,
      fromId: error.ctx.from?.id,
      error: error.error,
    });
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

export async function startBot(bot: Bot<Context>) {
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

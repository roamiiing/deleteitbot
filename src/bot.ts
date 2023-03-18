import { Bot } from 'grammy'

import { ProcessedConfig } from './config.ts'
import { filter } from './filter.ts'
import { Message } from './message.ts'

export const createBot = (config: ProcessedConfig, botToken: string) => {
  const { chats } = config
  const bot = new Bot(botToken)

  const appliedFilter = filter(config)

  bot.use((ctx, next) => {
    if (ctx.chat && chats.has(ctx.chat.id)) {
      return next()
    }
  })

  bot.on('message', (ctx) => {
    const message = Message.fromGrammyCtx(ctx)

    if (appliedFilter(message).isBanned) {
      ctx.deleteMessage()
    }
  })

  return bot
}

import { Bot } from 'grammy'

import { ProcessedConfig } from './config.ts'
import { filter } from './filter.ts'
import { fromGrammyCtx } from './message.ts'

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
    const message = fromGrammyCtx(ctx)

    const filtered = appliedFilter(message)

    if (filtered.isBanned) {
      ctx.deleteMessage()
      bot.api.sendMessage(ctx.chat.id, filtered.replaced)
    }
  })

  return bot
}

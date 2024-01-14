import { Bot } from 'grammy'

import { ProcessedConfig } from './config.ts'
import { filter } from './filter.ts'
import { fromGrammyCtx } from './message.ts'

export const createBot = (config: ProcessedConfig, botToken: string) => {
  const { chats, timeout } = config
  const bot = new Bot(botToken)

  const appliedFilter = filter(config)

  bot.use((ctx, next) => {
    if (ctx.chat && chats.has(ctx.chat.id)) {
      return next()
    }
  })

  bot.on('message', async (ctx) => {
    const message = fromGrammyCtx(ctx)

    const filtered = appliedFilter(message)

    if (!filtered.isBanned) {
      return
    }

    await ctx.react('👎')

    setTimeout(() => ctx.deleteMessage(), timeout * 1000)
  })

  return bot
}

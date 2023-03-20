import { Bot, InputFile } from 'grammy'

import { ProcessedConfig } from './config.ts'
import { filter } from './filter.ts'
import { createQuoteImage } from './images/quote.ts'
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

  bot.on('message', async (ctx) => {
    const message = fromGrammyCtx(ctx)

    const filtered = appliedFilter(message)

    if (filtered.isBanned) {
      await ctx.deleteMessage()

      const userProfilePhotoLink = await bot.api.getUserProfilePhotos(
        ctx.from.id,
        { limit: 1 },
      )
        .then((res) => res.photos.at(0)?.at(-1)?.file_id)
        .then((id) => id ? bot.api.getFile(id) : undefined)
        .then((file) => file?.file_path)
        .then((path) =>
          path
            ? `https://api.telegram.org/file/bot${botToken}/${path}`
            : `https://www.gravatar.com/avatar/${ctx.from.id}?d=monsterid`
        )
        .then((url) => fetch(url))
        .then((response) => response.arrayBuffer())
        .then((buffer) => new Uint8Array(buffer))

      await bot.api.sendMediaGroup(ctx.chat.id, [
        {
          type: 'photo',
          media: new InputFile(
            await createQuoteImage(
              {
                quote: filtered.replaced,
                author: {
                  displayName: ctx.from.username
                    ? `@${ctx.from.username}`
                    : ctx.from.first_name,
                  avatar: userProfilePhotoLink,
                },
              },
            ),
            'image.png',
          ),
        },
      ])
    }
  })

  return bot
}

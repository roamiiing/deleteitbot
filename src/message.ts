import { Context } from 'grammy'

export type Message = {
  from: {
    id: number
  }
  chatId: number
  text: string
}

export const Message = {
  fromGrammyCtx(ctx: Context) {
    return {
      from: {
        id: ctx.from?.id || 0,
      },
      chatId: ctx.chat?.id || 0,
      text: ctx.message?.text || '',
    }
  },
}

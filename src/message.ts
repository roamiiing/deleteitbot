import { Context } from 'grammy'

export type Message = {
  text: string
}

export const fromGrammyCtx = (ctx: Context): Message => {
  return {
    text: ctx.message?.text || '',
  }
}

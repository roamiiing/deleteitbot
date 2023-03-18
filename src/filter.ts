import { Config } from './config.ts'
import { Message } from './message.ts'

export const filter = ({ banWords }: Config) => ({ text }: Message) => {
  const tokens = text.split(/\s/).map((token) => token.toLowerCase())

  const isBanned = tokens.some((token) => banWords.includes(token))

  return { isBanned }
}

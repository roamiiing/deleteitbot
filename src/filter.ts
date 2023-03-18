import { ProcessedConfig } from './config.ts'
import { Message } from './message.ts'

export const filter =
  ({ bannedWordsRegex }: ProcessedConfig) => ({ text }: Message) => {
    const isBanned = bannedWordsRegex.test(text)

    return { isBanned }
  }

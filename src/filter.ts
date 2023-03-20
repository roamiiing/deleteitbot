import { ProcessedConfig } from './config.ts'
import { Message } from './message.ts'

export type FilterResult = {
  isBanned: false
} | {
  isBanned: true
  replaced: string
}

export const filter =
  ({ bannedWordsRegex }: ProcessedConfig) =>
  ({ text }: Message): FilterResult => {
    const matches = [...text.matchAll(bannedWordsRegex)]

    if (matches.length === 0) {
      return { isBanned: false }
    }

    let replaced = text

    for (const match of matches) {
      const { 1: word } = match
      const replacement = '*'.repeat(word.length)

      replaced = replaced.replace(word, replacement)
    }

    replaced = replaced.replace(/\s+/g, ' ')

    return { isBanned: true, replaced }
  }

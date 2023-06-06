import { parse } from 'std/encoding/yaml.ts'
import { readAll } from 'std/streams/read_all.ts'
import { getGraphemedRegex } from './graphemes.ts'

export type ChatConfig = number
export type WordConfig = string

export type Config = {
  chats: ChatConfig[]
  banWords: WordConfig[]

  /**
   * Time in seconds in which the message will be deleted
   * @default 0
   */
  timeout?: number
}

export type ProcessedConfig = {
  chats: Set<ChatConfig>
  bannedWordsRegex: RegExp
  timeout: number
}

export const processConfig = (config: Config): ProcessedConfig => {
  const chats = new Set(config.chats)
  const bannedWordsRegex = getGraphemedRegex(config.banWords)
  const timeout = config.timeout ?? 0

  return {
    chats,
    bannedWordsRegex,
    timeout,
  }
}

export const getConfig = async (path: string): Promise<ProcessedConfig> => {
  const file = await Deno.open(path)
  const decoder = new TextDecoder('utf-8')
  const content = decoder.decode(await readAll(file))

  const parsed = parse(content) as Config

  return processConfig(parsed)
}

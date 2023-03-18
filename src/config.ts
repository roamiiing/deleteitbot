import { parse } from 'std/encoding/yaml.ts'
import { readAll } from 'std/streams/read_all.ts'

export type ChatConfig = number
export type WordConfig = string

export type Config = {
  chats: ChatConfig[]
  banWords: WordConfig[]
}

export const getConfig = async (path: string): Promise<Config> => {
  const file = await Deno.open(path)
  const decoder = new TextDecoder('utf-8')
  const content = decoder.decode(await readAll(file))

  return parse(content) as Config
}

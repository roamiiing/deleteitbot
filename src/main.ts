import { load } from 'std/dotenv/mod.ts'

import { createBot } from './bot.ts'
import { getConfig } from './config.ts'

declare global {
  namespace Deno {
    interface ProcessEnv {
      BOT_TOKEN: string
    }
  }
}

const botToken = await (async () => {
  const botToken = Deno.env.get('BOT_TOKEN')
  if (botToken) {
    return botToken
  }

  const { BOT_TOKEN } = await load()

  return BOT_TOKEN
})()

const path = Deno.args[0]

if (!path) {
  console.log('Please provide a path to the config file')
  Deno.exit(1)
}

console.log('Getting config from', path)

const config = await getConfig(path)
const bot = createBot(config, botToken)

console.log('Starting bot')
await bot.start()

import "dotenv/config";
import { createBot, startBot } from "./bot";
import { loadConfig } from "./config";
import { fetchWords } from "./filter";

const config = loadConfig();
const words = await fetchWords(config.WORDS_URL);
const { bot } = createBot({
  token: config.BOT_TOKEN,
  words,
  databaseUrl: config.DATABASE_URL,
  deleteDelaySeconds: config.DELETE_DELAY_SECONDS,
  sweepIntervalSeconds: config.SWEEP_INTERVAL_SECONDS,
});

console.log(`DeleteItBot started in long polling mode with ${words.length} banned words`);
await startBot(bot);

import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  WORDS_URL: z.string().url(),
  DATABASE_URL: z.string().default("file:./data/deleteitbot.sqlite"),
  DELETE_DELAY_SECONDS: z.coerce.number().int().positive().default(3600),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
});

export type RuntimeConfig = z.infer<typeof envSchema>;

export function loadConfig(env = process.env): RuntimeConfig {
  return envSchema.parse(env);
}

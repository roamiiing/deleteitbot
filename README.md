# DeleteItBot Next

Bun + TypeScript + grammY + Drizzle + SQLite rewrite of DeleteItBot.

## Configuration

Required:

- `BOT_TOKEN`
- `WORDS_URL`

Optional:

- `DATABASE_URL`, default `file:./data/deleteitbot.sqlite`
- `DELETE_DELAY_SECONDS`, default `3600`
- `SWEEP_INTERVAL_SECONDS`, default `60`

The bot fetches banned words from `WORDS_URL` at startup. The response is parsed as newline-separated plain text; empty lines are ignored. Startup fails if the fetch fails or the resulting list is empty.

When a text message or caption matches a banned word, the bot queues it for delayed deletion and reacts with `👾`. If a chat creator or administrator reacts to the queued message with `👾`, deletion is paused. Removing that admin reaction removes the veto; if the message is already due, the next sweep deletes it.

Telegram does not include a user ID for anonymous admin reactions, so anonymous reactions are ignored.

```bash
bun install
bun run db:migrate
bun run dev
bun test
```

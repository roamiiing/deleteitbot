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

When a text message or caption matches a banned word, the bot queues it for delayed deletion and reacts with `👾`. The `👾` reaction marks "queued for deletion"; the `🕊` reaction is the veto control. If a chat creator or administrator reacts to the message with `🕊`, deletion is paused and the bot replaces its own `👾` reaction with `🕊`. If that administrator removes `🕊`, the bot removes the veto and restores `👾`.

If the bot missed banned content, a chat creator or administrator can react to a plain message with `👾`. The bot then queues that message for delayed deletion and adds its own `👾` reaction. Removing the admin's `👾` reaction does not change the queue; adding `🕊` pauses deletion and removes the bot's `👾` status reaction. A standalone `🕊` on a message the bot has not queued is ignored.

Telegram does not include a user ID for anonymous admin reactions, so anonymous reactions are ignored.

```bash
bun install
bun run db:migrate
bun run dev
bun test
```

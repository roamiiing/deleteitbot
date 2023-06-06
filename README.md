# deleteitbot

A bot that deletes messages that contain certain words.

## Installation

Using docker-compose:

```yaml
version: '3.8'

services:
    deleteitbot:
        container_name: deleteitbot
        hostname: deleteitbot
        image: ghcr.io/roamiiing/deleteitbot:latest
        restart: on-failure
        env_file: .env
        volumes:
            - ./config:/app/config
```

## Configuration

In the `./config` folder create a `deleteit.yaml` file with the following
content:

```yaml
timeout: 10

chats:
    - -1234567890

banWords:
    - word1
    - word2
    - word3
```

The `chats` list contains the chat IDs that the bot will monitor. You can obtain
a chat ID by talking to [@userinfobot](https://t.me/userinfobot).

The `timeout` parameter is the number of seconds the bot will wait before
deleting a message that contains a banned word.

The `banWords` list contains the words that the bot will look for in messages.
If a message contains any of these words, the bot will delete it.

In the `.env` file add the following:

```env
BOT_TOKEN=1234567890:ABCDEF1234567890ABCDEF1234567890ABC
```

You can obtain a bot token by talking to [@BotFather](https://t.me/BotFather).

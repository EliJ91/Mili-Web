# Mili Web

Mili Web is a small read-only Discord bot for Militant web tooling.

The bot reads Discord server data needed by the webapp, such as guild/member information, without modifying Discord content.

## Permissions

Use the minimum Discord permissions needed:

- View Channels
- Read Message History

Enable these privileged gateway intents in the Discord Developer Portal:

- Server Members Intent
- Message Content Intent

## Setup

```bash
npm install
copy .env.example .env
```

Set `DISCORD_BOT_TOKEN` in `.env`.

## Run

```bash
npm run discord:worker
```

## Checks

```bash
npm run lint
npm test
npm run build
```

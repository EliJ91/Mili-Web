# Mili Web

Mili Web is a small Discord bot for Militant web tooling.

The bot reads Discord server data needed by the webapp, such as guild/member information. It also watches for the manual `!upload` command in configured loot-log threads, reacts with a status emoji, and uploads attached loot `.csv` files to the webapp database.

## Permissions

Use the minimum Discord permissions needed:

- View Channels
- Read Message History
- Add Reactions

Enable these privileged gateway intents in the Discord Developer Portal:

- Server Members Intent
- Message Content Intent

## Setup

```bash
npm install
copy .env.example .env
```

Set `DISCORD_BOT_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. `DISCORD_LOOT_LOG_CHANNEL_ID` defaults to the Militant loot-log thread parent channel.

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

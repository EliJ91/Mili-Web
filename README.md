# Mili Web

## Discord Read-Only Bot

This repo includes a small Discord worker built with `discord.js`. The worker is read-only. It reads Discord data and events, but does not send, edit, delete, react to, or otherwise modify Discord content.

### Discord Developer Portal

Enable these privileged gateway intents for the bot:

- Server Members Intent
- Message Content Intent

The worker uses these Discord gateway intents:

- Guilds
- Guild Messages
- Message Content
- Guild Members

### Minimum Bot Permissions

Invite the bot with only these permissions:

- View Channels
- Read Message History

Do not grant send, manage, react, edit, delete, or moderation permissions.

### Setup

```bash
npm install
copy .env.example .env
```

Set `DISCORD_BOT_TOKEN` in `.env` or in your server environment.

### Run

```bash
npm run discord:worker
```

If you run without an `.env` loader, set the variable in your shell first:

```bash
$env:DISCORD_BOT_TOKEN="your-token"
npm run discord:worker
```

### Checks

```bash
npm run lint
npm test
npm run build
```

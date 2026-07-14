# Mili Web

Mili Web provides the Militant Discord integration. The production upload command is a serverless Cloudflare Worker: `/upload` reads the `.csv` loot logs in the current Discord thread and sends them through the existing webapp bundle pipeline. No always-on VM is required.

## Permissions

The bot needs these permissions in the loot-log channel and its threads:

- View Channels
- Read Message History

The `/upload` Cloudflare Worker does not use gateway intents. Discord OAuth login and webapp role checks continue to use the existing Supabase permissions function.

The optional local read-only gateway worker requires these Developer Portal intents:

- Server Members Intent
- Message Content Intent

## Setup

```bash
npm install
copy .env.example .env
```

Set the local values in `.env` when registering or testing the command. Production secrets belong in Cloudflare Worker secrets, never in Git:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The application, guild, and loot-log channel IDs are configured in `wrangler.jsonc`.

## Deploy

```bash
npm run cf:deploy
npm run discord:register
```

After deployment, set the Worker URL as the application's Interactions Endpoint URL in the Discord Developer Portal. `/upload` is registered as a guild command, so updates are available immediately in the Militant server.

For local Worker development, run `npm run cf:dev`. The legacy `npm run discord:worker` command remains available only for local read-only gateway event monitoring and is not required for `/upload`, Discord login, or webapp permissions.

## Checks

```bash
npm run lint
npm test
npm run build
```

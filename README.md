# Mili Web

Mili Web provides the Militant Discord integration. The serverless Cloudflare Worker handles `/upload` for loot logs and `/build` for signup-thread build cards. No always-on VM is required.

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
- `COMMAND_REGISTRATION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The application, guild, loot-log channel, and build-signup channel IDs are configured in `wrangler.jsonc`. `/build` reads only the current thread under the configured build-signup channel, finds the invoking member's roster number, and displays the matching build from the latest saved ZVZ layout.

## Deploy

```bash
npm run cf:deploy
npm run discord:register
```

After deployment, set the Worker URL as the application's Interactions Endpoint URL in the Discord Developer Portal. `/upload` and `/build` are registered as guild commands, so updates are available immediately in the Militant server.

For local Worker development, run `npm run cf:dev`. The legacy `npm run discord:worker` command remains available only for local read-only gateway event monitoring and is not required for `/upload`, Discord login, or webapp permissions.

## Checks

```bash
npm run lint
npm test
npm run build
```

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

Set `DISCORD_BOT_TOKEN` in `.env` or in your server environment. The worker loads `.env` automatically.

### Run

```bash
npm run discord:worker
```

Or set the variable in your shell:

```bash
$env:DISCORD_BOT_TOKEN="your-token"
npm run discord:worker
```

### Oracle Always Free VM

Use an Always Free Eligible Ubuntu VM, then run:

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
git clone https://github.com/EliJ91/Mili-Web.git
cd Mili-Web
npm ci --omit=dev
cp .env.example .env
nano .env
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then reboot-test with:

```bash
sudo reboot
pm2 status
```

Update the bot later with:

```bash
cd ~/Mili-Web
bash scripts/update-bot.sh
```

### Checks

```bash
npm run lint
npm test
npm run build
```

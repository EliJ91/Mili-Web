import 'dotenv/config';
import { REST } from '@discordjs/rest';
import { ApplicationCommandType, Routes } from 'discord-api-types/v10';

const applicationId = process.env.DISCORD_APPLICATION_ID || '1525606439500910682';
const guildId = process.env.DISCORD_GUILD_ID || '805908199541702666';
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) throw new Error('DISCORD_BOT_TOKEN is required.');

const rest = new REST({ version: '10' }).setToken(token);
await rest.post(Routes.applicationGuildCommands(applicationId, guildId), {
  body: {
    description: 'Upload the CSV loot logs attached to this thread',
    dm_permission: false,
    name: 'upload',
    type: ApplicationCommandType.ChatInput,
  },
});

console.log('Registered /upload for the Militant Discord server.');

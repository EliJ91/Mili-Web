import 'dotenv/config';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { createApplicationCommands } from '../src/discord/applicationCommands.js';

const applicationId = process.env.DISCORD_APPLICATION_ID || '1525606439500910682';
const guildId = process.env.DISCORD_GUILD_ID || '805908199541702666';
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) throw new Error('DISCORD_BOT_TOKEN is required.');

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
  body: createApplicationCommands(),
});

console.log('Registered /upload and /build for the Militant Discord server.');

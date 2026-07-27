import 'dotenv/config';
import { REST } from '@discordjs/rest';
import { ApplicationCommandOptionType, ApplicationCommandType, Routes } from 'discord-api-types/v10';

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
    options: [{
      choices: Array.from({ length: 12 }, (_, index) => {
        const hour = String(index * 2).padStart(2, '0');
        return { name: `${hour} UTC`, value: hour };
      }),
      description: 'Earliest UTC hour to keep in the merged loot log',
      name: 'cta_timer',
      required: true,
      type: ApplicationCommandOptionType.String,
    }],
    type: ApplicationCommandType.ChatInput,
  },
});

console.log('Registered /upload for the Militant Discord server.');

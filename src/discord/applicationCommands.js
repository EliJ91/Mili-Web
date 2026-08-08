import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';

export function createApplicationCommands() {
  return [{
    description: 'Upload the CSV loot logs attached to this thread',
    dm_permission: false,
    name: 'upload',
    options: [{
      choices: Array.from({ length: 24 }, (_, index) => {
        const hour = String(index).padStart(2, '0');
        return { name: `${hour} UTC`, value: hour };
      }),
      description: 'Earliest UTC hour to keep in the merged loot log',
      name: 'cta_timer',
      required: true,
      type: ApplicationCommandOptionType.String,
    }],
    type: ApplicationCommandType.ChatInput,
  }, {
    description: 'Show your assigned build for this signup thread',
    dm_permission: false,
    name: 'build',
    type: ApplicationCommandType.ChatInput,
  }];
}


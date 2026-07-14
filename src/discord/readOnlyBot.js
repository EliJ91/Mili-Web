import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
} from 'discord.js';

const READ_ONLY_PERMISSION_BITS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.ReadMessageHistory,
];

const REQUIRED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
];

function collectionToArray(value) {
  if (!value) return [];
  if (typeof value.values === 'function') return [...value.values()];
  return Array.isArray(value) ? value : [...value];
}

function snowflake(value) {
  return value ? String(value) : '';
}

function serializeUser(user) {
  if (!user) return null;

  return {
    bot: Boolean(user.bot),
    discriminator: user.discriminator || '',
    globalName: user.globalName || null,
    id: snowflake(user.id),
    tag: user.tag || user.username || '',
    username: user.username || '',
  };
}

function serializeAttachment(attachment) {
  return {
    contentType: attachment.contentType || null,
    id: snowflake(attachment.id),
    name: attachment.name || '',
    size: Number(attachment.size || 0),
    url: attachment.url || '',
  };
}

function serializeEmbed(embed) {
  return typeof embed.toJSON === 'function' ? embed.toJSON() : { ...embed };
}

export function serializeMessage(message) {
  if (!message) return null;

  return {
    attachments: collectionToArray(message.attachments).map(serializeAttachment),
    author: serializeUser(message.author),
    channelId: snowflake(message.channelId || message.channel?.id),
    content: message.content || '',
    createdAt: message.createdAt?.toISOString?.() || null,
    editedAt: message.editedAt?.toISOString?.() || null,
    embeds: collectionToArray(message.embeds).map(serializeEmbed),
    guildId: snowflake(message.guildId || message.guild?.id),
    id: snowflake(message.id),
    timestamp: Number(message.createdTimestamp || 0),
  };
}

function serializeChannel(channel) {
  if (!channel) return null;

  return {
    guildId: snowflake(channel.guildId || channel.guild?.id),
    id: snowflake(channel.id),
    name: channel.name || '',
    parentId: snowflake(channel.parentId),
    position: Number(channel.rawPosition ?? channel.position ?? 0),
    type: channel.type,
  };
}

function serializeRole(role) {
  if (!role) return null;

  return {
    color: Number(role.color || 0),
    hoist: Boolean(role.hoist),
    id: snowflake(role.id),
    managed: Boolean(role.managed),
    name: role.name || '',
    position: Number(role.position || 0),
  };
}

function serializeMember(member) {
  if (!member) return null;

  return {
    id: snowflake(member.id || member.user?.id),
    joinedAt: member.joinedAt?.toISOString?.() || null,
    nickname: member.nickname || null,
    roles: collectionToArray(member.roles?.cache).map(serializeRole),
    user: serializeUser(member.user),
  };
}

function roleIds(member) {
  return new Set(collectionToArray(member?.roles?.cache).map((role) => snowflake(role.id)));
}

function diffRoles(oldMember, newMember) {
  const previous = roleIds(oldMember);
  const current = roleIds(newMember);

  return {
    added: [...current].filter((roleId) => !previous.has(roleId)),
    removed: [...previous].filter((roleId) => !current.has(roleId)),
  };
}

function canFetchMessageHistory(channel) {
  return typeof channel?.messages?.fetch === 'function';
}

export function getReadOnlyPermissionBitfield() {
  return new PermissionsBitField(READ_ONLY_PERMISSION_BITS).bitfield;
}

export function createReadOnlyDiscordBot({
  client = null,
  logger = console,
  onEvent = () => {},
  token = process.env.DISCORD_BOT_TOKEN,
} = {}) {
  const discordClient = client || new Client({
    intents: REQUIRED_INTENTS,
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
  });

  function emit(type, payload) {
    onEvent({ payload, type });
  }

  discordClient.once?.('ready', () => {
    logger.info?.(`Discord read-only worker connected as ${discordClient.user?.tag || 'unknown bot'}.`);
  });

  discordClient.on?.('messageCreate', (message) => {
    emit('messageCreate', serializeMessage(message));
  });

  discordClient.on?.('messageUpdate', (oldMessage, newMessage) => {
    emit('messageUpdate', {
      after: serializeMessage(newMessage),
      before: serializeMessage(oldMessage),
    });
  });

  discordClient.on?.('messageDelete', (message) => {
    emit('messageDelete', serializeMessage(message));
  });

  discordClient.on?.('guildMemberAdd', (member) => {
    emit('guildMemberAdd', serializeMember(member));
  });

  discordClient.on?.('guildMemberRemove', (member) => {
    emit('guildMemberRemove', serializeMember(member));
  });

  discordClient.on?.('guildMemberUpdate', (oldMember, newMember) => {
    emit('guildMemberUpdate', {
      member: serializeMember(newMember),
      roles: diffRoles(oldMember, newMember),
    });
  });

  discordClient.on?.('error', (error) => {
    logger.error?.('Discord client error.', error);
  });

  async function start() {
    if (!token) throw new Error('DISCORD_BOT_TOKEN is required.');
    await discordClient.login(token);
    return discordClient;
  }

  async function stop() {
    await discordClient.destroy?.();
  }

  async function fetchChannelMessages(channelId, options = {}) {
    const channel = await discordClient.channels.fetch(channelId);
    if (!canFetchMessageHistory(channel)) {
      throw new Error(`Channel ${channelId} does not expose readable message history.`);
    }

    const messages = await channel.messages.fetch({
      after: options.after,
      around: options.around,
      before: options.before,
      limit: options.limit ?? 50,
    });

    return collectionToArray(messages).map(serializeMessage);
  }

  async function fetchGuildSnapshot(guildId) {
    const guild = await discordClient.guilds.fetch(guildId);
    const [channels, roles, members] = await Promise.all([
      guild.channels.fetch(),
      guild.roles.fetch(),
      guild.members.fetch(),
    ]);

    return {
      channels: collectionToArray(channels).map(serializeChannel).filter(Boolean),
      guildId: snowflake(guild.id),
      members: collectionToArray(members).map(serializeMember).filter(Boolean),
      name: guild.name || '',
      roles: collectionToArray(roles).map(serializeRole).filter(Boolean),
    };
  }

  return {
    client: discordClient,
    fetchChannelMessages,
    fetchGuildSnapshot,
    getReadOnlyPermissionBitfield,
    start,
    stop,
  };
}

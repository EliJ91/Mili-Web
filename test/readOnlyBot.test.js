import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReadOnlyDiscordBot,
  getReadOnlyPermissionBitfield,
  serializeMessage,
} from '../src/discord/readOnlyBot.js';

class MockClient extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.loggedInWith = '';
    this.user = { tag: 'Readonly#0001' };
    this.channels = {
      fetch: async () => this.channel,
    };
    this.guilds = {
      fetch: async () => this.guild,
    };
  }

  async login(token) {
    this.loggedInWith = token;
  }

  async destroy() {
    this.destroyed = true;
  }
}

function makeCollection(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function makeMessage(overrides = {}) {
  return {
    attachments: makeCollection([
      { contentType: 'image/png', id: 'attachment-1', name: 'image.png', size: 123, url: 'https://cdn.example/image.png' },
    ]),
    author: { bot: false, discriminator: '0', id: 'user-1', tag: 'player', username: 'player' },
    channelId: 'channel-1',
    content: 'hello',
    createdAt: new Date('2026-07-11T12:00:00.000Z'),
    createdTimestamp: 1783771200000,
    editedAt: null,
    embeds: [{ title: 'embed' }],
    guildId: 'guild-1',
    id: 'message-1',
    ...overrides,
  };
}

test('starts and stops with an injected Discord client', async () => {
  const client = new MockClient();
  const bot = createReadOnlyDiscordBot({ client, logger: {}, token: 'token' });

  await bot.start();
  await bot.stop();

  assert.equal(client.loggedInWith, 'token');
  assert.equal(client.destroyed, true);
});

test('throws when token is missing', async () => {
  const client = new MockClient();
  const bot = createReadOnlyDiscordBot({ client, logger: {}, token: '' });

  await assert.rejects(() => bot.start(), /DISCORD_BOT_TOKEN/);
});

test('serializes message content, author, timestamps, attachments, and embeds', () => {
  const message = serializeMessage(makeMessage());

  assert.equal(message.content, 'hello');
  assert.equal(message.author.id, 'user-1');
  assert.equal(message.createdAt, '2026-07-11T12:00:00.000Z');
  assert.equal(message.attachments[0].name, 'image.png');
  assert.equal(message.embeds[0].title, 'embed');
});

test('emits read-only Discord events without mutating messages', () => {
  const client = new MockClient();
  const events = [];
  createReadOnlyDiscordBot({ client, logger: {}, onEvent: (event) => events.push(event), token: 'token' });

  client.emit('messageCreate', makeMessage());
  client.emit('messageUpdate', makeMessage({ content: 'old' }), makeMessage({ content: 'new' }));
  client.emit('messageDelete', makeMessage({ content: 'deleted' }));

  assert.deepEqual(events.map((event) => event.type), ['messageCreate', 'messageUpdate', 'messageDelete']);
  assert.equal(events[1].payload.before.content, 'old');
  assert.equal(events[1].payload.after.content, 'new');
});

test('tracks member joins, leaves, and role changes', () => {
  const client = new MockClient();
  const events = [];
  const oldMember = {
    id: 'member-1',
    roles: { cache: makeCollection([{ id: 'role-1', name: 'Old' }]) },
    user: { id: 'member-1', username: 'member' },
  };
  const newMember = {
    id: 'member-1',
    roles: { cache: makeCollection([{ id: 'role-2', name: 'New' }]) },
    user: { id: 'member-1', username: 'member' },
  };
  createReadOnlyDiscordBot({ client, logger: {}, onEvent: (event) => events.push(event), token: 'token' });

  client.emit('guildMemberAdd', newMember);
  client.emit('guildMemberRemove', oldMember);
  client.emit('guildMemberUpdate', oldMember, newMember);

  assert.deepEqual(events.map((event) => event.type), ['guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate']);
  assert.deepEqual(events[2].payload.roles, { added: ['role-2'], removed: ['role-1'] });
});

test('fetches channel message history through Discord without connecting in tests', async () => {
  const client = new MockClient();
  client.channel = {
    messages: {
      fetch: async (options) => {
        assert.equal(options.limit, 2);
        return makeCollection([makeMessage({ id: 'message-1' }), makeMessage({ id: 'message-2' })]);
      },
    },
  };
  const bot = createReadOnlyDiscordBot({ client, logger: {}, token: 'token' });

  const messages = await bot.fetchChannelMessages('channel-1', { limit: 2 });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, 'message-1');
});

test('fetches server channels, roles, and members', async () => {
  const client = new MockClient();
  client.guild = {
    channels: { fetch: async () => makeCollection([{ id: 'channel-1', name: 'general', type: 0 }]) },
    id: 'guild-1',
    members: { fetch: async () => makeCollection([{ id: 'member-1', roles: { cache: makeCollection([]) }, user: { id: 'member-1', username: 'member' } }]) },
    name: 'Guild',
    roles: { fetch: async () => makeCollection([{ id: 'role-1', name: 'Member' }]) },
  };
  const bot = createReadOnlyDiscordBot({ client, logger: {}, token: 'token' });

  const snapshot = await bot.fetchGuildSnapshot('guild-1');

  assert.equal(snapshot.guildId, 'guild-1');
  assert.equal(snapshot.channels[0].name, 'general');
  assert.equal(snapshot.roles[0].name, 'Member');
  assert.equal(snapshot.members[0].user.username, 'member');
});

test('uses only View Channels and Read Message History permissions', () => {
  assert.equal(getReadOnlyPermissionBitfield(), 66560n);
});

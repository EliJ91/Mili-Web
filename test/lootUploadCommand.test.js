import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ChannelType } from 'discord.js';
import {
  DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
  collectLogAttachmentJobs,
  isSupportedLogAttachment,
  memberCanUploadLootLogsFromDiscord,
  processLootUploadThread,
} from '../src/discord/lootUploadCommand.js';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function restore() {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
}

afterEach(restore);

function createAttachment(id, name) {
  return { id, name, url: `https://cdn.discordapp.test/${id}/${name}` };
}

function createMessage({ attachment, id = 'message-1', timestamp = 100 } = {}) {
  return {
    attachments: attachment ? new Map([[attachment.id, attachment]]) : new Map(),
    author: { id: 'user-1', username: 'DiscordUser' },
    createdTimestamp: timestamp,
    guild: {
      members: {
        fetch: mock.fn(async () => ({ displayName: 'Onslawht', nickname: 'Onslawht' })),
      },
    },
    id,
    member: { displayName: 'Onslawht', id: 'user-1', nickname: 'Onslawht' },
  };
}

function createThread(messages) {
  return {
    id: 'thread-1',
    messages: {
      fetch: mock.fn(async () => new Map(messages.map((message) => [message.id, message]))),
    },
    name: '04 CTA Uploads',
    parentId: DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
    type: ChannelType.PublicThread,
  };
}

function mockJsonResponse(data, ok = true) {
  return {
    json: async () => data,
    ok,
    text: async () => JSON.stringify(data),
  };
}

describe('loot upload command helpers', () => {
  it('recognizes only csv attachments', () => {
    assert.equal(isSupportedLogAttachment(createAttachment('1', 'loot.csv')), true);
    assert.equal(isSupportedLogAttachment(createAttachment('2', 'chest.txt')), false);
  });

  it('sorts attachment jobs by message time', () => {
    const older = createMessage({ attachment: createAttachment('old', 'old.csv'), id: 'message-1', timestamp: 100 });
    const newer = createMessage({ attachment: createAttachment('new', 'new.csv'), id: 'message-2', timestamp: 200 });
    assert.deepEqual(collectLogAttachmentJobs([newer, older]).map((job) => job.attachmentId), ['old', 'new']);
  });

  it('checks the Discord upload permission against configured role ids', async () => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    globalThis.fetch = mock.fn(async (url) => {
      assert.match(String(url), /webapp_permission_settings/);
      return mockJsonResponse([{
        settings: {
          roles: [
            { permissions: { uploadLootLogsFromDiscord: true }, roleId: 'role-logger' },
          ],
        },
      }]);
    });

    const allowed = await memberCanUploadLootLogsFromDiscord({
      id: 'user-1',
      roles: { cache: new Map([['role-logger', {}]]) },
    });
    assert.equal(allowed, true);
  });

  it('uploads csv files from a permitted slash-command request', async () => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const attachmentMessage = createMessage({ attachment: lootAttachment });
    attachmentMessage.member = { id: 'user-2', nickname: 'Chapper' };
    attachmentMessage.author = { id: 'user-2', username: 'ActualDiscordUsername' };
    attachmentMessage.guild = { members: { fetch: mock.fn(async () => ({ nickname: 'Chapper' })) } };
    const thread = createThread([attachmentMessage]);
    const calls = [];
    globalThis.fetch = mock.fn(async (url, options = {}) => {
      calls.push({ body: options.body ? JSON.parse(options.body) : null, method: options.method || 'GET', url: String(url) });
      const value = String(url);
      if (value.includes('cdn.discordapp.test')) {
        return {
          arrayBuffer: async () => Buffer.from(`timestamp_utc;looted_by__name;item_id;item_name;quantity
2026-07-12T04:00:00.000Z;Onslawht;T4_RUNE;Adept's Rune;1`),
          headers: new Map(),
          ok: true,
        };
      }
      if (value.includes('webapp_permission_settings')) {
        return mockJsonResponse([{ settings: { roles: [{ permissions: { uploadLootLogsFromDiscord: true }, roleId: 'role-logger' }] } }]);
      }
      if (value.includes('discord_loot_threads') && !options.body) return mockJsonResponse([]);
      if (value.includes('discord_loot_attachments') && !options.body) return mockJsonResponse([]);
      if (value.includes('/functions/v1/loot-logs')) return { json: async () => ({ bundleId: 'bundle-1' }), ok: true };
      if (value.includes('loot_log_bundles') && !options.body) return mockJsonResponse([{ combined_loot_summary: {} }]);
      return mockJsonResponse([{ id: 'ok' }]);
    });

    const result = await processLootUploadThread({
      actorMember: { id: 'user-1', roles: ['role-logger'] },
      actorName: 'Onslawht',
      fetchAttachmentTextFn: async () => `timestamp_utc;looted_by__name;item_id;item_name;quantity
2026-07-12T04:00:00.000Z;Onslawht;T4_RUNE;Adept's Rune;1`,
      getMessageDisplayName: async () => 'Chapper',
      messages: [attachmentMessage],
      thread,
    });

    assert.equal(result.processedAttachments, 1);
    assert.equal(result.accepted, true);
    assert.equal(calls.some((call) => call.url.includes('/functions/v1/loot-logs')), true);
    assert.equal(calls.find((call) => call.url.includes('/functions/v1/loot-logs')).body.originalFileName, '04 CTA Uploads');
    const actionLog = calls.find((call) => call.url.includes('webapp_action_logs'));
    assert.equal(actionLog.body.actor_name, 'Onslawht');
    assert.equal(actionLog.body.details.uploadedBy, 'Chapper');
  });
});

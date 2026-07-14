import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from 'discord-api-types/v10';
import {
  handleInteractionRequest,
  handleMemberLookupRequest,
  processUploadInteraction,
} from '../src/cloudflare/worker.js';

const env = {
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_GUILD_ID: 'guild-1',
  DISCORD_LOOT_LOG_CHANNEL_ID: 'parent-1',
  DISCORD_PUBLIC_KEY: 'public-key',
};

function interaction(overrides = {}) {
  return {
    application_id: 'application-1',
    channel_id: 'thread-1',
    data: { name: 'upload' },
    guild_id: 'guild-1',
    member: { nick: 'Onslawht', roles: ['role-1'], user: { id: 'user-1' } },
    token: 'interaction-token',
    type: InteractionType.ApplicationCommand,
    ...overrides,
  };
}

describe('Cloudflare Discord interaction worker', () => {
  it('returns a guild member nickname and roles to the authenticated webapp backend', async () => {
    const rest = {
      get: mock.fn(async () => ({
        nick: 'Onslawht',
        roles: ['role-1', 'role-2'],
        user: { id: '264193431830528006', username: 'E2J' },
      })),
    };
    const request = new Request('https://worker.test/webapp/member', {
      body: JSON.stringify({ guildId: 'guild-1', userId: '264193431830528006' }),
      headers: { Authorization: 'Bearer lookup-secret' },
      method: 'POST',
    });

    const response = await handleMemberLookupRequest(request, {
      ...env,
      WEBAPP_MEMBER_LOOKUP_SECRET: 'lookup-secret',
    }, { rest });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      discordGuildId: 'guild-1',
      discordUserId: '264193431830528006',
      guildNickname: 'Onslawht',
      roleIds: ['role-1', 'role-2'],
      serverNickname: 'Onslawht',
    });
  });

  it('rejects unauthenticated member lookups', async () => {
    const request = new Request('https://worker.test/webapp/member', {
      body: JSON.stringify({ guildId: 'guild-1', userId: '264193431830528006' }),
      method: 'POST',
    });

    const response = await handleMemberLookupRequest(request, {
      ...env,
      WEBAPP_MEMBER_LOOKUP_SECRET: 'lookup-secret',
    });

    assert.equal(response.status, 401);
  });

  it('responds to Discord verification pings', async () => {
    const request = new Request('https://worker.test/', {
      body: JSON.stringify({ type: InteractionType.Ping }),
      headers: {
        'x-signature-ed25519': 'signature',
        'x-signature-timestamp': 'timestamp',
      },
      method: 'POST',
    });
    const response = await handleInteractionRequest(request, env, { waitUntil() {} }, {
      verify: async () => true,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { type: InteractionResponseType.Pong });
  });

  it('defers upload work and makes the result ephemeral', async () => {
    const pending = [];
    const processThread = mock.fn(async () => ({ processedAttachments: 2, skippedAttachments: 0 }));
    const rest = {
      get: mock.fn(async (route) => (route.includes('/channels/thread-1/messages') ? [] : {
        id: 'thread-1', name: '02 CTA', parent_id: 'parent-1', type: 11,
      })),
      patch: mock.fn(async () => ({})),
    };
    const request = new Request('https://worker.test/', {
      body: JSON.stringify(interaction()),
      headers: {
        'x-signature-ed25519': 'signature',
        'x-signature-timestamp': 'timestamp',
      },
      method: 'POST',
    });
    const response = await handleInteractionRequest(request, env, {
      waitUntil(promise) { pending.push(promise); },
    }, {
      processThread,
      rest,
      verify: async () => true,
    });
    await Promise.all(pending);

    assert.deepEqual(await response.json(), {
      data: { flags: MessageFlags.Ephemeral },
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
    assert.equal(processThread.mock.callCount(), 1);
    assert.equal(rest.patch.mock.callCount(), 1);
    assert.match(rest.patch.mock.calls[0].arguments[1].body.content, /2 loot log/);
  });

  it('passes the command nickname, roles, and thread messages into the existing upload service', async () => {
    const processThread = mock.fn(async () => ({ processedAttachments: 1, skippedAttachments: 0 }));
    const rest = {
      get: mock.fn(async (route) => {
        if (route.includes('/messages')) return [{ id: 'message-1', attachments: [], timestamp: '2026-07-14T12:00:00Z' }];
        return { id: 'thread-1', name: '02 CTA', parent_id: 'parent-1', type: 11 };
      }),
      patch: mock.fn(async () => ({})),
    };

    await processUploadInteraction(interaction(), env, { processThread, rest });

    const options = processThread.mock.calls[0].arguments[0];
    assert.equal(options.actorName, 'Onslawht');
    assert.deepEqual(options.actorMember.roles, ['role-1']);
    assert.equal(options.thread.name, '02 CTA');
  });
});

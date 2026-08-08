import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from 'discord-api-types/v10';
import {
  handleInteractionRequest,
  handleCommandRegistrationRequest,
  handleLootLogShareRequest,
  handleMemberLookupRequest,
  handleUploadQueue,
  processBuildInteraction,
  processUploadInteraction,
} from '../src/cloudflare/worker.js';

const env = {
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_BUILD_CHANNEL_ID: 'build-parent-1',
  DISCORD_GUILD_ID: 'guild-1',
  DISCORD_LOOT_LOG_CHANNEL_ID: 'parent-1',
  DISCORD_PUBLIC_KEY: 'public-key',
};

function interaction(overrides = {}) {
  return {
    application_id: 'application-1',
    channel_id: 'thread-1',
    data: { name: 'upload', options: [{ name: 'cta_timer', type: 3, value: '02' }] },
    guild_id: 'guild-1',
    member: { nick: 'Onslawht', roles: ['role-1'], user: { id: 'user-1' } },
    token: 'interaction-token',
    type: InteractionType.ApplicationCommand,
    ...overrides,
  };
}

describe('Cloudflare Discord interaction worker', () => {
  it('renders a loot log title in the shared link preview', async () => {
    const response = await handleLootLogShareRequest(
      new Request('https://worker.test/share/loot-log?bundle=bundle-1&s=kept'),
      {
        fetchImpl: mock.fn(async () => new Response(JSON.stringify({
          bundle: { lootFileName: '02 CTA 7-15' },
        }), { status: 200 })),
      },
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(html, /property="og:description" content="02 CTA 7-15"/);
    assert.match(html, /#shared-log\/bundle-1\?s=kept/);
    assert.doesNotMatch(html, /Hold the line\./);
  });

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

  it('registers both guild commands through the protected worker endpoint', async () => {
    const rest = { put: mock.fn(async () => []) };
    const request = new Request('https://worker.test/admin/commands', {
      headers: { Authorization: 'Bearer registration-secret' },
      method: 'POST',
    });

    const response = await handleCommandRegistrationRequest(request, {
      ...env,
      COMMAND_REGISTRATION_SECRET: 'registration-secret',
      DISCORD_APPLICATION_ID: 'application-1',
    }, { rest });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { commands: ['upload', 'build'], registered: true });
    assert.deepEqual(rest.put.mock.calls[0].arguments[1].body.map(({ name }) => name), ['upload', 'build']);
  });

  it('rejects unauthenticated command registration requests', async () => {
    const response = await handleCommandRegistrationRequest(
      new Request('https://worker.test/admin/commands', { method: 'POST' }),
      { ...env, COMMAND_REGISTRATION_SECRET: 'registration-secret' },
    );

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

  it('acknowledges upload work immediately and makes the result ephemeral', async () => {
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
      data: {
        allowed_mentions: { parse: [] },
        content: 'Upload accepted. Processing loot logs...',
        flags: MessageFlags.Ephemeral,
      },
      type: InteractionResponseType.ChannelMessageWithSource,
    });
    assert.equal(processThread.mock.callCount(), 1);
    assert.equal(rest.patch.mock.callCount(), 1);
    assert.match(rest.patch.mock.calls[0].arguments[1].body.content, /2 loot log/);
  });

  it('acknowledges build work immediately and returns the signed-up member build', async () => {
    const pending = [];
    const rest = {
      get: mock.fn(async () => ({
        id: 'thread-1', name: 'CTA signup', parent_id: 'build-parent-1', type: 11,
      })),
      patch: mock.fn(async () => ({})),
    };
    const request = new Request('https://worker.test/', {
      body: JSON.stringify(interaction({ data: { name: 'build' } })),
      headers: {
        'x-signature-ed25519': 'signature',
        'x-signature-timestamp': 'timestamp',
      },
      method: 'POST',
    });
    const response = await handleInteractionRequest(request, env, {
      waitUntil(promise) { pending.push(promise); },
    }, {
      fetchThreadMessagesFn: async () => [{
        content: '2. <@user-1>',
        timestamp: '2026-08-08T12:00:00Z',
      }],
      loadLatestLayoutFn: async () => ({
        builds: [{
          number: '2',
          role: 'Engage',
          slots: {
            armor: [], boots: [], cape: [], foodPots: [], helm: [], offHand: [],
            mainHand: [{
              imageUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_UNDEAD.png',
              name: 'Lifecurse',
            }],
          },
        }],
      }),
      rest,
      verify: async () => true,
    });
    await Promise.all(pending);

    const acknowledgement = await response.json();
    assert.equal(acknowledgement.type, InteractionResponseType.ChannelMessageWithSource);
    assert.equal(acknowledgement.data.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    assert.match(acknowledgement.data.components[0].content, /Finding your build/);
    const result = rest.patch.mock.calls[0].arguments[1].body;
    assert.match(result.components[0].components[0].content, /Build #2/);
    assert.match(result.components[0].components[0].content, /Role:\*\* Engage/);
  });

  it('returns not signed up when the invoking member is absent from the current thread signup', async () => {
    const rest = {
      get: mock.fn(async () => ({
        id: 'thread-1', name: 'CTA signup', parent_id: 'build-parent-1', type: 11,
      })),
      patch: mock.fn(async () => ({})),
    };

    const result = await processBuildInteraction(interaction({ data: { name: 'build' } }), env, {
      fetchThreadMessagesFn: async () => [{ content: '1. <@someone-else>', timestamp: '2026-08-08T12:00:00Z' }],
      loadLatestLayoutFn: async () => ({ builds: [] }),
      rest,
    });

    assert.equal(result.notSignedUp, true);
    assert.equal(rest.patch.mock.calls[0].arguments[1].body.components[0].content, 'Not signed up.');
  });

  it('rejects build lookups outside the configured signup thread channel', async () => {
    const rest = {
      get: mock.fn(async () => ({
        id: 'thread-1', name: 'Other thread', parent_id: 'wrong-parent', type: 11,
      })),
      patch: mock.fn(async () => ({})),
    };

    const result = await processBuildInteraction(interaction({ data: { name: 'build' } }), env, { rest });

    assert.equal(result.ignored, true);
    assert.match(rest.patch.mock.calls[0].arguments[1].body.components[0].content, /signup thread/);
  });

  it('queues upload work when the durable queue binding is available', async () => {
    const queue = { send: mock.fn(async () => ({})) };
    const request = new Request('https://worker.test/', {
      body: JSON.stringify(interaction()),
      headers: {
        'x-signature-ed25519': 'signature',
        'x-signature-timestamp': 'timestamp',
      },
      method: 'POST',
    });
    const response = await handleInteractionRequest(request, { ...env, LOOT_UPLOAD_QUEUE: queue }, {
      waitUntil() { throw new Error('waitUntil should not be used when the queue is bound.'); },
    }, {
      verify: async () => true,
    });

    assert.equal(queue.send.mock.callCount(), 1);
    assert.deepEqual(queue.send.mock.calls[0].arguments[0], { interaction: interaction() });
    assert.match((await response.json()).data.content, /Upload queued/);
  });

  it('retries failed queued files automatically and reports their names', async () => {
    const patch = mock.fn(async () => ({}));
    const message = {
      ack: mock.fn(),
      attempts: 1,
      body: { interaction: interaction() },
      retry: mock.fn(),
    };
    const processThread = mock.fn(async () => ({
      failedFiles: [{ fileName: 'third.csv', reason: 'Timed out.' }],
      previouslyProcessedAttachments: 2,
      previouslyProcessedFiles: ['first.csv', 'second.csv'],
      processedAttachments: 0,
      processedFiles: [],
      skippedAttachments: 1,
    }));
    const rest = {
      get: mock.fn(async (route) => (route.includes('/messages') ? [] : {
        id: 'thread-1', name: '02 CTA', parent_id: 'parent-1', type: 11,
      })),
      patch,
    };

    await handleUploadQueue({ messages: [message] }, env, { processThread, rest });

    assert.equal(message.retry.mock.callCount(), 1);
    assert.deepEqual(message.retry.mock.calls[0].arguments[0], { delaySeconds: 5 });
    assert.equal(message.ack.mock.callCount(), 0);
    const notification = patch.mock.calls.at(-1).arguments[1].body.content;
    assert.match(notification, /Already processed 2: first\.csv, second\.csv/);
    assert.match(notification, /Failed 1: third\.csv/);
    assert.match(notification, /attempt 1 of 3/);
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
    assert.equal(options.ctaTimer, '02');
    assert.equal(options.thread.name, '02 CTA');
  });

  it('fetches the current server nickname for each attachment author', async () => {
    let postedBy = '';
    const processThread = mock.fn(async (options) => {
      postedBy = await options.getMessageDisplayName(options.messages[0]);
      return { processedAttachments: 1, skippedAttachments: 0 };
    });
    const rest = {
      get: mock.fn(async (route) => {
        if (route.includes('/messages')) {
          return [{
            attachments: [{ filename: 'zikeman.csv', id: 'attachment-1' }],
            author: { global_name: 'Zikeman', id: 'user-zikeman', username: 'account-name' },
            id: 'message-1',
            member: { nick: null },
            timestamp: '2026-07-30T02:00:00Z',
          }];
        }
        if (route.includes('/members/user-zikeman')) return { nick: 'Zikeman Server Nickname' };
        return { id: 'thread-1', name: '02 CTA', parent_id: 'parent-1', type: 11 };
      }),
      patch: mock.fn(async () => ({})),
    };
    const command = interaction({
      member: {
        nick: 'Zikeman Server Nickname',
        roles: ['role-1'],
        user: { global_name: 'Zikeman', id: 'user-zikeman', username: 'account-name' },
      },
    });

    await processUploadInteraction(command, env, { processThread, rest });

    assert.equal(processThread.mock.calls[0].arguments[0].actorName, 'Zikeman Server Nickname');
    assert.equal(postedBy, 'Zikeman Server Nickname');
  });

  it('normalizes decorative Discord display names before upload', async () => {
    let postedBy = '';
    const processThread = mock.fn(async (options) => {
      postedBy = await options.getMessageDisplayName(options.messages[0]);
      return { processedAttachments: 1, skippedAttachments: 0 };
    });
    const rest = {
      get: mock.fn(async (route) => {
        if (route.includes('/messages')) {
          return [{
            attachments: [{ filename: 'mark.csv', id: 'attachment-1' }],
            author: { global_name: '\u{1D440}\u{1D44E}\u{1D45F}\u{1D458}', id: 'user-mark', username: 'account-name' },
            id: 'message-1',
            member: { nick: null },
            timestamp: '2026-07-30T02:00:00Z',
          }];
        }
        if (route.includes('/members/user-mark')) return { nick: '\u{1D440}\u{1D44E}\u{1D45F}\u{1D458}' };
        return { id: 'thread-1', name: '02 CTA', parent_id: 'parent-1', type: 11 };
      }),
      patch: mock.fn(async () => ({})),
    };
    const command = interaction({
      member: {
        nick: '\u{1D440}\u{1D44E}\u{1D45F}\u{1D458}',
        roles: ['role-1'],
        user: { global_name: '\u{1D440}\u{1D44E}\u{1D45F}\u{1D458}', id: 'user-mark' },
      },
    });

    await processUploadInteraction(command, env, { processThread, rest });

    assert.equal(processThread.mock.calls[0].arguments[0].actorName, 'Mark');
    assert.equal(postedBy, 'Mark');
  });

  it('never substitutes the Discord account username for a server-visible name', async () => {
    let postedBy = '';
    const processThread = mock.fn(async (options) => {
      postedBy = await options.getMessageDisplayName(options.messages[0]);
      return { processedAttachments: 1, skippedAttachments: 0 };
    });
    const rest = {
      get: mock.fn(async (route) => {
        if (route.includes('/messages')) {
          return [{
            attachments: [{ filename: 'loot.csv', id: 'attachment-1' }],
            author: { global_name: null, id: 'user-1', username: 'ActualDiscordUsername' },
            id: 'message-1',
            member: { nick: null },
            timestamp: '2026-07-30T02:00:00Z',
          }];
        }
        if (route.includes('/members/user-1')) return { nick: null };
        return { id: 'thread-1', name: '02 CTA', parent_id: 'parent-1', type: 11 };
      }),
      patch: mock.fn(async () => ({})),
    };

    await processUploadInteraction(interaction({
      member: { nick: null, roles: ['role-1'], user: { id: 'user-1', username: 'ActualDiscordUsername' } },
    }), env, { processThread, rest });

    assert.equal(processThread.mock.calls[0].arguments[0].actorName, 'Unknown Server Member');
    assert.equal(postedBy, 'Unknown Server Member');
  });
});

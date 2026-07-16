import { REST } from '@discordjs/rest';
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  Routes,
} from 'discord-api-types/v10';
import { verifyKey } from 'discord-interactions';
import {
  DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
  processLootUploadThread,
} from '../discord/lootUploadCommand.js';

const DEFAULT_GUILD_ID = '805908199541702666';
const MAX_MESSAGES_PER_THREAD = 500;
const LOOT_LOG_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/loot-logs';
const MILITANT_APP_URL = 'https://elij91.github.io/Militant/';
const MILITANT_PREVIEW_IMAGE_URL = 'https://elij91.github.io/Militant/assets/militant-favicon.png';

function clean(value) {
  return String(value || '').trim();
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function handleLootLogShareRequest(request, dependencies = {}) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const requestUrl = new URL(request.url);
  const bundleId = clean(requestUrl.searchParams.get('bundle'));
  if (!bundleId) return new Response('Loot log not found.', { status: 404 });

  const apiUrl = new URL(LOOT_LOG_API_URL);
  apiUrl.searchParams.set('bundleId', bundleId);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const apiResponse = await fetchImpl(apiUrl);
  if (!apiResponse.ok) return new Response('Loot log not found.', { status: 404 });

  const payload = await apiResponse.json();
  const lootLogTitle = clean(payload?.bundle?.lootFileName) || 'Loot Log';
  const filterParams = new URLSearchParams(requestUrl.searchParams);
  filterParams.delete('bundle');
  const filterQuery = filterParams.toString();
  const targetUrl = new URL(MILITANT_APP_URL);
  targetUrl.hash = `shared-log/${encodeURIComponent(bundleId)}${filterQuery ? `?${filterQuery}` : ''}`;
  const safeTitle = escapeHtml(lootLogTitle);
  const safeTargetUrl = escapeHtml(targetUrl.toString());
  const safeRequestUrl = escapeHtml(requestUrl.toString());

  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${safeTitle}" />
    <meta property="og:site_name" content="Militant" />
    <meta property="og:title" content="Militant" />
    <meta property="og:description" content="${safeTitle}" />
    <meta property="og:image" content="${MILITANT_PREVIEW_IMAGE_URL}" />
    <meta property="og:image:alt" content="Militant bear head logo" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${safeRequestUrl}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Militant" />
    <meta name="twitter:description" content="${safeTitle}" />
    <meta name="twitter:image" content="${MILITANT_PREVIEW_IMAGE_URL}" />
    <meta http-equiv="refresh" content="0;url=${safeTargetUrl}" />
    <title>${safeTitle} | Militant</title>
  </head>
  <body>
    <p><a href="${safeTargetUrl}">Open ${safeTitle}</a></p>
    <script>window.location.replace(${JSON.stringify(targetUrl.toString())});</script>
  </body>
</html>`, {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: 200,
  });
}

function requiredEnv(env, key) {
  const value = clean(env?.[key]);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function bearerToken(request) {
  const authorization = clean(request.headers.get('authorization'));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? clean(match[1]) : '';
}

function formatMember(guildId, userId, member) {
  const guildNickname = clean(member?.nick || member?.user?.global_name || member?.user?.username);
  return {
    discordGuildId: guildId,
    discordUserId: userId,
    guildNickname,
    roleIds: Array.isArray(member?.roles) ? member.roles.map(String) : [],
    serverNickname: guildNickname,
  };
}

export async function handleMemberLookupRequest(request, env, dependencies = {}) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);
  const expectedSecret = requiredEnv(env, 'WEBAPP_MEMBER_LOOKUP_SECRET');
  if (bearerToken(request) !== expectedSecret) return jsonResponse({ error: 'Unauthorized.' }, 401);

  const body = await request.json().catch(() => ({}));
  const guildId = clean(body.guildId) || clean(env.DISCORD_GUILD_ID) || DEFAULT_GUILD_ID;
  const userId = clean(body.userId);
  if (guildId !== (clean(env.DISCORD_GUILD_ID) || DEFAULT_GUILD_ID)) {
    return jsonResponse({ error: 'Guild not allowed.' }, 403);
  }
  if (!/^\d{15,25}$/.test(userId)) return jsonResponse({ error: 'Invalid Discord user ID.' }, 400);

  const RestClass = dependencies.RestClass || REST;
  const rest = dependencies.rest || new RestClass({ version: '10' }).setToken(requiredEnv(env, 'DISCORD_BOT_TOKEN'));
  try {
    const member = await rest.get(Routes.guildMember(guildId, userId));
    return jsonResponse(formatMember(guildId, userId, member));
  } catch (error) {
    if (Number(error?.status) === 404) return jsonResponse({ error: 'Member not found.' }, 404);
    console.error('[militant-discord-interactions] Member lookup failed.', error);
    return jsonResponse({ error: 'Member lookup failed.' }, 502);
  }
}

async function fetchThreadMessages(rest, threadId) {
  const messages = [];
  let before = '';

  while (messages.length < MAX_MESSAGES_PER_THREAD) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, MAX_MESSAGES_PER_THREAD - messages.length)),
      ...(before ? { before } : {}),
    });
    const batch = await rest.get(Routes.channelMessages(threadId), { query });
    if (!Array.isArray(batch) || batch.length === 0) break;
    messages.push(...batch);
    before = clean(batch.at(-1)?.id);
    if (batch.length < 100) break;
  }

  return messages;
}

function createDisplayNameResolver(rest, guildId) {
  const memberNames = new Map();

  return async (message) => {
    const userId = clean(message?.author?.id);
    const inlineNickname = clean(message?.member?.nick || message?.member?.nickname);
    if (inlineNickname) return inlineNickname;
    if (!userId) return 'Unknown Server Member';
    if (memberNames.has(userId)) return memberNames.get(userId);

    try {
      const member = await rest.get(Routes.guildMember(guildId, userId));
      const nickname = clean(member?.nick) || 'Unknown Server Member';
      memberNames.set(userId, nickname);
      return nickname;
    } catch {
      memberNames.set(userId, 'Unknown Server Member');
      return 'Unknown Server Member';
    }
  };
}

function actorMember(interaction) {
  return {
    id: clean(interaction?.member?.user?.id || interaction?.user?.id),
    roles: Array.isArray(interaction?.member?.roles) ? interaction.member.roles.map(String) : [],
  };
}

async function actorNickname(rest, interaction) {
  const inlineNickname = clean(interaction?.member?.nick);
  if (inlineNickname) return inlineNickname;

  const guildId = clean(interaction?.guild_id);
  const userId = clean(interaction?.member?.user?.id || interaction?.user?.id);
  if (!guildId || !userId) return 'Unknown Server Member';

  try {
    const member = await rest.get(Routes.guildMember(guildId, userId));
    return clean(member?.nick) || 'Unknown Server Member';
  } catch {
    return 'Unknown Server Member';
  }
}

function resultMessage(result) {
  if (result?.forbidden) return 'You do not have permission to upload loot logs from Discord.';
  if (result?.ignored) return 'Use `/upload` inside a loot-log thread.';
  if (!result?.processedAttachments && !result?.skippedAttachments) {
    return 'No `.csv` loot logs were found in this thread.';
  }
  if (result?.skippedAttachments) {
    return `Uploaded ${result.processedAttachments || 0} loot log(s); ${result.skippedAttachments} failed.`;
  }
  return `Uploaded ${result.processedAttachments || 0} loot log(s) successfully.`;
}

async function editOriginalInteraction(rest, interaction, content) {
  await rest.patch(
    Routes.webhookMessage(interaction.application_id, interaction.token, '@original'),
    {
      auth: false,
      body: { allowed_mentions: { parse: [] }, content },
    },
  );
}

export async function processUploadInteraction(interaction, env, dependencies = {}) {
  const RestClass = dependencies.RestClass || REST;
  const processThread = dependencies.processThread || processLootUploadThread;
  const rest = dependencies.rest || new RestClass({ version: '10' }).setToken(requiredEnv(env, 'DISCORD_BOT_TOKEN'));
  const guildId = clean(env.DISCORD_GUILD_ID) || DEFAULT_GUILD_ID;
  const channelId = clean(env.DISCORD_LOOT_LOG_CHANNEL_ID) || DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID;

  try {
    if (clean(interaction.guild_id) !== guildId) {
      await editOriginalInteraction(rest, interaction, 'This command is not available in this server.');
      return;
    }

    const channel = await rest.get(Routes.channel(interaction.channel_id));
    const thread = {
      id: clean(channel?.id),
      name: clean(channel?.name),
      parentId: clean(channel?.parent_id),
      type: Number(channel?.type),
    };
    if (thread.parentId !== channelId) {
      await editOriginalInteraction(rest, interaction, 'Use `/upload` inside a loot-log thread.');
      return;
    }

    const messages = await fetchThreadMessages(rest, thread.id);
    const result = await processThread({
      actorMember: actorMember(interaction),
      actorName: await actorNickname(rest, interaction),
      getMessageDisplayName: createDisplayNameResolver(rest, guildId),
      messages,
      runtimeEnv: env,
      thread,
    });
    await editOriginalInteraction(rest, interaction, resultMessage(result));
  } catch (error) {
    console.error('[militant-discord-interactions] Upload command failed.', error);
    await editOriginalInteraction(rest, interaction, 'The upload failed. Please try again.').catch(() => {});
  }
}

export async function handleInteractionRequest(request, env, context, dependencies = {}) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === '/share/loot-log') {
    return handleLootLogShareRequest(request, dependencies);
  }
  if (requestUrl.pathname === '/webapp/member') {
    return handleMemberLookupRequest(request, env, dependencies);
  }
  if (request.method === 'GET') {
    return new Response('Militant Discord interactions are online.');
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const signature = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  const body = await request.text();
  const verify = dependencies.verify || verifyKey;
  const verified = await verify(body, signature, timestamp, requiredEnv(env, 'DISCORD_PUBLIC_KEY'));
  if (!verified) return new Response('Invalid request signature.', { status: 401 });

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON.', { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) {
    return jsonResponse({ type: InteractionResponseType.Pong });
  }
  if (interaction.type !== InteractionType.ApplicationCommand || interaction.data?.name !== 'upload') {
    return jsonResponse({
      data: { content: 'Unknown command.', flags: MessageFlags.Ephemeral },
      type: InteractionResponseType.ChannelMessageWithSource,
    });
  }

  context.waitUntil(processUploadInteraction(interaction, env, dependencies));
  return jsonResponse({
    data: {
      allowed_mentions: { parse: [] },
      content: 'Upload accepted. Processing loot logs...',
      flags: MessageFlags.Ephemeral,
    },
    type: InteractionResponseType.ChannelMessageWithSource,
  });
}

export default {
  fetch(request, env, context) {
    return handleInteractionRequest(request, env, context);
  },
};

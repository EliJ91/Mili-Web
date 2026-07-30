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

function normalizeDisplayName(value) {
  return clean(String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, ''));
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
  const guildNickname = normalizeDisplayName(member?.nick || member?.user?.global_name || member?.user?.username);
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

function createDisplayNameResolver() {
  return async (message) => {
    return normalizeDisplayName(
      message?.member?.nick
      || message?.member?.nickname
      || message?.author?.global_name,
    ) || 'Unknown Server Member';
  };
}

function actorMember(interaction) {
  return {
    id: clean(interaction?.member?.user?.id || interaction?.user?.id),
    roles: Array.isArray(interaction?.member?.roles) ? interaction.member.roles.map(String) : [],
  };
}

function commandOption(interaction, name) {
  return interaction?.data?.options?.find((option) => option?.name === name)?.value;
}

function actorNickname(interaction) {
  return normalizeDisplayName(
    interaction?.member?.nick
    || interaction?.member?.user?.global_name
    || interaction?.user?.global_name,
  ) || 'Unknown Server Member';
}

function fileList(files, limit = 8) {
  const names = (Array.isArray(files) ? files : [])
    .map((file) => clean(typeof file === 'string' ? file : file?.fileName).slice(0, 120))
    .filter(Boolean);
  if (names.length === 0) return '';
  const visible = names.slice(0, limit);
  return `${visible.join(', ')}${names.length > limit ? `, +${names.length - limit} more` : ''}`;
}

function failureList(files, limit = 5) {
  const failures = (Array.isArray(files) ? files : []).slice(0, limit).map((file) => {
    const name = clean(file?.fileName).slice(0, 100) || 'Unknown file';
    const reason = clean(file?.reason).slice(0, 160) || 'Upload failed.';
    return `${name} (${reason})`;
  });
  return `${failures.join('; ')}${files?.length > limit ? `; +${files.length - limit} more` : ''}`;
}

function resultMessage(result, { attempt = 1, retrying = false } = {}) {
  if (result?.forbidden) return 'You do not have permission to upload loot logs from Discord.';
  if (result?.ignored) return 'Use `/upload` inside a loot-log thread.';
  if (!result?.processedAttachments && !result?.skippedAttachments) {
    if (result?.previouslyProcessedAttachments) {
      return `No new loot logs were uploaded. Already processed: ${fileList(result.previouslyProcessedFiles) || `${result.previouslyProcessedAttachments} file(s)`}.`;
    }
    return 'No `.csv` loot logs were found in this thread.';
  }

  const lines = [];
  if (result?.processedAttachments) {
    lines.push(`Uploaded ${result.processedAttachments} loot log(s): ${fileList(result.processedFiles) || 'complete'}.`);
  }
  if (result?.previouslyProcessedAttachments) {
    lines.push(`Already processed ${result.previouslyProcessedAttachments}: ${fileList(result.previouslyProcessedFiles)}.`);
  }
  if (result?.skippedAttachments) {
    lines.push(`Failed ${result.skippedAttachments}: ${failureList(result.failedFiles)}.`);
    if (retrying) lines.push(`Retrying failed files automatically (attempt ${attempt} of 3).`);
    else if (attempt >= 3) lines.push('Upload stopped after 3 attempts. Run `/upload` again if the files are corrected.');
  }
  return lines.join('\n');
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
      return { accepted: false, ignored: true, processedAttachments: 0, skippedAttachments: 0 };
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
      return { accepted: false, ignored: true, processedAttachments: 0, skippedAttachments: 0 };
    }

    const messages = await fetchThreadMessages(rest, thread.id);
    const result = await processThread({
      actorMember: actorMember(interaction),
      actorName: actorNickname(interaction),
      ctaTimer: clean(commandOption(interaction, 'cta_timer')) || '00',
      getMessageDisplayName: createDisplayNameResolver(),
      messages,
      runtimeEnv: env,
      thread,
    });
    await editOriginalInteraction(rest, interaction, resultMessage(result, dependencies.resultMessageOptions));
    return result;
  } catch (error) {
    console.error('[militant-discord-interactions] Upload command failed.', error);
    await editOriginalInteraction(rest, interaction, 'The upload failed. Please try again.').catch(() => {});
    throw error;
  }
}

export async function handleUploadQueue(batch, env, dependencies = {}) {
  for (const message of batch.messages) {
    const interaction = message.body?.interaction;
    const attempt = Math.max(1, Number(message.attempts) || 1);

    try {
      const result = await processUploadInteraction(interaction, env, {
        ...dependencies,
        resultMessageOptions: { attempt, retrying: attempt < 3 },
      });
      if (result?.skippedAttachments) {
        if (attempt < 3) {
          const rest = dependencies.rest
            || new (dependencies.RestClass || REST)({ version: '10' }).setToken(requiredEnv(env, 'DISCORD_BOT_TOKEN'));
          await editOriginalInteraction(rest, interaction, resultMessage(result, { attempt, retrying: true }));
          message.retry({ delaySeconds: 5 });
        } else {
          message.ack();
        }
      } else {
        message.ack();
      }
    } catch (error) {
      if (attempt < 3) {
        const rest = dependencies.rest
          || new (dependencies.RestClass || REST)({ version: '10' }).setToken(requiredEnv(env, 'DISCORD_BOT_TOKEN'));
        await editOriginalInteraction(
          rest,
          interaction,
          `The upload hit an unexpected error. Retrying automatically (attempt ${attempt} of 3).`,
        ).catch(() => {});
        message.retry({ delaySeconds: 5 });
      } else {
        const rest = dependencies.rest
          || new (dependencies.RestClass || REST)({ version: '10' }).setToken(requiredEnv(env, 'DISCORD_BOT_TOKEN'));
        await editOriginalInteraction(
          rest,
          interaction,
          'The upload failed after 3 attempts. Run `/upload` again if the files are corrected.',
        ).catch(() => {});
        message.ack();
      }
    }
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

  if (env.LOOT_UPLOAD_QUEUE?.send) {
    await env.LOOT_UPLOAD_QUEUE.send({ interaction });
  } else {
    context.waitUntil(processUploadInteraction(interaction, env, dependencies));
  }
  return jsonResponse({
    data: {
      allowed_mentions: { parse: [] },
      content: env.LOOT_UPLOAD_QUEUE?.send
        ? 'Upload queued. Processing loot logs...'
        : 'Upload accepted. Processing loot logs...',
      flags: MessageFlags.Ephemeral,
    },
    type: InteractionResponseType.ChannelMessageWithSource,
  });
}

export default {
  fetch(request, env, context) {
    return handleInteractionRequest(request, env, context);
  },
  queue(batch, env) {
    return handleUploadQueue(batch, env);
  },
};

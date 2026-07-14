export const DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID = '1492400020958351391';

const DISCORD_UPLOAD_PERMISSION_KEY = 'uploadLootLogsFromDiscord';
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(['.csv']);
const SUPERUSER_DISCORD_USER_IDS = new Set(['264193431830528006']);
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

function clean(value) {
  return String(value || '').trim();
}

function requireSupabaseConfig(runtimeEnv = process.env) {
  const supabaseUrl = clean(runtimeEnv.SUPABASE_URL || runtimeEnv.VITE_SUPABASE_URL);
  const serviceRoleKey = clean(runtimeEnv.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Discord uploads.');
  }
  return { serviceRoleKey, supabaseUrl: supabaseUrl.replace(/\/+$/, '') };
}

function fileExtension(fileName) {
  const name = clean(fileName).toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex) : '';
}

export function isSupportedLogAttachment(attachment) {
  return SUPPORTED_ATTACHMENT_EXTENSIONS.has(fileExtension(attachment?.name));
}

function isTargetThread(thread, channelId) {
  return Boolean(
    thread?.id
    && thread?.parentId === channelId
    && THREAD_CHANNEL_TYPES.has(Number(thread.type)),
  );
}

function collectionToArray(value) {
  if (!value) return [];
  if (typeof value.values === 'function') return [...value.values()];
  return Array.isArray(value) ? value : [...value];
}

function messageTimestamp(message) {
  const raw = message?.createdTimestamp || message?.createdAt || message?.timestamp;
  const timestamp = typeof raw === 'number' ? raw : new Date(raw || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function collectLogAttachmentJobs(messages) {
  return (Array.isArray(messages) ? messages : [])
    .flatMap((message) => collectionToArray(message?.attachments)
      .filter(isSupportedLogAttachment)
      .map((attachment) => ({
        attachment,
        attachmentId: clean(attachment?.id),
        fileName: clean(attachment?.name),
        message,
        messageId: clean(message?.id),
        timestamp: messageTimestamp(message),
      })))
    .filter((job) => job.attachmentId && job.fileName && job.messageId)
    .sort((left, right) => (
      left.timestamp - right.timestamp
      || left.messageId.localeCompare(right.messageId)
      || left.attachmentId.localeCompare(right.attachmentId)
    ));
}

async function fetchAttachmentText(attachment) {
  const url = clean(attachment?.url || attachment?.proxyURL);
  if (!url) throw new Error('Attachment URL is missing.');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${attachment.name || 'attachment'} (${response.status}).`);
  }

  const size = Number(response.headers.get('content-length')) || 0;
  if (size > MAX_ATTACHMENT_BYTES) throw new Error(`${attachment.name || 'Attachment'} is too large.`);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${attachment.name || 'Attachment'} is too large.`);

  return new TextDecoder().decode(buffer);
}

async function supabaseRest(path, { body = null, method = 'GET', prefer = 'return=representation', runtimeEnv = process.env } = {}) {
  const { serviceRoleKey, supabaseUrl } = requireSupabaseConfig(runtimeEnv);
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    body: body ? JSON.stringify(body) : null,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    method,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST ${method} failed.`);
  }
  return data;
}

async function submitLootLog({ bundleId, lootLogText, originalFileName, runtimeEnv = process.env, username }) {
  const { serviceRoleKey, supabaseUrl } = requireSupabaseConfig(runtimeEnv);
  const response = await fetch(`${supabaseUrl}/functions/v1/loot-logs`, {
    body: JSON.stringify({
      bundleId,
      lootLogText,
      originalFileName,
      username,
    }),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not upload loot log.');
  return result;
}

async function recordActionLog({ actorName, bundleId, fileName, runtimeEnv = process.env, threadName, uploadedBy }) {
  try {
    await supabaseRest('webapp_action_logs', {
      body: {
        action: 'Loot log uploaded from Discord',
        actor_name: clean(actorName) || 'Unknown Server Member',
        details: { fileName, source: 'Discord thread', threadName, uploadedBy },
        target_id: bundleId || null,
        target_name: clean(threadName) || clean(fileName) || null,
        target_type: 'loot-log',
      },
      method: 'POST',
      runtimeEnv,
    });
  } catch (error) {
    console.warn('[mili-discord-worker] Could not record action log.', error.message || error);
  }
}

async function loadPermissionRoles(runtimeEnv = process.env) {
  const rows = await supabaseRest('webapp_permission_settings?id=eq.default&select=settings', { runtimeEnv });
  return Array.isArray(rows?.[0]?.settings?.roles) ? rows[0].settings.roles : [];
}

function getMemberRoleIds(member) {
  const roles = member?.roles;
  if (Array.isArray(roles)) return roles.map(String);
  if (roles?.cache && typeof roles.cache.keys === 'function') return [...roles.cache.keys()].map(String);
  return [];
}

export async function memberCanUploadLootLogsFromDiscord(member, runtimeEnv = process.env) {
  const userId = clean(member?.id || member?.user?.id);
  if (SUPERUSER_DISCORD_USER_IDS.has(userId)) return true;

  const memberRoleIds = new Set(getMemberRoleIds(member).map(clean).filter(Boolean));
  if (memberRoleIds.size === 0) return false;

  const roles = await loadPermissionRoles(runtimeEnv);
  return roles.some((role) => (
    memberRoleIds.has(clean(role?.roleId))
    && Boolean(role?.permissions?.[DISCORD_UPLOAD_PERMISSION_KEY])
  ));
}

async function loadThreadRecord(thread, runtimeEnv = process.env) {
  const rows = await supabaseRest(
    `discord_loot_threads?thread_id=eq.${encodeURIComponent(thread.id)}&select=thread_id,bundle_id`,
    { runtimeEnv },
  );
  return rows?.[0] || null;
}

async function saveThreadBundle(thread, bundleId, processedAttachmentIds = [], runtimeEnv = process.env) {
  const bundleRows = await supabaseRest(
    `loot_log_bundles?id=eq.${encodeURIComponent(bundleId)}&select=combined_loot_summary`,
    { runtimeEnv },
  );
  const currentSummary = bundleRows?.[0]?.combined_loot_summary || {};
  const nextSummary = {
    ...currentSummary,
    discordChannelId: thread.parentId,
    discordProcessedAttachmentIds: [
      ...new Set([
        ...(Array.isArray(currentSummary.discordProcessedAttachmentIds)
          ? currentSummary.discordProcessedAttachmentIds
          : []),
        ...processedAttachmentIds,
      ].map(clean).filter(Boolean)),
    ],
    discordThreadId: thread.id,
    discordThreadName: clean(thread.name),
  };

  await supabaseRest(`loot_log_bundles?id=eq.${encodeURIComponent(bundleId)}`, {
    body: { combined_loot_summary: nextSummary, updated_at: new Date().toISOString() },
    method: 'PATCH',
    runtimeEnv,
  });
  await supabaseRest('discord_loot_threads?on_conflict=thread_id', {
    body: {
      bundle_id: bundleId,
      channel_id: thread.parentId,
      thread_id: thread.id,
      thread_name: clean(thread.name),
      updated_at: new Date().toISOString(),
    },
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    runtimeEnv,
  });
}

async function markAttachmentProcessed({ bundleId, job, runtimeEnv = process.env, submittedBy, thread }) {
  await supabaseRest('discord_loot_attachments?on_conflict=attachment_id', {
    body: {
      attachment_id: job.attachmentId,
      bundle_id: bundleId,
      file_name: job.fileName,
      log_type: 'loot',
      message_id: job.messageId,
      submitted_by: submittedBy,
      thread_id: thread.id,
    },
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    runtimeEnv,
  });
}

export async function processLootUploadThread({
  actorMember,
  actorName = 'Unknown Server Member',
  fetchAttachmentTextFn = fetchAttachmentText,
  getMessageDisplayName = async () => 'Unknown Server Member',
  messages = [],
  runtimeEnv = process.env,
  thread,
} = {}) {
  const channelId = runtimeEnv.DISCORD_LOOT_LOG_CHANNEL_ID || DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID;
  if (!isTargetThread(thread, channelId)) {
    return { accepted: false, ignored: true, processedAttachments: 0, skippedAttachments: 0 };
  }

  if (!await memberCanUploadLootLogsFromDiscord(actorMember, runtimeEnv)) {
    return { accepted: false, forbidden: true, processedAttachments: 0, skippedAttachments: 0 };
  }

  const jobs = collectLogAttachmentJobs(messages);
  if (jobs.length === 0) {
    return { accepted: true, bundleId: null, processedAttachments: 0, skippedAttachments: 0 };
  }

  const threadRecord = await loadThreadRecord(thread, runtimeEnv);
  let bundleId = threadRecord?.bundle_id || null;
  let processedAttachments = 0;
  let skippedAttachments = 0;

  for (const job of jobs) {
    try {
      const lootLogText = await fetchAttachmentTextFn(job.attachment);
      const submittedBy = clean(await getMessageDisplayName(job.message)) || 'Unknown Server Member';
      const result = await submitLootLog({
        bundleId,
        lootLogText,
        originalFileName: clean(thread.name) || job.fileName,
        runtimeEnv,
        username: submittedBy,
      });
      bundleId = result.bundleId || bundleId;
      if (!bundleId) throw new Error('Upload did not return a bundle id.');

      await saveThreadBundle(thread, bundleId, [job.attachmentId], runtimeEnv);
      await markAttachmentProcessed({ bundleId, job, runtimeEnv, submittedBy, thread });
      await recordActionLog({
        actorName,
        bundleId,
        fileName: job.fileName,
        runtimeEnv,
        threadName: clean(thread.name),
        uploadedBy: submittedBy,
      });
      processedAttachments += 1;
    } catch (error) {
      skippedAttachments += 1;
      console.error(`[mili-discord-worker] Could not upload ${job.fileName}.`, error);
    }
  }

  return {
    accepted: skippedAttachments === 0,
    bundleId,
    processedAttachments,
    skippedAttachments,
  };
}

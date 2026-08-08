export const DEFAULT_BUILD_THREAD_CHANNEL_ID = '1492392003239936010';

const COMPONENT_TYPE_TEXT_DISPLAY = 10;
const COMPONENT_TYPE_SECTION = 9;
const COMPONENT_TYPE_THUMBNAIL = 11;
const COMPONENT_TYPE_MEDIA_GALLERY = 12;
const COMPONENT_TYPE_CONTAINER = 17;
const MAX_GALLERY_ITEMS = 10;

function clean(value) {
  return String(value || '').trim();
}

function requireSupabaseConfig(runtimeEnv = process.env) {
  const supabaseUrl = clean(runtimeEnv.SUPABASE_URL || runtimeEnv.VITE_SUPABASE_URL);
  const serviceRoleKey = clean(runtimeEnv.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for /build.');
  }
  return { serviceRoleKey, supabaseUrl: supabaseUrl.replace(/\/+$/, '') };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKeycapDigits(value) {
  return String(value || '')
    .replace(/0\uFE0F?\u20E3/g, '0')
    .replace(/1\uFE0F?\u20E3/g, '1')
    .replace(/2\uFE0F?\u20E3/g, '2')
    .replace(/3\uFE0F?\u20E3/g, '3')
    .replace(/4\uFE0F?\u20E3/g, '4')
    .replace(/5\uFE0F?\u20E3/g, '5')
    .replace(/6\uFE0F?\u20E3/g, '6')
    .replace(/7\uFE0F?\u20E3/g, '7')
    .replace(/8\uFE0F?\u20E3/g, '8')
    .replace(/9\uFE0F?\u20E3/g, '9');
}

function objectTextBlocks(value, blocks = []) {
  if (!value) return blocks;
  if (typeof value === 'string') {
    const text = clean(value);
    if (text && !/^https?:\/\//i.test(text)) blocks.push(text);
    return blocks;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => objectTextBlocks(entry, blocks));
    return blocks;
  }
  if (typeof value !== 'object') return blocks;

  const preferredKeys = ['content', 'title', 'description', 'name', 'value', 'label', 'placeholder'];
  const preferred = preferredKeys.map((key) => clean(value[key])).filter(Boolean);
  if (preferred.length) blocks.push(preferred.join('\n'));
  Object.entries(value).forEach(([key, entry]) => {
    if (!preferredKeys.includes(key) && !['attachments', 'author', 'user'].includes(key)) {
      objectTextBlocks(entry, blocks);
    }
  });
  return blocks;
}

function messageTimestamp(message) {
  const timestamp = new Date(message?.timestamp || message?.edited_timestamp || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function identityTokens(interaction) {
  const user = interaction?.member?.user || interaction?.user || {};
  return [
    clean(interaction?.member?.nick),
    clean(user.global_name),
    clean(user.username),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function lineContainsIdentity(line, userId, names) {
  if (userId && new RegExp(`<@!?${escapeRegExp(userId)}>`).test(line)) return true;
  return names.some((name) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(name)}([^\\p{L}\\p{N}_]|$)`, 'iu').test(line));
}

function rosterNumberFromLine(line) {
  const normalized = normalizeKeycapDigits(line);
  const labelled = normalized.match(/(?:build|slot|position|roster|number|#)\s*[:#-]?\s*(\d{1,3})\b/i);
  if (labelled) return labelled[1];
  const leading = normalized.match(/^\s*(?:[-*•]\s*)?(?:#\s*)?(\d{1,3})\s*(?:[.)\]|:\-]|\s+-\s+)/);
  if (leading) return leading[1];
  const numbers = [...normalized.matchAll(/(?:^|\D)(\d{1,3})(?=\D|$)/g)].map((match) => match[1]);
  return numbers.length === 1 ? numbers[0] : '';
}

function rosterNumberFromBlock(block, userId, names) {
  const normalized = normalizeKeycapDigits(block);
  const lines = normalized.split(/\r?\n/).map(clean).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lineContainsIdentity(lines[index], userId, names)) continue;
    const sameLine = rosterNumberFromLine(lines[index]);
    if (sameLine) return sameLine;
    const adjacent = [lines[index - 1], lines[index + 1]].filter(Boolean);
    for (const line of adjacent) {
      const number = rosterNumberFromLine(line);
      if (number) return number;
    }
  }
  return '';
}

function orderedSignupRosterNumber(message, userId, names) {
  const blocks = [...objectTextBlocks(message?.embeds), ...objectTextBlocks(message?.components)];
  if (blocks.length === 0) return '';

  const normalized = normalizeKeycapDigits(blocks.join('\n'));
  const partyMatch = normalized.match(/\bParty\s+(\d{1,2})\b/i);
  const partyNumber = Math.max(1, Number(partyMatch?.[1]) || 1);
  const lines = normalized.split(/\r?\n/).map(clean).filter(Boolean);
  let roleGroup = 0;
  let assignmentIndex = 0;

  for (const line of lines) {
    if (/\bLoot\s+Loggers?\b/i.test(line)) {
      roleGroup = 0;
      assignmentIndex = 0;
      continue;
    }

    const groupMatch = line.match(/^Roles?\s+(\d{1,2})\b/i);
    if (groupMatch) {
      roleGroup = Number(groupMatch[1]);
      assignmentIndex = 0;
      continue;
    }
    if (!roleGroup || !/[—–-]\s*(?:<@!?\d+>|@|Empty\b)/i.test(line)) continue;

    assignmentIndex += 1;
    if (!lineContainsIdentity(line, userId, names)) continue;
    return String(((partyNumber - 1) * 20) + ((roleGroup - 1) * 10) + assignmentIndex);
  }

  return '';
}

export function findSignupRosterNumber(messages, interaction) {
  const userId = clean(interaction?.member?.user?.id || interaction?.user?.id);
  const names = identityTokens(interaction);
  const orderedMessages = [...(Array.isArray(messages) ? messages : [])]
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left));

  for (const message of orderedMessages) {
    const number = orderedSignupRosterNumber(message, userId, names);
    if (number) return number;
  }

  for (const message of orderedMessages) {
    const blocks = [clean(message?.content), ...objectTextBlocks(message?.embeds), ...objectTextBlocks(message?.components)]
      .filter((block) => block && !/\bLoot\s+Loggers?\b/i.test(block));
    for (const block of blocks) {
      const number = rosterNumberFromBlock(block, userId, names);
      if (number) return number;
    }
  }
  return '';
}

function buildNumbers(build) {
  return [
    ...(Array.isArray(build?.buildNumbers) ? build.buildNumbers : []),
    build?.number,
  ].flatMap((value) => clean(value).match(/\d+/g) || []);
}

export function findBuildForRosterNumber(layout, rosterNumber) {
  const target = String(Number(rosterNumber));
  if (!target || target === 'NaN') return null;
  return (Array.isArray(layout?.builds) ? layout.builds : [])
    .find((build) => buildNumbers(build).some((number) => String(Number(number)) === target)) || null;
}

export async function loadLatestZvZBuildLayout(runtimeEnv = process.env, fetchImpl = fetch) {
  const { serviceRoleKey, supabaseUrl } = requireSupabaseConfig(runtimeEnv);
  const query = new URLSearchParams({
    limit: '1',
    order: 'updated_at.desc',
    select: 'id,title,builds,updated_at',
  });
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/zvz_build_layouts?${query}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || 'Could not load the current ZVZ build layout.');
  return Array.isArray(data) ? data[0] || null : null;
}

function itemDescription(item) {
  const name = clean(item?.name || item?.lookupName || item?.itemId) || 'Build item';
  const annotation = clean(item?.annotation);
  return `${name}${annotation ? ` ${annotation}` : ''}`.slice(0, 1024);
}

function compactItemImageUrl(value) {
  const imageUrl = clean(value);
  try {
    const url = new URL(imageUrl);
    if (url.hostname === 'render.albiononline.com') {
      url.searchParams.set('size', '128');
    } else if (url.hostname === 'images.weserv.nl') {
      const sourceValue = clean(url.searchParams.get('url'));
      if (sourceValue) {
        const sourceUrl = new URL(/^https?:\/\//i.test(sourceValue) ? sourceValue : `https://${sourceValue}`);
        if (sourceUrl.hostname === 'render.albiononline.com') sourceUrl.searchParams.set('size', '128');
        url.searchParams.set('url', sourceUrl.toString().replace(/^https?:\/\//i, ''));
      }
    }
    return url.toString();
  } catch {
    return imageUrl;
  }
}

function slotGallery(items) {
  const galleryItems = (Array.isArray(items) ? items : [])
    .filter((item) => /^https:\/\//i.test(clean(item?.imageUrl)))
    .slice(0, MAX_GALLERY_ITEMS)
    .map((item) => ({
      description: itemDescription(item),
      media: { url: compactItemImageUrl(item.imageUrl) },
    }));
  return galleryItems.length ? { items: galleryItems, type: COMPONENT_TYPE_MEDIA_GALLERY } : null;
}

function slotCaption(items) {
  const captions = (Array.isArray(items) ? items : [])
    .filter((item) => /^https:\/\//i.test(clean(item?.imageUrl)))
    .slice(0, MAX_GALLERY_ITEMS)
    .map((item) => `**${itemDescription(item)}**`);
  return captions.length ? { content: captions.join('  |  '), type: COMPONENT_TYPE_TEXT_DISPLAY } : null;
}

function slotComponents(items) {
  const visibleItems = (Array.isArray(items) ? items : [])
    .filter((item) => /^https:\/\//i.test(clean(item?.imageUrl)))
    .slice(0, MAX_GALLERY_ITEMS);
  if (visibleItems.length === 1) {
    const [item] = visibleItems;
    return [{
      accessory: {
        description: itemDescription(item),
        media: { url: compactItemImageUrl(item.imageUrl) },
        type: COMPONENT_TYPE_THUMBNAIL,
      },
      components: [{ content: `**${itemDescription(item)}**`, type: COMPONENT_TYPE_TEXT_DISPLAY }],
      type: COMPONENT_TYPE_SECTION,
    }];
  }

  const gallery = slotGallery(visibleItems);
  const caption = slotCaption(visibleItems);
  return gallery && caption ? [gallery, caption] : [];
}

function weaponName(build) {
  const names = [...(build?.slots?.mainHand || []), ...(build?.slots?.offHand || [])]
    .map((item) => clean(item?.name || item?.lookupName))
    .filter(Boolean);
  return names.length === 1 ? names[0] : names.length > 1 ? 'Choose' : 'Unknown';
}

export function createBuildResponsePayload(build, rosterNumber) {
  const slots = build?.slots || {};
  const rows = [
    [...(slots.mainHand || []), ...(slots.offHand || [])],
    slots.helm,
    slots.armor,
    slots.boots,
    slots.cape,
    slots.foodPots,
  ];
  const itemRows = rows.flatMap(slotComponents);
  if (itemRows.length === 0) return null;

  const notes = clean(build?.notes);
  const noteComponent = notes
    ? [{ content: `**Notes**\n${notes}`.slice(0, 4000), type: COMPONENT_TYPE_TEXT_DISPLAY }]
    : [];

  return {
    allowed_mentions: { parse: [] },
    components: [{
      accent_color: 0x42df75,
      components: [{
        content: `### Build #${clean(rosterNumber)}\n**Weapon:** ${weaponName(build)}  \n**Role:** ${clean(build?.role) || 'Unknown'}`,
        type: COMPONENT_TYPE_TEXT_DISPLAY,
      }, ...itemRows, ...noteComponent],
      type: COMPONENT_TYPE_CONTAINER,
    }],
  };
}

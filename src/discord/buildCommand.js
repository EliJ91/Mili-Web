export const DEFAULT_BUILD_THREAD_CHANNEL_ID = '1492392003239936010';

const COMPONENT_TYPE_TEXT_DISPLAY = 10;
const COMPONENT_TYPE_MEDIA_GALLERY = 12;
const COMPONENT_TYPE_CONTAINER = 17;
const MAX_GALLERY_ITEMS = 10;
const BUILD_IMAGE_ENDPOINT = 'https://militant-discord-interactions.ejjernigan.workers.dev/build-items';
const BUILD_ITEM_NAME_IDS = new Map([
  ['chariot', 'UNIQUE_MOUNT_TOWER_CHARIOT_CRYSTAL'],
  ['crystal tower chariot', 'UNIQUE_MOUNT_TOWER_CHARIOT_CRYSTAL'],
  ['hideout construction kit', 'UNIQUE_HIDEOUT'],
  ['hideout kit', 'UNIQUE_HIDEOUT'],
]);

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
  const timestamps = [message?.timestamp, message?.edited_timestamp]
    .map((value) => new Date(value || 0).getTime())
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
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

  let partyNumber = 1;
  let roleGroup = 0;
  let assignmentIndex = 0;

  for (const block of blocks) {
    const lines = normalizeKeycapDigits(block).split(/\r?\n/).map(clean).filter(Boolean);
    for (const line of lines) {
      const partyMatch = line.match(/\bParty\s+(\d{1,2})\b/i);
      if (partyMatch) {
        partyNumber = Math.max(1, Number(partyMatch[1]) || 1);
        roleGroup = 0;
        assignmentIndex = 0;
      }

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
  const name = clean(item?.lookupName || item?.name || item?.itemId) || 'Build item';
  const annotation = annotationText(item?.annotation);
  return `${name}${annotation ? ` ${annotation}` : ''}`.slice(0, 1024);
}

function itemName(item) {
  return clean(item?.lookupName || item?.name || item?.itemId) || 'Build item';
}

function annotationText(value) {
  return clean(value).replace(/^\((.*)\)$/, '$1').trim();
}

function itemLabel(item) {
  const quantity = Number(item?.quantity) || 1;
  return `${itemName(item)}${quantity > 1 ? ` x${quantity}` : ''}`;
}

function uniqueCleanValues(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function normalizedItemName(value) {
  return clean(value).replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function resolvedItemId(item) {
  const savedItemId = clean(item?.itemId);
  if (savedItemId) return savedItemId;

  const savedUrl = clean(item?.imageUrl);
  if (/^https:\/\//i.test(savedUrl)) {
    try {
      const url = new URL(savedUrl);
      const sourceValue = url.hostname === 'images.weserv.nl' ? clean(url.searchParams.get('url')) : savedUrl;
      const sourceUrl = new URL(/^https?:\/\//i.test(sourceValue) ? sourceValue : `https://${sourceValue}`);
      const match = decodeURIComponent(sourceUrl.pathname).match(/\/item\/([^/]+?)\.png$/i);
      if (match) return match[1];
    } catch {
      // Fall through to the name lookup.
    }
  }

  return BUILD_ITEM_NAME_IDS.get(normalizedItemName(item?.lookupName || item?.name)) || '';
}

function resolvedItemImageUrl(item) {
  const savedUrl = clean(item?.imageUrl);
  if (/^https:\/\//i.test(savedUrl)) return savedUrl;

  const itemId = resolvedItemId(item);
  if (!itemId) return '';
  const imagePath = `${itemId}.png?count=1&quality=1&size=160`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(`render.albiononline.com/v1/item/${imagePath}`)}`;
}

function buildStripImageUrl(items) {
  const itemIds = (Array.isArray(items) ? items : []).map(resolvedItemId).filter(Boolean);
  if (itemIds.length === 0) return '';
  const url = new URL(BUILD_IMAGE_ENDPOINT);
  url.searchParams.set('items', itemIds.join(','));
  return url.toString();
}

function slotGallery(items) {
  const visibleItems = (Array.isArray(items) ? items : [])
    .filter((item) => resolvedItemImageUrl(item))
    .slice(0, MAX_GALLERY_ITEMS);
  const imageUrl = buildStripImageUrl(visibleItems);
  return imageUrl ? {
    items: [{
      description: visibleItems.map(itemName).join(' | ').slice(0, 1024),
      media: { url: imageUrl },
    }],
    type: COMPONENT_TYPE_MEDIA_GALLERY,
  } : null;
}

function compactGalleryComponents(rows) {
  const visibleItems = (Array.isArray(rows) ? rows.flat() : [])
    .filter((item) => resolvedItemImageUrl(item));
  const components = [];
  for (let index = 0; index < visibleItems.length; index += MAX_GALLERY_ITEMS) {
    const chunk = visibleItems.slice(index, index + MAX_GALLERY_ITEMS);
    const gallery = slotGallery(chunk);
    if (gallery) components.push(gallery);
  }
  return components;
}

function slotLine(label, items) {
  const sourceItems = (Array.isArray(items) ? items : []).filter((item) => itemName(item));
  if (sourceItems.length === 0) return '';

  const labels = sourceItems.map(itemLabel);
  const annotations = uniqueCleanValues(sourceItems.map((item) => annotationText(item?.annotation)));
  if (annotations.length === 0) return `${label}: ${labels.join(' / ')}`;

  if (
    annotations.length === 1
    && sourceItems.every((item) => annotationText(item?.annotation) === annotations[0])
  ) {
    return sourceItems.length === 1
      ? `${label}: ${labels[0]} ${annotations[0]}`
      : `${label}: ${labels.join(' / ')}\n${annotations[0]}`;
  }

  return `${label}: ${sourceItems.map(itemDescription).join(' / ')}`;
}

function buildSummaryContent(build, rosterNumber) {
  const slots = build?.slots || {};
  const lines = [
    `Build #${clean(rosterNumber)}`,
    '',
    slotLine('Main Hand', slots.mainHand),
    slotLine('Off Hand', slots.offHand),
    slotLine('Helmet', slots.helm),
    slotLine('Armor', slots.armor),
    slotLine('Boots', slots.boots),
    slotLine('Cape', slots.cape),
    slotLine('Food/Pots', slots.foodPots),
  ].filter((line, index) => index < 2 || line);

  return lines.join('\n').slice(0, 4000);
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
  const itemRows = compactGalleryComponents(rows);
  if (itemRows.length === 0) return null;

  return {
    allowed_mentions: { parse: [] },
    components: [{
      accent_color: 0x42df75,
      components: [{
        content: buildSummaryContent(build, rosterNumber),
        type: COMPONENT_TYPE_TEXT_DISPLAY,
      }, ...itemRows],
      type: COMPONENT_TYPE_CONTAINER,
    }],
  };
}

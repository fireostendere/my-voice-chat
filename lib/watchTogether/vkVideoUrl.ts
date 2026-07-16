const VK_VIDEO_HOSTS = new Set([
  'vk.com',
  'www.vk.com',
  'm.vk.com',
  'vk.ru',
  'www.vk.ru',
  'm.vk.ru',
  'vkvideo.ru',
  'www.vkvideo.ru',
  'm.vkvideo.ru',
]);

const VK_ID_PART = '[1-9]\\d{0,18}';
const VK_ACCESS_KEY_PART = '[A-Za-z0-9_-]{1,128}';
const VK_SOURCE_RE = new RegExp(`^(-?${VK_ID_PART})_(${VK_ID_PART})(?:_(${VK_ACCESS_KEY_PART}))?$`);
const VK_PAGE_PATH_RE = new RegExp(
  `^/(?:video|clip)(-?${VK_ID_PART})_(${VK_ID_PART})(?:_(${VK_ACCESS_KEY_PART}))?/?$`,
  'i',
);
const VK_LAYER_RE = new RegExp(
  `^/?(?:video|clip)(-?${VK_ID_PART})_(${VK_ID_PART})(?:_(${VK_ACCESS_KEY_PART}))?(?:/|$)`,
  'i',
);

export type VkVideoIdentity = {
  ownerId: string;
  videoId: string;
  accessKey?: string;
};

export function isVkVideoHost(hostname: string): boolean {
  return VK_VIDEO_HOSTS.has(hostname.toLowerCase());
}

/**
 * Extracts a VK video identity from an already parsed, allowlisted VK URL.
 * The caller must never place the input URL itself in an iframe.
 */
export function parseVkVideoUrl(url: URL): string | null {
  if (
    !isVkVideoHost(url.hostname) ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  if (url.pathname.toLowerCase() === '/video_ext.php') {
    const ownerId = uniqueQueryValue(url, 'oid');
    const videoId = uniqueQueryValue(url, 'id');
    const accessKey = optionalAccessKey(url);
    if (
      !ownerId ||
      !videoId ||
      accessKey === undefined ||
      !new RegExp(`^-?${VK_ID_PART}$`).test(ownerId) ||
      !new RegExp(`^${VK_ID_PART}$`).test(videoId)
    ) {
      return null;
    }
    return serializeVkVideoSource({ ownerId, videoId, accessKey: accessKey || undefined });
  }

  const identities: VkVideoIdentity[] = [];
  const pathMatch = VK_PAGE_PATH_RE.exec(url.pathname);
  if (pathMatch) identities.push(identityFromMatch(pathMatch));

  const layer = uniqueQueryValue(url, 'z');
  if (layer === undefined) return null;
  if (layer) {
    const layerMatch = VK_LAYER_RE.exec(layer);
    if (layerMatch) identities.push(identityFromMatch(layerMatch));
  }

  if (identities.length === 0) return null;
  const first = identities[0];
  if (
    identities.some(
      (identity) =>
        identity.ownerId !== first.ownerId ||
        identity.videoId !== first.videoId ||
        (identity.accessKey && first.accessKey && identity.accessKey !== first.accessKey),
    )
  ) {
    return null;
  }

  const queryAccessKey = optionalAccessKey(url);
  if (queryAccessKey === undefined) return null;
  const embeddedAccessKeys = identities
    .map((identity) => identity.accessKey)
    .filter((value): value is string => Boolean(value));
  const accessKeys = new Set(
    queryAccessKey ? [...embeddedAccessKeys, queryAccessKey] : embeddedAccessKeys,
  );
  if (accessKeys.size > 1) return null;

  return serializeVkVideoSource({
    ownerId: first.ownerId,
    videoId: first.videoId,
    accessKey: accessKeys.values().next().value,
  });
}

export function parseVkVideoSource(source: string): VkVideoIdentity | null {
  const match = VK_SOURCE_RE.exec(source);
  if (!match) return null;
  return {
    ownerId: match[1],
    videoId: match[2],
    accessKey: match[3] || undefined,
  };
}

export function isVkVideoSource(source: string): boolean {
  return parseVkVideoSource(source) !== null;
}

export function buildVkEmbedUrl(source: string, parentOrigin?: string): string | null {
  const identity = parseVkVideoSource(source);
  if (!identity) return null;

  const embed = new URL('https://vk.ru/video_ext.php');
  embed.searchParams.set('oid', identity.ownerId);
  embed.searchParams.set('id', identity.videoId);
  if (identity.accessKey) embed.searchParams.set('hash', identity.accessKey);
  embed.searchParams.set('js_api', '1');

  const normalizedOrigin = normalizeParentOrigin(parentOrigin);
  if (normalizedOrigin) embed.searchParams.set('origin', normalizedOrigin);
  return embed.toString();
}

function serializeVkVideoSource(identity: VkVideoIdentity): string {
  return `${identity.ownerId}_${identity.videoId}${identity.accessKey ? `_${identity.accessKey}` : ''}`;
}

function identityFromMatch(match: RegExpExecArray): VkVideoIdentity {
  return {
    ownerId: match[1],
    videoId: match[2],
    accessKey: match[3] || undefined,
  };
}

function uniqueQueryValue(url: URL, name: string): string | null | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) return undefined;
  return values[0] ?? null;
}

function optionalAccessKey(url: URL): string | null | undefined {
  const hash = uniqueQueryValue(url, 'hash');
  const accessKey = uniqueQueryValue(url, 'access_key');
  if (hash === undefined || accessKey === undefined) return undefined;
  if (hash && accessKey && hash !== accessKey) return undefined;
  const value = hash || accessKey;
  if (!value) return null;
  return new RegExp(`^${VK_ACCESS_KEY_PART}$`).test(value) ? value : undefined;
}

function normalizeParentOrigin(origin: string | undefined): string | null {
  if (!origin || origin === 'null') return null;
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== origin
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

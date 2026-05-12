export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export const SHORT_READ_CACHE_TTL_MS = 5 * 1000;

export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${key}:${String(params[key] ?? '')}`)
    .join('|');
  return `${prefix}|${normalized}`;
}

export function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearCacheByPrefix<T>(cache: Map<string, CacheEntry<T>>, prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

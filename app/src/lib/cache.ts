// src/lib/cache.ts
type CacheEntry<T> = {
  exp: number;
  value: T;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();

export async function cachedWithTtl<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.exp > now) {
    return hit.value;
  }

  const value = await loader();
  memoryCache.set(key, { exp: now + Math.max(0, ttlMs), value });
  return value;
}

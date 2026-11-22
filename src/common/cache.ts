import Redis from 'ioredis';
import { cacheLookupsTotal } from '../telemetry/metrics.js';

/**
 * Cache-aside helper with in-process single-flight coalescing to prevent cache stampedes.
 */
export class StampedeSafeCache {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: Redis) {}

  async getOrSet<T>(
    cacheName: string,
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const existingPromise = this.inFlight.get(key) as Promise<T> | undefined;
    if (existingPromise) {
      cacheLookupsTotal.inc({ cache_name: cacheName, result: 'coalesced' });
      return existingPromise;
    }

    const cached = await this.redis.get(key);
    if (cached !== null) {
      cacheLookupsTotal.inc({ cache_name: cacheName, result: 'hit' });
      return JSON.parse(cached) as T;
    }

    cacheLookupsTotal.inc({ cache_name: cacheName, result: 'miss' });

    const pendingPromise = this.inFlight.get(key) as Promise<T> | undefined;
    if (pendingPromise) {
      cacheLookupsTotal.inc({ cache_name: cacheName, result: 'coalesced' });
      return pendingPromise;
    }

    const promise = (async () => {
      try {
        const value = await loader();
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

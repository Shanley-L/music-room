import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let redisClient = null;
let isRedisAvailable = false;
const memoryBlacklist = new Set();

try {
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null; // stop reconnecting if down
      return Math.min(times * 100, 1000);
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => {
    isRedisAvailable = true;
    console.log('[Redis] Connected to Redis');
  });

  redisClient.on('error', (err) => {
    isRedisAvailable = false;
    // Suppress spammy connection errors
  });

  redisClient.connect().catch(() => {
    isRedisAvailable = false;
  });
} catch (e) {
  isRedisAvailable = false;
}

export async function blacklistToken(token, expiresInSeconds = 3600) {
  if (isRedisAvailable && redisClient) {
    try {
      await redisClient.set(`blacklist:${token}`, '1', 'EX', expiresInSeconds);
      return;
    } catch (e) {
      // Fallback to memory
    }
  }
  memoryBlacklist.add(token);
  setTimeout(() => memoryBlacklist.delete(token), expiresInSeconds * 1000);
}

export async function isTokenBlacklisted(token) {
  if (isRedisAvailable && redisClient) {
    try {
      const res = await redisClient.get(`blacklist:${token}`);
      return res !== null;
    } catch (e) {
      // Fallback to memory
    }
  }
  return memoryBlacklist.has(token);
}

export default redisClient;

// Failed-attempt counters (one-time codes). Redis when available, memory otherwise.
const memoryAttempts = new Map();

/** Increments the counter `key` (expires `ttlSeconds` after its first hit) and returns it. */
export async function incrementAttempts(key, ttlSeconds = 3600) {
  if (isRedisAvailable && redisClient) {
    try {
      const count = await redisClient.incr(`attempts:${key}`);
      if (count === 1) await redisClient.expire(`attempts:${key}`, ttlSeconds);
      return count;
    } catch (e) {
      // Fallback to memory
    }
  }
  const now = Date.now();
  const entry = memoryAttempts.get(key);
  if (!entry || entry.expiresAt <= now) {
    memoryAttempts.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

export async function clearAttempts(key) {
  memoryAttempts.delete(key);
  if (isRedisAvailable && redisClient) {
    try {
      await redisClient.del(`attempts:${key}`);
    } catch (e) {
      // ignore
    }
  }
}

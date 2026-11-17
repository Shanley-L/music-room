import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));

// Auto-connect on boot
(async () => {
  try {
    await redisClient.connect();
    console.log('🔴 Connected to Redis successfully');
  } catch (e) {
    console.error('Failed to connect to Redis:', e);
  }
})();

export default redisClient;
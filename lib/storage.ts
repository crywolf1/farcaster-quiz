// Persistent storage using Redis (node-redis client)
import { createClient, RedisClientType } from 'redis';
import { GameRoom, Player } from './types';

// Lazy initialization of Redis client
let redis: RedisClientType | null = null;
let isConnecting = false;
let isConnected = false;

function getRedisClient(): RedisClientType {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set');
    }

    console.log('[Storage] Creating Redis client...');
    
    redis = createClient({
      url: redisUrl,
    }) as RedisClientType;

    // Handle connection errors
    redis.on('error', (err) => console.error('[Storage] Redis Client Error:', err));
  }
  
  return redis;
}

async function ensureConnected() {
  const client = getRedisClient();
  
  if (isConnected) return;
  if (isConnecting) {
    // Wait for connection
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  
  isConnecting = true;
  try {
    await client.connect();
    isConnected = true;
    console.log('[Storage] Redis connected');
  } catch (error) {
    console.error('[Storage] Failed to connect to Redis:', error);
    throw error;
  } finally {
    isConnecting = false;
  }
}

// Helper to serialize Maps and Sets to JSON
function serialize(value: any): string {
  return JSON.stringify(value, (key, val) => {
    if (val instanceof Map) {
      return {
        __type: 'Map',
        value: Array.from(val.entries()),
      };
    }
    if (val instanceof Set) {
      return {
        __type: 'Set',
        value: Array.from(val),
      };
    }
    return val;
  });
}

// Helper to deserialize Maps and Sets from JSON
function deserialize<T>(str: string): T {
  return JSON.parse(str, (key, val) => {
    if (val && typeof val === 'object') {
      if (val.__type === 'Map') {
        return new Map(val.value);
      }
      if (val.__type === 'Set') {
        return new Set(val.value);
      }
    }
    return val;
  });
}

// Wrapper object to match @vercel/kv interface
const kv = {
  async get<T>(key: string): Promise<T | null> {
    await ensureConnected();
    const client = getRedisClient();
    const value = await client.get(key);
    if (!value) return null;
    const stringValue = typeof value === 'string' ? value : value.toString();
    return deserialize<T>(stringValue);
  },

  async set(key: string, value: any, options?: { ex?: number }): Promise<void> {
    await ensureConnected();
    const client = getRedisClient();
    const serialized = serialize(value);
    if (options?.ex) {
      await client.setEx(key, options.ex, serialized);
    } else {
      await client.set(key, serialized);
    }
  },

  async del(key: string): Promise<void> {
    await ensureConnected();
    const client = getRedisClient();
    await client.del(key);
  },

  async keys(pattern: string): Promise<string[]> {
    await ensureConnected();
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    return keys as string[];
  },
};

const MATCHMAKING_QUEUE_KEY = 'matchmaking:queue';
const GAME_ROOM_PREFIX = 'game:room:';
const PLAYER_TO_ROOM_PREFIX = 'player:room:';

// Matchmaking Queue
export async function getMatchmakingQueue(): Promise<Player[]> {
  const queue = await kv.get<Player[]>(MATCHMAKING_QUEUE_KEY);
  return queue || [];
}

export async function setMatchmakingQueue(queue: Player[]): Promise<void> {
  await kv.set(MATCHMAKING_QUEUE_KEY, queue);
}

export async function addToQueue(player: Player): Promise<void> {
  const queue = await getMatchmakingQueue();
  queue.push(player);
  await setMatchmakingQueue(queue);
}

export async function removeFromQueue(count: number): Promise<Player[]> {
  const queue = await getMatchmakingQueue();
  const removed = queue.splice(0, count);
  await setMatchmakingQueue(queue);
  return removed;
}

// Game Rooms
export async function getGameRoom(roomId: string): Promise<GameRoom | null> {
  return await kv.get<GameRoom>(`${GAME_ROOM_PREFIX}${roomId}`);
}

export async function setGameRoom(roomId: string, room: GameRoom): Promise<void> {
  // Store with 1 hour expiry
  await kv.set(`${GAME_ROOM_PREFIX}${roomId}`, room, { ex: 3600 });
}

export async function deleteGameRoom(roomId: string): Promise<void> {
  await kv.del(`${GAME_ROOM_PREFIX}${roomId}`);
}

// Player to Room mapping
export async function getPlayerRoom(playerId: string): Promise<string | null> {
  return await kv.get<string>(`${PLAYER_TO_ROOM_PREFIX}${playerId}`);
}

export async function setPlayerRoom(playerId: string, roomId: string): Promise<void> {
  // Store with 1 hour expiry
  await kv.set(`${PLAYER_TO_ROOM_PREFIX}${playerId}`, roomId, { ex: 3600 });
}

export async function deletePlayerRoom(playerId: string): Promise<void> {
  await kv.del(`${PLAYER_TO_ROOM_PREFIX}${playerId}`);
}

// Get all rooms (for debugging)
export async function getAllRoomIds(): Promise<string[]> {
  const keys = await kv.keys(`${GAME_ROOM_PREFIX}*`);
  return keys.map(key => key.replace(GAME_ROOM_PREFIX, ''));
}

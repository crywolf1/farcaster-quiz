// Persistent storage using Vercel KV  
// Support multiple connection methods: REST API (KV_*) or direct connection (REDIS_URL)
import { createClient, kv as defaultKv } from '@vercel/kv';
import { GameRoom, Player } from './types';

let kv: ReturnType<typeof createClient>;

// Check if we have REST API credentials (standard Vercel KV setup)
const storageUrl = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
const storageToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;

if (storageUrl && storageToken) {
  // Use REST API with custom client
  console.log('[Storage] Using REST API with custom client');
  kv = createClient({
    url: storageUrl,
    token: storageToken,
  });
} else if (process.env.REDIS_URL) {
  // Use REDIS_URL with default client (automatically configured by @vercel/kv)
  console.log('[Storage] Using REDIS_URL with default client');
  kv = createClient({
    url: process.env.REDIS_URL,
    token: '', // Token is included in REDIS_URL
  });
} else if (process.env.KV_URL) {
  // Try KV_URL as fallback
  console.log('[Storage] Using KV_URL with default client');
  kv = defaultKv;
} else {
  console.error('[Storage] Missing Redis credentials:', {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    STORAGE_REST_API_URL: !!process.env.STORAGE_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    STORAGE_REST_API_TOKEN: !!process.env.STORAGE_REST_API_TOKEN,
    REDIS_URL: !!process.env.REDIS_URL,
    KV_URL: !!process.env.KV_URL,
  });
  throw new Error('Missing Vercel KV environment variables - Please connect your Vercel KV database to this project');
}

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

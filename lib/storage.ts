// Persistent storage using Vercel KV  
// Vercel KV creates KV_ prefixed env vars by default
// Try both STORAGE_ (custom) and KV_ (default) prefixes
import { createClient } from '@vercel/kv';
import { GameRoom, Player } from './types';

// Try KV_ prefix first (Vercel default), then STORAGE_ (custom)
const storageUrl = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
const storageToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;

if (!storageUrl || !storageToken) {
  console.error('[Storage] Missing Redis credentials:', {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    STORAGE_REST_API_URL: !!process.env.STORAGE_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    STORAGE_REST_API_TOKEN: !!process.env.STORAGE_REST_API_TOKEN,
    KV_URL_VALUE: process.env.KV_REST_API_URL?.substring(0, 30),
    STORAGE_URL_VALUE: process.env.STORAGE_REST_API_URL?.substring(0, 30),
  });
  throw new Error('Missing Vercel KV environment variables - Please connect your Vercel KV database to this project');
}

console.log('[Storage] Using Redis URL:', storageUrl?.substring(0, 30));

const kv = createClient({
  url: storageUrl,
  token: storageToken,
});

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

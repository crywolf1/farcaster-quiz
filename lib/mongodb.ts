// MongoDB connection and models
import { MongoClient, Db, Collection } from 'mongodb';

// Global cache for MongoDB client
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let isConnecting = false;
let connectionPromise: Promise<{ client: MongoClient; db: Db }> | null = null;

export interface LeaderboardEntry {
  fid: string;
  username: string;
  pfpUrl: string;
  points: number;
  wins: number;
  losses: number;
  lastPlayed: Date;
}

export interface PendingQuestion {
  _id?: any;
  subject: string;
  difficulty?: 'easy' | 'moderate' | 'hard';
  question: string;
  answers: string[];
  correctAnswer: number;
  submittedBy: {
    fid: string;
    username: string;
    pfpUrl: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: Date;
  reviewedAt?: Date;
}

async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  // Return cached connection if available
  if (cachedClient && cachedDb) {
    try {
      // Verify connection is still alive
      await cachedClient.db().admin().ping();
      return { client: cachedClient, db: cachedDb };
    } catch (error) {
      console.warn('[MongoDB] Cached connection failed ping test, reconnecting...');
      cachedClient = null;
      cachedDb = null;
    }
  }

  // If already connecting, wait for that connection
  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  isConnecting = true;

  // Connection options optimized for M0 free tier (max 500 connections)
  connectionPromise = (async () => {
    try {
      const client = await MongoClient.connect(uri, {
        maxPoolSize: 5, // Reduced from 10 - fewer connections per instance
        minPoolSize: 1, // Reduced from 2
        maxIdleTimeMS: 20000, // Reduced from 30s - close idle connections faster
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
      });
      
      const db = client.db('farcaster-quiz');

      cachedClient = client;
      cachedDb = db;

      console.log('[MongoDB] ✓ Connection established');

      return { client, db };
    } finally {
      isConnecting = false;
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

export async function getLeaderboardCollection(): Promise<Collection<LeaderboardEntry>> {
  try {
    const { db } = await connectToDatabase();
    return db.collection<LeaderboardEntry>('leaderboard');
  } catch (error) {
    console.error('[MongoDB] Failed to get leaderboard collection:', error);
    // Don't throw - return a failed response instead
    throw new Error('Database connection failed');
  }
}

export async function getPendingQuestionsCollection(): Promise<Collection<PendingQuestion>> {
  try {
    const { db } = await connectToDatabase();
    return db.collection<PendingQuestion>('pendingQuestions');
  } catch (error) {
    console.error('[MongoDB] Failed to get pending questions collection:', error);
    throw new Error('Database connection failed');
  }
}

// Gracefully close connection (for cleanup)
export async function closeConnection(): Promise<void> {
  if (cachedClient) {
    try {
      await cachedClient.close();
      cachedClient = null;
      cachedDb = null;
      console.log('[MongoDB] Connection closed');
    } catch (error) {
      console.error('[MongoDB] Error closing connection:', error);
    }
  }
}

// Get all approved questions from database
export async function getApprovedQuestions(): Promise<PendingQuestion[]> {
  const collection = await getPendingQuestionsCollection();
  return await collection.find({ status: 'approved' }).toArray();
}

export async function updatePlayerScore(
  fid: string,
  username: string,
  pfpUrl: string,
  pointsToAdd: number,
  isWin: boolean
): Promise<void> {
  const collection = await getLeaderboardCollection();
  
  await collection.updateOne(
    { fid },
    {
      $set: {
        username,
        pfpUrl,
        lastPlayed: new Date(),
      },
      $inc: {
        points: pointsToAdd,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
      },
    },
    { upsert: true }
  );
}

export async function getTopPlayers(limit: number = 100): Promise<LeaderboardEntry[]> {
  const collection = await getLeaderboardCollection();
  
  return await collection
    .find({})
    .sort({ points: -1 })
    .limit(limit)
    .toArray();
}

export async function getPlayerRank(fid: string): Promise<{ rank: number; player: LeaderboardEntry | null }> {
  const collection = await getLeaderboardCollection();
  
  const player = await collection.findOne({ fid });
  if (!player) {
    return { rank: 0, player: null };
  }
  
  const rank = await collection.countDocuments({ points: { $gt: player.points } }) + 1;
  
  return { rank, player };
}

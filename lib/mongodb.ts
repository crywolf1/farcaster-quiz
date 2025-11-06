// MongoDB connection and models
import { MongoClient, Db, Collection } from 'mongodb';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

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
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  // Connection options optimized for M0 free tier (max 500 connections)
  const client = await MongoClient.connect(uri, {
    maxPoolSize: 10, // Limit connections per instance
    minPoolSize: 2,
    maxIdleTimeMS: 30000, // Close idle connections after 30s
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  
  const db = client.db('farcaster-quiz');

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getLeaderboardCollection(): Promise<Collection<LeaderboardEntry>> {
  try {
    const { db } = await connectToDatabase();
    return db.collection<LeaderboardEntry>('leaderboard');
  } catch (error) {
    console.error('[MongoDB] Failed to get leaderboard collection:', error);
    throw error;
  }
}

export async function getPendingQuestionsCollection(): Promise<Collection<PendingQuestion>> {
  try {
    const { db } = await connectToDatabase();
    return db.collection<PendingQuestion>('pendingQuestions');
  } catch (error) {
    console.error('[MongoDB] Failed to get pending questions collection:', error);
    throw error;
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

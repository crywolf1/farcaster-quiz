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

  const client = await MongoClient.connect(uri);
  const db = client.db('farcaster-quiz');

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getLeaderboardCollection(): Promise<Collection<LeaderboardEntry>> {
  const { db } = await connectToDatabase();
  return db.collection<LeaderboardEntry>('leaderboard');
}

export async function getPendingQuestionsCollection(): Promise<Collection<PendingQuestion>> {
  const { db } = await connectToDatabase();
  return db.collection<PendingQuestion>('pendingQuestions');
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

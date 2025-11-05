// Script to completely clear the leaderboard (delete all players)
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function clearLeaderboard() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('farcaster-quiz');
  const collection = db.collection('leaderboard');

  console.log('⚠️  CLEARING ENTIRE LEADERBOARD...');

  try {
    // Count before deletion
    const beforeCount = await collection.countDocuments();
    console.log(`📊 Found ${beforeCount} players in leaderboard`);

    // Delete all documents
    const result = await collection.deleteMany({});

    console.log(`✅ Leaderboard cleared!`);
    console.log(`   - Deleted ${result.deletedCount} players`);
    console.log(`   - Leaderboard is now empty`);

    // Verify
    const afterCount = await collection.countDocuments();
    console.log(`\n📊 Remaining players: ${afterCount}`);

  } catch (error) {
    console.error('❌ Clear failed:', error);
  } finally {
    await client.close();
  }
}

// Run the clear
clearLeaderboard().catch(console.error);

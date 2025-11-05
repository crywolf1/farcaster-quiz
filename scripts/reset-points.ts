// Script to reset all points to zero in leaderboard
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function resetAllPoints() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('farcaster-quiz');
  const collection = db.collection('leaderboard');

  console.log('⚠️  RESETTING ALL POINTS TO ZERO...');

  try {
    // First, migrate score to points if needed
    const scoreExists = await collection.findOne({ score: { $exists: true } });
    if (scoreExists) {
      console.log('📝 Migrating score -> points first...');
      await collection.updateMany(
        { score: { $exists: true } },
        { $rename: { score: 'points' } }
      );
    }

    // Reset all points to 0
    const result = await collection.updateMany(
      {},
      { $set: { points: 0 } }
    );

    console.log(`✅ Reset complete!`);
    console.log(`   - Updated ${result.modifiedCount} documents`);
    console.log(`   - All players now have 0 points`);

    // Show current state
    const totalPlayers = await collection.countDocuments();
    console.log(`\n📊 Total players in leaderboard: ${totalPlayers}`);

  } catch (error) {
    console.error('❌ Reset failed:', error);
  } finally {
    await client.close();
  }
}

// Run the reset
resetAllPoints().catch(console.error);

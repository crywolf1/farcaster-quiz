// Migration script to rename 'score' field to 'points' in leaderboard collection
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function migrateScoreToPoints() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('farcaster-quiz');
  const collection = db.collection('leaderboard');

  console.log('Starting migration: score -> points');

  try {
    // Rename the field from 'score' to 'points' for all documents
    const result = await collection.updateMany(
      { score: { $exists: true } }, // Find documents with 'score' field
      { $rename: { score: 'points' } } // Rename to 'points'
    );

    console.log(`✅ Migration complete!`);
    console.log(`   - Matched ${result.matchedCount} documents`);
    console.log(`   - Modified ${result.modifiedCount} documents`);

    // Verify the migration
    const sampleDocs = await collection.find({}).limit(5).toArray();
    console.log('\nSample documents after migration:');
    sampleDocs.forEach(doc => {
      console.log(`   - ${doc.username}: ${doc.points} points (wins: ${doc.wins}, losses: ${doc.losses})`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await client.close();
  }
}

// Run the migration
migrateScoreToPoints().catch(console.error);

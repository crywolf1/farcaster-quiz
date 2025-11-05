import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function updateQuestionSubmitters() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('farcaster-quiz');
  const collection = db.collection('pendingQuestions');

  try {
    // Update all approved questions that have submittedBy.fid = 'system' or submittedBy.username = 'Quiz Admin'
    const result = await collection.updateMany(
      {
        status: 'approved',
        $or: [
          { 'submittedBy.fid': 'system' },
          { 'submittedBy.username': 'Quiz Admin' }
        ]
      },
      {
        $set: {
          'submittedBy.fid': '344203',
          'submittedBy.username': 'dany69.eth',
          'submittedBy.pfpUrl': 'https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/cc20ca39-55f4-4f4e-b1f1-dcc019896d00/original'
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} questions`);
    console.log(`All migrated questions are now attributed to dany69.eth (FID: 344203)`);
  } catch (error) {
    console.error('Error updating questions:', error);
  } finally {
    await client.close();
  }
}

updateQuestionSubmitters();

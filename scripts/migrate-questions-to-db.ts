import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

interface QuestionFromJSON {
  id: string;
  subject: string;
  difficulty: 'easy' | 'moderate' | 'hard';
  question: string;
  options: string[];
  correctAnswer: number;
  submittedBy?: {
    username: string;
    fid: string;
  };
}

async function migrateQuestions() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const client = await MongoClient.connect(uri);
  const db = client.db('farcaster-quiz');
  const collection = db.collection('pendingQuestions');

  try {
    // Read questions.json
    const questionsPath = path.join(process.cwd(), 'data', 'questions.json');
    const questionsData = fs.readFileSync(questionsPath, 'utf-8');
    const questions: QuestionFromJSON[] = JSON.parse(questionsData);

    console.log(`Found ${questions.length} questions in questions.json`);

    // Convert and insert each question as approved
    let imported = 0;
    for (const q of questions) {
      const dbQuestion = {
        subject: q.subject,
        difficulty: q.difficulty,
        question: q.question,
        answers: q.options,
        correctAnswer: q.correctAnswer,
        submittedBy: q.submittedBy || {
          fid: 'system',
          username: 'Quiz Admin',
          pfpUrl: 'https://i.imgur.com/default.png',
        },
        status: 'approved' as const,
        submittedAt: new Date(),
        reviewedAt: new Date(),
      };

      await collection.insertOne(dbQuestion);
      imported++;
      console.log(`Imported: ${q.subject} - ${q.question.substring(0, 50)}...`);
    }

    console.log(`\n✅ Successfully imported ${imported} questions to MongoDB!`);
    console.log('All questions are marked as "approved" and ready to use.');
    console.log('\nYou can now delete data/questions.json if you want - it\'s no longer needed!');
  } catch (error) {
    console.error('Error migrating questions:', error);
  } finally {
    await client.close();
  }
}

migrateQuestions();

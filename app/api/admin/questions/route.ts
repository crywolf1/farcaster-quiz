import { NextResponse } from 'next/server';
import { getPendingQuestionsCollection } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import fs from 'fs/promises';
import path from 'path';

// ADMIN FID - Replace this with your actual Farcaster ID
const ADMIN_FID = 123456; // TODO: Replace with your FID

// Helper function to verify admin access
function verifyAdmin(request: Request): boolean {
  // Check for admin FID in headers (sent from client)
  const adminFid = request.headers.get('x-admin-fid');
  if (!adminFid || parseInt(adminFid) !== ADMIN_FID) {
    return false;
  }
  return true;
}

// GET: Fetch all pending questions
export async function GET(request: Request) {
  try {
    // Verify admin access
    if (!verifyAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized access' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const collection = await getPendingQuestionsCollection();
    const questions = await collection
      .find({ status: status as any })
      .sort({ submittedAt: -1 })
      .toArray();

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('Error fetching questions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch questions' },
      { status: 500 }
    );
  }
}

// POST: Approve or reject a question
export async function POST(request: Request) {
  try {
    // Verify admin access
    if (!verifyAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized access' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { questionId, action } = body; // action: 'approve' or 'reject'

    if (!questionId || !action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid request. Need questionId and action (approve/reject)' },
        { status: 400 }
      );
    }

    const collection = await getPendingQuestionsCollection();

    // Get the question
    const question = await collection.findOne({ _id: new ObjectId(questionId) });
    
    if (!question) {
      return NextResponse.json(
        { error: 'Question not found' },
        { status: 404 }
      );
    }

    if (action === 'approve') {
      // Update status to approved
      await collection.updateOne(
        { _id: new ObjectId(questionId) },
        {
          $set: {
            status: 'approved',
            reviewedAt: new Date(),
          },
        }
      );

      // Add to questions.json
      const questionsPath = path.join(process.cwd(), 'data', 'questions.json');
      const questionsData = await fs.readFile(questionsPath, 'utf-8');
      const questionsJson = JSON.parse(questionsData);

      // Find or create the subject
      let subjectData = questionsJson.subjects.find((s: any) => s.name === question.subject);
      
      if (!subjectData) {
        subjectData = {
          name: question.subject,
          questions: [],
        };
        questionsJson.subjects.push(subjectData);
      }

      // Add the question
      subjectData.questions.push({
        question: question.question,
        answers: question.answers,
        correctAnswer: question.correctAnswer,
      });

      // Write back to file
      await fs.writeFile(questionsPath, JSON.stringify(questionsJson, null, 2));

      return NextResponse.json({
        success: true,
        message: 'Question approved and added to the game!',
      });
    } else {
      // Reject the question
      await collection.updateOne(
        { _id: new ObjectId(questionId) },
        {
          $set: {
            status: 'rejected',
            reviewedAt: new Date(),
          },
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Question rejected',
      });
    }
  } catch (error) {
    console.error('Error reviewing question:', error);
    return NextResponse.json(
      { error: 'Failed to review question' },
      { status: 500 }
    );
  }
}

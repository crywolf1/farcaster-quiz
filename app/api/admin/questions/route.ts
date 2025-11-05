import { NextResponse } from 'next/server';
import { getPendingQuestionsCollection, updatePlayerScore } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import fs from 'fs/promises';
import path from 'path';

// ADMIN FID - Replace this with your actual Farcaster ID
const ADMIN_FID = 344203;

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

      // Add the question with submitter info
      subjectData.questions.push({
        question: question.question,
        answers: question.answers,
        correctAnswer: question.correctAnswer,
        submittedBy: {
          username: question.submittedBy.username,
          fid: question.submittedBy.fid,
        },
      });

      // Write back to file
      await fs.writeFile(questionsPath, JSON.stringify(questionsJson, null, 2));

      // Award 1000 points to the question submitter
      await updatePlayerScore(
        question.submittedBy.fid,
        question.submittedBy.username,
        question.submittedBy.pfpUrl,
        1000,
        false // Not a win, just a points reward
      );

      return NextResponse.json({
        success: true,
        message: 'Question approved and added to the game! 1,000 points awarded to submitter.',
      });
    } else {
      // Reject the question - delete it from the database
      await collection.deleteOne({ _id: new ObjectId(questionId) });

      return NextResponse.json({
        success: true,
        message: 'Question rejected and removed',
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

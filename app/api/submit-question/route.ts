import { NextResponse } from 'next/server';
import { getPendingQuestionsCollection } from '@/lib/mongodb';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { subject, question, answers, correctAnswer, submittedBy } = body;

    // Validation
    if (!subject || !question || !answers || answers.length !== 4 || correctAnswer === undefined) {
      return NextResponse.json(
        { error: 'Invalid question data. Need subject, question, 4 answers, and correctAnswer.' },
        { status: 400 }
      );
    }

    if (!submittedBy || !submittedBy.fid || !submittedBy.username) {
      return NextResponse.json(
        { error: 'Submitter information required' },
        { status: 400 }
      );
    }

    const collection = await getPendingQuestionsCollection();

    const newQuestion = {
      subject,
      question,
      answers,
      correctAnswer,
      submittedBy,
      status: 'pending' as const,
      submittedAt: new Date(),
    };

    const result = await collection.insertOne(newQuestion);

    return NextResponse.json({
      success: true,
      questionId: result.insertedId,
      message: 'Question submitted successfully! It will be reviewed before being added to the game.',
    });
  } catch (error) {
    console.error('Error submitting question:', error);
    return NextResponse.json(
      { error: 'Failed to submit question' },
      { status: 500 }
    );
  }
}

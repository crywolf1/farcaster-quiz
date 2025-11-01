import { NextRequest, NextResponse } from 'next/server';
import { submitAnswer } from '@/lib/gameManager';

// POST: Submit answer for current question
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, questionId, answerIndex } = body;

    if (!playerId || questionId === undefined || answerIndex === undefined) {
      return NextResponse.json(
        { error: 'Missing playerId, questionId, or answerIndex' },
        { status: 400 }
      );
    }

    const result = submitAnswer(playerId, questionId, answerIndex);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Answer API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { submitAnswer } from '@/lib/gameManager';

// POST: Submit answer for current question
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Answer API] Received request:', body);
    const { playerId, questionId, answerIndex } = body;

    if (!playerId || questionId === undefined || answerIndex === undefined) {
      console.log('[Answer API] Missing data - playerId:', playerId, 'questionId:', questionId, 'answerIndex:', answerIndex);
      return NextResponse.json(
        { error: 'Missing playerId, questionId, or answerIndex' },
        { status: 400 }
      );
    }

    console.log('[Answer API] Calling submitAnswer...');
    const result = await submitAnswer(playerId, questionId, answerIndex);
    console.log('[Answer API] Result:', result);

    if (!result.success) {
      console.log('[Answer API] Failed:', result.message);
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Answer API] Error:', error);
    console.error('[Answer API] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

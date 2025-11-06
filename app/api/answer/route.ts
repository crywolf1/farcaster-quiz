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
        { success: false, error: 'Missing playerId, questionId, or answerIndex', message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate answerIndex is a number
    if (typeof answerIndex !== 'number' || answerIndex < -1 || answerIndex > 3) {
      console.log('[Answer API] Invalid answerIndex:', answerIndex);
      return NextResponse.json(
        { success: false, error: 'Invalid answerIndex', message: 'Answer index must be between 0-3 or -1 for timeout' },
        { status: 400 }
      );
    }

    console.log('[Answer API] Calling submitAnswer...');
    const result = await submitAnswer(playerId, questionId, answerIndex);
    console.log('[Answer API] Result:', result);

    if (!result.success) {
      console.log('[Answer API] Failed:', result.message);
      return NextResponse.json(
        { success: false, error: result.message, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Answer API] ❌ Error:', error);
    console.error('[Answer API] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error', 
        message: 'An error occurred while processing your answer',
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

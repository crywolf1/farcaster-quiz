import { NextRequest, NextResponse } from 'next/server';
import { getGameState, getRemainingTime } from '@/lib/gameManager';

// GET /api/timer - Get remaining time for current phase
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');

    if (!playerId) {
      return NextResponse.json(
        { error: 'Missing playerId' },
        { status: 400 }
      );
    }

    const gameState = getGameState(playerId);
    if (!gameState) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    const remainingTime = getRemainingTime(gameState.id);

    return NextResponse.json({
      success: true,
      remainingTime, // in milliseconds
      timerActive: remainingTime > 0,
      state: gameState.state,
    });
  } catch (error) {
    console.error('[Timer API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

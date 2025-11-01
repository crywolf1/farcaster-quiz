import { NextRequest, NextResponse } from 'next/server';
import { getGameState } from '@/lib/gameManager';

// GET: Get current game state
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

    // Convert Maps and Sets to objects/arrays for JSON serialization
    const serializedState = {
      ...gameState,
      answers: Object.fromEntries(gameState.answers),
      scores: gameState.scores ? Object.fromEntries(gameState.scores) : {},
      playerProgress: gameState.playerProgress ? Object.fromEntries(gameState.playerProgress) : {},
      playerTimers: gameState.playerTimers ? Object.fromEntries(gameState.playerTimers) : {},
      playersFinished: gameState.playersFinished ? Array.from(gameState.playersFinished) : [],
      playersReady: gameState.playersReady ? Array.from(gameState.playersReady) : [],
      timerTimeoutId: undefined, // Don't send timeout ID to client
      roundOverAutoStartTimeoutId: undefined, // Don't send timeout ID to client
      // Add player-specific current question
      myProgress: gameState.playerProgress ? (gameState.playerProgress.get(playerId) || 0) : 0,
    };

    return NextResponse.json({ gameState: serializedState });
  } catch (error) {
    console.error('[Game API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

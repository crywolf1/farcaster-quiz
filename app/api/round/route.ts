import { NextRequest, NextResponse } from 'next/server';
import { startNextRound } from '@/lib/gameManager';

// POST: Start next round
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId } = body;

    if (!playerId) {
      return NextResponse.json(
        { error: 'Missing playerId' },
        { status: 400 }
      );
    }

    const result = startNextRound(playerId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Round API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

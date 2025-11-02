import { NextRequest, NextResponse } from 'next/server';
import * as gameManager from '@/lib/gameManager';

export async function POST(request: NextRequest) {
  try {
    const { playerId } = await request.json();

    if (!playerId) {
      return NextResponse.json({ error: 'playerId required' }, { status: 400 });
    }

    console.log('[Leave API] Player leaving:', playerId);

    // Handle player leaving/disconnecting
    const result = await gameManager.handlePlayerDisconnect(playerId);

    if (result.success) {
      console.log('[Leave API] ✅ Player left successfully');
      return NextResponse.json({ 
        success: true,
        opponentWins: result.opponentWins,
        message: result.message 
      });
    } else {
      console.log('[Leave API] ⚠️', result.message);
      return NextResponse.json({ 
        success: false,
        message: result.message 
      });
    }

  } catch (error) {
    console.error('[Leave API] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to leave game' 
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

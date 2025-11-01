import { NextRequest, NextResponse } from 'next/server';
import { joinMatchmaking, checkMatchStatus, getSubjects } from '@/lib/gameManager';

// POST: Join matchmaking queue
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, username, pfpUrl, fid } = body;

    if (!playerId || !username) {
      return NextResponse.json(
        { error: 'Missing playerId or username' },
        { status: 400 }
      );
    }

    const player = { id: playerId, username, pfpUrl, fid };
    const result = joinMatchmaking(player);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Match API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET: Check match status
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

    const status = checkMatchStatus(playerId);
    const subjects = getSubjects();

    return NextResponse.json({ ...status, subjects });
  } catch (error) {
    console.error('[Match API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTopPlayers, getPlayerRank } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fid = searchParams.get('fid');
    const limit = parseInt(searchParams.get('limit') || '100');

    // Get top players
    const topPlayers = await getTopPlayers(limit);

    // Get current player's rank if fid is provided
    let playerRank = null;
    if (fid) {
      playerRank = await getPlayerRank(fid);
    }

    return NextResponse.json({
      success: true,
      leaderboard: topPlayers,
      playerRank: playerRank,
    });
  } catch (error) {
    console.error('[Leaderboard API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTopPlayers, getPlayerRank } from '@/lib/mongodb';

// Simple in-memory cache
let leaderboardCache: { data: any; timestamp: number } | null = null;
const CACHE_DURATION = 10000; // 10 seconds

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fid = searchParams.get('fid');
    const limit = parseInt(searchParams.get('limit') || '100');
    
    const now = Date.now();

    // Return cached leaderboard if fresh (within 10 seconds)
    if (leaderboardCache && (now - leaderboardCache.timestamp) < CACHE_DURATION) {
      console.log('[Leaderboard API] Returning cached data');
      
      // Still fetch player rank if requested (it's fast and specific)
      let playerRank = null;
      if (fid && leaderboardCache.data.leaderboard) {
        try {
          playerRank = await getPlayerRank(fid);
        } catch (error) {
          console.error('[Leaderboard API] Failed to get player rank:', error);
          // Continue without rank
        }
      }
      
      return NextResponse.json({
        success: true,
        leaderboard: leaderboardCache.data.leaderboard,
        playerRank: playerRank || leaderboardCache.data.playerRank,
        cached: true,
      });
    }

    // Fetch fresh data
    const topPlayers = await getTopPlayers(limit);

    // Get current player's rank if fid is provided
    let playerRank = null;
    if (fid) {
      try {
        playerRank = await getPlayerRank(fid);
      } catch (error) {
        console.error('[Leaderboard API] Failed to get player rank:', error);
        // Continue without rank
      }
    }

    // Update cache
    leaderboardCache = {
      data: { leaderboard: topPlayers, playerRank },
      timestamp: now,
    };

    return NextResponse.json({
      success: true,
      leaderboard: topPlayers,
      playerRank: playerRank,
      cached: false,
    });
  } catch (error) {
    console.error('[Leaderboard API] Error:', error);
    
    // Return cached data if available even if error
    if (leaderboardCache) {
      console.log('[Leaderboard API] Returning stale cache due to error');
      return NextResponse.json({
        success: true,
        leaderboard: leaderboardCache.data.leaderboard,
        playerRank: leaderboardCache.data.playerRank,
        cached: true,
        stale: true,
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}

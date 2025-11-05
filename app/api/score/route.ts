import { NextRequest, NextResponse } from 'next/server';
import { updatePlayerScore } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fid, username, pfpUrl, score, isWin } = body;

    if (!fid || !username) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    await updatePlayerScore(fid, username, pfpUrl, score, isWin);

    return NextResponse.json({
      success: true,
      message: 'Points updated successfully',
    });
  } catch (error) {
    console.error('[Update Score API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update score' },
      { status: 500 }
    );
  }
}

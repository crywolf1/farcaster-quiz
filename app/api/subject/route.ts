import { NextRequest, NextResponse } from 'next/server';
import { selectSubject } from '@/lib/gameManager';

// POST: Select subject for round
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Subject API] Received request:', body);
    const { playerId, subject } = body;

    if (!playerId || !subject) {
      console.log('[Subject API] Missing data - playerId:', playerId, 'subject:', subject);
      return NextResponse.json(
        { error: 'Missing playerId or subject' },
        { status: 400 }
      );
    }

    console.log('[Subject API] Calling selectSubject...');
    const result = await selectSubject(playerId, subject);
    console.log('[Subject API] Result:', result);

    if (!result.success) {
      console.log('[Subject API] Failed:', result.message);
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Subject API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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
        { success: false, error: 'Missing playerId or subject', message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate subject is a non-empty string
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      console.log('[Subject API] Invalid subject:', subject);
      return NextResponse.json(
        { success: false, error: 'Invalid subject', message: 'Subject must be a non-empty string' },
        { status: 400 }
      );
    }

    console.log('[Subject API] Calling selectSubject...');
    const result = await selectSubject(playerId, subject);
    console.log('[Subject API] Result:', result);

    if (!result.success) {
      console.log('[Subject API] Failed:', result.message);
      return NextResponse.json(
        { success: false, error: result.message, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Subject API] ❌ Error:', error);
    console.error('[Subject API] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error', 
        message: 'An error occurred while selecting subject',
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

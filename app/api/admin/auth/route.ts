import { NextResponse } from 'next/server';

// ADMIN PASSWORD - This stays on the server and is never sent to the client
// You can also set this as environment variable ADMIN_PASSWORD for extra security
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Maryam8935@';
const ADMIN_FID = parseInt(process.env.ADMIN_FID || '344203');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;

    // Check if password matches
    if (password === ADMIN_PASSWORD) {
      // Return success with admin FID
      return NextResponse.json({
        success: true,
        adminFid: ADMIN_FID,
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

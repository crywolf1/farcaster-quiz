import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('Farcaster webhook received:', body);
    
    // Handle different webhook events
    const { event, data } = body;
    
    switch (event) {
      case 'frame.added':
        console.log('Frame added to user collection');
        break;
      case 'frame.removed':
        console.log('Frame removed from user collection');
        break;
      case 'notifications.enabled':
        console.log('Notifications enabled');
        break;
      case 'notifications.disabled':
        console.log('Notifications disabled');
        break;
      default:
        console.log('Unknown event:', event);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    message: 'Farcaster Quiz webhook endpoint' 
  });
}

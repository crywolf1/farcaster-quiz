import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Farcaster Quiz - Real-time Multiplayer Quiz Game';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background pattern */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.1) 0%, transparent 50%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.1) 0%, transparent 50%)',
          }}
        />
        
        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '80px',
            zIndex: 1,
          }}
        >
          {/* Icon */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '160px',
              height: '160px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '40px',
              marginBottom: '40px',
              fontSize: '80px',
            }}
          >
            🎯
          </div>
          
          {/* Title */}
          <div
            style={{
              fontSize: '80px',
              fontWeight: 'bold',
              color: 'white',
              marginBottom: '20px',
              textShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            Farcaster Quiz
          </div>
          
          {/* Subtitle */}
          <div
            style={{
              fontSize: '36px',
              color: 'rgba(255,255,255,0.9)',
              marginBottom: '40px',
              textShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            Real-time Multiplayer Quiz Game
          </div>
          
          {/* CTA */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.95)',
              color: '#667eea',
              fontSize: '32px',
              fontWeight: 'bold',
              padding: '24px 48px',
              borderRadius: '16px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
          >
            Play Now →
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

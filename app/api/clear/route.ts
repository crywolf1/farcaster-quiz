import { NextResponse } from 'next/server';

// Debug endpoint to clear a stuck game
export async function POST(request: Request) {
  try {
    const { playerId } = await request.json();
    
    if (!playerId) {
      return NextResponse.json({ success: false, error: 'playerId required' });
    }

    // This will be handled by the frontend clearing localStorage
    return NextResponse.json({ 
      success: true, 
      message: 'Clear localStorage on frontend',
      instructions: 'Open browser console and run: localStorage.clear(); location.reload();'
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}

// GET endpoint that returns HTML with a clear button
export async function GET() {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Clear Quiz Game State</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          text-align: center;
          max-width: 500px;
        }
        h1 {
          color: #333;
          margin-bottom: 20px;
        }
        p {
          color: #666;
          margin-bottom: 30px;
          line-height: 1.6;
        }
        button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 15px 40px;
          font-size: 18px;
          font-weight: bold;
          border-radius: 10px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover {
          transform: scale(1.05);
        }
        button:active {
          transform: scale(0.95);
        }
        .success {
          color: green;
          font-weight: bold;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔧 Clear Quiz Game State</h1>
        <p>If your game is stuck, click the button below to clear all saved game data and start fresh.</p>
        <button onclick="clearGame()">Clear Game State & Reload</button>
        <div id="result"></div>
      </div>
      <script>
        function clearGame() {
          try {
            // Clear all localStorage
            localStorage.clear();
            
            // Show success message
            document.getElementById('result').innerHTML = '<p class="success">✓ Game state cleared! Redirecting to home...</p>';
            
            // Redirect to home page after 1 second
            setTimeout(() => {
              window.location.href = '/';
            }, 1000);
          } catch (error) {
            document.getElementById('result').innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
          }
        }
      </script>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}

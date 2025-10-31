# Farcaster Quiz

A real-time multiplayer quiz application for Farcaster where two players match and compete against each other. Built with Next.js, Socket.IO, and Farcaster Frame SDK.

## Features

- 🎮 **Real-time Matchmaking**: Find and match with other players instantly
- 👤 **Farcaster Integration**: Auto-connect with Farcaster wallet - no manual login needed
- 🖼️ **Profile Pictures**: Display user pfp from Farcaster profile
- 🎯 **Subject Selection**: Each round, one player picks a subject category
- ❓ **5 Questions per Round**: Answer questions correctly to score points
- 🏆 **Multiple Rounds**: Best of 3 rounds determines the winner
- 📊 **Live Scoring**: See results after each question
- 🔄 **Turn-based Subject Selection**: Players alternate picking subjects each round
- 📱 **Mobile-First Design**: Optimized for Farcaster Mini App mobile experience

## Game Flow

1. Enter your username and click "Find Match"
2. System pairs you with another online player
3. **Round 1**: First player picks a subject, both answer 5 questions
4. **Round 2**: Second player picks a subject, both answer 5 questions
5. **Round 3**: First player picks again, final round
6. Winner is determined by total correct answers across all rounds

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Socket.IO
- **Real-time Communication**: Socket.IO for matchmaking and gameplay
- **Farcaster Integration**: @farcaster/frame-sdk for wallet connection and user data
- **Mobile-First**: Optimized UI for Farcaster Mini App viewport

## Project Structure

```
Quiz/
├── app/                    # Next.js App Router
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Main game UI
│   └── globals.css        # Global styles
├── server/                # Socket.IO server
│   └── index.ts           # Game logic & matchmaking
├── lib/                   # Shared utilities
│   └── types.ts           # TypeScript types
├── data/                  # Game data
│   └── questions.json     # Question database (25 questions)
├── package.json           # Dependencies
└── README.md              # This file
```

## Setup Instructions (Windows PowerShell)

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. **Install dependencies**:
   ```powershell
   npm install
   ```

2. **Run in development mode**:
   ```powershell
   npm run dev
   ```

   This command starts both:
   - Next.js dev server on `http://localhost:3000`
   - Socket.IO server on `http://localhost:3001`

3. **Open your browser**:
   - Navigate to `http://localhost:3000`
   - Open another browser window/tab (or incognito) to `http://localhost:3000` to simulate two players

### Building for Production

1. **Build the application**:
   ```powershell
   npm run build
   ```

2. **Start production servers**:
   ```powershell
   npm start
   ```

### Available Scripts

- `npm run dev` - Run both Next.js and Socket.IO in development mode
- `npm run dev:next` - Run only Next.js dev server
- `npm run dev:server` - Run only Socket.IO server
- `npm run build` - Build Next.js for production
- `npm start` - Start both servers in production mode
- `npm run lint` - Run ESLint
- `npm run type-check` - Check TypeScript types

## How to Play

### Farcaster Users (Production):
1. Open the mini app in Farcaster
2. Your profile (username & pfp) loads automatically
3. Click "Find Match" to start
4. Match with another player
5. Take turns picking subjects and answering questions
6. Best of 3 rounds wins!

### Development Testing:
1. Open http://localhost:3000
2. Auto-generated test profile loads (fallback mode)
3. Click "Find Match"
4. Open another tab/window to simulate second player
5. Both players are matched automatically

### As Player 1:
1. Click "Find Match" (no manual login needed!)
2. Wait for opponent
3. **Your turn**: Select a subject (Science, History, Geography, Sports, or Technology)
4. Answer 5 questions
5. See round results
6. Wait for Player 2 to pick subject for Round 2
7. Answer 5 more questions
8. **Your turn again**: Pick subject for Round 3
9. Final results!

### As Player 2:
1. Click "Find Match" (your Farcaster profile auto-loads!)
2. Wait for opponent
3. Wait for Player 1 to select subject
4. Answer 5 questions
5. See round results
6. **Your turn**: Pick subject for Round 2
7. Answer 5 questions
8. Wait for Player 1 to pick subject for Round 3
9. Final results!

## Question Database

The app includes 25 questions across 5 subjects:
- **Science** (5 questions)
- **History** (5 questions)
- **Geography** (5 questions)
- **Sports** (5 questions)
- **Technology** (5 questions)

You can add more questions by editing `data/questions.json`.

## Socket.IO Events

### Client → Server
- `find-match` - Join matchmaking queue
- `select-subject` - Choose subject for round
- `submit-answer` - Submit answer to question

### Server → Client
- `match-found` - Match created with opponent
- `subject-selection-required` - Your turn to pick subject
- `subject-selected` - Subject chosen, game starting
- `question` - New question delivered
- `answer-submitted` - Opponent answered
- `question-result` - Results for current question
- `round-complete` - Round finished
- `game-over` - Game finished
- `opponent-disconnected` - Opponent left game
- `error` - Error message

## Future Enhancements

- [ ] Add Farcaster authentication
- [ ] Implement leaderboard
- [ ] Add more question categories
- [ ] Support for more than 2 players
- [ ] Add difficulty levels
- [ ] Implement power-ups
- [ ] Add sound effects and animations
- [ ] Mobile responsive improvements
- [ ] Add spectator mode
- [ ] Implement ELO rating system

## 🚀 Free Deployment (For Testing)

### Quick Deploy Options:

**Backend (Socket.IO)**:
- [Railway](https://railway.app) - Recommended, easiest setup
- [Render](https://render.com) - Alternative option

**Frontend (Next.js)**:
- [Vercel](https://vercel.com) - One-click deployment

### Deployment Steps:

1. **Push to GitHub**:
   ```powershell
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/farcaster-quiz.git
   git push -u origin main
   ```

2. **Deploy Backend to Railway**:
   - Go to https://railway.app
   - Sign in with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repo
   - Add environment variables:
     - `PORT=3001`
     - `NODE_ENV=production`
   - Copy your Railway URL

3. **Deploy Frontend to Vercel**:
   - Go to https://vercel.com
   - Import your GitHub repo
   - Add environment variable:
     - `NEXT_PUBLIC_SOCKET_URL=https://your-railway-url.railway.app`
   - Deploy!

4. **Update Backend**:
   - Go back to Railway
   - Add: `FRONTEND_URL=https://your-app.vercel.app`

5. **Test in Farcaster**:
   - Open your Vercel URL
   - Share in Warpcast to test as a mini app!

📖 **See [QUICK_DEPLOY.md](./QUICK_DEPLOY.md) for detailed instructions!**

---

## Troubleshooting

**Port already in use?**
- Change the Socket.IO port in `server/index.ts` (default: 3001)
- Update the client connection URL in `.env.local`

**Can't connect to Socket.IO?**
- Make sure both servers are running (`npm run dev`)
- Check that port 3001 is not blocked by firewall
- Check `NEXT_PUBLIC_SOCKET_URL` environment variable

**Type errors?**
- Run `npm install` to ensure all dependencies are installed
- Run `npm run type-check` to see TypeScript errors

**Deployment issues?**
- Check deployment logs in Railway/Vercel dashboard
- Ensure environment variables are set correctly
- Free tier backends may sleep (30-60 sec wake time)

## Contributing

Feel free to submit issues and pull requests!

## License

MIT

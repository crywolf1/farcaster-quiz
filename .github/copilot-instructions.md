# Farcaster Quiz - Copilot Instructions

This is a Next.js real-time multiplayer quiz application where two players match and compete.

## Tech Stack
- Next.js 14+ (App Router)
- Socket.IO for real-time matchmaking and gameplay
- TypeScript
- Tailwind CSS for styling

## Project Structure
- `/app` - Next.js app router pages and API routes
- `/server` - Socket.IO server for matchmaking and game logic
- `/lib` - Shared utilities and types
- `/data` - Questions and subjects JSON

## Game Flow
1. Player clicks "Find Match"
2. Matchmaking pairs two players
3. Each round: one player picks subject, both answer 5 questions
4. Player with most correct answers wins the round
5. Continue for multiple rounds

## Development Guidelines
- Use TypeScript for type safety
- Socket.IO events should be well-typed
- Keep game state synchronized between server and clients
- Handle disconnections gracefully

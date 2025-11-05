import { createServer } from 'http';
import { Server } from 'socket.io';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  GameRoom, 
  Player, 
  Question,
  MatchmakingQueue 
} from '../lib/types';
import { getApprovedQuestions } from '../lib/mongodb';

// Function to dynamically load questions from MongoDB
async function loadQuestions(): Promise<Question[]> {
  try {
    const dbQuestions = await getApprovedQuestions();
    
    console.log(`[Server] Loaded ${dbQuestions.length} questions from database`);
    if (dbQuestions.length > 0) {
      console.log('[Server] Sample question submittedBy:', dbQuestions[0].submittedBy);
    }
    
    // Convert DB format to Question format
    const questions = dbQuestions.map((q, index) => ({
      id: q._id?.toString() || `q${index}`,
      subject: q.subject,
      difficulty: q.difficulty || 'moderate',
      question: q.question,
      options: q.answers,
      correctAnswer: q.correctAnswer,
      submittedBy: q.submittedBy,
    }));
    
    console.log('[Server] Sample converted question:', questions[0]);
    
    return questions;
  } catch (error) {
    console.error('Error loading questions from database:', error);
    return [];
  }
}

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? (process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : '*')
      : ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// In-memory storage
const matchmakingQueue: MatchmakingQueue[] = [];
const gameRooms = new Map<string, GameRoom>();
const playerToRoom = new Map<string, string>();

// Matchmaking control
let isMatchmaking = false; // Prevent concurrent matchmaking
const QUEUE_TIMEOUT = 60000; // 60 seconds - remove players if no match found
const MATCHMAKING_INTERVAL = 1000; // Check for matches every second

// Helper functions
function generateRoomId(): string {
  return `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Process all available matches in the queue
async function processMatchmakingQueue() {
  // Prevent concurrent execution
  if (isMatchmaking) {
    return;
  }
  
  isMatchmaking = true;
  
  try {
    // Remove expired queue entries
    const now = Date.now();
    const validQueue = matchmakingQueue.filter(entry => {
      if (now - entry.timestamp > QUEUE_TIMEOUT) {
        console.log(`[Matchmaking] Removing expired player: ${entry.username}`);
        io.to(entry.socketId).emit('error', { message: 'Matchmaking timeout. Please try again.' });
        return false;
      }
      return true;
    });
    
    // Clear and repopulate queue
    matchmakingQueue.length = 0;
    matchmakingQueue.push(...validQueue);
    
    console.log(`[Matchmaking] Queue size: ${matchmakingQueue.length}`);
    
    // Match all available pairs
    const matches: Array<[MatchmakingQueue, MatchmakingQueue]> = [];
    
    while (matchmakingQueue.length >= 2) {
      const player1 = matchmakingQueue.shift()!;
      const player2 = matchmakingQueue.shift()!;
      matches.push([player1, player2]);
    }
    
    if (matches.length > 0) {
      console.log(`[Matchmaking] Creating ${matches.length} matches...`);
    }
    
    // Create all game rooms in parallel
    const roomPromises = matches.map(async ([player1, player2]) => {
      try {
        const room = await createGameRoom(player1, player2);
        
        // Notify both players
        io.to(player1.socketId).emit('match-found', {
          roomId: room.id,
          opponent: { 
            id: player2.playerId, 
            username: player2.username, 
            pfpUrl: player2.pfpUrl, 
            fid: player2.fid 
          },
          yourTurn: room.roundOwnerIndex === 0
        });

        io.to(player2.socketId).emit('match-found', {
          roomId: room.id,
          opponent: { 
            id: player1.playerId, 
            username: player1.username, 
            pfpUrl: player1.pfpUrl, 
            fid: player1.fid 
          },
          yourTurn: room.roundOwnerIndex === 1
        });

        console.log(`[Matchmaking] ✓ Match created: ${room.id} (${player1.username} vs ${player2.username})`);
        
        // Start subject selection after a brief delay
        setTimeout(() => startSubjectSelection(room), 2000);
        
        return room;
      } catch (error) {
        console.error(`[Matchmaking] ✗ Error creating game room:`, error);
        // Put players back in queue on error
        matchmakingQueue.push(player1, player2);
        io.to(player1.socketId).emit('error', { message: 'Failed to create game. Retrying...' });
        io.to(player2.socketId).emit('error', { message: 'Failed to create game. Retrying...' });
      }
    });
    
    await Promise.all(roomPromises);
    
    if (matchmakingQueue.length > 0) {
      console.log(`[Matchmaking] ${matchmakingQueue.length} player(s) still waiting...`);
    }
    
  } catch (error) {
    console.error('[Matchmaking] Error processing queue:', error);
  } finally {
    isMatchmaking = false;
  }
}

// Start continuous matchmaking loop
setInterval(() => {
  if (matchmakingQueue.length >= 2) {
    processMatchmakingQueue();
  }
}, MATCHMAKING_INTERVAL);

async function getAvailableSubjects(): Promise<string[]> {
  const questions = await loadQuestions();
  const subjectsSet = new Set(questions.map(q => q.subject));
  const subjects = Array.from(subjectsSet);
  return subjects;
}

async function getQuestionsBySubject(subject: string): Promise<Question[]> {
  const questions = await loadQuestions();
  const subjectQuestions = questions.filter(q => q.subject === subject);
  
  // Get one question from each difficulty level
  const easyQuestions = subjectQuestions.filter(q => q.difficulty === 'easy');
  const moderateQuestions = subjectQuestions.filter(q => q.difficulty === 'moderate');
  const hardQuestions = subjectQuestions.filter(q => q.difficulty === 'hard');
  
  const selectedQuestions: Question[] = [];
  
  // Pick one random question from each difficulty
  if (easyQuestions.length > 0) {
    const randomEasy = easyQuestions[Math.floor(Math.random() * easyQuestions.length)];
    selectedQuestions.push(randomEasy);
  }
  
  if (moderateQuestions.length > 0) {
    const randomModerate = moderateQuestions[Math.floor(Math.random() * moderateQuestions.length)];
    selectedQuestions.push(randomModerate);
  }
  
  if (hardQuestions.length > 0) {
    const randomHard = hardQuestions[Math.floor(Math.random() * hardQuestions.length)];
    selectedQuestions.push(randomHard);
  }
  
  // Shuffle the 3 questions so they're not always in easy->moderate->hard order
  return selectedQuestions.sort(() => Math.random() - 0.5);
}

async function createGameRoom(player1: MatchmakingQueue, player2: MatchmakingQueue): Promise<GameRoom> {
  const roomId = generateRoomId();
  
  const players: [Player, Player] = [
    {
      id: player1.playerId,
      socketId: player1.socketId,
      username: player1.username,
      pfpUrl: player1.pfpUrl,
      fid: player1.fid,
      points: 0,
      ready: false
    },
    {
      id: player2.playerId,
      socketId: player2.socketId,
      username: player2.username,
      pfpUrl: player2.pfpUrl,
      fid: player2.fid,
      points: 0,
      ready: false
    }
  ];

  const allSubjects = await getAvailableSubjects();
  const availableSubjects = allSubjects.sort(() => Math.random() - 0.5).slice(0, 3);
  
  const room: GameRoom = {
    id: roomId,
    players,
    currentRound: 1,
    totalRounds: 6,
    maxRounds: 6,
    roundOwnerIndex: 0,
    currentPickerIndex: 0,
    currentSubject: null,
    questions: [],
    currentQuestionIndex: 0,
    answers: new Map(),
    scores: new Map(),
    state: 'subject-selection',
    timerStartedAt: null,
    timerDuration: 18000,
    playerProgress: new Map(),
    playerTimers: new Map(),
    playersFinished: new Set(),
    roundOverTimerStartedAt: null,
    playersReady: new Set(),
    usedSubjects: new Set(),
    availableSubjectsForRound: availableSubjects
  };

  gameRooms.set(roomId, room);
  playerToRoom.set(player1.playerId, roomId);
  playerToRoom.set(player2.playerId, roomId);

  return room;
}

async function startSubjectSelection(room: GameRoom) {
  room.state = 'subject-selection';
  const roundOwner = room.players[room.roundOwnerIndex];
  const subjects = await getAvailableSubjects();
  
  io.to(roundOwner.socketId).emit('subject-selection-required', { subjects });
}

function startQuestion(room: GameRoom) {
  if (room.currentQuestionIndex >= room.questions.length) {
    endRound(room);
    return;
  }

  room.state = 'question';
  room.answers.clear();
  
  const question = room.questions[room.currentQuestionIndex];
  
  console.log('[Server] Sending question to clients:', {
    question: question.question,
    submittedBy: question.submittedBy
  });
  
  room.players.forEach(player => {
    io.to(player.socketId).emit('question', {
      question,
      questionNumber: room.currentQuestionIndex + 1,
      totalQuestions: room.questions.length
    });
  });
}

function checkAnswers(room: GameRoom) {
  const question = room.questions[room.currentQuestionIndex];
  const results: { id: string; username: string; correct: boolean; points: number }[] = [];

  room.players.forEach(player => {
    const answer = room.answers.get(player.id);
    const correct = answer === question.correctAnswer;
    
    if (correct) {
      player.points! += 1;
    }
    
    results.push({
      id: player.id,
      username: player.username,
      correct,
      points: player.points || 0
    });
  });

  // Broadcast results
  room.players.forEach(player => {
    io.to(player.socketId).emit('question-result', {
      correctAnswer: question.correctAnswer,
      players: results
    });
  });

  // Move to next question after a delay
  setTimeout(() => {
    room.currentQuestionIndex++;
    startQuestion(room);
  }, 3000);
}

function endRound(room: GameRoom) {
  room.state = 'round-complete';
  
  const scores = room.players.map(p => ({
    playerId: p.id,
    username: p.username,
    points: p.points || 0
  }));

  const roundWinner = (room.players[0].points || 0) > (room.players[1].points || 0)
    ? room.players[0].username 
    : (room.players[0].points || 0) < (room.players[1].points || 0)
      ? room.players[1].username 
      : null;

  // Switch round owner
  room.roundOwnerIndex = room.roundOwnerIndex === 0 ? 1 : 0;
  
  room.players.forEach(player => {
    io.to(player.socketId).emit('round-complete', {
      winner: roundWinner,
      scores,
      nextRoundOwner: room.players[room.roundOwnerIndex].username
    });
  });

  // Check if game is over
  if (room.currentRound >= (room.maxRounds || room.totalRounds || 6)) {
    setTimeout(() => endGame(room), 3000);
  } else {
    // Reset for next round
    setTimeout(async () => {
      room.currentRound++;
      room.currentQuestionIndex = 0;
      room.questions = [];
      room.players.forEach(p => p.points = 0);
      
      // Get 3 new random subjects for this round (excluding used ones)
      const allSubjects = await getAvailableSubjects();
      const usedSubjectsArray = Array.from(room.usedSubjects);
      const availableSubjects = allSubjects
        .filter(s => !usedSubjectsArray.includes(s))
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      room.availableSubjectsForRound = availableSubjects.length > 0 ? availableSubjects : allSubjects.slice(0, 3);
      
      await startSubjectSelection(room);
    }, 5000);
  }
}

function endGame(room: GameRoom) {
  room.state = 'game-over';
  
  const finalScores = room.players.map(p => ({
    playerId: p.id,
    username: p.username,
    points: p.points || 0
  }));

  const winner = (room.players[0].points || 0) > (room.players[1].points || 0)
    ? room.players[0].username 
    : room.players[1].username;

  room.players.forEach(player => {
    io.to(player.socketId).emit('game-over', {
      winner,
      finalScores
    });
  });

  // Cleanup
  setTimeout(() => {
    playerToRoom.delete(room.players[0].id);
    playerToRoom.delete(room.players[1].id);
    gameRooms.delete(room.id);
  }, 10000);
}

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('find-match', ({ username, pfpUrl, fid }) => {
    const playerId = socket.id;
    
    // Check if already in queue
    if (matchmakingQueue.some(p => p.socketId === socket.id)) {
      socket.emit('error', { message: 'Already in matchmaking queue' });
      return;
    }

    // Check if already in a game
    if (playerToRoom.has(playerId)) {
      socket.emit('error', { message: 'Already in a game' });
      return;
    }

    // Add to queue
    const queueEntry: MatchmakingQueue = {
      playerId,
      socketId: socket.id,
      username: username || `Player${Math.floor(Math.random() * 1000)}`,
      pfpUrl,
      fid,
      timestamp: Date.now()
    };
    
    matchmakingQueue.push(queueEntry);
    console.log(`[Queue] Player ${username} joined (Queue size: ${matchmakingQueue.length})`);

    // Immediately try to process matches if we have enough players
    if (matchmakingQueue.length >= 2) {
      // Don't await - let it run in background
      processMatchmakingQueue().catch(error => {
        console.error('[Queue] Error in immediate matching:', error);
      });
    }
  });

  socket.on('select-subject', async ({ roomId, subject }) => {
    const room = gameRooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || room.players[room.roundOwnerIndex].id !== player.id) {
      socket.emit('error', { message: 'Not your turn to select subject' });
      return;
    }

    // Verify subject is available for this round
    if (!room.availableSubjectsForRound.includes(subject)) {
      socket.emit('error', { message: 'Subject not available for this round' });
      return;
    }

    room.currentSubject = subject;
    room.questions = await getQuestionsBySubject(subject);
    room.currentQuestionIndex = 0;
    room.usedSubjects.add(subject);

    // Notify both players
    room.players.forEach(p => {
      io.to(p.socketId).emit('subject-selected', { subject });
    });

    // Start first question
    setTimeout(() => startQuestion(room), 2000);
  });

  socket.on('submit-answer', ({ roomId, questionId, answerIndex }) => {
    const room = gameRooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Store answer
    room.answers.set(player.id, answerIndex);

    // Notify opponent that answer was submitted
    const opponent = room.players.find(p => p.id !== player.id);
    if (opponent) {
      io.to(opponent.socketId).emit('answer-submitted', { playerId: player.id });
    }

    // Check if both players answered
    if (room.answers.size === 2) {
      checkAnswers(room);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnect] Socket: ${socket.id}`);
    
    // Remove from matchmaking queue
    const queueIndex = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (queueIndex !== -1) {
      const removed = matchmakingQueue.splice(queueIndex, 1)[0];
      console.log(`[Queue] Removed ${removed.username} from queue (Queue size: ${matchmakingQueue.length})`);
    }

    // Handle game disconnection
    const roomId = playerToRoom.get(socket.id);
    if (roomId) {
      const room = gameRooms.get(roomId);
      if (room) {
        const opponent = room.players.find(p => p.socketId !== socket.id);
        if (opponent) {
          console.log(`[Game] Notifying opponent of disconnect in room ${roomId}`);
          io.to(opponent.socketId).emit('opponent-disconnected');
        }
        
        // Cleanup
        room.players.forEach(p => playerToRoom.delete(p.id));
        gameRooms.delete(roomId);
        console.log(`[Game] Cleaned up room ${roomId}`);
      }
    }
  });
});

const PORT = process.env.SOCKET_PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
  console.log(`[Matchmaking] Batch matching enabled (interval: ${MATCHMAKING_INTERVAL}ms)`);
  console.log(`[Matchmaking] Queue timeout: ${QUEUE_TIMEOUT / 1000}s`);
});

// Log server stats every 30 seconds
setInterval(() => {
  const stats = {
    queueSize: matchmakingQueue.length,
    activeGames: gameRooms.size,
    connectedPlayers: io.sockets.sockets.size,
  };
  
  if (stats.queueSize > 0 || stats.activeGames > 0) {
    console.log(`[Stats] Queue: ${stats.queueSize} | Active Games: ${stats.activeGames} | Connected: ${stats.connectedPlayers}`);
  }
}, 30000);

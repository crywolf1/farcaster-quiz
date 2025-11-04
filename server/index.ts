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
import questions from '../data/questions.json';

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

// Helper functions
function generateRoomId(): string {
  return `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getAvailableSubjects(): string[] {
  const subjectsSet = new Set((questions as Question[]).map(q => q.subject));
  const subjects = Array.from(subjectsSet);
  return subjects;
}

function getQuestionsBySubject(subject: string): Question[] {
  const subjectQuestions = (questions as Question[]).filter(q => q.subject === subject);
  
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

function createGameRoom(player1: MatchmakingQueue, player2: MatchmakingQueue): GameRoom {
  const roomId = generateRoomId();
  
  const players: [Player, Player] = [
    {
      id: player1.playerId,
      socketId: player1.socketId,
      username: player1.username,
      pfpUrl: player1.pfpUrl,
      fid: player1.fid,
      score: 0,
      ready: false
    },
    {
      id: player2.playerId,
      socketId: player2.socketId,
      username: player2.username,
      pfpUrl: player2.pfpUrl,
      fid: player2.fid,
      score: 0,
      ready: false
    }
  ];

  const allSubjects = getAvailableSubjects();
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

function startSubjectSelection(room: GameRoom) {
  room.state = 'subject-selection';
  const roundOwner = room.players[room.roundOwnerIndex];
  const subjects = getAvailableSubjects();
  
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
  const results: { id: string; username: string; correct: boolean; score: number }[] = [];

  room.players.forEach(player => {
    const answer = room.answers.get(player.id);
    const correct = answer === question.correctAnswer;
    
    if (correct) {
      player.score += 1;
    }
    
    results.push({
      id: player.id,
      username: player.username,
      correct,
      score: player.score
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
    score: p.score
  }));

  const roundWinner = room.players[0].score > room.players[1].score 
    ? room.players[0].username 
    : room.players[0].score < room.players[1].score 
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
    setTimeout(() => {
      room.currentRound++;
      room.currentQuestionIndex = 0;
      room.questions = [];
      room.players.forEach(p => p.score = 0);
      
      // Get 3 new random subjects for this round (excluding used ones)
      const allSubjects = getAvailableSubjects();
      const usedSubjectsArray = Array.from(room.usedSubjects);
      const availableSubjects = allSubjects
        .filter(s => !usedSubjectsArray.includes(s))
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
      room.availableSubjectsForRound = availableSubjects.length > 0 ? availableSubjects : allSubjects.slice(0, 3);
      
      startSubjectSelection(room);
    }, 5000);
  }
}

function endGame(room: GameRoom) {
  room.state = 'game-over';
  
  const finalScores = room.players.map(p => ({
    playerId: p.id,
    username: p.username,
    score: p.score
  }));

  const winner = room.players[0].score > room.players[1].score 
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
    console.log(`Player ${username} joined matchmaking queue`);

    // Try to match
    if (matchmakingQueue.length >= 2) {
      const player1 = matchmakingQueue.shift()!;
      const player2 = matchmakingQueue.shift()!;

      const room = createGameRoom(player1, player2);
      
      // Notify both players
      io.to(player1.socketId).emit('match-found', {
        roomId: room.id,
        opponent: { id: player2.playerId, username: player2.username, pfpUrl: player2.pfpUrl, fid: player2.fid },
        yourTurn: room.roundOwnerIndex === 0
      });

      io.to(player2.socketId).emit('match-found', {
        roomId: room.id,
        opponent: { id: player1.playerId, username: player1.username, pfpUrl: player1.pfpUrl, fid: player1.fid },
        yourTurn: room.roundOwnerIndex === 1
      });

      console.log(`Match created: ${room.id}`);
      
      // Start subject selection
      setTimeout(() => startSubjectSelection(room), 2000);
    }
  });

  socket.on('select-subject', ({ roomId, subject }) => {
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
    room.questions = getQuestionsBySubject(subject);
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
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Remove from matchmaking queue
    const queueIndex = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (queueIndex !== -1) {
      matchmakingQueue.splice(queueIndex, 1);
    }

    // Handle game disconnection
    const roomId = playerToRoom.get(socket.id);
    if (roomId) {
      const room = gameRooms.get(roomId);
      if (room) {
        const opponent = room.players.find(p => p.socketId !== socket.id);
        if (opponent) {
          io.to(opponent.socketId).emit('opponent-disconnected');
        }
        
        // Cleanup
        room.players.forEach(p => playerToRoom.delete(p.id));
        gameRooms.delete(roomId);
      }
    }
  });
});

const PORT = process.env.SOCKET_PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});

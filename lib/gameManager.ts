// In-memory game state manager (replaces Socket.IO server)
import questions from '@/data/questions.json';
import { Player, GameRoom, Question } from './types';

// Use globalThis to persist data across hot reloads in development
declare global {
  var matchmakingQueue: Player[] | undefined;
  var gameRooms: Map<string, GameRoom> | undefined;
  var playerToRoom: Map<string, string> | undefined;
  var playerTimerIds: Map<string, NodeJS.Timeout> | undefined;
}

// In-memory storage (persists across hot reloads)
const matchmakingQueue = globalThis.matchmakingQueue || (globalThis.matchmakingQueue = []);
const gameRooms = globalThis.gameRooms || (globalThis.gameRooms = new Map<string, GameRoom>());
const playerToRoom = globalThis.playerToRoom || (globalThis.playerToRoom = new Map<string, string>()); // playerId -> roomId
const playerTimerIds = globalThis.playerTimerIds || (globalThis.playerTimerIds = new Map<string, NodeJS.Timeout>()); // playerId -> timerId

// Timer constants
const TIMER_DURATION = 18000; // 18 seconds in milliseconds
const ROUND_OVER_AUTO_START_DURATION = 30000; // 30 seconds in milliseconds

// Helper: Start auto-advance timer when round is over
function startRoundOverAutoStart(roomId: string): void {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Clear existing auto-start timer
  if (room.roundOverAutoStartTimeoutId) {
    clearTimeout(room.roundOverAutoStartTimeoutId);
  }

  // Record when round over timer started
  room.roundOverTimerStartedAt = Date.now();

  // Start 30-second timer to auto-start next round
  room.roundOverAutoStartTimeoutId = setTimeout(() => {
    console.log(`[GameManager] Auto-starting next round for room ${roomId}`);
    handleRoundOverAutoStart(roomId);
  }, ROUND_OVER_AUTO_START_DURATION);

  console.log(`[GameManager] Round over - 30 second auto-start timer started`);
}

// Helper: Clear round over auto-start timer
function clearRoundOverAutoStart(roomId: string): void {
  const room = gameRooms.get(roomId);
  if (!room) return;

  if (room.roundOverAutoStartTimeoutId) {
    clearTimeout(room.roundOverAutoStartTimeoutId);
    room.roundOverAutoStartTimeoutId = undefined;
  }
  room.roundOverTimerStartedAt = null;
}

// Helper: Handle auto-start next round
function handleRoundOverAutoStart(roomId: string): void {
  const room = gameRooms.get(roomId);
  if (!room || room.state !== 'round-over') return;

  console.log(`[GameManager] Auto-starting round ${room.currentRound + 1}`);

  // Check if game is over
  if (room.currentRound >= (room.maxRounds || room.totalRounds || 3)) {
    room.state = 'game-over';
    console.log(`[GameManager] Game over after auto-start check`);
    return;
  }

  // Start next round
  room.currentRound++;
  room.currentPickerIndex = ((room.currentPickerIndex || 0) + 1) % room.players.length;
  room.state = 'subject-selection';
  room.currentSubject = null;
  room.questions = [];
  room.currentQuestionIndex = 0;
  room.answers.clear();
  
  // Reset player progress and ready status
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
  });
  room.playerTimers.clear();
  room.playersFinished.clear();
  room.playersReady.clear();
  room.roundOverTimerStartedAt = null;

  // Start timer for subject selection
  startSubjectTimer(roomId);

  console.log(`[GameManager] Auto-started round ${room.currentRound}`);
}

// Helper: Start timer for a specific player
function startPlayerTimer(roomId: string, playerId: string): void {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Clear existing timer for this player
  const existingTimer = playerTimerIds.get(playerId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Record when timer started
  room.playerTimers.set(playerId, Date.now());

  // Start new timer
  const timerId = setTimeout(() => {
    console.log(`[GameManager] Timer expired for player ${playerId}`);
    handlePlayerQuestionTimeout(roomId, playerId);
  }, TIMER_DURATION);

  playerTimerIds.set(playerId, timerId);
}

// Helper: Clear timer for a specific player
function clearPlayerTimer(playerId: string): void {
  const timerId = playerTimerIds.get(playerId);
  if (timerId) {
    clearTimeout(timerId);
    playerTimerIds.delete(playerId);
  }
}

// Helper: Handle timeout for a specific player's question
function handlePlayerQuestionTimeout(roomId: string, playerId: string): void {
  const room = gameRooms.get(roomId);
  if (!room || room.state !== 'playing') return;

  const playerProgress = room.playerProgress.get(playerId) || 0;
  
  // Check if player already finished or answered
  if (room.playersFinished.has(playerId)) return;
  
  const currentQuestion = room.questions[playerProgress];
  if (!currentQuestion) return;

  const answerKey = `${playerId}_${currentQuestion.id}`;
  if (room.answers.has(answerKey)) return; // Already answered

  console.log(`[GameManager] Player ${playerId} timeout on question ${playerProgress + 1}`);

  // Mark as timeout (-1)
  room.answers.set(answerKey, -1);

  // Deduct point
  const currentScore = room.scores.get(playerId) || 0;
  room.scores.set(playerId, Math.max(0, currentScore - 1));

  // Move player to next question
  const newProgress = playerProgress + 1;
  room.playerProgress.set(playerId, newProgress);

  // Check if player finished all questions
  if (newProgress >= room.questions.length) {
    room.playersFinished.add(playerId);
    console.log(`[GameManager] Player ${playerId} finished all questions (with timeouts)`);

    // Check if both players finished
    const allPlayersFinished = room.players.every(p => room.playersFinished.has(p.id));
    if (allPlayersFinished) {
      room.state = 'round-over';
      
      // Start 30-second auto-start timer
      startRoundOverAutoStart(roomId);
      
      console.log(`[GameManager] Round ${room.currentRound} over - both players finished`);
    }
  } else {
    // Start timer for player's next question
    startPlayerTimer(roomId, playerId);
  }
}

// Helper: Start timer for subject selection (still global)
function startSubjectTimer(roomId: string): void {
  const room = gameRooms.get(roomId);
  if (!room) return;

  // Clear existing timer
  if (room.timerTimeoutId) {
    clearTimeout(room.timerTimeoutId);
  }

  // Start new timer
  room.timerStartedAt = Date.now();
  room.timerDuration = TIMER_DURATION;
  
  room.timerTimeoutId = setTimeout(() => {
    console.log(`[GameManager] Subject selection timeout for room ${roomId}`);
    handleSubjectSelectionTimeout(roomId);
  }, TIMER_DURATION);
}

// Helper: Clear subject selection timer
function clearSubjectTimer(roomId: string): void {
  const room = gameRooms.get(roomId);
  if (!room) return;

  if (room.timerTimeoutId) {
    clearTimeout(room.timerTimeoutId);
    room.timerTimeoutId = undefined;
  }
  room.timerStartedAt = null;
}

// Helper: Get remaining time for a room
export function getRemainingTime(roomId: string): number {
  const room = gameRooms.get(roomId);
  if (!room || !room.timerStartedAt) return 0;

  const elapsed = Date.now() - room.timerStartedAt;
  const remaining = Math.max(0, room.timerDuration - elapsed);
  return remaining;
}

// Helper: Get available subjects
export function getSubjects(): string[] {
  const subjects = new Set(questions.map(q => q.subject));
  return Array.from(subjects);
}

// Helper: Get random questions for a subject
function getRandomQuestions(subject: string, count: number = 5): Question[] {
  const subjectQuestions = questions.filter(q => q.subject === subject);
  const shuffled = [...subjectQuestions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Helper: Generate unique room ID
function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper: Get random subject
function getRandomSubject(): string {
  const subjects = getSubjects();
  return subjects[Math.floor(Math.random() * subjects.length)];
}

// Timeout handler: Subject selection timeout
function handleSubjectSelectionTimeout(roomId: string): void {
  const room = gameRooms.get(roomId);
  if (!room || room.state !== 'subject-selection') return;

  console.log(`[GameManager] Subject selection timeout for room ${roomId}`);
  
  // Pick random subject
  const randomSubject = getRandomSubject();
  const selectedQuestions = getRandomQuestions(randomSubject, 5);
  
  // Update room
  room.currentSubject = randomSubject;
  room.questions = selectedQuestions;
  room.currentQuestionIndex = 0;
  room.state = 'playing';
  room.answers.clear();
  
  // Initialize player progress
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
    room.playerTimers.set(p.id, Date.now());
  });
  room.playersFinished.clear();
  
  // Start timer for each player's first question
  room.players.forEach(p => startPlayerTimer(roomId, p.id));
  
  console.log(`[GameManager] Auto-selected subject: ${randomSubject}`);
}

// Add player to matchmaking queue
export function joinMatchmaking(player: Player): { success: boolean; message?: string; roomId?: string } {
  // Check if player already in a game
  const existingRoom = playerToRoom.get(player.id);
  if (existingRoom && gameRooms.has(existingRoom)) {
    return { success: true, roomId: existingRoom, message: 'Already in game' };
  }

  // Check if player already in queue
  const inQueue = matchmakingQueue.find(p => p.id === player.id);
  if (inQueue) {
    return { success: true, message: 'Already in queue' };
  }

  // Add to queue
  matchmakingQueue.push(player);

  // Try to match
  if (matchmakingQueue.length >= 2) {
    const player1 = matchmakingQueue.shift()!;
    const player2 = matchmakingQueue.shift()!;

    // Create game room
    const roomId = generateRoomId();
    const gameRoom: GameRoom = {
      id: roomId,
      players: [player1, player2],
      currentRound: 1,
      maxRounds: 3,
      state: 'subject-selection',
      currentPickerIndex: 0,
      currentSubject: null,
      currentQuestionIndex: 0,
      questions: [],
      answers: new Map(),
      scores: new Map([[player1.id, 0], [player2.id, 0]]),
      timerStartedAt: null,
      timerDuration: TIMER_DURATION,
      playerProgress: new Map([[player1.id, 0], [player2.id, 0]]),
      playerTimers: new Map(),
      playersFinished: new Set(),
      roundOverTimerStartedAt: null,
      playersReady: new Set(),
    };

    gameRooms.set(roomId, gameRoom);
    playerToRoom.set(player1.id, roomId);
    playerToRoom.set(player2.id, roomId);

    // Start timer for subject selection
    startSubjectTimer(roomId);

    console.log(`[GameManager] Match found! Room: ${roomId}, timer started`);
    return { success: true, roomId, message: 'Match found!' };
  }

  return { success: true, message: 'Waiting for opponent...' };
}

// Check match status
export function checkMatchStatus(playerId: string): { 
  matched: boolean; 
  roomId?: string;
  opponent?: Player;
} {
  const roomId = playerToRoom.get(playerId);
  if (roomId && gameRooms.has(roomId)) {
    const room = gameRooms.get(roomId)!;
    const opponent = room.players.find(p => p.id !== playerId);
    return { matched: true, roomId, opponent };
  }
  return { matched: false };
}

// Get game state for a player
export function getGameState(playerId: string): GameRoom | null {
  const roomId = playerToRoom.get(playerId);
  if (roomId && gameRooms.has(roomId)) {
    return gameRooms.get(roomId)!;
  }
  return null;
}

// Select subject
export function selectSubject(playerId: string, subject: string): { 
  success: boolean; 
  message?: string;
  questions?: Question[];
} {
  console.log(`[GameManager] Select subject called - playerId: ${playerId}, subject: ${subject}`);
  
  const roomId = playerToRoom.get(playerId);
  console.log(`[GameManager] Room ID for player: ${roomId}`);
  
  if (!roomId || !gameRooms.has(roomId)) {
    console.log(`[GameManager] Room not found! playerToRoom has ${playerToRoom.size} entries, gameRooms has ${gameRooms.size} entries`);
    return { success: false, message: 'Game room not found' };
  }

  const room = gameRooms.get(roomId)!;
  console.log(`[GameManager] Room state: ${room.state}, currentPickerIndex: ${room.currentPickerIndex}`);

  // Verify it's this player's turn to pick
  const currentPicker = room.players[room.currentPickerIndex || 0];
  console.log(`[GameManager] Current picker: ${currentPicker.id}, requesting player: ${playerId}`);
  
  if (currentPicker.id !== playerId) {
    return { success: false, message: 'Not your turn to pick' };
  }

  // Verify state
  if (room.state !== 'subject-selection') {
    return { success: false, message: `Not in subject selection phase (current: ${room.state})` };
  }

  // Get questions
  const selectedQuestions = getRandomQuestions(subject, 5);
  
  // Clear subject selection timer
  clearSubjectTimer(roomId);
  
  // Update room
  room.currentSubject = subject;
  room.questions = selectedQuestions;
  room.currentQuestionIndex = 0;
  room.state = 'playing';
  room.answers.clear();
  
  // Reset player progress for new round
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
    room.playerTimers.set(p.id, Date.now());
    // Start timer for each player's first question
    startPlayerTimer(roomId, p.id);
  });
  room.playersFinished.clear();

  console.log(`[GameManager] Subject selected: ${subject}, starting round ${room.currentRound}, player timers started`);

  return { success: true, questions: selectedQuestions };
}

// Submit answer
export function submitAnswer(playerId: string, questionId: string, answerIndex: number): {
  success: boolean;
  message?: string;
  playerFinished?: boolean;
  roundOver?: boolean;
  myResult?: {
    correct: boolean;
    score: number;
  };
} {
  const roomId = playerToRoom.get(playerId);
  if (!roomId || !gameRooms.has(roomId)) {
    console.log(`[GameManager] Submit answer - room not found for player ${playerId}`);
    return { success: false, message: 'Game room not found' };
  }

  const room = gameRooms.get(roomId)!;

  // Verify state
  if (room.state !== 'playing') {
    console.log(`[GameManager] Submit answer - wrong state: ${room.state}`);
    return { success: false, message: 'Not in playing phase' };
  }

  // Store answer
  const answerKey = `${playerId}_${questionId}`;
  room.answers.set(answerKey, answerIndex);

  // Get player's current progress
  const playerProgress = room.playerProgress.get(playerId) || 0;
  const currentQuestion = room.questions[playerProgress];
  
  // Calculate if answer is correct
  const correct = answerIndex === currentQuestion.correctAnswer;
  
  // Update score
  if (correct) {
    const currentScore = room.scores.get(playerId) || 0;
    room.scores.set(playerId, currentScore + 1);
  } else if (answerIndex === -1) {
    // Timeout - deduct point
    const currentScore = room.scores.get(playerId) || 0;
    room.scores.set(playerId, Math.max(0, currentScore - 1));
  }

  // Move this player to next question
  const newProgress = playerProgress + 1;
  room.playerProgress.set(playerId, newProgress);
  
  console.log(`[GameManager] Player ${playerId} answered question ${playerProgress + 1}/5, correct: ${correct}`);

  // Check if this player finished all 5 questions
  if (newProgress >= room.questions.length) {
    room.playersFinished.add(playerId);
    clearPlayerTimer(playerId);
    console.log(`[GameManager] Player ${playerId} finished all questions!`);
    
    // Check if both players finished
    const allPlayersFinished = room.players.every(p => room.playersFinished.has(p.id));
    
    if (allPlayersFinished) {
      // Round over - clear all player timers
      room.state = 'round-over';
      room.players.forEach(p => clearPlayerTimer(p.id));
      clearSubjectTimer(roomId);
      
      // Start 30-second auto-start timer
      startRoundOverAutoStart(roomId);
      
      console.log(`[GameManager] Round ${room.currentRound} over - both players finished`);
      return { 
        success: true, 
        playerFinished: true, 
        roundOver: true,
        myResult: { correct, score: room.scores.get(playerId) || 0 }
      };
    }
    
    // This player finished but waiting for opponent
    return { 
      success: true, 
      playerFinished: true, 
      roundOver: false,
      myResult: { correct, score: room.scores.get(playerId) || 0 }
    };
  }

  // Player has more questions - start timer for next question
  startPlayerTimer(roomId, playerId);
  
  return { 
    success: true, 
    playerFinished: false,
    myResult: { correct, score: room.scores.get(playerId) || 0 }
  };
}

// Start next round
export function startNextRound(playerId: string): {
  success: boolean;
  message?: string;
  gameOver?: boolean;
  winner?: Player;
} {
  const roomId = playerToRoom.get(playerId);
  if (!roomId || !gameRooms.has(roomId)) {
    return { success: false, message: 'Game room not found' };
  }

  const room = gameRooms.get(roomId)!;

  // Verify state
  if (room.state !== 'round-over') {
    return { success: false, message: 'Round not over yet' };
  }

  // Mark this player as ready
  room.playersReady.add(playerId);
  console.log(`[GameManager] Player ${playerId} ready for next round (${room.playersReady.size}/${room.players.length})`);

  // Check if both players are ready
  const allPlayersReady = room.players.every(p => room.playersReady.has(p.id));
  
  if (!allPlayersReady) {
    // Not all players ready yet - keep waiting
    console.log(`[GameManager] Waiting for other player to be ready...`);
    return { success: true, message: 'Waiting for opponent' };
  }

  // Both players ready - clear the auto-start timer
  clearRoundOverAutoStart(roomId);
  console.log(`[GameManager] Both players ready - starting next round`);

  // Check if game is over
  if (room.currentRound >= (room.maxRounds || room.totalRounds || 3)) {
    room.state = 'game-over';
    
    // Determine winner
    const scores = Array.from(room.scores.entries());
    scores.sort((a, b) => b[1] - a[1]);
    const winnerId = scores[0][0];
    const winner = room.players.find(p => p.id === winnerId);

    console.log(`[GameManager] Game over! Winner: ${winner?.username}`);
    
    return { success: true, gameOver: true, winner };
  }

  // Start next round
  room.currentRound++;
  room.currentPickerIndex = ((room.currentPickerIndex || 0) + 1) % room.players.length;
  room.state = 'subject-selection';
  room.currentSubject = null;
  room.questions = [];
  room.currentQuestionIndex = 0;
  room.answers.clear();
  
  // Reset player progress and ready status
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
  });
  room.playerTimers.clear();
  room.playersFinished.clear();
  room.playersReady.clear();

  // Start timer for subject selection
  startSubjectTimer(roomId);

  console.log(`[GameManager] Starting round ${room.currentRound}, timer started`);

  return { success: true, gameOver: false };
}

// Cleanup: Remove player from game (on disconnect/leave)
export function removePlayer(playerId: string): void {
  // Remove from queue
  const queueIndex = matchmakingQueue.findIndex(p => p.id === playerId);
  if (queueIndex !== -1) {
    matchmakingQueue.splice(queueIndex, 1);
    console.log(`[GameManager] Removed ${playerId} from queue`);
  }

  // Remove from game room
  const roomId = playerToRoom.get(playerId);
  if (roomId && gameRooms.has(roomId)) {
    gameRooms.delete(roomId);
    const room = gameRooms.get(roomId);
    if (room) {
      room.players.forEach(p => playerToRoom.delete(p.id));
    }
    console.log(`[GameManager] Removed room ${roomId}`);
  }
  playerToRoom.delete(playerId);
}

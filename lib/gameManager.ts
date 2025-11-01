// Game state manager with Redis persistence
import questions from '@/data/questions.json';
import { Player, GameRoom, Question } from './types';
import * as storage from './storage';

// Timers can't be stored in Redis - keep in memory
const playerTimerIds = new Map<string, NodeJS.Timeout>();
const roomTimerIds = new Map<string, { subject?: NodeJS.Timeout; roundOver?: NodeJS.Timeout }>();

console.log(`[GameManager] Using Redis storage`);

// Timer constants
const SUBJECT_SELECTION_DURATION = 12000; // 12 seconds for choosing subject
const TIMER_DURATION = 18000; // 18 seconds for answering questions
const ROUND_OVER_AUTO_START_DURATION = 30000; // 30 seconds in milliseconds

// Helper: Start auto-advance timer when round is over
async function startRoundOverAutoStart(roomId: string): Promise<void> {
  const room = await storage.getGameRoom(roomId);
  if (!room) return;

  // Clear existing auto-start timer
  clearRoundOverAutoStart(roomId);

  // Record when round over timer started and save to Redis FIRST
  room.roundOverTimerStartedAt = Date.now();
  await storage.setGameRoom(roomId, room);

  // Start 30-second timer to auto-start next round
  const timerId = setTimeout(() => {
    console.log(`[GameManager] Auto-starting next round for room ${roomId}`);
    handleRoundOverAutoStart(roomId);
  }, ROUND_OVER_AUTO_START_DURATION);

  // Store timeout ID in memory
  const timers = roomTimerIds.get(roomId) || {};
  timers.roundOver = timerId;
  roomTimerIds.set(roomId, timers);

  console.log(`[GameManager] Round over - 30 second auto-start timer started`);
}

// Helper: Clear round over auto-start timer
function clearRoundOverAutoStart(roomId: string): void {
  const timers = roomTimerIds.get(roomId);
  if (timers?.roundOver) {
    clearTimeout(timers.roundOver);
    timers.roundOver = undefined;
  }
}

// Helper: Handle auto-start next round
async function handleRoundOverAutoStart(roomId: string): Promise<void> {
  const room = await storage.getGameRoom(roomId);
  if (!room || room.state !== 'round-over') return;

  console.log(`[GameManager] Auto-starting round ${room.currentRound + 1}`);

  // Check if game is over
  if (room.currentRound >= (room.maxRounds || room.totalRounds || 3)) {
    room.state = 'game-over';
    console.log(`[GameManager] Game over after auto-start check`);
    await storage.setGameRoom(roomId, room);
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
  
  // Set subject selection timer timestamp (12 seconds)
  room.timerStartedAt = Date.now();
  room.timerDuration = SUBJECT_SELECTION_DURATION;

  // Save room back to Redis
  await storage.setGameRoom(roomId, room);

  // Start timer for subject selection
  await startSubjectTimer(roomId);

  console.log(`[GameManager] Auto-started round ${room.currentRound}`);
}

// Helper: Start timer for a specific player
async function startPlayerTimer(roomId: string, playerId: string): Promise<void> {
  // Clear existing timer for this player
  clearPlayerTimer(playerId);

  // Update room with timer start time
  const room = await storage.getGameRoom(roomId);
  if (room) {
    room.playerTimers.set(playerId, Date.now());
    await storage.setGameRoom(roomId, room);
  }

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
async function handlePlayerQuestionTimeout(roomId: string, playerId: string): Promise<void> {
  const room = await storage.getGameRoom(roomId);
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
      
      // Save room back to Redis
      await storage.setGameRoom(roomId, room);
      
      // Start 30-second auto-start timer
      await startRoundOverAutoStart(roomId);
      
      console.log(`[GameManager] Round ${room.currentRound} over - both players finished`);
      return;
    }
  }

  // Save room back to Redis
  await storage.setGameRoom(roomId, room);

  if (newProgress < room.questions.length) {
    // Start timer for player's next question
    await startPlayerTimer(roomId, playerId);
  }
}

// Helper: Start timer for subject selection
async function startSubjectTimer(roomId: string): Promise<void> {
  // Clear existing timer
  clearSubjectTimer(roomId);
  
  // Start new timer for backend timeout handling (12 seconds)
  const timerId = setTimeout(() => {
    console.log(`[GameManager] Subject selection timeout for room ${roomId}`);
    handleSubjectSelectionTimeout(roomId);
  }, SUBJECT_SELECTION_DURATION);

  // Store timeout ID in memory
  const timers = roomTimerIds.get(roomId) || {};
  timers.subject = timerId;
  roomTimerIds.set(roomId, timers);
}

// Helper: Clear subject selection timer
function clearSubjectTimer(roomId: string): void {
  const timers = roomTimerIds.get(roomId);
  if (timers?.subject) {
    clearTimeout(timers.subject);
    timers.subject = undefined;
  }
}

// Helper: Get remaining time for a room
export async function getRemainingTime(roomId: string): Promise<number> {
  const room = await storage.getGameRoom(roomId);
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
async function handleSubjectSelectionTimeout(roomId: string): Promise<void> {
  const room = await storage.getGameRoom(roomId);
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
  
  // Initialize player progress (timer will be set by startPlayerTimer)
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
  });
  room.playersFinished.clear();

  // Save room back to Redis
  await storage.setGameRoom(roomId, room);
  
  // Start timer for each player's first question (sets timestamp in Redis)
  for (const p of room.players) {
    await startPlayerTimer(roomId, p.id);
  }
  
  console.log(`[GameManager] Auto-selected subject: ${randomSubject}`);
}

// Add player to matchmaking queue
export async function joinMatchmaking(player: Player): Promise<{ success: boolean; message?: string; roomId?: string }> {
  // Check if player already in a game
  const existingRoom = await storage.getPlayerRoom(player.id);
  if (existingRoom) {
    const room = await storage.getGameRoom(existingRoom);
    if (room) {
      return { success: true, roomId: existingRoom, message: 'Already in game' };
    }
  }

  // Check if player already in queue
  const queue = await storage.getMatchmakingQueue();
  const inQueue = queue.find(p => p.id === player.id);
  if (inQueue) {
    return { success: true, message: 'Already in queue' };
  }

  // Add to queue
  queue.push(player);
  await storage.setMatchmakingQueue(queue);

  // Try to match
  if (queue.length >= 2) {
    const player1 = queue.shift()!;
    const player2 = queue.shift()!;
    await storage.setMatchmakingQueue(queue);

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
      timerStartedAt: Date.now(), // Set timestamp immediately
      timerDuration: SUBJECT_SELECTION_DURATION, // 12 seconds for subject selection
      playerProgress: new Map([[player1.id, 0], [player2.id, 0]]),
      playerTimers: new Map(),
      playersFinished: new Set(),
      roundOverTimerStartedAt: null,
      playersReady: new Set(),
    };

    await storage.setGameRoom(roomId, gameRoom);
    await storage.setPlayerRoom(player1.id, roomId);
    await storage.setPlayerRoom(player2.id, roomId);

    // Start timer for subject selection
    await startSubjectTimer(roomId);

    console.log(`[GameManager] Match found! Room: ${roomId}, timer started`);
    return { success: true, roomId, message: 'Match found!' };
  }

  return { success: true, message: 'Waiting for opponent...' };
}

// Check match status
export async function checkMatchStatus(playerId: string): Promise<{ 
  matched: boolean; 
  roomId?: string;
  opponent?: Player;
}> {
  const roomId = await storage.getPlayerRoom(playerId);
  if (roomId) {
    const room = await storage.getGameRoom(roomId);
    if (room) {
      const opponent = room.players.find(p => p.id !== playerId);
      return { matched: true, roomId, opponent };
    }
  }
  return { matched: false };
}

// Get game state for a player
export async function getGameState(playerId: string): Promise<GameRoom | null> {
  const roomId = await storage.getPlayerRoom(playerId);
  if (roomId) {
    return await storage.getGameRoom(roomId);
  }
  return null;
}

// Select subject
export async function selectSubject(playerId: string, subject: string): Promise<{ 
  success: boolean; 
  message?: string;
  questions?: Question[];
}> {
  console.log(`[GameManager] Select subject called - playerId: ${playerId}, subject: ${subject}`);
  
  const roomId = await storage.getPlayerRoom(playerId);
  console.log(`[GameManager] Room ID for player: ${roomId}`);
  
  if (!roomId) {
    console.log(`[GameManager] Room not found for player ${playerId}`);
    return { success: false, message: 'Game room not found' };
  }

  const room = await storage.getGameRoom(roomId);
  if (!room) {
    console.log(`[GameManager] Room ${roomId} not found in storage`);
    return { success: false, message: 'Game room not found' };
  }

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
  });
  room.playersFinished.clear();
  
  // Save room back to Redis before starting timers
  await storage.setGameRoom(roomId, room);
  
  // Start timer for each player's first question
  for (const p of room.players) {
    await startPlayerTimer(roomId, p.id);
  }

  // Save room back to Redis
  await storage.setGameRoom(roomId, room);

  console.log(`[GameManager] Subject selected: ${subject}, starting round ${room.currentRound}, player timers started`);

  return { success: true, questions: selectedQuestions };
}

// Submit answer
export async function submitAnswer(playerId: string, questionId: string, answerIndex: number): Promise<{
  success: boolean;
  message?: string;
  playerFinished?: boolean;
  roundOver?: boolean;
  myResult?: {
    correct: boolean;
    score: number;
  };
}> {
  const roomId = await storage.getPlayerRoom(playerId);
  if (!roomId) {
    console.log(`[GameManager] Submit answer - room not found for player ${playerId}`);
    return { success: false, message: 'Game room not found' };
  }

  const room = await storage.getGameRoom(roomId);
  if (!room) {
    console.log(`[GameManager] Room ${roomId} not found in storage`);
    return { success: false, message: 'Game room not found' };
  }

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
      await startRoundOverAutoStart(roomId);
      
      console.log(`[GameManager] Round ${room.currentRound} over - both players finished`);
      
      // Save room back to Redis
      await storage.setGameRoom(roomId, room);
      
      return { 
        success: true, 
        playerFinished: true, 
        roundOver: true,
        myResult: { correct, score: room.scores.get(playerId) || 0 }
      };
    }
    
    // Save room back to Redis
    await storage.setGameRoom(roomId, room);
    
    // This player finished but waiting for opponent
    return { 
      success: true, 
      playerFinished: true, 
      roundOver: false,
      myResult: { correct, score: room.scores.get(playerId) || 0 }
    };
  }

  // Save room back to Redis
  await storage.setGameRoom(roomId, room);

  // Player has more questions - start timer for next question
  await startPlayerTimer(roomId, playerId);
  
  return { 
    success: true, 
    playerFinished: false,
    myResult: { correct, score: room.scores.get(playerId) || 0 }
  };
}

// Start next round
export async function startNextRound(playerId: string): Promise<{
  success: boolean;
  message?: string;
  gameOver?: boolean;
  winner?: Player;
}> {
  const roomId = await storage.getPlayerRoom(playerId);
  if (!roomId) {
    return { success: false, message: 'Game room not found' };
  }

  const room = await storage.getGameRoom(roomId);
  if (!room) {
    return { success: false, message: 'Game room not found' };
  }

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
    
    // Save room back to Redis
    await storage.setGameRoom(roomId, room);
    
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
    
    // Save room back to Redis
    await storage.setGameRoom(roomId, room);
    
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
  room.roundOverTimerStartedAt = null; // Clear round-over timer
  
  // Set subject selection timer timestamp BEFORE saving to avoid race condition (12 seconds)
  room.timerStartedAt = Date.now();
  room.timerDuration = SUBJECT_SELECTION_DURATION;

  // Save room back to Redis with timer already set
  await storage.setGameRoom(roomId, room);

  // Start the backend setTimeout timer
  await startSubjectTimer(roomId);

  console.log(`[GameManager] Starting round ${room.currentRound}, timer started`);

  return { success: true, gameOver: false };
}

// Cleanup: Remove player from game (on disconnect/leave)
export async function removePlayer(playerId: string): Promise<void> {
  // Remove from queue
  const queue = await storage.getMatchmakingQueue();
  const queueIndex = queue.findIndex(p => p.id === playerId);
  if (queueIndex !== -1) {
    queue.splice(queueIndex, 1);
    await storage.setMatchmakingQueue(queue);
    console.log(`[GameManager] Removed ${playerId} from queue`);
  }

  // Remove from game room
  const roomId = await storage.getPlayerRoom(playerId);
  if (roomId) {
    const room = await storage.getGameRoom(roomId);
    if (room) {
      // Remove all players from this room
      for (const p of room.players) {
        await storage.deletePlayerRoom(p.id);
      }
    }
    // Delete the room
    await storage.deleteGameRoom(roomId);
    console.log(`[GameManager] Removed room ${roomId}`);
  }
  // Delete player mapping
  await storage.deletePlayerRoom(playerId);
}

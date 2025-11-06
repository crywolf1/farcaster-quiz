// Game state manager with Redis persistence
import { Player, GameRoom, Question } from './types';
import * as storage from './storage';
import { getApprovedQuestions, updatePlayerScore } from './mongodb';
import { calculateWinScore } from './scoreUtils';

// Timers can't be stored in Redis - keep in memory
const playerTimerIds = new Map<string, NodeJS.Timeout>();
const roomTimerIds = new Map<string, { subject?: NodeJS.Timeout; roundOver?: NodeJS.Timeout }>();

console.log(`[GameManager] Using Redis storage`);

// Timer constants
const SUBJECT_SELECTION_DURATION = 30000; // 30 seconds for choosing subject (with buffer for network delay)
const TIMER_DURATION = 18000; // 18 seconds for answering questions
const ROUND_OVER_AUTO_START_DURATION = 15000; // 15 seconds in milliseconds

// Helper: Start auto-advance timer when round is over
async function startRoundOverAutoStart(roomId: string): Promise<void> {
  const room = await storage.getGameRoom(roomId);
  if (!room) {
    console.log(`[GameManager] startRoundOverAutoStart - room ${roomId} not found!`);
    return;
  }

  // Clear existing auto-start timer
  clearRoundOverAutoStart(roomId);

  // Record when round over timer started and save to Redis FIRST
  const timestamp = Date.now();
  room.roundOverTimerStartedAt = timestamp;
  await storage.setGameRoom(roomId, room);
  console.log(`[GameManager] Set roundOverTimerStartedAt=${timestamp} for room ${roomId}, saved to Redis`);

  // Start 15-second timer to auto-start next round
  const timerId = setTimeout(() => {
    console.log(`[GameManager] Auto-starting next round for room ${roomId}`);
    handleRoundOverAutoStart(roomId);
  }, ROUND_OVER_AUTO_START_DURATION);

  // Store timeout ID in memory
  const timers = roomTimerIds.get(roomId) || {};
  timers.roundOver = timerId;
  roomTimerIds.set(roomId, timers);

  console.log(`[GameManager] Round over - 15 second auto-start timer started, countdown from ${ROUND_OVER_AUTO_START_DURATION}ms`);
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
  if (room.currentRound >= (room.maxRounds || room.totalRounds || 6)) {
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
  
  // Get 3 new random subjects for this round (excluding used ones)
  const allSubjects = await getSubjects();
  const usedSubjectsArray = Array.from(room.usedSubjects || new Set<string>()) as string[];
  room.availableSubjectsForRound = getRandomSubjectsForRound(usedSubjectsArray, allSubjects, 3);
  
  // Reset player progress and ready status
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
  });
  room.playerTimers.clear();
  room.playersFinished.clear();
  room.playersReady.clear();
  room.roundOverTimerStartedAt = null;
  
  // Set subject selection timer timestamp with grace period
  room.timerStartedAt = Date.now() + 2000; // Add 2-second grace period
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
export async function getSubjects(): Promise<string[]> {
  const dbQuestions = await getApprovedQuestions();
  const subjects = new Set(dbQuestions.map(q => q.subject));
  return Array.from(subjects);
}

// Helper: Shuffle answers for a question and update correctAnswer index
function shuffleAnswers(question: Question): Question {
  const shuffled = [...question.options];
  const correctOption = question.options[question.correctAnswer];
  
  // Fisher-Yates shuffle algorithm
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // Find the new index of the correct answer
  const newCorrectIndex = shuffled.indexOf(correctOption);
  
  return {
    ...question,
    options: shuffled,
    correctAnswer: newCorrectIndex
  };
}

// Helper: Get random questions for a subject (1 easy, 1 moderate, 1 hard)
async function getRandomQuestions(subject: string): Promise<Question[]> {
  // Load questions from database
  const dbQuestions = await getApprovedQuestions();
  
  // Convert to Question format and filter by subject
  const allQuestions: Question[] = dbQuestions.map((q, index) => ({
    id: q._id?.toString() || `q${index}`,
    subject: q.subject,
    difficulty: q.difficulty || 'moderate',
    question: q.question,
    options: q.answers,
    correctAnswer: q.correctAnswer,
    submittedBy: q.submittedBy,
  }));
  
  const subjectQuestions = allQuestions.filter(q => q.subject === subject);
  
  console.log(`[GameManager] Found ${subjectQuestions.length} questions for subject: ${subject}`);
  
  // CRITICAL FIX: Ensure we have at least 3 questions
  if (subjectQuestions.length < 3) {
    console.error(`[GameManager] ⚠️ Not enough questions for ${subject}! Only ${subjectQuestions.length} available, need minimum 3`);
    // Return whatever we have but log the issue
    const available = subjectQuestions.slice(0, 3).map(q => shuffleAnswers(q));
    console.log(`[GameManager] Returning ${available.length} questions (less than required 3)`);
    return available.sort(() => Math.random() - 0.5);
  }
  
  // Get one question from each difficulty level
  const easyQuestions = subjectQuestions.filter(q => q.difficulty === 'easy');
  const moderateQuestions = subjectQuestions.filter(q => q.difficulty === 'moderate');
  const hardQuestions = subjectQuestions.filter(q => q.difficulty === 'hard');
  
  console.log(`[GameManager] Question distribution - Easy: ${easyQuestions.length}, Moderate: ${moderateQuestions.length}, Hard: ${hardQuestions.length}`);
  
  const selectedQuestions: Question[] = [];
  
  // Pick one random question from each difficulty
  if (easyQuestions.length > 0) {
    const randomEasy = easyQuestions[Math.floor(Math.random() * easyQuestions.length)];
    selectedQuestions.push(shuffleAnswers(randomEasy));
  }
  
  if (moderateQuestions.length > 0) {
    const randomModerate = moderateQuestions[Math.floor(Math.random() * moderateQuestions.length)];
    selectedQuestions.push(shuffleAnswers(randomModerate));
  }
  
  if (hardQuestions.length > 0) {
    const randomHard = hardQuestions[Math.floor(Math.random() * hardQuestions.length)];
    selectedQuestions.push(shuffleAnswers(randomHard));
  }
  
  // CRITICAL FIX: If we don't have 3 questions yet, fill in with random questions from the subject
  while (selectedQuestions.length < 3 && subjectQuestions.length > selectedQuestions.length) {
    // Get questions we haven't selected yet
    const selectedIds = selectedQuestions.map(q => q.id);
    const remainingQuestions = subjectQuestions.filter(q => !selectedIds.includes(q.id));
    
    if (remainingQuestions.length > 0) {
      const randomQuestion = remainingQuestions[Math.floor(Math.random() * remainingQuestions.length)];
      selectedQuestions.push(shuffleAnswers(randomQuestion));
      console.log(`[GameManager] Added filler question to reach 3 questions (now have ${selectedQuestions.length})`);
    } else {
      break;
    }
  }
  
  console.log(`[GameManager] Selected ${selectedQuestions.length} questions for ${subject}`);
  
  // CRITICAL FIX: Final safety check
  if (selectedQuestions.length === 0) {
    console.error(`[GameManager] ❌ CRITICAL: No questions available for ${subject}!`);
    throw new Error(`No questions available for subject: ${subject}`);
  }
  
  // Shuffle the questions so they're not always in easy->moderate->hard order
  return selectedQuestions.sort(() => Math.random() - 0.5);
}

// Helper: Get random subjects for round (excluding used subjects)
function getRandomSubjectsForRound(usedSubjects: string[], allSubjects: string[], count: number = 3): string[] {
  const availableSubjects = allSubjects.filter(s => !usedSubjects.includes(s));
  
  // If not enough unused subjects, return what's available
  if (availableSubjects.length <= count) {
    return availableSubjects;
  }
  
  // Shuffle and return requested count
  const shuffled = [...availableSubjects].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Helper: Generate unique room ID
function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper: Get random subject
async function getRandomSubject(): Promise<string> {
  const subjects = await getSubjects();
  return subjects[Math.floor(Math.random() * subjects.length)];
}

// Timeout handler: Subject selection timeout
async function handleSubjectSelectionTimeout(roomId: string): Promise<void> {
  const room = await storage.getGameRoom(roomId);
  if (!room || room.state !== 'subject-selection') return;

  console.log(`[GameManager] Subject selection timeout for room ${roomId}`);
  
  // Pick random subject from available subjects for this round
  const randomSubject = room.availableSubjectsForRound[Math.floor(Math.random() * room.availableSubjectsForRound.length)];
  
  // CRITICAL FIX: Validate questions before proceeding
  let selectedQuestions: Question[] = [];
  try {
    selectedQuestions = await getRandomQuestions(randomSubject);
    
    if (selectedQuestions.length === 0) {
      console.error(`[GameManager] ❌ No questions for auto-selected subject ${randomSubject}, ending game`);
      room.state = 'game-over';
      await storage.setGameRoom(roomId, room);
      return;
    }
  } catch (error) {
    console.error(`[GameManager] ❌ Error auto-selecting subject ${randomSubject}:`, error);
    room.state = 'game-over';
    await storage.setGameRoom(roomId, room);
    return;
  }
  
  // Mark subject as used
  room.usedSubjects.add(randomSubject);
  
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
    
    // CRITICAL FIX: Prevent self-matching
    // If both players have the same FID, put player2 back in queue
    if (player1.fid === player2.fid) {
      console.log(`[GameManager] Prevented self-match for player ${player1.id}`);
      queue.unshift(player2); // Put player2 back in queue
      await storage.setMatchmakingQueue(queue);
      return { success: true, message: 'Waiting for opponent...' };
    }
    
    await storage.setMatchmakingQueue(queue);

    // Create game room
    const roomId = generateRoomId();
    const allSubjects = await getSubjects();
    const availableSubjects = getRandomSubjectsForRound([], allSubjects, 3);
    
    const gameRoom: GameRoom = {
      id: roomId,
      players: [player1, player2],
      currentRound: 1,
      maxRounds: 6,
      state: 'subject-selection',
      currentPickerIndex: 0,
      currentSubject: null,
      currentQuestionIndex: 0,
      questions: [],
      answers: new Map(),
      scores: new Map([[player1.id, 0], [player2.id, 0]]),
      timerStartedAt: Date.now() + 2000, // Add 2-second grace period for clients to connect
      timerDuration: SUBJECT_SELECTION_DURATION, // 30 seconds for subject selection
      playerProgress: new Map([[player1.id, 0], [player2.id, 0]]),
      playerTimers: new Map(),
      playersFinished: new Set(),
      roundOverTimerStartedAt: null,
      playersReady: new Set(),
      usedSubjects: new Set(),
      availableSubjectsForRound: availableSubjects,
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
  if (!roomId) {
    return null;
  }
  
  const room = await storage.getGameRoom(roomId);
  
  // Check if auto-start timer has elapsed (handles server restarts/cold starts)
  if (room && room.state === 'round-over' && room.roundOverTimerStartedAt) {
    const elapsed = Date.now() - room.roundOverTimerStartedAt;
    const autoStartDelay = ROUND_OVER_AUTO_START_DURATION;
    
    if (elapsed >= autoStartDelay) {
      console.log(`[GameManager] Auto-start timer elapsed (${elapsed}ms), triggering auto-start`);
      // Timer has elapsed - trigger auto-start immediately
      await handleRoundOverAutoStart(roomId);
      // Fetch the updated room
      return await storage.getGameRoom(roomId);
    } else {
      // Timer still running - ensure setTimeout is active (in case of cold start)
      if (!roomTimerIds.has(roomId) || !roomTimerIds.get(roomId)?.roundOver) {
        const remainingTime = autoStartDelay - elapsed;
        console.log(`[GameManager] Restarting auto-start timer with ${remainingTime}ms remaining`);
        const timerId = setTimeout(() => handleRoundOverAutoStart(roomId), remainingTime);
        const existingTimers = roomTimerIds.get(roomId) || {};
        roomTimerIds.set(roomId, { ...existingTimers, roundOver: timerId });
      }
    }
  }
  
  return room;
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

  // Verify subject is available for this round
  if (!room.availableSubjectsForRound.includes(subject)) {
    return { success: false, message: 'Subject not available for this round' };
  }

  // Get questions (1 easy, 1 moderate, 1 hard)
  let selectedQuestions: Question[] = [];
  try {
    selectedQuestions = await getRandomQuestions(subject);
    
    // CRITICAL FIX: Validate we have enough questions
    if (selectedQuestions.length === 0) {
      console.error(`[GameManager] ❌ No questions returned for ${subject}`);
      return { success: false, message: 'No questions available for this subject' };
    }
    
    console.log(`[GameManager] Successfully fetched ${selectedQuestions.length} questions for ${subject}`);
  } catch (error) {
    console.error(`[GameManager] ❌ Error fetching questions for ${subject}:`, error);
    return { success: false, message: 'Failed to load questions for this subject' };
  }
  
  // Mark subject as used
  room.usedSubjects.add(subject);
  
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
  gameOver?: boolean;
  winner?: Player;
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

  // Get player's current progress
  const playerProgress = room.playerProgress.get(playerId) || 0;
  
  // CRITICAL FIX: Validate question exists before accessing
  if (playerProgress >= room.questions.length) {
    console.error(`[GameManager] ❌ Invalid progress: ${playerProgress} >= ${room.questions.length} questions`);
    return { success: false, message: 'Question not found' };
  }
  
  const currentQuestion = room.questions[playerProgress];
  
  // CRITICAL FIX: Additional validation
  if (!currentQuestion) {
    console.error(`[GameManager] ❌ Question at index ${playerProgress} is undefined!`);
    return { success: false, message: 'Question not found' };
  }

  // Store answer
  const answerKey = `${playerId}_${questionId}`;
  room.answers.set(answerKey, answerIndex);
  
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
      // Clear all player timers
      room.players.forEach(p => clearPlayerTimer(p.id));
      clearSubjectTimer(roomId);
      
      // Check if this is the final round (game over)
      if (room.currentRound >= (room.maxRounds || room.totalRounds || 6)) {
        console.log(`[GameManager] Final round ${room.currentRound} complete - GAME OVER!`);
        room.state = 'game-over';
        
        // Determine winner
        const scores = Array.from(room.scores.entries());
        scores.sort((a, b) => b[1] - a[1]);
        const winnerId = scores[0][0];
        const winner = room.players.find(p => p.id === winnerId);
        
        console.log(`[GameManager] Game over! Winner: ${winner?.username}`);
        
        // SERVER-SIDE SCORE SAVING: Save both players' scores to MongoDB
        // This ensures scores are saved even if a player disconnects
        try {
          for (const player of room.players) {
            const correctAnswers = room.scores.get(player.id) || 0;
            const pointsToAward = calculateWinScore(correctAnswers); // Convert correct answers to points (1000 per answer)
            const isWinner = player.id === winnerId;
            
            // Only save if player has FID (authenticated via Farcaster)
            if (player.fid) {
              console.log(`[GameManager] 💾 Saving score for ${player.username} (FID: ${player.fid})`);
              console.log(`[GameManager]    - Correct Answers: ${correctAnswers}`);
              console.log(`[GameManager]    - Points to Award: ${pointsToAward}`);
              console.log(`[GameManager]    - Is Winner: ${isWinner}`);
              
              await updatePlayerScore(
                player.fid.toString(),
                player.username,
                player.pfpUrl || '',
                pointsToAward, // Award points, not raw score
                isWinner
              );
              
              console.log(`[GameManager] ✅ Score saved for ${player.username}`);
            } else {
              console.log(`[GameManager] ⚠️ Skipping score save for ${player.username} - no FID`);
            }
          }
        } catch (error) {
          console.error(`[GameManager] ❌ Error saving scores to MongoDB:`, error);
          // Don't block game end if score saving fails
        }
        
        // Save room back to Redis
        await storage.setGameRoom(roomId, room);
        
        return { 
          success: true, 
          playerFinished: true, 
          roundOver: true,
          gameOver: true,
          winner,
          myResult: { correct, score: room.scores.get(playerId) || 0 }
        };
      }
      
      // Not final round - go to round-over state
      room.state = 'round-over';
      
      // Save room state BEFORE starting timer (so startRoundOverAutoStart has latest state)
      await storage.setGameRoom(roomId, room);
      
      // Start 30-second auto-start timer (this will fetch, update timestamp, and save again)
      await startRoundOverAutoStart(roomId);
      
      console.log(`[GameManager] Round ${room.currentRound} over - both players finished`);
      
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
  console.log(`[GameManager] ✅ Player ${playerId} marked as ready`);
  console.log(`[GameManager] - playersReady Set:`, Array.from(room.playersReady));
  console.log(`[GameManager] - Ready count: ${room.playersReady.size}/${room.players.length}`);

  // Check if both players are ready
  const allPlayersReady = room.players.every(p => room.playersReady.has(p.id));
  console.log(`[GameManager] - All players ready?`, allPlayersReady);
  
  if (!allPlayersReady) {
    // Not all players ready yet - keep waiting
    console.log(`[GameManager] Waiting for other player to be ready...`);
    console.log(`[GameManager] Saving room with playersReady:`, Array.from(room.playersReady));
    
    // Save room back to Redis
    await storage.setGameRoom(roomId, room);
    
    return { success: true, message: 'Waiting for opponent' };
  }

  // Both players ready - clear the auto-start timer
  clearRoundOverAutoStart(roomId);
  console.log(`[GameManager] Both players ready - starting next round`);

  // Check if game is over
  if (room.currentRound >= (room.maxRounds || room.totalRounds || 6)) {
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
  
  // Get 3 new random subjects for this round (excluding used ones)
  const allSubjects = await getSubjects();
  const usedSubjectsArray = Array.from(room.usedSubjects || new Set<string>()) as string[];
  room.availableSubjectsForRound = getRandomSubjectsForRound(usedSubjectsArray, allSubjects, 3);
  
  // Reset player progress and ready status
  room.players.forEach(p => {
    room.playerProgress.set(p.id, 0);
  });
  room.playerTimers.clear();
  room.playersFinished.clear();
  room.playersReady.clear();
  room.roundOverTimerStartedAt = null; // Clear round-over timer
  
  // Set subject selection timer timestamp with grace period
  room.timerStartedAt = Date.now() + 2000; // Add 2-second grace period
  room.timerDuration = SUBJECT_SELECTION_DURATION;

  // Save room back to Redis with timer already set
  await storage.setGameRoom(roomId, room);

  // Start the backend setTimeout timer
  await startSubjectTimer(roomId);

  console.log(`[GameManager] Starting round ${room.currentRound}, timer started`);

  return { success: true, gameOver: false };
}

// Handle player disconnect/leave - award win to opponent
export async function handlePlayerDisconnect(playerId: string): Promise<{ success: boolean; message: string; opponentWins?: boolean }> {
  try {
    console.log(`[GameManager] Handling disconnect for player: ${playerId}`);
    
    // Get player's room
    const roomId = await storage.getPlayerRoom(playerId);
    if (!roomId) {
      // Player not in a room, just clean up
      await removePlayer(playerId);
      return { success: true, message: 'Player not in active game' };
    }

    const room = await storage.getGameRoom(roomId);
    if (!room) {
      await storage.deletePlayerRoom(playerId);
      return { success: true, message: 'Room not found' };
    }

    // Find opponent
    const opponent = room.players.find(p => p.id !== playerId);
    
    if (opponent && room.state !== 'game-over') {
      // Game in progress - opponent wins by forfeit
      console.log(`[GameManager] Player ${playerId} left, ${opponent.username} wins by forfeit!`);
      
      // Award maximum score to opponent
      room.scores.set(opponent.id, 999);
      room.state = 'game-over';
      
      // Save updated room
      await storage.setGameRoom(roomId, room);
      
      // Note: Don't delete the room yet - opponent needs to see the win message
      // The opponent will clean up when they leave or it will expire naturally
      
      return { 
        success: true, 
        message: `${opponent.username} wins by forfeit!`,
        opponentWins: true
      };
    } else {
      // Game already over or no opponent, just clean up
      await removePlayer(playerId);
      return { success: true, message: 'Player removed from completed game' };
    }
  } catch (error) {
    console.error('[GameManager] Error handling disconnect:', error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Failed to handle disconnect' 
    };
  }
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

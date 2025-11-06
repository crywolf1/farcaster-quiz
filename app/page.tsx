'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import type { Question } from '@/lib/types';
import { formatScore, getRankEmoji } from '@/lib/scoreUtils';
import type { LeaderboardEntry } from '@/lib/mongodb';

type GameState = 'loading' | 'idle' | 'searching' | 'matched' | 'subject-selection' | 'waiting-subject' | 'playing' | 'round-result' | 'game-over';

interface FarcasterUser {
  username: string;
  pfpUrl: string;
  fid: number;
}

interface GameRoom {
  id: string;
  players: Array<{
    id: string;
    username: string;
    pfpUrl?: string;
    fid?: number;
  }>;
  currentRound: number;
  maxRounds: number;
  currentPickerIndex: number;
  currentSubject: string | null;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, number>;
  scores: Record<string, number>;
  state: 'subject-selection' | 'playing' | 'round-over' | 'game-over';
  timerStartedAt: number | null;
  timerDuration: number;
  playerProgress: Record<string, number>;
  playerTimers: Record<string, number>;
  playersFinished: string[];
  myProgress: number;
  roundOverTimerStartedAt: number | null;
  playersReady: string[];
  usedSubjects: string[];
  availableSubjectsForRound: string[];
}

export default function Home() {
  const [isReady, setIsReady] = useState(false);
  const [isFrameContext, setIsFrameContext] = useState(false);
  const [gameState, setGameState] = useState<GameState>('loading');
  const [farcasterUser, setFarcasterUser] = useState<FarcasterUser | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [opponent, setOpponent] = useState<{ id: string; username: string; pfpUrl?: string; fid?: number } | null>(null);
  const [subjects, setSubjects] = useState<string[]>(['Science', 'History', 'Geography', 'Sports', 'Technology']);
  const [gameRoom, setGameRoom] = useState<GameRoom | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [currentQuestionId, setCurrentQuestionId] = useState<string>('');
  const [showingResults, setShowingResults] = useState(false);
  // Separate timers/state for question, subject selection and round-result
  // Question timer (18s)
  const [timeRemainingQuestion, setTimeRemainingQuestion] = useState<number>(18);
  const [timerActiveQuestion, setTimerActiveQuestion] = useState<boolean>(false);
  const questionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subject selection timer (20s)
  const [timeRemainingSubject, setTimeRemainingSubject] = useState<number>(20);
  const [timerActiveSubject, setTimerActiveSubject] = useState<boolean>(false);
  const subjectTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Round-result auto-ready timer (15s) - synced with server
  const [timeRemainingRound, setTimeRemainingRound] = useState<number>(15);
  const [timerActiveRound, setTimerActiveRound] = useState<boolean>(false);
  const roundTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null); // Track selected subject for animation
  const [showSubjectResult, setShowSubjectResult] = useState(false); // Show which subject was selected with animation
  const [hasShownSubjectResult, setHasShownSubjectResult] = useState(false); // Track if we've shown the animation for this round
  const [answerFeedback, setAnswerFeedback] = useState<'correct' | 'incorrect' | null>(null); // Track answer feedback
  const [isShowingFeedback, setIsShowingFeedback] = useState(false); // Flag to prevent question change during feedback
  const [isRejoinAttempt, setIsRejoinAttempt] = useState(false); // Track if we're attempting to rejoin
  const [showLeaderboard, setShowLeaderboard] = useState(false); // Show leaderboard modal
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [playerStats, setPlayerStats] = useState<{ points: number; rank: number; wins: number; losses: number } | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false); // Show leave game confirmation modal
  const [showAddQuestion, setShowAddQuestion] = useState(false); // Show add question modal
  const [newQuestion, setNewQuestion] = useState({
    subject: '',
    difficulty: 'moderate' as 'easy' | 'moderate' | 'hard',
    question: '',
    answers: ['', '', '', ''],
    correctAnswer: 0,
  });
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false); // Track submission state
  const [showQuestionSuccess, setShowQuestionSuccess] = useState(false); // Show success message after question submission
  const [fieldErrors, setFieldErrors] = useState({
    subject: '',
    question: '',
    answers: ['', '', '', '']
  }); // Show validation errors per field
  const [opponentLeft, setOpponentLeft] = useState(false); // Track if opponent left
  const [disconnectMessage, setDisconnectMessage] = useState(''); // Message to show when opponent leaves
  const [autoReturnCountdown, setAutoReturnCountdown] = useState(6); // Countdown seconds for auto-return
  const autoReturnTimerRef = useRef<NodeJS.Timeout | null>(null); // Timer for auto-return to home
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null); // Interval for countdown display
  const countdownStartedRef = useRef<boolean>(false); // Flag to prevent multiple countdowns
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Per-timer refs (keep per-timer refs above; remove generic timer ref)
  // const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastShownSubjectRound = useRef<number>(-1); // Track which round we showed the animation for
  const hasAttemptedRejoin = useRef<boolean>(false); // Track if we've already tried to rejoin (only once at startup)
  const playerIdRef = useRef<string>(''); // Store playerId in ref for immediate access in callbacks

  // Poll for game state
  const startPolling = useCallback(() => {
    // CRITICAL: Don't start polling without a playerId
    const currentPlayerId = playerIdRef.current;
    if (!currentPlayerId) {
      console.log('[Polling] ⚠️ Cannot start polling - playerId is empty!');
      console.log('[Polling] - playerIdRef.current:', playerIdRef.current);
      console.log('[Polling] - playerId state:', playerId);
      return;
    }
    
    console.log('[Polling] ✓ Starting polling for playerId:', currentPlayerId);
    
    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/game?playerId=${currentPlayerId}`);
        const data = await response.json();
        
        // Check if game/room was deleted (opponent disconnected)
        // Only trigger if we were in an active game (not idle/searching)
        const wasInGame = gameState !== 'idle' && gameState !== 'loading' && gameState !== 'searching';
        
        if (!data.gameState && wasInGame && !opponentLeft) {
          console.log('[Polling] ⚠️ Game room no longer exists - opponent disconnected');
          console.log('[Polling] - Previous gameState:', gameState);
          console.log('[Polling] - Opponent:', opponent);
          
          const opponentName = opponent?.username || 'Your opponent';
          setOpponentLeft(true);
          setDisconnectMessage(`${opponentName} left the game`);
          
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          
          console.log('[Polling] ✓ Disconnect overlay should now be visible');
          return;
        }
        
        if (data.gameState) {
          const room: GameRoom = data.gameState;
          setGameRoom(room);

          // Update opponent - ALWAYS update to ensure correct opponent is shown
          if (room.players.length === 2) {
            // CRITICAL: Use playerIdRef.current as fallback to ensure correct opponent
            const currentPlayerId = playerId || playerIdRef.current;
            console.log('[Polling] Finding opponent');
            console.log('[Polling] - playerId state:', playerId);
            console.log('[Polling] - playerIdRef.current:', playerIdRef.current);
            console.log('[Polling] - currentPlayerId:', currentPlayerId);
            console.log('[Polling] - room.players:', room.players.map(p => ({ id: p.id, username: p.username })));
            
            // Only find opponent if we have a valid currentPlayerId
            if (!currentPlayerId) {
              console.log('[Polling] ⚠️ Cannot determine opponent - currentPlayerId is empty');
              return;
            }
            
            const opp = room.players.find(p => p.id !== currentPlayerId);
            console.log('[Polling] - opponent found:', opp ? { id: opp.id, username: opp.username } : 'NULL');
            console.log('[Polling] - current opponent state:', opponent ? { id: opponent.id, username: opponent.username } : 'NULL');
            
            if (opp && (!opponent || opponent.id !== opp.id)) {
              console.log('[Polling] ✓ Updating opponent from', opponent?.username, 'to', opp.username);
              setOpponent(opp);
            }
          }

          // Update game state based on room state
          console.log('[Polling] Room state:', room.state, 'Current gameState:', gameState);
          
          if (room.state === 'subject-selection') {
            // CRITICAL: Use playerIdRef.current instead of playerId state to avoid empty value
            const currentPlayerId = playerId || playerIdRef.current;
            const isMyTurn = room.players[room.currentPickerIndex]?.id === currentPlayerId;
            const newState = isMyTurn ? 'subject-selection' : 'waiting-subject';
            console.log('[Polling] Subject selection - playerId:', playerId, 'playerIdRef:', playerIdRef.current, 'isMyTurn:', isMyTurn, 'newState:', newState);
            setGameState(newState);
            // Reset subject result animation flags when entering subject selection
            setShowSubjectResult(false);
            setHasShownSubjectResult(false);
            // IMPORTANT: Reset the round tracker so it's ready for the next round's animation
            // This prevents showing stale subject animation when transitioning
            lastShownSubjectRound.current = -1;
          } else if (room.state === 'playing') {
            console.log('[Polling] State: playing');
            console.log('[Polling] - myProgress:', room.myProgress);
            console.log('[Polling] - currentRound:', room.currentRound);
            console.log('[Polling] - currentSubject:', room.currentSubject);
            console.log('[Polling] - questions.length:', room.questions?.length);
            console.log('[Polling] - questions:', room.questions);
            
            // Show subject result animation briefly before moving to playing
            // Only show ONCE per round (check if we've shown it for this round number)
            const currentRound = room.currentRound || 1;
            if (lastShownSubjectRound.current !== currentRound && room.currentSubject && room.myProgress === 0) {
              console.log('[Polling] Showing subject result animation for round:', currentRound, 'subject:', room.currentSubject);
              setShowSubjectResult(true);
              setHasShownSubjectResult(true); // Mark as shown for this round
              lastShownSubjectRound.current = currentRound; // Remember which round we showed for
              // Keep showing for 1.5 seconds then hide (but stay in playing state)
              setTimeout(() => {
                setShowSubjectResult(false);
              }, 1500);
            }
            
            setGameState('playing');
            
            // Check if MY question changed - BUT ONLY if not showing feedback animation
            const myCurrentQ = room.questions[room.myProgress || 0];
            console.log('[Polling] - myCurrentQ:', myCurrentQ);
            console.log('[Polling] - currentQuestionId:', currentQuestionId);
            
            if (myCurrentQ && myCurrentQ.id !== currentQuestionId) {
              if (isShowingFeedback) {
                console.log('[Polling] Question changed but BLOCKING due to feedback animation');
              } else {
                console.log('[Polling] ✓ New question for me:', myCurrentQ.id, 'changing from:', currentQuestionId);
                setSelectedAnswer(null);
                setAnswerFeedback(null); // Reset feedback for new question
                setLastResult(null);
                setShowingResults(false);
              }
            } else if (!myCurrentQ) {
              console.log('[Polling] ✗ No question found at myProgress:', room.myProgress);
            }
          } else if (room.state === 'round-over') {
            console.log('[Polling] Round over');
            setGameState('round-result');
          } else if (room.state === 'game-over') {
            console.log('[Polling] Game over');
            setGameState('game-over');
          }
        }
      } catch (error) {
        console.error('[Polling] Game polling error:', error);
      }
    }, 1000); // Poll every second

    pollingIntervalRef.current = interval;
  }, [playerId, opponent, gameState, currentQuestionId, isShowingFeedback]);

  // Try to rejoin existing game after initialization
  const attemptRejoin = useCallback(async (userId: string) => {
    // CRITICAL: Only attempt rejoin ONCE at startup, never during active matchmaking
    if (hasAttemptedRejoin.current) {
      console.log('[Rejoin] ⏭️ Already attempted rejoin, skipping');
      return;
    }
    
    hasAttemptedRejoin.current = true;
    
    try {
      console.log('[Rejoin] Attempting to rejoin game for user:', userId);
      setIsRejoinAttempt(true);
      
      // Check localStorage for saved playerId
      const savedPlayerId = localStorage.getItem(`playerId_${userId}`);
      if (!savedPlayerId) {
        console.log('[Rejoin] No saved playerId found');
        setGameState('idle');
        setIsRejoinAttempt(false);
        return;
      }

      console.log('[Rejoin] Found saved playerId:', savedPlayerId);
      
      // Check if this player has an active room
      const response = await fetch(`/api/game?playerId=${savedPlayerId}`);
      const data = await response.json();

      if (data.gameState && data.gameState.state !== 'game-over') {
        // Active game found! Restore state
        console.log('[Rejoin] ✓ Active game found! Restoring state...');
        
        // CRITICAL: Set both state AND ref
        setPlayerId(savedPlayerId);
        playerIdRef.current = savedPlayerId;
        console.log('[Rejoin] ✓ Set playerIdRef.current to:', playerIdRef.current);
        
        setRoomId(data.gameState.id);
        setGameRoom(data.gameState);
        
        // Find opponent
        const opp = data.gameState.players.find((p: any) => p.id !== savedPlayerId);
        if (opp) setOpponent(opp);
        
        // Restore game state based on room state
        const room = data.gameState;
        if (room.state === 'subject-selection') {
          const isMyTurn = room.players[room.currentPickerIndex]?.id === savedPlayerId;
          setGameState(isMyTurn ? 'subject-selection' : 'waiting-subject');
        } else if (room.state === 'playing') {
          setGameState('playing');
          
          // Restore answer if already answered current question
          const myProgress = room.playerProgress?.[savedPlayerId] || 0;
          const currentQuestionKey = `${savedPlayerId}-${myProgress}`;
          const myAnswer = room.answers?.[currentQuestionKey];
          
          console.log('[Rejoin] Checking for existing answer:', {
            myProgress,
            currentQuestionKey,
            myAnswer,
            allAnswers: room.answers
          });
          
          if (myAnswer !== undefined) {
            console.log('[Rejoin] ✓ Restoring answer:', myAnswer);
            setSelectedAnswer(myAnswer);
            // Don't start timer if already answered
          }
        } else if (room.state === 'round-over') {
          setGameState('round-result');
        } else if (room.state === 'game-over') {
          setGameState('game-over');
        }
        
        // Start polling to keep state updated
        startPolling();
        
        console.log('[Rejoin] ✓ Successfully rejoined game!');
      } else {
        console.log('[Rejoin] No active game found, starting fresh');
        // Clean up localStorage if game is over
        if (savedPlayerId) {
          localStorage.removeItem(`playerId_${userId}`);
        }
        setGameState('idle');
      }
    } catch (error) {
      console.error('[Rejoin] Error attempting rejoin:', error);
      setGameState('idle');
    } finally {
      setIsRejoinAttempt(false);
    }
  }, [startPolling]);

  // Initialize Farcaster SDK and attempt rejoin
  useEffect(() => {
    const initializeFrame = async () => {
      console.log('Starting Farcaster SDK initialization...');
      
      try {
        // Check if we're running in a Farcaster frame context
        console.log('📡 Fetching SDK context...');
        const context = await sdk.context;
        console.log('✓ Context received:', context);
        
        setIsFrameContext(!!context);

        if (context) {
          console.log('In Farcaster frame - calling ready()...');
          
          // We're in a Farcaster frame, initialize properly
          await sdk.actions.ready({
            disableNativeGestures: true,
          });
          
          console.log('✓ sdk.actions.ready() called successfully!');

          // Prompt user to add the Mini App
          try {
            console.log('📱 Prompting user to add Mini App...');
            await sdk.actions.addMiniApp();
            console.log('✓ addMiniApp() called successfully!');
          } catch (addError: any) {
            // Handle specific errors
            if (addError?.code === 'RejectedByUser') {
              console.log('ℹ️ User declined to add the Mini App');
            } else if (addError?.code === 'InvalidDomainManifestJson') {
              console.error('⚠️ Domain/manifest mismatch or invalid farcaster.json');
            } else {
              console.error('⚠️ Error prompting to add Mini App:', addError);
            }
            // Continue anyway - this is not critical for app functionality
          }

          setIsReady(true);
          const user = (context as any).user;
          setFarcasterUser(user as FarcasterUser);
          
          // Generate playerId based on FID (consistent across refreshes)
          const userId = `${user.fid}`;
          
          // Try to rejoin existing game
          await attemptRejoin(userId);

          console.log('Farcaster Frame initialized:', {
            user: context.user,
            client: context.client,
          });
        } else {
          // Not in a frame context
          console.log('⚠️ No context - running outside Farcaster frame');
          setIsReady(true);
          const fallbackUser = {
            username: `Player${Math.floor(Math.random() * 1000)}`,
            pfpUrl: '',
            fid: Math.floor(Math.random() * 10000)
          };
          setFarcasterUser(fallbackUser);
          
          // Try to rejoin for fallback user
          await attemptRejoin(`${fallbackUser.fid}`);
        }
      } catch (err) {
        console.error('✗ Farcaster Frame SDK error:', err);
        setIsReady(true); // Still allow the app to work
        const fallbackUser = {
          username: `Player${Math.floor(Math.random() * 1000)}`,
          pfpUrl: '',
          fid: Math.floor(Math.random() * 10000)
        };
        setFarcasterUser(fallbackUser);
        
        // Try to rejoin for fallback user
        await attemptRejoin(`${fallbackUser.fid}`);
      }
    };

    initializeFrame();
  }, [attemptRejoin]);

  // Start matchmaking
  const findMatch = async () => {
    if (!farcasterUser) return;
    
    // Prevent double-click by checking if already searching
    if (gameState === 'searching') {
      console.log('[FindMatch] Already searching, ignoring duplicate click');
      return;
    }

    console.log('[FindMatch] Starting matchmaking process...');
    setGameState('searching');

    try {
      // Generate consistent playerId based on FID
      const newPlayerId = `player_${farcasterUser.fid}_${Date.now()}`;
      console.log('[FindMatch] Generated playerId:', newPlayerId);
      
      // CRITICAL: Set both state AND ref immediately
      setPlayerId(newPlayerId);
      playerIdRef.current = newPlayerId;
      console.log('[FindMatch] ✓ Set playerIdRef.current to:', playerIdRef.current);
      
      // Save playerId to localStorage for rejoin capability
      localStorage.setItem(`playerId_${farcasterUser.fid}`, newPlayerId);
      console.log('[FindMatch] ✓ Saved playerId to localStorage');
      
      // Join matchmaking queue
      const response = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: newPlayerId,
          username: farcasterUser.username,
          pfpUrl: farcasterUser.pfpUrl,
          fid: farcasterUser.fid,
        }),
      });

      const data = await response.json();

      console.log('[FindMatch] Matchmaking response:', data);

      if (data.roomId) {
        // Already matched! Need to fetch full game state
        console.log('[FindMatch] ✓ Match found immediately! Room:', data.roomId);
        setRoomId(data.roomId);
        
        // Fetch the full game state
        console.log('[FindMatch] Fetching game state for playerId:', newPlayerId);
        const gameResponse = await fetch(`/api/game?playerId=${newPlayerId}`);
        const gameData = await gameResponse.json();
        console.log('[FindMatch] Game data received:', gameData);
        
        if (gameData.gameState) {
          const room = gameData.gameState;
          setGameRoom(room);
          console.log('[FindMatch] Room state:', room.state);
          
          // Find opponent
          const opp = room.players.find((p: any) => p.id !== newPlayerId);
          if (opp) {
            setOpponent(opp);
            console.log('[FindMatch] Opponent found:', opp.username);
          }
          
          // Set appropriate game state
          if (room.state === 'subject-selection') {
            const isMyTurn = room.players[room.currentPickerIndex]?.id === newPlayerId;
            const newState = isMyTurn ? 'subject-selection' : 'waiting-subject';
            console.log('[FindMatch] Setting state to:', newState, '(isMyTurn:', isMyTurn, ')');
            setGameState(newState);
          } else {
            console.log('[FindMatch] Setting state to room state:', room.state);
            setGameState(room.state as any);
          }
          
          // Start polling to keep state updated
          console.log('[FindMatch] Starting polling...');
          startPolling();
        } else {
          // Fallback: start match polling
          console.log('[FindMatch] No game state found, starting match polling');
          startMatchPolling(newPlayerId);
        }
      } else {
        // Keep polling for match using the NEW playerId
        console.log('[FindMatch] Waiting for match, starting polling for playerId:', newPlayerId);
        startMatchPolling(newPlayerId);
      }
    } catch (error) {
      console.error('Find match error:', error);
      setGameState('idle');
    }
  };

  // Poll for match
  const startMatchPolling = (currentPlayerId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/match?playerId=${currentPlayerId}`);
        const data = await response.json();

        if (data.matched && data.roomId) {
          clearInterval(interval);
          console.log('[MatchPolling] Match found! Room:', data.roomId);
          
          setRoomId(data.roomId);
          setOpponent(data.opponent || null);
          setSubjects(data.subjects || []);
          
          // Fetch full game state to properly set up the game
          const gameResponse = await fetch(`/api/game?playerId=${currentPlayerId}`);
          const gameData = await gameResponse.json();
          
          if (gameData.gameState) {
            const room = gameData.gameState;
            setGameRoom(room);
            
            // Set appropriate game state based on room state
            if (room.state === 'subject-selection') {
              const isMyTurn = room.players[room.currentPickerIndex]?.id === currentPlayerId;
              setGameState(isMyTurn ? 'subject-selection' : 'waiting-subject');
            } else {
              setGameState(room.state as any);
            }
            
            // Start polling immediately to keep state updated
            startPolling();
          } else {
            // Fallback: show matched state then poll
            setGameState('matched');
            setTimeout(() => {
              startPolling();
            }, 2000);
          }
        }
      } catch (error) {
        console.error('Match polling error:', error);
      }
    }, 1000); // Poll every second

    // Store interval to clean up later
    pollingIntervalRef.current = interval;
  };

  // Fetch player stats when farcasterUser is set
  useEffect(() => {
    if (farcasterUser && !showLeaderboard) {
      fetchPlayerStats();
    }
  }, [farcasterUser]);

  // Fetch leaderboard when modal opens
  useEffect(() => {
    if (showLeaderboard && farcasterUser) {
      fetchLeaderboard();
    }
  }, [showLeaderboard]);

  // Save score to MongoDB when game ends
  const hasScoreSaved = useRef(false);
  useEffect(() => {
    const saveScore = async () => {
      if (gameState === 'game-over' && farcasterUser && playerId && gameRoom && !hasScoreSaved.current) {
        hasScoreSaved.current = true; // Prevent duplicate saves
        
        try {
          const myScore = gameRoom.scores[playerId] || 0;
          const opponentScore = opponent ? (gameRoom.scores[opponent.id] || 0) : 0;
          const isWinner = myScore > opponentScore;
          const isDraw = myScore === opponentScore;

          console.log('[GameOver] ========================================');
          console.log('[GameOver] Saving score to MongoDB:');
          console.log('[GameOver] - FID:', farcasterUser.fid);
          console.log('[GameOver] - Username:', farcasterUser.username);
          console.log('[GameOver] - My Score:', myScore);
          console.log('[GameOver] - Opponent Score:', opponentScore);
          console.log('[GameOver] - Is Winner:', isWinner && !isDraw);
          console.log('[GameOver] ========================================');
          
          const payload = {
            fid: farcasterUser.fid.toString(),
            username: farcasterUser.username,
            pfpUrl: farcasterUser.pfpUrl || '',
            score: myScore,
            isWin: isWinner && !isDraw
          };
          
          console.log('[GameOver] Sending payload:', JSON.stringify(payload, null, 2));
          
          const response = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          console.log('[GameOver] Response status:', response.status);
          const data = await response.json();
          console.log('[GameOver] Response data:', data);

          // Refresh player stats to show updated rank
          if (data.success) {
            console.log('[GameOver] Score saved successfully! Refreshing stats...');
            setTimeout(() => fetchPlayerStats(), 1000); // Delay to ensure MongoDB is updated
          } else {
            console.error('[GameOver] Failed to save score:', data.error);
          }
        } catch (error) {
          console.error('[GameOver] Exception while saving score:', error);
          hasScoreSaved.current = false; // Allow retry on error
        }
      }
    };

    if (gameState === 'game-over') {
      saveScore();
    } else {
      hasScoreSaved.current = false; // Reset for next game
    }
  }, [gameState, farcasterUser, playerId, gameRoom, opponent]);

  const fetchPlayerStats = async () => {
    if (!farcasterUser) return;
    
    try {
      const response = await fetch(`/api/leaderboard?fid=${farcasterUser.fid}&limit=1`);
      const data = await response.json();
      
      if (data.success && data.playerRank) {
        setPlayerStats({
          points: data.playerRank.player?.points || 0,
          rank: data.playerRank.rank || 0,
          wins: data.playerRank.player?.wins || 0,
          losses: data.playerRank.player?.losses || 0,
        });
      }
    } catch (error) {
      console.error('[FetchPlayerStats] Error:', error);
    }
  };

  const fetchLeaderboard = async () => {
    if (!farcasterUser) return;
    
    try {
      const response = await fetch(`/api/leaderboard?fid=${farcasterUser.fid}&limit=100`);
      const data = await response.json();
      
      if (data.success) {
        setLeaderboardData(data.leaderboard);
        if (data.playerRank) {
          setPlayerStats({
            points: data.playerRank.player?.points || 0,
            rank: data.playerRank.rank || 0,
            wins: data.playerRank.player?.wins || 0,
            losses: data.playerRank.player?.losses || 0,
          });
        }
      }
    } catch (error) {
      console.error('[FetchLeaderboard] Error:', error);
    }
  };

  // Auto-return to home after game ends or opponent leaves
  useEffect(() => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`[AutoReturn ${timestamp}] Effect running - gameState:`, gameState, 'opponentLeft:', opponentLeft);
    console.log(`[AutoReturn ${timestamp}] - countdownStartedRef.current:`, countdownStartedRef.current);
    console.log(`[AutoReturn ${timestamp}] - countdownIntervalRef.current:`, countdownIntervalRef.current);
    console.log(`[AutoReturn ${timestamp}] - Condition check: gameState === game-over?`, gameState === 'game-over', '|| opponentLeft?', opponentLeft);
    console.log(`[AutoReturn ${timestamp}] - Will start countdown?`, (gameState === 'game-over' || opponentLeft));
    
    // Start timer when game ends or opponent leaves (but only if not already started)
    if ((gameState === 'game-over' || opponentLeft) && !countdownStartedRef.current) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      console.log(`[AutoReturn ${timestamp}] ✓ Starting 6 second countdown (FIRST TIME)`);
      console.log(`[AutoReturn ${timestamp}] Setting countdownStartedRef.current = true`);
      countdownStartedRef.current = true; // Mark countdown as started
      
      // Set initial countdown
      let timeLeft = 6;
      setAutoReturnCountdown(timeLeft);
      
      // Update countdown every second
      countdownIntervalRef.current = setInterval(() => {
        console.log('[AutoReturn] 🔄 Interval callback executing...');
        timeLeft = timeLeft - 1;
        console.log('[AutoReturn] Countdown tick:', timeLeft, '(state will update to:', timeLeft, ')');
        setAutoReturnCountdown(timeLeft);
        console.log('[AutoReturn] State update called with:', timeLeft);
        
        // When countdown reaches 0, return to home
        if (timeLeft <= 0) {
          console.log('[AutoReturn] ✓ Countdown finished! Returning to home');
          
          // Clear the interval
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          
          // Clear game state and return to home
          setGameState('idle');
          setGameRoom(null);
          setOpponent(null);
          setRoomId('');
          setSelectedAnswer(null);
          setLastResult(null);
          setShowingResults(false);
          setOpponentLeft(false);
          setDisconnectMessage('');
          setAutoReturnCountdown(6);
          // Note: countdownStartedRef will be reset in the else block when gameState becomes idle
          
          // Clear localStorage
          if (farcasterUser) {
            localStorage.removeItem(`playerId_${farcasterUser.fid}`);
          }
          
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          
          console.log('[AutoReturn] ✓ Returned to home, fetching stats...');
          // Refresh player stats (use setTimeout to avoid immediate call)
          setTimeout(() => {
            if (farcasterUser) {
              fetch(`/api/leaderboard?fid=${farcasterUser.fid}&limit=1`)
                .then(res => res.json())
                .then(data => {
                  if (data.success && data.playerRank) {
                    setPlayerStats({
                      points: data.playerRank.player?.points || 0,
                      rank: data.playerRank.rank || 0,
                      wins: data.playerRank.player?.wins || 0,
                      losses: data.playerRank.player?.losses || 0,
                    });
                  }
                })
                .catch(err => console.error('[AutoReturn] Stats fetch error:', err));
            }
          }, 500);
        }
      }, 1000);
      
      console.log('[AutoReturn] ✓ setInterval created, ID:', countdownIntervalRef.current);
      console.log('[AutoReturn] Waiting 1000ms for first tick...');
    } else if ((gameState === 'game-over' || opponentLeft) && countdownStartedRef.current) {
      // Countdown already started, don't start another
      console.log('[AutoReturn] ⏭️ Countdown already running, skipping duplicate start');
    } else {
      // Reset countdown when not in end state
      console.log('[AutoReturn] Condition not met, resetting countdown to 6 and flag');
      setAutoReturnCountdown(6);
      // Reset the flag when we're back in a non-game-over state (ready for next game)
      if (countdownStartedRef.current && gameState === 'idle') {
        console.log('[AutoReturn] ✓ Back in idle state, resetting countdownStartedRef');
        countdownStartedRef.current = false;
      }
    }

    return () => {
      console.log('[AutoReturn] 🧹 Cleanup function running - clearing intervals');
      if (autoReturnTimerRef.current) {
        console.log('[AutoReturn] Clearing autoReturnTimerRef');
        clearTimeout(autoReturnTimerRef.current);
      }
      if (countdownIntervalRef.current) {
        console.log('[AutoReturn] Clearing countdownIntervalRef:', countdownIntervalRef.current);
        clearInterval(countdownIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, opponentLeft]); // farcasterUser intentionally excluded - we only read it, don't need to re-run when it changes

  // Cleanup polling and feedback timeout on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      if (autoReturnTimerRef.current) {
        clearTimeout(autoReturnTimerRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Select subject
  const selectSubject = useCallback(async (subject: string) => {
    const activePlayerId = playerId || playerIdRef.current;
    
    console.log('[SelectSubject] Button clicked! Subject:', subject);
    console.log('[SelectSubject] - activePlayerId:', activePlayerId);
    
    // Check if a subject was already selected (race condition)
    if (selectedSubject) {
      console.log('[SelectSubject] ⚠️ Subject already selected, ignoring');
      return;
    }
    
    // Immediately show selection with animation
    setSelectedSubject(subject);
    console.log('[SelectSubject] ✓ Set selectedSubject to:', subject);
    
    try {
      const response = await fetch('/api/subject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: activePlayerId, subject }),
      });

      console.log('[Client] Response status:', response.status);
      const data = await response.json();
      console.log('[Client] Response data:', data);

      if (data.success) {
        console.log('[Client] Subject selected successfully, switching to playing state');
        // Keep the selected subject visible for a moment before transitioning
        setTimeout(() => {
          setGameState('playing');
          setSelectedSubject(null); // Reset for next round
        }, 800);
      } else {
        console.error('[Client] Failed to select subject:', data.message || data.error);
        setSelectedSubject(null); // Reset on error
        alert(data.message || data.error || 'Failed to select subject');
      }
    } catch (error) {
      console.error('[Client] Select subject error:', error);
      setSelectedSubject(null); // Reset on error
      alert('Error selecting subject: ' + error);
    }
  }, [playerId, selectedSubject]);

  // Submit answer
  const submitAnswer = useCallback(async (answerIndex: number) => {
    const currentPlayerId = playerId || playerIdRef.current;
    const myProgress = gameRoom?.myProgress || 0;
    const iFinished = gameRoom?.playersFinished?.includes(currentPlayerId) || false;
    
    console.log('[Submit] submitAnswer called with index:', answerIndex);
    console.log('[Submit] gameRoom:', gameRoom ? 'exists' : 'null');
    console.log('[Submit] gameRoom?.state:', gameRoom?.state);
    console.log('[Submit] selectedAnswer:', selectedAnswer);
    console.log('[Submit] iFinished:', iFinished);
    console.log('[Submit] myProgress:', myProgress);
    
    if (!gameRoom) {
      console.error('[Submit] No game room - cannot submit');
      return;
    }
    
    // Check if we're still in playing state
    if (gameRoom.state !== 'playing') {
      console.error('[Submit] Game not in playing state - skipping submit');
      return;
    }
    
    if (selectedAnswer !== null) {
      console.error('[Submit] Already selected an answer');
      return;
    }
    
    if (iFinished) {
      console.error('[Submit] Player already finished');
      return;
    }

    console.log('[Submit] Submitting answer:', answerIndex);
    setSelectedAnswer(answerIndex);
    setIsShowingFeedback(true); // Block question changes during feedback

    try {
      const myCurrentQ = gameRoom.questions[myProgress];
      console.log('[Submit] Current question:', myCurrentQ);
      
      // Check if answer is correct immediately for instant feedback
      const isCorrect = answerIndex === myCurrentQ.correctAnswer;
      setAnswerFeedback(isCorrect ? 'correct' : 'incorrect');
      console.log('[Submit] Set answer feedback:', isCorrect ? 'correct' : 'incorrect', 'isShowingFeedback: true');
      
      // Show feedback for 2 seconds before allowing question change
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      feedbackTimeoutRef.current = setTimeout(() => {
        console.log('[Submit] Feedback timeout complete, allowing question change');
        setIsShowingFeedback(false);
        feedbackTimeoutRef.current = null;
      }, 2000);
      
      const response = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          questionId: myCurrentQ.id,
          answerIndex,
        }),
      });

      console.log('[Submit] Response status:', response.status);
      const data = await response.json();
      console.log('[Submit] Response data:', data);

      if (!data.success) {
        const errorMsg = data.message || data.error;
        console.error('[Submit] Failed:', errorMsg);
        
        // Don't show alert for expected state transitions (e.g., round already ended)
        if (errorMsg !== 'Not in playing phase' && errorMsg !== 'Game room not found') {
          alert(errorMsg || 'Failed to submit answer');
        }
        
        setSelectedAnswer(null);
        setAnswerFeedback(null);
        setIsShowingFeedback(false);
        if (feedbackTimeoutRef.current) {
          clearTimeout(feedbackTimeoutRef.current);
          feedbackTimeoutRef.current = null;
        }
        return;
      }

      // Check if game is over after this answer
      if (data.gameOver) {
        console.log('[Submit] 🏁 Game Over detected!');
        setGameState('game-over');
      }

      // Answer submitted - polling will update to next question
    } catch (error) {
      console.error('[Submit] Submit answer error:', error);
      // Don't show alert for network errors during state transitions
      // The game will continue via polling updates
      setSelectedAnswer(null);
      setAnswerFeedback(null);
      setIsShowingFeedback(false);
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
    }
  }, [gameRoom, selectedAnswer, playerId]);

  // Start next round
  const startNextRound = useCallback(async () => {
    try {
      // CRITICAL: Use playerIdRef.current as fallback
      const activePlayerId = playerId || playerIdRef.current;
      console.log('[StartNextRound] Using playerId:', activePlayerId);
      
      const response = await fetch('/api/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: activePlayerId }),
      });

      const data = await response.json();

      if (data.gameOver) {
        setGameState('game-over');
      } else {
        setGameState('subject-selection');
      }
    } catch (error) {
      console.error('Start next round error:', error);
    }
  }, [playerId]);

  // Leave/Reset game - clears localStorage and resets to idle
  const leaveGame = async () => {
    console.log('[LeaveGame] Player manually leaving game');
    
    // Notify backend if we have a playerId (in an active game)
    const currentPlayerId = playerIdRef.current;
    if (currentPlayerId) {
      try {
        console.log('[LeaveGame] Notifying backend of disconnect for:', currentPlayerId);
        await fetch('/api/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: currentPlayerId }),
        });
        console.log('[LeaveGame] ✓ Backend notified');
      } catch (error) {
        console.error('[LeaveGame] Failed to notify backend:', error);
      }
    }
    
    // Clear polling intervals
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    // Clear any active per-timer intervals
    if (questionTimerRef.current) {
      clearInterval(questionTimerRef.current as NodeJS.Timeout);
      questionTimerRef.current = null;
    }
    if (subjectTimerRef.current) {
      clearInterval(subjectTimerRef.current as NodeJS.Timeout);
      subjectTimerRef.current = null;
    }
    if (roundTimerRef.current) {
      clearInterval(roundTimerRef.current as NodeJS.Timeout);
      roundTimerRef.current = null;
    }
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
    
    // Clear localStorage
    if (farcasterUser) {
      localStorage.removeItem(`playerId_${farcasterUser.fid}`);
      console.log('[LeaveGame] Cleared localStorage');
    }
    
    // Clear playerIdRef
    playerIdRef.current = '';
    
    // Reset all state
    setGameState('idle');
    setPlayerId('');
    setRoomId('');
    setGameRoom(null);
    setOpponent(null);
    setSelectedAnswer(null);
    setLastResult(null);
    setCurrentQuestionId('');
    setShowingResults(false);
    setShowSubjectResult(false);
    setAnswerFeedback(null);
    setIsShowingFeedback(false);
    lastShownSubjectRound.current = -1;
    
    console.log('[LeaveGame] ✓ Successfully left game, ready for new match');
  };

  // Get current question based on MY progress
  // Use playerId from state, or fall back to ref if state hasn't updated yet
  const currentPlayerId = playerId || playerIdRef.current;
  
  const myProgress = gameRoom?.myProgress || 0;
  const currentQuestion = gameRoom?.questions?.[myProgress];
  const isMyTurnToPick = gameRoom?.players[gameRoom.currentPickerIndex]?.id === currentPlayerId;
  const myScore = gameRoom?.scores?.[currentPlayerId] || 0;
  const opponentScore = opponent ? (gameRoom?.scores?.[opponent.id] || 0) : 0;
  const iFinished = gameRoom?.playersFinished?.includes(currentPlayerId) || false;
  const opponentFinished = opponent && gameRoom?.playersFinished?.includes(opponent.id) || false;

  // PROGRESS BAR TIMER - Questions (18 seconds)
  useEffect(() => {
    console.log('[ProgressBar] Effect triggered - gameState:', gameState, 'currentQuestion:', currentQuestion?.id, 'currentQuestionId:', currentQuestionId, 'iFinished:', iFinished);
    
    // Don't start timer if not in playing state or no question
    if (gameState !== 'playing' || !currentQuestion || iFinished) {
      console.log('[ProgressBar] ❌ Not starting timer - conditions not met');
      // Clear and hide timer when leaving playing state
      if (questionTimerRef.current) {
        clearInterval(questionTimerRef.current as NodeJS.Timeout);
        questionTimerRef.current = null;
        setTimerActiveQuestion(false);
      }
      return;
    }

    const questionId = currentQuestion.id;
    const currentPlayerId = playerId || playerIdRef.current;
    const serverQuestionStartTime = gameRoom?.playerTimers?.[currentPlayerId];
    
    // Only start new timer if it's a different question OR if timer not running
    if (currentQuestionId !== questionId) {
      console.log('[ProgressBar] 🎯 New question detected! Starting 18s countdown');
      console.log('[ProgressBar] - Old ID:', currentQuestionId);
      console.log('[ProgressBar] - New ID:', questionId);
      console.log('[ProgressBar] - Server start time:', serverQuestionStartTime);
      
      // Clear any existing question timer first
      if (questionTimerRef.current) {
        console.log('[ProgressBar] - Clearing existing question timer');
        clearInterval(questionTimerRef.current as NodeJS.Timeout);
        questionTimerRef.current = null;
      }
      
      // Update state for new question
      setCurrentQuestionId(questionId);
      
      // Only reset answer state if this is truly a NEW question (not a rejoin)
      if (currentQuestionId !== '') {
        // Had a previous question, so this is a new one - reset state
        setSelectedAnswer(null);
        setAnswerFeedback(null);
        setIsShowingFeedback(false);
      }
      // If currentQuestionId is empty, this is initial load/rejoin - don't reset
      
      // Calculate initial time based on server timestamp if available
      let initialTime = 18;
      if (serverQuestionStartTime) {
        const elapsed = (Date.now() - serverQuestionStartTime) / 1000;
        initialTime = Math.max(0, 18 - elapsed);
        console.log('[ProgressBar] - Syncing with server: elapsed=' + elapsed.toFixed(1) + 's, remaining=' + initialTime.toFixed(1) + 's');
      }
      
      setTimeRemainingQuestion(initialTime);
      
      // Only start timer if no answer selected
      if (selectedAnswer === null) {
        setTimerActiveQuestion(true);
        
        // Start countdown
        console.log('[ProgressBar] - Starting new question interval');
        questionTimerRef.current = setInterval(() => {
          setTimeRemainingQuestion(t => {
            const newTime = t - 0.1;
            if (newTime <= 0) {
              if (questionTimerRef.current) {
                clearInterval(questionTimerRef.current as NodeJS.Timeout);
                questionTimerRef.current = null;
              }
              setTimerActiveQuestion(false);
              console.log('[ProgressBar] ⏰ Question time up!');
              // Check if still in playing state before auto-submitting
              if (gameRoom?.state === 'playing' && !iFinished) {
                submitAnswer(-1);
              } else {
                console.log('[ProgressBar] ⏰ State changed, skipping auto-submit');
              }
              return 0;
            }
            return newTime;
          });
        }, 100);
      } else {
        console.log('[ProgressBar] - Answer already selected, not starting timer');
        setTimerActiveQuestion(false);
      }
    } else {
      console.log('[ProgressBar] ⚠️ Same question ID - not restarting timer');
    }
  }, [gameState, currentQuestion, currentQuestionId, iFinished, submitAnswer, gameRoom?.playerTimers, playerId]);
  
  // Stop question timer when answer is selected (but keep it visible)
  useEffect(() => {
    if (selectedAnswer !== null && questionTimerRef.current) {
      console.log('[ProgressBar] 🛑 Answer selected - stopping question countdown');
      clearInterval(questionTimerRef.current as NodeJS.Timeout);
      questionTimerRef.current = null;
      // Keep timerActive true so bar stays visible
    }
  }, [selectedAnswer]);
  
  // PROGRESS BAR TIMER - Subject Selection (20 seconds)
  useEffect(() => {
    console.log('[ProgressBar-Subject] Effect triggered - gameState:', gameState, 'isMyTurnToPick:', isMyTurnToPick);
    
    if (gameState !== 'subject-selection' || !isMyTurnToPick) {
      console.log('[ProgressBar-Subject] ❌ Not my turn or not subject selection');
      // Clear timer when leaving subject selection or no longer our turn
      if (subjectTimerRef.current) {
        clearInterval(subjectTimerRef.current as NodeJS.Timeout);
        subjectTimerRef.current = null;
        setTimerActiveSubject(false);
      }
      return;
    }

    // Only start timer if not already running
    if (subjectTimerRef.current) {
      console.log('[ProgressBar-Subject] ⚠️ Subject timer already running, skipping');
      return;
    }

    console.log('[ProgressBar-Subject] 🎯 Starting 20s countdown');
    
    setTimeRemainingSubject(20);
    setTimerActiveSubject(true);
    
    // Start countdown
    subjectTimerRef.current = setInterval(() => {
      setTimeRemainingSubject(t => {
        const newTime = t - 0.1;
        if (newTime <= 0) {
          if (subjectTimerRef.current) {
            clearInterval(subjectTimerRef.current as NodeJS.Timeout);
            subjectTimerRef.current = null;
          }
          // Double-check it's still our turn and game is still in subject-selection before auto-selecting
          const currentPlayerId = playerId || playerIdRef.current;
          const stillMyTurn = gameRoom?.players[gameRoom.currentPickerIndex]?.id === currentPlayerId;
          const stillInSubjectSelection = gameRoom?.state === 'subject-selection';
          if (stillMyTurn && stillInSubjectSelection) {
            const randomSubject = subjects[Math.floor(Math.random() * subjects.length)];
            console.log('[ProgressBar-Subject] ⏰ Time up! Auto-selecting:', randomSubject);
            selectSubject(randomSubject);
          } else {
            console.log('[ProgressBar-Subject] ⏰ Time up but conditions not met - skipping auto-select (stillMyTurn:', stillMyTurn, 'stillInSubjectSelection:', stillInSubjectSelection, ')');
          }
          return 0;
        }
        return newTime;
      });
    }, 100);
  }, [gameState, isMyTurnToPick, subjects, selectSubject]);

  // Stop timer when subject is selected but keep bar visible
  useEffect(() => {
    if (gameState === 'subject-selection' && selectedSubject && subjectTimerRef.current) {
      console.log('[ProgressBar] 🛑 Subject selected - stopping subject countdown');
      clearInterval(subjectTimerRef.current as NodeJS.Timeout);
      subjectTimerRef.current = null;
      // Keep timerActive true so bar stays visible
    }
  }, [gameState, selectedSubject]);

  // PROGRESS BAR TIMER - Round Result (30 seconds - synced with server)
  useEffect(() => {
    console.log('[ProgressBar-RoundResult] Effect triggered - gameState:', gameState);
    
    if (gameState !== 'round-result') {
      console.log('[ProgressBar-RoundResult] ❌ Not round-result, skipping');
      if (roundTimerRef.current) {
        clearInterval(roundTimerRef.current as NodeJS.Timeout);
        roundTimerRef.current = null;
        setTimerActiveRound(false);
      }
      return;
    }

    const currentPlayerId = playerId || playerIdRef.current;
    const iAmReady = gameRoom?.playersReady?.includes(currentPlayerId) || false;
    const serverStartTime = gameRoom?.roundOverTimerStartedAt;
    
    console.log('[ProgressBar-RoundResult] - iAmReady:', iAmReady);
    console.log('[ProgressBar-RoundResult] - serverStartTime:', serverStartTime);
    console.log('[ProgressBar-RoundResult] - roundTimerRef.current:', roundTimerRef.current);
    
    // Stop timer if player is ready
    if (iAmReady && roundTimerRef.current) {
      console.log('[ProgressBar-RoundResult] 🛑 Player is ready, stopping timer');
      clearInterval(roundTimerRef.current as NodeJS.Timeout);
      roundTimerRef.current = null;
      setTimerActiveRound(false);
      return;
    }
    
    // Only show timer if not ready and server timer has started
    if (!iAmReady && serverStartTime && !roundTimerRef.current) {
      console.log('[ProgressBar-RoundResult] 🎯 Starting synced countdown with server');
      
      setTimerActiveRound(true);
      
      // Start countdown - continuously recalculate from server timestamp
      roundTimerRef.current = setInterval(() => {
        // Recalculate remaining time from server timestamp each tick for accuracy
        const elapsed = Date.now() - serverStartTime;
        const remaining = Math.max(0, 15 - elapsed / 1000);
        
        setTimeRemainingRound(remaining);
        
        if (remaining <= 0) {
          if (roundTimerRef.current) {
            clearInterval(roundTimerRef.current as NodeJS.Timeout);
            roundTimerRef.current = null;
          }
          setTimerActiveRound(false);
          console.log('[ProgressBar-RoundResult] ⏰ Timer reached 0 - waiting for server to start round');
        }
      }, 100);
    } else if (iAmReady && roundTimerRef.current) {
      console.log('[ProgressBar-RoundResult] 🛑 Player ready - stopping round timer');
      clearInterval(roundTimerRef.current as NodeJS.Timeout);
      roundTimerRef.current = null;
      setTimerActiveRound(false);
    }
  }, [gameState, playerId, gameRoom?.playersReady, gameRoom?.roundOverTimerStartedAt]);

  // Debug logging for subject selection visibility
  useEffect(() => {
    if (gameState === 'subject-selection') {
      console.log('[SubjectDebug] Subject selection screen active');
      console.log('[SubjectDebug] - isMyTurnToPick:', isMyTurnToPick);
      console.log('[SubjectDebug] - currentPlayerId:', currentPlayerId);
      console.log('[SubjectDebug] - gameRoom?.currentPickerIndex:', gameRoom?.currentPickerIndex);
      console.log('[SubjectDebug] - gameRoom?.players:', gameRoom?.players);
      console.log('[SubjectDebug] - gameRoom?.state:', gameRoom?.state);
    }
  }, [gameState, isMyTurnToPick, currentPlayerId, gameRoom]);

  // Render functions
  const renderLoading = () => (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-12 shadow-2xl">
        <div className="w-20 h-20 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-6 drop-shadow-2xl"></div>
        <p className="text-white text-xl font-semibold drop-shadow-lg">Loading Quiz...</p>
      </div>
    </div>
  );

  const renderIdle = () => (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
      {/* Starry Sky Background - Chaotic wavy gradient with 12 wave layers */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#050d1a] via-[#0a1830] to-[#050d1a]">
        {/* 12 SVG Wave Layers - visible throughout entire page */}
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1200 800">
          <defs>
            <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: 'rgba(26,77,122,0.5)', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: 'rgba(42,123,181,0.4)', stopOpacity: 1 }} />
            </linearGradient>
            <linearGradient id="waveGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: 'rgba(42,123,181,0.45)', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: 'rgba(30,90,143,0.5)', stopOpacity: 1 }} />
            </linearGradient>
            <linearGradient id="waveGrad3" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: 'rgba(15,40,70,0.55)', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: 'rgba(30,90,143,0.45)', stopOpacity: 1 }} />
            </linearGradient>
          </defs>
          <path d="M0,20 Q100,50 200,40 T400,60 Q500,45 600,55 T800,50 Q900,40 1000,50 T1200,45 L1200,0 L0,0 Z" fill="url(#waveGrad1)" opacity="0.5" />
          <path d="M0,45 Q120,80 240,65 T480,95 Q600,75 720,90 T960,80 Q1080,70 1200,80 T1440,75 L1440,0 L0,0 Z" fill="url(#waveGrad2)" opacity="0.45" />
          <path d="M0,75 Q110,115 220,100 T440,130 Q560,110 680,125 T920,115 Q1040,105 1160,115 T1400,110 L1400,0 L0,0 Z" fill="url(#waveGrad3)" opacity="0.42" />
          <path d="M0,200 Q130,245 260,225 T520,260 Q660,240 800,255 T1040,245 Q1180,235 1320,245 T1600,240 L1600,150 L0,150 Z" fill="rgba(26,77,122,0.4)" opacity="0.5" />
          <path d="M0,280 Q115,330 230,305 T460,345 Q590,325 720,340 T980,330 Q1110,320 1240,330 T1500,325 L1500,220 L0,220 Z" fill="rgba(30,90,143,0.45)" opacity="0.48" />
          <path d="M0,350 Q125,405 250,380 T500,420 Q640,400 780,415 T1040,405 Q1180,395 1320,405 T1600,400 L1600,290 L0,290 Z" fill="rgba(15,40,70,0.48)" opacity="0.5" />
          <path d="M0,420 Q140,480 280,450 T560,495 Q710,475 860,490 T1140,480 Q1290,470 1440,480 T1720,475 L1720,360 L0,360 Z" fill="rgba(26,77,122,0.42)" opacity="0.48" />
          <path d="M0,520 Q135,585 270,550 T540,600 Q695,580 850,595 T1130,585 Q1285,575 1440,585 T1700,580 L1700,460 L0,460 Z" fill="rgba(42,123,181,0.45)" opacity="0.52" />
          <path d="M0,600 Q150,675 300,635 T600,690 Q770,670 940,685 T1250,675 Q1420,665 1590,675 T1880,670 L1880,540 L0,540 Z" fill="rgba(30,90,143,0.48)" opacity="0.5" />
          <path d="M0,680 Q145,760 290,715 T580,775 Q755,755 930,770 T1230,760 Q1405,750 1580,760 T1860,755 L1860,620 L0,620 Z" fill="rgba(15,40,70,0.5)" opacity="0.52" />
          <path d="M0,750 Q160,835 320,785 T640,850 Q820,830 1000,845 T1320,835 Q1500,825 1680,835 T1960,830 L1960,690 L0,690 Z" fill="rgba(26,77,122,0.45)" opacity="0.5" />
          <path d="M0,800 Q155,890 310,835 T620,905 Q805,885 990,900 T1310,890 Q1495,880 1680,890 T1960,885 L1960,750 L0,750 Z" fill="rgba(42,123,181,0.48)" opacity="0.52" />
        </svg>
        {/* Radial gradient overlays */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 opacity-45" style={{ background: 'radial-gradient(ellipse 900px 500px at 15% 25%, rgba(26,77,122,0.5) 0%, transparent 55%)' }}></div>
          <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(ellipse 800px 600px at 85% 55%, rgba(42,123,181,0.4) 0%, transparent 55%)' }}></div>
          <div className="absolute inset-0 opacity-35" style={{ background: 'radial-gradient(ellipse 700px 500px at 45% 80%, rgba(30,90,143,0.4) 0%, transparent 55%)' }}></div>
          <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse 600px 400px at 70% 40%, rgba(15,40,70,0.45) 0%, transparent 50%)' }}></div>
        </div>
        {/* 1820 Stars - tiny white, medium white, yellow */}
        <div className="absolute inset-0">
          {[...Array(1500)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                width: Math.random() > 0.8 ? '2px' : '1px',
                height: Math.random() > 0.8 ? '2px' : '1px',
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                opacity: 0.15 + Math.random() * 0.85,
                animation: Math.random() > 0.5 ? `pulse ${2 + Math.random() * 3}s ease-in-out infinite` : 'none',
                animationDelay: `${Math.random() * 3}s`
              }}
            />
          ))}
          {/* Medium Stars - 200 total */}
          {[...Array(200)].map((_, i) => (
            <div
              key={`medium-${i}`}
              className="absolute rounded-full bg-white animate-pulse"
              style={{
                width: Math.random() > 0.5 ? '2px' : '1.5px',
                height: Math.random() > 0.5 ? '2px' : '1.5px',
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${1.5 + Math.random() * 2}s`,
                opacity: 0.3 + Math.random() * 0.7
              }}
            />
          ))}
          {/* Yellow/Golden Stars - 120 total */}
          {[...Array(120)].map((_, i) => (
            <div
              key={`yellow-${i}`}
              className="absolute rounded-full bg-yellow-300 animate-pulse"
              style={{
                width: Math.random() > 0.5 ? '2.5px' : '2px',
                height: Math.random() > 0.5 ? '2.5px' : '2px',
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${1 + Math.random() * 2}s`,
                opacity: 0.4 + Math.random() * 0.6
              }}
            />
          ))}
          {/* Yellow/Golden Stars */}
          {[...Array(80)].map((_, i) => (
            <div
              key={`yellow-${i}`}
              className="absolute rounded-full bg-yellow-300 animate-pulse"
              style={{
                width: Math.random() > 0.5 ? '2.5px' : '2px',
                height: Math.random() > 0.5 ? '2.5px' : '2px',
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${1 + Math.random() * 2}s`,
                opacity: 0.4 + Math.random() * 0.6
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative max-w-md w-full mx-auto p-4">
        {/* Main Card Container - Fully Transparent */}
        <div className="bg-transparent border-2 border-white/10 rounded-3xl p-4">
          {/* Top Header Bar */}
          <div className="flex items-center justify-between mb-4">
            {/* Left: Avatar & Username */}
            <div className="flex items-center gap-3">
              {farcasterUser?.pfpUrl ? (
                <img 
                  src={farcasterUser.pfpUrl} 
                  alt="Profile" 
                  className="w-10 h-10 rounded-full border-2 border-white/30"
                />
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-white/30 bg-white/20"></div>
              )}
              <div>
                <div className="text-xs text-white/60">@{playerStats?.rank || '1'}</div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold text-sm">{farcasterUser?.username}</span>
                  <span className="bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full">Top 10</span>
                </div>
              </div>
            </div>
            
            {/* Right: Points & Currency */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-blue-500/80 backdrop-blur-sm px-3 py-1.5 rounded-full">
                <span className="text-white">💎</span>
                <span className="text-white text-sm font-bold">{formatScore(playerStats?.points || 0)}</span>
              </div>
            </div>
          </div>

          {/* Banner Card */}
        <div className="mx-4 mb-6 bg-gradient-to-r from-purple-600 to-blue-600 rounded-3xl p-6 relative overflow-hidden">
          <div className="relative z-10">
            <h3 className="text-white text-2xl font-bold mb-1">Crack the Quiz</h3>
            <h4 className="text-white text-xl font-bold mb-3">Grab 10K</h4>
            <p className="text-white/80 text-xs mb-4">Play and win big time to compete!</p>
            <button 
              onClick={findMatch}
              className="bg-cyan-400 hover:bg-cyan-300 text-blue-900 font-bold text-sm px-8 py-2.5 rounded-full transition-all active:scale-95"
            >
              Play
            </button>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-blue-600/50 to-transparent">
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-6xl opacity-70">🏆</div>
          </div>
        </div>

        {/* Quiz Section */}
        <div className="px-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h5 className="text-white font-bold text-lg">Quiz</h5>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {/* Play Button - transparent with internal stars */}
            <button 
              onClick={findMatch}
              className="backdrop-blur-sm bg-blue-900/30 border border-white/20 rounded-2xl p-4 flex flex-col items-center justify-center aspect-square hover:scale-105 transition-transform active:scale-95 relative overflow-hidden"
            >
              {/* Internal stars */}
              {[...Array(15)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.3,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              <svg className="w-8 h-8 mb-2 relative z-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <div className="text-white text-xs font-semibold text-center relative z-10">Play</div>
            </button>
            
            {/* Rank Button - transparent with internal stars */}
            <button 
              onClick={() => setShowLeaderboard(true)}
              className="backdrop-blur-sm bg-blue-900/30 border border-white/20 rounded-2xl p-4 flex flex-col items-center justify-center aspect-square hover:scale-105 transition-transform active:scale-95 relative overflow-hidden"
            >
              {/* Internal stars */}
              {[...Array(15)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.3,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              <svg className="w-8 h-8 mb-2 relative z-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <div className="text-white text-xs font-semibold text-center relative z-10">Rank</div>
            </button>
            
            {/* Add Q Button - transparent with internal stars */}
            <button 
              onClick={() => setShowAddQuestion(true)}
              className="backdrop-blur-sm bg-blue-900/30 border border-white/20 rounded-2xl p-4 flex flex-col items-center justify-center aspect-square hover:scale-105 transition-transform active:scale-95 relative overflow-hidden"
            >
              {/* Internal stars */}
              {[...Array(15)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.3,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              <svg className="w-8 h-8 mb-2 relative z-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <div className="text-white text-xs font-semibold text-center relative z-10">Add Q</div>
            </button>
          </div>
        </div>

        {/* Leaderboard Preview Section */}
        <div className="px-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h5 className="text-white font-bold text-lg">Leaderboard</h5>
            <button 
              onClick={() => setShowLeaderboard(true)}
              className="text-cyan-400 text-sm font-semibold"
            >
              View all
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {leaderboardData && leaderboardData.length > 0 ? (
              leaderboardData.slice(0, 4).map((user, index) => {
                const formatPoints = (points) => {
                  if (points >= 1000000) {
                    return `${(points / 1000000).toFixed(points % 1000000 === 0 ? 0 : 1)}m`;
                  }
                  if (points >= 1000) {
                    return `${(points / 1000).toFixed(points % 1000 === 0 ? 0 : 1)}k`;
                  }
                  return points.toString();
                };
                
                return (
                  <div 
                    key={user.fid}
                    className="flex flex-col items-center"
                  >
                    <img 
                      src={user.pfpUrl} 
                      alt={user.username}
                      className="w-12 h-12 rounded-full border-2 border-white/40 mb-[-24px] relative z-10"
                    />
                    <div className="backdrop-blur-sm bg-white/5 border border-white/30 rounded-xl pt-8 pb-3 px-3 w-full flex flex-col items-center">
                      <div className="text-white text-xs font-semibold text-center truncate w-full mb-1">
                        {user.username}
                      </div>
                      <div className="text-white text-[11px] font-semibold px-2 py-0.5 rounded-md backdrop-blur-sm bg-white/10 border border-white/20 shadow-[0_0_10px_rgba(255,255,255,0.1)]">
                        {formatPoints(user.points)}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              // Placeholder cards while loading
              [...Array(4)].map((_, i) => (
                <div 
                  key={i}
                  className="flex flex-col items-center"
                >
                  <div className="w-12 h-12 rounded-full border-2 border-white/40 mb-[-24px] relative z-10 bg-white/10"></div>
                  <div className="backdrop-blur-sm bg-white/5 border border-white/30 rounded-xl pt-8 pb-3 px-3 w-full flex flex-col items-center">
                    <div className="text-white text-xs font-semibold text-center">Loading...</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );

  const renderSearching = () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="relative max-w-md w-full">
        <div className="relative backdrop-blur-sm bg-white/5 border border-white/20 rounded-[48px] p-12 shadow-xl overflow-hidden">
          {/* Internal stars */}
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white animate-pulse"
              style={{
                width: `${Math.random() * 0.5 + 1}px`,
                height: `${Math.random() * 0.5 + 1}px`,
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.4 + 0.2,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${1 + Math.random() * 2}s`
              }}
            />
          ))}
          
          {/* Animated spinner */}
          <div className="relative w-24 h-24 mx-auto mb-8 z-10">
            <div className="absolute inset-0 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-white/60 rounded-full animate-spin" style={{ animationDuration: '1s', animationDirection: 'reverse' }}></div>
          </div>
          
          <h2 className="text-3xl font-black text-white mb-3 text-center animate-pulse relative z-10">Finding opponent...</h2>
          <p className="text-white/70 text-center mb-8 relative z-10">Please wait ⏳</p>
          
          <button
            onClick={leaveGame}
            className="relative group w-full px-8 py-3 rounded-[28px] text-sm font-bold shadow-xl transition-all backdrop-blur-sm bg-red-500/20 text-white hover:text-white border-2 border-white/30 hover:border-red-500/50 hover:bg-red-500/30 overflow-hidden z-10"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"></div>
            <span className="relative z-10">Cancel Search</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderMatched = () => (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="backdrop-blur-sm bg-white/5 border border-white/20 rounded-[40px] shadow-xl p-10 max-w-md w-full relative overflow-hidden">
        {/* Internal stars */}
        {[...Array(25)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white animate-pulse"
            style={{
              width: `${Math.random() * 0.5 + 1}px`,
              height: `${Math.random() * 0.5 + 1}px`,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.4 + 0.2,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${1 + Math.random() * 2}s`
            }}
          />
        ))}
        
        <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-8 text-center relative z-10">
          Match Found! 🎉</h2>
        
        <div className="flex justify-around items-center mb-8 relative z-10">
          <div className="text-center">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-20 h-20 rounded-full border-4 border-white/40 shadow-2xl mb-2" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-white/40 shadow-2xl bg-white/10 flex items-center justify-center mb-2">
                <span className="text-3xl">👤</span>
              </div>
            )}
            <p className="text-white font-semibold drop-shadow-lg">{farcasterUser?.username}</p>
          </div>
          
          <div className="text-5xl drop-shadow-2xl text-white">VS</div>
          
          <div className="text-center">
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-20 h-20 rounded-full border-4 border-white/40 shadow-2xl mb-2" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-white/40 shadow-2xl bg-white/10 flex items-center justify-center mb-2">
                <span className="text-3xl">👤</span>
              </div>
            )}
            <p className="text-white font-semibold drop-shadow-lg">{opponent?.username}</p>
          </div>
        </div>
        
        <p className="text-white/80 text-lg text-center drop-shadow-lg relative z-10">Starting game...</p>
      </div>
    </div>
  );

  // Unified Header Component
  const renderGameHeader = (showSubject = false) => (
    <div className="backdrop-blur-sm bg-white/5 border border-white/20 rounded-[24px] p-4 mb-4 shadow-xl max-w-5xl w-full mx-auto relative overflow-hidden">
      {/* Internal stars */}
      {[...Array(15)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white animate-pulse pointer-events-none"
          style={{
            width: `${Math.random() * 0.5 + 1}px`,
            height: `${Math.random() * 0.5 + 1}px`,
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            opacity: Math.random() * 0.3 + 0.2,
            animationDelay: `${Math.random() * 2}s`,
            animationDuration: `${1 + Math.random() * 2}s`
          }}
        />
      ))}
      <div className="flex items-center justify-between gap-4 relative z-10">
        {/* Left: Your Profile */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {farcasterUser?.pfpUrl ? (
            <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 shadow-lg flex-shrink-0" style={{ borderColor: '#6a3cff' }} />
          ) : (
            <div className="w-10 h-10 rounded-full border-2 bg-gray-800 flex items-center justify-center shadow-lg flex-shrink-0" style={{ borderColor: '#6a3cff' }}>
              <span className="text-sm">👤</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{farcasterUser?.username}</p>
            <p className="text-xs font-bold" style={{ color: '#a78bff' }}>{myScore}</p>
          </div>
        </div>
        
        {/* Center: Round & Subject Info */}
        <div className="text-center flex-shrink-0">
          <p className="text-white font-bold text-sm">Round {gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
          {showSubject && gameRoom?.currentSubject && (
            <span className="inline-block text-white px-3 py-0.5 rounded-full text-xs font-bold shadow-lg mt-1" style={{ background: 'linear-gradient(90deg, #6a3cff, #7a4cff)' }}>
              {gameRoom.currentSubject}
            </span>
          )}
        </div>
        
        {/* Right: Opponent Profile */}
        <div className="flex items-center gap-2 justify-end flex-1 min-w-0">
          <div className="text-right min-w-0">
            <p className="text-white font-bold text-sm truncate">{opponent?.username}</p>
            <p className="text-xs font-bold" style={{ color: '#a78bff' }}>{opponentScore}</p>
          </div>
          {opponent?.pfpUrl ? (
            <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 shadow-lg flex-shrink-0" style={{ borderColor: '#6a3cff' }} />
          ) : (
            <div className="w-10 h-10 rounded-full border-2 bg-gray-800 flex items-center justify-center shadow-lg flex-shrink-0" style={{ borderColor: '#6a3cff' }}>
              <span className="text-sm">👤</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Leave Game Button - Below */}
      <div className="mt-3 text-right relative z-10">
        <button
          onClick={() => setShowLeaveConfirm(true)}
          className="backdrop-blur-sm bg-red-500/20 border border-white/30 hover:bg-red-500/30 text-white px-4 py-1.5 rounded-[12px] text-xs font-bold shadow-lg transition-all"
        >
          Leave Game
        </button>
      </div>
    </div>
  );

  const renderSubjectSelection = () => (
    <div className="min-h-screen flex flex-col p-4">
      {renderGameHeader(false)}

      {/* Subject Selection */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md w-full">
          <h2 className="text-3xl font-bold text-white mb-6 drop-shadow-2xl">
            {isMyTurnToPick ? 'Choose a Subject 🎯' : 'Opponent is choosing...'}
          </h2>
          
          {/* Subject Progress Bar */}
          {isMyTurnToPick && timerActiveSubject && (
            <div className="mb-6">
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden shadow-2xl border-2 border-gray-700">
                <div 
                  className={`h-full transition-all duration-100 ${
                    timeRemainingSubject <= 5 ? 'bg-gradient-to-r from-red-500 to-red-600 animate-pulse' : 
                    timeRemainingSubject <= 10 ? 'bg-gradient-to-r from-yellow-500 to-yellow-600' : 
                    'bg-gradient-to-r from-blue-500 to-blue-600'
                  }`}
                  style={{ width: `${(timeRemainingSubject / 20) * 100}%` }}
                ></div>
              </div>
              <p className="text-center text-xs mt-2 font-semibold">
                <span className={`${
                  timeRemainingSubject <= 5 ? 'text-red-400' : 
                  timeRemainingSubject <= 10 ? 'text-yellow-400' : 
                  'text-blue-400'
                }`}>
                  {Math.ceil(timeRemainingSubject)}s remaining
                </span>
              </p>
            </div>
          )}
          
          {isMyTurnToPick ? (
            <div className="space-y-4">
              {(gameRoom?.availableSubjectsForRound || subjects).map((subject, index) => {
                const isSelected = selectedSubject === subject;
                return (
                  <button
                    key={subject}
                    onClick={() => !selectedSubject && selectSubject(subject)}
                    disabled={!!selectedSubject}
                    style={{
                      animationDelay: `${index * 0.1}s`,
                      transform: isSelected ? 'translateZ(50px) scale(1.05)' : 'translateZ(0)',
                    }}
                    className={`group relative w-full py-6 rounded-[32px] font-black text-xl shadow-xl border-2 transition-all duration-500 overflow-hidden animate-[slideIn_0.5s_ease-out_forwards] opacity-0 ${
                      isSelected
                        ? 'backdrop-blur-sm bg-white/20 text-white border-white/50 scale-105 shadow-xl'
                        : selectedSubject
                        ? 'backdrop-blur-sm bg-white/5 text-gray-400 border-white/10 cursor-not-allowed'
                        : 'backdrop-blur-sm bg-white/10 text-white border-white/20 hover:border-white/40 hover:bg-white/15 hover:scale-[1.03] active:scale-95 cursor-pointer'
                    }`}
                  >
                    {/* Internal stars */}
                    {!selectedSubject && [...Array(10)].map((_, i) => (
                      <div
                        key={i}
                        className="absolute rounded-full bg-white animate-pulse"
                        style={{
                          width: `${Math.random() * 0.5 + 1}px`,
                          height: `${Math.random() * 0.5 + 1}px`,
                          top: `${Math.random() * 100}%`,
                          left: `${Math.random() * 100}%`,
                          opacity: Math.random() * 0.3 + 0.2,
                          animationDelay: `${Math.random() * 2}s`,
                          animationDuration: `${1 + Math.random() * 2}s`
                        }}
                      />
                    ))}
                    
                    {/* 3D shine effect */}
                    <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 ${isSelected ? 'animate-[shimmer_2s_ease-in-out_infinite]' : 'group-hover:animate-[shimmer_2s_ease-in-out_infinite]'}`}></div>
                    
                    {/* Content */}
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {subject}
                      {isSelected && (
                        <span className="animate-bounce text-2xl">✨</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="relative">
              <div className="w-20 h-20 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto drop-shadow-2xl"></div>
              <div className="absolute inset-0 w-20 h-20 border-4 border-transparent border-t-white/60 rounded-full animate-spin mx-auto" style={{ animationDuration: '1s', animationDirection: 'reverse' }}></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderWaitingSubject = () => (
    <div className="min-h-screen flex flex-col p-4">
      {renderGameHeader(false)}

      {/* Waiting message with timer */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center backdrop-blur-sm bg-white/5 border border-white/20 rounded-[40px] shadow-xl p-10 relative overflow-hidden">
          {/* Internal stars */}
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white animate-pulse"
              style={{
                width: `${Math.random() * 0.5 + 1}px`,
                height: `${Math.random() * 0.5 + 1}px`,
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.4 + 0.2,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${1 + Math.random() * 2}s`
              }}
            />
          ))}
          
          {/* Timer */}
          {timerActiveSubject && (
            <div className="mb-6 relative z-10">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full border-4 backdrop-blur-sm ${
                timeRemainingSubject <= 5 ? 'border-white/40 bg-white/10 animate-pulse' : 'border-white/40 bg-white/10'
              } shadow-xl`}>
                <span className={`text-3xl font-bold text-white drop-shadow-lg`}>
                  {Math.ceil(timeRemainingSubject)}
                </span>
              </div>
            </div>
          )}
          <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-4 drop-shadow-2xl relative z-10"></div>
          <h2 className="text-2xl font-bold text-white mb-2 drop-shadow-lg relative z-10">{opponent?.username} is choosing...</h2>
          <p className="text-white/80 drop-shadow relative z-10">Get ready!</p>
        </div>
      </div>
    </div>
  );

  const renderSubjectResult = () => (
    <div className="min-h-screen flex flex-col p-4">
      {renderGameHeader(false)}

      {/* Subject Result Animation */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md w-full">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 mb-8 drop-shadow-2xl animate-pulse">
            Subject Selected! ✨
          </h2>
          
          {/* 3D Card with modern animations */}
          <div className="relative perspective-1000">
            {/* Animated glow rings */}
            <div className="absolute inset-0 animate-[ping_2s_ease-in-out_infinite]">
              <div className="w-full h-full rounded-[48px] bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 opacity-20 blur-2xl"></div>
            </div>
            
            {/* Main card */}
            <div className="relative backdrop-blur-sm bg-white/10 border-2 border-white/30 rounded-[48px] shadow-xl p-10 animate-[float_3s_ease-in-out_infinite] overflow-hidden">
              {/* Internal stars */}
              {[...Array(30)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.2,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              
              {/* Top shine effect */}
              <div className="absolute top-0 left-1/4 right-1/4 h-1 bg-gradient-to-r from-transparent via-white to-transparent animate-pulse"></div>
              
              {/* Subject text */}
              <div className="relative z-10">
                <div className="text-6xl font-black text-white drop-shadow-2xl mb-4 animate-[scaleIn_0.5s_ease-out] leading-tight">
                  {gameRoom?.currentSubject}
                </div>
              </div>
              
              <div className="text-white text-xl font-bold drop-shadow-lg animate-[fadeIn_1s_ease-in] relative z-10">
                Get Ready! 🚀
              </div>
              
              {/* Bottom glow line */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white to-transparent animate-[shimmer_2s_ease-in-out_infinite]"></div>
            </div>
            
            {/* Orbiting particles */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] pointer-events-none">
              <div className="absolute top-0 left-1/2 w-3 h-3 bg-purple-400 rounded-full blur-sm animate-[orbit_4s_linear_infinite]"></div>
              <div className="absolute top-0 left-1/2 w-2 h-2 bg-pink-400 rounded-full blur-sm animate-[orbit_5s_linear_infinite]" style={{ animationDelay: '1s' }}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPlaying = () => {
    // If I finished, show waiting screen
    if (iFinished) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="backdrop-blur-sm bg-white/5 border border-white/20 rounded-[40px] shadow-xl p-8 relative overflow-hidden">
              {/* Internal stars */}
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.2,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl relative z-10">You Finished! 🎯</h2>
              <p className="text-white/80 text-lg mb-6 drop-shadow-lg relative z-10">
                Waiting for {opponent?.username} to finish...
              </p>
              <div className="mb-6 relative z-10">
                <p className="text-white text-5xl font-bold mb-2 drop-shadow-2xl">{myScore}</p>
                <p className="text-white/70 drop-shadow">Your Points</p>
              </div>
              <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto drop-shadow-2xl relative z-10"></div>
            </div>
          </div>
        </div>
      );
    }
    
    if (!currentQuestion) {
      console.log('[Render] ⚠️ No current question!');
      console.log('[Render] - myProgress:', myProgress);
      console.log('[Render] - gameRoom:', gameRoom);
      console.log('[Render] - questions:', gameRoom?.questions);
      console.log('[Render] - questions.length:', gameRoom?.questions?.length);
      
      // Show loading instead of blank screen
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="backdrop-blur-sm bg-white/5 border border-white/20 rounded-[40px] shadow-xl p-8 relative overflow-hidden">
              {/* Internal stars */}
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.2,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl relative z-10">Loading Question...</h2>
              <p className="text-white/80 text-lg mb-6 drop-shadow-lg relative z-10">
                Preparing your questions
              </p>
              <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto drop-shadow-2xl relative z-10"></div>
            </div>
          </div>
        </div>
      );
    }

    console.log('[Render] Current question:', currentQuestion.id, 'options:', currentQuestion.options?.length);

    const hasAnswered = selectedAnswer !== null;
    const bothAnswered = showingResults && lastResult !== null;

    return (
      <div className="min-h-screen flex flex-col p-4 overflow-hidden">
        {renderGameHeader(true)}

        {/* Question - Compact Layout */}
        <div className="flex-1 flex flex-col justify-center max-w-4xl w-full mx-auto py-2">
          {/* Progress Bar Timer */}
          {timerActiveQuestion && (
            <div className="mb-3">
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden shadow-2xl border-2 border-gray-700">
                <div 
                  className={`h-full transition-all duration-100 ${
                    timeRemainingQuestion <= 5 ? 'bg-gradient-to-r from-red-500 to-red-600 animate-pulse' : 
                    timeRemainingQuestion <= 10 ? 'bg-gradient-to-r from-yellow-500 to-yellow-600' : 
                    'bg-gradient-to-r from-green-500 to-green-600'
                  }`}
                  style={{ width: `${(timeRemainingQuestion / 18) * 100}%` }}
                ></div>
              </div>
              <p className="text-center text-xs mt-1 font-semibold">
                <span className={`${
                  timeRemainingQuestion <= 5 ? 'text-red-400' : 
                  timeRemainingQuestion <= 10 ? 'text-yellow-400' : 
                  'text-green-400'
                }`}>
                  {Math.ceil(timeRemainingQuestion)}s
                </span>
              </p>
            </div>
          )}
          
          {/* Question Card - Compact */}
          <div className="relative mb-4 animate-[slideIn_0.5s_ease-out]">
            <div className="relative backdrop-blur-sm bg-white/10 border border-white/30 rounded-[24px] p-4 shadow-xl overflow-hidden">
              {/* Internal stars */}
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.3 + 0.2,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent"></div>
              <h3 className="text-white text-lg font-bold text-center leading-snug relative z-10">
                {currentQuestion.question}
              </h3>
              {currentQuestion.submittedBy?.username && (
                <p className="text-white/50 text-[10px] text-center mt-1.5 opacity-70 relative z-10">
                  by @{currentQuestion.submittedBy.username}
                </p>
              )}
              {/* Debug: Show if submittedBy exists */}
              {!currentQuestion.submittedBy?.username && (
                <p className="text-white/50 text-[10px] text-center mt-1.5 opacity-70 relative z-10">
                  Community Question
                </p>
              )}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent"></div>
            </div>
          </div>

          {/* Answer Options - 2x2 Grid */}
          <div className="grid grid-cols-2 gap-3">
            {currentQuestion.options?.map((option, index) => {
              const isCorrect = index === currentQuestion.correctAnswer;
              const isMyAnswer = selectedAnswer === index;
              const showInstantFeedback = hasAnswered && answerFeedback && isMyAnswer;
              
              let buttonClass = "group relative w-full py-4 px-4 rounded-[20px] font-bold text-center transition-all duration-500 shadow-xl overflow-hidden h-24 flex items-center justify-center";
              
              if (bothAnswered && lastResult) {
                // Show final results (both players answered)
                if (isCorrect) {
                  buttonClass += " bg-gradient-to-br from-green-500 via-green-600 to-green-500 text-white border-2 border-green-400 shadow-[0_0_30px_rgba(34,197,94,0.5)]";
                } else if (isMyAnswer) {
                  buttonClass += " bg-gradient-to-br from-red-500 via-red-600 to-red-500 text-white border-2 border-red-400 shadow-[0_0_30px_rgba(239,68,68,0.5)]";
                } else {
                  buttonClass += " bg-gray-900/50 border-2 border-gray-800 text-gray-500 backdrop-blur-sm";
                }
              } else if (showInstantFeedback) {
                // Show instant feedback after selection with dramatic animation
                if (answerFeedback === 'correct') {
                  buttonClass += " bg-gradient-to-br from-green-500 via-green-600 to-green-500 text-white border-4 border-green-400 animate-[pulse_0.8s_ease-in-out_infinite] scale-105 shadow-[0_0_40px_rgba(34,197,94,0.6)]";
                } else {
                  buttonClass += " bg-gradient-to-br from-red-500 via-red-600 to-red-500 text-white border-4 border-red-400 animate-[pulse_0.8s_ease-in-out_infinite] scale-105 shadow-[0_0_40px_rgba(239,68,68,0.6)]";
                }
              } else if (hasAnswered && isMyAnswer) {
                // Selected but waiting
                buttonClass += " bg-gradient-to-br from-blue-500 via-blue-600 to-blue-500 text-white border-2 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)]";
              } else if (hasAnswered) {
                // Not selected, disabled
                buttonClass += " backdrop-blur-sm bg-white/5 border-2 border-white/10 text-gray-400 pointer-events-none";
              } else {
                // Not answered yet, hoverable
                buttonClass += " backdrop-blur-sm bg-white/10 border-2 border-white/20 text-white hover:border-white/40 hover:bg-white/15 hover:scale-[1.05] active:scale-95 cursor-pointer";
              }

              return (
                <button
                  key={index}
                  onClick={() => {
                    if (!hasAnswered) {
                      submitAnswer(index);
                    }
                  }}
                  disabled={hasAnswered}
                  style={{ animationDelay: `${index * 0.1 + 0.3}s` }}
                  className={`${buttonClass} ${!hasAnswered ? 'animate-[slideIn_0.5s_ease-out_forwards] opacity-0' : ''} focus:outline-none focus-visible:outline-none`}
                >
                  {/* Shimmer effect */}
                  {!hasAnswered && !showInstantFeedback && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -skew-x-12 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"></div>
                  )}
                  
                  {/* Content */}
                  <span className="relative z-10 flex items-center justify-center gap-2 text-sm leading-tight">
                    <span className="line-clamp-3">{option}</span>
                    {showInstantFeedback && answerFeedback === 'correct' && <span className="text-xl flex-shrink-0">✓</span>}
                    {showInstantFeedback && answerFeedback === 'incorrect' && <span className="text-xl flex-shrink-0">✗</span>}
                    {bothAnswered && isCorrect && <span className="text-xl flex-shrink-0">✓</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {bothAnswered && lastResult && (
            <div className="mt-3 backdrop-blur-lg bg-gray-800 border border-gray-800 rounded-[20px] p-3 shadow-lg">
              <div className="flex justify-between">
                {lastResult.map((result: any) => (
                  <div key={result.playerId} className="text-center">
                    <p className="text-white font-semibold text-sm">{result.username}</p>
                    <p className="text-xl">{result.correct ? '✓' : '✗'}</p>
                    <p className="text-gray-300 text-xs">Points: {result.points}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRoundResult = () => {
    // CRITICAL: Use playerIdRef.current as fallback
    const currentPlayerId = playerId || playerIdRef.current;
    const winner = gameRoom?.players.find(p => (gameRoom?.scores[p.id] || 0) > (opponent && gameRoom?.scores[opponent.id] || 0) ? true : false);
    const isDraw = myScore === opponentScore;
    const iAmReady = gameRoom?.playersReady?.includes(currentPlayerId) || false;
    const opponentReady = opponent && gameRoom?.playersReady?.includes(opponent.id) || false;
    
    console.log('[RoundResult] Checking ready status');
    console.log('[RoundResult] - playerId state:', playerId);
    console.log('[RoundResult] - playerIdRef.current:', playerIdRef.current);
    console.log('[RoundResult] - currentPlayerId:', currentPlayerId);
    console.log('[RoundResult] - opponent?.id:', opponent?.id);
    console.log('[RoundResult] - gameRoom?.playersReady:', gameRoom?.playersReady);
    console.log('[RoundResult] - iAmReady:', iAmReady, '(checking if', currentPlayerId, 'is in playersReady)');
    console.log('[RoundResult] - opponentReady:', opponentReady, '(checking if', opponent?.id, 'is in playersReady)');

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          {/* 3D Card with glow effect */}
          <div className="relative">
            <div className="relative backdrop-blur-sm bg-white/10 border border-white/30 rounded-[48px] shadow-xl p-8 overflow-hidden">
              {/* Internal stars */}
              {[...Array(30)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: `${Math.random() * 0.5 + 1}px`,
                    height: `${Math.random() * 0.5 + 1}px`,
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: Math.random() * 0.4 + 0.2,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random() * 2}s`
                  }}
                />
              ))}
              
              <h2 className="text-4xl font-black text-white drop-shadow-2xl mb-6 animate-[scaleIn_0.5s_ease-out] relative z-10">
                Round {gameRoom?.currentRound} Complete! 🎉
              </h2>
          
          {/* Auto-ready timer progress bar */}
          {!iAmReady && timerActiveRound && (
            <div className="mb-6 relative z-10">
              <div className="w-full backdrop-blur-sm bg-white/10 rounded-full h-3 overflow-hidden shadow-xl border border-white/30">
                <div 
                  className={`h-full transition-all duration-100 ${
                    timeRemainingRound <= 5 ? 'bg-gradient-to-r from-red-500 to-red-600 animate-pulse' : 
                    timeRemainingRound <= 10 ? 'bg-gradient-to-r from-yellow-500 to-yellow-600' : 
                    'bg-gradient-to-r from-blue-500 to-blue-600'
                  }`}
                  style={{ width: `${(timeRemainingRound / 15) * 100}%` }}
                ></div>
              </div>
              <p className="text-center text-sm mt-2 font-semibold">
                <span className={
                  timeRemainingRound <= 5 ? 'text-red-400' : 
                  timeRemainingRound <= 10 ? 'text-yellow-400' : 
                  'text-blue-400'
                }>
                  Auto-ready in {Math.ceil(timeRemainingRound)}s
                </span>
              </p>
            </div>
          )}
          
          <div className="backdrop-blur-sm bg-white/10 border border-white/30 rounded-[32px] p-6 mb-6 shadow-lg relative z-10">
            <div className="flex justify-around">
              <div className="text-center relative">
                {farcasterUser?.pfpUrl ? (
                  <img src={farcasterUser.pfpUrl} alt="You" className="w-16 h-16 rounded-full border-4 border-white/40 shadow-2xl mx-auto mb-2" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-white/40 bg-white/10 flex items-center justify-center mx-auto mb-2 shadow-2xl">
                    <span className="text-2xl">👤</span>
                  </div>
                )}
                {iAmReady && (
                  <div 
                    className="absolute top-0 right-0 rounded-full w-8 h-8 flex items-center justify-center border-2 shadow-lg bg-green-500 border-green-400"
                  >
                    <span className="text-white text-lg font-bold">✓</span>
                  </div>
                )}
                <p className="text-white font-bold drop-shadow-lg">{farcasterUser?.username}</p>
                <p className="text-white text-3xl font-bold drop-shadow-2xl">{myScore}</p>
              </div>
              
              <div className="text-center relative">
                {opponent?.pfpUrl ? (
                  <img src={opponent.pfpUrl} alt="Opponent" className="w-16 h-16 rounded-full border-4 border-white/40 shadow-2xl mx-auto mb-2" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-white/40 bg-white/10 flex items-center justify-center mx-auto mb-2 shadow-2xl">
                    <span className="text-2xl">👤</span>
                  </div>
                )}
                {opponentReady && (
                  <div 
                    className="absolute top-0 right-0 rounded-full w-8 h-8 flex items-center justify-center border-2 shadow-lg bg-green-500 border-green-400"
                  >
                    <span className="text-white text-lg font-bold">✓</span>
                  </div>
                )}
                <p className="text-white font-bold drop-shadow-lg">{opponent?.username}</p>
                <p className="text-white text-3xl font-bold drop-shadow-2xl">{opponentScore}</p>
              </div>
            </div>
          </div>
          
          <p className="text-white text-2xl font-bold mb-6 drop-shadow-2xl relative z-10">
            {isDraw ? "It's a Draw! 🤝" : winner?.id === playerId ? 'You Won This Round! 🏆' : `${opponent?.username} Won! 👑`}
          </p>
          
          {gameRoom && gameRoom.currentRound < gameRoom.maxRounds ? (
            <>
              <button
                onClick={startNextRound}
                disabled={iAmReady}
                className={`relative px-12 py-5 rounded-[32px] text-xl font-black shadow-xl transition-all mb-6 border-2 overflow-hidden group z-10 ${
                  iAmReady 
                    ? 'backdrop-blur-sm bg-green-500/30 border-green-500/50 text-white cursor-not-allowed' 
                    : 'backdrop-blur-sm bg-blue-500/30 border-white/40 text-white hover:scale-[1.05] hover:bg-blue-500/40 active:scale-95'
                }`}
              >
                {!iAmReady && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"></div>
                )}
                <span className="relative z-10">{iAmReady ? '✓ Ready!' : 'Ready for Next Round'}</span>
              </button>
              
              {/* Waiting message */}
              {iAmReady && !opponentReady && (
                <p className="text-white/70 text-sm mb-6 animate-pulse relative z-10">
                  Waiting for {opponent?.username}...
                </p>
              )}
            </>
          ) : (
            <p className="text-white text-lg font-bold animate-pulse relative z-10">Calculating final results...</p>
          )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGameOver = () => {
    const winner = gameRoom?.players.find(p => (gameRoom?.scores[p.id] || 0) > (opponent && gameRoom?.scores[opponent.id] || 0) ? true : false);
    const isDraw = myScore === opponentScore;
    const iWon = winner?.id === (playerId || playerIdRef.current);

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          {/* 3D Card with celebration effect */}
          <div className="relative">
            <div className={`absolute inset-0 blur-2xl animate-pulse ${iWon ? 'bg-gradient-to-r from-green-500/40 via-yellow-500/40 to-green-500/40' : isDraw ? 'bg-gradient-to-r from-blue-500/30 via-purple-500/30 to-blue-500/30' : 'bg-gradient-to-r from-gray-500/20 via-gray-600/20 to-gray-500/20'}`}></div>
            <div className={`relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 border-2 rounded-[48px] shadow-2xl p-8 backdrop-blur-xl ${iWon ? 'border-yellow-500/50 shadow-[0_0_60px_rgba(234,179,8,0.4)]' : isDraw ? 'border-blue-500/50 shadow-[0_0_60px_rgba(59,130,246,0.4)]' : 'border-gray-700'}`}>
              <h2 className={`text-5xl font-black mb-6 animate-[scaleIn_0.6s_ease-out] ${iWon ? 'text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-yellow-500 to-yellow-300' : isDraw ? 'text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400' : 'text-white'}`}>
                {iWon ? '🏆 Victory! 🏆' : isDraw ? '🤝 Draw! 🤝' : 'Game Over! 👏'}
              </h2>
          
          <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-6 mb-6 shadow-lg">
            <div className="flex justify-around">
              <div className="text-center">
                {farcasterUser?.pfpUrl ? (
                  <img src={farcasterUser.pfpUrl} alt="You" className="w-20 h-20 rounded-full border-4 border-gray-700 ring-4 ring-gray-700 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-20 h-20 rounded-full border-4 border-gray-700 bg-gray-900 flex items-center justify-center mx-auto mb-2 ring-4 ring-gray-700 shadow-2xl">
                    <span className="text-3xl"></span>
                  </div>
                )}
                <p className="text-white font-bold text-lg drop-shadow-lg">{farcasterUser?.username}</p>
                <p className="text-white text-4xl font-bold drop-shadow-2xl">{myScore}</p>
              </div>
              
              <div className="text-center">
                {opponent?.pfpUrl ? (
                  <img src={opponent.pfpUrl} alt="Opponent" className="w-20 h-20 rounded-full border-4 border-gray-700 ring-4 ring-gray-700 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-20 h-20 rounded-full border-4 border-gray-700 bg-gray-900 flex items-center justify-center mx-auto mb-2 ring-4 ring-gray-700 shadow-2xl">
                    <span className="text-3xl"></span>
                  </div>
                )}
                <p className="text-white font-bold text-lg drop-shadow-lg">{opponent?.username}</p>
                <p className="text-white text-4xl font-bold drop-shadow-2xl">{opponentScore}</p>
              </div>
            </div>
          </div>
          
          <div className="mb-8">
            {isDraw ? (
              <>
                <p className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 text-2xl font-bold mb-2 animate-[fadeIn_0.8s_ease-in]">It&apos;s a Draw! 🤝</p>
                <p className="text-gray-300 drop-shadow-lg">Great match!</p>
              </>
            ) : iWon ? (
              <>
                <p className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-500 text-2xl font-bold mb-2 animate-[fadeIn_0.8s_ease-in]">You Won! 🎉</p>
                <p className="text-gray-300 drop-shadow-lg">Congratulations!</p>
              </>
            ) : (
              <>
                <p className="text-white text-2xl font-bold mb-2 animate-[fadeIn_0.8s_ease-in]">{opponent?.username} Won! 👑</p>
                <p className="text-gray-300 drop-shadow-lg">Better luck next time!</p>
              </>
            )}
          </div>
          
          <p className="text-xl text-white mb-6">
            Returning home in <span className="text-4xl font-black animate-pulse" style={{ color: '#6a3cff' }}>{autoReturnCountdown}</span>...
          </p>

          <button
            onClick={async () => {
              // Cancel auto-return
              if (autoReturnTimerRef.current) {
                clearTimeout(autoReturnTimerRef.current);
                autoReturnTimerRef.current = null;
              }
              
              await leaveGame();
              // Immediately start finding a new match
              findMatch();
            }}
            className="relative group px-12 py-5 rounded-[32px] text-xl font-black shadow-2xl transition-all border-2 bg-gradient-to-br from-purple-600 via-pink-600 to-purple-600 text-white hover:scale-[1.05] active:scale-95 border-purple-400 hover:shadow-[0_0_40px_rgba(168,85,247,0.6)] overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"></div>
            <span className="relative z-10">Find New Match 🎮</span>
          </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Leaderboard Modal
  const renderLeaderboard = () => {
    const topThree = leaderboardData.slice(0, 3);
    const restOfList = leaderboardData.slice(3);
    
    return (
      <div className="fixed inset-0 flex items-center justify-center p-4 z-50 animate-[fadeIn_0.3s_ease-out]">
        {/* Same wavy background as idle screen */}
        <div className="fixed inset-0 bg-gradient-to-b from-[#0a1628] via-[#0f2847] to-[#0a1628]">
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1200 800">
            <defs>
              <linearGradient id="waveGradient1Leaderboard" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: 'rgba(26,77,122,0.5)', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: 'rgba(42,123,181,0.4)', stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id="waveGradient2Leaderboard" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: 'rgba(42,123,181,0.45)', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: 'rgba(30,90,143,0.5)', stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id="waveGradient3Leaderboard" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: 'rgba(15,40,70,0.55)', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: 'rgba(30,90,143,0.45)', stopOpacity: 1 }} />
              </linearGradient>
            </defs>
            {/* Top section waves */}
            <path d="M0,20 Q100,50 200,40 T400,60 Q500,45 600,55 T800,50 Q900,40 1000,50 T1200,45 L1200,0 L0,0 Z" fill="url(#waveGradient1Leaderboard)" opacity="0.5" />
            <path d="M0,45 Q120,80 240,65 T480,95 Q600,75 720,90 T960,80 Q1080,70 1200,80 T1440,75 L1440,0 L0,0 Z" fill="url(#waveGradient2Leaderboard)" opacity="0.45" />
            <path d="M0,75 Q110,115 220,100 T440,130 Q560,110 680,125 T920,115 Q1040,105 1160,115 T1400,110 L1400,0 L0,0 Z" fill="url(#waveGradient3Leaderboard)" opacity="0.42" />
            
            {/* Middle section waves */}
            <path d="M0,200 Q130,245 260,225 T520,260 Q660,240 800,255 T1040,245 Q1180,235 1320,245 T1600,240 L1600,150 L0,150 Z" fill="rgba(26,77,122,0.4)" opacity="0.5" />
            <path d="M0,280 Q115,330 230,305 T460,345 Q590,325 720,340 T980,330 Q1110,320 1240,330 T1500,325 L1500,220 L0,220 Z" fill="rgba(30,90,143,0.45)" opacity="0.48" />
            <path d="M0,350 Q125,405 250,380 T500,420 Q640,400 780,415 T1040,405 Q1180,395 1320,405 T1600,400 L1600,290 L0,290 Z" fill="rgba(15,40,70,0.48)" opacity="0.5" />
            <path d="M0,420 Q140,480 280,450 T560,495 Q710,475 860,490 T1140,480 Q1290,470 1440,480 T1720,475 L1720,360 L0,360 Z" fill="rgba(26,77,122,0.42)" opacity="0.48" />
            
            {/* Bottom section waves */}
            <path d="M0,520 Q135,585 270,550 T540,600 Q695,580 850,595 T1130,585 Q1285,575 1440,585 T1700,580 L1700,460 L0,460 Z" fill="rgba(42,123,181,0.45)" opacity="0.52" />
            <path d="M0,600 Q150,675 300,635 T600,690 Q770,670 940,685 T1250,675 Q1420,665 1590,675 T1880,670 L1880,540 L0,540 Z" fill="rgba(30,90,143,0.48)" opacity="0.5" />
            <path d="M0,680 Q145,760 290,715 T580,775 Q755,755 930,770 T1230,760 Q1405,750 1580,760 T1860,755 L1860,620 L0,620 Z" fill="rgba(15,40,70,0.5)" opacity="0.52" />
            <path d="M0,750 Q160,835 320,785 T640,850 Q820,830 1000,845 T1320,835 Q1500,825 1680,835 T1960,830 L1960,690 L0,690 Z" fill="rgba(26,77,122,0.45)" opacity="0.5" />
            <path d="M0,800 Q155,890 310,835 T620,905 Q805,885 990,900 T1310,890 Q1495,880 1680,890 T1960,885 L1960,750 L0,750 Z" fill="rgba(42,123,181,0.48)" opacity="0.52" />
          </svg>
          {/* Additional chaotic radial overlays */}
          <div className="absolute inset-0">
            <div className="absolute inset-0 opacity-45" style={{
              background: 'radial-gradient(ellipse 900px 500px at 15% 25%, rgba(26,77,122,0.5) 0%, transparent 55%)'
            }}></div>
            <div className="absolute inset-0 opacity-40" style={{
              background: 'radial-gradient(ellipse 800px 600px at 85% 55%, rgba(42,123,181,0.4) 0%, transparent 55%)'
            }}></div>
            <div className="absolute inset-0 opacity-50" style={{
              background: 'radial-gradient(ellipse 1000px 700px at 45% 80%, rgba(30,90,143,0.45) 0%, transparent 65%)'
            }}></div>
            <div className="absolute inset-0 opacity-35" style={{
              background: 'radial-gradient(ellipse 700px 500px at 70% 40%, rgba(15,40,70,0.35) 0%, transparent 55%)'
            }}></div>
          </div>
          {/* Stars */}
          <div className="absolute inset-0">
            {[...Array(1500)].map((_, i) => (
              <div
                key={`star-${i}`}
                className="absolute rounded-full bg-white"
                style={{
                  width: Math.random() > 0.8 ? '1.5px' : '0.8px',
                  height: Math.random() > 0.8 ? '1.5px' : '0.8px',
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  opacity: Math.random() * 0.6 + 0.2,
                  animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite ${Math.random() * 2}s`
                }}
              />
            ))}
            {[...Array(200)].map((_, i) => (
              <div
                key={`star-medium-${i}`}
                className="absolute rounded-full bg-white"
                style={{
                  width: Math.random() * 0.5 + 1.5 + 'px',
                  height: Math.random() * 0.5 + 1.5 + 'px',
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  opacity: Math.random() * 0.5 + 0.3,
                  animation: `twinkle ${Math.random() * 4 + 3}s ease-in-out infinite ${Math.random() * 3}s`
                }}
              />
            ))}
            {[...Array(120)].map((_, i) => (
              <div
                key={`star-yellow-${i}`}
                className="absolute rounded-full bg-yellow-200"
                style={{
                  width: Math.random() * 0.5 + 2 + 'px',
                  height: Math.random() * 0.5 + 2 + 'px',
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  opacity: Math.random() * 0.4 + 0.4,
                  animation: `twinkle ${Math.random() * 5 + 4}s ease-in-out infinite ${Math.random() * 4}s`
                }}
              />
            ))}
          </div>
        </div>
        
        <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* Main container */}
          <div className="relative bg-white/5 backdrop-blur-md border-2 border-white/20 rounded-3xl p-8 shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-4xl font-black text-white">
                🏆 Leaderboard
              </h2>
              <button
                onClick={() => setShowLeaderboard(false)}
                className="text-gray-400 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full hover:bg-gray-800/50 transition-all hover:scale-110 active:scale-95"
              >
                ×
              </button>
            </div>

            {/* Top 3 Players - Podium Style */}
            {topThree.length > 0 && (
              <div className="mb-6 flex items-end justify-center gap-4">
                {/* 2nd Place */}
                {topThree[1] && (
                  <div className="flex flex-col items-center animate-[slideIn_0.5s_ease-out_0.1s_forwards] opacity-0">
                    <div className="relative mb-2">
                      <img
                        src={topThree[1].pfpUrl}
                        alt={topThree[1].username}
                        className="w-14 h-14 rounded-full border-3 border-gray-400 shadow-lg"
                      />
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg">
                        2
                      </div>
                    </div>
                    <div className="relative bg-white/5 backdrop-blur-sm border-2 border-white/20 rounded-xl p-3 w-24 text-center overflow-hidden">
                      {/* Decorative emojis */}
                      <div className="absolute text-xs opacity-20">
                        <span className="absolute" style={{ top: '2px', left: '3px' }}>⭐</span>
                        <span className="absolute" style={{ top: '35px', right: '3px' }}>✨</span>
                        <span className="absolute" style={{ bottom: '2px', left: '5px' }}>🌟</span>
                      </div>
                      <div className="relative z-10">
                        <div className="font-bold text-white text-xs truncate">{topThree[1].username}</div>
                        <div className="text-lg font-black text-gray-300 mt-1">{formatScore(topThree[1].points)}</div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          <span className="text-green-400">{topThree[1].wins}W</span> - <span className="text-red-400">{topThree[1].losses}L</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 1st Place - Elevated */}
                {topThree[0] && (
                  <div className="flex flex-col items-center -mt-4 animate-[slideIn_0.5s_ease-out_forwards] opacity-0">
                    <div className="relative mb-2">
                      <img
                        src={topThree[0].pfpUrl}
                        alt={topThree[0].username}
                        className="w-16 h-16 rounded-full border-3 border-yellow-500 shadow-2xl"
                      />
                      <div className="absolute -top-2 -right-2 w-7 h-7 bg-gradient-to-r from-yellow-400 to-yellow-500 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg">
                        👑
                      </div>
                    </div>
                    <div className="relative bg-white/10 backdrop-blur-sm border-2 border-yellow-500/40 rounded-xl p-3 w-28 text-center shadow-xl overflow-hidden">
                      {/* Decorative emojis */}
                      <div className="absolute text-xs opacity-25">
                        <span className="absolute" style={{ top: '3px', left: '4px' }}>🏆</span>
                        <span className="absolute" style={{ top: '3px', right: '4px' }}>👑</span>
                        <span className="absolute" style={{ top: '45px', left: '3px' }}>⭐</span>
                        <span className="absolute" style={{ top: '45px', right: '3px' }}>✨</span>
                        <span className="absolute" style={{ bottom: '3px', left: '50%', transform: 'translateX(-50%)' }}>🌟</span>
                      </div>
                      <div className="relative z-10">
                        <div className="font-black text-white text-xs truncate">{topThree[0].username}</div>
                        <div className="text-xl font-black text-yellow-400 mt-1">{formatScore(topThree[0].points)}</div>
                        <div className="text-[10px] text-gray-300 mt-1">
                          <span className="text-green-400">{topThree[0].wins}W</span> - <span className="text-red-400">{topThree[0].losses}L</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3rd Place */}
                {topThree[2] && (
                  <div className="flex flex-col items-center animate-[slideIn_0.5s_ease-out_0.2s_forwards] opacity-0">
                    <div className="relative mb-2">
                      <img
                        src={topThree[2].pfpUrl}
                        alt={topThree[2].username}
                        className="w-14 h-14 rounded-full border-3 border-orange-600 shadow-lg"
                      />
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-orange-600 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg">
                        3
                      </div>
                    </div>
                    <div className="relative bg-white/5 backdrop-blur-sm border-2 border-white/20 rounded-xl p-3 w-24 text-center overflow-hidden">
                      {/* Decorative emojis */}
                      <div className="absolute text-xs opacity-20">
                        <span className="absolute" style={{ top: '2px', right: '3px' }}>⭐</span>
                        <span className="absolute" style={{ top: '35px', left: '3px' }}>✨</span>
                        <span className="absolute" style={{ bottom: '2px', right: '5px' }}>🌟</span>
                      </div>
                      <div className="relative z-10">
                        <div className="font-bold text-white text-xs truncate">{topThree[2].username}</div>
                        <div className="text-lg font-black text-orange-400 mt-1">{formatScore(topThree[2].points)}</div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          <span className="text-green-400">{topThree[2].wins}W</span> - <span className="text-red-400">{topThree[2].losses}L</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Rest of the players - List View */}
            {restOfList.length > 0 && (
              <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 pr-2 leaderboard-scroll min-h-0">
                {restOfList.map((entry, index) => {
                  const actualRank = index + 4; // Starting from 4th place
                  const isCurrentUser = entry.fid === farcasterUser?.fid.toString();
                  const emojis = ['⭐', '✨', '🌟', '💫', '🎯', '🎮', '🔥', '💎'];
                  const randomEmoji1 = emojis[Math.floor(Math.random() * emojis.length)];
                  const randomEmoji2 = emojis[Math.floor(Math.random() * emojis.length)];
                  
                  return (
                    <div
                      key={entry.fid}
                      style={{ animationDelay: `${(index + 3) * 0.05}s` }}
                      className={`relative flex items-center gap-4 p-3 rounded-2xl transition-all animate-[slideIn_0.5s_ease-out_forwards] opacity-0 overflow-hidden ${
                        isCurrentUser
                          ? 'bg-white/10 backdrop-blur-sm border-2 border-white/30'
                          : 'bg-white/5 backdrop-blur-sm border-2 border-white/20 hover:border-white/30'
                      }`}
                    >
                      {/* Decorative emojis */}
                      <div className="absolute text-xs opacity-15">
                        <span className="absolute" style={{ top: '8px', left: '8px' }}>{randomEmoji1}</span>
                        <span className="absolute" style={{ top: '8px', right: '8px' }}>{randomEmoji2}</span>
                      </div>
                      
                      {/* Rank Badge */}
                      <div className="relative z-10 w-10 h-10 bg-white/10 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center">
                        <span className="text-white font-bold text-sm">#{actualRank}</span>
                      </div>
                      
                      {/* Avatar */}
                      <img
                        src={entry.pfpUrl}
                        alt={entry.username}
                        className="relative z-10 w-12 h-12 rounded-full border-2 border-white/40"
                      />
                      
                      {/* User info */}
                      <div className="relative z-10 flex-1">
                        <div className="font-bold text-white text-sm">{entry.username}</div>
                        <div className="text-xs text-gray-300">
                          <span className="text-green-400">{entry.wins}W</span> - <span className="text-red-400">{entry.losses}L</span>
                        </div>
                      </div>
                      
                      {/* Points */}
                      <div className="relative z-10 text-white font-bold text-lg">
                        {formatScore(entry.points)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Submit Question Handler
  const handleSubmitQuestion = async () => {
    // Prevent double submission
    if (isSubmittingQuestion) {
      console.log('[SubmitQuestion] Already submitting, ignoring duplicate click');
      return;
    }

    // Clear previous errors
    setFieldErrors({
      subject: '',
      question: '',
      answers: ['', '', '', '']
    });

    let hasErrors = false;
    const newErrors = {
      subject: '',
      question: '',
      answers: ['', '', '', '']
    };

    // Validation
    if (!newQuestion.subject) {
      newErrors.subject = 'Please select a subject';
      hasErrors = true;
    }
    
    if (!newQuestion.question.trim()) {
      newErrors.question = 'Please enter a question';
      hasErrors = true;
    } else if (newQuestion.question.trim().length > 150) {
      newErrors.question = `Question is too long! Maximum 150 characters (current: ${newQuestion.question.trim().length})`;
      hasErrors = true;
    }
    
    // Check all answers are filled and lengths
    newQuestion.answers.forEach((answer, index) => {
      if (!answer.trim()) {
        newErrors.answers[index] = 'Required';
        hasErrors = true;
      } else if (answer.trim().length > 60) {
        newErrors.answers[index] = `Too long (${answer.trim().length}/60)`;
        hasErrors = true;
      }
    });

    if (!farcasterUser) {
      alert('❌ User information not available');
      return;
    }

    if (hasErrors) {
      setFieldErrors(newErrors);
      return;
    }

    // Set submitting state
    setIsSubmittingQuestion(true);
    console.log('[SubmitQuestion] Starting submission...');

    try {
      const response = await fetch('/api/submit-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newQuestion,
          submittedBy: {
            fid: farcasterUser.fid.toString(),
            username: farcasterUser.username,
            pfpUrl: farcasterUser.pfpUrl,
          },
        }),
      });

      const data = await response.json();
      
      console.log('[SubmitQuestion] Response:', data);

      if (data.success) {
        // Reset form
        setNewQuestion({
          subject: '',
          difficulty: 'moderate',
          question: '',
          answers: ['', '', '', ''],
          correctAnswer: 0,
        });
        setFieldErrors({
          subject: '',
          question: '',
          answers: ['', '', '', '']
        });
        
        // Close modal and show success message
        setShowAddQuestion(false);
        setShowQuestionSuccess(true);
        
        // After 5 seconds, hide success message
        setTimeout(() => {
          setShowQuestionSuccess(false);
        }, 5000);
      } else {
        alert('❌ Error: ' + data.error);
      }
    } catch (error) {
      console.error('[SubmitQuestion] Error:', error);
      alert('❌ Failed to submit question. Please try again.');
    } finally {
      // Always reset submitting state
      setIsSubmittingQuestion(false);
      console.log('[SubmitQuestion] Submission complete');
    }
  };

  // Render Add Question Modal
  const renderAddQuestionModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="backdrop-blur-sm bg-white/10 border border-white/30 rounded-[24px] p-4 shadow-xl max-w-lg w-full animate-scale-in max-h-[95vh] overflow-hidden flex flex-col relative">
        {/* Internal stars */}
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white animate-pulse pointer-events-none"
            style={{
              width: `${Math.random() * 0.5 + 1}px`,
              height: `${Math.random() * 0.5 + 1}px`,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.3 + 0.2,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${1 + Math.random() * 2}s`
            }}
          />
        ))}
        
        {/* Header - Fixed */}
        <div className="flex-shrink-0 mb-3 relative z-10">
          <div className="flex items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-full backdrop-blur-sm bg-white/20 border-2 border-white/40 flex items-center justify-center">
              <span className="text-xl">📝</span>
            </div>
            <h2 className="text-xl font-black text-white">
              Add Question
            </h2>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1 space-y-2.5 relative z-10"  style={{scrollbarWidth: 'thin'}}>

          {/* Subject Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white flex items-center gap-1.5">
              <span className="text-sm">📚</span>
              Subject
            </label>
            {fieldErrors.subject && (
              <p className="text-red-400 text-xs mb-1 flex items-center gap-1">
                <span>⚠️</span>
                <span>{fieldErrors.subject}</span>
              </p>
            )}
            <select
              value={newQuestion.subject}
              onChange={(e) => setNewQuestion({ ...newQuestion, subject: e.target.value })}
              className="w-full px-3 py-2 backdrop-blur-sm bg-white/10 border-2 border-white/30 rounded-xl text-sm text-white focus:border-white/50 focus:outline-none transition-all font-medium"
              required
            >
              <option value="">Select a subject...</option>
              <option value="Movies">🎬 Movies</option>
              <option value="TV Shows">📺 TV Shows</option>
              <option value="Literature">📚 Literature</option>
              <option value="Music">🎵 Music</option>
              <option value="History">🏛️ History</option>
              <option value="English">� English</option>
              <option value="Technology">💻 Technology</option>
              <option value="Science">🔬 Science</option>
              <option value="Geography">🌍 Geography</option>
              <option value="Culture">🎭 Culture</option>
              <option value="Games">🎮 Games</option>
              <option value="General Information">📖 General Information</option>
              <option value="Sports">⚽ Sports</option>
              <option value="Nature">🌿 Nature</option>
              <option value="Math">🔢 Math</option>
              <option value="Religion">☪️ Religion</option>
              <option value="Food & Drinks">🍕 Food & Drinks</option>
              <option value="Crypto">₿ Crypto</option>
            </select>
          </div>

          {/* Difficulty Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white flex items-center gap-1.5">
              <span className="text-sm">⚡</span>
              Difficulty
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setNewQuestion({ ...newQuestion, difficulty: 'easy' })}
                className={`py-2.5 px-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                  newQuestion.difficulty === 'easy'
                    ? 'bg-gradient-to-br from-green-500 to-green-600 text-white border-2 border-green-400 shadow-[0_0_20px_rgba(34,197,94,0.4)]'
                    : 'backdrop-blur-sm bg-white/10 text-white border-2 border-white/20 hover:border-green-500/50 hover:bg-white/15'
                }`}
              >
                😊 Easy
              </button>
              <button
                type="button"
                onClick={() => setNewQuestion({ ...newQuestion, difficulty: 'moderate' })}
                className={`py-2.5 px-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                  newQuestion.difficulty === 'moderate'
                    ? 'bg-gradient-to-br from-yellow-500 to-orange-500 text-white border-2 border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.4)]'
                    : 'backdrop-blur-sm bg-white/10 text-white border-2 border-white/20 hover:border-yellow-500/50 hover:bg-white/15'
                }`}
              >
                🤔 Moderate
              </button>
              <button
                type="button"
                onClick={() => setNewQuestion({ ...newQuestion, difficulty: 'hard' })}
                className={`py-2.5 px-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                  newQuestion.difficulty === 'hard'
                    ? 'bg-gradient-to-br from-red-500 to-red-600 text-white border-2 border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.4)]'
                    : 'backdrop-blur-sm bg-white/10 text-white border-2 border-white/20 hover:border-red-500/50 hover:bg-white/15'
                }`}
              >
                🔥 Hard
              </button>
            </div>
          </div>

          {/* Question Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5">
                <span className="text-sm">❓</span>
                Question
              </span>
              <span className={`text-xs ${newQuestion.question.length > 150 ? 'text-red-400' : 'text-white/60'}`}>
                {newQuestion.question.length}/150
              </span>
            </label>
            {fieldErrors.question && (
              <p className="text-red-400 text-xs mb-1 flex items-center gap-1">
                <span>⚠️</span>
                <span>{fieldErrors.question}</span>
              </p>
            )}
            <textarea
              value={newQuestion.question}
              onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
              placeholder="Enter your question..."
              rows={2}
              maxLength={150}
              className="w-full px-3 py-2 backdrop-blur-sm bg-white/10 border-2 border-white/30 rounded-xl text-sm text-white focus:border-white/50 focus:outline-none transition-all font-medium resize-none placeholder:text-white/40"
              required
            />
          </div>

          {/* Answers Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white flex items-center gap-1.5 mb-1">
              <span className="text-sm">✍️</span>
              Answers
              <span className="text-xs text-white/60 ml-auto">(max 60 chars each)</span>
            </label>
            <div className="space-y-1.5">
              {/* Correct Answer - Green */}
              <div>
                {fieldErrors.answers[newQuestion.correctAnswer] && (
                  <p className="text-red-400 text-xs mb-1 flex items-center gap-1">
                    <span>⚠️</span>
                    <span>{fieldErrors.answers[newQuestion.correctAnswer]}</span>
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
                    <span className="text-green-400 text-xs font-bold">✓</span>
                  </div>
                  <input
                    type="text"
                    value={newQuestion.answers[newQuestion.correctAnswer]}
                    onChange={(e) => {
                      const newAnswers = [...newQuestion.answers];
                      newAnswers[newQuestion.correctAnswer] = e.target.value;
                      setNewQuestion({ ...newQuestion, answers: newAnswers });
                    }}
                    placeholder="Correct answer"
                    maxLength={60}
                    className="flex-1 px-3 py-2 rounded-xl backdrop-blur-sm bg-white/10 border-2 border-green-500/70 text-sm text-white focus:border-green-400 focus:outline-none transition-all font-medium placeholder:text-green-400/40"
                    required
                  />
                </div>
              </div>

              {/* Wrong Answers - Red */}
              {newQuestion.answers.map((answer, index) => {
                if (index === newQuestion.correctAnswer) return null;
                return (
                  <div key={index}>
                    {fieldErrors.answers[index] && (
                      <p className="text-red-400 text-xs mb-1 flex items-center gap-1">
                        <span>⚠️</span>
                        <span>{fieldErrors.answers[index]}</span>
                      </p>
                    )}
                    <div className="flex items-center gap-1.5">
                      <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
                        <span className="text-red-400 text-xs font-bold">✕</span>
                      </div>
                      <input
                        type="text"
                        value={answer}
                        onChange={(e) => {
                          const newAnswers = [...newQuestion.answers];
                          newAnswers[index] = e.target.value;
                          setNewQuestion({ ...newQuestion, answers: newAnswers });
                        }}
                        placeholder="Wrong answer"
                        maxLength={60}
                        className="flex-1 px-3 py-2 rounded-xl backdrop-blur-sm bg-white/10 border-2 border-red-500/70 text-sm text-white focus:border-red-400 focus:outline-none transition-all font-medium placeholder:text-red-400/40"
                        required
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer - Fixed */}
        <div className="flex-shrink-0 grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-white/20 relative z-10">
          <button
            onClick={() => {
              setShowAddQuestion(false);
              setFieldErrors({
                subject: '',
                question: '',
                answers: ['', '', '', '']
              });
              setIsSubmittingQuestion(false);
            }}
            disabled={isSubmittingQuestion}
            className="backdrop-blur-sm bg-white/10 hover:bg-white/15 border-2 border-white/30 text-white py-2.5 px-4 rounded-xl text-sm font-bold shadow-lg transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmitQuestion}
            disabled={isSubmittingQuestion}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white py-2.5 px-4 rounded-xl text-sm font-bold shadow-lg transition-all duration-300 hover:scale-105 border-2 border-emerald-400/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {isSubmittingQuestion ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Submitting...
              </span>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Render Leave Confirmation Modal
  const renderLeaveConfirmation = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="backdrop-blur-2xl bg-gradient-to-br from-gray-900/95 via-purple-900/30 to-pink-900/30 border-2 border-gray-700/50 rounded-[32px] p-8 shadow-2xl max-w-md w-full animate-scale-in">
        {/* Warning Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-500/20 to-pink-500/20 border-2 border-red-500/50 flex items-center justify-center shadow-lg">
            <span className="text-5xl">⚠️</span>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-3xl font-black text-center mb-4 text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-pink-400 to-red-400 drop-shadow-lg">
          Leave Game?
        </h2>

        {/* Message */}
        <p className="text-gray-300 text-center mb-8 text-lg">
          Are you sure you want to leave? Your opponent will win by default.
        </p>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-4">
          {/* Cancel Button */}
          <button
            onClick={() => setShowLeaveConfirm(false)}
            className="backdrop-blur-xl bg-gray-800/80 hover:bg-gray-700/80 border-2 border-gray-600/50 text-white py-4 px-6 rounded-[20px] text-lg font-bold shadow-lg transition-all duration-300 hover:scale-105 hover:border-gray-500"
          >
            Cancel
          </button>

          {/* Confirm Leave Button */}
          <button
            onClick={() => {
              setShowLeaveConfirm(false);
              leaveGame();
            }}
            className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white py-4 px-6 rounded-[20px] text-lg font-bold shadow-lg transition-all duration-300 hover:scale-105 border-2 border-red-400/30"
          >
            Yes, Leave
          </button>
        </div>
      </div>
    </div>
  );

  // Main render - show loading until ready
  if (!isReady) {
    return renderLoading();
  }

  // Show add question modal
  if (showAddQuestion) {
    return renderAddQuestionModal();
  }

  // Show leave confirmation modal
  if (showLeaveConfirm) {
    return renderLeaveConfirmation();
  }

  // Show subject result animation if flag is set (overrides other states)
  if (showSubjectResult && gameRoom?.currentSubject) {
    return renderSubjectResult();
  }

  // Main game render
  let mainContent;
  switch (gameState) {
    case 'idle':
      mainContent = renderIdle();
      break;
    case 'searching':
      mainContent = renderSearching();
      break;
    case 'matched':
      mainContent = renderMatched();
      break;
    case 'subject-selection':
      mainContent = renderSubjectSelection();
      break;
    case 'waiting-subject':
      mainContent = renderWaitingSubject();
      break;
    case 'playing':
      mainContent = renderPlaying();
      break;
    case 'round-result':
      mainContent = renderRoundResult();
      break;
    case 'game-over':
      mainContent = renderGameOver();
      break;
    default:
      mainContent = renderIdle();
  }

  return (
    <>
      {mainContent}
      {showLeaderboard && renderLeaderboard()}
      
      {/* Opponent Disconnected Overlay */}
      {opponentLeft && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 border-2 rounded-[48px] shadow-2xl p-12 max-w-md text-center"
            style={{ borderColor: '#6a3cff', boxShadow: '0 0 60px rgba(106, 60, 255, 0.4)' }}>
            <div className="text-6xl mb-6">😔</div>
            <h2 className="text-4xl font-black text-white mb-4">
              Player Left
            </h2>
            <p className="text-2xl font-bold text-white mb-8">
              {disconnectMessage}
            </p>
            <p className="text-xl text-white mb-6">
              Returning home in <span className="text-4xl font-black animate-pulse" style={{ color: '#6a3cff' }}>{autoReturnCountdown}</span>...
            </p>
            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div 
                className="h-full transition-all duration-1000 ease-linear"
                style={{ 
                  width: `${(autoReturnCountdown / 6) * 100}%`, 
                  background: 'linear-gradient(90deg, #6a3cff, #7a4cff)'
                }}
              />
            </div>
          </div>
        </div>
      )}
      
      {/* Question Submission Success Message */}
      {showQuestionSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-gradient-to-br from-emerald-500 via-teal-500 to-emerald-600 border-4 border-emerald-300/50 rounded-[32px] p-8 shadow-[0_0_60px_rgba(16,185,129,0.6)] max-w-md w-full animate-scale-in">
            {/* Success Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-24 h-24 rounded-full bg-white/20 border-4 border-white/50 flex items-center justify-center shadow-2xl animate-bounce">
                <span className="text-6xl">✅</span>
              </div>
            </div>
            
            {/* Success Message */}
            <h2 className="text-3xl font-black text-white text-center mb-4 drop-shadow-2xl">
              Thank You!
            </h2>
            <p className="text-white text-lg text-center font-semibold drop-shadow-lg leading-relaxed">
              Your question has been submitted successfully!
            </p>
            <p className="text-emerald-100 text-base text-center font-bold mt-4 drop-shadow">
              🎁 1,000 points will be added once confirmed
            </p>
          </div>
        </div>
      )}
    </>
  );
}

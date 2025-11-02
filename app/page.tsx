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
  const [timeRemaining, setTimeRemaining] = useState<number>(18); // seconds
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [roundOverTimeRemaining, setRoundOverTimeRemaining] = useState<number>(30); // 30 seconds for auto-start
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null); // Track selected subject for animation
  const [showSubjectResult, setShowSubjectResult] = useState(false); // Show which subject was selected with animation
  const [hasShownSubjectResult, setHasShownSubjectResult] = useState(false); // Track if we've shown the animation for this round
  const [answerFeedback, setAnswerFeedback] = useState<'correct' | 'incorrect' | null>(null); // Track answer feedback
  const [isShowingFeedback, setIsShowingFeedback] = useState(false); // Flag to prevent question change during feedback
  const [isRejoinAttempt, setIsRejoinAttempt] = useState(false); // Track if we're attempting to rejoin
  const [showLeaderboard, setShowLeaderboard] = useState(false); // Show leaderboard modal
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [playerStats, setPlayerStats] = useState<{ score: number; rank: number; wins: number; losses: number } | null>(null);
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
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

        if (data.gameState) {
          const room: GameRoom = data.gameState;
          setGameRoom(room);
          
          // Update MY timer (per-player timer)
          // CRITICAL: Use playerIdRef.current as fallback to ensure timer works even if state is empty
          const currentPlayerId = playerId || playerIdRef.current;
          const myTimerStart = room.playerTimers?.[currentPlayerId];
          console.log('[Timer] State:', room.state, 'myTimerStart:', myTimerStart, 'playerId:', currentPlayerId, 'finished:', room.playersFinished?.includes(currentPlayerId));
          
          // PRIORITY: Check for question timer FIRST (even if state is still transitioning)
          console.log('[Timer] CHECKING - myTimerStart:', myTimerStart, 'playerTimers:', room.playerTimers, 'currentPlayerId:', currentPlayerId);
          if (myTimerStart && !room.playersFinished?.includes(currentPlayerId)) {
            const elapsed = Date.now() - myTimerStart;
            const remaining = Math.max(0, 18000 - elapsed); // 18 seconds per question
            const remainingSeconds = Math.ceil(remaining / 1000);
            console.log('[Timer] ⏱️ Question timer ACTIVE - elapsed:', elapsed, 'remaining:', remaining, 'seconds:', remainingSeconds);
            setTimeRemaining(remainingSeconds);
            // Keep timer active as long as we have time remaining
            setTimerActive(remainingSeconds > 0);
          } else if (room.state === 'subject-selection' && room.timerStartedAt && room.timerDuration) {
            // Subject selection timer - ONLY show during subject selection
            const elapsed = Date.now() - room.timerStartedAt;
            const remaining = Math.max(0, room.timerDuration - elapsed);
            console.log('[Timer] ⏱️ Subject selection timer - remaining:', remaining);
            setTimeRemaining(Math.ceil(remaining / 1000));
            setTimerActive(remaining > 0);
          } else {
            console.log('[Timer] No active timer');
            setTimeRemaining(0);
            setTimerActive(false);
          }

          // Update round-over timer
          if (room.state === 'round-over' && room.roundOverTimerStartedAt) {
            const elapsed = Date.now() - room.roundOverTimerStartedAt;
            const remaining = Math.max(0, 30000 - elapsed); // 30 seconds for auto-start
            setRoundOverTimeRemaining(Math.ceil(remaining / 1000));
            console.log('[Polling] Round-over timer - remaining:', Math.ceil(remaining / 1000), 'seconds');
          } else if (room.state !== 'round-over') {
            // Reset timer when not in round-over state
            setRoundOverTimeRemaining(30);
          } else if (room.state === 'round-over' && !room.roundOverTimerStartedAt) {
            console.log('[Polling] Round-over state but no timer! roundOverTimerStartedAt:', room.roundOverTimerStartedAt);
          }

          // Update opponent - ALWAYS update to ensure correct opponent is shown
          if (room.players.length === 2) {
            // CRITICAL: Use playerIdRef.current as fallback to ensure correct opponent
            const currentPlayerId = playerId || playerIdRef.current;
            console.log('[Polling] Finding opponent');
            console.log('[Polling] - playerId state:', playerId);
            console.log('[Polling] - playerIdRef.current:', playerIdRef.current);
            console.log('[Polling] - currentPlayerId:', currentPlayerId);
            console.log('[Polling] - room.players:', room.players.map(p => ({ id: p.id, username: p.username })));
            
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
                setCurrentQuestionId(myCurrentQ.id);
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
  useEffect(() => {
    const saveScore = async () => {
      if (gameState === 'game-over' && farcasterUser && playerId && gameRoom) {
        try {
          const myScore = gameRoom.scores[playerId] || 0;
          const opponentScore = opponent ? (gameRoom.scores[opponent.id] || 0) : 0;
          const isWinner = myScore > opponentScore;
          const isDraw = myScore === opponentScore;

          console.log('[GameOver] Saving score to MongoDB:', {
            fid: farcasterUser.fid,
            username: farcasterUser.username,
            score: myScore,
            isWin: isWinner && !isDraw
          });
          
          const response = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fid: farcasterUser.fid.toString(),
              username: farcasterUser.username,
              pfpUrl: farcasterUser.pfpUrl,
              score: myScore,
              isWin: isWinner && !isDraw
            })
          });

          const data = await response.json();
          console.log('[GameOver] Score saved:', data);

          // Refresh player stats to show updated rank
          if (data.success) {
            await fetchPlayerStats();
          }
        } catch (error) {
          console.error('[GameOver] Failed to save score:', error);
        }
      }
    };

    saveScore();
  }, [gameState, farcasterUser, playerId, gameRoom, opponent]);

  const fetchPlayerStats = async () => {
    if (!farcasterUser) return;
    
    try {
      const response = await fetch(`/api/leaderboard?fid=${farcasterUser.fid}&limit=1`);
      const data = await response.json();
      
      if (data.success && data.playerRank) {
        setPlayerStats({
          score: data.playerRank.player?.score || 0,
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
            score: data.playerRank.player?.score || 0,
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

  // Cleanup polling and feedback timeout on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  // Select subject
  const selectSubject = async (subject: string) => {
    const activePlayerId = playerId || playerIdRef.current;
    
    console.log('[SelectSubject] Button clicked! Subject:', subject);
    console.log('[SelectSubject] - activePlayerId:', activePlayerId);
    console.log('[SelectSubject] - isMyTurnToPick:', isMyTurnToPick);
    console.log('[SelectSubject] - selectedSubject before:', selectedSubject);
    
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
  };

  // Submit answer
  const submitAnswer = async (answerIndex: number) => {
    console.log('[Submit] submitAnswer called with index:', answerIndex);
    console.log('[Submit] gameRoom:', gameRoom ? 'exists' : 'null');
    console.log('[Submit] selectedAnswer:', selectedAnswer);
    console.log('[Submit] iFinished:', iFinished);
    console.log('[Submit] myProgress:', myProgress);
    
    if (!gameRoom) {
      console.error('[Submit] No game room - cannot submit');
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
        console.error('[Submit] Failed:', data.message || data.error);
        alert(data.message || data.error || 'Failed to submit answer');
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
      alert('Error submitting answer: ' + error);
      setSelectedAnswer(null);
      setAnswerFeedback(null);
      setIsShowingFeedback(false);
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
    }
  };

  // Start next round
  const startNextRound = async () => {
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
  };

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
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
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
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[40px] p-10 shadow-2xl max-w-md w-full">
        {/* Profile Section */}
        <div className="text-center mb-8">
          {farcasterUser?.pfpUrl ? (
            <img src={farcasterUser.pfpUrl} alt="Profile" className="w-32 h-32 rounded-full mx-auto mb-6 border-4 border-gray-700 shadow-2xl ring-4 ring-gray-700" />
          ) : (
            <div className="w-32 h-32 rounded-full mx-auto mb-6 border-4 border-gray-700 shadow-2xl ring-4 ring-gray-700 bg-gray-800 flex items-center justify-center">
              <span className="text-5xl"></span>
            </div>
          )}
          <h2 className="text-3xl font-bold text-white drop-shadow-2xl mb-2">{farcasterUser?.username}</h2>
          <p className="text-gray-400 text-sm font-medium drop-shadow-lg mb-4">@{farcasterUser?.username}</p>
          
          {/* Player Stats */}
          <div className="flex justify-center gap-6 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{formatScore(playerStats?.score || 0)}</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider">Score</div>
            </div>
            <div className="w-px bg-gray-700"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">#{playerStats?.rank || '-'}</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider">Rank</div>
            </div>
            <div className="w-px bg-gray-700"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{playerStats?.wins || 0}W</div>
              <div className="text-xs text-gray-400 uppercase tracking-wider">Wins</div>
            </div>
          </div>
        </div>
        
        {/* Find Match Button */}
        <button
          onClick={findMatch}
          className="w-full backdrop-blur-2xl bg-gray-800 text-white px-12 py-5 rounded-[28px] text-xl font-bold shadow-2xl hover:bg-gray-700 hover:shadow-2xl hover:scale-[1.05] transition-all active:scale-95 border-2 border-gray-700 mb-4"
        >
          Find Match
        </button>
        
        {/* Leaderboard Button */}
        <button
          onClick={() => setShowLeaderboard(true)}
          className="w-full bg-gray-800 text-gray-300 px-6 py-3 rounded-[24px] text-sm font-semibold shadow-xl hover:bg-gray-700 hover:text-white border-2 border-gray-700 transition-all"
        >
          🏆 View Leaderboard
        </button>
      </div>
    </div>
  );

  const renderSearching = () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[40px] p-12 shadow-2xl max-w-md w-full">
        <div className="w-24 h-24 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-8 drop-shadow-2xl"></div>
        <h2 className="text-3xl font-bold text-white mb-3 text-center drop-shadow-lg">Finding opponent...</h2>
        <p className="text-gray-400 text-center drop-shadow mb-6">Please wait</p>
        
        <button
          onClick={leaveGame}
          className="w-full bg-gray-800 text-white px-8 py-3 rounded-[24px] text-sm font-semibold shadow-xl hover:bg-gray-700 border-2 border-gray-700 transition-all"
        >
          Cancel Search
        </button>
      </div>
    </div>
  );

  const renderMatched = () => (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[40px] shadow-2xl p-10 max-w-md w-full">
        <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-8 text-center">
          Match Found! </h2>
        
        <div className="flex justify-around items-center mb-8">
          <div className="text-center">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-20 h-20 rounded-full border-4 border-gray-700 shadow-2xl ring-4 ring-gray-700 mb-2" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-gray-700 shadow-2xl bg-gray-800 flex items-center justify-center mb-2 ring-4 ring-gray-700">
                <span className="text-3xl"></span>
              </div>
            )}
            <p className="text-white font-semibold drop-shadow-lg">{farcasterUser?.username}</p>
          </div>
          
          <div className="text-5xl drop-shadow-2xl">VS</div>
          
          <div className="text-center">
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-20 h-20 rounded-full border-4 border-gray-700 shadow-2xl ring-4 ring-gray-700 mb-2" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-gray-700 shadow-2xl bg-gray-800 flex items-center justify-center mb-2 ring-4 ring-gray-700">
                <span className="text-3xl"></span>
              </div>
            )}
            <p className="text-white font-semibold drop-shadow-lg">{opponent?.username}</p>
          </div>
        </div>
        
        <p className="text-gray-300 text-lg text-center drop-shadow-lg">Starting game...</p>
      </div>
    </div>
  );

  const renderSubjectSelection = () => (
    <div className="min-h-screen flex flex-col p-4">
      {/* Leave Game Button */}
      <button
        onClick={leaveGame}
        className="fixed top-4 right-4 z-50 bg-gray-800 text-white px-3 py-2 rounded-[16px] text-xs font-semibold shadow-lg hover:bg-gray-700 border border-gray-700 transition-all"
      >
        Leave Game
      </button>
      
      {/* Header */}
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-4 mb-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                <span className="text-lg"></span>
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm drop-shadow-lg">{farcasterUser?.username}</p>
              <p className="text-gray-400 text-xs drop-shadow">Score: {myScore}</p>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-gray-400 text-xs drop-shadow">Round</p>
            <p className="text-white font-bold text-xl drop-shadow-lg">{gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-white font-semibold text-sm drop-shadow-lg">{opponent?.username}</p>
              <p className="text-gray-400 text-xs drop-shadow">Score: {opponentScore}</p>
            </div>
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                <span className="text-lg"></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subject Selection */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md w-full">
          {/* Timer */}
          {timerActive && (
            <div className="mb-6">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full border-4 backdrop-blur-2xl ${
                timeRemaining <= 5 ? 'border-gray-700 bg-gray-800 animate-pulse' : 'border-gray-700 bg-gray-800'
              } shadow-2xl drop-shadow-2xl`}>
                <span className={`text-3xl font-bold ${'text-white'} drop-shadow-lg`}>
                  {timeRemaining}
                </span>
              </div>
              <p className="text-gray-300 text-sm mt-2 drop-shadow">
                {isMyTurnToPick ? 'Pick a subject!' : 'Waiting...'}
              </p>
            </div>
          )}
          
          <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl">
            {isMyTurnToPick ? 'Choose a Subject ' : 'Opponent is choosing...'}
          </h2>
          
          {isMyTurnToPick ? (
            <div className="space-y-3">
              {subjects.map((subject) => {
                const isSelected = selectedSubject === subject;
                return (
                  <button
                    key={subject}
                    onClick={() => !selectedSubject && selectSubject(subject)}
                    disabled={!!selectedSubject}
                    className={`w-full py-4 rounded-[28px] font-bold text-lg shadow-2xl border-2 transition-all duration-500 ${
                      isSelected
                        ? 'bg-white text-black border-white scale-105 animate-pulse shadow-2xl'
                        : selectedSubject
                        ? 'backdrop-blur-2xl bg-gray-900 text-gray-600 border-gray-800 cursor-not-allowed'
                        : 'backdrop-blur-2xl bg-gray-800 text-white border-gray-700 hover:bg-gray-700 hover:shadow-2xl hover:scale-[1.02] active:scale-95 cursor-pointer'
                    }`}
                  >
                    {subject} {isSelected && ''}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto drop-shadow-2xl"></div>
          )}
        </div>
      </div>
    </div>
  );

  const renderWaitingSubject = () => (
    <div className="min-h-screen flex flex-col p-4">
      {/* Leave Game Button */}
      <button
        onClick={leaveGame}
        className="fixed top-4 right-4 z-50 bg-gray-800 text-white px-3 py-2 rounded-[16px] text-xs font-semibold shadow-lg hover:bg-gray-700 border border-gray-700 transition-all"
      >
        Leave Game
      </button>
      
      {/* Header - same as subject selection */}
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-4 mb-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                <span className="text-lg"></span>
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm drop-shadow-lg">{farcasterUser?.username}</p>
              <p className="text-gray-400 text-xs drop-shadow">Score: {myScore}</p>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-gray-400 text-xs drop-shadow">Round</p>
            <p className="text-white font-bold text-xl drop-shadow-lg">{gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-white font-semibold text-sm drop-shadow-lg">{opponent?.username}</p>
              <p className="text-gray-400 text-xs drop-shadow">Score: {opponentScore}</p>
            </div>
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                <span className="text-lg"></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Waiting message with timer */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center bg-gray-900 border-2 border-gray-800 rounded-[40px] shadow-2xl p-10">
          {/* Timer */}
          {timerActive && (
            <div className="mb-6">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full border-4 backdrop-blur-2xl ${
                timeRemaining <= 5 ? 'border-gray-700 bg-gray-800 animate-pulse' : 'border-gray-700 bg-gray-800'
              } shadow-2xl drop-shadow-2xl`}>
                <span className={`text-3xl font-bold ${'text-white'} drop-shadow-lg`}>
                  {timeRemaining}
                </span>
              </div>
            </div>
          )}
          <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-4 drop-shadow-2xl"></div>
          <h2 className="text-2xl font-bold text-white mb-2 drop-shadow-lg">{opponent?.username} is choosing...</h2>
          <p className="text-gray-300 drop-shadow">Get ready!</p>
        </div>
      </div>
    </div>
  );

  const renderSubjectResult = () => (
    <div className="min-h-screen flex flex-col p-4">
      {/* Header */}
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-4 mb-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                <span className="text-lg"></span>
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm drop-shadow-lg">{farcasterUser?.username}</p>
              <p className="text-gray-400 text-xs drop-shadow">Score: {myScore}</p>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-gray-400 text-xs drop-shadow">Round</p>
            <p className="text-white font-bold text-xl drop-shadow-lg">{gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-white font-semibold text-sm drop-shadow-lg">{opponent?.username}</p>
              <p className="text-gray-400 text-xs drop-shadow">Score: {opponentScore}</p>
            </div>
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                <span className="text-lg"></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subject Result Animation */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          {/* Timer - ALWAYS show during subject animation */}
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-4 border-yellow-500 bg-yellow-900 shadow-2xl drop-shadow-2xl">
              <span className="text-3xl font-bold text-white drop-shadow-lg">
                {timeRemaining}
              </span>
            </div>
            <div className="text-white text-sm mt-2">DEBUG: {timeRemaining}s</div>
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-6 drop-shadow-2xl animate-pulse">
            Subject Selected! </h2>
          <div className="bg-gray-900 border-4 border-white rounded-[40px] shadow-2xl p-8 animate-[bounce_1s_ease-in-out_infinite] scale-110">
            <div className="text-5xl font-black text-white drop-shadow-2xl mb-2">
              {gameRoom?.currentSubject}
            </div>
            <div className="text-gray-300 text-lg font-semibold drop-shadow-lg">
              Get Ready! </div>
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
            <div className="bg-gray-900 border-2 border-gray-800 rounded-[40px] shadow-2xl p-8">
              <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl">You Finished! </h2>
              <p className="text-gray-300 text-lg mb-6 drop-shadow-lg">
                Waiting for {opponent?.username} to finish...
              </p>
              <div className="mb-6">
                <p className="text-white text-5xl font-bold mb-2 drop-shadow-2xl">{myScore}</p>
                <p className="text-gray-400 drop-shadow">Your Score</p>
              </div>
              <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto drop-shadow-2xl"></div>
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
            <div className="bg-gray-900 border-2 border-gray-800 rounded-[40px] shadow-2xl p-8">
              <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl">Loading Question...</h2>
              <p className="text-gray-300 text-lg mb-6 drop-shadow-lg">
                Preparing your questions
              </p>
              <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto drop-shadow-2xl"></div>
            </div>
          </div>
        </div>
      );
    }

    console.log('[Render] Current question:', currentQuestion.id, 'options:', currentQuestion.options?.length);

    const hasAnswered = selectedAnswer !== null;
    const bothAnswered = showingResults && lastResult !== null;

    return (
      <div className="min-h-screen  flex flex-col p-4">
        {/* Leave Game Button - Fixed Position */}
        <button
          onClick={leaveGame}
          className="fixed top-4 right-4 z-50 bg-gray-800 text-white px-3 py-2 rounded-[16px] text-xs font-semibold shadow-lg hover:bg-gray-700 border border-gray-700 transition-all"
        >
          Leave Game
        </button>
        
        {/* Header */}
        <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-4 mb-4 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              {farcasterUser?.pfpUrl ? (
                <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                  <span className="text-lg"></span>
                </div>
              )}
              <div>
                <p className="text-white font-semibold text-sm">{farcasterUser?.username}</p>
                <p className="text-gray-400 text-xs">Score: {myScore}</p>
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-gray-400 text-xs">Round {gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
              <p className="text-white font-bold">Q {myProgress + 1}/5</p>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-white font-semibold text-sm">{opponent?.username}</p>
                <p className="text-gray-400 text-xs">Score: {opponentScore}</p>
              </div>
              {opponent?.pfpUrl ? (
                <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-gray-700 ring-2 ring-gray-700" />
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-gray-700 bg-gray-800 flex items-center justify-center ring-2 ring-gray-700">
                  <span className="text-lg"></span>
                </div>
              )}
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-gray-300 text-sm font-medium">{gameRoom?.currentSubject}</p>
          </div>
        </div>

        {/* Question */}
        <div className="flex-1 flex flex-col justify-center max-w-2xl w-full mx-auto">
          {/* Timer - ALWAYS show when we have timeRemaining */}
          {timeRemaining > 0 && (
            <div className="text-center mb-4">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full border-4 backdrop-blur-xl ${
                timeRemaining <= 5 ? 'border-red-500 bg-red-900 animate-pulse' : 'border-gray-700 bg-gray-800'
              } shadow-xl`}>
                <span className={`text-2xl font-bold text-white`}>
                  {timeRemaining}
                </span>
              </div>
            </div>
          )}
          
          <div className="bg-gray-800 border border-gray-700 rounded-[32px] p-6 mb-6 shadow-xl">
            <h3 className="text-white text-xl font-bold text-center mb-4">
              {currentQuestion.question}
            </h3>
          </div>

          {/* Answer Options */}
          <div className="space-y-3">
            {currentQuestion.options?.map((option, index) => {
              const isCorrect = index === currentQuestion.correctAnswer;
              const isMyAnswer = selectedAnswer === index;
              const showInstantFeedback = hasAnswered && answerFeedback && isMyAnswer;
              
              let buttonClass = "w-full py-4 px-6 rounded-[24px] font-semibold text-left transition-all duration-500 shadow-lg";
              
              if (bothAnswered && lastResult) {
                // Show final results (both players answered)
                if (isCorrect) {
                  buttonClass += " bg-green-600 text-white border-2 border-green-500 shadow-xl";
                } else if (isMyAnswer) {
                  buttonClass += " bg-red-600 text-white border-2 border-red-500 shadow-xl";
                } else {
                  buttonClass += " bg-gray-900 border-2 border-gray-800 text-gray-500";
                }
              } else if (showInstantFeedback) {
                // Show instant feedback after selection with dramatic animation
                if (answerFeedback === 'correct') {
                  buttonClass += " bg-green-600 text-white border-4 border-green-500 animate-[pulse_0.8s_ease-in-out_infinite] scale-110 shadow-2xl transform";
                } else {
                  buttonClass += " bg-red-600 text-white border-4 border-red-500 animate-[pulse_0.8s_ease-in-out_infinite] scale-110 shadow-2xl transform";
                }
              } else if (hasAnswered && isMyAnswer) {
                // Selected but waiting
                buttonClass += " backdrop-blur-xl bg-gray-700 text-white border-2 border-gray-800";
              } else if (hasAnswered) {
                // Not selected, disabled
                buttonClass += " bg-gray-900 border-2 border-gray-800 text-gray-600 cursor-not-allowed";
              } else {
                // Not answered yet, hoverable
                buttonClass += " bg-gray-800 border-2 border-gray-700 text-white hover:bg-gray-700 hover:scale-[1.02] active:scale-95 cursor-pointer";
              }

              return (
                <button
                  key={index}
                  onClick={() => !hasAnswered && submitAnswer(index)}
                  disabled={hasAnswered}
                  className={buttonClass}
                >
                  {option}
                  {showInstantFeedback && answerFeedback === 'correct' && " "}
                  {showInstantFeedback && answerFeedback === 'incorrect' && " ✗"}
                  {bothAnswered && isCorrect && " "}
                </button>
              );
            })}
          </div>

          {bothAnswered && lastResult && (
            <div className="mt-4 backdrop-blur-lg bg-gray-800 border border-gray-800 rounded-[28px] p-4 shadow-lg">
              <div className="flex justify-between">
                {lastResult.map((result: any) => (
                  <div key={result.playerId} className="text-center">
                    <p className="text-white font-semibold">{result.username}</p>
                    <p className="text-2xl">{result.correct ? '✓' : '✗'}</p>
                    <p className="text-gray-300 text-sm">Score: {result.score}</p>
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
        <div className="text-center bg-gray-900 border-2 border-gray-800 rounded-[40px] shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-6">
            Round {gameRoom?.currentRound} Complete! </h2>
          
          <div className="bg-gray-900 border-2 border-gray-800 rounded-[32px] p-6 mb-6 shadow-lg">
            <div className="flex justify-around">
              <div className="text-center relative">
                {farcasterUser?.pfpUrl ? (
                  <img src={farcasterUser.pfpUrl} alt="You" className="w-16 h-16 rounded-full border-4 border-gray-700 ring-4 ring-gray-700 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-gray-700 bg-gray-900 flex items-center justify-center mx-auto mb-2 ring-4 ring-gray-700 shadow-2xl">
                    <span className="text-2xl"></span>
                  </div>
                )}
                {iAmReady && (
                  <div className="absolute top-0 right-0 bg-yellow-500 rounded-full w-8 h-8 flex items-center justify-center border-2 border-yellow-400 shadow-lg">
                    <span className="text-black text-lg font-bold">✓</span>
                  </div>
                )}
                <p className="text-white font-bold drop-shadow-lg">{farcasterUser?.username}</p>
                <p className="text-white text-3xl font-bold drop-shadow-2xl">{myScore}</p>
              </div>
              
              <div className="text-center relative">
                {opponent?.pfpUrl ? (
                  <img src={opponent.pfpUrl} alt="Opponent" className="w-16 h-16 rounded-full border-4 border-gray-700 ring-4 ring-gray-700 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-gray-700 bg-gray-900 flex items-center justify-center mx-auto mb-2 ring-4 ring-gray-700 shadow-2xl">
                    <span className="text-2xl"></span>
                  </div>
                )}
                {opponentReady && (
                  <div className="absolute top-0 right-0 bg-yellow-500 rounded-full w-8 h-8 flex items-center justify-center border-2 border-yellow-400 shadow-lg">
                    <span className="text-black text-lg font-bold">✓</span>
                  </div>
                )}
                <p className="text-white font-bold drop-shadow-lg">{opponent?.username}</p>
                <p className="text-white text-3xl font-bold drop-shadow-2xl">{opponentScore}</p>
              </div>
            </div>
          </div>
          
          <p className="text-white text-2xl font-bold mb-6 drop-shadow-2xl">
            {isDraw ? "It's a Draw! " : winner?.id === playerId ? 'You Won This Round! ' : `${opponent?.username} Won! `}
          </p>
          
          {gameRoom && gameRoom.currentRound < gameRoom.maxRounds ? (
            <>
              <button
                onClick={startNextRound}
                disabled={iAmReady}
                className={`px-10 py-4 rounded-[28px] text-xl font-bold shadow-2xl transition-all mb-6 border-2 ${
                  iAmReady 
                    ? 'bg-yellow-500 text-black cursor-not-allowed border-yellow-400' 
                    : 'bg-gray-900 text-white hover:bg-gray-700 hover:scale-[1.02] active:scale-95 border-gray-800'
                }`}
              >
                Ready
              </button>
              
              {/* Waiting message */}
              {iAmReady && !opponentReady && (
                <p className="text-gray-400 text-sm mb-6">
                  Waiting for {opponent?.username}...
                </p>
              )}
              
              {/* Minimal timer */}
              {roundOverTimeRemaining > 0 && (
                <div className="flex items-center justify-center gap-3">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full border-2 ${
                    roundOverTimeRemaining <= 10 ? 'border-gray-600 bg-gray-800 animate-pulse' : 'border-gray-700 bg-gray-800'
                  } shadow-lg`}>
                    <span className={`text-lg font-bold ${roundOverTimeRemaining <= 10 ? 'text-white' : 'text-gray-300'}`}>
                      {roundOverTimeRemaining}
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm">auto-start</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-300 text-lg drop-shadow-lg">Calculating final results...</p>
          )}
        </div>
      </div>
    );
  };

  const renderGameOver = () => {
    const winner = gameRoom?.players.find(p => (gameRoom?.scores[p.id] || 0) > (opponent && gameRoom?.scores[opponent.id] || 0) ? true : false);
    const isDraw = myScore === opponentScore;

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center bg-gray-900 border-2 border-gray-800 rounded-[40px] shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-6">Game Over! </h2>
          
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
          
          <div className="mb-6">
            {isDraw ? (
              <>
                <p className="text-white text-3xl font-bold mb-2 drop-shadow-2xl">It&apos;s a Draw! </p>
                <p className="text-gray-300 drop-shadow-lg">Great match!</p>
              </>
            ) : winner?.id === playerId ? (
              <>
                <p className="text-white text-3xl font-bold mb-2 drop-shadow-2xl">You Won! </p>
                <p className="text-gray-300 drop-shadow-lg">Congratulations!</p>
              </>
            ) : (
              <>
                <p className="text-white text-3xl font-bold mb-2 drop-shadow-2xl">{opponent?.username} Won! </p>
                <p className="text-gray-300 drop-shadow-lg">Better luck next time!</p>
              </>
            )}
          </div>
          
          <button
            onClick={async () => {
              await leaveGame();
              // Immediately start finding a new match
              findMatch();
            }}
            className="backdrop-blur-3xl bg-gray-900 text-white px-10 py-4 rounded-[28px] text-xl font-bold shadow-2xl hover:bg-gray-700 hover:scale-[1.02] transition-all active:scale-95 border-2 border-gray-800"
          >
            Find New Match </button>
        </div>
      </div>
    );
  };

  // Leaderboard Modal
  const renderLeaderboard = () => (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border-2 border-gray-800 rounded-[40px] p-8 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-white">🏆 Leaderboard</h2>
          <button
            onClick={() => setShowLeaderboard(false)}
            className="text-gray-400 hover:text-white text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-800 transition-all"
          >
            ×
          </button>
        </div>

        {/* Player Stats Card */}
        {playerStats && (
          <div className="bg-gray-800 border-2 border-gray-700 rounded-[24px] p-4 mb-6">
            <div className="flex items-center gap-4">
              {farcasterUser?.pfpUrl && (
                <img src={farcasterUser.pfpUrl} alt="You" className="w-16 h-16 rounded-full border-2 border-gray-700" />
              )}
              <div className="flex-1">
                <div className="text-white font-bold text-lg">{farcasterUser?.username}</div>
                <div className="text-gray-400 text-sm">Your Rank: #{playerStats.rank}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{formatScore(playerStats.score)}</div>
                <div className="text-sm text-green-500">{playerStats.wins}W - {playerStats.losses}L</div>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
          {leaderboardData.map((entry, index) => {
            const isCurrentUser = entry.fid === farcasterUser?.fid.toString();
            return (
              <div
                key={entry.fid}
                className={`flex items-center gap-4 p-4 rounded-[20px] transition-all ${
                  isCurrentUser
                    ? 'bg-gray-700 border-2 border-gray-600'
                    : 'bg-gray-800 hover:bg-gray-750'
                }`}
              >
                <div className="w-12 text-center">
                  <span className="text-2xl font-bold text-gray-400">
                    {getRankEmoji(index + 1)}
                  </span>
                </div>
                <img
                  src={entry.pfpUrl}
                  alt={entry.username}
                  className="w-12 h-12 rounded-full border-2 border-gray-700"
                />
                <div className="flex-1">
                  <div className={`font-bold ${isCurrentUser ? 'text-white' : 'text-gray-300'}`}>
                    {entry.username}
                  </div>
                  <div className="text-sm text-gray-500">
                    {entry.wins}W - {entry.losses}L
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-white">{formatScore(entry.score)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Main render - show loading until ready
  if (!isReady) {
    return renderLoading();
  }

  // Show leaderboard modal
  if (showLeaderboard) {
    return renderLeaderboard();
  }

  // Show subject result animation if flag is set (overrides other states)
  if (showSubjectResult && gameRoom?.currentSubject) {
    return renderSubjectResult();
  }

  // Main game render
  switch (gameState) {
    case 'idle':
      return renderIdle();
    case 'searching':
      return renderSearching();
    case 'matched':
      return renderMatched();
    case 'subject-selection':
      return renderSubjectSelection();
    case 'waiting-subject':
      return renderWaitingSubject();
    case 'playing':
      return renderPlaying();
    case 'round-result':
      return renderRoundResult();
    case 'game-over':
      return renderGameOver();
    default:
      return renderIdle();
  }
}

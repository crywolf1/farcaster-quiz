'use client';

import { useState, useEffect, useRef } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import type { Question } from '@/lib/types';

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
  const [gameState, setGameState] = useState<GameState>('idle');
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
  const [answerFeedback, setAnswerFeedback] = useState<'correct' | 'incorrect' | null>(null); // Track answer feedback
  const [isShowingFeedback, setIsShowingFeedback] = useState(false); // Flag to prevent question change during feedback
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Farcaster SDK
  useEffect(() => {
    const initializeFrame = async () => {
      console.log('🚀 Starting Farcaster SDK initialization...');
      
      try {
        // Check if we're running in a Farcaster frame context
        console.log('📡 Fetching SDK context...');
        const context = await sdk.context;
        console.log('✅ Context received:', context);
        
        setIsFrameContext(!!context);

        if (context) {
          console.log('🎯 In Farcaster frame - calling ready()...');
          
          // We're in a Farcaster frame, initialize properly
          await sdk.actions.ready({
            disableNativeGestures: true,
          });
          
          console.log('✅ sdk.actions.ready() called successfully!');

          setIsReady(true);
          const user = (context as any).user;
          setFarcasterUser(user as FarcasterUser);
          setPlayerId(`player_${user.fid}_${Date.now()}`);

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
          setPlayerId(`player_${fallbackUser.fid}_${Date.now()}`);
        }
      } catch (err) {
        console.error('❌ Farcaster Frame SDK error:', err);
        setIsReady(true); // Still allow the app to work
        const fallbackUser = {
          username: `Player${Math.floor(Math.random() * 1000)}`,
          pfpUrl: '',
          fid: Math.floor(Math.random() * 10000)
        };
        setFarcasterUser(fallbackUser);
        setPlayerId(`player_${fallbackUser.fid}_${Date.now()}`);
      }
    };

    initializeFrame();
  }, []);

  // Start matchmaking
  const findMatch = async () => {
    if (!farcasterUser || !playerId) return;

    setGameState('searching');

    try {
      // Join matchmaking queue
      const response = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          username: farcasterUser.username,
          pfpUrl: farcasterUser.pfpUrl,
          fid: farcasterUser.fid,
        }),
      });

      const data = await response.json();

      if (data.roomId) {
        // Already matched!
        setRoomId(data.roomId);
        startPolling();
      } else {
        // Keep polling for match
        startMatchPolling();
      }
    } catch (error) {
      console.error('Find match error:', error);
      setGameState('idle');
    }
  };

  // Poll for match
  const startMatchPolling = () => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/match?playerId=${playerId}`);
        const data = await response.json();

        if (data.matched && data.roomId) {
          clearInterval(interval);
          setRoomId(data.roomId);
          setOpponent(data.opponent || null);
          setSubjects(data.subjects || []);
          setGameState('matched');
          
          // Wait 2 seconds then start game polling
          setTimeout(() => {
            startPolling();
          }, 2000);
        }
      } catch (error) {
        console.error('Match polling error:', error);
      }
    }, 1000); // Poll every second

    // Store interval to clean up later
    pollingIntervalRef.current = interval;
  };

  // Poll for game state
  const startPolling = () => {
    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/game?playerId=${playerId}`);
        const data = await response.json();

        if (data.gameState) {
          const room: GameRoom = data.gameState;
          setGameRoom(room);
          
          // Update MY timer (per-player timer)
          const myTimerStart = room.playerTimers?.[playerId];
          if (myTimerStart && room.state === 'playing' && !room.playersFinished?.includes(playerId)) {
            const elapsed = Date.now() - myTimerStart;
            const remaining = Math.max(0, 18000 - elapsed); // 18 seconds per question
            setTimeRemaining(Math.ceil(remaining / 1000));
            setTimerActive(remaining > 0);
          } else if (room.state === 'subject-selection' && room.timerStartedAt && room.timerDuration) {
            // Subject selection timer - ONLY show during subject selection
            const elapsed = Date.now() - room.timerStartedAt;
            const remaining = Math.max(0, room.timerDuration - elapsed);
            setTimeRemaining(Math.ceil(remaining / 1000));
            setTimerActive(remaining > 0);
          } else {
            setTimerActive(false);
          }

          // Update round over auto-start timer
          if (room.state === 'round-over' && room.roundOverTimerStartedAt) {
            const elapsed = Date.now() - room.roundOverTimerStartedAt;
            const remaining = Math.max(0, 30000 - elapsed); // 30 seconds
            const seconds = Math.ceil(remaining / 1000);
            console.log('[Polling] Round-over timer:', {
              roundOverTimerStartedAt: room.roundOverTimerStartedAt,
              elapsed,
              remaining,
              seconds,
              currentValue: roundOverTimeRemaining
            });
            setRoundOverTimeRemaining(seconds);
          } else if (room.state === 'round-over') {
            console.log('[Polling] Round-over state but no timer! roundOverTimerStartedAt:', room.roundOverTimerStartedAt);
          }

          // Update opponent if not set
          if (!opponent && room.players.length === 2) {
            const opp = room.players.find(p => p.id !== playerId);
            if (opp) setOpponent(opp);
          }

          // Update game state based on room state
          console.log('[Polling] Room state:', room.state, 'Current gameState:', gameState);
          
          if (room.state === 'subject-selection') {
            const isMyTurn = room.players[room.currentPickerIndex]?.id === playerId;
            const newState = isMyTurn ? 'subject-selection' : 'waiting-subject';
            console.log('[Polling] Subject selection - isMyTurn:', isMyTurn, 'newState:', newState);
            setGameState(newState);
          } else if (room.state === 'playing') {
            console.log('[Polling] Setting state to playing, myProgress:', room.myProgress);
            setGameState('playing');
            
            // Check if MY question changed - BUT ONLY if not showing feedback animation
            const myCurrentQ = room.questions[room.myProgress || 0];
            if (myCurrentQ && myCurrentQ.id !== currentQuestionId) {
              if (isShowingFeedback) {
                console.log('[Polling] Question changed but BLOCKING due to feedback animation');
              } else {
                console.log('[Polling] New question for me:', myCurrentQ.id, 'changing from:', currentQuestionId);
                setCurrentQuestionId(myCurrentQ.id);
                setSelectedAnswer(null);
                setAnswerFeedback(null); // Reset feedback for new question
                setLastResult(null);
                setShowingResults(false);
              }
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
        console.error('Game polling error:', error);
      }
    }, 1000); // Poll every second

    pollingIntervalRef.current = interval;
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
    console.log('[Client] Selecting subject:', subject, 'playerId:', playerId);
    
    // Immediately show selection with animation
    setSelectedSubject(subject);
    
    try {
      const response = await fetch('/api/subject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, subject }),
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
      const response = await fetch('/api/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
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

  // Get current question based on MY progress
  const myProgress = gameRoom?.myProgress || 0;
  const currentQuestion = gameRoom?.questions?.[myProgress];
  const isMyTurnToPick = gameRoom?.players[gameRoom.currentPickerIndex]?.id === playerId;
  const myScore = gameRoom?.scores?.[playerId] || 0;
  const opponentScore = opponent ? (gameRoom?.scores?.[opponent.id] || 0) : 0;
  const iFinished = gameRoom?.playersFinished?.includes(playerId) || false;
  const opponentFinished = opponent && gameRoom?.playersFinished?.includes(opponent.id) || false;

  // Render functions
  const renderLoading = () => (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl bg-white/10 border-2 border-white/30 rounded-[32px] p-12 shadow-2xl">
        <div className="w-20 h-20 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-6 drop-shadow-2xl"></div>
        <p className="text-white text-xl font-semibold drop-shadow-lg">Loading Quiz...</p>
      </div>
    </div>
  );

  const renderIdle = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="backdrop-blur-3xl bg-white/10 border-2 border-white/30 rounded-[40px] p-10 shadow-2xl max-w-md w-full">
        <div className="text-center mb-8">
          {farcasterUser?.pfpUrl ? (
            <img src={farcasterUser.pfpUrl} alt="Profile" className="w-28 h-28 rounded-full mx-auto mb-6 border-4 border-white/70 shadow-2xl ring-4 ring-white/40" />
          ) : (
            <div className="w-28 h-28 rounded-full mx-auto mb-6 border-4 border-white/70 shadow-2xl ring-4 ring-white/40 backdrop-blur-xl bg-white/20 flex items-center justify-center">
              <span className="text-5xl">👤</span>
            </div>
          )}
          <h1 className="text-5xl font-bold text-white drop-shadow-2xl mb-3">Farcaster Quiz</h1>
          <p className="text-white/90 text-lg font-medium drop-shadow-lg">Welcome, {farcasterUser?.username}!</p>
        </div>
        
        <button
          onClick={findMatch}
          className="w-full backdrop-blur-2xl bg-white/20 text-white px-12 py-5 rounded-[28px] text-xl font-bold shadow-2xl hover:bg-white/30 hover:shadow-[0_20px_50px_rgba(255,255,255,0.3)] hover:scale-[1.05] transition-all active:scale-95 border-2 border-white/40"
        >
          🎯 Find Match
        </button>
      </div>
    </div>
  );

  const renderSearching = () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="backdrop-blur-3xl bg-white/10 border-2 border-white/30 rounded-[40px] p-12 shadow-2xl">
        <div className="w-24 h-24 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-8 drop-shadow-2xl"></div>
        <h2 className="text-3xl font-bold text-white mb-3 text-center drop-shadow-lg">Finding opponent...</h2>
        <p className="text-white/80 text-center drop-shadow">Please wait</p>
      </div>
    </div>
  );

  const renderMatched = () => (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl bg-white/10 border-2 border-white/30 rounded-[40px] shadow-2xl p-10 max-w-md w-full">
        <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-8 text-center">
          Match Found! 🎉
        </h2>
        
        <div className="flex justify-around items-center mb-8">
          <div className="text-center">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-20 h-20 rounded-full border-4 border-white/70 shadow-2xl ring-4 ring-white/40 mb-2" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-white/70 shadow-2xl backdrop-blur-xl bg-white/20 flex items-center justify-center mb-2 ring-4 ring-white/40">
                <span className="text-3xl">👤</span>
              </div>
            )}
            <p className="text-white font-semibold drop-shadow-lg">{farcasterUser?.username}</p>
          </div>
          
          <div className="text-5xl drop-shadow-2xl">⚡</div>
          
          <div className="text-center">
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-20 h-20 rounded-full border-4 border-white/70 shadow-2xl ring-4 ring-white/40 mb-2" />
            ) : (
              <div className="w-20 h-20 rounded-full border-4 border-white/70 shadow-2xl backdrop-blur-xl bg-white/20 flex items-center justify-center mb-2 ring-4 ring-white/40">
                <span className="text-3xl">👤</span>
              </div>
            )}
            <p className="text-white font-semibold drop-shadow-lg">{opponent?.username}</p>
          </div>
        </div>
        
        <p className="text-white/90 text-lg text-center drop-shadow-lg">Starting game...</p>
      </div>
    </div>
  );

  const renderSubjectSelection = () => (
    <div className="min-h-screen flex flex-col p-4">
      {/* Header */}
      <div className="backdrop-blur-3xl bg-white/15 border-2 border-white/30 rounded-[32px] p-4 mb-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-white/70 ring-2 ring-white/40" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-white/70 backdrop-blur-xl bg-white/20 flex items-center justify-center ring-2 ring-white/40">
                <span className="text-lg">👤</span>
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm drop-shadow-lg">{farcasterUser?.username}</p>
              <p className="text-white/80 text-xs drop-shadow">Score: {myScore}</p>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-white/80 text-xs drop-shadow">Round</p>
            <p className="text-white font-bold text-xl drop-shadow-lg">{gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-white font-semibold text-sm drop-shadow-lg">{opponent?.username}</p>
              <p className="text-white/80 text-xs drop-shadow">Score: {opponentScore}</p>
            </div>
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-white/70 ring-2 ring-white/40" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-white/70 backdrop-blur-xl bg-white/20 flex items-center justify-center ring-2 ring-white/40">
                <span className="text-lg">👤</span>
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
                timeRemaining <= 5 ? 'border-red-400 bg-red-500/30 animate-pulse' : 'border-white/60 bg-white/20'
              } shadow-2xl drop-shadow-2xl`}>
                <span className={`text-3xl font-bold ${timeRemaining <= 5 ? 'text-red-100' : 'text-white'} drop-shadow-lg`}>
                  {timeRemaining}
                </span>
              </div>
              <p className="text-white/90 text-sm mt-2 drop-shadow">
                {isMyTurnToPick ? 'Pick a subject!' : 'Waiting...'}
              </p>
            </div>
          )}
          
          <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl">
            {isMyTurnToPick ? 'Choose a Subject 📚' : 'Opponent is choosing...'}
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
                        ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-white border-green-300 scale-105 animate-pulse shadow-[0_0_40px_rgba(16,185,129,0.6)]'
                        : selectedSubject
                        ? 'backdrop-blur-2xl bg-white/10 text-white/50 border-white/20 cursor-not-allowed'
                        : 'backdrop-blur-2xl bg-white/20 text-white border-white/40 hover:bg-white/30 hover:shadow-[0_20px_50px_rgba(255,255,255,0.3)] hover:scale-[1.02] active:scale-95 cursor-pointer'
                    }`}
                  >
                    {subject} {isSelected && '✓'}
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
      {/* Header - same as subject selection */}
      <div className="backdrop-blur-3xl bg-white/15 border-2 border-white/30 rounded-[32px] p-4 mb-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {farcasterUser?.pfpUrl ? (
              <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-white/70 ring-2 ring-white/40" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-white/70 backdrop-blur-xl bg-white/20 flex items-center justify-center ring-2 ring-white/40">
                <span className="text-lg">👤</span>
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm drop-shadow-lg">{farcasterUser?.username}</p>
              <p className="text-white/80 text-xs drop-shadow">Score: {myScore}</p>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-white/80 text-xs drop-shadow">Round</p>
            <p className="text-white font-bold text-xl drop-shadow-lg">{gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-white font-semibold text-sm drop-shadow-lg">{opponent?.username}</p>
              <p className="text-white/80 text-xs drop-shadow">Score: {opponentScore}</p>
            </div>
            {opponent?.pfpUrl ? (
              <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-white/70 ring-2 ring-white/40" />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-white/70 backdrop-blur-xl bg-white/20 flex items-center justify-center ring-2 ring-white/40">
                <span className="text-lg">👤</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Waiting message */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center backdrop-blur-3xl bg-white/10 border-2 border-white/30 rounded-[40px] shadow-2xl p-10">
          <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto mb-4 drop-shadow-2xl"></div>
          <h2 className="text-2xl font-bold text-white mb-2 drop-shadow-lg">{opponent?.username} is choosing...</h2>
          <p className="text-white/90 drop-shadow">Get ready!</p>
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
            <div className="backdrop-blur-3xl bg-white/10 border-2 border-white/30 rounded-[40px] shadow-2xl p-8">
              <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-2xl">You Finished! 🎉</h2>
              <p className="text-white/90 text-lg mb-6 drop-shadow-lg">
                Waiting for {opponent?.username} to finish...
              </p>
              <div className="mb-6">
                <p className="text-white text-5xl font-bold mb-2 drop-shadow-2xl">{myScore}</p>
                <p className="text-white/80 drop-shadow">Your Score</p>
              </div>
              <div className="w-16 h-16 border-4 border-white/60 border-t-transparent rounded-full animate-spin mx-auto drop-shadow-2xl"></div>
            </div>
          </div>
        </div>
      );
    }
    
    if (!currentQuestion) {
      console.log('[Render] No current question, myProgress:', myProgress, 'questions:', gameRoom?.questions?.length);
      return null;
    }

    console.log('[Render] Current question:', currentQuestion.id, 'options:', currentQuestion.options?.length);

    const hasAnswered = selectedAnswer !== null;
    const bothAnswered = showingResults && lastResult !== null;

    return (
      <div className="min-h-screen  flex flex-col p-4">
        {/* Header */}
        <div className="backdrop-blur-3xl bg-white/15 border-2 border-white/30 rounded-[32px] p-4 mb-4 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              {farcasterUser?.pfpUrl ? (
                <img src={farcasterUser.pfpUrl} alt="You" className="w-10 h-10 rounded-full border-2 border-white/70 ring-2 ring-white/40" />
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-white/70 bg-white/50 flex items-center justify-center ring-2 ring-white/40">
                  <span className="text-lg">👤</span>
                </div>
              )}
              <div>
                <p className="text-white font-semibold text-sm">{farcasterUser?.username}</p>
                <p className="text-white/80 text-xs">Score: {myScore}</p>
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-white/80 text-xs">Round {gameRoom?.currentRound}/{gameRoom?.maxRounds}</p>
              <p className="text-white font-bold">Q {myProgress + 1}/5</p>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-white font-semibold text-sm">{opponent?.username}</p>
                <p className="text-white/80 text-xs">Score: {opponentScore}</p>
              </div>
              {opponent?.pfpUrl ? (
                <img src={opponent.pfpUrl} alt="Opponent" className="w-10 h-10 rounded-full border-2 border-white/70 ring-2 ring-white/40" />
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-white/70 bg-white/50 flex items-center justify-center ring-2 ring-white/40">
                  <span className="text-lg">👤</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-white/90 text-sm font-medium">{gameRoom?.currentSubject}</p>
          </div>
        </div>

        {/* Question */}
        <div className="flex-1 flex flex-col justify-center max-w-2xl w-full mx-auto">
          {/* Timer */}
          {timerActive && (
            <div className="text-center mb-4">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full border-4 backdrop-blur-xl ${
                timeRemaining <= 5 ? 'border-red-500 bg-red-500/30 animate-pulse' : 'border-indigo-400/50 bg-white/50'
              } shadow-xl`}>
                <span className={`text-2xl font-bold ${timeRemaining <= 5 ? 'text-red-600' : 'text-white'}`}>
                  {timeRemaining}
                </span>
              </div>
            </div>
          )}
          
          <div className="backdrop-blur-xl bg-white/40 border border-white/20 rounded-[32px] p-6 mb-6 shadow-xl">
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
                  buttonClass += " bg-gradient-to-r from-green-400 to-emerald-500 text-white border-2 border-green-300 shadow-[0_0_30px_rgba(16,185,129,0.5)]";
                } else if (isMyAnswer) {
                  buttonClass += " bg-gradient-to-r from-red-400 to-rose-500 text-white border-2 border-red-300 shadow-[0_0_30px_rgba(239,68,68,0.5)]";
                } else {
                  buttonClass += " backdrop-blur-lg bg-white/30 border-2 border-white/20 text-white/70";
                }
              } else if (showInstantFeedback) {
                // Show instant feedback after selection with dramatic animation
                if (answerFeedback === 'correct') {
                  buttonClass += " bg-gradient-to-r from-green-400 via-emerald-400 to-emerald-500 text-white border-4 border-green-300 animate-[pulse_0.8s_ease-in-out_infinite] scale-110 shadow-[0_0_60px_rgba(16,185,129,0.8),0_0_100px_rgba(16,185,129,0.4)] transform";
                } else {
                  buttonClass += " bg-gradient-to-r from-red-400 via-rose-400 to-rose-500 text-white border-4 border-red-300 animate-[pulse_0.8s_ease-in-out_infinite] scale-110 shadow-[0_0_60px_rgba(239,68,68,0.8),0_0_100px_rgba(239,68,68,0.4)] transform";
                }
              } else if (hasAnswered && isMyAnswer) {
                // Selected but waiting
                buttonClass += " backdrop-blur-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-2 border-white/20";
              } else if (hasAnswered) {
                // Not selected, disabled
                buttonClass += " backdrop-blur-lg bg-white/20 border-2 border-white/20 text-white/50 cursor-not-allowed";
              } else {
                // Not answered yet, hoverable
                buttonClass += " backdrop-blur-lg bg-white/50 border-2 border-white/40 text-white hover:bg-white/70 hover:scale-[1.02] active:scale-95 cursor-pointer";
              }

              return (
                <button
                  key={index}
                  onClick={() => !hasAnswered && submitAnswer(index)}
                  disabled={hasAnswered}
                  className={buttonClass}
                >
                  {option}
                  {showInstantFeedback && answerFeedback === 'correct' && " ✓"}
                  {showInstantFeedback && answerFeedback === 'incorrect' && " ✗"}
                  {bothAnswered && isCorrect && " ✓"}
                </button>
              );
            })}
          </div>

          {bothAnswered && lastResult && (
            <div className="mt-4 backdrop-blur-lg bg-white/50 border border-white/30 rounded-[28px] p-4 shadow-lg">
              <div className="flex justify-between">
                {lastResult.map((result: any) => (
                  <div key={result.playerId} className="text-center">
                    <p className="text-white font-semibold">{result.username}</p>
                    <p className="text-2xl">{result.correct ? '✅' : '❌'}</p>
                    <p className="text-white/90 text-sm">Score: {result.score}</p>
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
    const winner = gameRoom?.players.find(p => (gameRoom?.scores[p.id] || 0) > (opponent && gameRoom?.scores[opponent.id] || 0) ? true : false);
    const isDraw = myScore === opponentScore;
    const iAmReady = gameRoom?.playersReady?.includes(playerId) || false;
    const opponentReady = opponent && gameRoom?.playersReady?.includes(opponent.id) || false;

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center backdrop-blur-3xl bg-black/40 border-2 border-white/20 rounded-[40px] shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-6">
            Round {gameRoom?.currentRound} Complete! 🎉
          </h2>
          
          <div className="backdrop-blur-2xl bg-white/5 border-2 border-white/20 rounded-[32px] p-6 mb-6 shadow-lg">
            <div className="flex justify-around">
              <div className="text-center relative">
                {farcasterUser?.pfpUrl ? (
                  <img src={farcasterUser.pfpUrl} alt="You" className="w-16 h-16 rounded-full border-4 border-white/70 ring-4 ring-white/40 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-white/70 bg-white/10 flex items-center justify-center mx-auto mb-2 ring-4 ring-white/40 shadow-2xl">
                    <span className="text-2xl">👤</span>
                  </div>
                )}
                {iAmReady && (
                  <div className="absolute top-0 right-0 bg-green-500 rounded-full w-8 h-8 flex items-center justify-center border-2 border-white shadow-lg">
                    <span className="text-white text-lg">✓</span>
                  </div>
                )}
                <p className="text-white font-bold drop-shadow-lg">{farcasterUser?.username}</p>
                <p className="text-white text-3xl font-bold drop-shadow-2xl">{myScore}</p>
                {iAmReady && <p className="text-green-400 text-xs mt-1 font-semibold drop-shadow-lg">Ready!</p>}
              </div>
              
              <div className="text-center relative">
                {opponent?.pfpUrl ? (
                  <img src={opponent.pfpUrl} alt="Opponent" className="w-16 h-16 rounded-full border-4 border-white/70 ring-4 ring-white/40 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-white/70 bg-white/10 flex items-center justify-center mx-auto mb-2 ring-4 ring-white/40 shadow-2xl">
                    <span className="text-2xl">👤</span>
                  </div>
                )}
                {opponentReady && (
                  <div className="absolute top-0 right-0 bg-green-500 rounded-full w-8 h-8 flex items-center justify-center border-2 border-white shadow-lg">
                    <span className="text-white text-lg">✓</span>
                  </div>
                )}
                <p className="text-white font-bold drop-shadow-lg">{opponent?.username}</p>
                <p className="text-white text-3xl font-bold drop-shadow-2xl">{opponentScore}</p>
                {opponentReady && <p className="text-green-400 text-xs mt-1 font-semibold drop-shadow-lg">Ready!</p>}
              </div>
            </div>
          </div>
          
          <p className="text-white text-2xl font-bold mb-6 drop-shadow-2xl">
            {isDraw ? "It's a Draw! 🤝" : winner?.id === playerId ? 'You Won This Round! 🏆' : `${opponent?.username} Won! 💪`}
          </p>
          
          {gameRoom && gameRoom.currentRound < gameRoom.maxRounds ? (
            <>
              <button
                onClick={startNextRound}
                disabled={iAmReady}
                className={`px-10 py-4 rounded-[28px] text-xl font-bold shadow-2xl transition-all mb-4 border-2 ${
                  iAmReady 
                    ? 'bg-green-500 text-white cursor-not-allowed border-green-400' 
                    : 'backdrop-blur-3xl bg-white/10 text-white hover:bg-white/20 hover:scale-[1.02] active:scale-95 border-white/30'
                }`}
              >
                {iAmReady ? '✓ Ready!' : 'Ready for Next Round'}
              </button>
              
              {/* Waiting message */}
              {iAmReady && !opponentReady && (
                <p className="text-white/90 text-sm mb-4 drop-shadow-lg">
                  Waiting for {opponent?.username} to be ready...
                </p>
              )}
              
              {/* Auto-start countdown */}
              {roundOverTimeRemaining > 0 && (
                <div className="backdrop-blur-3xl bg-black/30 border-2 border-white/20 rounded-[28px] p-5 shadow-2xl">
                  <p className="text-white text-sm mb-3 drop-shadow-lg font-semibold">
                    {!iAmReady || !opponentReady ? 'Both players must click Ready, or auto-starting in:' : 'Auto-starting in:'}
                  </p>
                  <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full border-4 backdrop-blur-2xl ${
                    roundOverTimeRemaining <= 10 ? 'border-red-400 bg-red-500/20 animate-pulse' : 'border-white/50 bg-black/30'
                  } shadow-2xl`}>
                    <span className={`text-3xl font-bold drop-shadow-2xl ${roundOverTimeRemaining <= 10 ? 'text-red-300' : 'text-white'}`}>
                      {roundOverTimeRemaining}
                    </span>
                  </div>
                  <p className="text-white/80 text-xs mt-2 drop-shadow-lg font-semibold">seconds</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-white/90 text-lg drop-shadow-lg">Calculating final results...</p>
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
        <div className="text-center backdrop-blur-3xl bg-black/40 border-2 border-white/20 rounded-[40px] shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-4xl font-bold text-white drop-shadow-2xl mb-6">Game Over! 🎮</h2>
          
          <div className="backdrop-blur-2xl bg-white/5 border-2 border-white/20 rounded-[32px] p-6 mb-6 shadow-lg">
            <div className="flex justify-around">
              <div className="text-center">
                {farcasterUser?.pfpUrl ? (
                  <img src={farcasterUser.pfpUrl} alt="You" className="w-20 h-20 rounded-full border-4 border-white/70 ring-4 ring-white/40 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-20 h-20 rounded-full border-4 border-white/70 bg-white/10 flex items-center justify-center mx-auto mb-2 ring-4 ring-white/40 shadow-2xl">
                    <span className="text-3xl">👤</span>
                  </div>
                )}
                <p className="text-white font-bold text-lg drop-shadow-lg">{farcasterUser?.username}</p>
                <p className="text-white text-4xl font-bold drop-shadow-2xl">{myScore}</p>
              </div>
              
              <div className="text-center">
                {opponent?.pfpUrl ? (
                  <img src={opponent.pfpUrl} alt="Opponent" className="w-20 h-20 rounded-full border-4 border-white/70 ring-4 ring-white/40 mx-auto mb-2 shadow-2xl" />
                ) : (
                  <div className="w-20 h-20 rounded-full border-4 border-white/70 bg-white/10 flex items-center justify-center mx-auto mb-2 ring-4 ring-white/40 shadow-2xl">
                    <span className="text-3xl">👤</span>
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
                <p className="text-white text-3xl font-bold mb-2 drop-shadow-2xl">It&apos;s a Draw! 🤝</p>
                <p className="text-white/90 drop-shadow-lg">Great match!</p>
              </>
            ) : winner?.id === playerId ? (
              <>
                <p className="text-white text-3xl font-bold mb-2 drop-shadow-2xl">You Won! 🏆</p>
                <p className="text-white/90 drop-shadow-lg">Congratulations!</p>
              </>
            ) : (
              <>
                <p className="text-white text-3xl font-bold mb-2 drop-shadow-2xl">{opponent?.username} Won! 💪</p>
                <p className="text-white/90 drop-shadow-lg">Better luck next time!</p>
              </>
            )}
          </div>
          
          <button
            onClick={() => {
              setGameState('idle');
              setRoomId('');
              setOpponent(null);
              setGameRoom(null);
              setSelectedAnswer(null);
              setLastResult(null);
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
              }
            }}
            className="backdrop-blur-3xl bg-white/10 text-white px-10 py-4 rounded-[28px] text-xl font-bold shadow-2xl hover:bg-white/20 hover:scale-[1.02] transition-all active:scale-95 border-2 border-white/30"
          >
            Play Again
          </button>
        </div>
      </div>
    );
  };

  // Main render - show loading until ready
  if (!isReady) {
    return renderLoading();
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

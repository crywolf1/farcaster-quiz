'use client';

import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import sdk from '@farcaster/frame-sdk';
import type { ServerToClientEvents, ClientToServerEvents, Question } from '@/lib/types';

type GameState = 'loading' | 'idle' | 'searching' | 'matched' | 'subject-selection' | 'waiting-subject' | 'playing' | 'round-result' | 'game-over';

interface FarcasterUser {
  username: string;
  pfpUrl: string;
  fid: number;
}

export default function Home() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [gameState, setGameState] = useState<GameState>('loading');
  const [farcasterUser, setFarcasterUser] = useState<FarcasterUser | null>(null);
  const [roomId, setRoomId] = useState('');
  const [opponent, setOpponent] = useState<{ id: string; username: string; pfpUrl?: string; fid?: number } | null>(null);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [currentSubject, setCurrentSubject] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(5);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [opponentAnswered, setOpponentAnswered] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [scores, setScores] = useState<{ playerId: string; username: string; score: number }[]>([]);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  const [nextRoundOwner, setNextRoundOwner] = useState('');
  const [gameWinner, setGameWinner] = useState('');

  useEffect(() => {
    // Initialize Farcaster SDK and get user context
    const initFarcaster = async () => {
      try {
        const context = await sdk.context;
        const user = context.user;
        
        if (user) {
          setFarcasterUser({
            username: user.username || user.displayName || `User${user.fid}`,
            pfpUrl: user.pfpUrl || '',
            fid: user.fid
          });
          setGameState('idle');
        } else {
          // Fallback for development/testing
          setFarcasterUser({
            username: `Player${Math.floor(Math.random() * 1000)}`,
            pfpUrl: '',
            fid: Math.floor(Math.random() * 100000)
          });
          setGameState('idle');
        }
      } catch (error) {
        console.error('Farcaster SDK init error:', error);
        // Fallback for development
        setFarcasterUser({
          username: `Player${Math.floor(Math.random() * 1000)}`,
          pfpUrl: '',
          fid: Math.floor(Math.random() * 100000)
        });
        setGameState('idle');
      }
    };

    initFarcaster();

    // Connect to Socket.IO server
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    const socketInstance = io(socketUrl);
    setSocket(socketInstance);

    socketInstance.on('match-found', (data) => {
      setRoomId(data.roomId);
      setOpponent(data.opponent);
      setIsMyTurn(data.yourTurn);
      setGameState('matched');
      
      setTimeout(() => {
        if (data.yourTurn) {
          setGameState('subject-selection');
        } else {
          setGameState('waiting-subject');
        }
      }, 2000);
    });

    socketInstance.on('subject-selection-required', (data) => {
      setSubjects(data.subjects);
      setGameState('subject-selection');
    });

    socketInstance.on('subject-selected', (data) => {
      setCurrentSubject(data.subject);
      setGameState('playing');
    });

    socketInstance.on('question', (data) => {
      setCurrentQuestion(data.question);
      setQuestionNumber(data.questionNumber);
      setTotalQuestions(data.totalQuestions);
      setSelectedAnswer(null);
      setOpponentAnswered(false);
      setLastResult(null);
      setGameState('playing');
    });

    socketInstance.on('answer-submitted', () => {
      setOpponentAnswered(true);
    });

    socketInstance.on('question-result', (data) => {
      setLastResult(data);
    });

    socketInstance.on('round-complete', (data) => {
      setRoundWinner(data.winner);
      setScores(data.scores);
      setNextRoundOwner(data.nextRoundOwner);
      setGameState('round-result');
    });

    socketInstance.on('game-over', (data) => {
      setGameWinner(data.winner);
      setScores(data.finalScores);
      setGameState('game-over');
    });

    socketInstance.on('opponent-disconnected', () => {
      alert('Opponent disconnected!');
      setGameState('idle');
      resetGame();
    });

    socketInstance.on('error', (data) => {
      alert(data.message);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const resetGame = () => {
    setRoomId('');
    setOpponent(null);
    setIsMyTurn(false);
    setSubjects([]);
    setCurrentSubject('');
    setCurrentQuestion(null);
    setQuestionNumber(0);
    setSelectedAnswer(null);
    setOpponentAnswered(false);
    setLastResult(null);
    setScores([]);
    setRoundWinner(null);
    setNextRoundOwner('');
    setGameWinner('');
  };

  const handleFindMatch = () => {
    if (!farcasterUser) {
      alert('Loading user data...');
      return;
    }
    socket?.emit('find-match', { 
      username: farcasterUser.username,
      pfpUrl: farcasterUser.pfpUrl,
      fid: farcasterUser.fid
    });
    setGameState('searching');
  };

  const handleSelectSubject = (subject: string) => {
    socket?.emit('select-subject', { roomId, subject });
  };

  const handleSubmitAnswer = (answerIndex: number) => {
    if (selectedAnswer !== null) return;
    
    setSelectedAnswer(answerIndex);
    socket?.emit('submit-answer', {
      roomId,
      questionId: currentQuestion!.id,
      answerIndex
    });
  };

  // Render different screens based on game state
  if (gameState === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-purple-600 mx-auto mb-3"></div>
          <h2 className="text-lg font-bold text-gray-800">Loading Farcaster...</h2>
        </div>
      </div>
    );
  }

  if (gameState === 'idle') {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full">
          <h1 className="text-3xl font-bold text-center mb-2 text-purple-600">🎯 Farcaster Quiz</h1>
          <p className="text-center text-gray-600 mb-6 text-sm">Challenge players in real-time!</p>
          
          {/* User Profile Card */}
          <div className="bg-gradient-to-r from-purple-100 to-indigo-100 rounded-2xl p-4 mb-6 flex items-center gap-3">
            {farcasterUser?.pfpUrl ? (
              <img 
                src={farcasterUser.pfpUrl} 
                alt={farcasterUser.username}
                className="w-14 h-14 rounded-full border-2 border-purple-400"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-purple-400 flex items-center justify-center text-white font-bold text-xl">
                {farcasterUser?.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <p className="font-bold text-gray-800 text-lg">{farcasterUser?.username}</p>
              <p className="text-xs text-gray-600">FID: {farcasterUser?.fid}</p>
            </div>
          </div>
          
          <button
            onClick={handleFindMatch}
            className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold py-4 px-6 rounded-xl hover:from-purple-600 hover:to-indigo-700 transition-all transform active:scale-95 shadow-lg"
          >
            🎮 Find Match
          </button>
        </div>
      </div>
    );
  }

  if (gameState === 'searching') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
          <div className="animate-spin rounded-full h-14 w-14 border-b-4 border-purple-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Finding opponent...</h2>
          <p className="text-gray-600 text-sm">Matching you with another player</p>
        </div>
      </div>
    );
  }

  if (gameState === 'matched') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">🎮</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Match Found!</h2>
          
          {/* Opponent Profile */}
          <div className="bg-gradient-to-r from-purple-100 to-indigo-100 rounded-2xl p-4 mb-4 flex items-center gap-3 justify-center">
            {opponent?.pfpUrl ? (
              <img 
                src={opponent.pfpUrl} 
                alt={opponent.username}
                className="w-12 h-12 rounded-full border-2 border-purple-400"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-purple-400 flex items-center justify-center text-white font-bold">
                {opponent?.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-bold text-gray-800">{opponent?.username}</p>
            </div>
          </div>
          
          <p className="text-sm text-gray-500 animate-pulse">Get ready...</p>
        </div>
      </div>
    );
  }

  if (gameState === 'subject-selection') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-5 max-w-sm w-full">
          <div className="text-center mb-5">
            <h2 className="text-2xl font-bold text-gray-800 mb-1">Choose a Subject</h2>
            <p className="text-gray-600 text-sm">Pick a topic for this round</p>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {subjects.map((subject) => (
              <button
                key={subject}
                onClick={() => handleSelectSubject(subject)}
                className="bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-bold py-4 px-3 rounded-xl hover:from-purple-600 hover:to-indigo-700 transition-all transform active:scale-95 text-sm"
              >
                {subject}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'waiting-subject') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
          <div className="animate-pulse text-5xl mb-4">🤔</div>
          <h2 className="text-xl font-bold text-gray-800 mb-3">Waiting for opponent...</h2>
          
          {opponent?.pfpUrl ? (
            <img 
              src={opponent.pfpUrl} 
              alt={opponent.username}
              className="w-16 h-16 rounded-full border-2 border-purple-400 mx-auto mb-2"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-purple-400 flex items-center justify-center text-white font-bold text-xl mx-auto mb-2">
              {opponent?.username?.charAt(0).toUpperCase()}
            </div>
          )}
          
          <p className="text-gray-600 text-sm">
            <span className="font-bold text-purple-600">{opponent?.username}</span> is choosing the subject
          </p>
        </div>
      </div>
    );
  }

  if (gameState === 'playing' && currentQuestion) {
    return (
      <div className="h-screen flex flex-col p-4 bg-gradient-to-br from-purple-600 to-indigo-700 overflow-y-auto">
        <div className="bg-white rounded-3xl shadow-2xl p-4 max-w-sm w-full mx-auto my-auto">
          <div className="flex justify-between items-center mb-4">
            <div className="text-xs font-semibold text-gray-600">
              Question {questionNumber}/{totalQuestions}
            </div>
            <div className="text-xs font-semibold text-purple-600 bg-purple-100 px-3 py-1 rounded-full">
              {currentSubject}
            </div>
          </div>

          <h2 className="text-lg font-bold text-gray-800 mb-5 text-center leading-snug">
            {currentQuestion.question}
          </h2>

          <div className="grid grid-cols-1 gap-3 mb-4">
            {currentQuestion.options.map((option, index) => {
              let buttonClass = "p-3 rounded-xl font-semibold text-left transition-all transform active:scale-95 text-sm ";
              
              if (lastResult) {
                if (index === lastResult.correctAnswer) {
                  buttonClass += "bg-green-500 text-white";
                } else if (index === selectedAnswer) {
                  buttonClass += "bg-red-500 text-white";
                } else {
                  buttonClass += "bg-gray-200 text-gray-600";
                }
              } else if (selectedAnswer === index) {
                buttonClass += "bg-purple-500 text-white";
              } else {
                buttonClass += "bg-gray-100 hover:bg-purple-100 text-gray-800";
              }

              return (
                <button
                  key={index}
                  onClick={() => handleSubmitAnswer(index)}
                  disabled={selectedAnswer !== null}
                  className={buttonClass}
                >
                  {String.fromCharCode(65 + index)}. {option}
                </button>
              );
            })}
          </div>

          {lastResult && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-3 mb-3">
              <h3 className="font-bold text-blue-800 mb-2 text-sm">Results:</h3>
              {lastResult.players.map((player: any) => (
                <div key={player.id} className="flex justify-between items-center py-1 text-xs">
                  <span className={player.correct ? 'text-green-600 font-semibold' : 'text-red-600'}>
                    {player.username}: {player.correct ? '✓ Correct' : '✗ Wrong'}
                  </span>
                  <span className="font-bold">Score: {player.score}</span>
                </div>
              ))}
            </div>
          )}

          {selectedAnswer !== null && !opponentAnswered && (
            <p className="text-center text-gray-600 animate-pulse text-sm">
              Waiting for opponent to answer...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (gameState === 'round-result') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
          <div className="text-5xl mb-3">{roundWinner ? '🏆' : '🤝'}</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">
            Round Complete!
          </h2>
          {roundWinner ? (
            <p className="text-base text-gray-600 mb-4">
              <span className="font-bold text-purple-600">{roundWinner}</span> wins this round!
            </p>
          ) : (
            <p className="text-base text-gray-600 mb-4">It&apos;s a tie!</p>
          )}
          
          <div className="bg-gray-100 rounded-xl p-4 mb-4">
            <h3 className="font-bold text-gray-700 mb-2 text-sm">Scores:</h3>
            {scores.map((score) => (
              <div key={score.playerId} className="flex justify-between items-center py-1">
                <span className="font-semibold text-sm">{score.username}</span>
                <span className="text-purple-600 font-bold text-sm">{score.score} points</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            Next round: <span className="font-bold">{nextRoundOwner}</span> picks the subject
          </p>
          <p className="text-xs text-gray-400 mt-2 animate-pulse">Starting next round...</p>
        </div>
      </div>
    );
  }

  if (gameState === 'game-over') {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 to-indigo-700">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Game Over!</h2>
          <p className="text-xl text-purple-600 font-bold mb-5">
            {gameWinner} wins!
          </p>
          
          <div className="bg-gray-100 rounded-xl p-4 mb-5">
            <h3 className="font-bold text-gray-700 mb-2 text-sm">Final Scores:</h3>
            {scores.map((score) => (
              <div key={score.playerId} className="flex justify-between items-center py-1">
                <span className="font-semibold text-sm">{score.username}</span>
                <span className="text-purple-600 font-bold text-sm">{score.score} points</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              resetGame();
              setGameState('idle');
            }}
            className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold py-4 px-6 rounded-xl hover:from-purple-600 hover:to-indigo-700 transition-all transform active:scale-95 shadow-lg"
          >
            🎮 Play Again
          </button>
        </div>
      </div>
    );
  }

  return null;
}

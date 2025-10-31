// Global types for the Farcaster Quiz app

export interface Question {
  id: string;
  subject: string;
  question: string;
  options: string[];
  correctAnswer: number; // Index of correct option (0-3)
}

export interface Player {
  id: string;
  socketId: string;
  username: string;
  pfpUrl?: string; // Farcaster profile picture
  fid?: number; // Farcaster ID
  score: number;
  ready: boolean;
}

export interface GameRoom {
  id: string;
  players: [Player, Player];
  currentRound: number;
  totalRounds: number;
  roundOwnerIndex: number; // 0 or 1 - which player picks subject
  currentSubject: string | null;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Map<string, number>; // playerId -> answerIndex
  state: 'waiting' | 'subject-selection' | 'question' | 'round-complete' | 'game-over';
}

export interface MatchmakingQueue {
  playerId: string;
  socketId: string;
  username: string;
  pfpUrl?: string;
  fid?: number;
  timestamp: number;
}

// Socket.IO event types
export interface ServerToClientEvents {
  'match-found': (data: { roomId: string; opponent: { id: string; username: string; pfpUrl?: string; fid?: number }; yourTurn: boolean }) => void;
  'subject-selection-required': (data: { subjects: string[] }) => void;
  'subject-selected': (data: { subject: string }) => void;
  'question': (data: { question: Question; questionNumber: number; totalQuestions: number }) => void;
  'answer-submitted': (data: { playerId: string }) => void;
  'question-result': (data: { correctAnswer: number; players: { id: string; username: string; correct: boolean; score: number }[] }) => void;
  'round-complete': (data: { winner: string | null; scores: { playerId: string; username: string; score: number }[]; nextRoundOwner: string }) => void;
  'game-over': (data: { winner: string; finalScores: { playerId: string; username: string; score: number }[] }) => void;
  'opponent-disconnected': () => void;
  'error': (data: { message: string }) => void;
}

export interface ClientToServerEvents {
  'find-match': (data: { username: string; pfpUrl?: string; fid?: number }) => void;
  'select-subject': (data: { roomId: string; subject: string }) => void;
  'submit-answer': (data: { roomId: string; questionId: string; answerIndex: number }) => void;
  'ready-next-round': (data: { roomId: string }) => void;
}

// Score formatting utilities

export function formatScore(score: number): string {
  if (score >= 1_000_000) {
    return `${(score / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (score >= 1_000) {
    return `${(score / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return score.toString();
}

export function calculateWinScore(correctAnswers: number, timeBonus: number = 0): number {
  // Base score per correct answer
  const baseScore = correctAnswers * 1000;
  return baseScore + timeBonus;
}

export function getRankEmoji(rank: number): string {
  switch (rank) {
    case 1:
      return '🥇';
    case 2:
      return '🥈';
    case 3:
      return '🥉';
    default:
      return `#${rank}`;
  }
}

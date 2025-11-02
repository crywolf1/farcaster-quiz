const fs = require('fs');

// Read the file
let content = fs.readFileSync('app/page.tsx', 'utf8');

// Define all replacements
const replacements = [
  // Remove all emojis
  [/🎯\s*/g, ''],
  [/🎉\s*/g, ''],
  [/⚡\s*/g, 'VS'],
  [/✓\s*/g, ''],
  [/⏰\s*/g, ''],
  [/🔍\s*/g, ''],
  [/💪\s*/g, ''],
  [/🤝\s*/g, ''],
  [/🌟\s*/g, ''],
  [/🏆\s*/g, ''],
  [/🎮\s*/g, ''],
  [/📚\s*/g, ''],
  [/🚀\s*/g, ''],
  [/👤/g, ''],
  [/✅/g, '✓'],
  [/❌/g, '✗'],
  
  // Replace colored backgrounds with dark theme
  ['backdrop-blur-3xl bg-white/10 border-2 border-white/30', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-3xl bg-white/15 border-2 border-white/30', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-3xl bg-black/40 border-2 border-white/20', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-2xl bg-white/20 border-2 border-white/40', 'bg-gray-800 border-2 border-gray-700'],
  ['backdrop-blur-2xl bg-white/10 border-2 border-white/20', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-3xl bg-white/20', 'bg-gray-800'],
  ['backdrop-blur-2xl bg-white/5 border-2 border-white/20', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-3xl bg-black/30 border-2 border-white/20', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-xl bg-white/40 border border-white/20', 'bg-gray-800 border border-gray-700'],
  ['backdrop-blur-lg bg-white/50 border-2 border-white/40', 'bg-gray-800 border-2 border-gray-700'],
  ['backdrop-blur-lg bg-white/30 border-2 border-white/20', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-lg bg-white/20 border-2 border-white/20', 'bg-gray-900 border-2 border-gray-800'],
  ['backdrop-blur-xl bg-white/20', 'bg-gray-800'],
  ['backdrop-blur-xl bg-white/50', 'bg-gray-800'],
  
  // Replace gradient backgrounds
  ['bg-gradient-to-r from-green-400 to-emerald-500 text-white border-green-300', 'bg-white text-black border-white'],
  ['bg-gradient-to-r from-green-400 via-emerald-400 to-emerald-500 text-white border-4 border-green-300', 'bg-white text-black border-4 border-white'],
  ['bg-gradient-to-r from-red-400 to-rose-500 text-white border-2 border-red-300', 'bg-gray-900 text-white border-2 border-gray-700'],
  ['bg-gradient-to-r from-red-400 via-rose-400 to-rose-500 text-white border-4 border-red-300', 'bg-gray-900 text-white border-4 border-gray-700'],
  ['bg-gradient-to-r from-indigo-500 to-purple-500', 'bg-gray-700'],
  ['bg-gradient-to-r from-purple-500/40 via-pink-500/40 to-purple-500/40 border-4 border-white/50', 'bg-white border-4 border-white'],
  
  // Replace red colors (cancel/leave buttons) with dark gray
  ['backdrop-blur-2xl bg-red-500/20 text-white px-8 py-3 rounded-[24px] text-sm font-semibold shadow-xl hover:bg-red-500/30 border-2 border-red-400/40', 'bg-gray-800 text-white px-8 py-3 rounded-[24px] text-sm font-semibold shadow-xl hover:bg-gray-700 border-2 border-gray-700'],
  ['backdrop-blur-xl bg-red-500/20 text-white px-3 py-2 rounded-[16px] text-xs font-semibold shadow-lg hover:bg-red-500/30 border border-red-400/40', 'bg-gray-800 text-white px-3 py-2 rounded-[16px] text-xs font-semibold shadow-lg hover:bg-gray-700 border border-gray-700'],
  
  // Replace timer colors
  ['border-red-400 bg-red-500/30 animate-pulse', 'border-gray-700 bg-gray-800 animate-pulse'],
  ['border-red-400 bg-red-500/20 animate-pulse', 'border-gray-700 bg-gray-800 animate-pulse'],
  ['border-red-500 bg-red-500/30 animate-pulse', 'border-gray-700 bg-gray-800 animate-pulse'],
  ["timeRemaining <= 5 ? 'text-red-100' : 'text-white'", "'text-white'"],
  ["timeRemaining <= 5 ? 'text-red-600' : 'text-white'", "'text-white'"],
  ["timeRemaining <= 5 ? 'text-red-300' : 'text-white'", "'text-white'"],
  ['border-indigo-400/50 bg-white/50', 'border-gray-700 bg-gray-800'],
  ['border-white/60 bg-white/20', 'border-gray-700 bg-gray-800'],
  ['border-white/50 bg-black/30', 'border-gray-700 bg-gray-800'],
  
  // Replace ring colors
  ['ring-4 ring-white/40', 'ring-4 ring-gray-700'],
  ['ring-2 ring-white/40', 'ring-2 ring-gray-700'],
  
  // Replace border colors
  ['border-4 border-white/70', 'border-4 border-gray-700'],
  ['border-2 border-white/70', 'border-2 border-gray-700'],
  ['border-white/30', 'border-gray-800'],
  ['border-white/20', 'border-gray-800'],
  ['border-white/40', 'border-gray-700'],
  ['border-2 border-white/20', 'border-2 border-gray-800'],
  
  // Replace green colors (correct answers, ready status)
  ['bg-green-500', 'bg-white'],
  ['text-green-400', 'text-white'],
  ['text-green-300', 'text-gray-300'],
  ['border-green-400', 'border-white'],
  
  // Replace shadow effects
  ['shadow-[0_0_40px_rgba(16,185,129,0.6)]', 'shadow-2xl'],
  ['shadow-[0_0_30px_rgba(16,185,129,0.5)]', 'shadow-xl'],
  ['shadow-[0_0_60px_rgba(16,185,129,0.8),0_0_100px_rgba(16,185,129,0.4)]', 'shadow-2xl'],
  ['shadow-[0_0_30px_rgba(239,68,68,0.5)]', 'shadow-xl'],
  ['shadow-[0_0_60px_rgba(239,68,68,0.8),0_0_100px_rgba(239,68,68,0.4)]', 'shadow-2xl'],
  ['shadow-[0_20px_50px_rgba(255,255,255,0.3)]', 'shadow-2xl'],
  ['hover:shadow-[0_20px_50px_rgba(255,255,255,0.3)]', 'hover:shadow-2xl'],
  
  // Replace hover colors for buttons
  ['hover:bg-white/30', 'hover:bg-gray-700'],
  ['hover:bg-white/20', 'hover:bg-gray-700'],
  ['hover:bg-white/70', 'hover:bg-gray-700'],
  
  // Replace text transparency
  ['text-white/90', 'text-gray-300'],
  ['text-white/80', 'text-gray-400'],
  ['text-white/70', 'text-gray-500'],
  ['text-white/50', 'text-gray-600'],
  
  // Replace bg transparency
  ['bg-white/50', 'bg-gray-800'],
  ['bg-white/10', 'bg-gray-900'],
  ['bg-white/20', 'bg-gray-800'],
  ['bg-white/10 flex', 'bg-gray-900 flex'],
  ['bg-white/5', 'bg-gray-900'],
];

// Apply all replacements
replacements.forEach(([search, replace]) => {
  const searchStr = typeof search === 'string' ? search : search.source;
  const regex = typeof search === 'string' ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : search;
  content = content.replace(regex, replace);
});

// Write the transformed content
fs.writeFileSync('app/page.tsx', content, 'utf8');

console.log('✓ Theme transformation complete!');

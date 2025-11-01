# Glassmorphism Theme Update - Quick Reference

## ✅ Already Updated
- renderLoading() - New glassy loading spinner
- renderIdle() - Beautiful glass card with gradient text
- renderSearching() - Glassy searching state
- globals.css - New background gradient and glass utilities

## 🎨 Universal Class Patterns

### Background (Apply to all min-h-screen divs)
```
className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50"
```

### Main Content Cards
```
className="backdrop-blur-xl bg-white/40 border border-white/20 rounded-[40px] shadow-2xl"
```

### Headers/Top Bars
```
className="backdrop-blur-xl bg-white/30 border border-white/20 rounded-[32px]"
```

### Buttons (Primary)
```
className="backdrop-blur-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-[28px] shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all border border-white/20"
```

### Buttons (Secondary/Answer Options)
```
className="backdrop-blur-lg bg-white/50 border-2 border-white/40 rounded-[24px] shadow-lg hover:bg-white/70 hover:scale-[1.02] transition-all"
```

### Text Colors
- Primary headings: `text-gray-800` or `bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent`
- Secondary text: `text-gray-700`
- Muted text: `text-gray-600`

### Avatar/Profile Images
```
className="rounded-full border-4 border-white/60 shadow-xl ring-4 ring-white/30"
```

### Timer Display
```
className="backdrop-blur-xl bg-white/50 border-2 border-indigo-400/50 rounded-full shadow-xl"
```

### Score/Stats Cards
```
className="backdrop-blur-lg bg-white/50 border border-white/30 rounded-[28px] shadow-lg"
```

## 🔄 Screens Still Need Updates
1. renderMatched() - Match found screen
2. renderSubjectSelection() - Subject picker
3. renderWaitingSubject() - Waiting for subject
4. renderPlaying() - Main game screen
5. renderRoundResult() - Round results
6. renderGameOver() - Final results

## 📝 Quick Find & Replace Patterns

OLD → NEW:
- `from-purple-600 via-pink-500 to-red-500` → `from-blue-50 via-indigo-50 to-purple-50`
- `bg-white/10 backdrop-blur-lg` → `backdrop-blur-xl bg-white/40 border border-white/20`
- `text-white` (on colored backgrounds) → `text-gray-800`
- `bg-white text-purple-600` (buttons) → `backdrop-blur-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white border border-white/20`
- `rounded-3xl` → `rounded-[40px]`
- `rounded-2xl` → `rounded-[32px]`
- `rounded-full` (buttons) → `rounded-[28px]`

Would you like me to update all remaining screens now?

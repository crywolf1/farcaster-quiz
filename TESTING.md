# Testing the Vercel-only Quiz App

## ✅ What Changed
- **Removed Socket.IO** completely
- **All backend is now Vercel API Routes** (serverless functions)
- **Polling-based** real-time updates (1 second intervals)
- **Single deployment** to Vercel only

## 🧪 Local Testing Steps

### 1. Open Two Browser Tabs
Open: http://localhost:3000 in **2 separate tabs**

### 2. Test Matchmaking
1. **Tab 1**: Click "Find Match" → Should show "Finding opponent..."
2. **Tab 2**: Click "Find Match" → Both should match!
3. **Both tabs**: Should show "Match Found!" with both player names

### 3. Test Subject Selection
1. **First tab** (Player 1's turn): Should see subject buttons
2. **Click any subject** (e.g., "Science")
3. **Second tab**: Should automatically show first question

### 4. Test Questions
1. **Both tabs**: Answer the same question
2. After both answer, should see:
   - ✅ Green = Correct answer
   - ❌ Red = Your wrong answer
   - Scores update
3. **Repeat** for all 5 questions

### 5. Test Round Results
1. After 5 questions, should see "Round Complete!"
2. Shows who won the round
3. **Click "Next Round"**
4. **Second player's turn** to pick subject

### 6. Test Full Game
1. Play all 3 rounds
2. After round 3, should see "Game Over!"
3. Shows final winner
4. Click "Play Again" to restart

## 🔍 What to Check

### ✅ Matchmaking Works
- [ ] Two tabs can find each other
- [ ] Shows opponent name and profile pic
- [ ] Transitions to subject selection

### ✅ Subject Selection Works
- [ ] Right player sees subject buttons
- [ ] Other player sees "waiting" message
- [ ] After selection, both see questions

### ✅ Questions Work
- [ ] Both players see same question
- [ ] Can click answer (button highlights)
- [ ] After both answer, shows correct answer
- [ ] Scores update correctly

### ✅ Rounds Work
- [ ] Completes after 5 questions
- [ ] Shows round winner
- [ ] Next round switches who picks subject
- [ ] Scores carry over

### ✅ Game End Works
- [ ] After 3 rounds, shows "Game Over"
- [ ] Shows correct final winner
- [ ] "Play Again" resets everything

## 🐛 Expected Behaviors

### Polling (Not Real-Time)
- **1 second delay** for updates is normal
- Not instant like Socket.IO, but works fine

### Page Refresh
- If you refresh, matchmaking state is lost
- This is normal for in-memory storage
- Production can use Redis if needed

### Concurrent Matches
- Multiple pairs can play simultaneously
- Each game is isolated

## 🚀 Deploy to Vercel

Once testing passes locally:

```powershell
# Commit changes
git add .
git commit -m "Converted to Vercel serverless (no Socket.IO)"
git push origin main

# Deploy to Vercel
1. Go to vercel.com
2. Import crywolf1/farcaster-quiz
3. Deploy!
```

**No environment variables needed!** Everything runs on Vercel.

## 🎯 Advantages

✅ **No credit card** needed
✅ **Single platform** (only Vercel)
✅ **No cold starts** (serverless = instant)
✅ **Free forever** (Vercel hobby plan)
✅ **No separate backend** to manage
✅ **Auto-scales** with traffic

## 📊 Testing Checklist

- [ ] Dev server starts without errors
- [ ] Page loads at localhost:3000
- [ ] Two tabs can match
- [ ] Subject selection works
- [ ] Questions display correctly
- [ ] Answers submit and show results
- [ ] Scores update properly
- [ ] Round transitions work
- [ ] Game ends after 3 rounds
- [ ] Play Again resets everything

---

**Next Steps**: Test locally, then deploy to Vercel! 🚀

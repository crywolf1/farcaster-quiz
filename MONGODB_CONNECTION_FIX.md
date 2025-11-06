# MongoDB Connection Issue - Fixed ✅

## Problem
You received an alert from MongoDB Atlas that your M0 free tier cluster is nearing the 500 connection limit. This was causing:
- Slow loading times
- Stuck loading indicators (spinning dots)
- Data not loading properly

## Root Cause
The M0 free tier has a **maximum of 500 concurrent connections**. Without proper connection pooling and timeouts, your app was:
1. Creating too many connections and not closing them
2. Keeping idle connections open indefinitely
3. Not timing out hanging requests

## What I Fixed

### 1. **Connection Pooling** (lib/mongodb.ts)
```typescript
// Added strict connection limits
maxPoolSize: 10,        // Max 10 connections per serverless instance
minPoolSize: 2,         // Keep 2 connections ready
maxIdleTimeMS: 30000,   // Close idle connections after 30 seconds
```

### 2. **Request Timeouts** (app/page.tsx)
```typescript
// Added 10-second timeout to all leaderboard API calls
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);
```

### 3. **Error Handling**
- Added try-catch blocks to MongoDB operations
- Set empty leaderboard on error to stop infinite loading
- Prevent connection leaks on failures

## Current Status
✅ Connections will now close properly after 30 seconds of being idle
✅ Maximum 10 connections per instance (well under the 500 limit)
✅ Requests timeout after 10 seconds (no more hanging)
✅ Loading indicators will stop even if API fails

## Monitoring
Check your MongoDB Atlas dashboard:
1. Go to: https://cloud.mongodb.com
2. Select your project
3. Click on "Metrics" for Cluster0
4. Watch "Connections" graph

**Healthy numbers:**
- Should stay under 50 connections normally
- Spikes during high traffic are OK (up to 100-200)
- Should drop back down when traffic reduces

## If Problem Persists

### Option 1: Add Indexes (Recommended - FREE)
Speed up queries by adding indexes:
```javascript
// In MongoDB Atlas > Collections > Indexes
db.leaderboard.createIndex({ points: -1 })
db.leaderboard.createIndex({ fid: 1 })
```

### Option 2: Restart Your App
If you see connections stuck:
```bash
# Stop all running instances
vercel --prod
```

### Option 3: Upgrade MongoDB (Costs Money)
If you get many concurrent users, consider:
- **M10 Tier**: $0.08/hour (~$57/month) - 1500 connections
- **M20 Tier**: $0.20/hour (~$144/month) - 3000 connections

### Option 4: Alternative Free Databases
If M0 isn't enough:
- **Supabase** (Free tier: PostgreSQL with 500MB, unlimited API requests)
- **PlanetScale** (Free tier: 1 billion row reads/month)
- **CockroachDB** (Free tier: 5GB storage, unlimited connections)

## Loading Dots Issue
The "dots keep moving" during page load is normal and should be quick now:
1. Fetching your Farcaster profile
2. Connecting to Socket.IO server
3. Fetching leaderboard data

**Normal loading time:** 1-3 seconds
**If longer than 10 seconds:** The timeout will now stop it

## Need Help?
If you still see issues:
1. Check MongoDB Atlas metrics dashboard
2. Look at Vercel logs: `vercel logs --prod`
3. Test locally: `npm run dev` (uses same MongoDB)

## Deployed
Changes are live at: https://quiz-5onvrnkhd-crywolf1s-projects.vercel.app

# Deploying Farcaster Quiz (Free Hosting)

## Overview
This guide helps you deploy the Farcaster Quiz app for free testing before buying hosting.

## Architecture
- **Frontend (Next.js)**: Deploy to **Vercel** (Free)
- **Backend (Socket.IO)**: Deploy to **Railway** or **Render** (Free)

---

## 🚀 Step 1: Deploy Backend (Socket.IO Server)

### Option A: Railway (Recommended)

1. **Create Railway Account**: https://railway.app (Sign in with GitHub)

2. **Create New Project**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub account and select your Quiz repo

3. **Configure Railway**:
   - Railway will auto-detect Node.js
   - Add these settings in Railway dashboard:
   
   **Environment Variables**:
   ```
   PORT=3001
   NODE_ENV=production
   ```

   **Start Command** (in Railway settings):
   ```
   npm install && npm run start:server
   ```

4. **Get Your Backend URL**:
   - Railway will provide a URL like: `https://your-app.railway.app`
   - Copy this URL (you'll need it for frontend)

5. **Alternative: Create railway.json** (optional):
   ```json
   {
     "$schema": "https://railway.app/railway.schema.json",
     "build": {
       "builder": "NIXPACKS"
     },
     "deploy": {
       "startCommand": "node server/index.ts",
       "restartPolicyType": "ON_FAILURE",
       "restartPolicyMaxRetries": 10
     }
   }
   ```

### Option B: Render (Alternative)

1. **Create Render Account**: https://render.com (Sign in with GitHub)

2. **Create New Web Service**:
   - Click "New +"
   - Select "Web Service"
   - Connect your GitHub repo

3. **Configure Render**:
   - **Name**: `farcaster-quiz-server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start:server`
   - **Plan**: Free

4. **Get Your Backend URL**:
   - Render provides: `https://farcaster-quiz-server.onrender.com`

---

## 🌐 Step 2: Deploy Frontend (Next.js)

### Vercel (Recommended)

1. **Create Vercel Account**: https://vercel.com (Sign in with GitHub)

2. **Import Project**:
   - Click "Add New..." → "Project"
   - Import your Quiz GitHub repo
   - Vercel auto-detects Next.js

3. **Configure Environment Variables**:
   - In Vercel dashboard, go to Settings → Environment Variables
   - Add:
   ```
   NEXT_PUBLIC_SOCKET_URL=https://your-railway-app.railway.app
   ```
   (Use your Railway/Render backend URL from Step 1)

4. **Deploy**:
   - Click "Deploy"
   - Vercel builds and deploys automatically
   - Get your URL: `https://your-app.vercel.app`

---

## 🔧 Step 3: Update Your Code

### 1. Create `.env.local` for local development:

```bash
# .env.local (for local dev)
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### 2. Update `app/page.tsx` to use environment variable:

Change this line:
```typescript
const socketInstance = io('http://localhost:3001');
```

To:
```typescript
const socketInstance = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001');
```

### 3. Update `server/index.ts` CORS settings:

Change:
```typescript
cors: {
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000'],
  methods: ['GET', 'POST']
}
```

To:
```typescript
cors: {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL || 'https://your-app.vercel.app'] 
    : ['http://localhost:3000'],
  methods: ['GET', 'POST']
}
```

---

## 📦 Step 4: Prepare for Deployment

### Update `package.json` build commands:

The current scripts are good, but ensure you have:

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:next\" \"npm run dev:server\"",
    "dev:next": "next dev",
    "dev:server": "tsx watch server/index.ts",
    "build": "next build",
    "build:server": "tsc server/index.ts --outDir dist",
    "start": "next start",
    "start:server": "tsx server/index.ts"
  }
}
```

---

## 🎯 Step 5: Setup Farcaster Frame

### 1. Create Frame Metadata

Add to `app/layout.tsx`:

```typescript
export const metadata: Metadata = {
  title: "Farcaster Quiz",
  description: "Real-time multiplayer quiz game",
  other: {
    'fc:frame': 'vNext',
    'fc:frame:image': 'https://your-app.vercel.app/og-image.png',
    'fc:frame:button:1': 'Play Quiz',
    'fc:frame:button:1:action': 'link',
    'fc:frame:button:1:target': 'https://your-app.vercel.app',
  }
};
```

### 2. Test Your Frame

- Go to https://warpcast.com/~/developers/frames
- Enter your Vercel URL
- Click "Validate Frame"
- Share in a cast to test!

---

## ✅ Quick Deployment Checklist

- [ ] Push code to GitHub
- [ ] Deploy backend to Railway/Render
- [ ] Get backend URL
- [ ] Deploy frontend to Vercel
- [ ] Add `NEXT_PUBLIC_SOCKET_URL` env variable in Vercel
- [ ] Add `FRONTEND_URL` env variable in Railway/Render
- [ ] Test the app at your Vercel URL
- [ ] Create Farcaster Frame and test in Warpcast

---

## 🆓 Free Tier Limits

### Vercel (Frontend)
- ✅ 100GB bandwidth/month
- ✅ Unlimited projects
- ✅ Custom domains
- ✅ Automatic HTTPS

### Railway (Backend)
- ✅ $5 free credit/month
- ✅ ~500 hours of uptime
- ⚠️ Sleeps after inactivity (wakes on request)

### Render (Backend Alternative)
- ✅ 750 hours/month free
- ⚠️ Sleeps after 15 min inactivity
- ⚠️ Cold starts (~30 sec wake-up)

---

## 🔄 Auto-Deployment

Both Vercel and Railway/Render support **automatic deployments**:
- Push to GitHub → Automatic deployment
- No manual steps needed after initial setup

---

## 📱 Testing in Farcaster

1. Deploy both frontend and backend
2. Open your Vercel URL on mobile
3. Share the link in a Warpcast cast
4. Test with another Farcaster user!

---

## 💰 When Ready for Production

Consider upgrading to:
- **DigitalOcean App Platform** ($5-12/month)
- **AWS Lightsail** ($3.50-10/month)
- **Railway Pro** ($5/month)
- **Render Pro** ($7/month)

These provide:
- No sleep/cold starts
- More bandwidth
- Better performance
- Custom domains included

# Quick Deployment Guide

## 🚀 Deploy in 5 Minutes

### Prerequisites
- GitHub account
- Push this code to GitHub repository

---

## Step 1: Deploy Backend (Choose One)

### Option A: Render (100% Free - No Credits!)

```bash
# 1. Go to: https://render.com
# 2. Sign in with GitHub (no credit card needed!)
# 3. New + → Web Service
# 4. Connect your repo
# 5. Name: farcaster-quiz-server
# 6. Start Command: npm run start:server
# 7. Plan: FREE
# 8. Deploy!
# 9. Copy your Render URL (e.g., https://farcaster-quiz-server.onrender.com)
```

**Set Environment Variables in Render:**
- `PORT` = `3001`
- `NODE_ENV` = `production`
- `FRONTEND_URL` = (will add after Vercel deploy)

**✅ 750 hours/month FREE - No credit card required!**

### Option B: Fly.io (Alternative Free)

```bash
# 1. Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
# 2. Sign up: fly auth signup
# 3. Deploy: fly launch
# 4. Copy your Fly.io URL
```

**✅ 3 free VMs - Better performance than Render**

---

## Step 2: Deploy Frontend

### Vercel (Recommended)

```bash
# 1. Go to: https://vercel.com
# 2. Sign in with GitHub
# 3. Import your Quiz repo
# 4. Vercel auto-detects Next.js
# 5. Add Environment Variable:
#    NEXT_PUBLIC_SOCKET_URL = https://your-railway-url.railway.app
# 6. Deploy!
```

---

## Step 3: Update Backend URL

Go back to Railway/Render and add:
- `FRONTEND_URL` = `https://your-app.vercel.app`

Redeploy backend (Railway/Render will auto-redeploy on change)

---

## Step 4: Test Your App

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Open on mobile or use Chrome DevTools mobile view
3. Test matchmaking with two browser windows

---

## Step 5: Test in Farcaster

1. Go to Warpcast (https://warpcast.com)
2. Create a cast with your Vercel URL
3. Test the mini app!

---

## 🎯 Alternative Free Options

### If Render Doesn't Work:

1. **Koyeb** - https://koyeb.com (free tier)
2. **Cyclic** - https://cyclic.sh (free tier)  
3. **Adaptable** - https://adaptable.io (free tier)

### Keep Backend Awake (Optional):

Use **UptimeRobot** (free) to ping your backend every 5 minutes:
- https://uptimerobot.com
- Prevents cold starts during testing!

---

## 📊 Monitor Your Deployments

### Vercel Dashboard
- View deployments: https://vercel.com/dashboard
- Check logs and analytics
- Configure domains

### Railway Dashboard
- View deployments: https://railway.app/dashboard
- Check logs and metrics
- Monitor usage

---

## 🆓 Free Tier Status

### Current Usage (Estimated for Testing):
- **Vercel**: ~1-5GB bandwidth for testing
- **Railway**: ~$0.50-1/month credit usage
- **Both should last 1-2 months of testing for free!**

---

## ⚠️ Important Notes

1. **Cold Starts**: Free tier backends sleep after inactivity
   - First request may take 30-60 seconds to wake
   - After wake-up, works normally

2. **Environment Variables**: Must set both:
   - `NEXT_PUBLIC_SOCKET_URL` in Vercel
   - `FRONTEND_URL` in Railway/Render

3. **CORS**: Already configured to work with your deployed URLs

4. **Auto-Deploy**: Both platforms auto-deploy when you push to GitHub

---

## 🔧 Troubleshooting

**Can't connect to Socket.IO?**
- Check `NEXT_PUBLIC_SOCKET_URL` is correct in Vercel
- Check `FRONTEND_URL` is correct in Railway/Render
- Wait 30-60 seconds for backend to wake from sleep

**Farcaster Frame not working?**
- Ensure HTTPS (both Vercel and Railway provide this)
- Validate frame at: https://warpcast.com/~/developers/frames

**Build failed?**
- Check logs in dashboard
- Ensure all dependencies are in package.json
- Run `npm install` locally to verify

---

## 🎉 You're Done!

Your Farcaster Quiz is now deployed and ready for testing!

Share your Vercel URL in Farcaster and start playing! 🎮

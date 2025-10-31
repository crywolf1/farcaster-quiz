# PowerShell Script to Push to GitHub and Deploy
# Run this in PowerShell

Write-Host "🚀 Farcaster Quiz - GitHub Setup & Deploy Helper" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is initialized
if (-not (Test-Path .git)) {
    Write-Host "📦 Initializing Git repository..." -ForegroundColor Yellow
    git init
    Write-Host "✅ Git initialized" -ForegroundColor Green
} else {
    Write-Host "✅ Git already initialized" -ForegroundColor Green
}

Write-Host ""
Write-Host "📝 Creating .gitignore if needed..." -ForegroundColor Yellow

# Stage all files
Write-Host ""
Write-Host "📦 Adding files to Git..." -ForegroundColor Yellow
git add .

# Commit
Write-Host ""
Write-Host "💾 Creating commit..." -ForegroundColor Yellow
git commit -m "Initial commit: Farcaster Quiz Mini App with mobile UI and SDK integration"

Write-Host ""
Write-Host "✅ Local Git setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "📤 NEXT STEPS:" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1️⃣  Create a new repository on GitHub:" -ForegroundColor White
Write-Host "   👉 https://github.com/new" -ForegroundColor Cyan
Write-Host ""
Write-Host "2️⃣  Copy the repository URL (e.g., https://github.com/username/farcaster-quiz)" -ForegroundColor White
Write-Host ""
Write-Host "3️⃣  Run these commands (replace with YOUR GitHub URL):" -ForegroundColor White
Write-Host ""
Write-Host "   git remote add origin https://github.com/YOUR_USERNAME/farcaster-quiz.git" -ForegroundColor Cyan
Write-Host "   git branch -M main" -ForegroundColor Cyan
Write-Host "   git push -u origin main" -ForegroundColor Cyan
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "🚀 DEPLOY TO FREE HOSTING:" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend (Socket.IO Server):" -ForegroundColor White
Write-Host "  • Railway: https://railway.app" -ForegroundColor Cyan
Write-Host "  • Render:  https://render.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "Frontend (Next.js):" -ForegroundColor White
Write-Host "  • Vercel:  https://vercel.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "📖 See QUICK_DEPLOY.md for detailed instructions!" -ForegroundColor Green
Write-Host ""

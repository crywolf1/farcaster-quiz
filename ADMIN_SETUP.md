# Admin Access Setup

## How to Set Your Admin Farcaster ID

To secure the admin dashboard, you need to set your Farcaster ID (FID) in two files:

### 1. Frontend: `app/admin/page.tsx`

Find line 8 and replace `123456` with your actual Farcaster ID:

```typescript
// ADMIN FID - Replace this with your actual Farcaster ID
const ADMIN_FID = 123456; // TODO: Replace with your FID
```

### 2. Backend: `app/api/admin/questions/route.ts`

Find line 8 and replace `123456` with your actual Farcaster ID:

```typescript
// ADMIN FID - Replace this with your actual Farcaster ID
const ADMIN_FID = 123456; // TODO: Replace with your FID
```

## How to Find Your Farcaster ID

1. Open the app and go to the home page
2. Your FID will be displayed when you try to access the admin page at `/admin`
3. Copy that number and replace `123456` in both files mentioned above

## Security Features

- ✅ Frontend check: Verifies FID on page load
- ✅ Backend check: API validates FID on every request
- ✅ Access denied page: Shows beautiful error for unauthorized users
- ✅ User FID display: Shows the user's FID on access denied page

## After Setup

1. Replace the FID in both files
2. Commit and push the changes
3. Only you will be able to access `/admin` and review questions!

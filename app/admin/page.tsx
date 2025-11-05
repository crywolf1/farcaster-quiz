'use client';

import { useState, useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import type { PendingQuestion } from '@/lib/mongodb';

// ADMIN FID - Replace this with your actual Farcaster ID
const ADMIN_FID = 344203;
const ADMIN_PASSWORD = 'Maryam8935@';

export default function AdminDashboard() {
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [userFid, setUserFid] = useState<number | null>(null);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Check if there's a saved admin session
      const savedFid = localStorage.getItem('admin_fid');
      if (savedFid && parseInt(savedFid) === ADMIN_FID) {
        setUserFid(ADMIN_FID);
        setIsAuthenticated(true);
        setIsChecking(false);
        return;
      }

      // Try to use Farcaster SDK
      const context = await sdk.context;
      const user = context.user;
      
      setUserFid(user.fid);
      
      // Check if user's FID matches admin FID
      if (user.fid === ADMIN_FID) {
        setIsAuthenticated(true);
        localStorage.setItem('admin_fid', user.fid.toString());
      } else {
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Auth check failed (SDK not available):', error);
      // SDK not available (browser access), show password input
      setShowPasswordInput(true);
      setIsAuthenticated(false);
    }
    setIsChecking(false);
  };

  const handlePasswordSubmit = () => {
    // Check password
    if (passwordInput === ADMIN_PASSWORD) {
      setUserFid(ADMIN_FID);
      setIsAuthenticated(true);
      setShowPasswordInput(false);
      localStorage.setItem('admin_fid', ADMIN_FID.toString());
    } else {
      alert('Invalid password');
      setPasswordInput('');
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchQuestions();
    }
  }, [filter, isAuthenticated]);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/questions?status=${filter}`, {
        headers: {
          'x-admin-fid': userFid?.toString() || '',
        },
      });
      const data = await response.json();
      
      if (response.status === 403) {
        setIsAuthenticated(false);
        return;
      }
      
      setQuestions(data.questions || []);
    } catch (error) {
      console.error('Error fetching questions:', error);
    }
    setLoading(false);
  };

  const handleReview = async (questionId: string, action: 'approve' | 'reject') => {
    setProcessingId(questionId);
    try {
      const response = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-fid': userFid?.toString() || '',
        },
        body: JSON.stringify({ questionId, action }),
      });

      const data = await response.json();
      
      if (response.status === 403) {
        alert('Unauthorized access');
        setIsAuthenticated(false);
        return;
      }
      
      if (data.success) {
        alert(data.message);
        fetchQuestions(); // Refresh the list
      } else {
        alert('Error: ' + data.error);
      }
    } catch (error) {
      console.error('Error reviewing question:', error);
      alert('Failed to review question');
    }
    setProcessingId(null);
  };

  // Show loading while checking auth
  if (isChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-pink-900 flex items-center justify-center">
        <div className="backdrop-blur-2xl bg-gray-900/90 border-2 border-gray-700/50 rounded-[32px] p-12 shadow-2xl">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-300 text-lg">Verifying access...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show password input if accessing from browser
  if (showPasswordInput) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-pink-900 flex items-center justify-center p-6">
        <div className="backdrop-blur-2xl bg-gradient-to-br from-gray-900/95 via-emerald-900/30 to-teal-900/30 border-2 border-gray-700/50 rounded-[32px] p-12 shadow-2xl max-w-md w-full text-center">
          {/* Key Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border-2 border-emerald-500/50 flex items-center justify-center shadow-lg">
              <span className="text-6xl">🔑</span>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400 mb-4">
            Admin Access
          </h2>

          {/* Message */}
          <p className="text-gray-300 text-base mb-6">
            Enter your admin password to continue
          </p>

          {/* Password Input */}
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
            placeholder="Enter password"
            className="w-full px-4 py-3 rounded-[16px] bg-gray-800/80 border-2 border-gray-700 text-white font-semibold focus:border-emerald-500 focus:outline-none transition-all mb-4"
            autoFocus
          />

          {/* Submit Button */}
          <button
            onClick={handlePasswordSubmit}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white px-8 py-3 rounded-[20px] font-bold shadow-lg transition-all hover:scale-105 mb-3"
          >
            Access Dashboard
          </button>

          {/* Back Button */}
          <button
            onClick={() => window.location.href = '/'}
            className="w-full backdrop-blur-xl bg-gray-800/80 hover:bg-gray-700/80 border-2 border-gray-600/50 text-white px-8 py-3 rounded-[20px] font-bold shadow-lg transition-all hover:scale-105"
          >
            Go Back Home
          </button>
        </div>
      </div>
    );
  }

  // Show access denied if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-pink-900 flex items-center justify-center p-6">
        <div className="backdrop-blur-2xl bg-gradient-to-br from-gray-900/95 via-red-900/30 to-pink-900/30 border-2 border-red-700/50 rounded-[32px] p-12 shadow-2xl max-w-md w-full text-center">
          {/* Lock Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-red-500/20 to-pink-500/20 border-2 border-red-500/50 flex items-center justify-center shadow-lg">
              <span className="text-6xl">🔒</span>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-pink-400 mb-4">
            Access Denied
          </h2>

          {/* Message */}
          <p className="text-gray-300 text-lg mb-6">
            You don&apos;t have permission to access the admin dashboard.
          </p>

          {/* User Info */}
          {userFid && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-[16px] p-4 mb-6">
              <p className="text-gray-400 text-sm">Your Farcaster ID</p>
              <p className="text-white font-bold text-xl">{userFid}</p>
            </div>
          )}

          {/* Back Button */}
          <button
            onClick={() => window.location.href = '/'}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-8 py-3 rounded-[20px] font-bold shadow-lg transition-all hover:scale-105"
          >
            Go Back Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-pink-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="backdrop-blur-2xl bg-gray-900/90 border-2 border-gray-700/50 rounded-[32px] p-8 mb-6 shadow-2xl">
          <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
            📝 Question Review Dashboard
          </h1>
          <p className="text-gray-300 text-lg">Review and approve community-submitted questions</p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-4 mb-6">
          {(['pending', 'approved', 'rejected'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-6 py-3 rounded-[20px] font-bold text-sm transition-all ${
                filter === status
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg scale-105'
                  : 'backdrop-blur-xl bg-gray-800/80 text-gray-300 hover:bg-gray-700/80'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Questions List */}
        {loading ? (
          <div className="text-center text-white text-xl py-12">Loading...</div>
        ) : questions.length === 0 ? (
          <div className="backdrop-blur-2xl bg-gray-900/90 border-2 border-gray-700/50 rounded-[32px] p-12 text-center">
            <p className="text-gray-400 text-xl">No {filter} questions found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map((q) => (
              <div
                key={q._id?.toString()}
                className="backdrop-blur-2xl bg-gray-900/90 border-2 border-gray-700/50 rounded-[28px] p-6 shadow-xl hover:border-purple-500/50 transition-all"
              >
                {/* Question Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-1 rounded-full text-xs font-bold">
                        {q.subject}
                      </span>
                      <span className="text-gray-500 text-sm">
                        {new Date(q.submittedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="text-white font-bold text-lg mb-3">{q.question}</h3>
                  </div>
                  
                  {/* Submitter Info */}
                  <div className="flex items-center gap-2 ml-4">
                    {q.submittedBy.pfpUrl && (
                      <img
                        src={q.submittedBy.pfpUrl}
                        alt={q.submittedBy.username}
                        className="w-10 h-10 rounded-full border-2 border-purple-500"
                      />
                    )}
                    <div>
                      <p className="text-white text-sm font-semibold">{q.submittedBy.username}</p>
                      <p className="text-gray-500 text-xs">Submitter</p>
                    </div>
                  </div>
                </div>

                {/* Answers */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {q.answers.map((answer, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-[16px] border-2 ${
                        index === q.correctAnswer
                          ? 'bg-green-500/20 border-green-500 text-green-300'
                          : 'bg-gray-800/50 border-gray-700 text-gray-300'
                      }`}
                    >
                      <span className="font-semibold">
                        {index === q.correctAnswer && '✓ '}
                        {answer}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Action Buttons (only for pending) */}
                {filter === 'pending' && (
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => handleReview(q._id.toString(), 'reject')}
                      disabled={processingId === q._id?.toString()}
                      className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white px-6 py-2 rounded-[16px] font-bold text-sm shadow-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingId === q._id?.toString() ? 'Processing...' : '❌ Reject'}
                    </button>
                    <button
                      onClick={() => handleReview(q._id.toString(), 'approve')}
                      disabled={processingId === q._id?.toString()}
                      className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-6 py-2 rounded-[16px] font-bold text-sm shadow-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingId === q._id?.toString() ? 'Processing...' : '✓ Approve'}
                    </button>
                  </div>
                )}

                {/* Review Status */}
                {filter !== 'pending' && q.reviewedAt && (
                  <div className="text-gray-500 text-sm text-right">
                    Reviewed on {new Date(q.reviewedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

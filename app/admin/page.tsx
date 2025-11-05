'use client';

import { useState, useEffect } from 'react';
import type { PendingQuestion } from '@/lib/mongodb';

export default function AdminDashboard() {
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestions();
  }, [filter]);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/questions?status=${filter}`);
      const data = await response.json();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, action }),
      });

      const data = await response.json();
      
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

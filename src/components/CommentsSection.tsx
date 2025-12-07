'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { supabase } from '@/utils/supabase';
import type { Comment } from '@/types/database.types';

interface CommentsSectionProps {
  marketId: number;
}

export default function CommentsSection({ marketId }: CommentsSectionProps) {
  const { publicKey } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch initial comments
    const fetchComments = async () => {
      const { data } = await supabase
        .from('comments')
        .select('*')
        .eq('market_id', marketId)
        .order('created_at', { ascending: false });

      if (data) {
        setComments(data);
      }
    };

    fetchComments();

    // Subscribe to realtime changes
    const channel = supabase
      .channel(`comments:${marketId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setComments((prev) => [payload.new as Comment, ...prev]);
          } else if (payload.eventType === 'DELETE') {
            setComments((prev) =>
              prev.filter((c) => c.id !== (payload.old as Comment).id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketId]);

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !newComment.trim()) return;

    setLoading(true);
    try {
      await supabase.from('comments').insert([{
        market_id: marketId,
        user_address: publicKey.toBase58(),
        content: newComment.trim(),
      }]);

      setNewComment('');
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold">Comments ({comments.length})</h3>

      {/* Comment form */}
      {publicKey ? (
        <form onSubmit={addComment} className="space-y-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
          />
          <button
            type="submit"
            disabled={loading || !newComment.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Posting...' : 'Post Comment'}
          </button>
        </form>
      ) : (
        <div className="p-4 bg-gray-100 rounded-lg text-center text-gray-600">
          Connect your wallet to leave a comment
        </div>
      )}

      {/* Comments list */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No comments yet. Be the first to comment!
          </p>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="p-4 bg-white border border-gray-200 rounded-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">
                  {formatAddress(comment.user_address)}
                </span>
                <span className="text-sm text-gray-500">
                  {formatDate(comment.created_at)}
                </span>
              </div>
              <p className="text-gray-700">{comment.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

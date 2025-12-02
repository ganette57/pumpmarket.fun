'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { MessageCircle, ThumbsUp, Reply, Send } from 'lucide-react';

interface Comment {
  id: string;
  marketId: string;
  author: string;
  authorShort: string;
  text: string;
  timestamp: number;
  likes: number;
  likedBy: string[];
  replies?: Comment[];
}

interface CommentsSectionProps {
  marketId: string;
}

export default function CommentsSection({ marketId }: CommentsSectionProps) {
  const { publicKey } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(false);

  // Load comments from localStorage on mount
  useEffect(() => {
    loadComments();
  }, [marketId]);

  function loadComments() {
    try {
      const stored = localStorage.getItem(`comments_${marketId}`);
      if (stored) {
        setComments(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  }

  function saveComments(updatedComments: Comment[]) {
    try {
      localStorage.setItem(`comments_${marketId}`, JSON.stringify(updatedComments));
      setComments(updatedComments);
    } catch (error) {
      console.error('Error saving comments:', error);
    }
  }

  function shortenAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  function handleAddComment() {
    if (!publicKey || !newComment.trim()) return;

    setLoading(true);
    const comment: Comment = {
      id: Date.now().toString(),
      marketId,
      author: publicKey.toBase58(),
      authorShort: shortenAddress(publicKey.toBase58()),
      text: newComment.trim(),
      timestamp: Date.now(),
      likes: 0,
      likedBy: [],
      replies: [],
    };

    const updatedComments = [comment, ...comments];
    saveComments(updatedComments);
    setNewComment('');
    setLoading(false);
  }

  function handleAddReply(parentId: string) {
    if (!publicKey || !replyText.trim()) return;

    const reply: Comment = {
      id: Date.now().toString(),
      marketId,
      author: publicKey.toBase58(),
      authorShort: shortenAddress(publicKey.toBase58()),
      text: replyText.trim(),
      timestamp: Date.now(),
      likes: 0,
      likedBy: [],
    };

    const updatedComments = comments.map((comment) => {
      if (comment.id === parentId) {
        return {
          ...comment,
          replies: [...(comment.replies || []), reply],
        };
      }
      return comment;
    });

    saveComments(updatedComments);
    setReplyText('');
    setReplyingTo(null);
  }

  function handleLike(commentId: string) {
    if (!publicKey) return;

    const userAddress = publicKey.toBase58();

    const updatedComments = comments.map((comment) => {
      if (comment.id === commentId) {
        const hasLiked = comment.likedBy.includes(userAddress);
        return {
          ...comment,
          likes: hasLiked ? comment.likes - 1 : comment.likes + 1,
          likedBy: hasLiked
            ? comment.likedBy.filter((addr) => addr !== userAddress)
            : [...comment.likedBy, userAddress],
        };
      }

      // Handle likes on replies
      if (comment.replies) {
        const updatedReplies = comment.replies.map((reply) => {
          if (reply.id === commentId) {
            const hasLiked = reply.likedBy.includes(userAddress);
            return {
              ...reply,
              likes: hasLiked ? reply.likes - 1 : reply.likes + 1,
              likedBy: hasLiked
                ? reply.likedBy.filter((addr) => addr !== userAddress)
                : [...reply.likedBy, userAddress],
            };
          }
          return reply;
        });
        return { ...comment, replies: updatedReplies };
      }

      return comment;
    });

    saveComments(updatedComments);
  }

  function formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  function CommentItem({ comment, isReply = false }: { comment: Comment; isReply?: boolean }) {
    const userAddress = publicKey?.toBase58();
    const hasLiked = userAddress ? comment.likedBy.includes(userAddress) : false;

    return (
      <div className={`${isReply ? 'ml-12 mt-3' : 'mt-4'}`}>
        <div className="flex items-start space-x-3">
          {/* Avatar */}
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-pump-green to-pump-red flex items-center justify-center text-white font-bold text-sm">
            {comment.authorShort.slice(0, 2).toUpperCase()}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-1">
              <span className="font-semibold text-white text-sm">{comment.authorShort}</span>
              <span className="text-xs text-gray-500">{formatTimestamp(comment.timestamp)}</span>
            </div>

            <p className="text-gray-300 text-sm mb-2 break-words">{comment.text}</p>

            {/* Actions */}
            <div className="flex items-center space-x-4">
              <button
                onClick={() => handleLike(comment.id)}
                disabled={!publicKey}
                className={`flex items-center space-x-1 text-xs transition ${
                  hasLiked
                    ? 'text-pump-green'
                    : 'text-gray-500 hover:text-pump-green'
                } ${!publicKey ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <ThumbsUp className={`w-3.5 h-3.5 ${hasLiked ? 'fill-pump-green' : ''}`} />
                <span>{comment.likes > 0 ? comment.likes : ''}</span>
              </button>

              {!isReply && (
                <button
                  onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                  disabled={!publicKey}
                  className={`flex items-center space-x-1 text-xs text-gray-500 hover:text-pump-green transition ${
                    !publicKey ? 'cursor-not-allowed opacity-50' : ''
                  }`}
                >
                  <Reply className="w-3.5 h-3.5" />
                  <span>Reply</span>
                </button>
              )}
            </div>

            {/* Reply Input */}
            {replyingTo === comment.id && (
              <div className="mt-3 flex items-center space-x-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  className="input-pump flex-1 text-sm py-2"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddReply(comment.id);
                    }
                  }}
                />
                <button
                  onClick={() => handleAddReply(comment.id)}
                  disabled={!replyText.trim()}
                  className="btn-pump px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Replies */}
            {comment.replies && comment.replies.length > 0 && (
              <div className="mt-3 space-y-3">
                {comment.replies.map((reply) => (
                  <CommentItem key={reply.id} comment={reply} isReply={true} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 border-t border-gray-800 pt-8">
      <div className="flex items-center space-x-2 mb-6">
        <MessageCircle className="w-6 h-6 text-pump-green" />
        <h2 className="text-2xl font-bold text-white">
          Discussion {comments.length > 0 && `(${comments.length})`}
        </h2>
      </div>

      {/* Add Comment */}
      {publicKey ? (
        <div className="mb-8">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-pump-green to-pump-red flex items-center justify-center text-white font-bold text-sm">
              {shortenAddress(publicKey.toBase58()).slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Share your thoughts on this market..."
                rows={3}
                className="input-pump w-full resize-none"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-500">
                  {newComment.length}/500 characters
                </span>
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || newComment.length > 500 || loading}
                  className="btn-pump px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  <Send className="w-4 h-4" />
                  <span>Post</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-8 p-6 bg-pump-dark rounded-lg border border-gray-800 text-center">
          <p className="text-gray-400">Connect your wallet to join the discussion</p>
        </div>
      )}

      {/* Comments List */}
      {comments.length === 0 ? (
        <div className="text-center py-12">
          <MessageCircle className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">No comments yet</p>
          <p className="text-gray-600 text-sm">Be the first to share your thoughts!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </div>
      )}
    </div>
  );
}

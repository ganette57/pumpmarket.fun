'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { supabase } from '@/utils/supabase';

interface BookmarkButtonProps {
  marketId: number;
}

export default function BookmarkButton({ marketId }: BookmarkButtonProps) {
  const { publicKey } = useWallet();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setIsBookmarked(false);
      return;
    }

    checkBookmarkStatus();
  }, [publicKey, marketId]);

  const checkBookmarkStatus = async () => {
    if (!publicKey) return;

    const { data } = await supabase
      .from('bookmarks')
      .select('id')
      .eq('user_address', publicKey.toBase58())
      .eq('market_id', marketId)
      .single();

    setIsBookmarked(!!data);
  };

  const toggleBookmark = async () => {
    if (!publicKey) {
      alert('Please connect your wallet first');
      return;
    }

    setLoading(true);
    try {
      if (isBookmarked) {
        // Remove bookmark
        await supabase
          .from('bookmarks')
          .delete()
          .eq('user_address', publicKey.toBase58())
          .eq('market_id', marketId);
        setIsBookmarked(false);
      } else {
        // Add bookmark
        await supabase
          .from('bookmarks')
          .insert([{
            user_address: publicKey.toBase58(),
            market_id: marketId,
          }]);
        setIsBookmarked(true);
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      alert('Failed to toggle bookmark');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggleBookmark}
      disabled={loading || !publicKey}
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
        isBookmarked
          ? 'bg-yellow-500 text-white hover:bg-yellow-600'
          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {loading ? '...' : isBookmarked ? '★ Bookmarked' : '☆ Bookmark'}
    </button>
  );
}

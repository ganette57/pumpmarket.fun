'use client';

import { useState, useEffect } from 'react';
import { Heart, Share2, Check } from 'lucide-react';

interface MarketActionsProps {
  marketId: string;
  question: string;
  className?: string;
}

export default function MarketActions({ marketId, question, className = '' }: MarketActionsProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);

  // Load bookmark status on mount
  useEffect(() => {
    loadBookmarkStatus();
  }, [marketId]);

  function loadBookmarkStatus() {
    try {
      const savedMarkets = localStorage.getItem('savedMarkets');
      if (savedMarkets) {
        const markets = JSON.parse(savedMarkets);
        setIsBookmarked(markets.includes(marketId));
      }
    } catch (error) {
      console.error('Error loading bookmark status:', error);
    }
  }

  function toggleBookmark() {
    try {
      const savedMarkets = localStorage.getItem('savedMarkets');
      let markets: string[] = savedMarkets ? JSON.parse(savedMarkets) : [];

      if (isBookmarked) {
        // Remove bookmark
        markets = markets.filter((id) => id !== marketId);
        setIsBookmarked(false);
      } else {
        // Add bookmark
        markets.push(marketId);
        setIsBookmarked(true);
      }

      localStorage.setItem('savedMarkets', JSON.stringify(markets));
    } catch (error) {
      console.error('Error toggling bookmark:', error);
    }
  }

  async function handleShare() {
    const shareData = {
      title: `Funmarket.pump - ${question}`,
      text: `Check out this prediction market: ${question}`,
      url: window.location.href,
    };

    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        // User cancelled or error - fall through to clipboard
        if ((error as Error).name !== 'AbortError') {
          console.error('Error sharing:', error);
        }
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 3000);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      // Final fallback - select text (for older browsers)
      const tempInput = document.createElement('input');
      tempInput.value = window.location.href;
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand('copy');
      document.body.removeChild(tempInput);
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 3000);
    }
  }

  return (
    <>
      <div className={`flex items-center space-x-3 ${className}`}>
        {/* Bookmark Button */}
        <button
          onClick={toggleBookmark}
          className={`
            group relative
            flex items-center justify-center
            w-10 h-10 rounded-full
            transition-all duration-200
            ${
              isBookmarked
                ? 'bg-pump-green/20 border border-pump-green text-pump-green'
                : 'bg-pump-gray border border-gray-700 text-gray-400 hover:border-pump-green hover:text-pump-green'
            }
            hover:scale-110 hover:shadow-lg
          `}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark market'}
        >
          <Heart
            className={`w-5 h-5 transition-all ${
              isBookmarked ? 'fill-pump-green scale-110' : ''
            } group-hover:scale-110`}
          />

          {/* Tooltip */}
          <span className="absolute -top-10 left-1/2 transform -translate-x-1/2 px-3 py-1.5 bg-pump-dark border border-gray-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            {isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          </span>
        </button>

        {/* Share Button */}
        <button
          onClick={handleShare}
          className="
            group relative
            flex items-center justify-center
            w-10 h-10 rounded-full
            bg-pump-gray border border-gray-700
            text-gray-400 hover:border-pump-green hover:text-pump-green
            transition-all duration-200
            hover:scale-110 hover:shadow-lg
          "
          title="Share market"
        >
          <Share2 className="w-5 h-5 group-hover:scale-110 transition-transform" />

          {/* Tooltip */}
          <span className="absolute -top-10 left-1/2 transform -translate-x-1/2 px-3 py-1.5 bg-pump-dark border border-gray-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            Share
          </span>
        </button>
      </div>

      {/* Share Toast */}
      {showShareToast && (
        <div className="fixed bottom-8 right-8 z-50 animate-slideUp">
          <div className="flex items-center space-x-3 px-6 py-4 bg-pump-dark border border-pump-green rounded-lg shadow-2xl">
            <div className="w-8 h-8 rounded-full bg-pump-green/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-pump-green" />
            </div>
            <div>
              <p className="text-white font-semibold">Link copied!</p>
              <p className="text-sm text-gray-400">Share this market with your friends</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

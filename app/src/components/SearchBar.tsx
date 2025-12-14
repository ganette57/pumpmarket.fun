'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, TrendingUp, X } from 'lucide-react';
import Link from 'next/link';

interface SearchResult {
  id: string;
  question: string;
  category: string;
  volume: number;
  creator: string;
}

interface SearchBarProps {
  onSearch?: (query: string) => void;
}

export default function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  async function performSearch(searchQuery: string) {
    try {
      // TODO: Replace with actual API call to search markets
      // For now, mock data
      const mockResults: SearchResult[] = [
        {
          id: '1',
          question: 'Will SOL reach $500 in 2025?',
          category: 'Crypto',
          volume: 50_000_000_000,
          creator: 'DegenKing',
        },
        {
          id: '2',
          question: 'Will Bitcoin hit $100k this year?',
          category: 'Crypto',
          volume: 120_000_000_000,
          creator: 'CryptoBull',
        },
      ].filter((r) => r.question.toLowerCase().includes(searchQuery.toLowerCase()));

      setResults(mockResults.slice(0, 5)); // Top 5 results
      setIsOpen(mockResults.length > 0);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setQuery('');
    setResults([]);
    setIsOpen(false);
  }

  function handleResultClick() {
    setIsOpen(false);
    setQuery('');
    if (onSearch) {
      onSearch('');
    }
  }

  return (
    <div ref={searchRef} className="relative w-full max-w-2xl">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets, creators, categories..."
          className="w-full bg-pump-dark border border-gray-700 rounded-lg pl-12 pr-12 py-3 text-white placeholder-gray-500 focus:border-pump-green focus:outline-none transition-all"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        {loading && (
          <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-pump-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full mt-2 w-full bg-pump-gray border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50 animate-slideDown">
          <div className="p-2 bg-pump-dark border-b border-gray-700">
            <p className="text-xs text-gray-400 px-2">
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </p>
          </div>

          {results.map((result) => (
            <Link key={result.id} href={`/trade/${result.id}`} onClick={handleResultClick}>
              <div className="px-4 py-3 hover:bg-pump-dark cursor-pointer transition-colors group">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="text-white font-semibold group-hover:text-pump-green transition line-clamp-2">
                      {result.question}
                    </h4>
                    <div className="flex items-center space-x-3 mt-2 text-sm text-gray-400">
                      <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
                        {result.category}
                      </span>
                      <span className="flex items-center">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        {(result.volume / 1_000_000_000).toFixed(1)} SOL
                      </span>
                      <span>by {result.creator}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {query.length >= 2 && (
            <div className="p-3 bg-pump-dark border-t border-gray-700 text-center">
              <button
                onClick={() => {
                  if (onSearch) onSearch(query);
                  setIsOpen(false);
                }}
                className="text-sm text-pump-green hover:underline"
              >
                View all results for "{query}" →
              </button>
            </div>
          )}
        </div>
      )}

      <style jsx global>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-slideDown {
          animation: slideDown 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { createMarketOnChain } from '@/lib/solana';
import { indexMarket } from '@/lib/markets';
import { PublicKey } from '@solana/web3.js';

export default function CreatePage() {
  const { publicKey, sendTransaction } = useWallet();

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Politics');
  const [imagePreview, setImagePreview] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const categories = ['Politics', 'Sports', 'Crypto', 'Entertainment', 'Science', 'Other'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    if (!question || question.length < 10) {
      setError('Question must be at least 10 characters');
      return;
    }

    if (!resolutionDate) {
      setError('Please select a resolution date');
      return;
    }

    const endDate = new Date(resolutionDate);
    if (endDate <= new Date()) {
      setError('Resolution date must be in the future');
      return;
    }

    setCreating(true);

    try {
      console.log('🚀 Creating market on-chain...');

      // Create market on Solana blockchain
      const marketAddress = await createMarketOnChain(
        { publicKey, sendTransaction },
        {
          question,
          endDate,
          creator: publicKey,
        }
      );

      console.log('✅ Market created on-chain:', marketAddress);
      console.log('📝 Indexing in Supabase...');

      // Index in Supabase with retry logic
      const indexed = await indexMarket({
        market_address: marketAddress,
        question: question.slice(0, 200),
        description: description || '',
        category: category || 'Other',
        image_url: imagePreview || null,
        end_date: endDate.toISOString(),
        creator: publicKey.toBase58(),
        yes_supply: 0,
        no_supply: 0,
        total_volume: 0,
        resolved: false,
      });

      if (!indexed) {
        console.warn('⚠️ Market created on-chain but indexing failed');
        setError('Market created but indexing failed. It may take a few moments to appear.');
      } else {
        console.log('✅ Market indexed successfully!');
        setSuccess(`Market created successfully! Address: ${marketAddress}`);

        // Redirect to the market page after 2 seconds
        setTimeout(() => {
          window.location.href = `/trade/${marketAddress}`;
        }, 2000);
      }
    } catch (err: any) {
      console.error('❌ Error creating market:', err);
      setError(`Failed to create market: ${err.message || 'Unknown error'}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Create Prediction Market</h1>
        <p className="text-gray-400">Launch a market and earn 1% of all trades</p>
      </div>

      {!publicKey ? (
        <div className="text-center py-16">
          <p className="text-xl mb-4">Connect your wallet to create a market</p>
          <WalletMultiButton />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              Market Question *
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will Bitcoin reach $100k by end of 2024?"
              maxLength={200}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:border-primary focus:outline-none"
              required
            />
            <p className="text-xs text-gray-500 mt-1">{question.length}/200 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context about the market..."
              rows={4}
              maxLength={1000}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:border-primary focus:outline-none"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Image URL (optional)
            </label>
            <input
              type="url"
              value={imagePreview}
              onChange={(e) => setImagePreview(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:border-primary focus:outline-none"
            />
            {imagePreview && (
              <img
                src={imagePreview}
                alt="Preview"
                className="mt-2 w-full h-48 object-cover rounded-lg"
                onError={() => setImagePreview('')}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Resolution Date *
            </label>
            <input
              type="datetime-local"
              value={resolutionDate}
              onChange={(e) => setResolutionDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:border-primary focus:outline-none"
              required
            />
          </div>

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-400">
              {error}
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg text-green-400">
              {success}
            </div>
          )}

          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Creator Benefits</h3>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>✓ Earn 1% fee on every trade</li>
              <li>✓ Control market resolution</li>
              <li>✓ Build your reputation</li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="w-full py-4 bg-secondary hover:bg-secondary/80 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition"
          >
            {creating ? 'Creating Market...' : 'Create Market'}
          </button>
        </form>
      )}
    </main>
  );
}

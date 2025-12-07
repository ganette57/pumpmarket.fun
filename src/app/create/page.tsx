'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { supabase } from '@/utils/supabase';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  'Politics',
  'Sports',
  'Crypto',
  'Technology',
  'Entertainment',
  'Finance',
  'Science',
  'Other',
];

export default function CreateMarketPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [socialLinks, setSocialLinks] = useState({
    twitter: '',
    website: '',
    discord: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey) {
      alert('Please connect your wallet');
      return;
    }

    if (!question || !resolutionDate) {
      alert('Please fill in all required fields');
      return;
    }

    const endDate = new Date(resolutionDate);
    if (endDate <= new Date()) {
      alert('Resolution date must be in the future');
      return;
    }

    setLoading(true);
    try {
      // Create a deterministic market PDA (Program Derived Address)
      // In a real implementation, you would derive this from your Solana program
      const marketSeed = `market_${Date.now()}_${publicKey.toBase58().slice(0, 8)}`;
      const marketPDA = await PublicKey.createWithSeed(
        publicKey,
        marketSeed,
        SystemProgram.programId
      );

      // Create a simple transaction to demonstrate on-chain creation
      // In production, this would interact with your actual Solana program
      const transaction = new Transaction().add(
        SystemProgram.createAccountWithSeed({
          fromPubkey: publicKey,
          newAccountPubkey: marketPDA,
          basePubkey: publicKey,
          seed: marketSeed,
          lamports: await connection.getMinimumBalanceForRentExemption(165),
          space: 165,
          programId: SystemProgram.programId,
        })
      );

      // Send transaction to Solana
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      console.log('Market created on-chain with signature:', signature);

      // Index the market in Supabase
      const { data, error } = await supabase.from('markets').insert([{
        market_address: marketPDA.toBase58(),
        question,
        description: description || null,
        category: selectedCategory || null,
        image_url: imageUrl || null,
        end_date: endDate.toISOString(),
        creator: publicKey.toBase58(),
        social_links: Object.keys(socialLinks).some(key => socialLinks[key as keyof typeof socialLinks])
          ? socialLinks
          : null,
        yes_supply: 0,
        no_supply: 0,
        total_volume: 0,
        resolved: false,
      }]).select();

      if (error) {
        console.error('Supabase error:', error);
        alert('Market created on-chain but failed to index in database. Please try again.');
        return;
      }

      alert('Market created successfully!');
      router.push('/');
    } catch (error) {
      console.error('Error creating market:', error);
      alert('Failed to create market. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="text-6xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Connect Your Wallet
          </h1>
          <p className="text-gray-600">
            Please connect your wallet to create a market
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          Create a Prediction Market
        </h1>
        <p className="text-gray-600">
          Create a new market and let people trade on the outcome
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-lg shadow-md">
        {/* Question */}
        <div>
          <label htmlFor="question" className="block text-sm font-medium text-gray-700 mb-2">
            Question <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., Will Bitcoin reach $100k by the end of 2025?"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Provide additional context and resolution criteria..."
            rows={4}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Category */}
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
            Category
          </label>
          <select
            id="category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select a category</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Resolution Date */}
        <div>
          <label htmlFor="resolutionDate" className="block text-sm font-medium text-gray-700 mb-2">
            Resolution Date <span className="text-red-500">*</span>
          </label>
          <input
            type="datetime-local"
            id="resolutionDate"
            value={resolutionDate}
            onChange={(e) => setResolutionDate(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        {/* Image URL */}
        <div>
          <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-2">
            Image URL
          </label>
          <input
            type="url"
            id="imageUrl"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {imageUrl && (
            <div className="mt-3">
              <img
                src={imageUrl}
                alt="Preview"
                className="h-32 rounded-lg object-cover"
                onError={() => setImageUrl('')}
              />
            </div>
          )}
        </div>

        {/* Social Links */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Social Links (Optional)
          </label>
          <input
            type="url"
            value={socialLinks.twitter}
            onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
            placeholder="Twitter/X URL"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            type="url"
            value={socialLinks.website}
            onChange={(e) => setSocialLinks({ ...socialLinks, website: e.target.value })}
            placeholder="Website URL"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            type="url"
            value={socialLinks.discord}
            onChange={(e) => setSocialLinks({ ...socialLinks, discord: e.target.value })}
            placeholder="Discord URL"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors font-medium text-lg"
        >
          {loading ? 'Creating Market...' : 'Create Market'}
        </button>
      </form>
    </div>
  );
}

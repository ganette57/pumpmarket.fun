'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { validateMarketQuestion, validateMarketDescription } from '@/utils/bannedWords';
import { useRouter } from 'next/navigation';
import { CATEGORIES, CategoryId } from '@/utils/categories';
import SocialLinksForm, { SocialLinks } from '@/components/SocialLinksForm';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar } from 'lucide-react';

export default function CreateMarket() {
  const { publicKey, connected } = useWallet();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CategoryId>('crypto');
  // Default: 7 days from now
  const [resolutionDate, setResolutionDate] = useState<Date>(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date;
  });
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});

  const [questionError, setQuestionError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  const handleQuestionChange = (value: string) => {
    setQuestion(value);
    const validation = validateMarketQuestion(value);
    setQuestionError(validation.valid ? null : validation.error || null);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    const validation = validateMarketDescription(value);
    setDescriptionError(validation.valid ? null : validation.error || null);
  };

  const canSubmit =
    connected &&
    question.length >= 10 &&
    !questionError &&
    !descriptionError &&
    category &&
    resolutionDate &&
    resolutionDate > new Date(); // Must be in the future

  async function handleCreateMarket() {
    if (!canSubmit || !publicKey) return;

    setLoading(true);
    try {
      // TODO: Call Solana program to create market
      console.log('Creating market:', {
        question,
        description,
        category,
        resolutionTime: Math.floor(resolutionDate.getTime() / 1000),
        socialLinks,
      });

      alert('Market created! (Demo mode - program not deployed yet)');
      router.push('/');
    } catch (error) {
      console.error('Error creating market:', error);
      alert('Error creating market: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Create Market</h1>
        <p className="text-gray-400">
          Launch a prediction market. Keep it clean - banned words are blocked.
        </p>
      </div>

      <div className="card-pump">
        {/* Question */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Question *
            <span className="text-gray-500 font-normal text-sm ml-2">
              ({question.length}/200)
            </span>
          </label>
          <input
            type="text"
            value={question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            placeholder="Will SOL reach $500 in 2025?"
            maxLength={200}
            className={`input-pump w-full ${questionError ? 'input-error' : ''}`}
          />
          {questionError && (
            <p className="text-pump-red text-sm mt-2 font-semibold">
              ❌ {questionError}
            </p>
          )}
          {question.length >= 10 && !questionError && (
            <p className="text-pump-green text-sm mt-2">✓ Valid question</p>
          )}
        </div>

        {/* Description */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Description (optional)
            <span className="text-gray-500 font-normal text-sm ml-2">
              ({description.length}/500)
            </span>
          </label>
          <textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Describe the resolution conditions..."
            maxLength={500}
            rows={4}
            className={`input-pump w-full ${descriptionError ? 'input-error' : ''}`}
          />
          {descriptionError && (
            <p className="text-pump-red text-sm mt-2 font-semibold">
              ❌ {descriptionError}
            </p>
          )}
        </div>

        {/* Category */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Category *
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryId)}
            className="input-pump w-full"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2">
            Choose the category that best fits your market
          </p>
        </div>

        {/* End Date & Time */}
        <div className="mb-8">
          <label className="block text-white font-semibold mb-2">
            End Date & Time *
          </label>
          <div className="relative">
            <DatePicker
              selected={resolutionDate}
              onChange={(date: Date | null) => date && setResolutionDate(date)}
              showTimeSelect
              timeFormat="HH:mm"
              timeIntervals={15}
              dateFormat="MMMM d, yyyy h:mm aa"
              minDate={new Date()}
              className="input-pump w-full pl-10"
              placeholderText="Select end date and time"
            />
            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Market will close and be ready for resolution at this time (UTC)
          </p>
        </div>

        {/* Social Links */}
        <div className="mb-8 pb-8 border-b border-gray-800">
          <SocialLinksForm value={socialLinks} onChange={setSocialLinks} />
        </div>

        {/* Submit */}
        {!connected ? (
          <div className="text-center p-8 bg-pump-dark rounded-lg">
            <p className="text-gray-400 mb-4">Connect your wallet to create a market</p>
          </div>
        ) : (
          <button
            onClick={handleCreateMarket}
            disabled={!canSubmit || loading}
            className={`w-full py-4 rounded-lg font-bold text-lg transition ${
              canSubmit && !loading
                ? 'btn-pump glow-green'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {loading ? 'Creating...' : 'Launch Market 🚀'}
          </button>
        )}

        {/* Info */}
        <div className="mt-6 p-4 bg-pump-dark rounded-lg">
          <p className="text-sm text-gray-400">
            <strong className="text-white">Banned words filter active:</strong>
            <br />
            Markets with inappropriate content (violence, illegal activity, NSFW, etc.) are
            automatically blocked. Keep it fun and legal!
          </p>
        </div>
      </div>
    </div>
  );
}

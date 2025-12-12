'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { validateMarketQuestion, validateMarketDescription } from '@/utils/bannedWords';
import { useRouter } from 'next/navigation';
import { CATEGORIES, CategoryId } from '@/utils/categories';
import SocialLinksForm, { SocialLinks } from '@/components/SocialLinksForm';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar, Image as ImageIcon, Upload, X, Plus, Trash2 } from 'lucide-react';
import Image from 'next/image';
import CategoryImagePlaceholder from '@/components/CategoryImagePlaceholder';
import { useProgram } from '@/hooks/useProgram';
import { getUserCounterPDA, getMarketPDA } from '@/utils/solana';
import { SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { supabase } from '@/utils/supabase';
import { indexMarket } from '@/lib/markets';
import { usePhantomWallet } from '@/hooks/usePhantomWallet';

type MarketType = 'binary' | 'multi';

export default function CreateMarket() {
  // ✅ Use custom hook that ensures we get the correct Phantom wallet
  const { publicKey, connected } = usePhantomWallet();
  const router = useRouter();
  const program = useProgram();
  const [loading, setLoading] = useState(false);

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CategoryId>('crypto');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageError, setImageError] = useState<string>('');
  
  // Multi-choice support
  const [marketType, setMarketType] = useState<MarketType>('binary');
  const [outcomes, setOutcomes] = useState<string[]>(['YES', 'NO']);
  const [outcomesError, setOutcomesError] = useState<string>('');
  
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

  const handleMarketTypeChange = (type: MarketType) => {
    setMarketType(type);
    if (type === 'binary') {
      setOutcomes(['YES', 'NO']);
      setOutcomesError('');
    } else {
      setOutcomes(['', '', '']);
    }
  };

  const addOutcome = () => {
    if (outcomes.length < 10) {
      setOutcomes([...outcomes, '']);
    }
  };

  const removeOutcome = (index: number) => {
    if (outcomes.length > 2) {
      setOutcomes(outcomes.filter((_, i) => i !== index));
    }
  };

  const updateOutcome = (index: number, value: string) => {
    const newOutcomes = [...outcomes];
    newOutcomes[index] = value;
    setOutcomes(newOutcomes);
    
    // Validate outcomes
    if (marketType === 'multi') {
      const nonEmpty = newOutcomes.filter(o => o.trim().length > 0);
      if (nonEmpty.length < 2) {
        setOutcomesError('At least 2 outcomes required');
      } else if (nonEmpty.length > 10) {
        setOutcomesError('Maximum 10 outcomes allowed');
      } else if (nonEmpty.some(o => o.length > 50)) {
        setOutcomesError('Outcome names must be 50 characters or less');
      } else {
        setOutcomesError('');
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      setImageError('Image must be less than 5MB');
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setImageError('File must be an image');
      return;
    }

    setImageError('');
    setImageFile(file);

    // Create preview using FileReader
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
    setImageError('');
  };

  const canSubmit =
    connected &&
    question.length >= 10 &&
    !questionError &&
    !descriptionError &&
    !outcomesError &&
    category &&
    resolutionDate &&
    resolutionDate > new Date() &&
    (marketType === 'binary' || outcomes.filter(o => o.trim().length > 0).length >= 2);

  async function handleCreateMarket() {
    if (!canSubmit || !publicKey || !program) {
      if (!publicKey) alert('Please connect your wallet');
      if (!program) alert('Program not loaded');
      return;
    }

    setLoading(true);
    try {
      console.log('Creating market with wallet:', publicKey?.toBase58());

      // TODO: Upload image to IPFS/storage service and get URL
      let imageUrl: string | undefined = undefined;
      if (imageFile) {
        console.log('Image file to upload:', imageFile.name, imageFile.size);
        // TODO: Implement actual upload to IPFS/Cloudinary/etc
        // imageUrl = await uploadImage(imageFile);
      }

      // Prepare outcomes array
      const finalOutcomes = marketType === 'binary'
        ? ['YES', 'NO']
        : outcomes.filter(o => o.trim().length > 0);

      // 1. Get PDAs
      const [userCounterPDA] = getUserCounterPDA(publicKey);
      const [marketPDA] = getMarketPDA(publicKey, question);

      console.log('PDAs:', {
        userCounter: userCounterPDA.toBase58(),
        market: marketPDA.toBase58(),
      });

      // 2. Check if user counter exists, if not initialize it
      try {
        await (program.account as any).userCounter.fetch(userCounterPDA);
        console.log('User counter exists');
      } catch (e) {
        // User counter doesn't exist, initialize it
        console.log('Initializing user counter...');
        const initTx = await program.methods
          .initializeUserCounter()
          .accounts({
            userCounter: userCounterPDA,
            authority: publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log('User counter initialized:', initTx);

        // Wait for confirmation
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 3. Create market
      const resolutionTimestamp = Math.floor(resolutionDate.getTime() / 1000);
      const marketTypeValue = marketType === 'binary' ? 0 : 1;

      console.log('Creating market with:', {
        question,
        description,
        resolutionTimestamp,
        marketType: marketTypeValue,
        outcomes: finalOutcomes,
      });

      const tx = await program.methods
        .createMarket(
          question,
          description,
          new BN(resolutionTimestamp),
          marketTypeValue,
          finalOutcomes
        )
        .accounts({
          market: marketPDA,
          creator: publicKey,
          userCounter: userCounterPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('Market created! Transaction:', tx);

      // Show success message
      alert(`Market created successfully! 🎉\n\nTransaction: ${tx.slice(0, 16)}...\n\nView on Solana Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
      
      // INDEXATION SUPABASE AVEC RETRY
      try {
        const indexed = await indexMarket({
          market_address: marketPDA.toBase58(),
          question: question.slice(0, 200),
          description: description || undefined,
          category: category || 'Other',
          image_url: imagePreview || undefined,
          end_date: resolutionDate.toISOString(),
          creator: publicKey?.toBase58() || 'unknown',
          market_type: marketTypeValue,
          outcome_names: finalOutcomes,
          outcome_supplies: new Array(finalOutcomes.length).fill(0),
          yes_supply: 0,
          no_supply: 0,
          total_volume: 0,
          resolved: false,
        });
        
        if (indexed) {
          console.log('✅ Market indexed in Supabase!');
        } else {
          console.error('❌ Failed to index market after 3 retries');
        }
      } catch (err) {
        console.error('❌ Indexation error:', err);
      }

      // Redirect to market page
      router.push(`/trade/${marketPDA.toBase58()}`);

    } catch (error: any) {
      console.error('Create market error:', error);

      // Parse error message
      let errorMsg = 'Failed to create market';
      if (error.message) {
        if (error.message.includes('banned') || error.message.includes('Banned')) {
          errorMsg = 'Market contains banned words. Please use appropriate language.';
        } else if (error.message.includes('rate limit') || error.message.includes('RateLimit')) {
          errorMsg = 'Rate limit exceeded. You can only create 5 markets per account.';
        } else if (error.message.includes('insufficient')) {
          errorMsg = 'Insufficient SOL balance. Please add funds to your wallet.';
        } else {
          errorMsg = error.message;
        }
      }

      alert(`Error: ${errorMsg}`);
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
        {/* Market Type Selection */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-3">
            Market Type *
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => handleMarketTypeChange('binary')}
              className={`p-4 rounded-lg border-2 transition-all ${
                marketType === 'binary'
                  ? 'border-pump-green bg-pump-green/10 text-white'
                  : 'border-gray-700 bg-pump-dark text-gray-400 hover:border-gray-600'
              }`}
            >
              <div className="font-bold mb-1">Binary (YES/NO)</div>
              <div className="text-sm">Simple yes or no outcome</div>
            </button>
            <button
              type="button"
              onClick={() => handleMarketTypeChange('multi')}
              className={`p-4 rounded-lg border-2 transition-all ${
                marketType === 'multi'
                  ? 'border-pump-green bg-pump-green/10 text-white'
                  : 'border-gray-700 bg-pump-dark text-gray-400 hover:border-gray-600'
              }`}
            >
              <div className="font-bold mb-1">Multi-Choice</div>
              <div className="text-sm">Multiple possible outcomes</div>
            </button>
          </div>
        </div>

        {/* Outcomes (Multi-Choice Only) */}
        {marketType === 'multi' && (
          <div className="mb-6">
            <label className="block text-white font-semibold mb-2">
              Outcomes * (2-10 options)
            </label>
            <div className="space-y-2">
              {outcomes.map((outcome, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={outcome}
                    onChange={(e) => updateOutcome(index, e.target.value)}
                    placeholder={`Option ${index + 1} (e.g., BTC, ETH, SOL)`}
                    maxLength={50}
                    className="input-pump flex-1"
                  />
                  {outcomes.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOutcome(index)}
                      className="w-10 h-10 rounded-lg bg-pump-red/20 hover:bg-pump-red/30 text-pump-red transition flex items-center justify-center"
                      title="Remove outcome"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {outcomes.length < 10 && (
              <button
                type="button"
                onClick={addOutcome}
                className="mt-2 flex items-center gap-2 text-pump-green hover:text-green-400 transition"
              >
                <Plus className="w-4 h-4" />
                Add Option
              </button>
            )}
            {outcomesError && (
              <p className="text-pump-red text-sm mt-2 font-semibold">
                ❌ {outcomesError}
              </p>
            )}
            {!outcomesError && outcomes.filter(o => o.trim()).length >= 2 && (
              <p className="text-pump-green text-sm mt-2">
                ✓ {outcomes.filter(o => o.trim()).length} outcomes
              </p>
            )}
          </div>
        )}

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
            placeholder={marketType === 'binary' ? "Will SOL reach $500 in 2025?" : "Which privacy coin will have the higher price on Christmas Day?"}
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

        {/* Market Image */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Market Image (Optional)
          </label>

          {!imagePreview ? (
            <>
              {/* File Upload Input */}
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-pump-green transition-colors bg-pump-dark/50">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 text-gray-500 mb-2" />
                  <p className="text-sm text-gray-400 mb-1">
                    <span className="font-semibold text-pump-green">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>

              {imageError && (
                <p className="text-pump-red text-sm mt-2 font-semibold">
                  ❌ {imageError}
                </p>
              )}

              {/* Placeholder preview when no image */}
              <div className="mt-4">
                <p className="text-sm text-gray-400 mb-2">Default placeholder for {category}:</p>
                <div className="relative w-full h-48 rounded-lg overflow-hidden">
                  <CategoryImagePlaceholder category={category} className="w-full h-full" />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Image Preview with Remove Button */}
              <div className="mt-4 relative">
                <div className="relative w-full h-48 rounded-lg overflow-hidden bg-pump-dark border border-gray-700">
                  <Image
                    src={imagePreview}
                    alt="Uploaded preview"
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/80 to-transparent"></div>
                </div>

                {/* Remove Button */}
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 w-8 h-8 bg-pump-red hover:bg-red-600 rounded-full flex items-center justify-center transition-colors shadow-lg"
                  title="Remove image"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* File Info */}
              {imageFile && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-400 truncate flex-1">
                    {imageFile.name}
                  </span>
                  <span className="text-gray-500 ml-2">
                    {(imageFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              )}
            </>
          )}
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

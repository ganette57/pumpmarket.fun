'use client';

import { useMemo, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { validateMarketQuestion, validateMarketDescription } from '@/utils/bannedWords';
import { useRouter } from 'next/navigation';
import { CATEGORIES, CategoryId } from '@/utils/categories';
import SocialLinksForm, { SocialLinks } from '@/components/SocialLinksForm';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar, Upload, X } from 'lucide-react';
import Image from 'next/image';
import CategoryImagePlaceholder from '@/components/CategoryImagePlaceholder';
import { useProgram } from '@/hooks/useProgram';
import { getUserCounterPDA, getMarketPDA } from '@/utils/solana';
import { SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { indexMarket } from '@/lib/markets';

// -----------------------------
// Helpers
// -----------------------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseOutcomes(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Seeds must be <= 32 bytes.
 * We build a "seeded question" used only for PDA derivation (not what you display).
 */
function makeSeededQuestion(displayQuestion: string, suffix: string) {
  const clean = displayQuestion.trim().replace(/\s+/g, ' ');
  const tag = `~${suffix}`; // small suffix to avoid collisions
  const maxBytes = 32;

  const tagBytes = Buffer.from(tag, 'utf8').length;

  let base = clean;
  while (Buffer.from(base, 'utf8').length + tagBytes > maxBytes) {
    base = base.slice(0, -1);
    if (base.length <= 0) break;
  }
  base = base.trim();
  if (!base) base = 'market';

  return `${base}${tag}`;
}

function randomBase36(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function prettyError(e: any): string {
  return (
    e?.error?.errorMessage ||
    e?.error?.message ||
    e?.message ||
    (typeof e === 'string' ? e : '') ||
    'Unexpected error'
  );
}

export default function CreateMarket() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const program = useProgram();
  const [loading, setLoading] = useState(false);

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CategoryId>('crypto');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageError, setImageError] = useState<string>('');

  // Default: 7 days from now
  const [resolutionDate, setResolutionDate] = useState<Date>(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date;
  });

  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});

  const [questionError, setQuestionError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Outcome UI (binary by défaut)
  const [marketType, setMarketType] = useState<0 | 1>(0); // 0=binary, 1=multichoice
  const [outcomesText, setOutcomesText] = useState('YES\nNO');
  const outcomes = useMemo(() => parseOutcomes(outcomesText), [outcomesText]);

  const outcomesError = useMemo(() => {
    if (marketType === 0) {
      return outcomes.length !== 2 ? 'Binary market must have exactly 2 outcomes.' : null;
    }
    return outcomes.length < 2 || outcomes.length > 10 ? 'Multi-choice must have 2 to 10 outcomes.' : null;
  }, [marketType, outcomes.length]);

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
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

    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
    setImageError('');
  };

  const canSubmit =
    connected &&
    question.trim().length >= 10 &&
    !questionError &&
    !descriptionError &&
    !outcomesError &&
    resolutionDate &&
    resolutionDate > new Date();

  async function handleCreateMarket() {
    if (!canSubmit || !publicKey || !program) {
      if (!publicKey) alert('Please connect your wallet');
      if (!program) alert('Program not loaded');
      return;
    }

    setLoading(true);
    try {
      // TODO: upload image -> real URL
      let imageUrl: string | undefined = undefined;
      if (imageFile) {
        console.log('Image file to upload:', imageFile.name, imageFile.size);
        // imageUrl = await uploadImage(imageFile);
      }

      // 1) PDAs
      const [userCounterPDA] = getUserCounterPDA(publicKey);

      // ✅ derive a SAFE market PDA (seeded question <= 32 bytes)
      const suffix = randomBase36(6);
      const seededQuestion = makeSeededQuestion(question, suffix);
      const [marketPDA] = getMarketPDA(publicKey, seededQuestion);

      console.log('PDAs:', {
        userCounter: userCounterPDA.toBase58(),
        market: marketPDA.toBase58(),
        seededQuestion,
      });

      // 2) Ensure userCounter exists (NO program.account typing)
      const userCounterInfo = await connection.getAccountInfo(userCounterPDA);
      if (!userCounterInfo) {
        console.log('Initializing user counter...');

        // NOTE: IDL shows initialize_user_counter expects:
        // accounts: user_counter, authority, system_program
        const initTx = await (program.methods as any)
          .initializeUserCounter()
          .accounts({
            userCounter: userCounterPDA,
            authority: publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log('User counter initialized:', initTx);
        await sleep(1500);
      } else {
        console.log('User counter exists');
      }

      // 3) Create market (IDL requires market_type + outcome_names)
      const resolutionTimestamp = Math.floor(resolutionDate.getTime() / 1000);

      console.log('Creating market with:', {
        displayQuestion: question,
        seededQuestion,
        description,
        resolutionTimestamp,
        marketType,
        outcomes,
        category,
        imageUrl,
        socialLinks,
      });

      // accounts naming in TS is camelCase:
      // market, userCounter, authority/creator, systemProgram
      // We'll detect if IDL uses "creator" or "authority" and pass accordingly.
      const idlAny: any = (program as any).idl;
      const ix = idlAny?.instructions?.find((x: any) => x.name === 'create_market');
      const ixAccounts: string[] = (ix?.accounts || []).map((a: any) => a.name);

      const wantsCreator = ixAccounts.includes('creator');
      const wantsAuthority = ixAccounts.includes('authority');

      const accountsForCreate: any = {
        market: marketPDA,
        userCounter: userCounterPDA,
        systemProgram: SystemProgram.programId,
      };

      if (wantsCreator) accountsForCreate.creator = publicKey;
      if (wantsAuthority) accountsForCreate.authority = publicKey;

      const tx = await (program.methods as any)
        .createMarket(
          seededQuestion,
          description ?? '',
          new BN(resolutionTimestamp),
          marketType,
          outcomes
        )
        .accounts(accountsForCreate)
        .rpc();

      console.log('Market created! Transaction:', tx);

      alert(
        `Market created successfully! 🎉\n\nTransaction: ${tx.slice(
          0,
          16
        )}...\n\nView on Solana Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`
      );

      // 4) Indexation Supabase (fix typing + fields)
      try {
        const indexed = await indexMarket({
          market_address: marketPDA.toBase58(),
          question: question.slice(0, 60),
          description: description ? description : undefined,
          category, // ✅ CategoryId, pas "Other"
          image_url: imagePreview ? imagePreview : undefined,
          end_date: resolutionDate.toISOString(),
          creator: publicKey.toBase58(),
          yes_supply: 0,
          no_supply: 0,
          total_volume: 0,
          resolved: false,
        });

        if (indexed) {
          console.log('✅ Market indexed in Supabase!');
        } else {
          console.error('❌ Failed to index market after retries');
        }
      } catch (err) {
        console.error('❌ Indexation error:', err);
      }

      // 5) Redirect
      router.push(`/trade/${marketPDA.toBase58()}`);
    } catch (error: any) {
      console.error('Create market error:', error);

      const msg = prettyError(error);

      let errorMsg = 'Failed to create market';
      if (msg) {
        if (msg.includes('banned') || msg.includes('Banned')) {
          errorMsg = 'Market contains banned words. Please use appropriate language.';
        } else if (msg.includes('rate limit') || msg.includes('RateLimit')) {
          errorMsg = 'Rate limit exceeded. You can only create 5 markets per account.';
        } else if (msg.includes('insufficient')) {
          errorMsg = 'Insufficient SOL balance. Please add funds to your wallet.';
        } else {
          errorMsg = msg;
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
            <p className="text-pump-red text-sm mt-2 font-semibold">❌ {questionError}</p>
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
            <p className="text-pump-red text-sm mt-2 font-semibold">❌ {descriptionError}</p>
          )}
        </div>

        {/* Market type + Outcomes */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Market type *</label>
          <select
            value={marketType}
            onChange={(e) => setMarketType(Number(e.target.value) as 0 | 1)}
            className="input-pump w-full"
          >
            <option value={0}>Binary (exactly 2 outcomes)</option>
            <option value={1}>Multi-choice (2 to 10 outcomes)</option>
          </select>

          <div className="mt-4">
            <label className="block text-white font-semibold mb-2">
              Outcomes (1 per line) — {marketType === 0 ? 'must be 2' : '2 to 10'}
            </label>
            <textarea
              value={outcomesText}
              onChange={(e) => setOutcomesText(e.target.value)}
              rows={4}
              className={`input-pump w-full ${outcomesError ? 'input-error' : ''}`}
            />
            {outcomesError && (
              <p className="text-pump-red text-sm mt-2 font-semibold">❌ {outcomesError}</p>
            )}
          </div>
        </div>

        {/* Category */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Category *</label>
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
          <label className="block text-white font-semibold mb-2">Market Image (Optional)</label>

          {!imagePreview ? (
            <>
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-pump-green transition-colors bg-pump-dark/50">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 text-gray-500 mb-2" />
                  <p className="text-sm text-gray-400 mb-1">
                    <span className="font-semibold text-pump-green">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
                </div>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>

              {imageError && (
                <p className="text-pump-red text-sm mt-2 font-semibold">❌ {imageError}</p>
              )}

              <div className="mt-4">
                <p className="text-sm text-gray-400 mb-2">Default placeholder for {category}:</p>
                <div className="relative w-full h-48 rounded-lg overflow-hidden">
                  <CategoryImagePlaceholder category={category} className="w-full h-full" />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 relative">
                <div className="relative w-full h-48 rounded-lg overflow-hidden bg-pump-dark border border-gray-700">
                  <Image src={imagePreview} alt="Uploaded preview" fill className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/80 to-transparent"></div>
                </div>

                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 w-8 h-8 bg-pump-red hover:bg-red-600 rounded-full flex items-center justify-center transition-colors shadow-lg"
                  title="Remove image"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {imageFile && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-400 truncate flex-1">{imageFile.name}</span>
                  <span className="text-gray-500 ml-2">{(imageFile.size / 1024).toFixed(0)} KB</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* End Date & Time */}
        <div className="mb-8">
          <label className="block text-white font-semibold mb-2">End Date & Time *</label>
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
              canSubmit && !loading ? 'btn-pump glow-green' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
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
            Markets with inappropriate content (violence, illegal activity, NSFW, etc.) are automatically blocked. Keep it fun and legal!
          </p>
        </div>
      </div>
    </div>
  );
}
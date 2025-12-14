"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { SystemProgram, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Calendar, Upload, X } from "lucide-react";
import Image from "next/image";
import { Buffer } from "buffer";

import { validateMarketQuestion, validateMarketDescription } from "@/utils/bannedWords";
import { CATEGORIES, CategoryId } from "@/utils/categories";
import SocialLinksForm, { SocialLinks } from "@/components/SocialLinksForm";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";

import { useProgram } from "@/hooks/useProgram";
import { getUserCounterPDA } from "@/utils/solana";
import { indexMarket } from "@/lib/markets";

// ---------- helpers ----------
function parseOutcomes(text: string) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function randomBase36(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function makeSeededQuestion(displayQuestion: string, suffix: string) {
  const clean = displayQuestion.trim().replace(/\s+/g, " ");
  const tag = `~${suffix}`;
  const maxBytes = 32;

  const tagBytes = Buffer.from(tag, "utf8").length;
  let base = clean;

  while (Buffer.from(base, "utf8").length + tagBytes > maxBytes) {
    base = base.slice(0, -1);
    if (!base.length) break;
  }
  base = base.trim();
  if (!base) base = "market";
  return `${base}${tag}`;
}

function toStringArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String).map(s => s.trim()).filter(Boolean);
  return [];
}
function toNumberArray(x: any): number[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map((v) => Number(v) || 0);
  return [];
}

export default function CreateMarketPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const program = useProgram();

  const [loading, setLoading] = useState(false);

  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CategoryId>("crypto");

  const [marketType, setMarketType] = useState<0 | 1>(0); // 0=binary, 1=multi
  const [outcomesText, setOutcomesText] = useState("YES\nNO");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageError, setImageError] = useState<string>("");

  const [resolutionDate, setResolutionDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  });

  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  useEffect(() => {
    if (marketType === 0) setOutcomesText("YES\nNO");
  }, [marketType]);

  const outcomes = useMemo(() => parseOutcomes(outcomesText), [outcomesText]);

  const outcomesError = useMemo(() => {
    if (marketType === 0) return outcomes.length === 2 ? null : "Binary must have exactly 2 outcomes.";
    return outcomes.length >= 2 && outcomes.length <= 10 ? null : "Multi-choice must have 2 to 10 outcomes.";
  }, [marketType, outcomes.length]);

  const canSubmit =
    connected &&
    !!publicKey &&
    !!program &&
    question.trim().length >= 10 &&
    !questionError &&
    !descriptionError &&
    !outcomesError &&
    !!category &&
    !!resolutionDate &&
    resolutionDate > new Date();

  const handleQuestionChange = (value: string) => {
    setQuestion(value);
    const v = validateMarketQuestion(value);
    setQuestionError(v.valid ? null : v.error || null);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    const v = validateMarketDescription(value);
    setDescriptionError(v.valid ? null : v.error || null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) return setImageError("Image must be less than 5MB");
    if (!file.type.startsWith("image/")) return setImageError("File must be an image");

    setImageError("");
    setImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageError("");
  };

  async function ensureUserCounter(userCounterPDA: PublicKey) {
    const info = await connection.getAccountInfo(userCounterPDA);
    if (info) return;

    const sig = await (program as any).methods
      .initializeUserCounter()
      .accounts({
        userCounter: userCounterPDA,
        authority: publicKey!,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await new Promise((r) => setTimeout(r, 1200));
    console.log("User counter initialized:", sig);
  }

  async function deriveFreeMarketPda(displayQuestion: string) {
    for (let i = 0; i < 10; i++) {
      const suffix = randomBase36(6);
      const seededQuestion = makeSeededQuestion(displayQuestion, suffix);

      const marketPda = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), publicKey!.toBuffer(), Buffer.from(seededQuestion, "utf8")],
        (program as any).programId
      )[0];

      const info = await connection.getAccountInfo(marketPda);
      if (!info) return { marketPda, seededQuestion };
    }
    throw new Error("Could not find a free market PDA. Try changing the question.");
  }

  async function handleCreateMarket() {
    if (!canSubmit || !publicKey || !program) return;

    setLoading(true);
    try {
      const [userCounterPDA] = getUserCounterPDA(publicKey);
      const { marketPda, seededQuestion } = await deriveFreeMarketPda(question);

      await ensureUserCounter(userCounterPDA);

      const resolutionTimestamp = Math.floor(resolutionDate.getTime() / 1000);

      console.log("Creating market with:", {
        seededQuestion,
        uiQuestion: question,
        marketType,
        outcomes,
        resolutionTimestamp,
      });

      const tx = await (program as any).methods
        .createMarket(seededQuestion, description ?? "", new BN(resolutionTimestamp), marketType, outcomes)
        .accounts({
          market: marketPda,
          creator: publicKey,
          userCounter: userCounterPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Market created! Transaction:", tx);

      // ✅ FETCH ON-CHAIN TRUTH, then index
      const acct: any = await (program as any).account.market.fetch(marketPda);

      const onchainType =
        typeof acct?.marketType === "number" ? acct.marketType :
        typeof acct?.market_type === "number" ? acct.market_type :
        Number(marketType) || 0;

      const onchainNames =
        toStringArray(acct?.outcomeNames).length ? toStringArray(acct?.outcomeNames) :
        toStringArray(acct?.outcome_names).length ? toStringArray(acct?.outcome_names) :
        outcomes;

      const onchainSupplies =
        toNumberArray(acct?.outcomeSupplies).length ? toNumberArray(acct?.outcomeSupplies) :
        toNumberArray(acct?.outcome_supplies).length ? toNumberArray(acct?.outcome_supplies) :
        new Array(onchainNames.length).fill(0);

      console.log("✅ ON-CHAIN MARKET CHECK", {
        market_address: marketPda.toBase58(),
        market_type: onchainType,
        outcome_names: onchainNames,
        outcome_supplies: onchainSupplies,
      });

      const isBinary = onchainType === 0 && onchainNames.length === 2;

      await indexMarket({
        market_address: marketPda.toBase58(),
        question: question.slice(0, 200),
        description: description || undefined,
        category: category || "other",
        image_url: imagePreview || undefined,
        end_date: resolutionDate.toISOString(),
        creator: publicKey.toBase58(),
        social_links: socialLinks,

        market_type: onchainType,
        outcome_names: onchainNames,
        outcome_supplies: onchainSupplies,

        yes_supply: isBinary ? (onchainSupplies[0] ?? 0) : null,
        no_supply: isBinary ? (onchainSupplies[1] ?? 0) : null,

        total_volume: 0,
        resolved: false,
      });

      router.push(`/trade/${marketPda.toBase58()}`);
    } catch (e: any) {
      console.error("Create market error:", e);
      alert(e?.message || "Failed to create market");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Create Market</h1>
        <p className="text-gray-400">Launch a prediction market. Keep it clean - banned words are blocked.</p>
      </div>

      <div className="card-pump">
        {/* Question */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Question * <span className="text-gray-500 font-normal text-sm ml-2">({question.length}/200)</span>
          </label>
          <input
            type="text"
            value={question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            maxLength={200}
            className={`input-pump w-full ${questionError ? "input-error" : ""}`}
            placeholder={marketType === 0 ? "Will SOL reach $500 in 2025?" : "Which team wins the Super Bowl?"}
          />
          {questionError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {questionError}</p>}
        </div>

        {/* Description */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Description (optional) <span className="text-gray-500 font-normal text-sm ml-2">({description.length}/500)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            maxLength={500}
            rows={4}
            className={`input-pump w-full ${descriptionError ? "input-error" : ""}`}
            placeholder="Describe the resolution conditions..."
          />
          {descriptionError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {descriptionError}</p>}
        </div>

        {/* Market type */}
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
        </div>

        {/* Outcomes */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Outcomes (1 per line) * <span className="text-gray-500 font-normal text-sm ml-2">({marketType === 0 ? "must be 2" : "2 to 10"})</span>
          </label>
          <textarea
            value={outcomesText}
            onChange={(e) => setOutcomesText(e.target.value)}
            rows={4}
            className={`input-pump w-full ${outcomesError ? "input-error" : ""}`}
            placeholder={marketType === 0 ? "YES\nNO" : "packers\nbroncos"}
          />
          <div className="text-xs text-gray-500 mt-2">Parsed: {outcomes.length} {outcomes.length ? `(${outcomes.join(", ")})` : ""}</div>
          {outcomesError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {outcomesError}</p>}
        </div>

        {/* Category */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Category *</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as CategoryId)} className="input-pump w-full">
            {CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Image */}
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

              {imageError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {imageError}</p>}

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
                  <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/80 to-transparent" />
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

        {/* End Date */}
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
        </div>

        {/* Social */}
        <div className="mb-8 pb-8 border-b border-gray-800">
          <SocialLinksForm value={socialLinks} onChange={setSocialLinks} />
        </div>

        {/* Submit */}
        <button
          onClick={handleCreateMarket}
          disabled={!canSubmit || loading}
          className={`w-full py-4 rounded-lg font-bold text-lg transition ${
            canSubmit && !loading ? "btn-pump glow-green" : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {loading ? "Creating..." : "Launch Market 🚀"}
        </button>
      </div>
    </div>
  );
}
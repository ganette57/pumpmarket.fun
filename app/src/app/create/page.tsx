"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { SystemProgram, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Calendar, Upload, X, Plus, Trash2 } from "lucide-react";
import Image from "next/image";

import { validateMarketQuestion, validateMarketDescription } from "@/utils/bannedWords";
import { CATEGORIES, CategoryId } from "@/utils/categories";
import SocialLinksForm, { SocialLinks } from "@/components/SocialLinksForm";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";

import { useProgram } from "@/hooks/useProgram";
import { indexMarket } from "@/lib/markets";

// ---------- helpers ----------
function parseOutcomes(text: string) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function toStringArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String).map((s) => s.trim()).filter(Boolean);
  return [];
}

function outcomesToText(arr: string[]) {
  return (arr || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .join("\n");
}

function TypeCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left rounded-2xl border p-4 transition",
        active
          ? "border-pump-green bg-pump-green/10"
          : "border-white/10 bg-pump-dark/40 hover:border-white/20",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-white font-bold">{title}</div>
        {active && (
          <span className="px-2 py-1 rounded-full text-xs font-semibold border border-pump-green/40 bg-pump-green/10 text-pump-green">
            Selected
          </span>
        )}
      </div>
      <div className="text-sm text-gray-400 mt-1">{desc}</div>
    </button>
  );
}

export default function CreateMarketPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const program = useProgram();

  const [loading, setLoading] = useState(false);

  // Tx guard: prevent double-submit
  const inFlightRef = useRef<Record<string, boolean>>({});

  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CategoryId>("crypto");

  const [marketType, setMarketType] = useState<0 | 1>(0); // 0=binary, 1=multi
  const [outcomesText, setOutcomesText] = useState("YES\nNO");

  // ✅ new UI state (but we still keep outcomesText as canonical for existing flow)
  const [outcomeInputs, setOutcomeInputs] = useState<string[]>(["YES", "NO"]);

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

  // ✅ On-chain defaults (hidden from user)
  const DEFAULT_B_SOL = 10; // must be > 0
  const DEFAULT_MAX_POSITION_BPS = 10_000; // 10_000 = disabled
  const DEFAULT_MAX_TRADE_SHARES = 5_000_000; // allowed max
  const DEFAULT_COOLDOWN_SECONDS = 0; // disabled

  // when switching type: reset/ensure valid outcomes UI
  useEffect(() => {
    if (marketType === 0) {
      setOutcomeInputs(["YES", "NO"]);
    } else {
      setOutcomeInputs((prev) => {
        const cleaned = (prev || []).map((s) => String(s || "").trim()).filter(Boolean);
        if (cleaned.length >= 2) return cleaned.slice(0, 10);
        return ["Option 1", "Option 2"];
      });
    }
  }, [marketType]);

  // sync: outcomeInputs -> outcomesText (so existing parseOutcomes/outcomes stays same)
  useEffect(() => {
    const txt = outcomesToText(outcomeInputs);
    setOutcomesText(txt || (marketType === 0 ? "YES\nNO" : "Option 1\nOption 2"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeInputs]);

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

  function updateOutcomeAt(i: number, value: string) {
    setOutcomeInputs((prev) => {
      const next = prev.slice();
      next[i] = value;
      return next;
    });
  }

  function addOutcome() {
    setOutcomeInputs((prev) => {
      if (prev.length >= 10) return prev;
      const next = prev.slice();
      next.push(`Option ${next.length + 1}`);
      return next;
    });
  }

  function removeOutcome(i: number) {
    setOutcomeInputs((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.slice();
      next.splice(i, 1);
      return next;
    });
  }

  async function handleCreateMarket() {
    if (!canSubmit || !publicKey || !program) return;

    // Tx guard: prevent double-submit
    const key = "create_market";
    if (inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;
    setLoading(true);

    try {
      // Market is `init` without seeds => real Keypair
      const marketKeypair = Keypair.generate();
      const resolutionTimestamp = Math.floor(resolutionDate.getTime() / 1000);

      // defaults -> on-chain args
      const bLamportsU64 = Math.floor(DEFAULT_B_SOL * 1_000_000_000);

      const txSig = await (program as any).methods
        .createMarket(
          new BN(resolutionTimestamp), // i64
          outcomes, // Vec<String>
          marketType, // u8
          new BN(bLamportsU64), // u64
          DEFAULT_MAX_POSITION_BPS, // u16
          new BN(DEFAULT_MAX_TRADE_SHARES), // u64
          new BN(DEFAULT_COOLDOWN_SECONDS) // i64
        )
        .accounts({
          market: marketKeypair.publicKey,
          creator: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([marketKeypair])
        .rpc();

      console.log("Market created! tx:", txSig);

      // Confirm transaction before proceeding
      await connection.confirmTransaction(txSig, "confirmed");

      // Fetch on-chain truth (recommended)
      let onchainType = Number(marketType) || 0;
      let onchainNames = outcomes;
      let onchainSupplies: number[] = new Array(outcomes.length).fill(0);

      try {
        const acct: any = await (program as any).account.market.fetch(marketKeypair.publicKey);

        onchainType = Number(acct?.marketType ?? acct?.market_type ?? onchainType) || 0;

        const namesA = toStringArray(acct?.outcomeNames);
        const namesB = toStringArray(acct?.outcome_names);
        if (namesA.length) onchainNames = namesA;
        else if (namesB.length) onchainNames = namesB;

        if (Array.isArray(acct?.q)) {
          const qNums = acct.q.map((v: any) => Number(v) || 0);
          onchainSupplies = qNums.slice(0, onchainNames.length);
        }
      } catch (fetchErr) {
        console.warn("Could not fetch on-chain market (still ok):", fetchErr);
      }

      const isBinary = onchainType === 0 && onchainNames.length === 2;

      await indexMarket({
        market_address: marketKeypair.publicKey.toBase58(),
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
      } as any);

      router.push(`/trade/${marketKeypair.publicKey.toBase58()}`);
    } catch (e: any) {
      console.error("Create market error:", e);
      const errMsg = String(e?.message || "");

      // Handle "already been processed" gracefully
      if (errMsg.toLowerCase().includes("already been processed")) {
        alert("Transaction already processed. Refreshing…");
        router.refresh();
        return;
      }

      // Handle user rejection
      if (errMsg.toLowerCase().includes("user rejected")) {
        alert("Transaction cancelled by user.");
        return;
      }

      alert(errMsg || "Failed to create market");
    } finally {
      inFlightRef.current[key] = false;
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
      <div className="mb-7 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Create Market</h1>
        <p className="text-gray-400">Launch a prediction market. Keep it clean - Make it Fun.</p>
      </div>

      <div className="card-pump">
        {/* Question */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Question *{" "}
            <span className="text-gray-500 font-normal text-sm ml-2">({question.length}/200)</span>
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
            Description (optional){" "}
            <span className="text-gray-500 font-normal text-sm ml-2">({description.length}/500)</span>
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

        {/* Market type (clean cards) */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Market type *</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TypeCard
              active={marketType === 0}
              onClick={() => setMarketType(0)}
              title="Binary"
              desc="Exactly 2 outcomes (YES/NO). Clean + fast."
            />
            <TypeCard
              active={marketType === 1}
              onClick={() => setMarketType(1)}
              title="Multi-choice"
              desc="2–10 outcomes. Add/remove options easily."
            />
          </div>
        </div>

        {/* Outcomes (dynamic inputs) */}
        <div className="mb-6">
          <div className="flex items-end justify-between gap-3 mb-2">
            <label className="block text-white font-semibold">
              Outcomes *{" "}
              <span className="text-gray-500 font-normal text-sm ml-2">
                ({marketType === 0 ? "must be 2" : "2 to 10"})
              </span>
            </label>

            {marketType === 1 && (
              <button
                type="button"
                onClick={addOutcome}
                disabled={outcomeInputs.length >= 10}
                className={[
                  "px-3 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2",
                  outcomeInputs.length >= 10
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-pump-green text-black hover:opacity-90",
                ].join(" ")}
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            )}
          </div>

          <div className="space-y-2">
            {outcomeInputs.map((val, idx) => {
              const showRemove = marketType === 1 && outcomeInputs.length > 2;

              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-12 text-xs text-gray-500 font-mono flex-shrink-0">
                    {marketType === 0 ? (idx === 0 ? "YES" : "NO") : `#${idx + 1}`}
                  </div>

                  <input
                    value={val}
                    onChange={(e) => updateOutcomeAt(idx, e.target.value)}
                    className={`input-pump w-full ${outcomesError ? "input-error" : ""}`}
                    placeholder={marketType === 0 ? (idx === 0 ? "YES" : "NO") : `Option ${idx + 1}`}
                  />

                  {showRemove ? (
                    <button
                      type="button"
                      onClick={() => removeOutcome(idx)}
                      className="w-10 h-10 rounded-lg border border-white/10 bg-black/30 hover:border-white/20 transition flex items-center justify-center"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4 text-gray-300" />
                    </button>
                  ) : (
                    <div className="w-10 h-10" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-xs text-gray-500 mt-2">
            Parsed: {outcomes.length} {outcomes.length ? `(${outcomes.join(", ")})` : ""}
          </div>
          {outcomesError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {outcomesError}</p>}

          {/* keep outcomesText (debug + flow safety) */}
          <textarea value={outcomesText} readOnly className="hidden" />
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
          aria-busy={loading}
          className={`w-full py-4 rounded-lg font-bold text-lg transition ${
            canSubmit && !loading ? "btn-pump glow-green" : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {loading ? "Processing..." : "Launch Market 🚀"}
        </button>
      </div>
    </div>
  );
}
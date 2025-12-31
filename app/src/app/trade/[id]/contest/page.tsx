"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { contestResolution } from "@/lib/contest";

export default function ContestPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params as any)?.id as string;

  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (!id) return;
    setSubmitting(true);
    try {
      await contestResolution(id, { note, proofUrl: proofUrl || undefined });
      router.push(`/trade/${id}`);
    } catch (e: any) {
      alert(e?.message || "Failed to contest");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="card-pump">
        <h1 className="text-2xl font-bold text-white">Contest resolution</h1>
        <p className="text-sm text-gray-400 mt-2">
          Explain why the proposed resolution is wrong and attach any proof.
        </p>

        <div className="mt-6 space-y-3">
          <label className="block text-sm text-gray-300">Proof URL (optional)</label>
          <input
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            className="w-full rounded-lg bg-pump-dark/60 border border-gray-800 px-3 py-2 text-gray-100"
            placeholder="https://..."
          />

          <label className="block text-sm text-gray-300 mt-3">Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full min-h-[120px] rounded-lg bg-pump-dark/60 border border-gray-800 px-3 py-2 text-gray-100"
            placeholder="Describe the issue..."
          />
        </div>

        <div className="mt-6 flex items-center gap-2">
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 px-4 py-2 rounded-lg bg-pump-green text-black font-semibold disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit dispute"}
          </button>

          <Link
            href={`/trade/${id}`}
            className="px-4 py-2 rounded-lg border border-white/10 text-gray-200 hover:bg-white/5 transition"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
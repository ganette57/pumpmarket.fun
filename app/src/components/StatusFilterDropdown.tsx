"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StatusFilter } from "@/lib/marketStatus";

export default function StatusFilterDropdown({
  value,
  onChange,
  label = "Status",
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const Item = ({ v, text }: { v: StatusFilter; text: string }) => (
    <button
      onClick={() => {
        onChange(v);
        setOpen(false);
      }}
      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-black/5 rounded-xl"
    >
      <span className={`w-5 h-5 rounded-full border ${value === v ? "border-gray-800 bg-gray-800" : "border-gray-400"}`} />
      <span className="text-gray-900">{text}</span>
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((x) => !x)}
        className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 bg-white/70 border border-gray-200 shadow-sm text-gray-800 font-semibold"
      >
        <span className="text-gray-500">{label}:</span>
        <span className="text-gray-900 capitalize">{value}</span>
        <ChevronDown className="w-4 h-4 opacity-70" />
      </button>

      {open && (
        <div className="absolute mt-2 w-56 rounded-2xl bg-white border border-gray-200 shadow-lg p-2 z-50">
          <Item v="all" text="All" />
          <Item v="open" text="Open" />
          <Item v="resolved" text="Resolved" />
        </div>
      )}
    </div>
  );
}
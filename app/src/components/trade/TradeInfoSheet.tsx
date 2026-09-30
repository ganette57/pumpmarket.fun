"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Lightweight native modal: focus containment, Escape, and restored trigger focus. */
export default function TradeInfoSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  return createPortal(
    <dialog ref={ref} aria-labelledby="trade-info-title" onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="trade-info-sheet fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-[#101010] p-0 text-white backdrop:bg-black/65">
      <div className="flex max-h-[85dvh] flex-col" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
        <div aria-hidden className="mx-auto mt-3 h-1 w-8 rounded-full bg-gray-600" />
        <header className="flex shrink-0 items-center justify-between px-5 py-2">
          <h2 id="trade-info-title" className="text-lg font-semibold">{title}</h2>
          <button autoFocus onClick={onClose} aria-label={`Close ${title}`} className="h-11 w-11 text-2xl text-gray-400">×</button>
        </header>
        <div className="trade-info-content overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </div>
      <style jsx>{`
        .trade-info-sheet :global(.card-pump) { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
        .trade-info-sheet :global(.trade-info-content div.rounded-xl),
        .trade-info-sheet :global(.trade-info-content div.rounded-2xl),
        .trade-info-sheet :global(.trade-info-content div.rounded-lg) { border-color: transparent; border-radius: 0; background: transparent; box-shadow: none; }
        .trade-info-sheet[open] { animation: rise .18s ease-out; }
        @keyframes rise { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .trade-info-sheet[open] { animation: none; } }
      `}</style>
    </dialog>, document.body);
}

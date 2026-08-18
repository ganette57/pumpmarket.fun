"use client";

// src/components/wallet/AddFundsProvider.tsx
//
// Owns the ONE Add Funds modal instance, mounted at the app root.
//
// WHY THIS EXISTS — two bugs, one cause
// -------------------------------------
// AddFundsModal used to be rendered by AccountPanel, which lives inside
// the header's dropdown. That put it in the wrong place twice over:
//
//  1. CONTAINING BLOCK. The header is `fixed … backdrop-blur`, and
//     backdrop-filter makes an element the containing block for `position:
//     fixed` DESCENDANTS. So the modal's `fixed inset-0` resolved against
//     a 64px-tall header instead of the viewport — clipped off the top on
//     desktop, and squeezed into the 288px (`w-72`, `overflow-hidden`)
//     dropdown on mobile. A portal alone fixes this.
//
//  2. LIFETIME. Both header menus close on any mousedown outside their
//     menuRef. A portaled modal is outside that ref, so the FIRST CLICK
//     INSIDE THE MODAL closed the menu, unmounted AccountPanel, and took
//     the modal with it. No amount of CSS fixes that — the modal simply
//     cannot be owned by the dropdown that launches it.
//
// Mounting here solves both: the modal is not a descendant of the header,
// and it outlives the menu.
//
// The refresh callback is passed IN at open() time rather than owned here,
// because `useSolBalance` instances are independent — refreshing a copy
// created in this provider would not update the number AccountPanel is
// actually displaying. The caller hands us its own refresh.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AddFundsModal from "@/components/wallet/AddFundsModal";

type OpenOptions = {
  /** Called when money may have moved. Typically the caller's sol.refresh. */
  onFunded?: () => void;
};

type AddFundsContextValue = {
  open: (options?: OpenOptions) => void;
  close: () => void;
};

const AddFundsContext = createContext<AddFundsContextValue | null>(null);

export function AddFundsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const onFundedRef = useRef<(() => void) | undefined>(undefined);

  const open = useCallback((options?: OpenOptions) => {
    onFundedRef.current = options?.onFunded;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    onFundedRef.current = undefined;
  }, []);

  const value = useMemo<AddFundsContextValue>(() => ({ open, close }), [open, close]);

  return (
    <AddFundsContext.Provider value={value}>
      {children}
      <AddFundsModal
        open={isOpen}
        onClose={close}
        onFunded={() => onFundedRef.current?.()}
      />
    </AddFundsContext.Provider>
  );
}

export function useAddFunds(): AddFundsContextValue {
  const ctx = useContext(AddFundsContext);
  if (!ctx) {
    throw new Error("useAddFunds must be used inside <AddFundsProvider>");
  }
  return ctx;
}

"use client";

// src/components/wallet/AddFundsButton.tsx
//
// The trigger. It no longer OWNS the modal — AddFundsProvider mounts the
// single instance at the app root, so the modal survives this button's
// dropdown being dismissed. See AddFundsProvider for why that matters.
//
// The caller's own balance-refresh callback is forwarded at open() time,
// because useSolBalance instances are independent and only the caller's
// copy is the one on screen.

import { useAddFunds } from "@/components/wallet/AddFundsProvider";

export default function AddFundsButton({
  className = "",
  label = "Add funds",
  onFunded,
  /** Lets the host dismiss its dropdown as the modal takes over. */
  onOpen,
}: {
  className?: string;
  label?: string;
  onFunded?: () => void;
  onOpen?: () => void;
}) {
  const { open } = useAddFunds();

  return (
    <button
      type="button"
      onClick={() => {
        open({ onFunded });
        onOpen?.();
      }}
      className={
        className ||
        "h-10 w-full rounded-xl bg-pump-green font-semibold text-black transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70 focus-visible:ring-offset-2 focus-visible:ring-offset-pump-gray"
      }
    >
      {label}
    </button>
  );
}

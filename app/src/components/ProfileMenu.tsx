"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import AccountPanel from "@/components/wallet/AccountPanel";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { getProfile } from "@/lib/profiles";

const DOCS_URL = "https://funmarket.gitbook.io/funmarket/";
const TERMS_URL = "https://funmarket.gitbook.io/funmarket/terms-of-use";
const PRIVACY_URL = "https://funmarket.gitbook.io/funmarket/privacy-policy";

type ProfileMenuProps = {
  trigger: "avatar" | "ellipsis";
};

function useClickOutside(
  ref: React.RefObject<HTMLDivElement>,
  onClose: () => void,
) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, onClose]);
}

/**
 * The account/profile menu shared by the desktop header and the mobile
 * Profile page. Its contents live here so permissions, navigation and account
 * actions cannot drift between the two entry points.
 */
export default function ProfileMenu({ trigger }: ProfileMenuProps) {
  const { connected, publicKey, disconnect } = useFunMarketWallet();
  const onboarding = useOnboarding();
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerAvatarUrl, setHeaderAvatarUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuRef, () => setMenuOpen(false));

  const avatarLabel = useMemo(() => {
    return publicKey ? publicKey.toBase58().slice(0, 2).toUpperCase() : "??";
  }, [publicKey]);

  useEffect(() => {
    if (trigger !== "avatar" || !connected || !publicKey) {
      setHeaderAvatarUrl(null);
      return;
    }

    let cancelled = false;
    getProfile(publicKey.toBase58()).then((profile) => {
      if (!cancelled) setHeaderAvatarUrl(profile?.avatar_url ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, trigger]);

  return (
    <div className="relative" ref={menuRef}>
      {trigger === "avatar" ? (
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-l font-semibold text-gray-200 transition overflow-hidden hover:border-gray-400 hover:text-white"
          aria-label="Open menu"
        >
          {connected && headerAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerAvatarUrl} alt="" className="h-full w-full object-cover" />
          ) : connected ? (
            avatarLabel
          ) : (
            "☰"
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-gray-300 backdrop-blur transition hover:border-white/20 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green"
          aria-label="Open profile menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {menuOpen && (
        <div
          role={trigger === "ellipsis" ? "menu" : undefined}
          className="absolute right-0 mt-2 w-64 rounded-xl border border-pump-border bg-pump-gray py-2 text-sm text-gray-100 shadow-lg z-[100]"
        >
          {/* Account: Google sign-in, Real wallet, add funds */}
          <AccountPanel onNavigate={() => setMenuOpen(false)} />

          <div className="h-px bg-gray-700/50 my-1" />

          {/* Connected-only */}
          {connected && publicKey && (
            <Link
              href={`/profile/${publicKey.toBase58()}`}
              className="block px-4 py-2 hover:bg-pump-dark"
              onClick={() => setMenuOpen(false)}
              role={trigger === "ellipsis" ? "menuitem" : undefined}
            >
              👤 Profile
            </Link>
          )}
          {connected && (
            <Link
              href="/dashboard"
              className="block px-4 py-2 hover:bg-pump-dark"
              onClick={() => setMenuOpen(false)}
              role={trigger === "ellipsis" ? "menuitem" : undefined}
            >
              Dashboard
            </Link>
          )}

          {/* Public pages */}
          <Link
            href="/leaderboard"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            🏆 Leaderboard
          </Link>

          <Link
            href="/referrals"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            🤝 Referrals
          </Link>

          <Link
            href="/treasury"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            💰 Treasury
          </Link>

          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            📚 Documentation
          </a>

          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            📜 Terms of Use
          </a>

          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            🔒 Privacy Policy
          </a>

          {/* Replays the three-step tour. Same steps as first run; opening it
              here never resets the first-run flag. */}
          <button
            type="button"
            className="block w-full px-4 py-2 text-left font-bold text-pump-green hover:bg-pump-dark"
            onClick={() => {
              setMenuOpen(false);
              onboarding.open();
            }}
            role={trigger === "ellipsis" ? "menuitem" : undefined}
          >
            How it works
          </button>

          {/* Disconnect */}
          {connected && (
            <>
              <div className="h-px bg-gray-700/50 my-1" />
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-red-400 hover:bg-pump-dark hover:text-red-300"
                onClick={async () => {
                  setMenuOpen(false);
                  try {
                    await disconnect();
                  } catch {
                    // ignore
                  }
                }}
                role={trigger === "ellipsis" ? "menuitem" : undefined}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

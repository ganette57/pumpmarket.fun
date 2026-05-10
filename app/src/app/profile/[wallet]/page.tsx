// src/app/profile/[wallet]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { supabase } from "@/lib/supabaseClient";
import {
  getProfile,
  getFollowerCount,
  getFollowingCount,
  isFollowing as isFollowingDb,
  followProfile,
  unfollowProfile,
  type Profile,
} from "@/lib/profiles";
import { parseSupabaseEndDateToResolutionTime } from "@/lib/markets";
import { lamportsToSol } from "@/utils/solana";
import MarketCard from "@/components/MarketCard";
import EditProfileModal from "@/components/EditProfileModal";
import FollowListModal from "@/components/FollowListModal";
import ActivityList from "@/components/ActivityList";
import { UserPlus, Check, Pencil } from "lucide-react";

type DbMarketRow = {
  market_address: string;
  question: string | null;
  category: string | null;
  image_url: string | null;
  total_volume: number | null;
  end_date: string | null;
  resolved: boolean | null;
  outcome_names: any;
  outcome_supplies: any;
  yes_supply: number | null;
  no_supply: number | null;
  created_at?: string | null;
};

function shortAddr(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function PublicProfilePage() {
  const params = useParams<{ wallet: string }>();
  const wallet = String(params?.wallet || "").trim();
  const { publicKey, connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const viewerWallet = useMemo(
    () => (connected && publicKey ? publicKey.toBase58() : null),
    [connected, publicKey],
  );
  const isOwnProfile = !!(viewerWallet && viewerWallet === wallet);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [markets, setMarkets] = useState<DbMarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [listMode, setListMode] = useState<"followers" | "following" | null>(null);
  const [tab, setTab] = useState<"markets" | "activity">("markets");

  // Default tab: own profile → Activity, other profile → Markets.
  // Re-evaluates when isOwnProfile flips (e.g. wallet connects/disconnects).
  useEffect(() => {
    setTab(isOwnProfile ? "activity" : "markets");
  }, [isOwnProfile]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const [p, mkRes, fCount, gCount] = await Promise.all([
        getProfile(wallet),
        supabase
          .from("markets")
          .select(
            "market_address,question,category,image_url,total_volume,end_date,resolved,outcome_names,outcome_supplies,yes_supply,no_supply,created_at",
          )
          .eq("creator", wallet)
          .order("created_at", { ascending: false })
          .limit(60),
        getFollowerCount(wallet),
        getFollowingCount(wallet),
      ]);

      if (cancelled) return;
      setProfile(p);
      setMarkets(((mkRes.data as DbMarketRow[]) || []).filter((m) => !!m.market_address));
      setFollowerCount(fCount);
      setFollowingCount(gCount);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet]);

  // Resolve "is the viewer following this profile" whenever either side changes.
  useEffect(() => {
    if (!viewerWallet || !wallet || viewerWallet === wallet) {
      setFollowing(false);
      return;
    }
    let cancelled = false;
    isFollowingDb(viewerWallet, wallet).then((v) => {
      if (!cancelled) setFollowing(v);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerWallet, wallet]);

  const totalVolumeSol = useMemo(() => {
    const sum = markets.reduce((acc, m) => acc + Number(m.total_volume || 0), 0);
    return lamportsToSol(sum);
  }, [markets]);
  const displayName =
    profile?.display_name && profile.display_name.trim().length > 0
      ? profile.display_name
      : shortAddr(wallet);

  const initials = useMemo(() => {
    const src = (profile?.display_name || wallet).trim();
    return src.slice(0, 2).toUpperCase();
  }, [profile, wallet]);

  return (
    <div className="min-h-screen bg-black pb-24 md:pb-12">
      {/* HEADER */}
      <section className="relative">
        {/* subtle neon backdrop */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-pump-green/10 via-pump-green/[0.03] to-transparent pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-4 pt-6 md:pt-10">
          <div className="flex flex-col items-center text-center">
            {/* Avatar */}
            <div className="relative">
              <div className="h-24 w-24 md:h-28 md:w-28 rounded-full overflow-hidden border-2 border-pump-green bg-gray-900 flex items-center justify-center text-2xl font-bold text-white shadow-[0_0_30px_rgba(0,255,135,0.25)]">
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar_url}
                    alt={displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>

            {/* Name + handle */}
            <h1 className="mt-3 text-xl md:text-2xl font-bold text-white truncate max-w-full">
              {displayName}
            </h1>
            <p className="mt-0.5 text-xs md:text-sm text-gray-400 font-mono">
              {shortAddr(wallet)}
            </p>

            {/* Bio */}
            <p className="mt-3 max-w-md text-sm text-gray-300/90 leading-relaxed whitespace-pre-line">
              {profile?.bio && profile.bio.trim().length > 0
                ? profile.bio
                : "Building markets on FunMarket. Predict the future, one outcome at a time."}
            </p>

            {/* Stats row — minimal: bold values, gray labels, thin dividers */}
            <div className="mt-5 flex items-center justify-center gap-3 sm:gap-5 text-sm w-full max-w-md flex-wrap">
              <StatInline
                value={loading ? "—" : markets.length.toString()}
                label="Markets"
              />
              <StatDivider />
              <StatInline
                value={loading ? "—" : `${totalVolumeSol.toFixed(2)} SOL`}
                label="Volume"
              />
              <StatDivider />
              <StatInline
                value={followerCount.toString()}
                label="Followers"
                onClick={() => setListMode("followers")}
              />
              <StatDivider />
              <StatInline
                value={followingCount.toString()}
                label="Following"
                onClick={() => setListMode("following")}
              />
            </div>

            {/* Edit (own profile) or Follow (other profiles, real DB) */}
            {isOwnProfile ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="mt-5 inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-sm font-semibold transition w-full max-w-xs bg-transparent border border-pump-green text-pump-green hover:bg-pump-green/10"
              >
                <Pencil className="w-4 h-4" />
                Edit profile
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    if (followBusy) return;
                    if (!viewerWallet) {
                      setFollowError(null);
                      setWalletModalVisible(true);
                      return;
                    }
                    setFollowError(null);
                    setFollowBusy(true);
                    const prevFollowing = following;
                    const prevCount = followerCount;
                    const nextFollowing = !prevFollowing;
                    setFollowing(nextFollowing);
                    setFollowerCount((c) => Math.max(0, c + (nextFollowing ? 1 : -1)));
                    try {
                      if (nextFollowing) {
                        await followProfile(viewerWallet, wallet);
                      } else {
                        await unfollowProfile(viewerWallet, wallet);
                      }
                    } catch (e: any) {
                      setFollowing(prevFollowing);
                      setFollowerCount(prevCount);
                      setFollowError(e?.message || "Action failed.");
                    } finally {
                      setFollowBusy(false);
                    }
                  }}
                  disabled={followBusy}
                  className={`mt-5 inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-sm font-semibold transition w-full max-w-xs disabled:opacity-60 ${
                    following
                      ? "bg-transparent border border-pump-green text-pump-green hover:bg-pump-green/10"
                      : "bg-pump-green text-black hover:bg-pump-green/90"
                  }`}
                  aria-pressed={following}
                >
                  {following ? (
                    <>
                      <Check className="w-4 h-4" />
                      {followBusy ? "Updating…" : "Following"}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      {followBusy ? "Updating…" : "Follow"}
                    </>
                  )}
                </button>
                {!viewerWallet && (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Connect wallet to follow.
                  </p>
                )}
                {followError && (
                  <p className="mt-2 text-[11px] text-red-400">{followError}</p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Edit modal — own profile only */}
      {isOwnProfile && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          wallet={wallet}
          initial={{
            display_name: profile?.display_name ?? null,
            bio: profile?.bio ?? null,
            avatar_url: profile?.avatar_url ?? null,
          }}
          onSaved={(next) => {
            setProfile((prev) => ({
              wallet_address: prev?.wallet_address ?? wallet,
              display_name: next.display_name,
              bio: next.bio,
              avatar_url: next.avatar_url,
            }));
          }}
        />
      )}

      {/* Followers / Following list modal */}
      <FollowListModal
        open={listMode !== null}
        onClose={() => setListMode(null)}
        wallet={wallet}
        mode={listMode ?? "followers"}
      />

      {/* TABS */}
      <section className="max-w-6xl mx-auto px-4 mt-8 md:mt-10">
        <div role="tablist" aria-label="Profile sections" className="flex items-center gap-6 border-b border-gray-800 mb-5">
          <TabButton
            label="Markets"
            active={tab === "markets"}
            onClick={() => setTab("markets")}
          />
          <TabButton
            label="Activity"
            active={tab === "activity"}
            onClick={() => setTab("activity")}
          />
        </div>

        {tab === "markets" ? (
          loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[340px] rounded-xl border border-gray-800 bg-[#05070b] animate-pulse"
                />
              ))}
            </div>
          ) : markets.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-gray-400 text-sm">No markets created yet.</p>
              <p className="text-gray-600 text-xs mt-1">
                When this creator launches a market, it will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
              {markets.map((m) => (
                <MarketCard
                  key={m.market_address}
                  market={{
                    publicKey: m.market_address,
                    question: m.question || "Untitled market",
                    category: m.category || "other",
                    imageUrl: m.image_url,
                    yesSupply: Number(m.yes_supply || 0),
                    noSupply: Number(m.no_supply || 0),
                    outcomeNames: Array.isArray(m.outcome_names)
                      ? (m.outcome_names as string[])
                      : undefined,
                    outcomeSupplies: Array.isArray(m.outcome_supplies)
                      ? (m.outcome_supplies as number[]).map((x) => Number(x))
                      : undefined,
                    resolutionTime: parseSupabaseEndDateToResolutionTime(m.end_date),
                    totalVolume: Number(m.total_volume || 0),
                    resolved: !!m.resolved,
                  }}
                  creatorProfile={profile}
                  creatorAddress={wallet}
                />
              ))}
            </div>
          )
        ) : (
          <ActivityList wallet={wallet} />
        )}
      </section>
    </div>
  );
}

function StatInline({
  value,
  label,
  onClick,
}: {
  value: string;
  label: string;
  onClick?: () => void;
}) {
  const baseClasses =
    "inline-flex items-baseline gap-1.5 leading-none whitespace-nowrap";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} group select-none -mx-1 px-1 py-0.5 rounded transition active:opacity-70`}
      >
        <span className="text-base font-bold text-white group-hover:text-pump-green transition-colors">
          {value}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-gray-400 group-hover:text-white transition-colors">
          {label}
        </span>
      </button>
    );
  }
  return (
    <span className={baseClasses}>
      <span className="text-base font-bold text-white">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </span>
    </span>
  );
}

function StatDivider() {
  return <span aria-hidden className="h-4 w-px bg-gray-800" />;
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative -mb-px pb-2.5 text-sm font-semibold transition ${
        active
          ? "text-white border-b-2 border-pump-green"
          : "text-gray-500 hover:text-gray-300 border-b-2 border-transparent"
      }`}
    >
      {label}
    </button>
  );
}

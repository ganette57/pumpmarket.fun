"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useWallet } from "@solana/wallet-adapter-react";

type CommentRow = {
  id: string;
  market_id: string;
  parent_id: string | null;
  user_address: string | null;
  content: string | null;
  likes: number | null;
  created_at: string;
};

function shortAddr(a?: string | null) {
  if (!a) return "—";
  if (a.length <= 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function initials(a?: string | null) {
  const s = shortAddr(a);
  return (s === "—" ? "DB" : s.slice(0, 2)).toUpperCase();
}

function Bubble({ addr }: { addr?: string | null }) {
  // petit “gradient” comme ton screen
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white
                    bg-gradient-to-br from-pump-green/70 via-pink-500/60 to-purple-500/60">
      {initials(addr)}
    </div>
  );
}

function IconLike({ filled }: { filled?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      className={filled ? "text-pump-green" : "text-gray-400"}
      fill={filled ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3v12ZM22 10.5a2 2 0 0 0-2-2h-6.31l.95-4.57.02-.23a1 1 0 0 0-.29-.7L13.17 2 6.59 8.59A2 2 0 0 0 6 10v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-1.7l1.38-9.8a2 2 0 0 0-.38-1.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconReply() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      className="text-gray-400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9 17l-5-5 5-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12h10a6 6 0 0 1 6 6v1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function CommentsSection({ marketId }: { marketId: string }) {
  const { publicKey, connected } = useWallet();
  const userAddress = publicKey?.toBase58() || null;

  const [marketDbId, setMarketDbId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);

  const [text, setText] = useState("");
  const [comments, setComments] = useState<CommentRow[]>([]);

  // reply UI
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  // resolve marketDbId from market address
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("markets")
          .select("id")
          .eq("market_address", marketId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setMarketDbId(data?.id ?? null);
      } catch {
        if (!cancelled) setMarketDbId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [marketId]);

  async function load() {
    if (!marketDbId) {
      setComments([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("comments")
        .select("id,market_id,parent_id,user_address,content,likes,created_at")
        .eq("market_id", marketDbId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setComments((data as CommentRow[]) || []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketDbId]);

  const { roots, childrenByParent } = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    const map = new Map<string, CommentRow[]>();
    for (const c of comments) {
      if (!c.parent_id) continue;
      const arr = map.get(c.parent_id) || [];
      arr.push(c);
      map.set(c.parent_id, arr);
    }
    map.forEach((arr, k) => {
      arr.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      map.set(k, arr);
    });
    return { roots, childrenByParent: map };
  }, [comments]);

  async function postComment(parentId: string | null) {
    if (!marketDbId) return;

    if (!connected || !userAddress) {
      alert("Please connect your wallet to comment.");
      return;
    }

    const content = (parentId ? replyText : text).trim();
    if (!content) return;

    setPosting(true);
    try {
      const payload = {
        market_id: marketDbId,
        parent_id: parentId,
        content,
        user_address: userAddress,
      };

      const { error } = await supabase.from("comments").insert(payload);
      if (error) throw error;

      if (parentId) {
        setReplyText("");
        setReplyTo(null);
      } else {
        setText("");
      }

      await load();
    } catch (e: any) {
      alert(e?.message || "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  async function likeComment(id: string) {
    try {
      const row = comments.find((c) => c.id === id);
      const current = Number(row?.likes || 0);

      const { error } = await supabase.from("comments").update({ likes: current + 1 }).eq("id", id);
      if (error) throw error;

      setComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, likes: Number(c.likes || 0) + 1 } : c))
      );
    } catch {}
  }

  const count = comments.filter((c) => !c.parent_id).length;
  const canPost = !!marketDbId && connected && !!userAddress && !posting;

  return (
    <div className="border-t border-gray-800 pt-8">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="text-pump-green">
          {/* bubble icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 1 1 18-4Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-2xl font-bold text-white">
          Discussion <span className="text-white/80">({count})</span>
        </div>

        <div className="ml-auto">
          <button
            onClick={() => void load()}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Composer (style screen) */}
      <div className="flex items-start gap-4">
        <Bubble addr={userAddress} />

        <div className="flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            placeholder={connected ? "Share your thoughts on this market..." : "Connect your wallet to comment..."}
            disabled={!connected}
            className="w-full min-h-[120px] rounded-xl border border-gray-700 bg-black/20
                       px-4 py-3 text-white outline-none placeholder:text-gray-500 resize-none
                       focus:border-gray-500"
            maxLength={500}
          />

          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-gray-500">{text.length}/500 characters</div>

            <button
              onClick={() => void postComment(null)}
              disabled={!canPost}
              className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold transition
                ${
                  !canPost
                    ? "bg-gray-800/40 text-gray-500 cursor-not-allowed border border-gray-800"
                    : "bg-pump-green text-black hover:brightness-110"
                }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22 2 11 13"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M22 2 15 22 11 13 2 9 22 2Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="mt-8 space-y-6">
        {roots.length === 0 ? (
          <div className="text-sm text-gray-500">No comments yet.</div>
        ) : (
          roots.map((c) => {
            const replies = childrenByParent.get(c.id) || [];
            const isReplying = replyTo === c.id;

            return (
              <div key={c.id}>
                <div className="flex items-start gap-4">
                  <Bubble addr={c.user_address} />

                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="text-white font-semibold">{shortAddr(c.user_address)}</div>
                      <div className="text-xs text-gray-500">{relTime(c.created_at)}</div>
                    </div>

                    <div className="mt-1 text-white/90 whitespace-pre-wrap break-words">
                      {c.content || ""}
                    </div>

                    <div className="mt-2 flex items-center gap-6 text-sm">
                      <button
                        onClick={() => void likeComment(c.id)}
                        className="inline-flex items-center gap-2 text-gray-300 hover:text-white"
                        title="Like"
                      >
                        <IconLike />
                        <span className="text-sm text-gray-300">{Number(c.likes || 0)}</span>
                      </button>

                      <button
                        onClick={() => {
                          if (!connected) return alert("Connect your wallet to reply.");
                          setReplyTo((p) => (p === c.id ? null : c.id));
                        }}
                        className="inline-flex items-center gap-2 text-gray-400 hover:text-gray-200"
                        title="Reply"
                      >
                        <IconReply />
                        Reply
                      </button>
                    </div>

                    {/* Reply composer (compact, comme avant) */}
                    {isReplying && (
                      <div className="mt-4 pl-10">
                        <div className="rounded-xl border border-gray-800 bg-black/20 p-3">
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value.slice(0, 500))}
                            placeholder="Write a reply..."
                            className="w-full min-h-[80px] bg-transparent text-white outline-none placeholder:text-gray-500 resize-none"
                            maxLength={500}
                          />
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setReplyTo(null);
                                setReplyText("");
                              }}
                              className="px-3 py-2 rounded-lg text-xs border border-gray-800 text-gray-300 hover:border-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void postComment(c.id)}
                              disabled={!canPost}
                              className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                                !canPost
                                  ? "bg-gray-800/40 text-gray-500 border border-gray-800 cursor-not-allowed"
                                  : "bg-pump-green/20 text-pump-green border border-pump-green hover:bg-pump-green/25"
                              }`}
                            >
                              {posting ? "Posting…" : "Reply"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Replies list */}
                    {replies.length > 0 && (
                      <div className="mt-5 pl-10 space-y-4">
                        {replies.map((r) => (
                          <div key={r.id} className="flex items-start gap-3">
                            <Bubble addr={r.user_address} />
                            <div className="flex-1">
                              <div className="flex items-center gap-3">
                                <div className="text-white font-semibold text-sm">
                                  {shortAddr(r.user_address)}
                                </div>
                                <div className="text-xs text-gray-500">{relTime(r.created_at)}</div>
                              </div>

                              <div className="mt-1 text-white/85 whitespace-pre-wrap break-words">
                                {r.content || ""}
                              </div>

                              <div className="mt-2">
                                <button
                                  onClick={() => void likeComment(r.id)}
                                  className="inline-flex items-center gap-2 text-gray-300 hover:text-white"
                                  title="Like"
                                >
                                  <IconLike />
                                  <span className="text-sm text-gray-300">
                                    {Number(r.likes || 0)}
                                  </span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
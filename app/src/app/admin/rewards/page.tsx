"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { isOfficialFixtureAdmin } from "@/lib/adminClient";
import { ExternalLink, Pencil, Save, Trash2, X } from "lucide-react";

type AdminTask = {
  id: string;
  title: string;
  description: string | null;
  points: number;
  task_type: string;
  url: string | null;
  active: boolean;
  created_at: string;
  updated_at?: string;
};

const TASK_TYPES = ["social", "trade", "community", "custom"];

type Draft = {
  title: string;
  description: string;
  points: number;
  task_type: string;
  url: string;
  active: boolean;
};

function toDraft(t: AdminTask): Draft {
  return {
    title: t.title,
    description: t.description ?? "",
    points: t.points,
    task_type: t.task_type,
    url: t.url ?? "",
    active: t.active,
  };
}

export default function AdminRewardsPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const isAdmin = isOfficialFixtureAdmin(wallet);

  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Create form
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPoints, setCreatePoints] = useState<number>(50);
  const [createType, setCreateType] = useState<string>("social");
  const [createUrl, setCreateUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rewards/tasks", { credentials: "include", cache: "no-store" });
      const j = await res.json();
      setTasks((j?.tasks as AdminTask[]) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    setMsg(null);
    if (!createTitle.trim()) { setMsg("Title is required"); return; }
    if (!Number.isFinite(createPoints) || createPoints < 0) { setMsg("Points must be ≥ 0"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/rewards/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: createTitle.trim(),
          description: createDescription.trim() || null,
          points: createPoints,
          taskType: createType,
          url: createUrl.trim() || null,
          active: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j?.error || `Create failed (${res.status})`); return; }
      setCreateTitle(""); setCreateDescription(""); setCreateUrl("");
      setCreatePoints(50); setCreateType("social");
      setMsg(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, patchBody: Partial<AdminTask> & { taskType?: string }) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rewards/tasks", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...patchBody }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j?.error || `Update failed (${res.status})`); return false; }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!editingId || !draft) return;
    if (!draft.title.trim()) { setMsg("Title is required"); return; }
    if (!Number.isFinite(draft.points) || draft.points < 0) { setMsg("Points must be ≥ 0"); return; }
    const ok = await patch(editingId, {
      title: draft.title.trim(),
      description: draft.description.trim() ? draft.description.trim() : null,
      points: draft.points,
      taskType: draft.task_type,
      url: draft.url.trim() ? draft.url.trim() : null,
      active: draft.active,
    });
    if (ok) { setEditingId(null); setDraft(null); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this task? Task completions will be removed too.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/rewards/tasks?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await res.json();
      if (!res.ok) setMsg(j?.error || `Delete failed (${res.status})`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: AdminTask) {
    setEditingId(t.id);
    setDraft(toDraft(t));
    setMsg(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setMsg(null);
  }

  const headerWarning = useMemo(() => {
    if (!wallet) return "Connect your admin wallet to manage tasks.";
    if (!isAdmin) return "This wallet is not in the admin allowlist.";
    return null;
  }, [wallet, isAdmin]);

  const activeCount = tasks.filter(t => t.active).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Rewards — Tasks</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage external-link reward tasks shown on /rewards. Admin-gated via session cookie + wallet allowlist.
        </p>
      </div>

      {headerWarning && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          {headerWarning}
        </div>
      )}

      {/* Create */}
      <section className="rounded-xl border border-gray-700/60 bg-pump-gray p-4">
        <h2 className="font-semibold text-white mb-3">Create task</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="Title (e.g. Follow @FunMarket on X)"
            className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
          />
          <input
            value={createUrl}
            onChange={(e) => setCreateUrl(e.target.value)}
            placeholder="URL (optional, e.g. https://x.com/FunMarket)"
            className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
          />
          <input
            type="number"
            min={0}
            value={createPoints}
            onChange={(e) => setCreatePoints(Number(e.target.value))}
            placeholder="Points"
            className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
          />
          <select
            value={createType}
            onChange={(e) => setCreateType(e.target.value)}
            className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
          >
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="md:col-span-2 bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          {msg && <span className="text-xs text-yellow-300">{msg}</span>}
          <button
            type="button"
            disabled={!createTitle || createPoints < 0 || busy}
            onClick={create}
            className="ml-auto inline-flex items-center rounded-lg bg-pump-green px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Saving…" : "Create task"}
          </button>
        </div>
      </section>

      {/* List */}
      <section className="rounded-xl border border-gray-700/60 bg-pump-gray p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-white">All tasks</h2>
          <span className="text-xs text-gray-500">
            {loading ? "loading…" : `${tasks.length} task${tasks.length === 1 ? "" : "s"} • ${activeCount} active`}
          </span>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-400">No tasks yet. Create your first one above.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => {
              const isEditing = editingId === t.id;
              return (
                <li
                  key={t.id}
                  className={`rounded-xl border bg-black/30 p-3 ${
                    isEditing ? "border-pump-green/50" : "border-white/5"
                  }`}
                >
                  {!isEditing ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <span>{t.title}</span>
                          {t.url && (
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-pump-green"
                              aria-label="Open task link"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-300">
                            {t.task_type}
                          </span>
                        </div>
                        {t.description && (
                          <div className="mt-0.5 text-xs text-gray-400">{t.description}</div>
                        )}
                        {t.url && (
                          <div className="mt-0.5 truncate text-[11px] text-gray-500">{t.url}</div>
                        )}
                      </div>

                      <div className="shrink-0 text-sm font-bold text-pump-green tabular-nums">
                        +{t.points}
                      </div>

                      <button
                        type="button"
                        onClick={() => patch(t.id, { active: !t.active })}
                        disabled={busy}
                        className={
                          t.active
                            ? "shrink-0 rounded-full bg-pump-green/20 text-pump-green px-2.5 py-1 text-xs font-semibold"
                            : "shrink-0 rounded-full bg-gray-700/40 text-gray-300 px-2.5 py-1 text-xs font-semibold"
                        }
                      >
                        {t.active ? "Active" : "Disabled"}
                      </button>

                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-200 hover:bg-white/10"
                        aria-label="Edit task"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                        aria-label="Delete task"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  ) : (
                    draft && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          value={draft.title}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                          placeholder="Title"
                          className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
                        />
                        <input
                          value={draft.url}
                          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                          placeholder="URL (optional)"
                          className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
                        />
                        <input
                          type="number"
                          min={0}
                          value={draft.points}
                          onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) })}
                          placeholder="Points"
                          className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
                        />
                        <select
                          value={draft.task_type}
                          onChange={(e) => setDraft({ ...draft, task_type: e.target.value })}
                          className="bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
                        >
                          {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <textarea
                          value={draft.description}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          placeholder="Description"
                          rows={2}
                          className="md:col-span-2 bg-black/40 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pump-green/60"
                        />
                        <label className="md:col-span-2 flex items-center gap-2 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            checked={draft.active}
                            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                            className="accent-pump-green"
                          />
                          Active (visible on /rewards)
                        </label>
                        <div className="md:col-span-2 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-200 hover:bg-white/10"
                          >
                            <X className="h-3.5 w-3.5" /> Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveDraft}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg bg-pump-green px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
                          >
                            <Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

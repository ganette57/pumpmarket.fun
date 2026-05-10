"use client";

import { useEffect, useRef, useState } from "react";
import { X, Upload } from "lucide-react";
import { upsertProfile, uploadAvatar, type Profile } from "@/lib/profiles";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BIO_CHARS = 280;
const MAX_NAME_CHARS = 40;

interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  wallet: string;
  initial: Pick<Profile, "display_name" | "bio" | "avatar_url">;
  onSaved: (next: Pick<Profile, "display_name" | "bio" | "avatar_url">) => void;
}

export default function EditProfileModal({
  open,
  onClose,
  wallet,
  initial,
  onSaved,
}: EditProfileModalProps) {
  const [name, setName] = useState(initial.display_name ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    initial.avatar_url ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Reset local state whenever the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    setName(initial.display_name ?? "");
    setBio(initial.bio ?? "");
    setAvatarFile(null);
    setAvatarPreview(initial.avatar_url ?? null);
    setError(null);
  }, [open, initial.display_name, initial.bio, initial.avatar_url]);

  // Revoke any object URL we created.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Avatar must be an image file.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Avatar must be 5 MB or smaller.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setAvatarFile(file);
    setAvatarPreview(url);
    setError(null);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      let nextAvatarUrl: string | null | undefined = undefined;
      if (avatarFile) {
        const uploaded = await uploadAvatar(wallet, avatarFile);
        if (!uploaded) {
          setError("Avatar upload failed. Try again.");
          setSaving(false);
          return;
        }
        // Cache-bust so the new image shows immediately.
        nextAvatarUrl = `${uploaded}?t=${Date.now()}`;
      }

      const trimmedName = name.trim();
      const trimmedBio = bio.trim();
      const updates: { display_name?: string | null; bio?: string | null; avatar_url?: string | null } = {
        display_name: trimmedName ? trimmedName : null,
        bio: trimmedBio ? trimmedBio : null,
      };
      if (nextAvatarUrl !== undefined) updates.avatar_url = nextAvatarUrl;

      const { error: dbError } = await upsertProfile(wallet, updates);
      if (dbError) {
        setError(dbError.message || "Save failed.");
        setSaving(false);
        return;
      }

      onSaved({
        display_name: updates.display_name ?? null,
        bio: updates.bio ?? null,
        avatar_url: nextAvatarUrl ?? initial.avatar_url ?? null,
      });
      setSaving(false);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={saving ? undefined : onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-pump-border bg-pump-gray shadow-[0_0_40px_rgba(0,255,135,0.15)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Edit profile</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full overflow-hidden border border-pump-green/60 bg-black flex items-center justify-center">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-gray-500">No avatar</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={saving}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-pump-green/60 text-pump-green text-sm font-semibold hover:bg-pump-green/10 disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                Upload avatar
              </button>
              <span className="text-[11px] text-gray-500">PNG/JPG, 5 MB max</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={pickFile}
              />
            </div>
          </div>

          {/* Display name */}
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-gray-400 mb-1">
              Display name
            </span>
            <input
              type="text"
              value={name}
              maxLength={MAX_NAME_CHARS}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cypherpunk"
              disabled={saving}
              className="w-full h-10 px-3 rounded-lg bg-black/60 border border-gray-700 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-pump-green/60"
            />
            <span className="text-[10px] text-gray-600">{name.length}/{MAX_NAME_CHARS}</span>
          </label>

          {/* Bio */}
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-gray-400 mb-1">
              Bio
            </span>
            <textarea
              value={bio}
              maxLength={MAX_BIO_CHARS}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people what you trade."
              rows={3}
              disabled={saving}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-gray-700 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-pump-green/60 resize-none"
            />
            <span className="text-[10px] text-gray-600">{bio.length}/{MAX_BIO_CHARS}</span>
          </label>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 px-4 rounded-lg text-sm text-gray-300 hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-10 px-5 rounded-lg bg-pump-green text-black text-sm font-semibold hover:bg-pump-green/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

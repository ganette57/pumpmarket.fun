// src/lib/resultCardImage.ts
//
// Paints a ResultCardView onto a 1200x675 canvas and returns a PNG Blob.
//
// WHY CANVAS AND NOT DOM-TO-IMAGE
// -------------------------------
// The repo had no DOM-to-image dependency, and the alternative (html-to-image
// / dom-to-image) rasterises through an SVG <foreignObject>, which drags in
// every failure mode this card must not have: it re-fetches webfont CSS (CORS
// + a network round trip mid-share), it taints the canvas on any cross-origin
// avatar, its output size depends on the live element's layout, and it is
// unreliable on iOS Safari — the single most likely place a user shares from.
//
// Painting directly gives a deterministic 1200x675 every time regardless of
// viewport, cannot capture the modal backdrop / ticker / navigation because it
// never reads the DOM tree at all, and adds zero dependencies. The trade-off
// is that this file is the layout — it does not inherit Tailwind — so the
// modal renders the PNG it produces rather than a parallel HTML card. One
// renderer, no drift.

import type { ResultCardView } from "./resultCard";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 675;

const BG = "#07090c";
const TEXT = "#ffffff";
const TEXT_MUTED = "#8b93a1";
const TEXT_DIM = "#5f6773";
const HAIRLINE = "rgba(255,255,255,0.09)";
/** Amber, distinct from every result accent so it reads as a caveat. */
const ACCENT_PROVISIONAL = "#f5c451";

const PAD_X = 72;
const PAD_Y = 56;

/** The app's own font when it is available, with a safe system fallback. */
function resolveFontStack(): string {
  const fallback =
    'ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  try {
    const family = window.getComputedStyle(document.body).fontFamily;
    return family && family.trim().length > 0 ? family : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Webfonts must be ready before the first measureText, or the layout is
 * computed against the fallback metrics and the painted text overflows.
 */
async function waitForFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.ready) return;
  try {
    await fonts.ready;
  } catch {
    /* fall through to system metrics — better a card than no card */
  }
}

type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, weight: number, size: number, stack: string, tracking = 0) {
  ctx.font = `${weight} ${size}px ${stack}`;
  // letterSpacing is progressive enhancement; unsupported engines just skip it.
  const styled = ctx as Ctx & { letterSpacing?: string };
  if ("letterSpacing" in ctx) styled.letterSpacing = `${tracking}px`;
}

/** Largest size in [min, start] at which `text` fits `maxWidth`. */
function fitSize(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
  weight: number,
  stack: string
): number {
  let size = start;
  while (size > min) {
    setFont(ctx, weight, size, stack);
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return min;
}

/** Word-wraps into at most `maxLines`, ellipsising the last line. */
function wrapLines(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;

    // A single word longer than the line — hard-break it by characters.
    while (ctx.measureText(line).width > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(`${line.slice(0, cut)}…`).width > maxWidth) cut--;
      lines.push(`${line.slice(0, cut)}…`);
      line = line.slice(cut);
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  if (lines.length > maxLines) lines.length = maxLines;

  // Anything left over gets folded into an ellipsis on the final line.
  const consumed = lines.join(" ");
  if (consumed.replace(/…/g, "").length < String(text).replace(/\s+/g, " ").trim().length) {
    const last = lines[lines.length - 1];
    if (last && !last.endsWith("…")) {
      let trimmed = last;
      while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, trimmed.length - 1);
      }
      lines[lines.length - 1] = `${trimmed.trimEnd()}…`;
    }
  }
  return lines;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The FunMarket mark, drawn as vectors. Deliberately not /logo4.png: that
 * asset is 2 MB and an <img> decode is one more thing that can fail or taint
 * the canvas mid-share. A drawn mark always renders.
 */
function drawMark(ctx: Ctx, x: number, y: number, size: number, accent: string, stack: string) {
  ctx.save();
  roundRect(ctx, x, y, size, size, size * 0.28);
  ctx.fillStyle = accent;
  ctx.fill();

  setFont(ctx, 800, size * 0.52, stack);
  ctx.fillStyle = "#04070a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("F", x + size / 2, y + size / 2 + size * 0.02);
  ctx.restore();
}

function drawChip(
  ctx: Ctx,
  text: string,
  rightX: number,
  centerY: number,
  accent: string,
  stack: string
) {
  // save/restore is not optional here: this helper changes textAlign, and a
  // leaked "center" would re-anchor every later fillText onto its left edge.
  ctx.save();
  setFont(ctx, 700, 20, stack, 1.6);
  const textWidth = ctx.measureText(text).width;
  const padX = 18;
  const h = 40;
  const w = textWidth + padX * 2;
  const x = rightX - w;
  const y = centerY - h / 2;

  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = withAlpha(accent, 0.14);
  ctx.fill();
  ctx.strokeStyle = withAlpha(accent, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  setFont(ctx, 700, 20, stack, 0);
  ctx.restore();
}

/** Paints the card. Exported for tests/preview; use renderResultCardPng(). */
export function paintResultCard(ctx: Ctx, view: ResultCardView): void {
  const stack = resolveFontStack();
  const accent = view.accentHex;

  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Base + a soft accent bloom behind the headline area.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const bloom = ctx.createRadialGradient(190, 150, 0, 190, 150, 720);
  bloom.addColorStop(0, withAlpha(accent, 0.16));
  bloom.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Accent rule along the top edge.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_WIDTH, 6);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  /* ── Header ─────────────────────────────────────────────────────────── */
  const markSize = 44;
  drawMark(ctx, PAD_X, PAD_Y, markSize, accent, stack);

  setFont(ctx, 800, 26, stack, 3);
  ctx.fillStyle = TEXT;
  ctx.textBaseline = "middle";
  ctx.fillText("FUNMARKET", PAD_X + markSize + 18, PAD_Y + markSize / 2 + 1);
  setFont(ctx, 800, 26, stack, 0);

  drawChip(ctx, view.modeLabel, CARD_WIDTH - PAD_X, PAD_Y + markSize / 2, accent, stack);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  /* ── Verb + primary value ───────────────────────────────────────────── */
  let y = PAD_Y + markSize + 100;

  setFont(ctx, 800, 46, stack, 4);
  ctx.fillStyle = accent;
  ctx.fillText(view.verb, PAD_X, y);
  setFont(ctx, 800, 46, stack, 0);

  const contentWidth = CARD_WIDTH - PAD_X * 2;

  if (view.primaryValue) {
    y += 40;
    setFont(ctx, 600, 22, stack);
    ctx.fillStyle = TEXT_MUTED;
    ctx.fillText(view.primaryLabel, PAD_X, y);

    y += 104;
    const valueSize = fitSize(ctx, view.primaryValue, contentWidth, 112, 44, 800, stack);
    setFont(ctx, 800, valueSize, stack);
    ctx.fillStyle =
      view.primaryTone === "positive"
        ? accent
        : view.primaryTone === "negative"
        ? accent
        : TEXT;
    ctx.fillText(view.primaryValue, PAD_X, y);
  }

  /* ── Market title ───────────────────────────────────────────────────── */
  y += 62;
  const titleSize = 34;
  setFont(ctx, 700, titleSize, stack);
  ctx.fillStyle = TEXT;
  const titleLines = wrapLines(ctx, view.marketTitle, contentWidth, 2);
  for (const line of titleLines) {
    ctx.fillText(line, PAD_X, y);
    y += titleSize + 10;
  }

  /* ── Footer block: detail rows + wordmark ───────────────────────────── */
  const footerTop = CARD_HEIGHT - 150;

  // Provisional strip, above the divider so it reads before the numbers do.
  // A card can outlive the dispute window once it is posted, so a proposed
  // result must carry this wherever it travels.
  if (view.provisionalFooter) {
    setFont(ctx, 700, 19, stack, 1.3);
    ctx.fillStyle = ACCENT_PROVISIONAL;
    ctx.fillText(view.provisionalFooter, PAD_X, footerTop - 20);
    setFont(ctx, 700, 19, stack, 0);
  }

  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, footerTop);
  ctx.lineTo(CARD_WIDTH - PAD_X, footerTop);
  ctx.stroke();

  // Up to three detail cells across the width. The card is a summary, not a
  // statement — extra rows are dropped rather than shrunk into illegibility.
  const cells = view.rows.slice(0, 3);
  if (cells.length) {
    const cellWidth = contentWidth / cells.length;
    cells.forEach((row, i) => {
      const cx = PAD_X + cellWidth * i;
      const maxW = cellWidth - 24;

      setFont(ctx, 600, 18, stack, 1.2);
      ctx.fillStyle = TEXT_DIM;
      ctx.fillText(row.label.toUpperCase(), cx, footerTop + 42);
      setFont(ctx, 600, 18, stack, 0);

      const valueSize = fitSize(ctx, row.value, maxW, 26, 16, 700, stack);
      setFont(ctx, 700, valueSize, stack);
      ctx.fillStyle = TEXT;
      const [firstLine] = wrapLines(ctx, row.value, maxW, 1);
      ctx.fillText(firstLine ?? row.value, cx, footerTop + 78);
    });
  }

  setFont(ctx, 600, 20, stack, 1);
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText("funmarket.app", PAD_X, CARD_HEIGHT - 34);
  setFont(ctx, 600, 20, stack, 0);

  // Play must be unmistakable on a card that leaves the app.
  if (view.mode === "play") {
    const tag = "PLAY MONEY — NOT REAL FUNDS";
    setFont(ctx, 700, 18, stack, 1.4);
    ctx.fillStyle = TEXT_DIM;
    ctx.textAlign = "right";
    ctx.fillText(tag, CARD_WIDTH - PAD_X, CARD_HEIGHT - 34);
    ctx.textAlign = "left";
    setFont(ctx, 700, 18, stack, 0);
  }

  // Panel edge, drawn last so nothing paints over it.
  ctx.strokeStyle = withAlpha(accent, 0.22);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);
}

export class ResultCardImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultCardImageError";
  }
}

/** Renders the card to a PNG Blob of exactly 1200x675. */
export async function renderResultCardPng(view: ResultCardView): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new ResultCardImageError("Result cards can only be generated in the browser.");
  }

  await waitForFonts();

  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ResultCardImageError("This browser could not create the result card.");

  paintResultCard(ctx, view);

  const blob = await new Promise<Blob | null>((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((b) => resolve(b), "image/png");
      return;
    }
    // Safari <14 and jsdom: fall back to the data URL path.
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const [, base64] = dataUrl.split(",");
      const bytes = atob(base64);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      resolve(new Blob([buf], { type: "image/png" }));
    } catch {
      resolve(null);
    }
  });

  if (!blob) throw new ResultCardImageError("The result card image could not be encoded.");
  return blob;
}

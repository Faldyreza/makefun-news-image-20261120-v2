// news-image-20261120 v2 "RED FRIDAY, SHARP"
// One 1024x1024 front-page image summing up Friday 20 November 2026 world news.
// Node 22 standard library only. No network. Deterministic: two runs produce
// byte-identical output/entry.png.
// Text engine: stroke-based vector font (polylines on a 5x7 grid, round caps),
// rendered into a 4x supersampled buffer and box-downsampled -> smooth,
// anti-aliased glyphs at every size. No bitmap/pixel font anywhere.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";

const W = 1024;
const H = 1024;
const SS = 4; // supersample factor
const BW = W * SS;
const BH = H * SS;

// ---------------------------------------------------------------------------
// Raster buffer (RGB, 4x supersampled)
// ---------------------------------------------------------------------------
const buf = new Uint8Array(BW * BH * 3);

type RGB = [number, number, number];

const NAVY_TOP: RGB = [13, 21, 46];
const NAVY_BOT: RGB = [7, 11, 28];
const PANEL: RGB = [16, 26, 54];
const PANEL_BORDER: RGB = [43, 58, 94];
const CHART_BG: RGB = [12, 20, 40];
const GOLD: RGB = [245, 185, 66];
const WHITE: RGB = [248, 250, 252];
const MUTED: RGB = [148, 163, 184];
const RED: RGB = [239, 68, 68];
const RED_BRIGHT: RGB = [255, 107, 107];
const RED_DARK: RGB = [229, 72, 77];
const GREEN: RGB = [34, 197, 94];
const GREEN_BRIGHT: RGB = [74, 222, 128];
const SKY: RGB = [125, 211, 252];
const GRID: RGB = [30, 42, 74];

function fillBackground(): void {
  for (let y = 0; y < BH; y++) {
    const t = y / (BH - 1);
    const r = NAVY_TOP[0] + (NAVY_BOT[0] - NAVY_TOP[0]) * t;
    const g = NAVY_TOP[1] + (NAVY_BOT[1] - NAVY_TOP[1]) * t;
    const b = NAVY_TOP[2] + (NAVY_BOT[2] - NAVY_TOP[2]) * t;
    let idx = y * BW * 3;
    for (let x = 0; x < BW; x++) {
      buf[idx++] = r; buf[idx++] = g; buf[idx++] = b;
    }
  }
}

function blend(px: number, py: number, c: RGB, a: number): void {
  if (a <= 0) return;
  if (px < 0 || py < 0 || px >= BW || py >= BH) return;
  if (a > 1) a = 1;
  const i = (py * BW + px) * 3;
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const ax0 = Math.max(0, Math.round(x0 * SS));
  const ay0 = Math.max(0, Math.round(y0 * SS));
  const ax1 = Math.min(BW, Math.round(x1 * SS));
  const ay1 = Math.min(BH, Math.round(y1 * SS));
  for (let y = ay0; y < ay1; y++) {
    let i = (y * BW + ax0) * 3;
    for (let x = ax0; x < ax1; x++) {
      buf[i++] = c[0]; buf[i++] = c[1]; buf[i++] = c[2];
    }
  }
}

function panel(x0: number, y0: number, x1: number, y1: number): void {
  fillRect(x0, y0, x1, y1, PANEL);
  const b = 1.5;
  fillRect(x0, y0, x1, y0 + b, PANEL_BORDER);
  fillRect(x0, y1 - b, x1, y1, PANEL_BORDER);
  fillRect(x0, y0, x0 + b, y1, PANEL_BORDER);
  fillRect(x1 - b, y0, x1, y1, PANEL_BORDER);
}

// Distance from point (px,py) to segment (x1,y1)-(x2,y2), buffer coords.
function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

// Thick stroked segment with round caps, in final px coords.
function strokeSeg(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB): void {
  const bw = w * SS;
  const r = bw / 2;
  const bx1 = (Math.min(x1, x2) - w) * SS;
  const bx2 = (Math.max(x1, x2) + w) * SS;
  const by1 = (Math.min(y1, y2) - w) * SS;
  const by2 = (Math.max(y1, y2) + w) * SS;
  const sx1 = x1 * SS, sy1 = y1 * SS, sx2 = x2 * SS, sy2 = y2 * SS;
  const x0 = Math.max(0, Math.floor(bx1));
  const x1i = Math.min(BW - 1, Math.ceil(bx2));
  const y0 = Math.max(0, Math.floor(by1));
  const y1i = Math.min(BH - 1, Math.ceil(by2));
  for (let py = y0; py <= y1i; py++) {
    for (let px = x0; px <= x1i; px++) {
      const d = distSeg(px + 0.5, py + 0.5, sx1, sy1, sx2, sy2);
      const cov = Math.min(1, Math.max(0, r - d + 0.5));
      if (cov > 0) blend(px, py, c, cov);
    }
  }
}

function strokePolyline(pts: number[], w: number, c: RGB): void {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    strokeSeg(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w, c);
  }
}

function fillDisc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1i = Math.min(BW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1i = Math.min(BH - 1, Math.ceil((cy + r) * SS));
  const br = r * SS;
  for (let py = y0; py <= y1i; py++) {
    for (let px = x0; px <= x1i; px++) {
      const dx = px + 0.5 - cx * SS;
      const dy = py + 0.5 - cy * SS;
      const d = Math.sqrt(dx * dx + dy * dy);
      const cov = Math.min(1, Math.max(0, br - d + 0.5));
      if (cov > 0) blend(px, py, c, cov * alpha);
    }
  }
}

// Soft smoke blob: radial falloff, alpha peaks at center.
function softBlob(cx: number, cy: number, r: number, c: RGB, peak: number): void {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1i = Math.min(BW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1i = Math.min(BH - 1, Math.ceil((cy + r) * SS));
  const br = r * SS;
  for (let py = y0; py <= y1i; py++) {
    for (let px = x0; px <= x1i; px++) {
      const dx = px + 0.5 - cx * SS;
      const dy = py + 0.5 - cy * SS;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= br) continue;
      const q = 1 - d / br;
      blend(px, py, c, peak * q);
    }
  }
}

function strokeCircle(cx: number, cy: number, r: number, w: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor((cx - r - w) * SS));
  const x1i = Math.min(BW - 1, Math.ceil((cx + r + w) * SS));
  const y0 = Math.max(0, Math.floor((cy - r - w) * SS));
  const y1i = Math.min(BH - 1, Math.ceil((cy + r + w) * SS));
  const br = r * SS;
  const bw = (w / 2) * SS;
  for (let py = y0; py <= y1i; py++) {
    for (let px = x0; px <= x1i; px++) {
      const dx = px + 0.5 - cx * SS;
      const dy = py + 0.5 - cy * SS;
      const d = Math.abs(Math.sqrt(dx * dx + dy * dy) - br);
      const cov = Math.min(1, Math.max(0, bw - d + 0.5));
      if (cov > 0) blend(px, py, c, cov);
    }
  }
}

function fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGB): void {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3) * SS));
  const maxX = Math.min(BW - 1, Math.ceil(Math.max(x1, x2, x3) * SS));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3) * SS));
  const maxY = Math.min(BH - 1, Math.ceil(Math.max(y1, y2, y3) * SS));
  const d = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const x = (px + 0.5) / SS;
      const y = (py + 0.5) / SS;
      const a = ((x2 - x) * (y3 - y) - (y2 - y) * (x3 - x)) / d;
      const b = ((x3 - x) * (y1 - y) - (y3 - y) * (x1 - x)) / d;
      const cc = 1 - a - b;
      if (a >= 0 && b >= 0 && cc >= 0) blend(px, py, c, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Vector font: each glyph is a list of polylines on a 5-wide x 7-tall grid.
// Strokes are drawn with round caps/joins into the 4x buffer, so glyphs are
// smooth at any size. No bitmap glyphs anywhere.
// ---------------------------------------------------------------------------
type Glyph = { adv: number; strokes: number[][] };
const D = 5.6; // default advance, grid units
const FONT: Record<string, Glyph> = {
  A: { adv: D, strokes: [[0, 6, 2, 0, 4, 6], [1, 4, 3, 4]] },
  B: { adv: D, strokes: [[0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 3, 2, 0, 2], [0, 2, 3, 2, 4, 3, 4, 5, 3, 6, 0, 6]] },
  C: { adv: D, strokes: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]] },
  D: { adv: D, strokes: [[0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 4, 5, 3, 6, 0, 6]] },
  E: { adv: D, strokes: [[0, 0, 0, 6], [0, 0, 4, 0], [0, 3, 3, 3], [0, 6, 4, 6]] },
  F: { adv: D, strokes: [[0, 0, 0, 6], [0, 0, 4, 0], [0, 3, 3, 3]] },
  G: { adv: D, strokes: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]] },
  H: { adv: D, strokes: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]] },
  I: { adv: D, strokes: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]] },
  J: { adv: D, strokes: [[2, 0, 4, 0, 4, 5, 3, 6, 1, 6, 0, 5, 0, 4]] },
  K: { adv: D, strokes: [[0, 0, 0, 6], [4, 0, 1, 3, 4, 6]] },
  L: { adv: D, strokes: [[0, 0, 0, 6], [0, 6, 4, 6]] },
  M: { adv: D, strokes: [[0, 6, 0, 0, 2, 3, 4, 0, 4, 6]] },
  N: { adv: D, strokes: [[0, 6, 0, 0, 4, 6, 4, 0]] },
  O: { adv: D, strokes: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]] },
  P: { adv: D, strokes: [[0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]] },
  Q: { adv: D, strokes: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [3, 4, 4, 6]] },
  R: { adv: D, strokes: [[0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [2, 3, 4, 6]] },
  S: { adv: D, strokes: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]] },
  T: { adv: D, strokes: [[0, 0, 4, 0], [2, 0, 2, 6]] },
  U: { adv: D, strokes: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]] },
  V: { adv: D, strokes: [[0, 0, 2, 6, 4, 0]] },
  W: { adv: D, strokes: [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]] },
  X: { adv: D, strokes: [[0, 0, 4, 6], [4, 0, 0, 6]] },
  Y: { adv: D, strokes: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]] },
  Z: { adv: D, strokes: [[0, 0, 4, 0, 0, 6, 4, 6]] },
  "0": { adv: D, strokes: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]] },
  "1": { adv: D, strokes: [[1, 1, 2, 0, 2, 6], [0, 6, 4, 6]] },
  "2": { adv: D, strokes: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 0, 6, 4, 6]] },
  "3": { adv: D, strokes: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 2, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]] },
  "4": { adv: D, strokes: [[0, 0, 0, 3, 4, 3], [3, 0, 3, 6]] },
  "5": { adv: D, strokes: [[4, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]] },
  "6": { adv: D, strokes: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 6, 1, 6, 3, 6, 4, 5, 4, 3, 0, 3]] },
  "7": { adv: D, strokes: [[0, 0, 4, 0, 2, 6]] },
  "8": { adv: D, strokes: [[1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0], [1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3]] },
  "9": { adv: D, strokes: [[0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6, 3, 6, 1, 6, 0, 5], [0, 3, 4, 3]] },
  " ": { adv: 3.2, strokes: [] },
  ".": { adv: 3.0, strokes: [[2, 6, 2, 6]] },
  ",": { adv: 3.0, strokes: [[2, 4, 2, 6, 1, 6]] },
  ":": { adv: 3.4, strokes: [[2, 2, 2, 2], [2, 5, 2, 5]] },
  ";": { adv: 3.4, strokes: [[2, 2, 2, 2], [2, 4, 2, 6, 1, 6]] },
  "-": { adv: 5.0, strokes: [[0, 3, 4, 3]] },
  "–": { adv: 5.0, strokes: [[0, 3, 4, 3]] },
  "−": { adv: 5.0, strokes: [[0, 3, 4, 3]] },
  "—": { adv: 6.8, strokes: [[0, 3, 4, 3]] },
  "·": { adv: 3.2, strokes: [[2, 3, 2, 3]] },
  "%": { adv: D, strokes: [[0, 6, 4, 0], [1, 0.6, 1, 1.4], [3, 4.6, 3, 5.4]] },
  "+": { adv: D, strokes: [[2, 1, 2, 5], [0, 3, 4, 3]] },
  $: { adv: D, strokes: [[2, 0, 2, 6], [4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]] },
  "£": { adv: D, strokes: [[3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6], [0, 3, 3, 3]] },
  "'": { adv: 2.6, strokes: [[2, 0, 2, 2]] },
  "(": { adv: 3.4, strokes: [[3, 0, 2, 1, 2, 5, 3, 6]] },
  ")": { adv: 3.4, strokes: [[1, 0, 2, 1, 2, 5, 1, 6]] },
  "/": { adv: 4.4, strokes: [[4, 0, 0, 6]] },
  "!": { adv: 3.4, strokes: [[2, 0, 2, 4], [2, 6, 2, 6]] },
  "?": { adv: 5.0, strokes: [[1, 1, 2, 0, 3, 0, 4, 1, 4, 2, 3, 3, 2, 3], [2, 6, 2, 6]] },
  "=": { adv: D, strokes: [[0, 2, 4, 2], [0, 4, 4, 4]] },
  '"': { adv: 4.4, strokes: [[1, 0, 1, 2], [3, 0, 3, 2]] },
  "&": { adv: D, strokes: [[3, 0, 1, 0, 0, 1, 0, 3, 1, 4, 3, 4, 4, 5, 4, 6, 2, 6, 0, 4]] },
};

function glyphOf(ch: string): Glyph {
  const g = FONT[ch];
  if (!g) throw new Error(`missing glyph for ${JSON.stringify(ch)}`);
  return g;
}

function textWidth(text: string, cap: number, tracking = 1): number {
  const unit = cap / 7;
  let w = 0;
  for (const ch of text) w += glyphOf(ch).adv * unit * tracking;
  return w;
}

// Draw text; (x, yTop) is the top-left of the cap-height box.
// align: "left" | "right" | "center" (x is the anchor).
function drawText(
  x: number,
  yTop: number,
  text: string,
  cap: number,
  c: RGB,
  opts: { align?: "left" | "right" | "center"; tracking?: number; sw?: number } = {},
): void {
  const tracking = opts.tracking ?? 1;
  const swUnits = opts.sw ?? 0.95;
  const unit = cap / 7;
  const w = swUnits * unit;
  const total = textWidth(text, cap, tracking);
  let cx = x;
  if (opts.align === "right") cx = x - total;
  else if (opts.align === "center") cx = x - total / 2;
  for (const ch of text) {
    const g = glyphOf(ch);
    for (const stroke of g.strokes) {
      const pts: number[] = [];
      for (let i = 0; i < stroke.length; i += 2) {
        pts.push(cx + stroke[i] * unit);
        pts.push(yTop + stroke[i + 1] * unit);
      }
      strokePolyline(pts, w, c);
    }
    cx += g.adv * unit * tracking;
  }
}

// ---------------------------------------------------------------------------
// Layout — dark navy trading-board front page, 1024x1024.
// Masthead 0-100 | headline band 110-282 (own band, 30px clear gap to chart)
// chart 312-588 | chips 598-640 | row2 648-832 | row3 840-972 | footer 980-1022
// ---------------------------------------------------------------------------
function drawMasthead(): void {
  drawText(24, 14, "THE WORLD", 68, WHITE, { sw: 1.0 });
  drawText(1000, 18, "FRIDAY — 20 NOVEMBER 2026", 24, GOLD, { align: "right" });
  drawText(1000, 50, "ONE DAY · ONE IMAGE", 18, MUTED, { align: "right" });
  fillRect(12, 96, 1012, 99, GOLD);
}

function drawHeadline(): void {
  drawText(24, 110, "THE AI SELL-OFF", 64, WHITE, { sw: 1.0 });
  drawText(24, 180, "GOES GLOBAL", 64, WHITE, { sw: 1.0 });
  drawText(24, 254, "NIKKEI −4.8% · KOSPI −5.2% · TAIWAN −6%", 28, GOLD);
}

function drawChart(): void {
  panel(12, 312, 1012, 588);
  // grid lines
  for (const gy of [350, 395, 440, 485, 530]) fillRect(24, gy, 1000, gy + 1.5, GRID);
  // Nikkei level, top-right (clear of the candles)
  const label = "NIKKEI 56,594.94";
  const tw = textWidth(label, 18);
  const triX = 1000 - tw - 28;
  fillTriangle(triX, 338, triX + 14, 338, triX + 7, 324, RED_BRIGHT);
  drawText(1000, 322, label, 18, RED_BRIGHT, { align: "right" });
  // falling candlesticks, left -> right
  for (let i = 0; i < 8; i++) {
    const cx = 90 + i * 122;
    const top = 344 + i * 19;
    const bodyH = 52;
    // wick
    fillRect(cx - 3, top - 16, cx + 3, top + bodyH + 16, RED_DARK);
    // body
    fillRect(cx - 23, top, cx + 23, top + bodyH, RED_DARK);
    fillRect(cx - 23, top, cx + 23, top + 4, RED_BRIGHT);
  }
  // deck: Anthropic IPO fails to calm AI-bubble fears; fifth straight fall
  drawText(24, 538, "ANTHROPIC'S RECORD $81.3BN IPO FAILS TO CALM AI-BUBBLE", 20, WHITE);
  drawText(24, 564, "FEARS; WALL STREET FALLS FOR A FIFTH STRAIGHT DAY.", 20, WHITE);
}

function drawChips(): void {
  const chips: { label: string; red: boolean }[] = [
    { label: "NIKKEI −4.8%", red: true },
    { label: "KOSPI −5.2%", red: true },
    { label: "TAIEX −6%", red: true },
    { label: "NASDAQ −2.3%", red: true },
    { label: "S&P 500 −2%", red: true },
    { label: "ANTHROPIC +17%", red: false },
  ];
  const cap = 15;
  const widths = chips.map((c) => textWidth(c.label, cap) + 24);
  const total = widths.reduce((a, b) => a + b, 0) + 8 * (chips.length - 1);
  let x = (W - total) / 2;
  for (let i = 0; i < chips.length; i++) {
    const w = widths[i];
    const c = chips[i];
    const fill: RGB = c.red ? [58, 13, 18] : [5, 46, 22];
    const border: RGB = c.red ? [127, 29, 29] : [22, 101, 52];
    const text: RGB = c.red ? RED_BRIGHT : GREEN_BRIGHT;
    fillRect(x, 598, x + w, 640, fill);
    fillRect(x, 598, x + w, 599.5, border);
    fillRect(x, 638.5, x + w, 640, border);
    fillRect(x, 598, x + 1.5, 640, border);
    fillRect(x + w - 1.5, 598, x + w, 640, border);
    drawText(x + w / 2, 612, c.label, cap, text, { align: "center" });
    x += w + 8;
  }
}

function drawRiyadh(): void {
  panel(12, 648, 508, 832);
  drawText(28, 660, "RIYADH", 20, GOLD);
  drawText(28, 688, "MISSILE HITS", 29, WHITE);
  drawText(28, 722, "RIYADH'S", 29, WHITE);
  drawText(28, 756, "TALLEST TOWER", 29, WHITE);
  drawText(28, 790, "HOUTHI MISSILE DAMAGES PIF", 16, MUTED);
  drawText(28, 811, "TOWER — 7–8 FLOORS HIT. NO INJURIES", 16, MUTED);
  // PIF Tower (80 floors): tapered slab, impact band near the top
  fillTriangle(434, 716, 490, 716, 500, 802, [42, 56, 92]);
  fillTriangle(434, 716, 500, 802, 424, 802, [42, 56, 92]);
  fillRect(428, 712, 496, 726, [20, 10, 14]); // impact band
  // lit windows
  for (let wy = 736; wy <= 792; wy += 14) {
    for (let wx = 438; wx <= 486; wx += 12) {
      const lit = (wx * 7 + wy * 3) % 5 !== 0;
      fillDisc(wx, wy, 1.8, lit ? GOLD : [120, 130, 155], 1);
    }
  }
  // warm glow at the impact point
  softBlob(462, 719, 18, [255, 150, 50], 0.9);
  fillDisc(462, 719, 6, [255, 190, 90], 1);
  // BIG layered smoke plume: 5 overlapping translucent blobs, drifting left
  softBlob(452, 706, 24, [150, 160, 175], 0.9);
  softBlob(428, 688, 28, [145, 154, 170], 0.9);
  softBlob(402, 672, 24, [165, 172, 185], 0.85);
  softBlob(476, 686, 20, [155, 164, 178], 0.85);
  softBlob(384, 682, 16, [175, 182, 192], 0.8);
  softBlob(428, 688, 13, [225, 228, 233], 0.6);
  softBlob(402, 672, 10, [225, 228, 233], 0.55);
}

function drawCop31(): void {
  panel(516, 648, 1012, 832);
  drawText(532, 660, "ANTALYA · COP31", 20, GOLD);
  drawText(532, 688, "COP31 DROPS", 29, WHITE);
  drawText(532, 722, "FOSSIL-FUEL", 29, WHITE);
  drawText(532, 756, "PHASE-OUT", 29, WHITE);
  drawText(532, 790, "DRAFT DEAL REMOVES ANY CALL TO", 16, MUTED);
  drawText(532, 811, "END FOSSIL FUELS", 16, MUTED);
  // globe with crossed-out leaf: draft drops the fossil-fuel phase-out
  const cx = 928;
  const cy = 736;
  const r = 52;
  strokeCircle(cx, cy, r, 4, SKY);
  fillRect(cx - 45, 710, cx + 45, 711.5, SKY); // latitude lines
  fillRect(cx - 45, 762, cx + 45, 763.5, SKY);
  fillRect(cx - 1.5, cy - r, cx + 1.5, cy + r, SKY); // longitude lines
  fillRect(cx - 27.5, 691, cx - 26, 781, SKY);
  fillRect(cx + 26, 691, cx + 27.5, 781, SKY);
  fillDisc(908, 720, 14, GREEN, 0.9); // land
  fillDisc(946, 756, 10, GREEN, 0.9);
  strokeSeg(cx - 36, cy - 36, cx + 36, cy + 36, 9, RED); // red X
  strokeSeg(cx + 36, cy - 36, cx - 36, cy + 36, 9, RED);
}

function drawGaza(): void {
  panel(12, 840, 508, 972);
  // dashed Yellow Line with markers
  for (let x = 28; x < 480; x += 28) fillRect(x, 854, Math.min(x + 18, 492), 859, GOLD);
  fillTriangle(150, 866, 162, 866, 156, 878, WHITE);
  fillTriangle(340, 866, 352, 866, 346, 878, WHITE);
  drawText(28, 880, "GAZA: TROOPS CROSS", 25, WHITE);
  drawText(28, 910, "YELLOW LINE", 25, WHITE);
  drawText(28, 940, "FIRST INCURSION ACROSS THE", 14, MUTED);
  drawText(28, 958, "CEASEFIRE BOUNDARY SINCE TRUCE", 14, MUTED);
}

function drawKenya(): void {
  panel(516, 840, 1012, 972);
  // green cross
  fillRect(556, 872, 580, 944, GREEN);
  fillRect(532, 896, 604, 920, GREEN);
  drawText(624, 852, "KENYA", 20, GREEN_BRIGHT);
  drawText(624, 880, "KENYA: LAST EBOLA", 25, WHITE);
  drawText(624, 910, "PATIENT GOES HOME", 25, WHITE);
  drawText(624, 940, "DISCHARGED 37 DAYS AFTER", 14, MUTED);
  drawText(624, 958, "THE FIRST CASE", 14, MUTED);
}

function drawFooter(): void {
  drawText(512, 982, "UK 1,000+ DRONES FOR UKRAINE £260M · CALIFORNIA SUBPOENAS NVIDIA", 18, [226, 232, 240], { align: "center", tracking: 0.95 });
  drawText(512, 1004, "BUKELE SEEKS 3RD TERM · TRUMP PARDONS PETE ROSE · BRENT CRUDE $92.77", 18, [226, 232, 240], { align: "center", tracking: 0.95 });
}

// ---------------------------------------------------------------------------
// PNG encode (stdlib only): 8-bit RGB, filter 0, zlib deflate.
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Box-downsample the 4x buffer to 1024x1024.
function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * BW + (x * SS + sx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      const n = SS * SS;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

function main(): void {
  fillBackground();
  drawMasthead();
  drawHeadline();
  drawChart();
  drawChips();
  drawRiyadh();
  drawCop31();
  drawGaza();
  drawKenya();
  drawFooter();

  const rgb = downsample();
  const png = encodePng(rgb, W, H);
  const sha = crypto.createHash("sha256").update(png).digest("hex");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  const dossier = {
    title: "RED FRIDAY, SHARP",
    bounty: "news-image-20261120",
    version: "v2",
    date: "2026-11-20",
    width: W,
    height: H,
    bytes: png.length,
    sha256: sha,
    stories: [
      "LEAD: global AI sell-off — Nikkei -4.8% to 56,594.94, Kospi -5.2%, Taiex -6%; Anthropic $81.3bn IPO (+17% to $97.17); Nasdaq -2.3%, S&P 500 -2%, fifth straight fall",
      "Riyadh: Houthi missile damages PIF Tower (80 floors, 7-8 floors hit, no injuries)",
      "COP31: draft drops fossil-fuel phase-out (Antalya)",
      "Gaza: Israeli forces cross Yellow Line (first incursion since truce)",
      "Kenya: last Ebola patient discharged (37 days after first case)",
      "UK 1,000+ drones for Ukraine, £260m; California subpoenas Nvidia; Bukele third term; Trump pardons Pete Rose; Brent $92.77",
    ],
  };
  fs.writeFileSync(path.join(outDir, "dossier.json"), JSON.stringify(dossier, null, 2) + "\n");
  console.log(`entry.png ${png.length} bytes sha256=${sha}`);
}

main();

// Pure pixel helpers shared by the browser (canvas) and node tests (sharp).
// All functions take RGBA Uint8(Clamped)Array data.

// Bounding box of the receipt: bright, low-saturation (white paper) pixels.
export function findPaperBox(data, w, h) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 400));
  const cols = new Float32Array(w), rows = new Float32Array(h);
  let cn = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 150 && mx - mn < 45) { cols[x]++; rows[y]++; }
    }
    cn++;
  }
  const rn = Math.ceil(w / step);
  const colFrac = x => cols[x] / cn, rowFrac = y => rows[y] / rn;
  const span = (len, frac, st) => {
    let a = -1, b = -1;
    for (let i = 0; i < len; i += st) if (frac(i) > 0.35) { if (a < 0) a = i; b = i; }
    return [a, b];
  };
  const [x0, x1] = span(w, colFrac, step);
  const [y0, y1] = span(h, rowFrac, step);
  if (x0 < 0 || y0 < 0 || (x1 - x0) < w * 0.15 || (y1 - y0) < h * 0.15) return { x: 0, y: 0, w, h };
  const pad = Math.round(Math.min(w, h) * 0.01);
  const x = Math.max(0, x0 - pad), y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(w, x1 + pad) - x, h: Math.min(h, y1 + pad) - y };
}

export function toGray(data) {
  const g = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  return g;
}

// Stretch contrast so the 2nd..98th percentile spans 0..255.
export function stretch(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const n = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
  const k = 255 / Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = (gray[i] - lo) * k;
  return out;
}

export function otsu(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const n = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

export function threshold(gray, t) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] > t ? 255 : 0;
  return out;
}

export function grayToRGBA(gray) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) { out[i] = out[i + 1] = out[i + 2] = gray[j]; out[i + 3] = 255; }
  return out;
}

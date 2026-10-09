// On-device OCR with Tesseract.js (loaded from CDN on first scan, then cached).
import { findPaperBox, toGray, stretch, otsu, threshold, grayToRGBA } from './image.js';
import { parseReceipt, parseReceiptDigits, parseEnvelope, combinePasses, receiptScore, envelopeScore, receiptSanity, RECEIPT_EQS, ENVELOPE_EQS } from './parse.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load OCR engine (are you online?)'));
    document.head.appendChild(s);
  });
}

async function getWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      onStatus?.('Loading reader (first time only)…');
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng', 1);
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Draws the photo rotated, optionally cropped to the white paper, at `width` px.
function prepare(bmp, rot, { crop, width }) {
  const maxSide = 4032; // keep full camera resolution for the crop
  const s0 = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const bw = Math.round(bmp.width * s0), bh = Math.round(bmp.height * s0);
  const swap = rot % 180 !== 0;
  const c1 = canvas(swap ? bh : bw, swap ? bw : bh);
  const x1 = c1.getContext('2d', { willReadFrequently: true });
  x1.translate(c1.width / 2, c1.height / 2);
  x1.rotate((rot * Math.PI) / 180);
  x1.drawImage(bmp, -bw / 2, -bh / 2, bw, bh);
  let box = { x: 0, y: 0, w: c1.width, h: c1.height };
  if (crop) box = findPaperBox(x1.getImageData(0, 0, c1.width, c1.height).data, c1.width, c1.height);
  const scale = width / box.w;
  const c2 = canvas(width, Math.round(box.h * scale));
  const x2 = c2.getContext('2d', { willReadFrequently: true });
  x2.imageSmoothingQuality = 'high';
  x2.drawImage(c1, box.x, box.y, box.w, box.h, 0, 0, c2.width, c2.height);
  const gray = stretch(toGray(x2.getImageData(0, 0, c2.width, c2.height).data));
  const toCanvas = g => {
    const c = canvas(c2.width, c2.height);
    c.getContext('2d').putImageData(new ImageData(grayToRGBA(g), c2.width, c2.height), 0, 0);
    return c;
  };
  return { gray: toCanvas(gray), bin: toCanvas(threshold(gray, otsu(gray))) };
}

const DIGITS = '0123456789.,-() ';
async function read(worker, img, psm, digitsOnly = false) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: digitsOnly ? DIGITS : '' });
  return (await worker.recognize(img)).data.text;
}

async function scan(file, { crop, width, score, good, parse, parseDigits, eqs, opts }, onStatus) {
  const worker = await getWorker(onStatus);
  const bmp = await loadBitmap(file);
  let pick = null;
  for (const rot of [0, 90, 270]) {
    onStatus?.(rot ? 'Trying another rotation…' : 'Reading photo…');
    const p = prepare(bmp, rot, { crop, width });
    if (location.hash === '#debug' && !rot) window.__prep = p.gray.toDataURL();
    const t = await read(worker, p.gray, '4');
    const s = score(t);
    if (!pick || s > pick.s) pick = { s, p, t };
    if (s >= good) break;
  }
  onStatus?.('Double-checking…');
  const texts = [pick.t, await read(worker, pick.p.gray, '6'), await read(worker, pick.p.bin, '6')];
  const passes = texts.map(parse);
  if (parseDigits) {
    for (const [img, psm] of [[pick.p.gray, '11'], [pick.p.gray, '6']]) {
      const t = await read(worker, img, psm, true);
      texts.push(t);
      passes.push(parseDigits(t));
    }
  }
  const result = combinePasses(passes, eqs, opts);
  result.texts = texts;
  return result;
}

export function scanReceipt(file, onStatus) {
  return scan(file, {
    crop: true, width: 2400, score: receiptScore, good: 4, parse: parseReceipt, parseDigits: parseReceiptDigits, eqs: RECEIPT_EQS,
    opts: { defaults: { offline: 0, debit: 0 }, mayBeNegative: ['cashMinusGratuity'], sanity: receiptSanity },
  }, onStatus);
}

export function scanEnvelope(file, onStatus) {
  return scan(file, {
    crop: false, width: 2000, score: envelopeScore, good: 4, parse: parseEnvelope, eqs: ENVELOPE_EQS, opts: {},
  }, onStatus);
}

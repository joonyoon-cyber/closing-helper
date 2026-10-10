// Turns OCR text into numbers, then uses the arithmetic the receipt/envelope
// must satisfy to fill gaps and repair single misread values.

// "1,131.52", "6.941.11" (comma misread as dot), "-623.03" -> cents.
const MONEY_RE = /-?\d{1,3}(?:[.,]?\d{3})*[.,]\s?\d{2}(?!\d)/g;

export function moneyTokens(line) {
  const out = [];
  for (const m of line.matchAll(MONEY_RE)) {
    const neg = m[0].trim().startsWith('-');
    const digits = m[0].replace(/\D/g, '');
    out.push((neg ? -1 : 1) * Number(digits));
  }
  return out;
}

const lastMoney = line => {
  const t = moneyTokens(line);
  return t.length ? t[t.length - 1] : null;
};

// ---------- Receipt ("Sales Total" report) ----------

export const RECEIPT_FIELDS = ['subtotal', 'gratuity', 'total', 'cashMinusGratuity', 'cash', 'credit', 'offline', 'debit'];

export const RECEIPT_EQS = [
  { label: 'Subtotal (E) + Gratuity (F) = Total (G)', terms: { subtotal: 1, gratuity: 1, total: -1 } },
  { label: 'Cash − Gratuity = line H', terms: { cash: 1, gratuity: -1, cashMinusGratuity: -1 } },
  { label: 'Cash + Credit + Other payments = Total (G)', terms: { cash: 1, credit: 1, offline: 1, debit: 1, total: -1 } },
];

// Number of impossible relationships (e.g. gratuity bigger than sales).
export function receiptSanity(v) {
  let bad = 0;
  const gt = (a, b) => v[a] !== null && v[b] !== null && v[a] > v[b];
  if (gt('gratuity', 'subtotal')) bad++;
  for (const k of ['subtotal', 'gratuity', 'cash', 'credit', 'offline', 'debit']) if (gt(k, 'total')) bad++;
  // A closing day always has sales, card payments and card tips.
  for (const k of ['subtotal', 'total', 'gratuity', 'credit']) if (v[k] === 0) bad++;
  if (v.total !== null && v.cashMinusGratuity !== null && Math.abs(v.cashMinusGratuity) >= v.total) bad++;
  return bad;
}

export function parseReceipt(text) {
  const v = Object.fromEntries(RECEIPT_FIELDS.map(f => [f, null]));
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  let inPayments = false;
  const paymentRows = [];
  const topRows = [];
  let extra = 0; // FreedomPay, WeChat Pay, Alipay (gift card is left out)
  for (const raw of lines) {
    const l = raw.toLowerCase();
    if (/count/.test(l) && /amo/.test(l)) { inPayments = true; continue; }
    if (/number of|guests|average/.test(l)) inPayments = false;
    const amt = lastMoney(raw);
    if (!inPayments) {
      if (amt !== null && !/sales date|print/.test(l)) topRows.push(amt);
      if (v.subtotal === null && /(subt|btotal|ubtot|a ?\+ ?b)/.test(l)) v.subtotal = amt;
      else if (v.cashMinusGratuity === null && /(cash|lash|ash)\W*-?\W*(grat|brat|rat)/.test(l)) v.cashMinusGratuity = amt;
      else if (v.gratuity === null && /(gratu|ratuit|atuity|tuity)/.test(l)) v.gratuity = amt;
      else if (v.total === null && /(total am|tal amo|amount ?\(e|\(e ?\+ ?f)/.test(l)) v.total = amt;
      continue;
    }
    if (amt === null) continue;
    paymentRows.push(amt);
    if (v.credit === null && /(credit|redit|edit c|it card)/.test(l)) v.credit = amt;
    else if (v.offline === null && /(offl|ffline|fline|line c)/.test(l)) v.offline = amt;
    else if (v.debit === null && /(debit|ebit)/.test(l) && !/cred/.test(l)) v.debit = amt;
    else if (/(freedom|eedom|wechat|chat pay|alipay|lipay)/.test(l) && amt > 0) extra += amt;
    else if (v.cash === null && /(cash|ash|^sh|^.sh)\b/.test(l) && !/grat/.test(l)) v.cash = amt;
  }
  // The top section always ends with E, F, G, H.
  if (inPayments || paymentRows.length) {
    const tail = topRows.slice(-4);
    if (tail.length === 4) {
      ['subtotal', 'gratuity', 'total', 'cashMinusGratuity'].forEach((k, i) => {
        if (v[k] === null) v[k] = k === 'cashMinusGratuity' ? tail[i] : Math.abs(tail[i]);
      });
    }
  }
  // Payment rows always print in the same order: Cash, Credit, Offline, Debit.
  const order = ['cash', 'credit', 'offline', 'debit'];
  order.forEach((f, i) => { if (v[f] === null && paymentRows[i] !== undefined && !Object.values(v).includes(paymentRows[i])) v[f] = paymentRows[i]; });
  // The app has one "Other payments" box: Offline C.C. + Debit + the others.
  if (v.debit || extra) { v.offline = (v.offline ?? 0) + (v.debit ?? 0) + extra; v.debit = 0; }
  return v;
}

// Digits-only OCR pass (no labels). The receipt layout is fixed:
// ... E, F, G, H, Cash, Credit, Offline ... Find G as the first amount that
// equals the sum of the two before it (E + F = G); fall back to H being the
// first negative amount (it is negative whenever gratuity exceeds cash).
export function parseReceiptDigits(text) {
  const v = Object.fromEntries(RECEIPT_FIELDS.map(f => [f, null]));
  const nums = text.split(/\n/).map(lastMoney).filter(x => x !== null);
  let g = -1;
  for (let i = 2; i < nums.length; i++) {
    if (nums[i] > 0 && nums[i - 2] > 0 && nums[i - 1] > 0 && nums[i - 2] + nums[i - 1] === nums[i]) { g = i; break; }
  }
  if (g < 0) {
    const h = nums.findIndex(x => x < 0);
    if (h < 1) return v;
    g = h - 1;
  }
  const at = i => (i >= 0 && i < nums.length ? nums[i] : null);
  v.subtotal = at(g - 2); v.gratuity = at(g - 1); v.total = at(g); v.cashMinusGratuity = at(g + 1);
  ['cash', 'credit', 'offline'].forEach((k, i) => { const x = at(g + 2 + i); if (x !== null && x >= 0) v[k] = x; });
  for (const k of ['subtotal', 'gratuity', 'total']) if (v[k] !== null && v[k] < 0) v[k] = null;
  return v;
}

// ---------- Envelope (handwritten lunch side) ----------

export const ENVELOPE_FIELDS = ['cash', 'cardSales', 'creditTips', 'cardTotal', 'total', 'cashTips', 'tips', 'cb'];

export const ENVELOPE_EQS = [
  { label: 'Cash + Card sales = Total', terms: { cash: 1, cardSales: 1, total: -1 } },
  { label: 'Card sales + Credit tips = Card total', terms: { cardSales: 1, creditTips: 1, cardTotal: -1 } },
  { label: 'Credit tips + Cash tips = Tips', terms: { creditTips: 1, cashTips: 1, tips: -1 } },
  { label: 'Cash + Cash tips = C/B', terms: { cash: 1, cashTips: 1, cb: -1 } },
];

// Handwriting: allow "105", "105.-", "105.00", "1,288.94".
const HAND_RE = /\d[\d,]*(?:\s?[.,]\s?(?:\d{1,2}|-))?/g;
function handNumbers(s) {
  const out = [];
  for (const m of s.matchAll(HAND_RE)) {
    let t = m[0].replace(/\s/g, '');
    let cents;
    const dec = t.match(/[.,](\d{1,2}|-)$/);
    if (dec) {
      const whole = t.slice(0, dec.index).replace(/\D/g, '');
      const frac = dec[1] === '-' ? '00' : dec[1].padEnd(2, '0');
      cents = Number(whole + frac);
    } else cents = Number(t.replace(/\D/g, '')) * 100;
    if (Number.isFinite(cents)) out.push(cents);
  }
  return out;
}

export function parseEnvelope(text) {
  const v = Object.fromEntries(ENVELOPE_FIELDS.map(f => [f, null]));
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  for (const raw of lines) {
    const l = raw.toLowerCase();
    const m = l.match(/^\W*(\w[\w/ ]{0,6}?)\s*[:;.]\s*(.*)$/) || [null, l, l];
    const key = m[1];
    // Only the first expression on the line belongs to lunch (left side).
    const rest = m[2];
    const eq = rest.match(/^(.*?=\s*[\d.,\s-]+)/);
    const nums = handNumbers(eq ? eq[1] : rest).slice(0, 3);
    if (!nums.length) continue;
    if (/^(ca?sh|cash|c[a@]sh|lash)$/.test(key) || /cash/.test(key)) {
      if (v.cash === null) v.cash = nums[0];
    } else if (/(card|crd|carc|cad)/.test(key)) {
      if (v.cardSales === null) [v.cardSales, v.creditTips, v.cardTotal] = [nums[0] ?? null, nums[1] ?? null, nums[2] ?? null];
    } else if (/(tota|otal|tal)/.test(key)) {
      if (v.total === null) v.total = nums[0];
    } else if (/(tip|ips|lips)/.test(key)) {
      if (v.tips === null) { v.tips = nums[2] ?? null; v.cashTips ??= nums[1] ?? null; if (v.creditTips === null) v.creditTips = nums[0]; }
    } else if (/(c\s*[/|1il]\s*[b8]|cb|clb|cib)/.test(key)) {
      if (v.cb === null) { v.cb = nums[2] ?? (nums.length === 1 ? nums[0] : null); if (nums.length >= 2 && v.cashTips === null) v.cashTips = nums[1]; }
    }
  }
  return v;
}

// ---------- Generic reconciliation ----------

function solve(vals, eqs) {
  const v = { ...vals };
  let changed = true;
  while (changed) {
    changed = false;
    for (const eq of eqs) {
      const unknown = Object.keys(eq.terms).filter(k => v[k] === null);
      if (unknown.length !== 1) continue;
      const k = unknown[0];
      let sum = 0;
      for (const [f, c] of Object.entries(eq.terms)) if (f !== k) sum += c * v[f];
      v[k] = -sum / eq.terms[k];
      changed = true;
    }
  }
  return v;
}

function failing(v, eqs) {
  return eqs.filter(eq => Object.keys(eq.terms).every(k => v[k] !== null) &&
    Object.entries(eq.terms).reduce((s, [k, c]) => s + c * v[k], 0) !== 0);
}

function digitDiff(a, b) {
  const x = String(Math.abs(a)), y = String(Math.abs(b));
  if (x.length !== y.length) return 99;
  let d = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
  return d + (Math.sign(a) !== Math.sign(b) ? 1 : 0);
}

// defaults: fields assumed 0 when unread (e.g. other payments, Debit).
export function reconcile(read, eqs, { defaults = {}, mayBeNegative = [] } = {}) {
  const start = { ...read };
  for (const [k, d] of Object.entries(defaults)) if (start[k] === null) start[k] = d;
  const filled = solve(start, eqs);
  const derived = Object.keys(read).filter(k => read[k] === null && filled[k] !== null && start[k] === null);
  if (!failing(filled, eqs).length) return { values: filled, derived, fixes: [], problems: [] };

  // Try treating each read value as the single misread one.
  const candidates = [];
  for (const k of Object.keys(start)) {
    if (start[k] === null) continue;
    const trial = solve({ ...start, [k]: null }, eqs);
    if (trial[k] === null || failing(trial, eqs).length) continue;
    if (Object.entries(trial).some(([f, x]) => x !== null && x < 0 && !(mayBeNegative || []).includes(f))) continue;
    if (digitDiff(start[k], trial[k]) > 1) continue;
    candidates.push({ field: k, from: start[k], to: trial[k], score: digitDiff(start[k], trial[k]), values: trial });
  }
  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length && (candidates.length === 1 || candidates[0].score < candidates[1].score)) {
    const c = candidates[0];
    return {
      values: c.values,
      derived: Object.keys(read).filter(k => read[k] === null && c.values[k] !== null),
      fixes: [{ field: c.field, from: c.from, to: c.to }],
      problems: [],
    };
  }
  return {
    values: filled,
    derived,
    fixes: [],
    problems: failing(filled, eqs).map(e => ({ label: e.label, fields: Object.keys(e.terms) })),
  };
}

// How "receipt-like" / "envelope-like" an OCR result is; used to pick rotation.
export function receiptScore(text) {
  const t = text.toLowerCase();
  return ['sales', 'subtotal', 'gratuity', 'total amount', 'credit', 'payment', 'discount', 'surcharge', 'alipay', 'wechat']
    .filter(w => t.includes(w)).length;
}
export function envelopeScore(text) {
  const t = text.toLowerCase();
  return ['lunch', 'cash', 'card', 'total', 'tips', 'server', 'dinner']
    .filter(w => t.includes(w)).length;
}

// Several OCR passes each give a guess per field. Pick the combination that
// satisfies the most equations (votes break ties), then reconcile.
export function combinePasses(passes, eqs, opts = {}) {
  const fields = Object.keys(passes[0] || {});
  const cands = {};
  for (const f of fields) {
    const votes = new Map();
    for (const p of passes) if (p[f] !== null && p[f] !== undefined) votes.set(p[f], (votes.get(p[f]) || 0) + 1);
    cands[f] = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }
  const defaults = opts.defaults || {};
  let best = null;
  const cur = {};
  const rec = (i, votes) => {
    if (i === fields.length) {
      const start = { ...cur };
      for (const [k, d] of Object.entries(defaults)) if (start[k] === null) start[k] = d;
      const v = solve(start, eqs);
      let score = votes * 0.1 - fields.filter(f => cur[f] === null).length;
      for (const eq of eqs) {
        const ks = Object.keys(eq.terms);
        if (!ks.every(k => v[k] !== null)) continue;
        const ok = ks.reduce((s, k) => s + eq.terms[k] * v[k], 0) === 0;
        // An equation is only evidence when every value in it was actually read.
        const allRead = ks.every(k => start[k] !== null);
        score += ok ? (allRead ? 3 : 0) : -3;
      }
      if (opts.sanity) score -= 10 * opts.sanity(v);
      if (Object.values(v).some((x, idx) => x !== null && x < 0 && !(opts.mayBeNegative || []).includes(Object.keys(v)[idx]))) score -= 10;
      if (!best || score > best.score) best = { score, read: { ...cur } };
      return;
    }
    const f = fields[i];
    for (const [val, n] of cands[f]) { cur[f] = val; rec(i + 1, votes + n); }
    cur[f] = null; rec(i + 1, votes);
  };
  rec(0, 0);
  const out = reconcile(best.read, eqs, opts);
  out.read = best.read;
  // Fields backed by an equation whose values were all read and add up.
  out.confirmed = [];
  for (const eq of eqs) {
    const ks = Object.keys(eq.terms);
    if (ks.every(k => best.read[k] !== null) && ks.reduce((t, k) => t + eq.terms[k] * best.read[k], 0) === 0) out.confirmed.push(...ks);
  }
  return out;
}

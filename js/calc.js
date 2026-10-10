// Closing math. All money is integer cents to avoid floating-point drift.

export function toCents(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/\.-$/, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function fmt(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${neg ? '-' : ''}${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

const z = v => v ?? 0;

// Splits tips the way the envelopes do: the hourly rate is cut to whole
// cents (1,660.03 / 19.5 hrs = 85.12) and each server gets hours x rate.
// The few cents left over from rounding go to a server whose hours nobody
// else has, so servers with the same hours always get the same tips. If
// everyone shares hours with someone, the leftover is spread over the last
// server's same-hours group, and only an unavoidable cent or two can differ.
// No hours entered means an even split per person.
export function splitTips(totalCents, servers) {
  const rows = (servers || []).filter(s => (s.name && s.name.trim()) || Number(s.hours) > 0);
  if (!rows.length || totalCents === null) return { rate: null, rows: [], equal: false };
  const hrs = rows.map(s => Number(s.hours) || 0);
  const noHours = hrs.every(h => h === 0);
  const weights = noHours ? rows.map(() => 1) : hrs;
  const sumW = weights.reduce((a, b) => a + b, 0);
  const rate = Math.floor(totalCents / sumW);
  const tips = weights.map(w => Math.round(w * rate));
  const leftover = totalCents - tips.reduce((a, b) => a + b, 0);

  const groupOf = i => weights.map((w, j) => j).filter(j => weights[j] === weights[i]);
  const singles = weights.map((w, i) => i).filter(i => groupOf(i).length === 1);
  const target = singles.length ? [singles[singles.length - 1]] : groupOf(rows.length - 1);
  const each = Math.trunc(leftover / target.length);
  const extra = new Array(rows.length).fill(0);
  target.forEach(i => { extra[i] += each; });
  extra[target[target.length - 1]] += leftover - each * target.length;

  const out = rows.map((s, i) => ({
    name: s.name || '',
    hours: noHours ? null : hrs[i],
    base: tips[i],
    extra: extra[i],
    tip: tips[i] + extra[i],
  }));
  const equal = noHours || hrs.every(h => h === hrs[0]);
  return { rate, rows: out, equal, noHours, leftover, totalHours: noHours ? null : sumW };
}

// Card money on the receipt = Credit Card + other payments (Offline C.C., Debit,
// FreedomPay, WeChat Pay, Alipay; not Gift Card). `debit` is kept for old data.
export function receiptCardTotal(r) {
  if (r.credit === null || r.credit === undefined) return null;
  return r.credit + z(r.offline) + z(r.debit);
}

// Lunch: the lunch receipt already only covers lunch.
export function lunchClose({ receipt, cashTips, servers }) {
  const cash = receipt.cash;
  const cardTotal = receiptCardTotal(receipt);
  const creditTips = receipt.gratuity;
  const cardSales = cardTotal - creditTips;
  const total = cash + cardSales;
  const tips = creditTips + z(cashTips);
  const cb = cash + z(cashTips);
  const split = splitTips(tips, servers);
  const checks = [];
  if (receipt.subtotal != null) checks.push(check('Total sales = receipt Subtotal (E)', total, receipt.subtotal));
  return { cash, cardSales, creditTips, cardTotal, total, cashTips: z(cashTips), tips, cb, split, checks };
}

// Dinner: end-of-day receipt minus the lunch numbers from the envelope.
export function dinnerClose({ receipt, lunch, cashTips, servers }) {
  const L = {
    cash: lunch.cash,
    cardSales: lunch.cardSales,
    creditTips: lunch.creditTips,
    cashTips: z(lunch.cashTips),
  };
  L.cardTotal = L.cardSales + L.creditTips;
  L.total = L.cash + L.cardSales;
  L.tips = L.creditTips + L.cashTips;
  L.cb = L.cash + L.cashTips;

  const dayCard = receiptCardTotal(receipt);
  const ct = z(cashTips);
  const cash = receipt.cash - L.cash;                 // 2
  const cb = cash + ct;                               // 3
  const allCB = cb + L.cb;                            // 4
  const creditTips = receipt.gratuity - L.creditTips; // 5
  const tips = creditTips + ct;                       // 6
  const cardTotal = dayCard - L.cardTotal;            // 7
  const cardSales = cardTotal - creditTips;           // 8
  const total = cardSales + cash;                     // 9
  const allSales = total + L.total;                   // 10
  const split = splitTips(tips, servers);             // 11-12

  const checks = [];
  if (receipt.subtotal != null) checks.push(check('All-day sales = receipt Subtotal (E)', allSales, receipt.subtotal));
  for (const [label, v] of [['Dinner cash', cash], ['Dinner credit tips', creditTips], ['Dinner card sales', cardSales]]) {
    if (v < 0) checks.push({ label: `${label} is negative`, ok: false });
  }
  return { lunch: L, cash, cashTips: ct, cb, allCB, creditTips, tips, cardTotal, cardSales, total, allSales, split, checks };
}

function check(label, a, b) {
  return { label, ok: a === b, a, b };
}

import { toCents, fmt, lunchClose, dinnerClose, splitTips, receiptCardTotal } from './calc.js';
import { RECEIPT_EQS } from './parse.js';
import { scanReceipt, scanEnvelope } from './ocr.js';

const $ = s => document.querySelector(s);

// Rows of inputs, in the order they appear on the receipt / envelope.
const RECEIPT_ROWS = [
  [['subtotal', 'Subtotal (E)'], ['gratuity', 'Gratuity (F)'], ['total', 'Total (G)']],
  'line',
  [['cash', 'Cash'], ['credit', 'Credit Card'], ['offline', 'Offline C.C.']],
];
const LUNCH_ROWS = [
  [['cash', 'Lunch cash']],
  [['cardSales', 'Lunch card sales'], ['creditTips', 'Lunch card tips']],
  [['cashTips', 'Lunch cash tips']],
];
const LUNCH_INPUTS = LUNCH_ROWS.flat();

const SERVER_NAMES = ['Aiden', 'Arllany', 'Jeisler', 'Lisbeth', 'Nathalie', 'Skye', 'Vanessa', 'Zuleyma'];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let state;
const key = (date, mode) => `closing:${date}:${mode}`;
const blank = () => ({ receipt: {}, lunch: {}, cashTips: '', servers: [{ name: '', hours: '' }], tags: {} });

function load(date, mode) {
  const s = store.get(key(date, mode)) || blank();
  return { ...blank(), ...s, date, mode };
}
function save() {
  const { date, mode, ...rest } = state;
  store.set(key(date, mode), rest);
  store.set('closing:last', { date, mode });
}

// ---------- rendering inputs ----------

function fieldsHTML(group, rows, cols) {
  return rows.map(row => row === 'line' ? '<hr class="divider">' : `<div class="frow" style="--cols:${cols}">` + row.map(([k, label]) => `
    <label class="field"><span>${label}</span>
      <input inputmode="decimal" data-group="${group}" data-k="${k}" placeholder="0.00">
      <span class="tag" data-tag="${group}.${k}"></span></label>`).join('') + '</div>').join('') +
    `<div class="legend"><span><i style="background:var(--read)"></i>read from photo</span><span><i style="background:var(--fixed)"></i>auto-corrected – please check</span></div>`;
}

function fillInputs() {
  document.querySelectorAll('input[data-group]').forEach(inp => {
    const g = inp.dataset.group, k = inp.dataset.k;
    inp.value = state[g][k] ?? '';
    const tag = state.tags[`${g}.${k}`] || '';
    inp.className = tag;
    const el = document.querySelector(`[data-tag="${g}.${k}"]`);
    if (el) el.textContent = { read: '', calc: 'calculated', fixed: 'auto-corrected' }[tag] || '';
  });
  $('#cashTips').value = state.cashTips;
}

function nameOptions(current) {
  const extra = store.get('closing:extraNames') || [];
  const names = [...new Set([...SERVER_NAMES, ...extra, ...(current ? [current] : [])])].sort((a, b) => a.localeCompare(b));
  return `<option value="">Server…</option>` +
    names.map(n => `<option value="${esc(n)}"${n === current ? ' selected' : ''}>${esc(n)}</option>`).join('') +
    `<option value="__other">Other…</option>`;
}

function renderServers() {
  $('#servers').innerHTML = state.servers.map((s, i) => `
    <div class="server">
      <select data-i="${i}" data-f="name" aria-label="Server">${nameOptions(s.name)}</select>
      <input placeholder="Hours" inputmode="decimal" value="${esc(s.hours)}" data-i="${i}" data-f="hours">
      <button data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button data-del="${i}" aria-label="Remove">✕</button>
    </div>`).join('');
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderMode() {
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  const dinner = state.mode === 'dinner';
  $('#lunchSection').hidden = !dinner;
  $('#tipsStep').textContent = dinner ? '3' : '2';
  $('#serversStep').textContent = dinner ? '4' : '3';
  $('#cashTipsTitle').textContent = dinner ? 'Dinner cash tips' : 'Lunch cash tips';
  $('#receiptHint').textContent = dinner ? '(end of day)' : '(printed at end of lunch)';
  const saved = store.get(key(state.date, 'lunch'));
  $('#useSavedLunch').hidden = !(dinner && saved && saved.receipt && saved.receipt.cash);
}

function renderAll() {
  renderMode();
  fillInputs();
  renderServers();
  compute();
}

// ---------- compute + output ----------

function cents(group) {
  const out = {};
  for (const [k, v] of Object.entries(state[group])) out[k] = toCents(v);
  return out;
}

function receiptChecks(r) {
  const items = [];
  const vals = { ...r, offline: r.offline ?? 0, debit: 0, cashMinusGratuity: null };
  for (const eq of RECEIPT_EQS) {
    const ks = Object.keys(eq.terms);
    if (!ks.every(k => vals[k] !== null && vals[k] !== undefined)) continue;
    const sum = ks.reduce((s, k) => s + eq.terms[k] * vals[k], 0);
    items.push({ ok: sum === 0, label: eq.label + (sum === 0 ? '' : ` (off by ${fmt(Math.abs(sum))})`) });
  }
  return items;
}

function checksHTML(items) {
  return items.map(c => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '!'} ${esc(c.label)}${c.ok === false && c.a != null ? ` — got ${fmt(c.a)}, receipt says ${fmt(c.b)}` : ''}</li>`).join('');
}

function serversHTML(split) {
  if (!split.rows.length) return '';
  const head = split.rate === null ? 'split evenly' : `${split.totalHours} / ${fmt(split.rate)}` + (split.equal ? ' · same hours, split evenly' : '');
  return `<div class="sec"><div class="h">Server</div><div style="font-size:15px;opacity:.8">${head}</div>` +
    split.rows.map(s => `<div class="srv"><span>${s.hours ?? ''}</span><span>${esc(s.name)}</span><span>${fmt(s.tip)}</span></div>`).join('') + '</div>';
}

function compute() {
  const r = cents('receipt');
  $('#receiptChecks').innerHTML = checksHTML(receiptChecks(r));
  const ct = toCents(state.cashTips) ?? 0;
  const servers = state.servers;
  const need = [];
  if (r.cash === null || r.cash === undefined) need.push('receipt Cash');
  if (r.credit === null || r.credit === undefined) need.push('receipt Credit Card');
  if (r.gratuity === null || r.gratuity === undefined) need.push('receipt Gratuity');

  let html = '', steps = [], checks = [];
  if (state.mode === 'lunch') {
    if (!need.length) {
      const o = lunchClose({ receipt: r, cashTips: ct, servers });
      html = `<div class="sec"><div class="h">Lunch</div>
        <div>Cash: ${fmt(o.cash)}</div>
        <div>Card: ${fmt(o.cardSales)} + ${fmt(o.creditTips)} = ${fmt(o.cardTotal)}</div>
        <div class="rule"></div>
        <div>Total: ${fmt(o.total)}</div>
        <div>Tips: ${fmt(o.creditTips)} + ${fmt(o.cashTips)} = ${fmt(o.tips)}</div>
        <div>C/B: ${fmt(o.cash)} + ${fmt(o.cashTips)} = ${fmt(o.cb)}</div></div>` + serversHTML(o.split);
      steps = [
        `Card total (Credit${r.offline ? ' + Offline C.C.' : ''}) = ${fmt(o.cardTotal)}`,
        `Card sales = card total − gratuity = ${fmt(o.cardTotal)} − ${fmt(o.creditTips)} = ${fmt(o.cardSales)}`,
        `Total sales = cash + card sales = ${fmt(o.cash)} + ${fmt(o.cardSales)} = ${fmt(o.total)}`,
        `Tips = credit tips + cash tips = ${fmt(o.creditTips)} + ${fmt(o.cashTips)} = ${fmt(o.tips)}`,
        `C/B = cash + cash tips = ${fmt(o.cash)} + ${fmt(o.cashTips)} = ${fmt(o.cb)}`,
        ...splitSteps(o.tips, o.split),
      ];
      checks = o.checks;
    }
  } else {
    const L = cents('lunch');
    for (const [k, label] of LUNCH_INPUTS.slice(0, 3)) if (L[k] === null || L[k] === undefined) need.push(label.toLowerCase());
    const lunchChecks = [];
    if (!need.length) {
      const lc = L.cashTips ?? 0;
      lunchChecks.push({ ok: null, label: `Envelope should show — Card total ${fmt(L.cardSales + L.creditTips)}, Total ${fmt(L.cash + L.cardSales)}, Tips ${fmt(L.creditTips + lc)}, C/B ${fmt(L.cash + lc)}` });
    }
    $('#lunchChecks').innerHTML = checksHTML(lunchChecks);
    if (!need.length) {
      const o = dinnerClose({ receipt: r, lunch: { ...L, cashTips: L.cashTips ?? 0 }, cashTips: ct, servers });
      html = `<div class="sec"><div class="h">Dinner</div>
        <div>Cash: ${fmt(o.cash)}</div>
        <div>Card: ${fmt(o.cardSales)} + ${fmt(o.creditTips)} = ${fmt(o.cardTotal)}</div>
        <div class="rule"></div>
        <div>Total: ${fmt(o.total)}</div>
        <div>Tips: ${fmt(o.cashTips)} + ${fmt(o.creditTips)} = ${fmt(o.tips)}</div>
        <div>C/B: ${fmt(o.cashTips)} + ${fmt(o.cash)} = ${fmt(o.cb)}</div></div>` +
        serversHTML(o.split) +
        `<div class="sec"><div class="h">All Sales</div><div class="big">${fmt(o.allSales)}</div><div>C/B: <span class="big">${fmt(o.allCB)}</span></div></div>`;
      const dayCard = receiptCardTotal(r);
      steps = [
        `Cash tips (typed): ${fmt(o.cashTips)}`,
        `Dinner cash = receipt cash − lunch cash = ${fmt(r.cash)} − ${fmt(o.lunch.cash)} = ${fmt(o.cash)}`,
        `Dinner C/B = dinner cash + cash tips = ${fmt(o.cash)} + ${fmt(o.cashTips)} = ${fmt(o.cb)}`,
        `All-day C/B = dinner C/B + lunch C/B = ${fmt(o.cb)} + ${fmt(o.lunch.cb)} = ${fmt(o.allCB)}`,
        `Dinner credit tips = gratuity − lunch card tips = ${fmt(r.gratuity)} − ${fmt(o.lunch.creditTips)} = ${fmt(o.creditTips)}`,
        `All dinner tips = dinner credit tips + cash tips = ${fmt(o.creditTips)} + ${fmt(o.cashTips)} = ${fmt(o.tips)}`,
        `Dinner credit total = credit${r.offline ? ' (incl. Offline C.C.)' : ''} − lunch card total = ${fmt(dayCard)} − ${fmt(o.lunch.cardTotal)} = ${fmt(o.cardTotal)}`,
        `Dinner card sales = dinner credit total − dinner credit tips = ${fmt(o.cardTotal)} − ${fmt(o.creditTips)} = ${fmt(o.cardSales)}`,
        `Dinner total sales = dinner card sales + dinner cash = ${fmt(o.cardSales)} + ${fmt(o.cash)} = ${fmt(o.total)}`,
        `All-day sales = dinner total + lunch total = ${fmt(o.total)} + ${fmt(o.lunch.total)} = ${fmt(o.allSales)}`,
        ...splitSteps(o.tips, o.split),
      ];
      checks = o.checks;
    }
  }
  if (need.length) html = `<p class="empty">Still need: ${need.join(', ')}.</p>`;
  if (!state.servers.some(s => s.name || s.hours) && !need.length) checks = [...checks, { ok: null, label: 'Add servers to split the tips' }];
  $('#envelope').innerHTML = html;
  $('#resultChecks').innerHTML = checksHTML(checks);
  $('#steps').innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join('');
}

function splitSteps(tips, split) {
  if (!split.rows.length) return [];
  const out = [];
  if (split.rate !== null) out.push(`Hourly rate = ${fmt(tips)} ÷ ${split.totalHours} hrs = ${fmt(split.rate)} (cut to whole cents)`);
  if (split.equal) out.push(`${split.rate === null ? 'No hours entered' : 'Everyone has the same hours'} → split ${fmt(tips)} evenly between ${split.rows.length}`);
  split.rows.forEach(s => out.push(s.remainder
    ? `${s.name || 'Last server'} (last) = ${fmt(tips)} − everyone else = ${fmt(s.tip)}`
    : `${s.name || 'Server'} = ${split.equal ? `${fmt(tips)} ÷ ${split.rows.length}` : `${s.hours} × ${fmt(split.rate)}`} = ${fmt(s.tip)}`));
  return out;
}

// ---------- events ----------

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.group) {
    state[t.dataset.group][t.dataset.k] = t.value;
    delete state.tags[`${t.dataset.group}.${t.dataset.k}`];
    t.className = '';
  } else if (t.id === 'cashTips') state.cashTips = t.value;
  else if (t.dataset.f) {
    if (t.value === '__other') return;
    state.servers[+t.dataset.i][t.dataset.f] = t.value;
  }
  else return;
  save();
  compute();
});

// "Other…" in the server list: type a name once, it stays in the list on this phone.
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f !== 'name' || t.value !== '__other') return;
  const i = +t.dataset.i;
  const name = (prompt('Server name') || '').trim();
  if (name) {
    const extra = new Set(store.get('closing:extraNames') || []);
    if (!SERVER_NAMES.includes(name)) extra.add(name);
    store.set('closing:extraNames', [...extra]);
    state.servers[i].name = name;
    save();
  }
  renderServers();
  compute();
});

$('#servers').addEventListener('click', e => {
  const up = e.target.dataset.up, del = e.target.dataset.del;
  if (up !== undefined) { const i = +up; [state.servers[i - 1], state.servers[i]] = [state.servers[i], state.servers[i - 1]]; }
  else if (del !== undefined) { state.servers.splice(+del, 1); if (!state.servers.length) state.servers.push({ name: '', hours: '' }); }
  else return;
  save(); renderServers(); compute();
});
$('#addServer').addEventListener('click', () => { state.servers.push({ name: '', hours: '' }); save(); renderServers(); compute(); });

document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => switchTo(state.date, b.dataset.mode)));
$('#date').addEventListener('change', e => switchTo(e.target.value || today(), state.mode));

$('#clearDay').addEventListener('click', () => {
  if (!confirm(`Clear everything entered for this ${state.mode} shift?`)) return;
  store.del(key(state.date, state.mode));
  state = load(state.date, state.mode);
  renderAll();
});

$('#useSavedLunch').addEventListener('click', applySavedLunch);

function applySavedLunch() {
  const saved = store.get(key(state.date, 'lunch'));
  if (!saved) return;
  const r = {}; for (const [k, v] of Object.entries(saved.receipt || {})) r[k] = toCents(v);
  if (r.cash == null || r.credit == null || r.gratuity == null) return;
  const o = lunchClose({ receipt: r, cashTips: toCents(saved.cashTips) ?? 0, servers: [] });
  state.lunch = { cash: fmt(o.cash).replace(/,/g, ''), cardSales: fmt(o.cardSales).replace(/,/g, ''), creditTips: fmt(o.creditTips).replace(/,/g, ''), cashTips: fmt(o.cashTips).replace(/,/g, '') };
  for (const [k] of LUNCH_INPUTS) state.tags[`lunch.${k}`] = 'read';
  save(); fillInputs(); compute();
}

function switchTo(date, mode) {
  state = load(date, mode);
  $('#date').value = date;
  save();
  if (mode === 'dinner' && !Object.values(state.lunch).some(v => v !== '' && v != null)) applySavedLunch();
  renderAll();
}

// ---------- photos ----------

function wirePhoto(inputSel, boxSel, scanFn, group, mapping, { requireConfirmed = false } = {}) {
  $(inputSel).addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const box = $(boxSel), img = box.querySelector('img'), status = box.querySelector('.status');
    box.hidden = false;
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(file);
    status.textContent = 'Starting…';
    try {
      const res = await scanFn(file, msg => { status.textContent = msg; });
      if (location.hash === '#debug') console.log('OCR', JSON.stringify(res.read), '\n' + res.texts.join('\n-----\n'));
      let got = 0;
      for (const [from, to] of Object.entries(mapping)) {
        const v = res.values[from];
        const tagKey = `${group}.${to}`;
        if (v === null || v === undefined || !Number.isFinite(v)) continue;
        state[group][to] = (v / 100).toFixed(2);
        const wasRead = res.read && res.read[from] !== null && res.read[from] !== undefined;
        const fixed = res.fixes.some(f => f.field === from);
        // Only fill what was actually read (or a one-digit repair). Values derived
        // from other OCR'd numbers inherit their errors, so leave those to type in.
        if (!wasRead && !fixed) continue;
        if (requireConfirmed && !res.confirmed.includes(from)) continue;
        state.tags[tagKey] = fixed ? 'fixed' : 'read';
        got++;
      }
      const missing = Object.values(mapping).length - got;
      status.textContent = got
        ? `Filled ${got} number${got > 1 ? 's' : ''}${missing ? `, ${missing} to type in` : ''}. Tap the photo to zoom and compare.`
        : requireConfirmed
          ? 'Couldn\'t read the handwriting reliably — tap the photo to zoom and type the numbers in.'
          : 'Couldn\'t read numbers from this photo — try again closer and flatter, or type them in.';
      if (res.problems.length) status.textContent += ` ⚠ ${res.problems.map(p => p.label).join('; ')} doesn't add up — check those.`;
      save(); fillInputs(); compute();
    } catch (err) {
      status.textContent = `Couldn't read the photo: ${err.message}. You can type the numbers in.`;
    }
  });
  $(boxSel).querySelector('img').addEventListener('click', e => e.target.classList.toggle('big'));
}

// ---------- init ----------

$('#receiptFields').innerHTML = fieldsHTML('receipt', RECEIPT_ROWS, 3);
$('#lunchFields').innerHTML = fieldsHTML('lunch', LUNCH_ROWS, 2);
wirePhoto('#receiptPhoto', '#receiptScan', scanReceipt, 'receipt',
  { cash: 'cash', credit: 'credit', gratuity: 'gratuity', offline: 'offline', subtotal: 'subtotal', total: 'total' });
wirePhoto('#envelopePhoto', '#envelopeScan', scanEnvelope, 'lunch',
  { cash: 'cash', cardSales: 'cardSales', creditTips: 'creditTips', cashTips: 'cashTips' }, { requireConfirmed: true });

const last = store.get('closing:last');
const startDate = today();
const startMode = last && last.date === startDate ? last.mode : (new Date().getHours() < 16 ? 'lunch' : 'dinner');
switchTo(startDate, startMode);

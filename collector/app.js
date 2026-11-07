/* ============================================================
   collector/app.js - V3.2
   14 قسماً + init — انظر عناوين الأقسام أدناه
============================================================ */

/* ===================== 1) Imports ===================== */
import {
  db, initDb, buildBldKey, normalizeName, recordPayment, getUnreadSubscribers, searchByFullCode,
  searchByName, getCurrentPeriod, getBuildingWithMovements, getDigitConfig, getLineOfRoute,
  setLineOfRoute, inferLineOfRoute, getGovMap, getRegionMap, formatSubscriberRef, billPendingReadings,
  numberToArabicWords, listDistinct, FIELD_ORDER, FIELD_LABELS
} from '../shared/db.js';
import { importFromServer } from './importer.js';

/* ===================== 2) State + Helpers ===================== */
const state = {
  sector: '', blk: '', bld: '', apt: '',
  subscribers: null,           // null = يحتاج إعادة تحميل
  byKey: new Map(), buildings: {}, readKeys: new Set(),
  searchMode: 'code', searchGov: '', searchRegion: '', searchQuery: '',
  searchCode: Array(8).fill(''), searchBld: null, searchHighlight: '',
  ledgerTab: 'pay',
  lineOfRoute: null, govMap: {}, regionMap: {}, digitCfg: {}
};
let currentTab = 'home';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج`;
const fmtDate = (d) => new Date(d).toLocaleString('ar-EG');
function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const digitsOnly = (v) => String(v ?? '')
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
const bldDigits = () => FIELD_ORDER.slice(0, 6).reduce((n, f) => n + (state.digitCfg[f] || 2), 0);
const govName = (c) => state.govMap[c] ? `${state.govMap[c]}` : c;
const regionName = (c) => state.regionMap[c] ? `${state.regionMap[c]}` : c;
const refOf = (sub, opts) => formatSubscriberRef(sub, state.lineOfRoute, opts);

function makeDialog(html, style = '') {
  const d = document.createElement('dialog');
  if (style) d.style.cssText = style;
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

/** إعادة رسم الصفحة الحالية بعد أي تغيير في البيانات */
function refreshAll() {
  state.subscribers = null;
  switchTab(currentTab, true);
}

/* ===================== 3) الثيمات ===================== */
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  try { localStorage.setItem('app-theme', theme); } catch (e) { /* تجاهل */ }
  $$('[data-theme-pick]').forEach(b => b.classList.toggle('active', b.dataset.themePick === theme));
  const colors = { light: '#ffffff', dark: '#0a1722', desert: '#f5e6d0', highcontrast: '#000000', green: '#e6f4ea', orange: '#fff3e6' };
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && colors[theme]) meta.setAttribute('content', colors[theme]);
}
function initTheme() {
  let t = 'light';
  try { t = localStorage.getItem('app-theme') || 'light'; } catch (e) { /* تجاهل */ }
  applyTheme(t);
}

/* ===================== 4) القائمة ===================== */
function closeMenu() { $('menu').hidden = true; $('themeWrap').classList.remove('open'); }
function bindMenu() {
  $('menuBtn').onclick = (e) => { e.stopPropagation(); const h = $('menu').hidden; closeMenu(); $('menu').hidden = !h; };
  document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) closeMenu(); });
  $('themeToggle').onclick = (e) => { e.stopPropagation(); $('themeWrap').classList.toggle('open'); };
  $$('[data-theme-pick]').forEach(b => b.onclick = (e) => { e.stopPropagation(); applyTheme(b.dataset.themePick); });
  $$('[data-nav]').forEach(b => b.onclick = () => { closeMenu(); switchTab(b.dataset.nav); });
  $('homeBtn').onclick = () => switchTab('home');
  $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $('exitBtn').onclick = () => { if (confirm('هل تريد الخروج؟')) location.reload(); };
  const net = () => { $('netStatus').textContent = navigator.onLine ? 'متصل' : 'غير متصل'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

/* ===================== 5) switchTab ===================== */
function removeSelectionBar() { const b = $('selectionBar'); if (b) b.remove(); }

function switchTab(tab, keepScroll = false) {
  currentTab = tab;
  if (tab !== 'home') removeSelectionBar();
  $$('.view').forEach(v => v.classList.remove('active'));
  const v = $(`view-${tab}`);
  if (v) v.classList.add('active');
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (!keepScroll) window.scrollTo(0, 0);
  const map = { home: renderHome, search: renderSearch, readings: renderReadings, ledger: renderLedger, details: renderDetails, settings: renderSettings };
  (map[tab] || renderHome)();
}

/* ===================== 6) renderHome ===================== */
async function ensureLineOfRoute() {
  if (state.lineOfRoute) return state.lineOfRoute;
  let lor = await getLineOfRoute();
  if (!lor) {
    lor = await inferLineOfRoute();
    if (lor) await setLineOfRoute(lor);
  }
  if (lor) { lor = { ...lor }; delete lor.route; }   // اليومية = القطاع: تتبع القطاع المختار ولا تُثبَّت
  state.lineOfRoute = lor;
  return lor;
}

async function loadRouteData() {
  const lor = await ensureLineOfRoute();
  const subs = lor
    ? await db.subscribers.where('gov').equals(lor.gov).filter(s => s.region === lor.region).toArray()
    : [];
  state.subscribers = subs;
  state.byKey = new Map(subs.map(s => [s.key, s]));
  state.buildings = {};
  subs.forEach(s => {
    if (Number(s.dueAmount) <= 0) return;                // المسدَّد يختفي من التحصيل ويظهر في البحث
    const b = state.buildings[s.bldKey] || (state.buildings[s.bldKey] = { bldKey: s.bldKey, sector: s.sector, blk: s.blk, bld: s.bld, apts: [] });
    b.apts.push(s);
  });
  const reads = await db.movements.where('period').equals(getCurrentPeriod()).filter(m => m.type === 'read').toArray();
  state.readKeys = new Set(reads.map(r => r.key));
  $('who').textContent = lor ? `خط السير · منطقة ${regionName(lor.region)}` : 'بلا خط سير';
}

const uniqSorted = (arr) => [...new Set(arr)].sort();
const optHtml = (vals, sel, label, withAll) =>
  (withAll ? `<option value="">${withAll}</option>` : '') +
  vals.map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label} ${v}</option>`).join('');

async function renderHome() {
  const view = $('view-home');
  removeSelectionBar();
  if (!state.digitCfg.gov) state.digitCfg = await getDigitConfig();
  state.govMap = await getGovMap(); state.regionMap = await getRegionMap();
  if (state.subscribers === null) await loadRouteData();

  if ((await db.subscribers.count()) === 0) {
    view.innerHTML = `<div class="card empty"><h2>لا توجد بيانات</h2><button id="btnFetch" class="btn btn-primary" style="margin-top:12px">📥 تحميل ملف العملاء</button></div>`;
    $('btnFetch').onclick = async () => {
      try { await importFromServer(() => {}); } catch (e) { return; }
      state.lineOfRoute = null; state.subscribers = null; renderHome();
    };
    return;
  }

  const lor = state.lineOfRoute;
  const blds = Object.values(state.buildings);
  const totalRouteDue = blds.reduce((s, b) => s + b.apts.reduce((x, a) => x + (Number(a.dueAmount) || 0), 0), 0);

  // الثوابت (غير قابلة للتعديل)
  let html = `<div class="card const-card" id="routeLabel">
    <div class="chip"><small>محافظة</small><b>${escapeHtml(govName(lor.gov))}</b></div>
    <div class="chip"><small>منطقة</small><b>${escapeHtml(regionName(lor.region))}</b></div>
    //<div class="chip"><small>يومية (= القطاع)</small><b id="routeChip"></b></div>
    <div class="chip"><small> يومية</small><b id="routeChip"></b></div>
    <div class="chip"><small>فرعي</small><b>${escapeHtml(lor.sub || '00')}</b></div>
  </div>`;

  if (!blds.length) {
    view.innerHTML = html.replace('<b id="routeChip"></b>', '<b>--</b>') + `<div class="card empty">✅ لا توجد مديونيات في خط السير الحالي</div>`;
    return;
  }

  // المتغيرات: قطاع / بلوك / عمارة / شقة
  const secs = uniqSorted(blds.map(b => b.sector));
  if (!secs.includes(state.sector)) { state.sector = secs[0]; state.blk = ''; state.bld = ''; state.apt = ''; }
  const blks = uniqSorted(blds.filter(b => b.sector === state.sector).map(b => b.blk));
  if (!blks.includes(state.blk)) { state.blk = blks[0]; state.bld = ''; state.apt = ''; }
  const bldList = blds.filter(b => b.sector === state.sector && b.blk === state.blk).sort((a, b) => a.bld.localeCompare(b.bld));
  if (state.bld && !bldList.some(b => b.bld === state.bld)) { state.bld = ''; state.apt = ''; }
  const curBld = bldList.find(b => b.bld === state.bld) || null;
  const aptVals = curBld ? uniqSorted(curBld.apts.map(a => a.apt)) : [];
  if (state.apt && !aptVals.includes(state.apt)) state.apt = '';

  html = html.replace('<b id="routeChip"></b>', `<b>${escapeHtml(state.sector)}</b>`);
  $('who').textContent = `خط السير · يومية ${state.sector} · منطقة ${regionName(lor.region)}`;
  html += `<div class="card"><div class="sel-grid">
    <div><label>القطاع</label><select id="selSector">${optHtml(secs, state.sector, 'قطاع')}</select></div>
    <div><label>البلوك</label><select id="selBlk">${optHtml(blks, state.blk, 'بلوك')}</select></div>
    <div><label>العمارة</label><select id="selBld">${optHtml(bldList.map(b => b.bld), state.bld, 'عمارة', '-- كل العمارات --')}</select></div>
    <div><label>الشقة</label><select id="selApt" ${curBld ? '' : 'disabled'}>${optHtml(aptVals, state.apt, 'شقة', '-- كل الشقق --')}</select></div>
  </div></div>`;

  if (curBld) {
    const apts = curBld.apts.filter(a => !state.apt || a.apt === state.apt)
      .sort((a, b) => (a.apt + a.sub).localeCompare(b.apt + b.sub));
    const totalDue = curBld.apts.reduce((s, a) => s + (Number(a.dueAmount) || 0), 0);
    html += `<div class="card">
      <div class="row-title">
        <div style="display:flex;align-items:center;gap:8px">
          <button id="btnBack" class="mini ghost">⏪ رجوع</button>
          <h3>عمارة ${curBld.bld} <span style="color:var(--danger);font-size:13px">(${fmtMoney(totalDue)})</span></h3>
        </div>
        <button id="btnSelectAll" class="mini read">تحديد الكل</button>
      </div>
      ${apts.map(a => aptRowHome(a)).join('')}
    </div>`;
  } else {
    html += `<div class="card" style="text-align:center;font-weight:800">إجمالي خط السير: <span style="color:var(--danger)">${fmtMoney(totalRouteDue)}</span></div>`;
    html += bldList.map((b, i) => {
      const due = b.apts.reduce((s, a) => s + (Number(a.dueAmount) || 0), 0);
      return `<div class="bld-card" data-bld="${b.bld}" style="background:color-mix(in srgb, var(--primary) ${[0, 3, 6, 9][i % 4]}%, var(--card))">
        <div><b>عمارة ${b.bld}</b><div class="apt-sub">${b.apts.length} عميل</div></div><div class="due">${fmtMoney(due)}</div></div>`;
    }).join('');
  }
  view.innerHTML = html;
  bindHomeEvents(curBld);
}

function aptRowHome(a) {
  const due = Number(a.dueAmount) || 0;
  const hasRead = state.readKeys.has(a.key);
  return `<div class="card apt-card" style="margin-bottom:8px">
    <div class="apt-main">
      <input type="checkbox" class="chk-apt" data-key="${a.key}">
      <div style="min-width:0">
        <div class="apt-name">${escapeHtml(a.name)} ${hasRead ? '✅' : ''}</div>
        <div class="apt-sub">${escapeHtml(refOf(a, { withSector: true }))} · ${a.count || 0} فاتورة</div>
        <div class="apt-due">مستحق: ${fmtMoney(due)}</div>
      </div>
    </div>
    <div class="apt-actions">
      <button class="btn-notify" data-act="notify" data-key="${a.key}" title="إخطار">🔔</button>
      <button class="mini pay" data-act="pay" data-key="${a.key}">تحصيل</button>
      <button class="mini ${hasRead ? 'done' : 'read'}" data-act="read" data-key="${a.key}">${hasRead ? 'تعديل' : 'قراءة'}</button>
    </div>
  </div>`;
}

function bindHomeEvents(curBld) {
  const sel = (id, fn) => { const e = $(id); if (e) e.onchange = (ev) => { fn(ev.target.value); renderHome(); }; };
  sel('selSector', v => { state.sector = v; state.blk = ''; state.bld = ''; state.apt = ''; });
  sel('selBlk', v => { state.blk = v; state.bld = ''; state.apt = ''; });
  sel('selBld', v => { state.bld = v; state.apt = ''; });
  sel('selApt', v => { state.apt = v; });
  $$('.bld-card').forEach(c => c.onclick = () => { state.bld = c.dataset.bld; state.apt = ''; renderHome(); });
  if (!curBld) return;

  $('btnBack').onclick = () => { state.bld = ''; state.apt = ''; renderHome(); };
  $('btnSelectAll').onclick = () => {
    const chks = $$('.chk-apt');
    const all = chks.every(c => c.checked);
    chks.forEach(c => c.checked = !all);
    updateSelectionBar();
  };
  $$('.chk-apt').forEach(c => c.onchange = updateSelectionBar);

  $$('[data-act]').forEach(b => b.onclick = () => {
    const sub = state.byKey.get(b.dataset.key);
    if (!sub) return;
    if (b.dataset.act === 'notify') openNotifyModal(sub);
    else if (b.dataset.act === 'pay') openPaymentModal(sub, 'route');
    else openReadingDialog(sub);
  });
}

function updateSelectionBar() {
  const selected = $$('.chk-apt:checked').map(c => state.byKey.get(c.dataset.key)).filter(Boolean);
  let bar = $('selectionBar');
  if (!selected.length) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'selectionBar'; bar.className = 'selection-bar'; document.body.appendChild(bar); }
  const total = selected.reduce((s, a) => s + (Number(a.dueAmount) || 0), 0);
  bar.innerHTML = `<div style="font-weight:800">المحدد: ${selected.length} شقة · الإجمالي: ${fmtMoney(total)}</div>
    <button id="btnPayBulk" class="btn btn-success">سداد المحدد</button>`;
  $('btnPayBulk').onclick = async () => {
    if (!confirm(`تأكيد سداد ${selected.length} عميل بإجمالي ${fmtMoney(total)}؟`)) return;
    const moves = [];
    for (const a of selected) {
      try {
        moves.push(await recordPayment({ key: a.key, name: a.name, amount: a.dueAmount, count: a.count, source: 'route' }));
      } catch (e) { toast('تعذر سداد ' + a.name + ': ' + e.message); }
    }
    bar.remove();
    state.subscribers = null;
    if (moves.length) await showReceipt(moves);
    renderHome();
  };
}

/* ===================== 7) renderSearch ===================== */
async function renderSearch() {
  const view = $('view-search');
  if (!state.digitCfg.gov) state.digitCfg = await getDigitConfig();
  state.govMap = await getGovMap(); state.regionMap = await getRegionMap();
  const m = state.searchMode;

  let inputs = '';
  if (m === 'code') {
    inputs = `<div class="code-grid" id="codeGrid">${FIELD_ORDER.map((f, i) => `
      <div><input id="cf-${i}" data-i="${i}" inputmode="numeric" maxlength="${state.digitCfg[f] || 2}" autocomplete="off" value="${escapeHtml(state.searchCode[i])}" placeholder="${'0'.repeat(state.digitCfg[f] || 2)}">
      <small>${FIELD_LABELS[f]}</small></div>`).join('')}</div>
      <div class="apt-sub" style="text-align:center">أدخل كود العمارة (أول ${bldDigits()} رقم) على الأقل — تظهر العمارة كاملة</div>`;
  } else {
    const govs = await listDistinct('gov');
    let regs = [];
    const g = resolveLocal(state.searchGov, state.govMap, 'gov');
    if (g) regs = await listDistinct('region', s => s.gov === g);
    inputs = `<div class="sel-grid" style="margin-bottom:8px">
      <div><label>المحافظة (إلزامي)</label><input id="sGov" list="dlGov" value="${escapeHtml(state.searchGov)}" placeholder="اسم أو رقم"></div>
      <div><label>المنطقة (إلزامي)</label><input id="sRegion" list="dlRegion" value="${escapeHtml(state.searchRegion)}" placeholder="اسم أو رقم"></div></div>
      <datalist id="dlGov">${govs.map(c => `<option value="${c}">${escapeHtml(state.govMap[c] || '')}</option>`).join('')}</datalist>
      <datalist id="dlRegion">${regs.map(c => `<option value="${c}">${escapeHtml(state.regionMap[c] || '')}</option>`).join('')}</datalist>
      <input id="sName" placeholder="اسم العميل..." value="${escapeHtml(state.searchQuery)}">`;
  }

  view.innerHTML = `<div class="card search-filters">
      <div class="search-mode">
        <button data-mode="code" class="${m === 'code' ? 'on' : ''}">🔢 بالكود</button>
        <button data-mode="name" class="${m === 'name' ? 'on' : ''}">👤 بالاسم</button>
      </div>${inputs}
    </div><div id="searchResult"></div>`;

  $$('[data-mode]', view).forEach(b => b.onclick = () => { state.searchMode = b.dataset.mode; state.searchBld = null; renderSearch(); });
  if (m === 'code') bindCodeInputs(); else bindNameInputs();
  runSearch();
}

function resolveLocal(input, map, field) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^[0-9٠-٩]+$/.test(raw)) return digitsOnly(raw).padStart(state.digitCfg[field] || 2, '0');
  const n = normalizeName(raw);
  const hit = Object.entries(map).find(([, v]) => normalizeName(v) === n) || Object.entries(map).find(([, v]) => normalizeName(v).includes(n));
  return hit ? hit[0] : '';
}

function bindCodeInputs() {
  const inputs = FIELD_ORDER.map((_, i) => $(`cf-${i}`));
  const run = debounce(() => { state.searchBld = null; runSearch(); }, 250);
  inputs.forEach((inp, i) => {
    const w = state.digitCfg[FIELD_ORDER[i]] || 2;
    inp.oninput = () => {
      let v = digitsOnly(inp.value);
      if (v.length > w) {                       // لصق/كتابة أطول: وزّعها على الخانات التالية
        let rest = v; let k = i;
        while (rest && k < inputs.length) {
          const wk = state.digitCfg[FIELD_ORDER[k]] || 2;
          inputs[k].value = rest.slice(0, wk); state.searchCode[k] = inputs[k].value; rest = rest.slice(wk); k++;
        }
        inputs[Math.min(k, inputs.length - 1)].focus();
      } else {
        inp.value = v; state.searchCode[i] = v;
        if (v.length === w && i < inputs.length - 1) inputs[i + 1].focus();   // انتقال تلقائي
      }
      run();
    };
    inp.onkeydown = (e) => { if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus(); };
    inp.onfocus = () => inp.select();
  });
}

function bindNameInputs() {
  const run = debounce(() => { state.searchBld = null; runSearch(); }, 300);
  $('sGov').oninput = (e) => { state.searchGov = e.target.value; run(); };
  $('sGov').onchange = () => renderSearch();                // لتحديث قائمة المناطق
  $('sRegion').oninput = (e) => { state.searchRegion = e.target.value; run(); };
  $('sName').oninput = (e) => { state.searchQuery = e.target.value; run(); };
}

async function runSearch() {
  const box = $('searchResult');
  if (!box) return;
  try {
    if (state.searchBld) return showBuildingResult(state.searchBld, state.searchHighlight);

    if (state.searchMode === 'code') {
      const code = state.searchCode.join('');
      if (code.length < bldDigits()) { box.innerHTML = ''; return; }
      const found = await searchByFullCode(code);
      if (!found.length) { box.innerHTML = `<div class="card empty">لا توجد نتائج لهذا الكود</div>`; return; }
      const full = FIELD_ORDER.reduce((n, f) => n + (state.digitCfg[f] || 2), 0);
      state.searchHighlight = code.length >= full && found.length === 1 ? found[0].key : '';
      return showBuildingResult(found[0].bldKey, state.searchHighlight);
    }

    if (!state.searchGov.trim() || !state.searchRegion.trim()) {
      box.innerHTML = `<div class="card empty">اختر المحافظة والمنطقة أولاً (إلزامي للبحث بالاسم)</div>`; return;
    }
    if (!state.searchQuery.trim()) { box.innerHTML = ''; return; }
    const res = await searchByName(state.searchQuery, state.searchGov, state.searchRegion);
    if (!res.length) { box.innerHTML = `<div class="card empty">لا توجد نتائج</div>`; return; }
    box.innerHTML = res.map(s => `<div class="card ${Number(s.dueAmount) > 0 ? '' : 'paid'}" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><div class="apt-name">${escapeHtml(s.name)} ${Number(s.dueAmount) > 0 ? '' : '<span class="paid-badge">مسدَّد</span>'}</div>
        <div class="apt-sub">${escapeHtml(refOf(s, { withSector: true }))}</div>
        <div class="apt-due">${fmtMoney(s.dueAmount)}</div></div>
        <button class="mini read" data-bld="${s.bldKey}" data-key="${s.key}">عرض العمارة</button></div>`).join('');
    $$('[data-bld]', box).forEach(b => b.onclick = () => { state.searchBld = b.dataset.bld; state.searchHighlight = b.dataset.key; runSearch(); });
  } catch (e) { console.error(e); box.innerHTML = `<div class="card empty">خطأ: ${escapeHtml(e.message)}</div>`; }
}

async function showBuildingResult(bldKey, highlightKey) {
  const box = $('searchResult');
  const apts = await getBuildingWithMovements(bldKey);
  if (!apts.length) { box.innerHTML = `<div class="card empty">العمارة غير موجودة</div>`; return; }
  const f = apts[0];
  const totalDue = apts.reduce((s, a) => s + (Number(a.dueAmount) || 0), 0);
  const reads = new Set((await db.movements.where('period').equals(getCurrentPeriod()).filter(m => m.type === 'read').toArray()).map(r => r.key));
  const back = state.searchMode === 'name' ? `<button id="btnBackRes" class="mini ghost">⏪ النتائج</button>` : '';
  box.innerHTML = `<div class="row-title">${back}<h3>${escapeHtml(bldLabel(f))} <span style="color:var(--danger);font-size:13px">(${fmtMoney(totalDue)})</span></h3></div>` +
    apts.map(a => {
      const paid = Number(a.dueAmount) <= 0;
      const hasRead = reads.has(a.key);
      return `<div class="card apt-card ${paid ? 'paid' : ''} ${a.key === highlightKey ? 'hl' : ''}">
        <div class="apt-main"><div style="min-width:0">
          <div class="apt-name">${escapeHtml(a.name)} ${paid ? '<span class="paid-badge">مسدَّد</span>' : ''}</div>
          <div class="apt-sub">شقة ${a.apt}${a.sub !== '00' ? ' · فرعي ' + a.sub : ''} · ${a.count || 0} فاتورة</div>
          <div class="apt-due">${paid ? 'لا مديونية' : 'مستحق: ' + fmtMoney(a.dueAmount)}</div>
        </div></div>
        <div class="apt-actions">
          ${paid ? '' : `<button class="mini pay" data-act="pay" data-key="${a.key}">سداد</button>`}
          <button class="mini ${hasRead ? 'done' : 'read'}" data-act="read" data-key="${a.key}">${hasRead ? 'تعديل القراءة' : 'قراءة'}</button>
        </div></div>`;
    }).join('');
  const byKey = new Map(apts.map(a => [a.key, a]));
  const back2 = $('btnBackRes'); if (back2) back2.onclick = () => { state.searchBld = null; runSearch(); };
  $$('[data-act]', box).forEach(b => b.onclick = () => {
    const sub = byKey.get(b.dataset.key);
    if (b.dataset.act === 'pay') openPaymentModal(sub, 'search'); else openReadingDialog(sub);
  });
}

function bldLabel(s) {
  const lor = state.lineOfRoute || {};
  const p = [];
  if (s.gov !== lor.gov) p.push(`${FIELD_LABELS.gov} ${s.gov}`);
  if (s.region !== lor.region) p.push(`${FIELD_LABELS.region} ${s.region}`);
  p.push(`${FIELD_LABELS.sector} ${s.sector}`, `${FIELD_LABELS.blk} ${s.blk}`, `${FIELD_LABELS.bld} ${s.bld}`);
  return p.join(' · ');
}

/* ===================== 8) renderReadings ===================== 
async function renderReadings() {
  const view = $('view-readings');
  await ensureLineOfRoute();
  const list = (await getUnreadSubscribers(getCurrentPeriod(), state.lineOfRoute))
    .sort((a, b) => (a.bldKey + a.apt).localeCompare(b.bldKey + b.apt));
  if (!list.length) { view.innerHTML = `<div class="card empty">✅ تم تسجيل قراءات كل العملاء لهذا الشهر</div>`; return; }
  const byKey = new Map(list.map(s => [s.key, s]));
  view.innerHTML = `<div class="card summary" style="font-size:15px">بانتظار القراءة: ${list.length} عميل</div>` +
    list.map(s => `<div class="card apt-card">
      <div class="apt-main"><div style="min-width:0">
        <div class="apt-name">${escapeHtml(s.name)}</div>
        <div class="apt-sub">${escapeHtml(refOf(s, { withSector: true }))}</div>
        <div class="apt-sub">القراءة السابقة: <b>${s.prevReading}</b> · أشهر المحاسبة: <b>${s.months || 1}</b></div>
        <div class="apt-due">المديونية: ${fmtMoney(s.dueAmount)}</div>
      </div></div>
      <div class="apt-actions"><button class="mini read" data-key="${s.key}">قراءة</button></div></div>`).join('');
  $$('[data-key]', view).forEach(b => b.onclick = () => openReadingDialog(byKey.get(b.dataset.key)));
}
*/





/* ===================== 8) renderReadings ===================== */
async function renderReadings() {
  const view = $('view-readings');
  removeSelectionBar();
  await ensureLineOfRoute();
  
  if (!state.digitCfg.gov) state.digitCfg = await getDigitConfig();
  state.govMap = await getGovMap(); state.regionMap = await getRegionMap();
  
  const list = await getUnreadSubscribers(getCurrentPeriod(), state.lineOfRoute);
  if (!list.length) { 
    view.innerHTML = `<div class="card empty">✅ تم تسجيل قراءات كل العملاء لهذا الشهر</div>`; 
    return; 
  }

  // تجميع القراءات بناءً على العمارات (bldKey) تماماً مثل التحصيل
  const buildings = {};
  list.forEach(s => {
    const b = buildings[s.bldKey] || (buildings[s.bldKey] = { bldKey: s.bldKey, sector: s.sector, blk: s.blk, bld: s.bld, apts: [] });
    b.apts.push(s);
  });

  const bldList = Object.values(buildings);
  const secs = uniqSorted(bldList.map(b => b.sector));
  if (!secs.includes(state.sector)) { state.sector = secs[0]; state.blk = ''; state.bld = ''; }
  const blks = uniqSorted(bldList.filter(b => b.sector === state.sector).map(b => b.blk));
  if (!blks.includes(state.blk)) { state.blk = blks[0]; state.bld = ''; }
  const currentBlds = bldList.filter(b => b.sector === state.sector && b.blk === state.blk).sort((a, b) => a.bld.localeCompare(b.bld));
  if (state.bld && !currentBlds.some(b => b.bld === state.bld)) { state.bld = ''; }
  
  const curBld = currentBlds.find(b => b.bld === state.bld) || null;

  let html = `<div class="card summary" style="font-size:15px">إجمالي بانتظار القراءة: ${list.length} عميل</div>`;

  // فلاتر القطاع والبلوك والعمارة للقراءات
  html += `<div class="card"><div class="sel-grid">
    <div><label>القطاع</label><select id="rSelSector">${optHtml(secs, state.sector, 'قطاع')}</select></div>
    <div><label>البلوك</label><select id="rSelBlk">${optHtml(blks, state.blk, 'بلوك')}</select></div>
    <div><label>العمارة</label><select id="rSelBld">${optHtml(currentBlds.map(b => b.bld), state.bld, 'عمارة', '-- كل العمارات --')}</select></div>
  </div></div>`;

  if (curBld) {
    const apts = curBld.apts.sort((a, b) => (a.apt + a.sub).localeCompare(b.apt + b.sub));
    html += `<div class="card">
      <div class="row-title">
        <div style="display:flex;align-items:center;gap:8px">
          <button id="rBtnBack" class="mini ghost">⏪ رجوع</button>
          <h3>عمارة ${curBld.bld} <span style="color:var(--primary);font-size:13px">(${apts.names || apts.length} شقة غير مسجلة)</span></h3>
        </div>
      </div>
      ${apts.map(s => aptRowReading(s)).join('')}
    </div>`;
  } else {
    html += currentBlds.map((b, i) => {
      return `<div class="bld-card r-bld-card" data-bld="${b.bld}" style="background:color-mix(in srgb, var(--primary) ${[0, 3, 6, 9][i % 4]}%, var(--card))">
        <div><b>عمارة ${b.bld}</b><div class="apt-sub">${b.apts.length} عميل بانتظار القراءة</div></div><div class="due" style="font-size:14px;color:var(--primary)">قراءة 📋</div></div>`;
    }).join('');
  }

  view.innerHTML = html;
  bindReadingsEvents(curBld);
}

function aptRowReading(s) {
  return `<div class="card apt-card" style="margin-bottom:8px">
    <div class="apt-main">
      <div style="min-width:0">
        <div class="apt-name">${escapeHtml(s.name)}</div>
        <div class="apt-sub">${escapeHtml(refOf(s, { withSector: true }))}</div>
        <div class="apt-sub">القراءة السابقة: <b>${s.prevReading}</b> · أشهر المحاسبة: <b>${s.months || 1}</b></div>
        <div class="apt-due">المديونية: ${fmtMoney(s.dueAmount)}</div>
      </div>
    </div>
    <div class="apt-actions">
      <button class="mini read" data-key="${s.key}">تسجيل قراءة</button>
    </div>
  </div>`;
}

function bindReadingsEvents(curBld) {
  const sel = (id, fn) => { const e = $(id); if (e) e.onchange = (ev) => { fn(ev.target.value); renderReadings(); }; };
  sel('rSelSector', v => { state.sector = v; state.blk = ''; state.bld = ''; });
  sel('rSelBlk', v => { state.blk = v; state.bld = ''; });
  sel('rSelBld', v => { state.bld = v; });
  
  $$('.r-bld-card').forEach(c => c.onclick = () => { state.bld = c.dataset.bld; renderReadings(); });
  
  if (curBld) {
    const backBtn = $('rBtnBack');
    if (backBtn) backBtn.onclick = () => { state.bld = ''; renderReadings(); };
  }

  $$('[data-key]', $('view-readings')).forEach(b => {
    b.onclick = async () => {
      const sub = await db.subscribers.get(b.dataset.key);
      if (sub) openReadingDialog(sub);
    };
  });
}









/* ===================== 9) renderLedger ===================== */
async function renderLedger() {
  const view = $('view-ledger');
  await ensureLineOfRoute();
  const all = await db.movements.toArray();
  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  const today = new Date().toDateString();
  const todayTotal = all.filter(m => m.type === 'pay' && new Date(m.date).toDateString() === today)
    .reduce((s, m) => s + (Number(m.amount) || 0), 0);

  const tab = state.ledgerTab;
  const lists = {
    pay: all.filter(m => m.type === 'pay'),
    read: all.filter(m => m.type === 'read'),
    pending: all.filter(m => m.type === 'read' && m.status === 'pending')
  };
  const rows = lists[tab].slice(0, 300);
  const subs = await db.subscribers.bulkGet(rows.map(m => m.key));
  const subMap = new Map(subs.filter(Boolean).map(s => [s.key, s]));

  const card = (m) => {
    const sub = subMap.get(m.key);
    const name = m.name || (sub && sub.name) || 'غير معروف';
    const ref = sub ? refOf(sub, { withSector: true }) : '';
    if (tab === 'pay') {
      return `<div class="card" style="margin:0">
        <div class="row-title" style="margin:0">
          <div><div class="apt-name">${escapeHtml(name)} ${m.source === 'search' ? '<span class="badge">سداد خارج النطاق</span>' : ''}${m.partial ? '<span class="badge">جزئي</span>' : ''}</div>
          <div class="apt-sub">${escapeHtml(ref)}</div>
          <div class="apt-sub">${fmtDate(m.date)} · ${m.count || 0} فاتورة</div></div>
          <div style="font-weight:800;color:var(--primary);font-size:16px">${fmtMoney(m.amount)}</div>
        </div>
        <div style="margin-top:8px"><button class="mini read btn-print" data-id="${m.id}" style="width:100%">🖨️ طباعة${m.printed ? ' (طُبع)' : ''}</button></div></div>`;
    }
    const inv = m.invoice;
    const detail = tab === 'pending' && inv && inv.rows ? `<details><summary>تفصيل شهري</summary>
      <table class="mv-tbl"><thead><tr><th>الشهر</th><th>الشرائح</th><th>التكلفة</th></tr></thead><tbody>
      ${inv.rows.map(r => `<tr><td>${r.month}</td><td class="l">${r.tiers.map(t => `${escapeHtml(t.name)}: ${(+t.qty).toFixed(1)}×${t.price}`).join(' + ')}</td><td>${(+r.cost).toFixed(2)}</td></tr>`).join('')}
      <tr><td colspan="2" class="l">الرسوم (مرة واحدة)</td><td>${inv.fees}</td></tr>
      <tr><th colspan="2">الإجمالي</th><th>${inv.grandTotal}</th></tr></tbody></table></details>` : '';
    return `<div class="card" style="margin:0">
      <div class="row-title" style="margin:0">
        <div><div class="apt-name">${escapeHtml(name)} <span class="badge ${m.status === 'billed' ? 'ok' : ''}">${m.status === 'billed' ? 'مُرحَّلة' : 'فاتورة قادمة'}</span></div>
        <div class="apt-sub">${escapeHtml(ref)}</div>
        <div class="apt-sub">${fmtDate(m.date)} · فترة ${m.period}</div>
        <div class="apt-sub">القراءة: ${m.prevReading} ← <b>${m.reading}</b> · الاستهلاك: ${m.consumption} م³ · ${m.months || 1} شهر</div></div>
        <div style="font-weight:800;color:var(--primary);font-size:16px">${fmtMoney(m.estimatedInvoice)}</div>
      </div>${detail}</div>`;
  };

  view.innerHTML = `<div class="card summary">إجمالي تحصيل اليوم: ${fmtMoney(todayTotal)}</div>
    <div class="arch-tabs">
      <button data-lt="pay" class="${tab === 'pay' ? 'on' : ''}">سداد</button>
      <button data-lt="read" class="${tab === 'read' ? 'on' : ''}">قراءات</button>
      <button data-lt="pending" class="${tab === 'pending' ? 'on' : ''}">فواتير قادمة</button>
    </div>
    <button id="btnExport" class="btn btn-primary" style="width:100%;margin-bottom:12px">📤 تصدير الأرشيف (JSON)</button>
    <div class="stack">${rows.length ? rows.map(card).join('') : '<div class="card empty">لا توجد عمليات</div>'}</div>`;

  $$('[data-lt]', view).forEach(b => b.onclick = () => { state.ledgerTab = b.dataset.lt; renderLedger(); });
  $('btnExport').onclick = () => {
    const data = { collector: 'محصل', version: '3.2', date: new Date().toISOString(), lineOfRoute: state.lineOfRoute, movements: all };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `archive_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  $$('.btn-print', view).forEach(b => b.onclick = async () => {
    const m = all.find(x => x.id === Number(b.dataset.id));
    if (m) { await showReceipt([m]); }
  });
}

/* ===================== 10) renderDetails + renderSettings ===================== */
function renderDetails() {
  $('view-details').innerHTML = `<div class="placeholder"><div class="icon">👤</div><h2>بياناتي</h2><p>قيد الإنشاء</p></div>`;
}
function renderSettings() {
  $('view-settings').innerHTML = `<div class="placeholder"><div class="icon">⚙️</div><h2>الإعدادات</h2><p>قيد الإنشاء</p></div>`;
}

/* ===================== 11) showReceipt + الطباعة ===================== */
async function receiptItems(moves) {
  const subs = await db.subscribers.bulkGet(moves.map(m => m.key));
  return moves.map((m, i) => ({
    id: m.id, name: m.name || (subs[i] && subs[i].name) || 'غير معروف',
    ref: subs[i] ? refOf(subs[i], { withSector: true }) : '',
    receiptRef: m.receiptRef || '', amount: Number(m.amount) || 0, count: m.count || 0, date: m.date
  }));
}

function receiptInner(items) {
  const total = items.reduce((s, r) => s + r.amount, 0);
  return `<h2>🧾 إيصال تحصيل</h2>
    <p>التاريخ: ${fmtDate(items[0] ? items[0].date : new Date())}</p>
    <table><tr><th>العميل</th><th>المبلغ</th></tr>
    ${items.map(r => `<tr><td style="text-align:right">${escapeHtml(r.name)}<br><small>${escapeHtml(r.ref)}</small><br><small dir="ltr">${escapeHtml(r.receiptRef)}</small></td>
      <td>${fmtMoney(r.amount)}<br><small>${r.count} فاتورة</small></td></tr>`).join('')}
    <tr class="total-row"><td>الإجمالي</td><td>${fmtMoney(total)}</td></tr></table>
    <p style="margin-top:8px"><small>${numberToArabicWords(Math.round(total))} جنيهاً فقط لا غير</small></p>`;
}

/** الطباعة عبر iframe المخفي — بلا خلفيات ولا أزرار */
function printHtml(bodyHtml) {
  const f = $('printFrame');
  const doc = f.contentDocument || f.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة</title><style>
    @page { margin: 6mm; }
    * { background: none !important; color: #000 !important; box-shadow: none !important; }
    body { font-family: Tahoma, Arial, sans-serif; font-size: 13px; direction: rtl; text-align: center; margin: 0; padding: 4px; }
    h2 { font-size: 16px; margin: 4px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #000; padding: 6px; text-align: center; }
    small { font-size: 10px; }
    button { display: none !important; }
  </style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('تعذرت الطباعة'); } }, 250);
}

async function showReceipt(moves) {
  const items = await receiptItems(moves);
  const d = makeDialog(`<div class="receipt">${receiptInner(items)}</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button id="rcPrint" class="btn btn-primary" style="flex:1">🖨️ طباعة</button>
      <button id="rcClose" class="btn btn-ghost" style="flex:1">إغلاق</button></div>`);
  $('rcClose').onclick = () => d.close();
  $('rcPrint').onclick = async () => {
    printHtml(receiptInner(items));
    const ids = items.map(i => i.id).filter(Boolean);
    if (ids.length) await db.movements.where('id').anyOf(ids).modify({ printed: true });
  };
}

/* ===================== 12) openNotifyModal ===================== */
function openNotifyModal(sub) {
  const text = `عزيزي العميل ${sub.name}، نود تذكيركم بمديونية قدرها ${sub.dueAmount} جنيه. يرجى السداد لتجنب قطع الخدمة`;
  const d = makeDialog(`<h3>🔔 إخطار بالمديونية</h3>
    <div class="notify-text">${escapeHtml(text)}</div>
    <div class="stack">
      <button id="ntCopy" class="btn btn-primary">📋 نسخ</button>
      <button id="ntWa" class="btn btn-success">💬 واتساب</button>
      <button id="ntPrint" class="btn btn-warning">🖨️ طباعة</button>
      <button id="ntClose" class="btn btn-ghost">إغلاق</button></div>`);
  $('ntCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('تم النسخ'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); toast('تم النسخ');
    }
  };
  $('ntWa').onclick = () => {
    const phone = digitsOnly(sub.phone);
    const url = phone ? `https://wa.me/2${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };
  $('ntPrint').onclick = () => printHtml(`<h2>إخطار</h2><p style="line-height:2">${escapeHtml(text)}</p>`);
  $('ntClose').onclick = () => d.close();
}

/* ===================== 13) openPaymentModal ===================== */
function openPaymentModal(sub, source) {
  const due = Number(sub.dueAmount) || 0, count = Number(sub.count) || 0;
  if (due <= 0) return toast('لا توجد مديونية');
  const canPartial = count > 1;
  const d = makeDialog(`<h3>سداد: ${escapeHtml(sub.name)}</h3>
    <p style="font-weight:800;color:var(--danger)">المديونية: ${fmtMoney(due)} (${count} فاتورة)</p>
    <div class="stack">
      <button id="payFull" class="btn btn-success">سداد كلي (${fmtMoney(due)})</button>
      ${canPartial ? '<button id="payPartial" class="btn btn-primary">سداد جزئي</button>' : ''}
    </div>
    <div id="partialBox" style="display:none;margin-top:10px" class="stack">
      <input id="pCount" type="number" inputmode="numeric" placeholder="عدد الفواتير (أقل من ${count})">
      <input id="pAmount" type="number" inputmode="decimal" placeholder="المبلغ المدفوع (أقل من ${due})">
      <button id="confirmPartial" class="btn btn-success">تأكيد الدفع</button>
    </div>
    <button id="payCancel" class="btn btn-ghost" style="width:100%;margin-top:10px">إلغاء</button>`);

  const finish = async (amount, cnt) => {
    try {
      const move = await recordPayment({ key: sub.key, name: sub.name, amount, count: cnt, source });
      d.close();
      state.subscribers = null;
      await showReceipt([move]);
      switchTab(currentTab, true);
    } catch (e) { toast('خطأ: ' + e.message, 3500); }
  };
  $('payCancel').onclick = () => d.close();
  $('payFull').onclick = () => finish(due, count);
  if (canPartial) {
    $('payPartial').onclick = () => { $('partialBox').style.display = 'flex'; $('payPartial').style.display = 'none'; };
    $('confirmPartial').onclick = () => {
      const c = Number($('pCount').value), a = Number($('pAmount').value);
      if (!(c >= 1 && c < count) || !(a > 0 && a < due)) return toast('بيانات غير صحيحة: العدد والمبلغ يجب أن يكونا أقل من الكلي');
      finish(a, c);
    };
  }
}

/* ===================== 14) openReadingDialog ===================== */
function openReadingDialog(sub) {
  const addr = refOf(sub, { withSector: true });
  const url = `reading.html?k=${encodeURIComponent(sub.key)}&n=${encodeURIComponent(sub.name)}&a=${encodeURIComponent(addr)}&p=${sub.prevReading || 0}&m=${sub.months || 1}`;
  const d = makeDialog(`<iframe src="${url}" style="width:100%;height:100%;border:none"></iframe>`,
    'width:95vw;height:90vh;max-width:420px;padding:0;border:none;border-radius:16px;overflow:hidden');
  const frame = d.querySelector('iframe');
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'READING_SAVED') { d.close(); toast('تم حفظ القراءة ✅'); refreshAll(); }
    else if (e.data.type === 'READING_CANCEL') d.close();
  };
  window.addEventListener('message', onMsg);
  d.addEventListener('close', () => window.removeEventListener('message', onMsg));
}

/* ===================== 15) init ===================== */
async function init() {
  initTheme();
  bindMenu();
  try {
    await initDb();
    state.digitCfg = await getDigitConfig();
    const n = await billPendingReadings();            // بداية شهر جديد: pending → billed
    if (n) toast(`تم ترحيل ${n} فاتورة إلى المديونية`, 3500);
  } catch (e) { console.error(e); toast('تعذر فتح قاعدة البيانات: ' + e.message, 5000); }
  switchTab('home');
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.log));
  }
}
init();

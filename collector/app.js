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
  allSubscribers: [],
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
const fmtMoney = (n) => `${Number(n \vert{}\vert{} 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج`; const fmtDate = (d) => new Date(d).toLocaleString('ar-EG'); function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; } const digitsOnly = (v) => String(v ?? '') .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, ''); const bldDigits = () => FIELD_ORDER.slice(0, 6).reduce((n, f) => n + (state.digitCfg[f] \vert{}\vert{} 2), 0); const govName = (c) => state.govMap[c] ? `${state.govMap[c]}` : c;
const regionName = (c) => state.regionMap[c] ? `${state.regionMap[c]}` : c; const refOf = (sub, opts) => formatSubscriberRef(sub, state.lineOfRoute, opts);  function makeDialog(html, style = '') { const d = document.createElement('dialog'); if (style) d.style.cssText = style; d.innerHTML = html; document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal(); return d; }  /** إعادة رسم الصفحة الحالية بعد أي تغيير في البيانات */ function refreshAll() { state.subscribers = null; switchTab(currentTab, true); }  /* ===================== 3) الثيمات ===================== */ function applyTheme(theme) { document.body.setAttribute('data-theme', theme); try { localStorage.setItem('app-theme', theme); } catch (e) { /* تجاهل */ } $$('[data-theme-pick]').forEach(b => b.classList.toggle('active', b.dataset.themePick === theme)); const colors = { light: '#ffffff', dark: '#0a1722', desert: '#f5e6d0', highcontrast: '#000000', green: '#e6f4ea', orange: '#fff3e6' }; const meta = document.querySelector('meta[name="theme-color"]'); if (meta && colors[theme]) meta.setAttribute('content', colors[theme]); } function initTheme() { let t = 'light'; try { t = localStorage.getItem('app-theme') \vert{}\vert{} 'light'; } catch (e) { /* تجاهل */ } applyTheme(t); }  /* ===================== 4) القائمة ===================== */ function closeMenu() { $('menu').hidden = true; $('themeWrap').classList.remove('open'); } function bindMenu() { $('menuBtn').onclick = (e) => { e.stopPropagation(); const h = $('menu').hidden; closeMenu(); $('menu').hidden = !h; }; document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) closeMenu(); }); $('themeToggle').onclick = (e) => { e.stopPropagation(); $('themeWrap').classList.toggle('open'); }; $$('[data-theme-pick]').forEach(b => b.onclick = (e) => { e.stopPropagation(); applyTheme(b.dataset.themePick); }); $$('[data-nav]').forEach(b => b.onclick = () => { closeMenu(); switchTab(b.dataset.nav); }); $('homeBtn').onclick = () => switchTab('home'); $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab)); $('exitBtn').onclick = () => { if (confirm('هل تريد الخروج؟')) location.reload(); }; const net = () => { $('netStatus').textContent = navigator.onLine ? 'متصل' : 'غير متصل'; }; window.addEventListener('online', net); window.addEventListener('offline', net); net(); }  /* ===================== 5) switchTab ===================== */ function removeSelectionBar() { const b = $('selectionBar'); if (b) b.remove(); }  function switchTab(tab, keepScroll = false) { currentTab = tab; if (tab !== 'home') removeSelectionBar(); $$('.view').forEach(v => v.classList.remove('active')); const v = $(`view-${tab}`);
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
  if (lor) { lor = { ...lor }; delete lor.route; }
  state.lineOfRoute = lor;
  return lor;
}

async function loadRouteData() {
  const allSubs = await db.subscribers.toArray();
  state.allSubscribers = allSubs;

  const govs = uniqSorted(allSubs.map(s => s.gov));
  if (!state.searchGov || !govs.includes(state.searchGov)) {
    state.searchGov = govs[0] || '';
  }

  const regs = uniqSorted(allSubs.filter(s => s.gov === state.searchGov).map(s => s.region));
  if (!state.searchRegion || !regs.includes(state.searchRegion)) {
    state.searchRegion = regs[0] || '';
  }

  const subs = allSubs.filter(s => s.gov === state.searchGov && s.region === state.searchRegion);
  state.subscribers = subs;
  state.byKey = new Map(subs.map(s => [s.key, s]));
  
  state.buildings = {};
  subs.forEach(s => {
    if (Number(s.dueAmount) <= 0) return;
    const b = state.buildings[s.bldKey] || (state.buildings[s.bldKey] = { 
      bldKey: s.bldKey, sector: s.sector, blk: s.blk, bld: s.bld, apts: [] 
    });
    b.apts.push(s);
  });

  const reads = await db.movements.where('period').equals(getCurrentPeriod()).filter(m => m.type === 'read').toArray();
  state.readKeys = new Set(reads.map(r => r.key));
  $('who').textContent = `خط السير · ${govName(state.searchGov)} ·${regionName(state.searchRegion)}`;
}

const uniqSorted = (arr) => [...new Set(arr)].sort();
const optHtml = (vals, sel, label, withAll) =>
  (withAll ? `<option value="">${withAll}</option>` : '') +
  vals.map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}${v}</option>`).join('');

async function renderHome() {
  const view = $('view-home');
  removeSelectionBar();
  if (!state.digitCfg.gov) state.digitCfg = await getDigitConfig();
  state.govMap = await getGovMap(); 
  state.regionMap = await getRegionMap();
  
  if (state.subscribers === null) await loadRouteData();

  if ((await db.subscribers.count()) === 0) {
    view.innerHTML = `<div class="card empty"><h2>لا توجد بيانات</h2><button id="btnFetch" class="btn btn-primary" style="margin-top:12px">📥 تحميل ملف العملاء</button></div>`;
    $('btnFetch').onclick = async () => {
      try { await importFromServer(() => {}); } catch (e) { return; }
      state.subscribers = null; renderHome();
    };
    return;
  }

  const allSubs = state.allSubscribers || [];
  const govs = uniqSorted(allSubs.map(s => s.gov));
  const regs = uniqSorted(allSubs.filter(s => s.gov === state.searchGov).map(s => s.region));
  const subsInRegion = state.subscribers || [];
  const subsSubs = uniqSorted(subsInRegion.map(s => s.sub || '00'));
  
  const hasMultipleSubs = subsSubs.length > 1 || (subsSubs.length === 1 && subsSubs[0] !== '00');

  let html = `<div class="card const-card" id="routeLabel" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap:8px;">
    <div class="chip">
      <small>محافظة</small>
      <select id="selGov" style="border:none;background:transparent;font-weight:bold;width:100%">${optHtml(govs, state.searchGov, '', '')}</select>
    </div>
    <div class="chip">
      <small>منطقة</small>
      <select id="selRegion" style="border:none;background:transparent;font-weight:bold;width:100%">${optHtml(regs, state.searchRegion, '', '')}</select>
    </div>
    ${hasMultipleSubs ? `
    <div class="chip">
      <small>فرعي</small>
      <input id="inpSub" value="${escapeHtml(state.currentSub || subsSubs[0])}" style="border:none;background:transparent;font-weight:bold;width:100%;text-align:center">
    </div>` : `
    <div class="chip">
      <small>فرعي</small>
      <b>00</b>
    </div>`}
  </div>`;

  const blds = Object.values(state.buildings);
  const totalRouteDue = blds.reduce((s, b) => s + b.apts.reduce((x, a) => x + (Number(a.dueAmount) || 0), 0), 0);

  if (!blds.length) {
    view.innerHTML = html + `<div class="card empty">✅ لا توجد مديونيات في المنطقة المختارة</div>`;
    bindHeaderEvents();
    return;
  }

  const secs = uniqSorted(blds.map(b => b.sector));
  if (!secs.includes(state.sector)) { state.sector = secs[0]; state.blk = ''; state.bld = ''; state.apt = ''; }
  const blks = uniqSorted(blds.filter(b => b.sector === state.sector).map(b => b.blk));
  if (!blks.includes(state.blk)) { state.blk = blks[0]; state.bld = ''; state.apt = ''; }
  const bldList = blds.filter(b => b.sector === state.sector && b.blk === state.blk).sort((a, b) => a.bld.localeCompare(b.bld));
  if (state.bld && !bldList.some(b => b.bld === state.bld)) { state.bld = ''; state.apt = ''; }
  const curBld = bldList.find(b => b.bld === state.bld) || null;
  const aptVals = curBld ? uniqSorted(curBld.apts.map(a => a.apt)) : [];
  if (state.apt && !aptVals.includes(state.apt)) state.apt = '';

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
  bindHeaderEvents();
  bindHomeEvents(curBld);
}

function bindHeaderEvents() {
  const selGov = $('selGov');
  if (selGov) selGov.onchange = (e) => {
    state.searchGov = e.target.value;
    state.searchRegion = '';
    state.subscribers = null;
    renderHome();
  };

  const selRegion = $('selRegion');
  if (selRegion) selRegion.onchange = (e) => {
    state.searchRegion = e.target.value;
    state.subscribers = null;
    renderHome();
  };

  const inpSub = $('inpSub');
  if (inpSub) inpSub.oninput = (e) => {
    state.currentSub = e.target.value;
  };
}

function aptRowHome(a) {
  const due = Number(a.dueAmount) || 0;
  const hasRead = state.readKeys.has(a.key);
  return `<div class="card apt-card" style="margin-bottom:8px">
    <div class="apt-main">
      <input type="checkbox" class="chk-apt" data-key="${a.key}">
      <div style="min-width:0">
        <div class="apt-name">${escapeHtml(a.name)}${hasRead ? '✅' : ''}</div>
        <div class="apt-sub">${escapeHtml(refOf(a, { withSector: true }))} ·${a.count || 0} فاتورة</div>
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
      <div><label>المحافظة (إلزامي)</label><input id="sGov" list="dlGov

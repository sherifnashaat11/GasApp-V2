/* ============================================================
   collector/app.js - V3.2 (Complete Clean Build)
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
  subscribers: null,
  allSubscribers: [],
  byKey: new Map(), buildings: {}, readKeys: new Set(),
  searchMode: 'code', searchGov: '', searchRegion: '', searchQuery: '',
  searchCode: Array(8).fill(''), searchBld: null, searchHighlight: '',
  ledgerTab: 'pay',
  lineOfRoute: null, govMap: {}, regionMap: {}, digitCfg: {}
};
let currentTab = 'home';

const $ = (id) => document.getElementById(id); const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, ms = 2200) {
  const t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); const fmtMoney = (n) => `${Number(n \vert{}\vert{} 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج`; const fmtDate = (d) => new Date(d).toLocaleString('ar-EG'); function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; } const digitsOnly = (v) => String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, ''); const bldDigits = () => FIELD_ORDER.slice(0, 6).reduce((n, f) => n + (state.digitCfg[f] \vert{}\vert{} 2), 0); const govName = (c) => state.govMap[c] ? `${state.govMap[c]}` : c; const regionName = (c) => state.regionMap[c] ? `${state.regionMap[c]}` : c; const refOf = (sub, opts) => formatSubscriberRef(sub, state.lineOfRoute, opts);  function makeDialog(html, style = '') { const d = document.createElement('dialog'); if (style) d.style.cssText = style; d.innerHTML = html; document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal(); return d; }  function refreshAll() { state.subscribers = null; switchTab(currentTab, true); }  /* ===================== 3) الثيمات ===================== */ function applyTheme(theme) { document.body.setAttribute('data-theme', theme); try { localStorage.setItem('app-theme', theme); } catch (e) {} $$('[data-theme-pick]').forEach(b => b.classList.toggle('active', b.dataset.themePick === theme));
  const colors = { light: '#ffffff', dark: '#0a1722', desert: '#f5e6d0', highcontrast: '#000000', green: '#e6f4ea', orange: '#fff3e6' };
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && colors[theme]) meta.setAttribute('content', colors[theme]);
}

function initTheme() {
  let t = 'light';
  try { t = localStorage.getItem('app-theme') || 'light'; } catch (e) {}
  applyTheme(t);
}

/* ===================== 4) القائمة ===================== */
function closeMenu() { 
  const menu = $('menu');
  if (menu) menu.hidden = true; 
  const themeWrap = $('themeWrap');
  if (themeWrap) themeWrap.classList.remove('open'); 
}

function bindMenu() {
  const menuBtn = $('menuBtn');
  if (menuBtn) {
    menuBtn.onclick = (e) => { 
      e.stopPropagation(); 
      const menu = $('menu');
      const h = menu.hidden; 
      closeMenu(); 
      menu.hidden = !h; 
    };
  }
  document.addEventListener('click', (e) => { 
    const menu = $('menu');
    if (menu && !menu.contains(e.target)) closeMenu(); 
  });
  
  const themeToggle = $('themeToggle');
  if (themeToggle) {
    themeToggle.onclick = (e) => { 
      e.stopPropagation(); 
      $('themeWrap').classList.toggle('open'); 
    };
  }
  $$('[data-theme-pick]').forEach(b => b.onclick = (e) => { e.stopPropagation(); applyTheme(b.dataset.themePick); });$$
('[data-nav]').forEach(b => b.onclick = () => { closeMenu(); switchTab(b.dataset.nav); });
  
  const homeBtn = $('homeBtn'); if (homeBtn) homeBtn.onclick = () => switchTab('home'); $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  
  const exitBtn = $('exitBtn');
  if (exitBtn) exitBtn.onclick = () => { if (confirm('هل تريد الخروج؟')) location.reload(); };
  
  const net = () => { 
    const netStatus = $('netStatus');
    if (netStatus) netStatus.textContent = navigator.onLine ? 'متصل' : 'غير متصل'; 
  };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

/* ===================== 5) switchTab ===================== */
function removeSelectionBar() { const b = $('selectionBar'); if (b) b.remove(); }  function switchTab(tab, keepScroll = false) { currentTab = tab; if (tab !== 'home') removeSelectionBar(); $$('.view').forEach(v => v.classList.remove('active'));
  const v = $(`view-${tab}`); if (v) v.classList.add('active'); $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
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
  if (!state.searchGov || !govs.includes(state

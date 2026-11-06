/* ============================================================
   collector/app.js — V3.2 (النسخة النهائية)
   الغرض: منطق تطبيق المحصل الكامل
   الأقسام: 15 قسماً حسب وثيقة المشروع
============================================================ */

import { db, buildAptKey, buildBldKey, normalizeName, recordPayment, recordReading,
         getUnreadSubscribers, searchByFullCode, searchByName, getCurrentPeriod,
         getBuildingWithMovements, getDigitConfig, getLineOfRoute, setLineOfRoute,
         getGovMap, getRegionMap, getPrices, getFees, formatSubscriberRef,
         getBldKeyFromSub } from '../shared/db.js';
import { importFromServer } from './importer.js';

/* ============================================================
   القسم 2: State + Helpers
============================================================ */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const state = {
  sector: '', blk: '', bld: '', openBld: null,
  subscribers: [], buildings: {},
  searchMode: 'code', // 'code' | 'name'
  searchGov: '', searchRegion: '', searchQuery: '',
  ledgerTab: 'pay', // 'pay' | 'read' | 'pending'
  lineOfRoute: null,
  govMap: {}, regionMap: {},
  loading: false
};

function toast(msg, duration = 2500) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ar-EG') + ' ج';
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleString('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return d; }
}

function debounce(fn, wait = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ============================================================
   القسم 3: الثيمات
============================================================ */
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('app-theme', theme);
  // مزامنة مع submenu
  $$('[data-theme-pick]').forEach(b => {
    b.classList.toggle('active', b.dataset.themePick === theme);
  });
}

function initTheme() {
  applyTheme(localStorage.getItem('app-theme') || 'light');
}

/* ============================================================
   القسم 4: القائمة
============================================================ */
function initMenu() {
  const menuBtn = $('menuBtn');
  const menu = $('menu');
  if (!menuBtn || !menu) return;

  menuBtn.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) {
      menu.hidden = true;
    }
  });

  // Submenu المظهر
  const themeWrap = $('themeWrap');
  if (themeWrap) {
    themeWrap.querySelector('.menu-item').onclick = (e) => {
      e.stopPropagation();
      themeWrap.classList.toggle('open');
    };
  }

  $$('[data-theme-pick]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      applyTheme(btn.dataset.themePick);
      menu.hidden = true;
    };
  });

  // التنقل بين الصفحات
  $$('[data-nav]').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.nav;
      switchTab(tab);
      menu.hidden = true;
    };
  });

  // Home في الهيدر
  const homeBtn = $('homeBtn');
  if (homeBtn) homeBtn.onclick = () => switchTab('home');

  // خروج
  const exitBtn = $('exitBtn');
  if (exitBtn) {
    exitBtn.onclick = () => {
      if (confirm('هل تريد الخروج من التطبيق؟')) location.reload();
    };
  }

  // الشريط السفلي
  $$('.tabs button').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

/* ============================================================
   القسم 5: switchTab
============================================================ */
function switchTab(tab) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`view-${tab}`);
  if (target) target.classList.add('active');

  // تمييز الأزرار
  $$('.tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });
  $$('[data-nav]').forEach(b => {
    b.classList.toggle('on', b.dataset.nav === tab);
  });

  // استدعاء الرسم المناسب
  if (tab === 'home') renderHome();
  else if (tab === 'search') renderSearch();
  else if (tab === 'readings') renderReadings();
  else if (tab === 'ledger') renderLedger();
  else if (tab === 'details') renderDetails();
  else if (tab === 'settings') renderSettings();
}

/* ============================================================
   القسم 6: renderHome
============================================================ */
async function renderHome() {
  const view = $('view-home');
  if (!view) return;

  // إخفاء الشريط العائم القديم
  const oldBar = $('selectionBar');
  if (oldBar) oldBar.remove();

  // جلب خط السير
  if (!state.lineOfRoute) {
    state.lineOfRoute = await getLineOfRoute();
    if (!state.lineOfRoute) {
      // استنتاج من أول عميل
      const first = await db.subscribers.toCollection().first();
      if (first) {
        state.lineOfRoute = {
          gov: first.gov, region: first.region, route: first.route, sub: first.sub || '00'
        };
        await setLineOfRoute(state.lineOfRoute);
      }
    }
  }

  // تحميل العملاء (مع المديونية فقط)
  if (state.subscribers.length === 0) {
    const all = await db.subscribers.toArray();
    state.subscribers = all.filter(s => Number(s.dueAmount) > 0);
    state.buildings = {};
    state.subscribers.forEach(s => {
      const bldKey = s.bldKey || getBldKeyFromSub(s);
      if (!state.buildings[bldKey]) {
        state.buildings[bldKey] = { bld: s.bld, apts: [] };
      }
      state.buildings[bldKey].apts.push(s);
    });
  }

  if (state.subscribers.length === 0) {
    view.innerHTML = `<div class="card" style="text-align:center; padding: 40px 15px;">
      <h2>لا توجد بيانات</h2>
      <p style="color:var(--mute); margin:10px 0;">لم يتم استيراد بيانات العملاء بعد</p>
      <button id="btnFetch" style="margin-top:10px; padding:12px; background:var(--primary); color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">📥 تحديث الملف</button>
    </div>`;
    const btn = $('btnFetch');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'جارٍ التحميل...';
        try {
          await importFromServer(console.log);
          state.subscribers = [];
          renderHome();
        } catch (e) {
          alert('خطأ: ' + e.message);
          btn.disabled = false; btn.textContent = '📥 تحديث الملف';
        }
      };
    }
    return;
  }

  // حركات (للتحقق من القراءات)
  const moves = await db.movements.toArray();
  const movesMap = new Map(moves.map(m => [m.key, m]));

  // خيارات الفلترة (المتغيرات فقط)
  const lor = state.lineOfRoute || {};
  const filtered = state.subscribers.filter(s => 
    (!lor.gov || s.gov === lor.gov) &&
    (!lor.region || s.region === lor.region) &&
    (!lor.route || s.route === lor.route)
  );

  const secs = [...new Set(filtered.map(s => s.sector))].sort();
  const blks = [...new Set(filtered.filter(s => s.sector === state.sector).map(s => s.blk))].sort();
  const blds = [...new Set(filtered.filter(s => s.sector === state.sector && s.blk === state.blk).map(s => s.bld))].sort();

  if (!state.sector && secs.length) state.sector = secs[0];
  if (!state.blk && blks.length) state.blk = blks[0];

  // Label ثابت للثوابت
  let html = `<div class="card" style="padding: 10px;">
    <div style="font-size:11px; color:var(--mute); font-weight:bold; margin-bottom:6px;">خط السير الحالي:</div>
    <div style="font-size:12px; font-weight:800; color:var(--primary);">
      ${lor.gov ? `محافظة ${lor.gov}` : ''} 
      ${lor.region ? ` · منطقة ${lor.region}` : ''} 
      ${lor.route ? ` · يومية ${lor.route}` : ''}
      ${lor.sub ? ` · فرعي ${lor.sub}` : ''}
    </div>
  </div>`;

  // Selects ديناميكية للمتغيرات
  html += `<div class="card" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
    <div style="display: flex; gap: 10px;">
      <div style="flex:1;">
        <label style="font-size:12px; font-weight:bold;">القطاع</label>
        <select id="selSector" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink);">
          ${secs.map(s => `<option value="${s}" ${s === state.sector ? 'selected' : ''}>قطاع ${s}</option>`).join('')}
        </select>
      </div>
      <div style="flex:1;">
        <label style="font-size:12px; font-weight:bold;">البلوك</label>
        <select id="selBlk" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink);">
          ${blks.map(b => `<option value="${b}" ${b === state.blk ? 'selected' : ''}>بلوك ${b}</option>`).join('')}
        </select>
      </div>
      <div style="flex:1;">
        <label style="font-size:12px; font-weight:bold;">العمارة</label>
        <select id="selBld" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink);">
          <option value="">-- كل العمارات --</option>
          ${blds.map(b => `<option value="${b}" ${b === state.bld ? 'selected' : ''}>عمارة ${b}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>`;

  // عرض العمارات أو الشقق
  if (state.bld || state.openBld) {
    const targetBld = state.bld || state.openBld;
    const bldKey = buildBldKey(lor.gov, lor.region, lor.route, state.sector, state.blk, targetBld);
    const bldData = state.buildings[bldKey];
    
    if (!bldData || bldData.apts.length === 0) {
      state.bld = ''; state.openBld = null; renderHome(); return;
    }

    const totalDue = bldData.apts.reduce((sum, a) => sum + (Number(a.dueAmount) || 0), 0);

    html += `<div class="card" style="padding: 12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="btnBack" style="background:var(--bg); border:1px solid var(--line); padding:6px 12px; border-radius:8px; font-weight:bold; cursor:pointer; color:var(--ink);">⏪ رجوع</button>
          <h3 style="font-size:16px; font-weight:800; margin:0; color:var(--ink);">عمارة ${targetBld} <span style="color:var(--danger); font-size:14px;">(${fmtMoney(totalDue)})</span></h3>
        </div>
        <button id="btnSelectAll" style="background:var(--primary); color:var(--primary-ink); border:none; padding:6px 12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">تحديد الكل</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${bldData.apts.sort((a,b) => String(a.apt).localeCompare(String(b.apt))).map(apt => {
          const hasReading = movesMap.has(apt.key) && movesMap.get(apt.key).type === 'read';
          const due = Number(apt.dueAmount) || 0;
          return `<div style="background: var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" class="chk-apt" data-key="${apt.key}" data-due="${due}" data-count="${apt.count}" data-name="${escapeHtml(apt.name)}" style="width:18px; height:18px;">
              <div>
                <div style="font-weight:800; font-size:14px; display:flex; align-items:center; gap:5px; color:var(--ink);">
                  ${escapeHtml(apt.name)} ${hasReading ? '✅' : ''}
                  <button class="btn-notify-icon" data-key="${apt.key}" title="إخطار" style="background:none; border:none; cursor:pointer; font-size:14px; padding:0;">🔔</button>
                </div>
                <div style="font-size:12px; color:var(--mute); margin-top:4px;">شقة ${apt.apt} · ${apt.count || 0} فاتورة</div>
                <div style="color:var(--danger); font-weight:bold; font-size:12px; margin-top:4px;">مستحق: ${fmtMoney(due)}</div>
              </div>
            </div>
            <div style="display:flex; gap:5px;">
              <button data-key="${apt.key}" data-due="${due}" data-count="${apt.count}" data-name="${escapeHtml(apt.name)}" class="btn-pay" style="background:var(--warning); color:var(--warning-ink); border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">تحصيل</button>
              <button data-key="${apt.key}" data-name="${escapeHtml(apt.name)}" data-addr="${escapeHtml(formatSubscriberRef(apt, lor))}" data-prev="${apt.prevReading || 0}" data-months="${apt.months || 1}" class="btn-read" style="background:${hasReading ? 'var(--success)' : 'var(--primary)'}; color:white; border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">${hasReading ? 'تعديل' : 'قراءة'}</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
    
    view.innerHTML = html;
    
    $('btnBack').onclick = () => { state.openBld = null; state.bld = ''; renderHome(); };
    $('btnSelectAll').onclick = () => {
      const chks = $$('.chk-apt');
      const allChecked = Array.from(chks).every(c => c.checked);
      chks.forEach(c => c.checked = !allChecked);
      updateSelectionBar();
    };
    
    bindHomeActions();
  } else {
    // عرض العمارات
    const blds = Object.keys(state.buildings)
      .filter(k => {
        const lor = state.lineOfRoute || {};
        return k.startsWith(`${lor.gov || ''}${lor.region || ''}${lor.route || ''}${state.sector}${state.blk}`);
      })
      .map(k => ({ key: k, ...state.buildings[k] }))
      .sort((a,b) => String(a.bld).localeCompare(String(b.bld)));
    
    html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
    blds.forEach((b, idx) => {
      const totalDue = b.apts.reduce((sum, a) => sum + (Number(a.dueAmount) || 0), 0);
      html += `<div class="bld-card" data-bld="${b.bld}" style="background: color-mix(in srgb, var(--primary) ${[0,3,6,9][idx%4]}%, var(--card)); border:1px solid var(--line); border-right: 5px solid var(--primary); border-radius:10px; padding:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
        <div><div style="font-weight:800; font-size:15px; color:var(--ink);">عمارة ${b.bld}</div></div>
        <div style="font-weight:800; color:var(--danger); font-size:15px;">${fmtMoney(totalDue)}</div>
      </div>`;
    });
    html += `</div>`;
    view.innerHTML = html;
    $$('.bld-card').forEach(card => {
      card.onclick = () => { state.openBld = card.dataset.bld; renderHome(); };
    });
  }

  // ربط Selects
  if ($('selSector')) {
    $('selSector').onchange = (e) => { state.sector = e.target.value; state.blk = ''; state.bld = ''; state.openBld = null; renderHome(); };
    $('selBlk').onchange = (e) => { state.blk = e.target.value; state.bld = ''; state.openBld = null; renderHome(); };
    $('selBld').onchange = (e) => { state.bld = e.target.value; state.openBld = null; renderHome(); };
  }
}

function bindHomeActions() {
  // زر 🔔 الإخطار
  $$('.btn-notify-icon').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openNotifyModal(sub);
    };
  });

  // زر التحصيل
  $$('.btn-pay').forEach(btn => {
    btn.onclick = async () => {
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openPaymentModal(sub, 'route');
    };
  });

  // زر القراءة
  $$('.btn-read').forEach(btn => {
    btn.onclick = async () => {
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openReadingDialog(sub);
    };
  });

  // Checkboxes
  $$('.chk-apt').forEach(c => c.onchange = updateSelectionBar);
}

function updateSelectionBar() {
  const selected = $$('.chk-apt:checked');
  let selTotal = 0;
  selected.forEach(c => selTotal += Number(c.dataset.due));
  
  let bar = $('selectionBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selectionBar';
    bar.style.cssText = 'position:fixed; bottom:70px; left:10px; right:10px; background:var(--card); padding:15px; border-radius:12px; box-shadow:0 -4px 15px rgba(0,0,0,0.15); border:2px solid var(--primary); z-index:100; text-align:center; color:var(--ink);';
    document.body.appendChild(bar);
  }
  
  if (selected.length > 0) {
    bar.style.display = 'block';
    bar.innerHTML = `<div style="font-weight:bold; margin-bottom:10px;">المحدد: ${selected.length} شقة · الإجمالي: ${fmtMoney(selTotal)}</div>
      <button id="btnPayBulk" style="width:100%; background:var(--success); color:var(--success-ink); border:none; padding:10px; border-radius:8px; font-weight:bold; font-size:16px; cursor:pointer;">سداد المحدد</button>`;
    
    $('btnPayBulk').onclick = async () => {
      if (!confirm(`تأكيد السداد الجماعي لـ ${selected.length} شقة بمبلغ ${selTotal} ج؟`)) return;
      const receipts = [];
      try {
        for (const c of selected) {
          const key = c.dataset.key;
          const name = c.dataset.name;
          const amount = Number(c.dataset.due);
          const count = Number(c.dataset.count);
          const move = await recordPayment({ key, name, amount, count, source: 'route' });
          receipts.push({ key, name, amount, count, receiptRef: move.receiptRef });
        }
        bar.remove();
        state.subscribers = [];
        showReceipt(receipts);
        renderHome();
      } catch (e) {
        alert('خطأ: ' + e.message);
      }
    };
  } else {
    bar.style.display = 'none';
  }
}

/* ============================================================
   القسم 7: renderSearch
============================================================ */
async function renderSearch() {
  const view = $('view-search');
  if (!view) return;

  // جلب الخرائط
  if (!state.govMap || !Object.keys(state.govMap).length) {
    state.govMap = await getGovMap();
    state.regionMap = await getRegionMap();
  }

  // فلترة إلزامية للاسم
  const govOptions = Object.entries(state.govMap).map(([code, name]) => 
    `<option value="${code}" ${state.searchGov === code ? 'selected' : ''}>${name} (${code})</option>`
  ).join('');

  let html = `<div class="card">
    <div class="search-mode">
      <button data-mode="code" class="${state.searchMode === 'code' ? 'on' : ''}">🔢 بحث بالكود (16 رقم)</button>
      <button data-mode="name" class="${state.searchMode === 'name' ? 'on' : ''}">🔤 بحث بالاسم</button>
    </div>`;

  if (state.searchMode === 'code') {
    // 8 خانات، كل منها رقمين
    html += `<div class="search-filters">
      <label style="font-size:12px; color:var(--mute);">أدخل كود العميل (16 رقم)</label>
      <div id="codeInputs" style="display:flex; gap:4px; direction:ltr;">
        ${['gov','region','route','sector','blk','bld','apt','sub'].map((f, i) => 
          `<input type="text" maxlength="2" inputmode="numeric" class="code-box" data-field="${f}" placeholder="00" style="flex:1; padding:10px 2px; border-radius:6px; border:1px solid var(--line); background:var(--bg); color:var(--ink); text-align:center; font-weight:bold; font-size:14px;">`
        ).join('')}
      </div>
      <button id="btnSearchCode" class="btn btn-primary" style="margin-top:10px;">🔍 بحث</button>
    </div>`;
  } else {
    // بحث بالاسم مع فلترة إلزامية
    html += `<div class="search-filters">
      <div class="row">
        <div>
          <label>المحافظة *</label>
          <select id="searchGov">
            <option value="">-- اختر --</option>
            ${govOptions}
          </select>
        </div>
        <div>
          <label>المنطقة *</label>
          <select id="searchRegion">
            <option value="">-- اختر --</option>
          </select>
        </div>
      </div>
      <div>
        <label>الاسم</label>
        <input type="text" id="searchName" placeholder="اكتب جزءاً من الاسم..." value="${escapeHtml(state.searchQuery)}">
      </div>
      <button id="btnSearchName" class="btn btn-primary" style="margin-top:10px;">🔍 بحث</button>
    </div>`;
  }

  html += `</div><div id="searchResults"></div>`;
  view.innerHTML = html;

  // ربط الوضع
  $$('.search-mode button').forEach(btn => {
    btn.onclick = () => { state.searchMode = btn.dataset.mode; renderSearch(); };
  });

  // ربط بحث الكود
  if (state.searchMode === 'code') {
    const boxes = $$('.code-box');
    boxes.forEach((box, i) => {
      box.oninput = (e) => {
        if (box.value.length >= 2) {
          box.value = box.value.slice(0, 2);
          if (boxes[i + 1]) boxes[i + 1].focus();
        }
      };
      box.onkeydown = (e) => {
        if (e.key === 'Backspace' && !box.value && boxes[i - 1]) {
          boxes[i - 1].focus();
        }
      };
    });
    
    $('btnSearchCode').onclick = async () => {
      const code = Array.from(boxes).map(b => b.value.padStart(2, '0')).join('');
      if (code.length !== 16) return toast('⚠️ يجب إدخال 16 رقماً');
      const subs = await searchByFullCode(code);
      if (subs.length === 0) {
        $('searchResults').innerHTML = '<div class="card" style="text-align:center; color:var(--mute);">لا توجد نتائج</div>';
        return;
      }
      const bldKey = subs[0].bldKey;
      const building = await getBuildingWithMovements(bldKey);
      renderSearchResults(building);
    };
  } else {
    // ربط تغيير المحافظة → تحديث المناطق
    const govSel = $('searchGov');
    const regSel = $('searchRegion');
    
    const updateRegions = () => {
      const gov = govSel.value;
      if (!gov) { regSel.innerHTML = '<option value="">-- اختر --</option>'; return; }
      // فلترة المناطق التي تبدأ بكود المحافظة
      const regions = Object.entries(state.regionMap)
        .filter(([code]) => code.startsWith(gov))
        .map(([code, name]) => `<option value="${code}">${name} (${code})</option>`)
        .join('');
      regSel.innerHTML = `<option value="">-- اختر --</option>${regions}`;
    };
    
    govSel.onchange = () => { state.searchGov = govSel.value; updateRegions(); };
    updateRegions();
    
    $('searchName').oninput = (e) => { state.searchQuery = e.target.value; };
    
    $('btnSearchName').onclick = async () => {
      const gov = govSel.value;
      const region = regSel.value;
      const name = $('searchName').value;
      if (!gov || !region) return toast('⚠️ يجب اختيار المحافظة والمنطقة');
      if (!name || name.length < 2) return toast('⚠️ اكتب حرفين على الأقل من الاسم');
      
      const subs = await searchByName(name, gov, region);
      if (subs.length === 0) {
        $('searchResults').innerHTML = '<div class="card" style="text-align:center; color:var(--mute);">لا توجد نتائج</div>';
        return;
      }
      // تجميع حسب العمارة
      const byBld = {};
      subs.forEach(s => {
        if (!byBld[s.bldKey]) byBld[s.bldKey] = [];
        byBld[s.bldKey].push(s);
      });
      
      let resHtml = '';
      for (const [bldKey, group] of Object.entries(byBld)) {
        const building = await getBuildingWithMovements(bldKey);
        resHtml += renderBuildingCard(building);
      }
      $('searchResults').innerHTML = resHtml;
      bindSearchResults();
    };
  }
}

function renderBuildingCard(building) {
  if (!building || building.length === 0) return '';
  const first = building[0];
  const totalDue = building.reduce((s, x) => s + (Number(x.dueAmount) || 0), 0);
  return `<div class="card" style="margin-top:10px;">
    <h3 style="font-size:14px; margin-bottom:10px; color:var(--ink);">عمارة ${first.bld} · قطاع ${first.sector} · بلوك ${first.blk}</h3>
    <div style="font-size:12px; color:var(--danger); margin-bottom:10px;">إجمالي المديونية: ${fmtMoney(totalDue)}</div>
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${building.map(s => {
        const isPaid = Number(s.dueAmount) <= 0;
        return `<div class="card ${isPaid ? 'paid' : ''}" style="padding:10px; margin:0; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:800; font-size:14px;">${escapeHtml(s.name)} ${isPaid ? '<span class="paid-badge">مسدَّد</span>' : ''}</div>
            <div style="font-size:12px; color:var(--mute);">${escapeHtml(formatSubscriberRef(s))}</div>
            <div style="color:var(--danger); font-size:12px; font-weight:bold;">${fmtMoney(s.dueAmount)}</div>
          </div>
          <div style="display:flex; gap:5px;">
            <button class="btn-pay-search" data-key="${s.key}" style="background:var(--warning); color:var(--warning-ink); border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">تحصيل</button>
            <button class="btn-read-search" data-key="${s.key}" style="background:var(--primary); color:var(--primary-ink); border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">قراءة</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderSearchResults(building) {
  $('searchResults').innerHTML = renderBuildingCard(building);
  bindSearchResults();
}

function bindSearchResults() {
  $$('.btn-pay-search').forEach(btn => {
    btn.onclick = async () => {
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openPaymentModal(sub, 'search');
    };
  });
  $$('.btn-read-search').forEach(btn => {
    btn.onclick = async () => {
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openReadingDialog(sub);
    };
  });
}

/* ============================================================
   القسم 8: renderReadings
============================================================ */
async function renderReadings() {
  const view = $('view-readings');
  if (!view) return;

  const period = getCurrentPeriod();
  const subs = await getUnreadSubscribers(period);

  if (subs.length === 0) {
    view.innerHTML = `<div class="card" style="text-align:center; padding:40px 15px;">
      <h2 style="color:var(--success);">✅ تم تسجيل قراءات جميع العملاء</h2>
      <p style="color:var(--mute); margin-top:10px;">لا يوجد عملاء بدون قراءة لهذا الشهر</p>
    </div>`;
    return;
  }

  let html = `<div class="card" style="background:var(--warning); color:var(--warning-ink); text-align:center; font-weight:bold;">
    ⚠️ ${subs.length} عميل بدون قراءة لهذا الشهر
  </div>`;

  html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
  subs.forEach(s => {
    html += `<div class="card" style="padding:12px; margin:0; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-weight:800; font-size:14px; color:var(--ink);">${escapeHtml(s.name)}</div>
        <div style="font-size:12px; color:var(--mute); margin-top:4px;">${escapeHtml(formatSubscriberRef(s))}</div>
        <div style="font-size:12px; color:var(--mute); margin-top:2px;">القراءة السابقة: ${s.prevReading || 0} · ${s.months || 1} شهر</div>
        <div style="color:var(--danger); font-weight:bold; font-size:12px; margin-top:2px;">مستحق: ${fmtMoney(s.dueAmount)}</div>
      </div>
      <button class="btn-read-now" data-key="${s.key}" style="background:var(--primary); color:var(--primary-ink); border:none; padding:8px 14px; border-radius:8px; font-weight:bold; cursor:pointer;">قراءة</button>
    </div>`;
  });
  html += `</div>`;
  view.innerHTML = html;

  $$('.btn-read-now').forEach(btn => {
    btn.onclick = async () => {
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openReadingDialog(sub);
    };
  });
}

/* ============================================================
   القسم 9: renderLedger
============================================================ */
async function renderLedger() {
  const view = $('view-ledger');
  if (!view) return;

  const moves = await db.movements.toArray();
  if (moves.length === 0) {
    view.innerHTML = `<div class="card" style="text-align:center; padding:20px; color:var(--mute);">لا توجد عمليات مسجلة حتى الآن.</div>`;
    return;
  }

  moves.sort((a,b) => new Date(b.date) - new Date(a.date));

  // تبويبات
  let html = `<div class="arch-tabs">
    <button data-tab="pay" class="${state.ledgerTab === 'pay' ? 'on' : ''}">💰 سداد</button>
    <button data-tab="read" class="${state.ledgerTab === 'read' ? 'on' : ''}">📖 قراءات</button>
    <button data-tab="pending" class="${state.ledgerTab === 'pending' ? 'on' : ''}">⏳ فواتير قادمة</button>
  </div>`;

  // فلترة حسب التبويب
  let filtered;
  if (state.ledgerTab === 'pay') {
    filtered = moves.filter(m => m.type === 'pay');
  } else if (state.ledgerTab === 'read') {
    filtered = moves.filter(m => m.type === 'read');
  } else {
    filtered = moves.filter(m => m.type === 'read' && m.status === 'pending');
  }

  // إحصائيات اليوم
  const today = new Date().toDateString();
  const todayTotal = moves.filter(m => m.type === 'pay' && new Date(m.date).toDateString() === today)
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  
  html += `<div class="card" style="background:var(--success); color:var(--success-ink); text-align:center; font-weight:bold; font-size:16px;">
    إجمالي تحصيل اليوم: ${fmtMoney(todayTotal)}
  </div>`;

  // زر التصدير
  html += `<div style="margin-bottom:15px;">
    <button id="btnExport" class="btn btn-primary" style="width:100%;">📤 تصدير الأرشيف (JSON)</button>
  </div>`;

  if (filtered.length === 0) {
    html += `<div class="card" style="text-align:center; color:var(--mute);">لا توجد عمليات في هذا التبويب</div>`;
  } else {
    html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
    for (const m of filtered) {
      const sub = await db.subscribers.get(m.key);
      const name = sub ? sub.name : 'غير معروف';
      const isOutside = m.source === 'search';
      const hasReading = moves.some(x => x.key === m.key && x.type === 'read');

      html += `<div class="card" style="padding:12px; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-weight:800; font-size:14px; color:var(--ink);">
              ${escapeHtml(name)}
              ${isOutside ? '<span style="background:var(--warning); color:var(--warning-ink); padding:2px 6px; border-radius:6px; font-size:10px; margin-right:4px;">خارج النطاق</span>' : ''}
            </div>
            <div style="font-size:11px; color:var(--mute); margin-top:4px;">${m.key}</div>
            <div style="font-size:11px; color:var(--mute); margin-top:2px;">${fmtDate(m.date)}</div>
            ${m.receiptRef ? `<div style="font-size:10px; color:var(--mute); margin-top:2px;">إيصال: ${m.receiptRef}</div>` : ''}
            ${m.type === 'read' && m.status === 'pending' ? '<span style="background:var(--warning); color:var(--warning-ink); padding:2px 6px; border-radius:6px; font-size:10px;">معلقة</span>' : ''}
          </div>
          <div style="text-align:left;">
            <div style="font-weight:800; color:var(--primary); font-size:16px;">${fmtMoney(m.amount || m.estimatedInvoice || 0)}</div>
            ${m.type === 'read' && m.consumption ? `<div style="font-size:11px; color:var(--mute);">${m.consumption} m³</div>` : ''}
          </div>
        </div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          ${m.type === 'pay' ? `<button class="btn-print" data-id="${m.id}" style="flex:1; padding:6px; background:var(--primary); color:var(--primary-ink); border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">🖨️ طباعة</button>` : ''}
          <button class="btn-read-ledger" data-key="${m.key}" style="flex:1; padding:6px; background:${hasReading ? 'var(--success)' : 'var(--primary)'}; color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">${hasReading ? 'تعديل القراءة' : 'قراءة العداد'}</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  view.innerHTML = html;

  // ربط التبويبات
  $$('.arch-tabs button').forEach(btn => {
    btn.onclick = () => { state.ledgerTab = btn.dataset.tab; renderLedger(); };
  });

  // تصدير
  $('btnExport').onclick = () => {
    const archiveData = { collector: 'محصل', date: new Date().toISOString(), movements: moves };
    const blob = new Blob([JSON.stringify(archiveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archive_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // طباعة
  $$('.btn-print').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const move = await db.movements.get(id);
      if (move) {
        const sub = await db.subscribers.get(move.key);
        showReceipt([{
          key: move.key,
          name: sub ? sub.name : 'غير معروف',
          amount: move.amount,
          count: move.count,
          receiptRef: move.receiptRef
        }]);
        await db.movements.update(id, { printed: true });
      }
    };
  });

  // قراءة من الأرشيف
  $$('.btn-read-ledger').forEach(btn => {
    btn.onclick = async () => {
      const sub = await db.subscribers.get(btn.dataset.key);
      if (sub) openReadingDialog(sub);
    };
  });
}

/* ============================================================
   القسم 10: renderDetails + renderSettings
============================================================ */
async function renderDetails() {
  const view = $('view-details');
  if (!view) return;
  view.innerHTML = `<div class="placeholder">
    <div class="icon">📊</div>
    <h2>التفاصيل</h2>
    <p>قيد الإنشاء</p>
  </div>`;
}

async function renderSettings() {
  const view = $('view-settings');
  if (!view) return;
  const lor = state.lineOfRoute || {};
  const stats = await getTodayStats();
  view.innerHTML = `<div class="card">
    <h3 style="margin-bottom:10px; color:var(--ink);">⚙️ الإعدادات</h3>
    <div style="font-size:13px; line-height:1.8; color:var(--ink);">
      <div><b>خط السير:</b> ${lor.gov || '-'} / ${lor.region || '-'} / ${lor.route || '-'}</div>
      <div><b>إحصائيات اليوم:</b></div>
      <div>· تحصيل: ${fmtMoney(stats.totalPay)} (${stats.countPay} عملية)</div>
      <div>· قراءات: ${stats.countRead}</div>
    </div>
    <div class="placeholder" style="margin-top:20px; padding:20px 10px;">
      <p style="color:var(--mute); font-size:12px;">المزيد من الإعدادات قيد الإنشاء</p>
    </div>
  </div>`;
}

/* ============================================================
   القسم 11: showReceipt
============================================================ */
function showReceipt(receipts) {
  let html = `<div class="receipt">
    <h2>🧾 إيصال تحصيل</h2>
    <p style="font-size:12px;">التاريخ: ${new Date().toLocaleString('ar-EG')}</p>
    <table>
      <thead><tr><th>الاسم</th><th>المبلغ</th></tr></thead>
      <tbody>`;
  let total = 0;
  receipts.forEach(r => {
    total += Number(r.amount) || 0;
    html += `<tr><td>${escapeHtml(r.name)}</td><td>${fmtMoney(r.amount)}</td></tr>`;
  });
  html += `<tr class="total-row"><td>الإجمالي</td><td>${fmtMoney(total)}</td></tr>
    </tbody></table>`;
  
  // عرض receiptRef إن وجد
  const refs = receipts.filter(r => r.receiptRef).map(r => r.receiptRef);
  if (refs.length === 1) {
    html += `<p style="font-size:11px; margin-top:10px; color:var(--mute);">رقم الإيصال: ${refs[0]}</p>`;
  }
  
  html += `<div style="display:flex; gap:10px; margin-top:20px;">
    <button id="btnDoPrint" style="flex:1; padding:10px; background:var(--primary); color:var(--primary-ink); border:none; border-radius:8px; font-weight:bold; cursor:pointer;">🖨️ طباعة</button>
    <button id="btnCloseReceipt" style="flex:1; padding:10px; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:8px; font-weight:bold; cursor:pointer;">إغلاق</button>
  </div></div>`;
  
  const d = document.createElement('dialog');
  d.style.cssText = 'padding:0; border:none; border-radius:12px; overflow:hidden; max-width:420px; width:92vw;';
  d.innerHTML = html;
  document.body.appendChild(d);
  d.showModal();
  
  d.querySelector('#btnCloseReceipt').onclick = () => { d.close(); d.remove(); };
  d.querySelector('#btnDoPrint').onclick = () => {
    printViaIframe(html);
    setTimeout(() => { d.close(); d.remove(); }, 500);
  };
}

/* طباعة عبر iframe مخفي */
function printViaIframe(htmlContent) {
  const frame = $('printFrame');
  if (!frame) return;
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><style>
    body { font-family: Tahoma, sans-serif; direction: rtl; padding: 20px; }
    table { width:100%; border-collapse:collapse; margin-top:15px; }
    th,td { border:1px solid #333; padding:8px; text-align:center; }
    th { background:#eee; }
    .total-row { font-weight:bold; background:#e0f2fe; }
    h2 { text-align:center; }
    .receipt { text-align:center; }
  </style></head><body>${htmlContent}</body></html>`);
  doc.close();
  setTimeout(() => frame.contentWindow.print(), 200);
}

/* ============================================================
   القسم 12: openNotifyModal
============================================================ */
function openNotifyModal(sub) {
  const text = `عزيزي العميل ${sub.name}،\nنود تذكيركم بمديونية قدرها ${sub.dueAmount} جنيه.\nيرجى السداد لتجنب قطع الخدمة.\nشكراً لتعاونكم.`;
  
  const d = document.createElement('dialog');
  d.style.cssText = 'padding:20px; border-radius:14px; max-width:400px; width:92vw;';
  d.innerHTML = `<h3 style="margin-bottom:12px;">🔔 إخطار العميل</h3>
    <div class="notify-text">${escapeHtml(text)}</div>
    <div style="display:flex; gap:8px; margin-top:15px; flex-wrap:wrap;">
      <button id="btnCopyNotify" class="btn btn-primary" style="flex:1;">📋 نسخ</button>
      <button id="btnWaNotify" class="btn btn-success" style="flex:1;">💬 واتساب</button>
      <button id="btnPrintNotify" class="btn btn-warning" style="flex:1;">🖨️ طباعة</button>
      <button id="btnCloseNotify" class="btn btn-ghost" style="flex:1;">إلغاء</button>
    </div>`;
  document.body.appendChild(d);
  d.showModal();
  
  d.querySelector('#btnCloseNotify').onclick = () => { d.close(); d.remove(); };
  d.querySelector('#btnCopyNotify').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('✅ تم النسخ');
    } catch { toast('⚠️ فشل النسخ'); }
  };
  d.querySelector('#btnWaNotify').onclick = () => {
    const phone = sub.phone ? `2${sub.phone}` : '';
    if (!phone) return toast('⚠️ لا يوجد رقم هاتف');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };
  d.querySelector('#btnPrintNotify').onclick = () => {
    printViaIframe(`<div class="receipt">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`);
  };
}

/* ============================================================
   القسم 13: openPaymentModal
============================================================ */
function openPaymentModal(sub, source = 'route') {
  const due = Number(sub.dueAmount) || 0;
  const count = Number(sub.count) || 0;
  
  const d = document.createElement('dialog');
  d.style.cssText = 'padding:20px; border-radius:14px; max-width:400px; width:92vw;';
  d.innerHTML = `<h3 style="margin-bottom:15px;">💰 تحصيل ${escapeHtml(sub.name)}</h3>
    <p style="font-weight:bold; color:var(--danger); margin-bottom:15px;">إجمالي المديونية: ${fmtMoney(due)} (${count} فواتير)</p>
    <div style="display:flex; flex-direction:column; gap:10px;">
      <button id="payFull" class="btn btn-success" style="width:100%;">سداد كلي (${fmtMoney(due)})</button>
      <button id="payPartial" class="btn btn-primary" style="width:100%;">سداد جزئي</button>
    </div>
    <div id="partialInputs" style="display:none; flex-direction:column; gap:8px; margin-top:15px;">
      <input id="pCount" type="number" placeholder="عدد الفواتير" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; text-align:center; background:var(--bg); color:var(--ink);">
      <input id="pAmount" type="number" placeholder="القيمة المدفوعة" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px; text-align:center; background:var(--bg); color:var(--ink);">
      <button id="confirmPartial" class="btn btn-success" style="width:100%;">تأكيد الدفع</button>
    </div>
    <button id="cancelPay" class="btn btn-ghost" style="width:100%; margin-top:10px;">إلغاء</button>`;
  document.body.appendChild(d);
  d.showModal();
  
  const close = () => { d.close(); d.remove(); };
  
  d.querySelector('#cancelPay').onclick = close;
  
  d.querySelector('#payFull').onclick = async () => {
    try {
      const move = await recordPayment({ key: sub.key, name: sub.name, amount: due, count, source });
      close();
      state.subscribers = [];
      showReceipt([{ key: sub.key, name: sub.name, amount: due, count, receiptRef: move.receiptRef }]);
      if (source === 'route') renderHome();
      else if (source === 'search') renderSearch();
    } catch (e) { alert('خطأ: ' + e.message); }
  };
  
  d.querySelector('#payPartial').onclick = () => {
    d.querySelector('#partialInputs').style.display = 'flex';
    d.querySelector('#payPartial').style.display = 'none';
    d.querySelector('#payFull').style.display = 'none';
  };
  
  d.querySelector('#confirmPartial').onclick = async () => {
    const pCount = Number(d.querySelector('#pCount').value);
    const pAmount = Number(d.querySelector('#pAmount').value);
    if (pCount <= 0 || pAmount <= 0 || pCount > count || pAmount > due) {
      return alert('بيانات غير صحيحة');
    }
    try {
      const move = await recordPayment({ key: sub.key, name: sub.name, amount: pAmount, count: pCount, source });
      close();
      state.subscribers = [];
      showReceipt([{ key: sub.key, name: sub.name, amount: pAmount, count: pCount, receiptRef: move.receiptRef }]);
      if (source === 'route') renderHome();
      else if (source === 'search') renderSearch();
    } catch (e) { alert('خطأ: ' + e.message); }
  };
}

/* ============================================================
   القسم 14: openReadingDialog
============================================================ */
function openReadingDialog(sub) {
  const url = `reading.html?k=${encodeURIComponent(sub.key)}&n=${encodeURIComponent(sub.name)}&a=${encodeURIComponent(formatSubscriberRef(sub, state.lineOfRoute))}&p=${sub.prevReading || 0}&m=${sub.months || 1}`;
  
  const d = document.createElement('dialog');
  d.style.cssText = 'width:95vw; height:90vh; max-width:420px; padding:0; border:none; border-radius:16px; overflow:hidden; background:transparent;';
  d.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`;
  document.body.appendChild(d);
  d.showModal();
  
  const handleMessage = (e) => {
    if (e.data && (e.data.type === 'READING_SAVED' || e.data.type === 'READING_CANCEL')) {
      d.close();
      d.remove();
      window.removeEventListener('message', handleMessage);
      if (e.data.type === 'READING_SAVED') {
        state.subscribers = [];
        // إعادة رسم الصفحة الحالية
        const activeView = document.querySelector('.view.active');
        if (activeView) {
          if (activeView.id === 'view-home') renderHome();
          else if (activeView.id === 'view-readings') renderReadings();
          else if (activeView.id === 'view-ledger') renderLedger();
          else if (activeView.id === 'view-search') renderSearch();
        }
      }
    }
  };
  window.addEventListener('message', handleMessage);
}

/* ============================================================
   القسم 15: init
============================================================ */
async function init() {
  initTheme();
  initMenu();
  
  // تحميل خط السير مبدئياً
  state.lineOfRoute = await getLineOfRoute();
  
  // بدء الصفحة الرئيسية
  switchTab('home');
  
  // Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(console.log);
    });
  }
}

// تشغيل
init();

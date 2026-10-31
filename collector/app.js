import { db } from '../shared/db.js';
import { importFromServer } from './importer.js';

const $ = id => document.getElementById(id);
let currentTab = 'home';

const state = { sector: '', blk: '', bld: '', openBld: null, subscribers: [], buildings: {} };

function applyTheme(theme) { document.body.setAttribute('data-theme', theme); localStorage.setItem('app-theme', theme); }
function initTheme() { applyTheme(localStorage.getItem('app-theme') || 'light'); }
function switchTab(tab) { currentTab = tab; document.querySelectorAll('.view').forEach(v => v.style.display = 'none'); $(`view-${tab}`).style.display = 'block'; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); if (tab === 'home') renderHome(); }

async function renderHome() {
  const view = $('view-home');
  view.style.display = 'block';
  
  const count = await db.subscribers.count();
  if (count === 0) {
    view.innerHTML = `
      <div class="card" style="text-align:center; padding: 40px 15px;">
        <h2 style="margin-bottom: 10px; font-size: 18px;">مرحباً بك في V2</h2>
        <p style="color: var(--mute); margin-bottom: 20px; font-size: 14px;">لا توجد بيانات. يرجى تحديث الملف للبدء.</p>
        <button id="btnFetch" style="background: var(--primary); color: white; border: none; padding: 12px; border-radius: 8px; width: 100%; font-weight: bold; cursor: pointer;">📥 تحديث الملف</button>
        <div id="fetchProgress" style="margin-top: 15px; font-size: 13px; color: var(--primary); font-weight: bold; display: none;"></div>
      </div>`;
    $('btnFetch').onclick = async () => {
      const btn = $('btnFetch'); const prog = $('fetchProgress');
      btn.disabled = true; btn.style.opacity = '0.5'; prog.style.display = 'block';
      try {
        await importFromServer(msg => prog.textContent = msg);
        renderHome();
      } catch (err) { alert(err.message); btn.disabled = false; btn.style.opacity = '1'; prog.style.display = 'none'; }
    };
    return;
  }

  if (state.subscribers.length === 0) {
    state.subscribers = await db.subscribers.toArray();
    state.buildings = {};
    state.subscribers.forEach(s => {
      const secStr = String(s.sector).padStart(2, '0');
      const blkStr = String(s.blk).padStart(2, '0');
      const bldStr = String(s.bld).padStart(2, '0');
      
      if (!state.sector) state.sector = secStr;
      if (!state.blk && secStr === state.sector) state.blk = blkStr;
      
      const key = `${secStr}|${blkStr}|${bldStr}`;
      if (!state.buildings[key]) state.buildings[key] = { bld: bldStr, apts: [] };
      state.buildings[key].apts.push(s);
    });
  }

  const moves = await db.movements.toArray();
  const movesMap = new Map(moves.map(m => [m.key, m]));

  const secs = [...new Set(state.subscribers.map(s => String(s.sector).padStart(2, '0')))].sort();
  const blks = [...new Set(state.subscribers.filter(s => String(s.sector).padStart(2, '0') === state.sector).map(s => String(s.blk).padStart(2, '0')))].sort();
  const blds = [...new Set(state.subscribers.filter(s => String(s.sector).padStart(2, '0') === state.sector && String(s.blk).padStart(2, '0') === state.blk).map(s => String(s.bld).padStart(2, '0')))].sort();
  
  let html = `
    <div class="card" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; gap: 10px;">
        <div style="flex:1;">
          <label style="font-size:12px; font-weight:bold;">القطاع</label>
          <select id="selSector" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); margin-top:5px;">
            ${secs.map(s => `<option value="${s}" ${s === state.sector ? 'selected' : ''}>قطاع ${s}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;">
          <label style="font-size:12px; font-weight:bold;">البلوك</label>
          <select id="selBlk" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); margin-top:5px;">
            ${blks.map(b => `<option value="${b}" ${b === state.blk ? 'selected' : ''}>بلوك ${b}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;">
          <label style="font-size:12px; font-weight:bold;">العمارة</label>
          <select id="selBld" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); margin-top:5px;">
            <option value="">-- كل العمارات --</option>
            ${blds.map(b => `<option value="${b}" ${b === state.bld ? 'selected' : ''}>عمارة ${b}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    
    <div style="margin-bottom: 15px; display: flex; gap: 10px;">
      <button id="btnExport" style="flex: 1; padding: 10px; background: var(--success); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">📤 حفظ الأرشيف</button>
      <button id="btnMissingKeys" style="flex: 1; padding: 10px; background: #d97706; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">⚠️ تصدير بدون كود</button>
    </div>
  `;

  if (state.bld || state.openBld) {
    const targetBld = state.bld || state.openBld;
    const bldKey = `${state.sector}|${state.blk}|${targetBld}`;
    const bldData = state.buildings[bldKey];
    
    if (!bldData) {
       view.innerHTML = '<div class="card">خطأ في العثور على العمارة.</div>';
       return;
    }

    html += `
      <div class="card" style="padding: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
          <button id="btnBack" style="background:var(--bg); border:1px solid var(--line); padding:6px 12px; border-radius:8px; font-weight:bold; cursor:pointer;">⏪ رجوع</button>
          <h3 style="font-size:16px; font-weight:800; margin:0;">عمارة ${targetBld}</h3>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${bldData.apts.sort((a,b)=> String(a.apt).localeCompare(String(b.apt))).map((apt, idx) => {
            const cycle = idx % 4; const tint = [0, 4, 8, 12][cycle];
            const hasReading = movesMap.has(apt.key);
            const move = movesMap.get(apt.key);
            
            // عرض المديونية
            const due = apt.dueAmount || 0;
            const dueHtml = due > 0 ? `<span style="color:var(--danger); font-weight:bold; font-size:12px;">مستحق: ${due} ج</span>` : `<span style="color:var(--success); font-weight:bold; font-size:12px;">مسدد</span>`;

            return `<div style="background: color-mix(in srgb, var(--primary) ${tint}%, var(--card)); border:1px solid var(--line); border-radius:10px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:800; font-size:14px; display:flex; align-items:center; gap:5px;">${apt.name} ${hasReading ? '✅' : ''}</div>
                  <div style="font-size:12px; color:var(--mute); margin-top:4px;">شقة ${String(apt.apt).padStart(2, '0')} · ${apt.count || 0} فاتورة</div>
                  <div style="margin-top: 4px;">${dueHtml}</div>
                </div>
                <div style="display:flex; gap:5px;">
                  ${due > 0 ? `<button data-key="${apt.key}" class="btn-pay" style="background:#d97706; color:white; border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">تحصيل</button>` : ''}
                  <button data-key="${apt.key}" data-name="${apt.name}" data-addr="قطاع ${state.sector} بلوك ${state.blk} عمارة ${targetBld} شقة ${String(apt.apt).padStart(2, '0')}" data-prev="${apt.prevReading}" data-months="${apt.months || 1}" class="btn-read" style="background:${hasReading ? 'var(--success)' : 'var(--primary)'}; color:white; border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">${hasReading ? 'تعديل' : 'قراءة'}</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
    view.innerHTML = html;
    $('btnBack').onclick = () => { state.openBld = null; state.bld = ''; renderHome(); };
    
    document.querySelectorAll('.btn-read').forEach(btn => {
      btn.onclick = () => {
        const url = `reading.html?k=${encodeURIComponent(btn.dataset.key)}&n=${encodeURIComponent(btn.dataset.name)}&a=${encodeURIComponent(btn.dataset.addr)}&p=${btn.dataset.prev}&m=${btn.dataset.months}`;
        const d = document.createElement('dialog');
        d.style.cssText = 'width:95vw; height:90vh; max-width:420px; padding:0; border:none; border-radius:16px; overflow:hidden; background:transparent;';
        d.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`;
        document.body.appendChild(d);
        d.showModal();
        const handleMessage = (e) => {
          if (e.data && e.data.type === 'READING_SAVED') { d.close(); d.remove(); window.removeEventListener('message', handleMessage); renderHome(); }
        };
        window.addEventListener('message', handleMessage);
      };
    });

    document.querySelectorAll('.btn-pay').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('تأكيد تحصيل المديونية بالكامل؟')) return;
        const key = btn.dataset.key;
        await db.subscribers.update(key, { dueAmount: 0, count: 0 });
        renderHome();
      };
    });
  } else {
    const blds = Object.keys(state.buildings)
      .filter(k => k.startsWith(`${state.sector}|${state.blk}|`))
      .map(k => ({ key: k, ...state.buildings[k] }))
      .sort((a,b) => String(a.bld).localeCompare(String(b.bld)));
      
    html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
    blds.forEach((b, idx) => {
      const cycle = idx % 4; const tint = [0, 3, 6, 9][cycle];
      const totalDue = b.apts.reduce((sum, a) => sum + (Number(a.dueAmount) || 0), 0); 
      const readCount = b.apts.filter(a => movesMap.has(a.key)).length;
      html += `<div class="bld-card" data-bld="${b.bld}" style="background: color-mix(in srgb, var(--primary) ${tint}%, var(--card)); border:1px solid var(--line); border-right: 5px solid var(--primary); border-radius:10px; padding:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <div><div style="font-weight:800; font-size:15px;">عمارة ${b.bld}</div><div style="font-size:12px; color:var(--mute); margin-top:4px;">${b.apts.length} شقة · تم قراءة ${readCount}</div></div>
          <div style="font-weight:800; color:var(--primary); font-size:15px;">${totalDue} ج</div></div>`;
    });
    html += `</div>`;
    view.innerHTML = html;
    
    document.querySelectorAll('.bld-card').forEach(card => { card.onclick = () => { state.openBld = card.dataset.bld; renderHome(); }; });
  }

  if ($('selSector')) {
    $('selSector').onchange = (e) => { state.sector = e.target.value; state.blk = ''; state.bld = ''; state.openBld = null; renderHome(); };
    $('selBlk').onchange = (e) => { state.blk = e.target.value; state.bld = ''; state.openBld = null; renderHome(); };
    $('selBld').onchange = (e) => { state.bld = e.target.value; state.openBld = null; renderHome(); };
  }

  if ($('btnExport')) {
    $('btnExport').onclick = async () => {
      const moves = await db.movements.toArray();
      if (moves.length === 0) return alert('لا توجد قراءات جديدة.');
      const archiveData = { collector: 'محصل', date: new Date().toISOString(), movements: moves };
      const blob = new Blob([JSON.stringify(archiveData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `archive_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
    };
  }

  if ($('btnMissingKeys')) {
    $('btnMissingKeys').onclick = async () => {
      const missing = await db.subscribers.filter(s => String(s.key).startsWith('TMP_')).toArray();
      if (missing.length === 0) return alert('ممتاز! جميع العملاء يملكون أكواداً فريدة.');
      let csvContent = "\uFEFFالاسم,القطاع,البلوك,العمارة,الشقة,الكود المؤقت\n";
      missing.forEach(s => { csvContent += `"${s.name}","${s.sector}","${s.blk}","${s.bld}","${s.apt}","${s.key}"\n`; });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `عملاء_بدون_كود_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
    };
  }
}

$('menuBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('click', () => { $('menu').hidden = true; });
document.querySelectorAll('[data-theme-pick]').forEach(btn => { btn.onclick = () => { applyTheme(btn.dataset.themePick); $('menu').hidden = true; }; });
document.querySelectorAll('.tabs button').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });
$('exitBtn').onclick = () => { if (confirm('هل تريد الخروج؟')) location.reload(); };

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.log));
}
initTheme();
switchTab('home');

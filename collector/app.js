import { db } from '../shared/db.js';
import { importFromServer } from './importer.js';

const $ = id => document.getElementById(id);
let currentTab = 'home';
const state = { sector: '', blk: '', openBld: null, subscribers: [], buildings: {} };

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
      if (!state.sector) state.sector = s.sector;
      if (!state.blk && s.sector === state.sector) state.blk = s.blk;

      



      
      const key = `${String(s.sector)}|${String(s.blk)}|${String(s.bld)}`;
      if (!state.buildings[key]) state.buildings[key] = { bld: s.bld, apts: [] };
      state.buildings[key].apts.push(s);
    });
  }

  const moves = await db.movements.toArray();
  const movesMap = new Map(moves.map(m => [m.key, m]));

  const secs = [...new Set(state.subscribers.map(s => s.sector))].sort();
  const blks = [...new Set(state.subscribers.filter(s => s.sector === state.sector).map(s => s.blk))].sort();
  
  let html = `
    <div class="card" style="padding: 10px; display: flex; gap: 10px;">
      <div style="flex:1;"><label style="font-size:12px; font-weight:bold;">القطاع</label><select id="selSector" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); margin-top:5px;">${secs.map(s => `<option value="${s}" ${s === state.sector ? 'selected' : ''}>قطاع ${s}</option>`).join('')}</select></div>
      <div style="flex:1;"><label style="font-size:12px; font-weight:bold;">البلوك</label><select id="selBlk" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); margin-top:5px;">${blks.map(b => `<option value="${b}" ${b === state.blk ? 'selected' : ''}>بلوك ${b}</option>`).join('')}</select></div>
    </div>
    <div style="margin-bottom: 15px;"><button id="btnExport" style="width: 100%; padding: 10px; background: var(--success); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">📤 حفظ الأرشيف على الجهاز</button></div>
  `;

  if (state.openBld) {
    const bldKey = `${state.sector}|${state.blk}|${state.openBld}`;
    const bldData = state.buildings[bldKey];
    html += `<div class="card" style="padding: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
          <button id="btnBack" style="background:var(--bg); border:1px solid var(--line); padding:6px 12px; border-radius:8px; font-weight:bold; cursor:pointer;">⏪ رجوع</button>
          <h3 style="font-size:16px; font-weight:800; margin:0;">عمارة ${state.openBld}</h3>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${bldData.apts.sort((a,b)=> Number(a.apt)-Number(b.apt)).map((apt, idx) => {
            const cycle = idx % 4; const tint = [0, 4, 8, 12][cycle];
            const hasReading = movesMap.has(apt.key);
            const move = movesMap.get(apt.key);
            return `<div style="background: color-mix(in srgb, var(--primary) ${tint}%, var(--card)); border:1px solid var(--line); border-radius:10px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                <div><div style="font-weight:800; font-size:14px; display:flex; align-items:center; gap:5px;">${apt.name} ${hasReading ? '✅' : ''}</div>
                  <div style="font-size:12px; color:var(--mute); margin-top:4px;">شقة ${apt.apt} · سابقة: ${apt.prevReading} ${hasReading ? `· حالية: ${move.reading}` : ''}</div></div>
                <button data-key="${apt.key}" data-name="${apt.name}" data-addr="قطاع ${apt.sector} بلوك ${apt.blk} عمارة ${apt.bld} شقة ${apt.apt}" data-prev="${apt.prevReading}" data-months="${apt.months || 1}" class="btn-read" style="background:${hasReading ? 'var(--success)' : 'var(--primary)'}; color:white; border:none; padding:8px 12px; border-radius:8px; font-weight:bold; cursor:pointer;">${hasReading ? 'تعديل' : 'قراءة'}</button></div>`;
          }).join('')}
        </div></div>`;
    view.innerHTML = html;
    $('btnBack').onclick = () => { state.openBld = null; renderHome(); };
    
    document.querySelectorAll('.btn-read').forEach(btn => {
      btn.onclick = () => {
        const url = `reading.html?k=${encodeURIComponent(btn.dataset.key)}&n=${encodeURIComponent(btn.dataset.name)}&a=${encodeURIComponent(btn.dataset.addr)}&p=${btn.dataset.prev}&m=${btn.dataset.months}`;
        const d = document.createElement('dialog');
        d.style.cssText = 'width:95vw; height:90vh; max-width:420px; padding:0; border:none; border-radius:16px; overflow:hidden; background:transparent;';
        d.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`;
        document.body.appendChild(d);
        d.showModal();
        const handleMessage = (e) => {
          if (e.data && (e.data.type === 'READING_SAVED' || e.data.type === 'READING_CANCEL')) { 
            d.close(); d.remove(); 
            window.removeEventListener('message', handleMessage); 
            renderHome(); 
          }
        };
        window.addEventListener('message', handleMessage);
      };
    });
  } else {
    const blds = Object.keys(state.buildings).filter(k => k.startsWith(`${state.sector}|${state.blk}|`)).map(k => ({ key: k, ...state.buildings[k] })).sort((a,b) => Number(a.bld) - Number(b.bld));
    html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
    blds.forEach((b, idx) => {
      const cycle = idx % 4; const tint = [0, 3, 6, 9][cycle];
      const totalDue = b.apts.reduce((sum, a) => sum + (a.prevReading * 5), 0); 
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
    $('selSector').onchange = (e) => { state.sector = e.target.value; state.blk = ''; state.openBld = null; renderHome(); };
    $('selBlk').onchange = (e) => { state.blk = e.target.value; state.openBld = null; renderHome(); };
  }






  
  if ($('btnExport')) {
    $('btnExport').onclick = async () => {
      const moves = await db.movements.toArray();
      if (moves.length === 0) return alert('لا توجد قراءات جديدة.');
      const archiveData = { collector: 'محصل', date: new Date().toISOString(), movements: moves };
      const blob = new Blob([JSON.stringify(archiveData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `archive_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }
}

$('menuBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('click', () => { $('menu').hidden = true; });
document.querySelectorAll('[data-theme-pick]').forEach(btn => { btn.onclick = () => { applyTheme(btn.dataset.themePick); $('menu').hidden = true; }; });
document.querySelectorAll('.tabs button').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });
$('exitBtn').onclick = () => { if (confirm('هل تريد الخروج؟')) location.reload(); };

initTheme();
switchTab('home');

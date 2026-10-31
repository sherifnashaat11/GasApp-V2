import { db } from '../shared/db.js';
import { importFromServer } from './importer.js';

const $ = id => document.getElementById(id);
let currentTab = 'home';

const state = { sector: '', blk: '', bld: '', openBld: null, subscribers: [], buildings: {} };

function applyTheme(theme) { document.body.setAttribute('data-theme', theme); localStorage.setItem('app-theme', theme); }
function initTheme() { applyTheme(localStorage.getItem('app-theme') || 'light'); }

function switchTab(tab) { 
  currentTab = tab; 
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none'); 
  $(`view-${tab}`).style.display = 'block'; 
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); 
  if (tab === 'home') renderHome(); 
  if (tab === 'ledger') renderLedger(); 
}

// ======================= شاشة التحصيل =======================
async function renderHome() {
  const view = $('view-home');
  view.style.display = 'block';
  
  // جلب البيانات إذا كانت فارغة
  if (state.subscribers.length === 0) {
    state.subscribers = await db.subscribers.toArray();
    state.buildings = {};
    state.subscribers.forEach(s => {
      if (Number(s.dueAmount) <= 0) return; // استبعاد المسددين
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

  if (state.subscribers.length === 0) {
    view.innerHTML = `<div class="card" style="text-align:center; padding: 40px 15px;"><h2>لا توجد بيانات</h2><button id="btnFetch" style="margin-top:10px; padding:10px; background:var(--primary); color:white; border:none; border-radius:8px;">📥 تحديث الملف</button></div>`;
    $('btnFetch').onclick = async () => { await importFromServer(console.log); state.subscribers = []; renderHome(); };
    return;
  }

  const moves = await db.movements.toArray();
  const movesMap = new Map(moves.map(m => [m.key, m]));

  const secs = [...new Set(state.subscribers.filter(s => Number(s.dueAmount) > 0).map(s => String(s.sector).padStart(2, '0')))].sort();
  const blks = [...new Set(state.subscribers.filter(s => Number(s.dueAmount) > 0 && String(s.sector).padStart(2, '0') === state.sector).map(s => String(s.blk).padStart(2, '0')))].sort();
  const blds = [...new Set(state.subscribers.filter(s => Number(s.dueAmount) > 0 && String(s.sector).padStart(2, '0') === state.sector && String(s.blk).padStart(2, '0') === state.blk).map(s => String(s.bld).padStart(2, '0')))].sort();
  
  let html = `
    <div class="card" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; gap: 10px;">
        <div style="flex:1;"><label style="font-size:12px; font-weight:bold;">القطاع</label><select id="selSector" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line);">${secs.map(s => `<option value="${s}" ${s === state.sector ? 'selected' : ''}>قطاع ${s}</option>`).join('')}</select></div>
        <div style="flex:1;"><label style="font-size:12px; font-weight:bold;">البلوك</label><select id="selBlk" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line);">${blks.map(b => `<option value="${b}" ${b === state.blk ? 'selected' : ''}>بلوك ${b}</option>`).join('')}</select></div>
        <div style="flex:1;"><label style="font-size:12px; font-weight:bold;">العمارة</label><select id="selBld" style="width:100%; padding:8px; border-radius:8px; border:1px solid var(--line);"><option value="">-- كل العمارات --</option>${blds.map(b => `<option value="${b}" ${b === state.bld ? 'selected' : ''}>عمارة ${b}</option>`).join('')}</select></div>
      </div>
    </div>
  `;

  if (state.bld || state.openBld) {
    const targetBld = state.bld || state.openBld;
    const bldKey = `${state.sector}|${state.blk}|${targetBld}`;
    const bldData = state.buildings[bldKey];
    if (!bldData || bldData.apts.length === 0) { state.bld = ''; state.openBld = null; renderHome(); return; }

    const totalDue = bldData.apts.reduce((sum, a) => sum + (Number(a.dueAmount) || 0), 0);

    html += `
      <div class="card" style="padding: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <button id="btnBack" style="background:var(--bg); border:1px solid var(--line); padding:6px 12px; border-radius:8px; font-weight:bold; cursor:pointer;">⏪ رجوع</button>
            <h3 style="font-size:16px; font-weight:800; margin:0;">عمارة ${targetBld} <span style="color:var(--danger); font-size:14px;">(${totalDue} ج)</span></h3>
          </div>
          <button id="btnSelectAll" style="background:var(--primary); color:white; border:none; padding:6px 12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">تحديد الكل</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${bldData.apts.sort((a,b)=> String(a.apt).localeCompare(String(b.apt))).map((apt, idx) => {
            const hasReading = movesMap.has(apt.key);
            const due = Number(apt.dueAmount) || 0;
            return `<div style="background: var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="chk-apt" data-key="${apt.key}" data-due="${due}" data-count="${apt.count}" data-name="${apt.name}" style="width:18px; height:18px;">
                  <div>
                    <div style="font-weight:800; font-size:14px; display:flex; align-items:center; gap:5px;">${apt.name} ${hasReading ? '✅' : ''}</div>
                    <div style="font-size:12px; color:var(--mute); margin-top:4px;">شقة ${String(apt.apt).padStart(2, '0')} · ${apt.count || 0} فاتورة</div>
                    <div style="color:var(--danger); font-weight:bold; font-size:12px; margin-top:4px;">مستحق: ${due} ج</div>
                  </div>
                </div>
                <div style="display:flex; gap:5px;">
                  <button data-key="${apt.key}" data-due="${due}" data-count="${apt.count}" data-name="${apt.name}" class="btn-pay" style="background:#d97706; color:white; border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">تحصيل</button>
                  <button data-key="${apt.key}" data-name="${apt.name}" data-addr="قطاع ${state.sector} بلوك ${state.blk} عمارة ${targetBld} شقة ${String(apt.apt).padStart(2, '0')}" data-prev="${apt.prevReading}" data-months="${apt.months || 1}" class="btn-read" style="background:${hasReading ? 'var(--success)' : 'var(--primary)'}; color:white; border:none; padding:6px 10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">${hasReading ? 'تعديل' : 'قراءة'}</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
    view.innerHTML = html;
    $('btnBack').onclick = () => { state.openBld = null; state.bld = ''; renderHome(); };
    
    // --- التحديد الجماعي ---
    $('btnSelectAll').onclick = () => {
      const chks = document.querySelectorAll('.chk-apt');
      const allChecked = Array.from(chks).every(c => c.checked);
      chks.forEach(c => c.checked = !allChecked);
      updateSelectionBar();
    };

    function updateSelectionBar() {
      const selected = document.querySelectorAll('.chk-apt:checked');
      let selTotal = 0;
      selected.forEach(c => selTotal += Number(c.dataset.due));
      
      let bar = $('selectionBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'selectionBar';
        bar.style.cssText = 'position:fixed; bottom:70px; left:10px; right:10px; background:var(--card); padding:15px; border-radius:12px; box-shadow:0 -4px 15px rgba(0,0,0,0.15); border:2px solid var(--primary); z-index:100; text-align:center;';
        document.body.appendChild(bar);
      }
      
      if (selected.length > 0) {
        bar.style.display = 'block';
        bar.innerHTML = `<div style="font-weight:bold; margin-bottom:10px;">المحدد: ${selected.length} شقة · الإجمالي: ${selTotal} ج</div><button id="btnPayBulk" style="width:100%; background:var(--success); color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; font-size:16px;">سداد المحدد</button>`;
        
        $('btnPayBulk').onclick = async () => {
          if(!confirm('تأكيد السداد الجماعي؟')) return;
          const receipts = [];
          for (let c of selected) {
            receipts.push({ key: c.dataset.key, name: c.dataset.name, amount: Number(c.dataset.due), count: Number(c.dataset.count) });
            await db.subscribers.update(c.dataset.key, { dueAmount: 0, count: 0 });
            await db.movements.add({ key: c.dataset.key, type: 'pay', amount: Number(c.dataset.due), count: Number(c.dataset.count), date: new Date().toISOString(), printed: false });
          }
          bar.remove();
          state.subscribers = []; // إعادة تحميل
          showReceipt(receipts);
          renderHome();
        };
      } else {
        bar.style.display = 'none';
      }
    }
    document.querySelectorAll('.chk-apt').forEach(c => c.onchange = updateSelectionBar);

    // --- السداد الفردي ---
    document.querySelectorAll('.btn-pay').forEach(btn => {
      btn.onclick = async () => {
        const due = Number(btn.dataset.due);
        const count = Number(btn.dataset.count);
        const key = btn.dataset.key;
        const name = btn.dataset.name;

        // إذا كانت فاتورة واحدة -> سداد كلي
        if (count <= 1) {
          if (!confirm('تأكيد سداد المديونية بالكامل؟')) return;
          await db.subscribers.update(key, { dueAmount: 0, count: 0 });
          await db.movements.add({ key: key, type: 'pay', amount: due, count: 1, date: new Date().toISOString(), printed: false });
          state.subscribers = [];
          showReceipt([{ key, name, amount: due, count: 1 }]);
          renderHome();
          return;
        }

        // إذا كانت أكثر من فاتورة -> نافذة السداد الجزئي
        const d = document.createElement('dialog');
        d.style.cssText = 'padding:20px; border-radius:12px; text-align:center; max-width:350px;';
        d.innerHTML = `
          <h3 style="margin-bottom:15px;">سداد شقة ${name}</h3>
          <p style="margin-bottom:15px; font-weight:bold; color:var(--danger);">إجمالي المديونية: ${due} ج (${count} فواتير)</p>
          
          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:15px;">
            <button id="payFull" style="padding:10px; background:var(--success); color:white; border:none; border-radius:8px; font-weight:bold;">سداد كلي (${due} ج)</button>
            <button id="payPartial" style="padding:10px; background:var(--primary); color:white; border:none; border-radius:8px; font-weight:bold;">سداد جزئي</button>
          </div>
          <div id="partialInputs" style="display:none; gap:10px; margin-bottom:15px;">
            <input id="pCount" type="number" placeholder="عدد الفواتير" style="width:100%; padding:8px; margin-bottom:5px; border:1px solid var(--line); border-radius:6px; text-align:center;">
            <input id="pAmount" type="number" placeholder="القيمة المدفوعة" style="width:100%; padding:8px; border:1px solid var(--line); border-radius:6px; text-align:center;">
            <button id="confirmPartial" style="width:100%; padding:8px; margin-top:5px; background:var(--success); color:white; border:none; border-radius:6px; font-weight:bold;">تأكيد الدفع</button>
          </div>
          <button id="cancelBtn" style="width:100%; padding:10px; background:transparent; border:1px solid var(--line); border-radius:8px;">إلغاء</button>
        `;
        document.body.appendChild(d);
        d.showModal();

        d.querySelector('#cancelBtn').onclick = () => { d.close(); d.remove(); };
        d.querySelector('#payFull').onclick = async () => {
          await db.subscribers.update(key, { dueAmount: 0, count: 0 });
          await db.movements.add({ key: key, type: 'pay', amount: due, count: count, date: new Date().toISOString(), printed: false });
          d.close(); d.remove(); state.subscribers = [];
          showReceipt([{ key, name, amount: due, count: count }]);
          renderHome();
        };
        d.querySelector('#payPartial').onclick = () => { d.querySelector('#partialInputs').style.display = 'flex'; d.querySelector('#payPartial').style.display = 'none'; };
        d.querySelector('#confirmPartial').onclick = async () => {
          const pCount = Number(d.querySelector('#pCount').value);
          const pAmount = Number(d.querySelector('#pAmount').value);
          if (pCount <= 0 || pAmount <= 0 || pCount > count || pAmount > due) return alert('بيانات غير صحيحة');
          
          await db.subscribers.update(key, { dueAmount: due - pAmount, count: count - pCount });
          await db.movements.add({ key: key, type: 'pay', amount: pAmount, count: pCount, date: new Date().toISOString(), printed: false, partial: true });
          d.close(); d.remove(); state.subscribers = [];
          showReceipt([{ key, name, amount: pAmount, count: pCount }]);
          renderHome();
        };
      };
    });

    // --- القراءة ---
    document.querySelectorAll('.btn-read').forEach(btn => {
      btn.onclick = () => {
        const url = `reading.html?k=${encodeURIComponent(btn.dataset.key)}&n=${encodeURIComponent(btn.dataset.name)}&a=${encodeURIComponent(btn.dataset.addr)}&p=${btn.dataset.prev}&m=${btn.dataset.months}`;
        const d = document.createElement('dialog');
        d.style.cssText = 'width:95vw; height:90vh; max-width:420px; padding:0; border:none; border-radius:16px; overflow:hidden; background:transparent;';
        d.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`;
        document.body.appendChild(d); d.showModal();
        const handleMessage = (e) => { if (e.data && e.data.type === 'READING_SAVED') { d.close(); d.remove(); window.removeEventListener('message', handleMessage); state.subscribers = []; renderHome(); } };
        window.addEventListener('message', handleMessage);
      };
    });
  } else {
    // عرض العمارات
    const blds = Object.keys(state.buildings).filter(k => k.startsWith(`${state.sector}|${state.blk}|`)).map(k => ({ key: k, ...state.buildings[k] })).sort((a,b) => String(a.bld).localeCompare(String(b.bld)));
    html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
    blds.forEach((b, idx) => {
      const totalDue = b.apts.reduce((sum, a) => sum + (Number(a.dueAmount) || 0), 0); 
      html += `<div class="bld-card" data-bld="${b.bld}" style="background: color-mix(in srgb, var(--primary) ${[0,3,6,9][idx%4]}%, var(--card)); border:1px solid var(--line); border-right: 5px solid var(--primary); border-radius:10px; padding:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <div><div style="font-weight:800; font-size:15px;">عمارة ${b.bld}</div></div>
          <div style="font-weight:800; color:var(--danger); font-size:15px;">${totalDue} ج</div></div>`;
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
}

// ======================= دالة الإيصال (تجريبي) =======================







function showReceipt(receipts) {
  let html = `<div style="font-family: Tahoma; text-align:center; padding: 20px; direction: rtl;">`;
  html += `<h2 style="margin-bottom:10px;">🧾 إيصال تحصيل</h2>`;
  html += `<p>التاريخ: ${new Date().toLocaleString('ar-EG')}</p>`;
  html += `<table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:14px;">`;
  html += `<tr style="background:#eee;"><th style="border:1px solid #ccc; padding:8px;">الاسم</th><th style="border:1px solid #ccc; padding:8px;">المبلغ</th></tr>`;
  
  let total = 0;
  receipts.forEach(r => {
    total += r.amount;
    html += `<tr><td style="border:1px solid #ccc; padding:8px;">${r.name}</td><td style="border:1px solid #ccc; padding:8px;">${r.amount} ج</td></tr>`;
  });
  
  html += `<tr style="font-weight:bold; background:#e0f2fe;"><td style="border:1px solid #ccc; padding:8px;">الإجمالي</td><td style="border:1px solid #ccc; padding:8px;">${total} ج</td></tr>`;
  html += `</table>`;
  
  // أزرار التحكم
  html += `<div style="display:flex; gap:10px; margin-top:20px;">
    <button id="btnDoPrint" style="flex:1; padding:10px; background:#0f2438; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">🖨️ طباعة</button>
    <button id="btnCloseReceipt" style="flex:1; padding:10px; background:#e2e8f0; color:#333; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">إغلاق</button>
  </div>`;
  html += `</div>`;

  const d = document.createElement('dialog');
  d.style.cssText = 'padding:0; border:none; border-radius:12px; overflow:hidden; max-width:400px; width:90vw;';
  d.innerHTML = html;
  document.body.appendChild(d);
  d.showModal();

  // إغلاق النافذة
  d.querySelector('#btnCloseReceipt').onclick = () => { d.close(); d.remove(); };

  // طباعة وإغلاق
  d.querySelector('#btnDoPrint').onclick = () => {
    window.print();
    // إغلاق النافذة بعد أمر الطباعة
    setTimeout(() => {
      d.close();
      d.remove();
      renderHome(); // تحديث الشاشة الرئيسية
    }, 500);
  };
}




  
  html += `<tr style="font-weight:bold; background:#e0f2fe;"><td style="border:1px solid #ccc; padding:8px;">الإجمالي</td><td style="border:1px solid #ccc; padding:8px;">${total} ج</td></tr>`;
  html += `</table>`;
  html += `<button onclick="window.print()" style="margin-top:20px; padding:10px 20px; background:#0f2438; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">🖨️ طباعة</button>`;
  html += `</div>`;

  const d = document.createElement('dialog');
  d.style.cssText = 'padding:0; border:none; border-radius:12px; overflow:hidden; max-width:400px; width:90vw;';
  d.innerHTML = html;
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener('close', () => d.remove());
}

// ======================= شاشة ما تم تحصيله (الأرشيف) =======================
async function renderLedger() {
  const view = $('view-ledger');
  const moves = await db.movements.toArray();
  
  if (moves.length === 0) {
    view.innerHTML = `<div class="card" style="text-align:center; padding:20px;">لا توجد عمليات مسجلة حتى الآن.</div>`;
    return;
  }

  moves.sort((a,b) => new Date(b.date) - new Date(a.date));

  // حساب إجمالي اليوم
  const today = new Date().toDateString();
  const todayTotal = moves.filter(m => new Date(m.date).toDateString() === today).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

  let html = `<div class="card" style="background:var(--success); color:white; text-align:center; font-weight:bold; font-size:18px;">إجمالي تحصيل اليوم: ${todayTotal} ج</div>`;
  html += `<div style="margin-bottom:15px;"><button id="btnExport" style="width:100%; padding:12px; background:var(--primary); color:white; border:none; border-radius:8px; font-weight:bold;">📤 تصدير الأرشيف للأدمن</button></div>`;
  html += `<div style="display:flex; flex-direction:column; gap:10px;">`;

  for (let m of moves) {
    const sub = await db.subscribers.get(m.key);
    const name = sub ? sub.name : 'غير معروف';
    
    html += `
      <div class="card" style="padding:12px; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:800; font-size:14px;">${name}</div>
            <div style="font-size:12px; color:var(--mute); margin-top:4px;">${m.key} · ${m.type === 'pay' ? 'تحصيل' : 'قراءة'}</div>
            <div style="font-size:12px; color:var(--mute); margin-top:2px;">${new Date(m.date).toLocaleString('ar-EG')}</div>
          </div>
          <div style="text-align:left;">
            <div style="font-weight:800; color:var(--primary); font-size:16px;">${m.amount || m.estimatedInvoice || 0} ج</div>
          </div>
        </div>
        <div style="margin-top:10px; display:flex; gap:10px;">
          ${m.type === 'pay' ? `<button class="btn-print" data-id="${m.id}" data-key="${m.key}" data-amount="${m.amount}" style="flex:1; padding:6px; background:var(--primary); color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px;">طباعة</button>` : ''}
        </div>
      </div>
    `;
  }
  html += `</div>`;
  view.innerHTML = html;

  $('btnExport').onclick = () => {
    const archiveData = { collector: 'محصل', date: new Date().toISOString(), movements: moves };
    const blob = new Blob([JSON.stringify(archiveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `archive_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  };

  document.querySelectorAll('.btn-print').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const move = await db.movements.get(id);
      if (move) {
        const sub = await db.subscribers.get(move.key);
        showReceipt([{ key: move.key, name: sub ? sub.name : 'غير معروف', amount: move.amount, count: move.count }]);
        await db.movements.update(id, { printed: true });
      }
    };
  });
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

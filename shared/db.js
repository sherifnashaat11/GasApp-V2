/* ============================================================
   shared/db.js - V3.2
   الغرض: إدارة قاعدة البيانات (Dexie.js) + منطق الحاسبة + Migration
   الجداول: subscribers, movements, meta, profile, archive
   التغييرات في V3.2:
   - buildAptKey: 8 معاملات → 16 رقم (كود العميل الكامل)
   - searchByFullCode: بحث بـ 16 رقم
   - recordPayment: receiptRef = key + YYYYMMDDHHMM
   - getDigitConfig / setDigitConfig (من meta)
   - getLineOfRoute / setLineOfRoute (من profile)
   - getGovMap / getRegionMap (ترجمة ذكية)
   - getPrices / setPrices (Time-Series)
   - getPriceForPeriod / monthlyCostDetailed
   - calcNextInvoice (الرسوم مرة واحدة فقط)
   - numberToArabicWords
   - billPendingReadings
============================================================ */

if (typeof window.Dexie === 'undefined') {
  console.error('Dexie.js لم يتم تحميله! يرجى التأكد من إضافته في index.html');
}

export const db = new window.Dexie('GasAppV2_Enterprise');

/* ============================================================
   Schema V3 — مرن + متوافق مع V1/V2
============================================================ */
db.version(3).stores({
  subscribers: 'key, bldKey, aptKey, nameNormalized, inRoute, sector, blk, bld, apt, dueAmount, count, prevReading, months, status',
  movements: '++id, [key+period], key, period, type, source, aptKey, status, date, printed',
  meta: 'key',
  profile: '&empId',
  archive: '&receiptRef, key, date, source'
}).upgrade(tx => {
  return tx.table('subscribers').toCollection().modify(sub => {
    if (sub.aptKey === undefined) {
      const sec = String(sub.sector || '').padStart(2, '0');
      const blk = String(sub.blk || '').padStart(2, '0');
      const bld = String(sub.bld || '').padStart(2, '0');
      const apt = String(sub.apt || '').padStart(2, '0');
      sub.aptKey = `${sec}|${blk}|${bld}|${apt}`;
    }
    if (sub.prevReading === undefined) sub.prevReading = 0;
    if (sub.months === undefined) sub.months = 1;
    if (sub.dueAmount === undefined) sub.dueAmount = 0;
    if (sub.count === undefined) sub.count = 0;
    if (sub.status === undefined) sub.status = 'active';
  }).then(() => {
    return tx.table('movements').toCollection().modify(m => {
      if (m.source === undefined) m.source = 'route';
      if (m.printed === undefined) m.printed = false;
      if (m.aptKey === undefined) m.aptKey = null;
    });
  });
});

/* ============================================================
   1. بناء المفاتيح — V3.2 (16 رقم للعميل)
============================================================ */

/**
 * بناء كود العميل الكامل (16 رقم بلا فواصل)
 * الترتيب: gov|region|route|sector|blk|bld|apt|sub
 * كل خانة رقمان (افتراضي) — يمكن تغييره عبر digitConfig
 */
export function buildAptKey(gov, region, route, sector, blk, bld, apt, sub) {
  const pad = (v) => String(v || '').padStart(2, '0').slice(-2);
  return [
    pad(gov), pad(region), pad(route), pad(sector),
    pad(blk), pad(bld), pad(apt), pad(sub)
  ].join('');
}

/** بناء مفتاح العمارة (للتوافق مع القديم) */
export function buildBldKey(sector, blk, bld) {
  const pad = (v) => String(v || '').padStart(2, '0');
  return `${pad(sector)}|${pad(blk)}|${pad(bld)}`;
}

/** تطبيع الاسم للبحث */
export function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ثس]/g, 'س')
    .replace(/[طت]/g, 'ت')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ============================================================
   2. إعدادات الخانات (digitConfig)
============================================================ */

const DEFAULT_DIGIT_CONFIG = {
  gov: 2, region: 2, route: 2, sector: 2,
  blk: 2, bld: 2, apt: 2, sub: 2
};

export async function getDigitConfig() {
  const rec = await db.meta.get('digitConfig');
  return rec ? { ...DEFAULT_DIGIT_CONFIG, ...rec.value } : { ...DEFAULT_DIGIT_CONFIG };
}

export async function setDigitConfig(config) {
  await db.meta.put({ key: 'digitConfig', value: { ...DEFAULT_DIGIT_CONFIG, ...config } });
}

/* ============================================================
   3. خط السير (lineOfRoute) — من profile
============================================================ */

export async function getLineOfRoute() {
  const prof = await db.profile.toCollection().first();
  return prof?.lineOfRoute || null;
}

export async function setLineOfRoute(lineOfRoute) {
  const prof = await db.profile.toCollection().first();
  if (prof) {
    await db.profile.update(prof.empId, { lineOfRoute });
  } else {
    await db.profile.add({ empId: 'default', lineOfRoute });
  }
}

/* ============================================================
   4. خرائط المحافظة/المنطقة (ترجمة ذكية)
============================================================ */

export async function getGovMap() {
  const rec = await db.meta.get('govMap');
  if (rec) return rec.value;
  // استنتاج من subscribers
  const subs = await db.subscribers.toArray();
  const map = {};
  subs.forEach(s => { if (s.gov && s.govName) map[s.govName] = String(s.gov).padStart(2, '0'); });
  if (Object.keys(map).length > 0) await db.meta.put({ key: 'govMap', value: map });
  return map;
}

export async function getRegionMap() {
  const rec = await db.meta.get('regionMap');
  if (rec) return rec.value;
  const subs = await db.subscribers.toArray();
  const map = {};
  subs.forEach(s => { if (s.region && s.regionName) map[`${s.govName}|${s.regionName}`] = String(s.region).padStart(2, '0'); });
  if (Object.keys(map).length > 0) await db.meta.put({ key: 'regionMap', value: map });
  return map;
}

/* ============================================================
   5. الأسعار (Time-Series) — من calculator.html
============================================================ */

export const DEFAULT_PERIODS = [
  { date:'2016-11-01', tiers:[{name:'الأولى',limit:30,price:0.75},{name:'الثانية',limit:60,price:1.50},{name:'الثالثة',limit:null,price:2.00}] },
  { date:'2017-07-01', tiers:[{name:'الأولى',limit:30,price:1.00},{name:'الثانية',limit:60,price:1.75},{name:'الثالثة',limit:null,price:2.50}] },
  { date:'2018-08-01', tiers:[{name:'الأولى',limit:30,price:1.75},{name:'الثانية',limit:60,price:2.50},{name:'الثالثة',limit:null,price:3.15}] },
  { date:'2019-07-01', tiers:[{name:'الأولى',limit:30,price:2.35},{name:'الثانية',limit:60,price:3.10},{name:'الثالثة',limit:null,price:3.60}] },
  { date:'2021-10-01', tiers:[{name:'الأولى',limit:30,price:2.50},{name:'الثانية',limit:60,price:3.25},{name:'الثالثة',limit:null,price:3.75}] },
  { date:'2024-09-01', tiers:[{name:'الأولى',limit:30,price:3.00},{name:'الثانية',limit:60,price:4.00},{name:'الثالثة',limit:null,price:5.00}] },
  { date:'2025-06-01', tiers:[{name:'الأولى',limit:30,price:4.00},{name:'الثانية',limit:60,price:5.00},{name:'الثالثة',limit:null,price:6.00}] },
  { date:'2025-10-01', tiers:[{name:'الأولى',limit:30,price:5.00},{name:'الثانية',limit:60,price:6.00},{name:'الثالثة',limit:null,price:9.00}] },
  { date:'2026-03-01', tiers:[{name:'الأولى',limit:30,price:6.00},{name:'الثانية',limit:60,price:8.00},{name:'الثالثة',limit:null,price:12.00}] }
];

const DEFAULT_FEES = 18;

export async function getPrices() {
  const rec = await db.meta.get('prices');
  return rec ? rec.value : JSON.parse(JSON.stringify(DEFAULT_PERIODS));
}

export async function setPrices(periods) {
  await db.meta.put({ key: 'prices', value: periods });
}

export async function getFees() {
  const rec = await db.meta.get('fees');
  return rec ? Number(rec.value) : DEFAULT_FEES;
}

export async function setFees(fees) {
  await db.meta.put({ key: 'fees', value: Number(fees) });
}

/* ============================================================
   6. منطق الحساب — من calculator.html (معدّل: الرسوم مرة واحدة)
============================================================ */

function parseDate(s) {
  const parts = String(s).split('-');
  return { y: Number(parts[0])||2026, m: Number(parts[1])||1, d: Number(parts[2])||1 };
}

function mIdx(y, m) { return y * 12 + (m - 1); }

function fmtMonthYear(y, m) {
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
}

/** حساب تكلفة شهر واحد بالشرائح */
export function monthlyCostDetailed(cons, tiers) {
  let rem = Number(cons) || 0;
  let cost = 0;
  let prev = 0;
  const rows = [];
  if (!Array.isArray(tiers)) return { cost: 0, rows: [] };

  for (let i = 0; i < tiers.length; i++) {
    if (rem <= 0) break;
    const t = tiers[i];
    let cap;
    if (t.limit === null || t.limit === undefined || t.limit === '' || isNaN(t.limit)) {
      cap = rem;
    } else {
      cap = Math.max(0, Number(t.limit) - prev);
    }
    const used = Math.min(rem, cap);
    const tierCost = used * (Number(t.price) || 0);
    cost += tierCost;
    if (used > 0) {
      rows.push({ tierName: `شريحة ${t.name}`, price: t.price, meters: used, total: tierCost });
    }
    rem -= used;
    if (t.limit !== null && t.limit !== undefined && t.limit !== '' && !isNaN(t.limit)) {
      prev = Number(t.limit);
    }
  }
  return { cost, rows };
}

/**
 * حساب الفاتورة القادمة — الرسوم مرة واحدة فقط
 * @param {Object} opts
 * @param {number} opts.reading - القراءة الحالية
 * @param {number} opts.prevReading - القراءة السابقة
 * @param {number} opts.months - أشهر المحاسبة
 * @param {number} opts.fees - الرسوم (مرة واحدة)
 * @param {Array} opts.periods - فترات الأسعار
 * @returns {Object} { total, exactTotal, consumptionCost, fees, avg, months, rows, ... }
 */
export function calcNextInvoice({ reading, prevReading, months, fees, periods }) {
  const cons = Math.max(0, (Number(reading) || 0) - (Number(prevReading) || 0));
  const nMonths = Math.max(1, Number(months) || 1);
  const avg = cons / nMonths;
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const aEnd = mIdx(targetDate.getFullYear(), targetDate.getMonth() + 1);
  const aStart = aEnd - nMonths + 1;

  const endMonthName = targetDate.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  const billPeriodText = `فاتورة شهر ${endMonthName}`;

  const sorted = [...(periods || DEFAULT_PERIODS)].sort((a, b) => a.date.localeCompare(b.date));

  let totalConsumptionCost = 0;
  const rows = [];
  let totalCovered = 0;

  for (let i = 0; i < sorted.length; i++) {
    const pDate = parseDate(sorted[i].date);
    const start = (i === 0) ? -Infinity : mIdx(pDate.y, pDate.m);
    const nextPDate = (i < sorted.length - 1) ? parseDate(sorted[i + 1].date) : null;
    const end = nextPDate === null ? Infinity : mIdx(nextPDate.y, nextPDate.m) - 1;

    const s = Math.max(start, aStart);
    const e = Math.min(end, aEnd);
    const overlap = Math.max(0, e - s + 1);
    if (overlap === 0) continue;

    const res = monthlyCostDetailed(avg, sorted[i].tiers);
    const sub = overlap * res.cost;
    totalConsumptionCost += sub;
    totalCovered += overlap;

    const startYear = Math.floor(s / 12);
    const startMonth = (s % 12) + 1;
    const endYear = Math.floor(e / 12);
    const endMonth = (e % 12) + 1;

    rows.push({
      fromText: fmtMonthYear(startYear, startMonth),
      toText: fmtMonthYear(endYear, endMonth),
      months: overlap,
      monthlyCost: res.cost,
      subtotal: sub,
      tierRows: res.rows,
      avg
    });
  }

  const feesOnce = Number(fees) || DEFAULT_FEES; // ✅ مرة واحدة فقط
  const exactTotal = totalConsumptionCost + feesOnce;
  const total = Math.round(exactTotal);

  return {
    months: nMonths,
    cons, avg, fees: feesOnce,
    prevReading: Number(prevReading) || 0,
    reading: Number(reading) || 0,
    consumptionCost: totalConsumptionCost,
    exactTotal, total,
    totalCovered, billPeriodText,
    rows
  };
}

/* ============================================================
   7. تحويل الأرقام إلى كلمات عربية
============================================================ */

export function numberToArabicWords(n) {
  const num = Math.floor(Number(n) || 0);
  if (num === 0) return 'فقط صِفْرٌ جنيها مصريا فقط لاغير';

  const units = ['','مائة','مئتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];
  const tens = ['','عشرة','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
  const teens = ['عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
  const ones = ['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة'];

  function less1000(val) {
    if (val === 0) return '';
    let res = '';
    const h = Math.floor(val / 100);
    const rem = val % 100;
    if (h > 0) res += units[h];
    if (rem > 0) {
      if (res) res += ' و';
      if (rem < 10) res += ones[rem];
      else if (rem < 20) res += teens[rem - 10];
      else {
        const t = Math.floor(rem / 10);
        const o = rem % 10;
        if (o > 0) res += ones[o] + ' و';
        res += tens[t];
      }
    }
    return res;
  }

  function convert(val) {
    if (val === 0) return '';
    if (val < 1000) return less1000(val);
    if (val < 1000000) {
      const th = Math.floor(val / 1000);
      const rem = val % 1000;
      let thStr = '';
      if (th === 1) thStr = 'ألف';
      else if (th === 2) thStr = 'ألفان';
      else if (th <= 10) thStr = less1000(th) + ' آلاف';
      else thStr = less1000(th) + ' ألفاً';
      if (rem > 0) thStr += ' و' + less1000(rem);
      return thStr;
    }
    return String(val);
  }

  return `فقط ${convert(num)} جنيها مصريا فقط لاغير`;
}

/* ============================================================
   8. البحث
============================================================ */

/** البحث بالكود الكامل (16 رقم) */
export async function searchByFullCode(fullCode) {
  const clean = String(fullCode).replace(/\D/g, '');
  if (clean.length !== 16) return [];
  return db.subscribers.where('aptKey').equals(clean).toArray();
}

/** البحث بالاسم داخل نطاق (محافظة + منطقة) */
export async function searchByName(nameQuery, gov, region) {
  const norm = normalizeName(nameQuery);
  if (!norm) return [];
  const all = await db.subscribers.toArray();
  return all.filter(s =>
    (!gov || String(s.gov) === String(gov)) &&
    (!region || String(s.region) === String(region)) &&
    normalizeName(s.name).includes(norm)
  );
}

/* ============================================================
   9. جلب العملاء
============================================================ */

/** جلب عمارة كاملة مع حركاتها */
export async function getBuildingWithMovements(bldKey) {
  const subs = await db.subscribers.where('bldKey').equals(bldKey).toArray();
  const keys = subs.map(s => s.key);
  if (keys.length === 0) return [];
  const moves = await db.movements.where('key').anyOf(keys).toArray();
  const moveMap = new Map();
  moves.forEach(m => { if (!moveMap.has(m.key)) moveMap.set(m.key, m); });
  return subs.map(s => ({ ...s, movement: moveMap.get(s.key) || null }));
}

/** جلب العملاء بلا قراءة هذا الشهر */
export async function getUnreadSubscribers(period) {
  const allSubs = await db.subscribers.toArray();
  const reads = await db.movements
    .where('period').equals(period)
    .filter(m => !!m.reading)
    .toArray();
  const readKeys = new Set(reads.map(r => r.key));
  return allSubs.filter(s => Number(s.dueAmount) > 0 && !readKeys.has(s.key));
}

/* ============================================================
   10. السداد والقراءة
============================================================ */

/** تسجيل سداد — مع receiptRef = key + YYYYMMDDHHMM */
export async function recordPayment({ key, name, amount, count, source = 'route', aptKey = null, period }) {
  const sub = await db.subscribers.get(key);
  if (!sub) throw new Error('العميل غير موجود');

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const MM = String(now.getMinutes()).padStart(2, '0');
  const receiptRef = `${key}${yyyy}${mm}${dd}${HH}${MM}`;

  const newDue = Math.max(0, (Number(sub.dueAmount) || 0) - amount);
  const newCount = Math.max(0, (Number(sub.count) || 0) - count);
  await db.subscribers.update(key, { dueAmount: newDue, count: newCount });

  const move = {
    key, type: 'pay', amount, count,
    date: now.toISOString(),
    source, aptKey: aptKey || sub.aptKey,
    period: period || getCurrentPeriod(),
    printed: false, status: 'done',
    receiptRef
  };
  await db.movements.add(move);
  return move;
}

/** تسجيل قراءة */
export async function recordReading({ key, reading, prevReading, consumption, estimatedInvoice, months, period }) {
  const p = period || getCurrentPeriod();
  const existing = await db.movements
    .where('[key+period]').equals([key, p])
    .filter(m => m.type === 'read')
    .first();

  const data = {
    key, type: 'read', reading, prevReading, consumption,
    estimatedInvoice, months,
    date: new Date().toISOString(),
    period: p, source: 'route', status: 'pending'
  };

  if (existing) {
    await db.movements.update(existing.id, data);
    return existing.id;
  }
  return db.movements.add(data);
}

/** تحويل القراءات pending → billed + إضافتها للمديونية */
export async function billPendingReadings(period) {
  const p = period || getCurrentPeriod();
  const pending = await db.movements
    .where('period').equals(p)
    .filter(m => m.type === 'read' && m.status === 'pending')
    .toArray();

  for (const m of pending) {
    const sub = await db.subscribers.get(m.key);
    if (!sub) continue;
    await db.subscribers.update(m.key, {
      dueAmount: (Number(sub.dueAmount) || 0) + (Number(m.estimatedInvoice) || 0),
      count: (Number(sub.count) || 0) + 1
    });
    await db.movements.update(m.id, { status: 'billed' });
  }
  return pending.length;
}

/* ============================================================
   11. أدوات عامة
============================================================ */

export function getCurrentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function getTodayStats() {
  const today = new Date().toDateString();
  const all = await db.movements.toArray();
  const todayMoves = all.filter(m => new Date(m.date).toDateString() === today);
  const pay = todayMoves.filter(m => m.type === 'pay');
  const read = todayMoves.filter(m => m.type === 'read');
  return {
    totalPay: pay.reduce((s, m) => s + (Number(m.amount) || 0), 0),
    countPay: pay.length,
    countRead: read.length,
    totalMoves: todayMoves.length
  };
}

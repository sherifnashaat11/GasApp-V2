/* ============================================================
   shared/db.js - V3.2 (النسخة النهائية المعتمدة)
   الغرض: إدارة قاعدة البيانات (Dexie.js) مع Migration ذكي
   الجداول: subscribers, movements, meta, profile, archive
   الميزات: الكود 16 رقم، الأسعار التاريخية، الرسوم مرة واحدة
============================================================ */

if (typeof window.Dexie === 'undefined') {
  console.error('Dexie.js لم يتم تحميله! يرجى التأكد من إضافته في index.html');
}

export const db = new window.Dexie('GasAppV2_Enterprise');

/* ============================================================
   1. البيانات الثابتة (الأسعار التاريخية)
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

/* ============================================================
   2. Schema V4 (المخطط الجديد)
   ملاحظة: aptKey = 16 رقم بلا فواصل، bldKey = 12 رقم
============================================================ */
db.version(4).stores({
  subscribers: 'key, aptKey, bldKey, nameNormalized, inRoute, gov, region, route, sector, blk, bld, apt, sub, dueAmount, count, prevReading, months, status',
  movements: '++id, [key+period], key, period, type, source, aptKey, receiptRef, status, date, printed',
  meta: 'key',
  profile: '&empId',
  archive: '&receiptRef, key, date, source'
}).upgrade(tx => {
  // Migration: تحويل السجلات القديمة (V3) إلى V4
  return tx.table('subscribers').toCollection().modify(sub => {
    // 1. تحويل aptKey القديم (4 أجزاء) إلى جديد (16 رقم)
    if (!sub.aptKey || sub.aptKey.includes('|')) {
      sub.aptKey = buildAptKey(
        sub.gov || '00', sub.region || '00', sub.route || '00',
        sub.sector || '00', sub.blk || '00', sub.bld || '00', sub.apt || '00', sub.sub || '00'
      );
    }
    // 2. بناء bldKey الجديد (12 رقم)
    if (!sub.bldKey || sub.bldKey.includes('|')) {
      sub.bldKey = buildBldKey(
        sub.gov || '00', sub.region || '00', sub.route || '00',
        sub.sector || '00', sub.blk || '00', sub.bld || '00'
      );
    }
    // 3. إضافة الحقول الناقصة
    if (sub.nameNormalized === undefined) sub.nameNormalized = normalizeName(sub.name || '');
    if (sub.inRoute === undefined) sub.inRoute = true; // افتراضي: داخل خط السير
    if (sub.prevReading === undefined) sub.prevReading = 0;
    if (sub.months === undefined) sub.months = 1;
    if (sub.dueAmount === undefined) sub.dueAmount = 0;
    if (sub.count === undefined) sub.count = 0;
    if (sub.status === undefined) sub.status = 'active';
    
    // التأكد من وجود الحقول الرقمية
    sub.gov = String(sub.gov || '00').padStart(2, '0');
    sub.region = String(sub.region || '00').padStart(2, '0');
    sub.route = String(sub.route || '00').padStart(2, '0');
    sub.sector = String(sub.sector || '00').padStart(2, '0');
    sub.blk = String(sub.blk || '00').padStart(2, '0');
    sub.bld = String(sub.bld || '00').padStart(2, '0');
    sub.apt = String(sub.apt || '00').padStart(2, '0');
    sub.sub = String(sub.sub || '00').padStart(2, '0');
  }).then(() => {
    return tx.table('movements').toCollection().modify(m => {
      if (m.source === undefined) m.source = 'route';
      if (m.printed === undefined) m.printed = false;
      if (m.aptKey === undefined) m.aptKey = null;
      // إضافة receiptRef للحركات القديمة (إذا كانت سداد)
      if (m.type === 'pay' && !m.receiptRef) {
        const date = new Date(m.date || Date.now());
        const stamp = date.getFullYear() +
          String(date.getMonth() + 1).padStart(2, '0') +
          String(date.getDate()).padStart(2, '0') +
          String(date.getHours()).padStart(2, '0') +
          String(date.getMinutes()).padStart(2, '0');
        m.receiptRef = (m.key || '') + stamp;
      }
    });
  });
});

/* ============================================================
   3. دوال مساعدة (Helpers) — بناء المفاتيح
============================================================ */

/** بناء مفتاح الشقة 16 رقم (gov+region+route+sector+blk+bld+apt+sub) */
export function buildAptKey(gov, region, route, sector, blk, bld, apt, sub) {
  const p = (v) => String(v || '00').padStart(2, '0').slice(-2);
  return `${p(gov)}${p(region)}${p(route)}${p(sector)}${p(blk)}${p(bld)}${p(apt)}${p(sub)}`;
}

/** بناء مفتاح العمارة 12 رقم (gov+region+route+sector+blk+bld) */
export function buildBldKey(gov, region, route, sector, blk, bld) {
  const p = (v) => String(v || '00').padStart(2, '0').slice(-2);
  return `${p(gov)}${p(region)}${p(route)}${p(sector)}${p(blk)}${p(bld)}`;
}

/** تطبيع الاسم للبحث (إزالة التشكيل + توحيد الحروف) */
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
   4. دوال الإعدادات (meta)
============================================================ */

/** جلب إعدادات الخانات (افتراضي 2 لكل خانة) */
export async function getDigitConfig() {
  const m = await db.meta.get('digitConfig');
  return m ? m.value : { gov: 2, region: 2, route: 2, sector: 2, blk: 2, bld: 2, apt: 2, sub: 2 };
}

/** حفظ إعدادات الخانات */
export async function setDigitConfig(config) {
  await db.meta.put({ key: 'digitConfig', value: config });
}

/** جلب خط السير الحالي */
export async function getLineOfRoute() {
  const p = await db.profile.toCollection().first();
  return p ? p.lineOfRoute : null;
}

/** حفظ خط السير */
export async function setLineOfRoute(route) {
  const p = await db.profile.toCollection().first();
  if (p) {
    await db.profile.update(p.empId, { lineOfRoute: route });
  } else {
    await db.profile.add({ empId: 'default', lineOfRoute: route });
  }
}

/** جلب خريطة المحافظات (اسم ↔ رقم) */
export async function getGovMap() {
  const m = await db.meta.get('govMap');
  return m ? m.value : {};
}

/** حفظ خريطة المحافظات */
export async function setGovMap(map) {
  await db.meta.put({ key: 'govMap', value: map });
}

/** جلب خريطة المناطق */
export async function getRegionMap() {
  const m = await db.meta.get('regionMap');
  return m ? m.value : {};
}

/** حفظ خريطة المناطق */
export async function setRegionMap(map) {
  await db.meta.put({ key: 'regionMap', value: map });
}

/** جلب فترات الأسعار (افتراضي DEFAULT_PERIODS) */
export async function getPrices() {
  const m = await db.meta.get('prices');
  return m ? m.value : DEFAULT_PERIODS;
}

/** حفظ فترات الأسعار */
export async function setPrices(periods) {
  await db.meta.put({ key: 'prices', value: periods });
}

/** جلب الرسوم (افتراضي 18) */
export async function getFees() {
  const m = await db.meta.get('fees');
  return m ? m.value : 18;
}

/** حفظ الرسوم */
export async function setFees(fees) {
  await db.meta.put({ key: 'fees', value: Number(fees) });
}

/* ============================================================
   5. النظام المحاسبي (من calculator.html)
============================================================ */

/** جلب شرائح الفترة السارية لتاريخ معين */
export function getPriceForPeriod(dateStr, periods = DEFAULT_PERIODS) {
  const d = new Date(dateStr).getTime();
  let active = periods[0];
  for (const p of periods) {
    if (new Date(p.date).getTime() <= d) active = p;
    else break;
  }
  return active ? active.tiers : DEFAULT_PERIODS[0].tiers;
}

/** حساب تكلفة استهلاك شهري (تفصيلي) */
export function monthlyCostDetailed(cons, tiers) {
  let remaining = cons;
  let total = 0;
  let prevLimit = 0;
  const rows = [];
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const cap = (tier.limit === null) ? remaining : Math.max(0, tier.limit - prevLimit);
    const used = Math.min(remaining, cap);
    if (used > 0) {
      const cost = used * tier.price;
      total += cost;
      rows.push({ name: tier.name, used, price: tier.price, cost });
    }
    remaining -= used;
    if (tier.limit !== null) prevLimit = tier.limit;
  }
  return { cost: total, rows };
}

/** تحويل الأرقام إلى كلمات عربية (تفقيط) */
export function numberToArabicWords(num) {
  const n = Math.round(Number(num) || 0);
  if (n === 0) return 'صفر';
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  
  function convertGroup(g) {
    let str = '';
    const h = Math.floor(g / 100);
    const t = g % 100;
    if (h > 0) str += hundreds[h] + ' و';
    if (t >= 10 && t < 20) {
      str += teens[t - 10];
    } else {
      const ten = Math.floor(t / 10);
      const one = t % 10;
      if (ten > 0 && one > 0) str += ones[one] + ' و' + tens[ten];
      else if (ten > 0) str += tens[ten];
      else if (one > 0) str += ones[one];
    }
    return str.replace(/ و$/, '');
  }
  
  if (n < 1000) return convertGroup(n) + ' جنيهاً';
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    let str = convertGroup(thousands) + ' ألف';
    if (rest > 0) str += ' و' + convertGroup(rest);
    return str + ' جنيهاً';
  }
  return n + ' جنيهاً';
}

/** حساب الفاتورة القادمة (الرسوم مرة واحدة فقط) */
export function calcNextInvoice({ reading, prevReading, months, fees, periods }) {
  const cons = Math.max(0, reading - prevReading);
  const avg = months > 0 ? cons / months : 0;
  const activePeriods = periods || DEFAULT_PERIODS;
  let totalConsumptionCost = 0;
  let rows = [];
  
  // توزيع الاستهلاك على الفترات التاريخية
  // ملاحظة: هذا تبسيط، لكننا سنستخدم الفترة السارية على تاريخ اليوم
  const today = new Date().toISOString().slice(0, 10);
  const tiers = getPriceForPeriod(today, activePeriods);
  const result = monthlyCostDetailed(avg, tiers);
  totalConsumptionCost = result.cost * months;
  rows = result.rows.map(r => ({ ...r, used: r.used * months, cost: r.cost * months }));
  
  const exactGrandTotal = totalConsumptionCost + Number(fees || 0); // الرسوم مرة واحدة
  const grandTotal = Math.round(exactGrandTotal);
  
  return {
    cons,
    avg,
    totalConsumptionCost,
    fees: Number(fees || 0),
    grandTotal,
    rows,
    words: numberToArabicWords(grandTotal)
  };
}

/* ============================================================
   6. دوال العمليات (Movements & Subscribers)
============================================================ */

/** تحويل القراءات المعلقة (pending) إلى مفوترة (billed) وإضافتها للمديونية */
export async function billPendingReadings() {
  const pending = await db.movements.where({ type: 'read', status: 'pending' }).toArray();
  for (const m of pending) {
    const sub = await db.subscribers.get(m.key);
    if (sub) {
      const newDue = (Number(sub.dueAmount) || 0) + (Number(m.estimatedInvoice) || 0);
      const newCount = (Number(sub.count) || 0) + 1; // فاتورة واحدة
      await db.subscribers.update(m.key, { dueAmount: newDue, count: newCount });
      await db.movements.update(m.id, { status: 'billed' });
    }
  }
  return pending.length;
}

/** البحث بالكود الكامل (16 رقم) */
export async function searchByFullCode(fullCode) {
  const clean = String(fullCode).replace(/\D/g, '');
  if (clean.length !== 16) return [];
  const aptKey = clean; // الكود نفسه هو aptKey
  return db.subscribers.where('aptKey').equals(aptKey).toArray();
}

/** البحث بالاسم (مع فلترة إلزامية) */
export async function searchByName(nameQuery, gov, region) {
  const norm = normalizeName(nameQuery);
  if (!norm) return [];
  let query = db.subscribers;
  if (gov) query = query.where('gov').equals(gov);
  if (region) query = query.where('region').equals(region);
  const all = await query.toArray();
  return all.filter(s => s.nameNormalized && s.nameNormalized.includes(norm));
}

/** جلب العملاء بلا قراءة هذا الشهر */
export async function getUnreadSubscribers(period) {
  const allSubs = await db.subscribers.toArray();
  const reads = await db.movements
    .where('period').equals(period)
    .filter(m => m.type === 'read')
    .toArray();
  const readKeys = new Set(reads.map(r => r.key));
  return allSubs.filter(s => 
    Number(s.dueAmount) > 0 && !readKeys.has(s.key)
  );
}

/** جلب عمارة كاملة مع حركاتها */
export async function getBuildingWithMovements(bldKey) {
  const subs = await db.subscribers.where('bldKey').equals(bldKey).toArray();
  const keys = subs.map(s => s.key);
  const moves = await db.movements.where('key').anyOf(keys).toArray();
  const moveMap = new Map();
  moves.forEach(m => {
    if (!moveMap.has(m.key)) moveMap.set(m.key, m);
  });
  return subs.map(s => ({
    ...s,
    movement: moveMap.get(s.key) || null
  }));
}

/** تسجيل سداد (مع receiptRef) */
export async function recordPayment({ key, name, amount, count, source = 'route', aptKey = null, period }) {
  const sub = await db.subscribers.get(key);
  if (!sub) throw new Error('العميل غير موجود');
  
  const newDue = Math.max(0, (Number(sub.dueAmount) || 0) - amount);
  const newCount = Math.max(0, (Number(sub.count) || 0) - count);
  
  await db.subscribers.update(key, { dueAmount: newDue, count: newCount });
  
  // بناء receiptRef = key + YYYYMMDDHHMM
  const now = new Date();
  const stamp = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  const receiptRef = key + stamp;
  
  const move = {
    key, type: 'pay', amount, count,
    date: now.toISOString(),
    source,
    aptKey: aptKey || sub.aptKey,
    period: period || getCurrentPeriod(),
    receiptRef,
    printed: false,
    status: 'done'
  };
  await db.movements.add(move);
  return move;
}

/** تسجيل قراءة (مع period ديناميكي) */
export async function recordReading({ key, reading, prevReading, consumption, estimatedInvoice, months, period }) {
  const existing = await db.movements.where({ key, period }).filter(m => m.type === 'read').first();
  const data = {
    key, type: 'read', reading, prevReading, consumption,
    estimatedInvoice, months,
    date: new Date().toISOString(),
    period: period || getCurrentPeriod(),
    source: 'route',
    status: 'pending'
  };
  if (existing) {
    await db.movements.update(existing.id, data);
    return existing.id;
  }
  return db.movements.add(data);
}

/** الفترة الحالية (YYYY-MM) */
export function getCurrentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** إحصائيات اليوم */
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

/** تنسيق رقم المشترك للعرض (إخفاء الثوابت) */
export function formatSubscriberRef(sub, lineOfRoute = null) {
  if (!sub) return '';
  const parts = [];
  // إذا كان خط السير يحدد الثوابت، نخفيها
  const hideGov = lineOfRoute?.gov === sub.gov;
  const hideRegion = lineOfRoute?.region === sub.region;
  const hideRoute = lineOfRoute?.route === sub.route;
  const hideSub = sub.sub === '00';
  
  if (!hideGov) parts.push(`محافظة ${sub.gov}`);
  if (!hideRegion) parts.push(`منطقة ${sub.region}`);
  if (!hideRoute) parts.push(`يومية ${sub.route}`);
  parts.push(`قطاع ${sub.sector}`);
  parts.push(`بلوك ${sub.blk}`);
  parts.push(`عمارة ${sub.bld}`);
  parts.push(`شقة ${sub.apt}`);
  if (!hideSub) parts.push(`فرعي ${sub.sub}`);
  
  return parts.join(' · ');
}

/** الحصول على مفتاح العمارة من كائن العميل */
export function getBldKeyFromSub(sub) {
  return buildBldKey(sub.gov, sub.region, sub.route, sub.sector, sub.blk, sub.bld);
}

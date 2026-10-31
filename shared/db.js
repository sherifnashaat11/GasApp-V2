/* ============================================================
   shared/db.js - V3 (مرن بالكامل)
   الغرض: إدارة قاعدة البيانات (Dexie.js) مع Migration ذكي
   الجداول: subscribers, movements, meta, profile, archive
============================================================ */

if (typeof window.Dexie === 'undefined') {
  console.error('Dexie.js لم يتم تحميله! يرجى التأكد من إضافته في index.html');
}

export const db = new window.Dexie('GasAppV2_Enterprise');

/* ============================================================
   Schema V3 — مرن + متوافق مع V1
   الحقول المضافة:
   - subscribers: prevReading, months, aptKey, sector|blk|bld (مركبة)
   - movements: source ('route'|'search'), aptKey, period, printed
============================================================ */
db.version(3).stores({
  // subscribers: مفتاح أساسي key + فهارس للبحث والفلترة
  subscribers: 'key, bldKey, aptKey, nameNormalized, inRoute, sector, blk, bld, apt, dueAmount, count, prevReading, months, status',
  
  // movements: حركات (سداد + قراءة) + مصدرها
  movements: '++id, [key+period], key, period, type, source, aptKey, status, date, printed',
  
  // meta: إعدادات عامة (أسعار، فترات، ...)
  meta: 'key',
  
  // profile: بيانات المحصل (اختياري)
  profile: '&empId',
  
  // archive: أرشيف مجمّع (للتصدير)
  archive: '&receiptRef, key, date, source'
}).upgrade(tx => {
  // Migration: إضافة الحقول الناقصة للسجلات القديمة
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
   دوال مساعدة (Helpers)
============================================================ */

/** بناء مفتاح الشقة من القطاع/البلوك/العمارة/الشقة */
export function buildAptKey(sector, blk, bld, apt) {
  const s = String(sector || '').padStart(2, '0');
  const b = String(blk || '').padStart(2, '0');
  const d = String(bld || '').padStart(2, '0');
  const a = String(apt || '').padStart(2, '0');
  return `${s}|${b}|${d}|${a}`;
}

/** بناء مفتاح العمارة */
export function buildBldKey(sector, blk, bld) {
  const s = String(sector || '').padStart(2, '0');
  const b = String(blk || '').padStart(2, '0');
  const d = String(bld || '').padStart(2, '0');
  return `${s}|${b}|${d}`;
}

/** تطبيع الاسم للبحث (إزالة التشكيل + توحيد الحروف) */
export function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\u064B-\u0652]/g, '') // إزالة التشكيل
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ثس]/g, 'س')
    .replace(/[طت]/g, 'ت')
    .replace(/\s+/g, ' ')
    .trim();
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

/** جلب العملاء بلا قراءة هذا الشهر (period محدد) */
export async function getUnreadSubscribers(period) {
  const allSubs = await db.subscribers.toArray();
  const reads = await db.movements
    .where('period').equals(period)
    .filter(m => !!m.reading)
    .toArray();
  const readKeys = new Set(reads.map(r => r.key));
  
  return allSubs.filter(s => 
    Number(s.dueAmount) > 0 && !readKeys.has(s.key)
  );
}

/** البحث بالكود الكامل (16 رقم) */
export async function searchByFullCode(fullCode) {
  // الكود الكامل = sector(2) + blk(2) + bld(2) + apt(2) + ... 
  // هنا نفترض أنه مفتاح الشقة = sector|blk|bld|apt
  const clean = String(fullCode).replace(/\D/g, '');
  if (clean.length < 8) return [];
  const sec = clean.slice(0, 2);
  const blk = clean.slice(2, 4);
  const bld = clean.slice(4, 6);
  const apt = clean.slice(6, 8);
  const aptKey = `${sec}|${blk}|${bld}|${apt}`;
  return db.subscribers.where('aptKey').equals(aptKey).toArray();
}

/** البحث بالاسم داخل نطاق (محافظة+منطقة) */
export async function searchByName(nameQuery, governorate, region) {
  const norm = normalizeName(nameQuery);
  if (!norm) return [];
  const all = await db.subscribers.toArray();
  return all.filter(s => 
    (!governorate || s.gov === governorate) &&
    (!region || s.region === region) &&
    normalizeName(s.name).includes(norm)
  );
}

/** تسجيل سداد (فردي أو جماعي) */
export async function recordPayment({ key, name, amount, count, source = 'route', aptKey = null, period }) {
  const sub = await db.subscribers.get(key);
  if (!sub) throw new Error('العميل غير موجود');
  
  const newDue = Math.max(0, (Number(sub.dueAmount) || 0) - amount);
  const newCount = Math.max(0, (Number(sub.count) || 0) - count);
  
  await db.subscribers.update(key, { dueAmount: newDue, count: newCount });
  
  const move = {
    key, type: 'pay', amount, count,
    date: new Date().toISOString(),
    source, aptKey: aptKey || sub.aptKey,
    period: period || getCurrentPeriod(),
    printed: false,
    status: 'done'
  };
  await db.movements.add(move);
  return move;
}

/** تسجيل قراءة */
export async function recordReading({ key, reading, prevReading, consumption, estimatedInvoice, months, period }) {
  const existing = await db.movements.where({ key, period }).first();
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

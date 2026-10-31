/* ============================================================
   shared/db.js - V3.2
   الغرض: قاعدة البيانات (Dexie) + الكود 16 رقم + النظام المحاسبي
   الجداول: subscribers, movements, meta, profile, archive
   ملاحظة: الرسوم (fees) تُحسب مرة واحدة فقط لكل فاتورة.
============================================================ */

if (typeof window.Dexie === 'undefined') {
  console.error('Dexie.js لم يتم تحميله! يرجى التأكد من إضافته في index.html');
}

export const db = new window.Dexie('GasAppV2_Enterprise');

/* ============================================================
   ثوابت الكود
============================================================ */
export const FIELD_ORDER = ['gov', 'region', 'route', 'sector', 'blk', 'bld', 'apt', 'sub'];
export const FIELD_LABELS = {
  gov: 'محافظة', region: 'منطقة', route: 'يومية', sector: 'قطاع',
  blk: 'بلوك', bld: 'عمارة', apt: 'شقة', sub: 'فرعي'
};
export const DEFAULT_DIGIT_CONFIG = {
  gov: 2, region: 2, route: 2, sector: 2, blk: 2, bld: 2, apt: 2, sub: 2
};
const BLD_FIELDS = FIELD_ORDER.slice(0, 6); // gov..bld

let digitCfg = { ...DEFAULT_DIGIT_CONFIG };

/* ============================================================
   أدوات الأرقام والتاريخ
============================================================ */
const toAscii = (v) => String(v ?? '')
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

const onlyDigits = (v) => toAscii(v).replace(/\D/g, '');

function padField(field, val) {
  const w = digitCfg[field] || 2;
  const s = onlyDigits(val);
  if (!s) return '0'.repeat(w);
  return s.padStart(w, '0').slice(-w);
}

const totalLen = () => FIELD_ORDER.reduce((n, f) => n + (digitCfg[f] || 2), 0);
const bldLen = () => BLD_FIELDS.reduce((n, f) => n + (digitCfg[f] || 2), 0);

/** YYYYMMDDHHMM بالتوقيت المحلي */
export function dateStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ============================================================
   Schema
   v3 = النسخة القديمة (aptKey من 4 أجزاء)  |  v4 = V3.2
============================================================ */
db.version(3).stores({
  subscribers: 'key, bldKey, aptKey, nameNormalized, inRoute, sector, blk, bld, apt, dueAmount, count, prevReading, months, status',
  movements: '++id, [key+period], key, period, type, source, aptKey, status, date, printed',
  meta: 'key',
  profile: '&empId',
  archive: '&receiptRef, key, date, source'
});

db.version(4).stores({
  subscribers: 'key, aptKey, bldKey, nameNormalized, inRoute, gov, region, route, sector, blk, bld, apt, sub, dueAmount, count, prevReading, months, status',
  movements: '++id, [key+period], key, period, type, source, aptKey, receiptRef, status, date, printed',
  meta: 'key',
  profile: '&empId',
  archive: '&receiptRef, key, date, source'
}).upgrade(tx => migrateV4(tx));

/** Migration من V3 إلى V4 (مُصدَّرة للاختبار) */
export async function migrateV4(tx) {
  // 1) المشتركون: تحويل المفتاح إلى 16 رقم + الحقول الجديدة
  const oldSubs = await tx.table('subscribers').toArray();
  const keyMap = new Map();
  const fresh = new Map();
  for (const s of oldSubs) {
    const n = normalizeSubscriber(s);
    keyMap.set(s.key, n.key);
    fresh.set(n.key, n); // المكرر حرفياً يُدمج
  }
  await tx.table('subscribers').clear();
  await tx.table('subscribers').bulkPut([...fresh.values()]);

  // 2) الحركات: مفتاح جديد + نوع + receiptRef + حقول ناقصة
  await tx.table('movements').toCollection().modify(m => {
    const nk = keyMap.get(m.key) || normalizeKeyLoose(m.key);
    m.key = nk;
    m.aptKey = nk;
    if (!m.type) m.type = (m.reading !== undefined && m.reading !== null) ? 'read' : 'pay';
    if (m.source === undefined) m.source = 'route';
    if (m.printed === undefined) m.printed = false;
    if (m.type === 'pay' && !m.receiptRef) m.receiptRef = nk + dateStamp(m.date || new Date());
    if (!m.status) m.status = m.type === 'pay' ? 'done' : 'pending';
  });
}

/* ============================================================
   الكود: بناء / تفكيك / تطبيع
============================================================ */

/** كود الشقة الكامل (16 رقم افتراضياً، بلا فواصل). يقبل 8 وسائط أو كائناً. */
export function buildAptKey(gov, region, route, sector, blk, bld, apt, sub) {
  let v;
  if (gov && typeof gov === 'object') {
    const o = gov;
    v = [o.gov, o.region ?? o.area, o.route ?? o.daily, o.sector, o.blk, o.bld, o.apt, o.sub];
  } else {
    v = [gov, region, route, sector, blk, bld, apt, sub];
  }
  return FIELD_ORDER.map((f, i) => padField(f, v[i])).join('');
}

/** كود العمارة (12 رقم، بلا فواصل) */
export function buildBldKey(gov, region, route, sector, blk, bld) {
  let v;
  if (gov && typeof gov === 'object') {
    const o = gov;
    v = [o.gov, o.region ?? o.area, o.route ?? o.daily, o.sector, o.blk, o.bld];
  } else {
    v = [gov, region, route, sector, blk, bld];
  }
  return BLD_FIELDS.map((f, i) => padField(f, v[i])).join('');
}

/** تفكيك كود كامل إلى أجزائه (null إن لم يكن الطول مطابقاً) */
export function splitCode(code) {
  const c = onlyDigits(code);
  if (c.length !== totalLen()) return null;
  const out = {};
  let pos = 0;
  for (const f of FIELD_ORDER) {
    const w = digitCfg[f] || 2;
    out[f] = c.slice(pos, pos + w);
    pos += w;
  }
  return out;
}

/** مفتاح قديم → 16 رقم (أو يُعاد كما هو إن لم يكن رقمياً) */
function normalizeKeyLoose(k) {
  const raw = String(k ?? '');
  const d = onlyDigits(raw);
  return (d.length === totalLen() && !/[A-Za-z_]/.test(raw)) ? d : raw;
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

/**
 * تحويل أي سجل مشترك (قديم أو من الاستيراد) إلى الشكل الجديد.
 * - المفتاح 20-06-02-02-31-02-02-00 → 2006020231020200
 * - area → region ، daily → route ، sub الافتراضي 00
 */
export function normalizeSubscriber(s) {
  const rawKey = String(s.key ?? '');
  let parts = null;
  if (!/[A-Za-z_]/.test(rawKey)) parts = splitCode(rawKey);
  if (!parts) {
    parts = {
      gov: padField('gov', s.gov),
      region: padField('region', s.region ?? s.area),
      route: padField('route', s.route ?? s.daily ?? s.sector),
      sector: padField('sector', s.sector),
      blk: padField('blk', s.blk),
      bld: padField('bld', s.bld),
      apt: padField('apt', s.apt),
      sub: padField('sub', s.sub ?? '00')
    };
  }
  const key = FIELD_ORDER.map(f => parts[f]).join('');
  const { area, daily, ...rest } = s;
  return {
    ...rest,
    ...parts,
    key,
    aptKey: key,
    bldKey: key.slice(0, bldLen()),
    nameNormalized: normalizeName(s.name),
    inRoute: s.inRoute === undefined ? 1 : (s.inRoute ? 1 : 0),
    dueAmount: Number(s.dueAmount) || 0,
    count: Number(s.count) || 0,
    prevReading: Number(s.prevReading) || 0,
    months: Number(s.months) || 1,
    status: s.status || 'active'
  };
}

/* ============================================================
   الإعدادات (meta / profile) + ذاكرة مؤقتة متزامنة
============================================================ */
let _prices = null;
let _fees = 18;

async function metaGet(key, fallback) {
  const r = await db.meta.get(key);
  return r && r.value !== undefined ? r.value : fallback;
}
const metaSet = (key, value) => db.meta.put({ key, value });

export async function getDigitConfig() {
  const saved = await metaGet('digitConfig', null);
  digitCfg = { ...DEFAULT_DIGIT_CONFIG, ...(saved || {}) };
  return { ...digitCfg };
}
export async function setDigitConfig(config) {
  const next = { ...DEFAULT_DIGIT_CONFIG };
  for (const f of FIELD_ORDER) {
    const n = Number(config?.[f]);
    if (Number.isInteger(n) && n >= 1 && n <= 6) next[f] = n;
  }
  digitCfg = next;
  await metaSet('digitConfig', next);
  return { ...next };
}

/* ---- خط السير ---- */
const LOR_ID = 'local';
export async function getLineOfRoute() {
  const p = await db.profile.get(LOR_ID);
  if (p && p.lineOfRoute) return p.lineOfRoute;
  try {
    const ls = JSON.parse(localStorage.getItem('app-line-of-route') || 'null');
    if (ls && ls.gov) return ls;
  } catch (e) { /* تجاهل */ }
  return null;
}
export async function setLineOfRoute(route) {
  const lor = {
    gov: padField('gov', route?.gov),
    region: padField('region', route?.region),
    route: padField('route', route?.route),
    sub: padField('sub', route?.sub ?? '00')
  };
  const p = (await db.profile.get(LOR_ID)) || { empId: LOR_ID };
  p.lineOfRoute = lor;
  await db.profile.put(p);
  try { localStorage.setItem('app-line-of-route', JSON.stringify(lor)); } catch (e) { /* تجاهل */ }
  return lor;
}
/** استنتاج خط السير من البيانات (الأكثر تكراراً) */
export async function inferLineOfRoute() {
  const subs = await db.subscribers.limit(500).toArray();
  if (!subs.length) return null;
  const top = (f) => {
    const c = new Map();
    subs.forEach(s => c.set(s[f], (c.get(s[f]) || 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  return { gov: top('gov'), region: top('region'), route: top('route'), sub: top('sub') };
}

/* ---- خرائط الترجمة اسم↔رقم (تُخزَّن {رقم: اسم}) ---- */
export const getGovMap = () => metaGet('govMap', {});
export const getRegionMap = () => metaGet('regionMap', {});
export async function setGovMap(map) { await metaSet('govMap', map || {}); return map; }
export async function setRegionMap(map) { await metaSet('regionMap', map || {}); return map; }

/** إدخال (اسم أو رقم) → رقم الخانة. يرجع '' إن لم يُعرف. */
export function resolveCode(input, map, field) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (/^[0-9٠-٩۰-۹]+$/.test(raw)) return padField(field, raw);
  const n = normalizeName(raw);
  for (const [code, name] of Object.entries(map || {})) {
    if (normalizeName(name) === n) return code;
  }
  for (const [code, name] of Object.entries(map || {})) {
    if (normalizeName(name).includes(n)) return code;
  }
  return '';
}

/** قيم مميزة لحقل مفهرس (مثل gov) */
export async function listDistinct(field, filterFn) {
  if (!filterFn) return (await db.subscribers.orderBy(field).uniqueKeys()).map(String);
  const set = new Set();
  await db.subscribers.filter(filterFn).each(s => set.add(s[field]));
  return [...set].sort();
}

/* ============================================================
   الأسعار والرسوم (Time-Series) — منسوخة من الحاسبة
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

const sortPeriods = (ps) => [...ps].sort((a, b) => String(a.date).localeCompare(String(b.date)));
_prices = sortPeriods(DEFAULT_PERIODS);

export async function getPrices() {
  const saved = await metaGet('prices', null);
  _prices = sortPeriods(Array.isArray(saved) && saved.length ? saved : DEFAULT_PERIODS);
  return _prices;
}
export async function setPrices(periods) {
  if (!Array.isArray(periods) || !periods.length) throw new Error('قائمة الأسعار فارغة');
  periods.forEach(p => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error('تاريخ فترة غير صالح: ' + p.date);
    if (!Array.isArray(p.tiers) || !p.tiers.length) throw new Error('الفترة بلا شرائح: ' + p.date);
  });
  _prices = sortPeriods(periods);
  await metaSet('prices', _prices);
  return _prices;
}
export async function getFees() {
  _fees = Number(await metaGet('fees', 18));
  return _fees;
}
export async function setFees(fees) {
  const n = Number(fees);
  if (!(n >= 0)) throw new Error('قيمة الرسوم غير صالحة');
  _fees = n;
  await metaSet('fees', n);
  return n;
}

/** تحميل كل الإعدادات في الذاكرة (يُستدعى مرة عند البدء) */
export async function initDb() {
  await db.open();
  await getDigitConfig();
  await getPrices();
  await getFees();
}

/** شرائح الفترة السارية في تاريخ معيّن (YYYY-MM-DD أو YYYY-MM) */
export function getPriceForPeriod(dateStr, periods = _prices) {
  let d = String(dateStr || '');
  if (/^\d{4}-\d{2}$/.test(d)) d += '-01';
  const list = sortPeriods(periods && periods.length ? periods : DEFAULT_PERIODS);
  let chosen = list[0];
  for (const p of list) { if (p.date <= d) chosen = p; else break; }
  return chosen.tiers;
}

/** تكلفة شهر واحد بحسب الشرائح التراكمية */
export function monthlyCostDetailed(cons, tiers) {
  let remaining = Math.max(0, Number(cons) || 0);
  let prevLimit = 0, cost = 0;
  const rows = [];
  for (const t of tiers) {
    if (remaining <= 0) break;
    const cap = t.limit === null || t.limit === undefined ? remaining : Math.max(0, t.limit - prevLimit);
    const qty = Math.min(remaining, cap);
    if (qty > 0) {
      const c = qty * t.price;
      cost += c;
      rows.push({ name: t.name, from: prevLimit, to: prevLimit + qty, qty, price: t.price, cost: c });
    }
    remaining -= qty;
    if (t.limit !== null && t.limit !== undefined) prevLimit = t.limit; else prevLimit += qty;
  }
  return { cost, rows };
}

/** أشهر المحاسبة (من الأقدم للأحدث) تنتهي بالفترة period */
function monthsRange(endPeriod, months) {
  const [y, m] = endPeriod.split('-').map(Number);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * الفاتورة القادمة: شهراً بشهر حسب سعر كل فترة + الرسوم مرة واحدة.
 * متوسط الاستهلاك الشهري = الاستهلاك الكلي ÷ أشهر المحاسبة.
 */
export function calcNextInvoice({ reading, prevReading, months = 1, fees, periods, period } = {}) {
  const m = Math.max(1, Math.floor(Number(months) || 1));
  const cons = Math.max(0, (Number(reading) || 0) - (Number(prevReading) || 0));
  const avg = cons / m;
  const f = Number(fees ?? _fees) || 0;
  const list = monthsRange(period || getCurrentPeriod(), m);

  let totalConsumptionCost = 0;
  const rows = list.map(p => {
    const tiers = getPriceForPeriod(p + '-01', periods || _prices);
    const d = monthlyCostDetailed(avg, tiers);
    totalConsumptionCost += d.cost;
    return { month: p, avg, cost: d.cost, tiers: d.rows };
  });

  const exactGrandTotal = totalConsumptionCost + f; // الرسوم مرة واحدة
  const grandTotal = Math.round(exactGrandTotal);
  return {
    cons, avg, months: m, totalConsumptionCost, fees: f,
    exactGrandTotal, grandTotal, rows,
    words: numberToArabicWords(grandTotal)
  };
}

/* ============================================================
   التفقيط العربي
============================================================ */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function below1000(n) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const u = r % 10, t = Math.floor(r / 10);
      parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

function scaleWord(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${below1000(n)} ${few}`;
  const r = n % 100;
  if (n >= 100 && (r === 0 || r === 1 || r === 2)) return `${below1000(n)} ${one}`;
  if (n >= 100 && r >= 3 && r <= 10) return `${below1000(n)} ${few}`;
  return `${below1000(n)} ${many}`;
}

export function numberToArabicWords(num) {
  let n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return 'صفر';
  const parts = [];
  const billions = Math.floor(n / 1e9); n %= 1e9;
  const millions = Math.floor(n / 1e6); n %= 1e6;
  const thousands = Math.floor(n / 1e3); n %= 1e3;
  if (billions) parts.push(scaleWord(billions, 'مليار', 'ملياران', 'مليارات', 'مليار'));
  if (millions) parts.push(scaleWord(millions, 'مليون', 'مليونان', 'ملايين', 'مليوناً'));
  if (thousands) parts.push(scaleWord(thousands, 'ألف', 'ألفان', 'آلاف', 'ألفاً'));
  if (n) parts.push(below1000(n));
  return parts.join(' و');
}

/* ============================================================
   الفترة والإحصائيات
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

/* ============================================================
   البحث والاستعلام
============================================================ */

/** البحث بالكود: 16 رقم → الشقة ، 12 رقم → العمارة كاملة */
export async function searchByFullCode(code) {
  const c = onlyDigits(code);
  if (c.length >= totalLen()) return db.subscribers.where('aptKey').equals(c.slice(0, totalLen())).toArray();
  if (c.length >= bldLen()) return db.subscribers.where('bldKey').equals(c.slice(0, bldLen())).toArray();
  return [];
}

/** البحث بالاسم — فلترة إلزامية (محافظة + منطقة) بالاسم أو الرقم */
export async function searchByName(nameQuery, gov, region) {
  const norm = normalizeName(nameQuery);
  if (!norm || !gov || !region) return [];
  const [govMap, regionMap] = await Promise.all([getGovMap(), getRegionMap()]);
  const g = resolveCode(gov, govMap, 'gov');
  const r = resolveCode(region, regionMap, 'region');
  if (!g || !r) return [];
  const words = norm.split(' ');
  return db.subscribers.where('gov').equals(g)
    .filter(s => s.region === r && words.every(w => (s.nameNormalized || normalizeName(s.name)).includes(w)))
    .limit(200).toArray();
}

/** عمارة كاملة مع حركاتها (آخر حركة + حالة السداد) */
export async function getBuildingWithMovements(bldKey) {
  const subs = await db.subscribers.where('bldKey').equals(bldKey).toArray();
  const keys = subs.map(s => s.key);
  const moves = keys.length ? await db.movements.where('key').anyOf(keys).toArray() : [];
  moves.sort((a, b) => new Date(a.date) - new Date(b.date));
  const latest = new Map(), lastPay = new Map();
  moves.forEach(m => {
    latest.set(m.key, m);
    if (m.type === 'pay') lastPay.set(m.key, m);
  });
  return subs
    .map(s => ({ ...s, movement: latest.get(s.key) || null, lastPay: lastPay.get(s.key) || null }))
    .sort((a, b) => String(a.apt + a.sub).localeCompare(String(b.apt + b.sub)));
}

/** قراءة هذا الشهر لعميل (إن وُجدت) */
export async function getReadingForPeriod(key, period = getCurrentPeriod()) {
  return db.movements.where('[key+period]').equals([key, period]).filter(m => m.type === 'read').first();
}

/** العملاء بلا قراءة في الفترة (مع مديونية) — اختيارياً ضمن خط السير */
export async function getUnreadSubscribers(period, lineOfRoute = null) {
  const reads = await db.movements.where('period').equals(period).filter(m => m.type === 'read').toArray();
  const readKeys = new Set(reads.map(r => r.key));
  let coll = lineOfRoute
    ? db.subscribers.where('gov').equals(lineOfRoute.gov).filter(s => s.region === lineOfRoute.region && s.route === lineOfRoute.route)
    : db.subscribers.toCollection();
  const subs = await coll.toArray();
  return subs.filter(s => Number(s.dueAmount) > 0 && !readKeys.has(s.key));
}

/* ============================================================
   العمليات: سداد / قراءة / ترحيل الفواتير
============================================================ */

/** تسجيل سداد. receiptRef = كود العميل + YYYYMMDDHHMM (28 رقم) */
export async function recordPayment({ key, name, amount, count, source = 'route', aptKey = null, period }) {
  amount = Number(amount); count = Number(count) || 0;
  if (!(amount > 0)) throw new Error('قيمة السداد غير صالحة');

  return db.transaction('rw', db.subscribers, db.movements, async () => {
    const sub = await db.subscribers.get(key);
    if (!sub) throw new Error('العميل غير موجود');
    const due = Number(sub.dueAmount) || 0;
    if (amount > due) throw new Error('المبلغ أكبر من المديونية');

    const newDue = Math.max(0, due - amount);
    const newCount = newDue === 0 ? 0 : Math.max(0, (Number(sub.count) || 0) - count);
    await db.subscribers.update(key, { dueAmount: newDue, count: newCount });

    // receiptRef فريد: إن تكرر في نفس الدقيقة نزيد دقيقة
    let when = new Date();
    let ref = key + dateStamp(when);
    while (await db.movements.where('receiptRef').equals(ref).count()) {
      when = new Date(when.getTime() + 60000);
      ref = key + dateStamp(when);
    }

    const move = {
      key, name: name || sub.name, type: 'pay', amount, count,
      date: new Date().toISOString(),
      source, aptKey: aptKey || sub.aptKey || key, bldKey: sub.bldKey,
      period: period || getCurrentPeriod(),
      receiptRef: ref, printed: false, status: 'done',
      partial: newDue > 0
    };
    move.id = await db.movements.add(move);
    return move;
  });
}

/** تسجيل/تعديل قراءة الفترة (status = pending حتى بداية الشهر التالي) */
export async function recordReading({ key, reading, prevReading, consumption, estimatedInvoice, months, period, invoice = null, source = 'route' }) {
  period = period || getCurrentPeriod();
  const existing = await db.movements.where('[key+period]').equals([key, period]).filter(m => m.type === 'read').first();
  const data = {
    key, type: 'read', reading, prevReading, consumption,
    estimatedInvoice, months,
    invoice,                     // تفصيل شهري (اختياري) للأرشيف
    date: new Date().toISOString(),
    period, source, aptKey: key,
    printed: false,
    status: 'pending'
  };
  if (existing) {
    if (existing.status === 'billed') throw new Error('هذه القراءة رُحِّلت للمديونية ولا يمكن تعديلها');
    await db.movements.update(existing.id, data);
    return existing.id;
  }
  return db.movements.add(data);
}

/**
 * عند بداية شهر جديد: كل قراءة pending من فترة سابقة → billed
 * وتُضاف قيمتها للمديونية، وتصبح القراءة الحالية هي السابقة.
 */
export async function billPendingReadings() {
  const cur = getCurrentPeriod();
  return db.transaction('rw', db.subscribers, db.movements, async () => {
    const pend = (await db.movements.where('status').equals('pending')
      .filter(m => m.type === 'read' && m.period < cur).toArray())
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
    let n = 0;
    for (const m of pend) {
      const sub = await db.subscribers.get(m.key);
      if (!sub) continue;
      await db.subscribers.update(m.key, {
        dueAmount: (Number(sub.dueAmount) || 0) + (Number(m.estimatedInvoice) || 0),
        count: (Number(sub.count) || 0) + 1,
        prevReading: Number(m.reading) || 0,
        months: 1
      });
      await db.movements.update(m.id, { status: 'billed', billedAt: new Date().toISOString() });
      n++;
    }
    return n;
  });
}

/* ============================================================
   العرض
============================================================ */

/**
 * رقم المشترك المختصر: يُخفي الثوابت (خط السير) ويُظهر المتغيرات.
 * مثال: «بلوك 27 · عمارة 20 · شقة 07». لا يُعرض الكود الكامل أبداً.
 * opts.withSector لإظهار القطاع.
 */
export function formatSubscriberRef(sub, lineOfRoute = null, opts = {}) {
  if (!sub) return '';
  const parts = [];
  const lor = lineOfRoute || {};
  if (lor.gov !== undefined && sub.gov !== lor.gov) parts.push(`${FIELD_LABELS.gov} ${sub.gov}`);
  if (lor.region !== undefined && sub.region !== lor.region) parts.push(`${FIELD_LABELS.region} ${sub.region}`);
  if (lor.route !== undefined && sub.route !== lor.route) parts.push(`${FIELD_LABELS.route} ${sub.route}`);
  if (!lineOfRoute) { // بلا خط سير: اعرض ما يميّز الموقع كاملاً
    if (!parts.length) parts.push(`${FIELD_LABELS.gov} ${sub.gov}`, `${FIELD_LABELS.region} ${sub.region}`, `${FIELD_LABELS.route} ${sub.route}`);
  }
  if (opts.withSector) parts.push(`${FIELD_LABELS.sector} ${sub.sector}`);
  parts.push(`${FIELD_LABELS.blk} ${sub.blk}`, `${FIELD_LABELS.bld} ${sub.bld}`, `${FIELD_LABELS.apt} ${sub.apt}`);
  if (sub.sub && sub.sub !== '00') parts.push(`${FIELD_LABELS.sub} ${sub.sub}`);
  return parts.join(' · ');
}

/* ============================================================
   shared/db.js
   الغرض: إدارة قاعدة البيانات (Dexie.js) - 5 جداول
============================================================ */

if (typeof window.Dexie === 'undefined') {
  console.error('Dexie.js لم يتم تحميله! يرجى التأكد من إضافته في index.html');
}

export const db = new window.Dexie('GasAppV2_Enterprise');

db.version(1).stores({
  // أضفنا dueAmount و count لجدول العملاء
  subscribers: 'key, bldKey, nameNormalized, inRoute, sector, blk, bld, apt, dueAmount, count',
  movements: '++id, [key+period], key, period, status',
  meta: 'key',
  profile: '&empId',
  archive: '&receiptRef, key, date'
});

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

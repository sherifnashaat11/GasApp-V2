if (typeof window.Dexie === 'undefined') {
  console.error('Dexie.js لم يتم تحميله!');
}

export const db = new window.Dexie('GasAppV2_Enterprise');

db.version(1).stores({
  \\subscribers: 'key, bldKey, nameNormalized, inRoute, sector, blk, bld, apt',
  subscribers: 'key, bldKey, nameNormalized, inRoute, sector, blk, bld, apt, dueAmount, count',
  movements: '++id, key, period, reading, prevReading, status',
  meta: 'key',
  profile: '&empId',
  archive: '&receiptRef, key, date'
});

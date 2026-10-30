const pad2 = (val) => {
  if (val === undefined || val === null) return '00';
  const str = String(val).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  if (!/^\d+$/.test(str)) return '00';
  return str.padStart(2, '0').slice(-2);
};

export function generateKey(data) {
  return `${pad2(data.gov)}${pad2(data.area)}${pad2(data.daily || data.sector)}${pad2(data.sector)}${pad2(data.blk)}${pad2(data.bld)}${pad2(data.apt)}${pad2(data.sub || '00')}`;
}

export function parseKey(key) {
  const k = String(key).padStart(16, '0');
  return {
    gov: k.slice(0, 2), area: k.slice(2, 4), daily: k.slice(4, 6), sector: k.slice(6, 8),
    blk: k.slice(8, 10), bld: k.slice(10, 12), apt: k.slice(12, 14), sub: k.slice(14, 16), full: k
  };
}

export function getBuildingKey(sector, blk, bld) {
  return `${pad2(sector)}${pad2(blk)}${pad2(bld)}`;
}
import { db } from '../shared/db.js';

const SECRET_KEY = 'GasApp_V2_Ultimate_Secret_2026!';

async function getCryptoKey() {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(SECRET_KEY), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('gas_salt_123'), iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function decompress(arrayBuffer) {
  // التحقق من دعم الموبايل لهذه الميزة
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('متصفح الموبايل لا يدعم فك الضغط (DecompressionStream). يرجى التحديث أو استخدام متصفح آخر.');
  }
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function importFromServer(onProgress = () => {}) {
  try {
    onProgress('جارٍ تحميل الملف...');
    const response = await fetch('../downloads/full.bin');
    if (!response.ok) throw new Error('الملف غير موجود في السيرفر');
    
    onProgress('جارٍ فك التشفير...');
    const combined = new Uint8Array(await response.arrayBuffer());
    
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    const key = await getCryptoKey();
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    
    onProgress('جارٍ فك الضغط...');
    const jsonText = await decompress(decryptedBuffer);
    const fullData = JSON.parse(jsonText);
    
    onProgress(`تم العثور على ${fullData.subscribers.length} عميل. جارٍ الحفظ...`);
    
    const BATCH_SIZE = 5000;
    for (let i = 0; i < fullData.subscribers.length; i += BATCH_SIZE) {
      const batch = fullData.subscribers.slice(i, i + BATCH_SIZE);
      await db.subscribers.bulkPut(batch);
      onProgress(`تم حفظ ${Math.min(i + BATCH_SIZE, fullData.subscribers.length)}...`);
    }
    
    await db.meta.put({ key: 'lastImport', value: new Date().toISOString() });
    onProgress('تم الاستيراد بنجاح!');
    return { success: true, count: fullData.subscribers.length };
  } catch (error) {
    console.error('تفاصيل الخطأ:', error);
    // إظهار الخطأ بوضوح على الموبايل
    alert('سبب الفشل: ' + error.message);
    throw new Error('فشل الاستيراد: ' + error.message);
  }
}

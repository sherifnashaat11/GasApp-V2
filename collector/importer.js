import { db } from '../shared/db.js';

export async function importFromServer(onProgress = () => {}) {
  try {
    onProgress('جارٍ تحميل الملف...');
    // جلب الملف من المجلد المحلي على GitHub
    const response = await fetch('../downloads/full.bin');
    if (!response.ok) throw new Error('الملف غير موجود');
    
    const fullData = await response.json();
    onProgress(`تم العثور على ${fullData.subscribers.length} عميل. جارٍ الحفظ...`);
    
    const BATCH_SIZE = 5000;
    for (let i = 0; i < fullData.subscribers.length; i += BATCH_SIZE) {
      const batch = fullData.subscribers.slice(i, i + BATCH_SIZE);
      await db.subscribers.bulkPut(batch);
      onProgress(`تم حفظ ${Math.min(i + BATCH_SIZE, fullData.subscribers.length)}...`);
    }
    onProgress('تم الاستيراد بنجاح!');
    return { success: true, count: fullData.subscribers.length };
  } catch (error) {
    throw new Error('فشل: ' + error.message);
  }
}
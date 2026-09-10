// ============================================================
// برق — عميل Supabase المشترك
// نفس SB_URL المستخدم دايمًا. SB_KEY كان الـ anon key القديم (JWT) — ده
// كان مكشوف فترة طويلة في الريبو العام على GitHub، فاتغيّر لمفتاح جديد
// (publishable key) لسه ما اتشافش في أي مكان، بديل مباشر لنفس الغرض.
// المفتاح القديم لازم يتقفل (Disable) من Supabase Dashboard → Settings →
// API Keys بعد ما نتأكد إن التطبيق شغال بالجديد كويس.
// ============================================================

var SB_URL = 'https://ojvbydnvywbsgyhqftap.supabase.co';
var SB_KEY = 'sb_publishable_5xjA7HDzuEU7hq16mYSonQ_k8cIKr-K';
var SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

/**
 * sb(path, options) — نداء REST مباشر لنفس مشروع Supabase المستخدم في الملفات الحالية.
 * path: مثال 'branch_orders?select=*&status=eq.pending'
 * options: نفس معايير fetch (method, body, headers إضافية)
 */
function sb(path, options) {
  options = options || {};
  var headers = Object.assign({}, SB_HEADERS, options.headers || {});
  return fetch(SB_URL + '/rest/v1/' + path, Object.assign({}, options, { headers: headers }))
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Supabase error ' + res.status + ': ' + t);
        });
      }
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') !== -1 ? res.json() : res.text();
    });
}

// دالة مساعدة لاستدعاء RPC / Edge Functions بنفس الهيدرز
function sbFunction(fnPath, options) {
  options = options || {};
  var headers = Object.assign({}, SB_HEADERS, options.headers || {});
  return fetch(SB_URL + '/functions/v1/' + fnPath, Object.assign({}, options, { headers: headers }))
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Supabase function error ' + res.status + ': ' + t);
        });
      }
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') !== -1 ? res.json() : res.text();
    });
}

// ============================================================
// برق — موديول "تسعير" و"مالية"
// منقول من tas3eer_v3_proto.html بنفس المنطق حرفيًا. الملف ده أصلًا
// تطبيق واحد متعدد الأدوار (pricing/finance/finmgr/purchmgr/receiving/ceo)
// وشاشته بتتغيّر تلقائيًا حسب الدور (renderMain() بتفرّع بالدور، مش بالقسم)
// — فبيتسجل هنا كموديول واحد تحت قسمَي "تسعير" و"مالية" في القائمة
// الجانبية، والدور اللي دخل بيه المستخدم فعليًا هو اللي بيحدد الشاشة
// الظاهرة (بالظبط زي السلوك الأصلي، لكن بدل ما يختار الدور من شاشة دخول
// داخلية، بياخده جاهز من BARQ_AUTH).
// التعديل الوحيد: (1) IIFE باسم BARQ_TAS، (2) syncFromShellAuth() +
// mount() بدل شاشة الدخول الداخلية، (3) doLogout() بيرجع للشاشة الموحّدة.
// ============================================================

var BARQ_TAS = (function () {
// ═══════════════════════════════════════════════
// SUPABASE CONNECTION
// ═══════════════════════════════════════════════
var SB_URL = 'https://ojvbydnvywbsgyhqftap.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qdmJ5ZG52eXdic2d5aHFmdGFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzODQyMDcsImV4cCI6MjA5Njk2MDIwN30.3UyyKGcmehGVxadPotOgwYF6CmDbkdb8gw7BFxlYFcU';
var SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};
var SB_CONNECTED = false;
var CONN_STATE = 'connecting'; // online | weak | offline | syncing | connecting

// ═══════════════════════════════════════════════
// OFFLINE-FIRST SYNC ENGINE — عمليات كاملة + UUID + طابور + أولوية + Backoff
// ═══════════════════════════════════════════════
var OFFLINE_QUEUE = [];   // كل عنصر = عملية كاملة (Operation) وليس مجرد طلب HTTP
var IS_SYNCING = false;
var SYNC_BACKOFF_MS = 20000;      // يبدأ بـ 20 ثانية ويتضاعف عند الفشل المتكرر
var SYNC_BACKOFF_MAX = 160000;    // حد أقصى 160 ثانية
var SYNC_TIMER = null;
var SYNC_PROGRESS = null;         // {done, total} أثناء الرفع

// أولوية أنواع العمليات — الأهم يترفع أولاً
var OP_PRIORITY = {
  'اعتماد_استلام':1, 'رفض_استلام':1, 'اعتماد_سعر':2, 'رفض_سعر':2, 'تعليق_سعر':2,
  'تحديث_مورد':3, 'دفعة_مورد':3, 'مرتجع_مورد':3, 'رصيد_افتتاحي':3,
  'تحديث_منتج':4, 'ملاحظة':5, 'سجل_نشاط':6
};

function genUUID() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r = Math.random()*16|0, v = c=='x'?r:(r&0x3|0x8); return v.toString(16);
  });
}

// ── تشفير محلي خفيف (Web Crypto AES-GCM) ──
// ملحوظة أمانة: المفتاح مخزّن في نفس الجهاز عشان التطبيق يقدر يفك التشفير بنفسه بدون سيرفر.
// هذا يحمي من قراءة عرضية للبيانات (فتح ملفات المتصفح) لكنه لا يعادل تشفيراً من جهة سيرفر خارجي.
var _cryptoKeyPromise = null;
async function getLocalCryptoKey() {
  if (_cryptoKeyPromise) return _cryptoKeyPromise;
  _cryptoKeyPromise = (async function(){
    var stored = localStorage.getItem('barq_local_key');
    var rawKey;
    if (stored) {
      rawKey = Uint8Array.from(atob(stored), function(c){return c.charCodeAt(0);});
    } else {
      rawKey = crypto.getRandomValues(new Uint8Array(32));
      localStorage.setItem('barq_local_key', btoa(String.fromCharCode.apply(null, rawKey)));
    }
    return crypto.subtle.importKey('raw', rawKey, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
  })();
  return _cryptoKeyPromise;
}

async function encryptLocal(obj) {
  try {
    var key = await getLocalCryptoKey();
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = new TextEncoder().encode(JSON.stringify(obj));
    var cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, key, data);
    return JSON.stringify({ iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) });
  } catch(e) { return JSON.stringify(obj); } // fallback بدون تشفير لو المتصفح مش داعم
}

async function decryptLocal(str) {
  try {
    var parsed = JSON.parse(str);
    if (!parsed.iv || !parsed.data) return parsed; // بيانات قديمة غير مشفرة
    var key = await getLocalCryptoKey();
    var iv = new Uint8Array(parsed.iv);
    var data = new Uint8Array(parsed.data);
    var plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:iv}, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch(e) {
    try { return JSON.parse(str); } catch(e2) { return null; }
  }
}

async function loadOfflineQueue() {
  try {
    var raw = localStorage.getItem('barq_offline_queue_v2');
    if (!raw) { OFFLINE_QUEUE = []; return; }
    var decrypted = await decryptLocal(raw);
    OFFLINE_QUEUE = decrypted || [];
  } catch(e) { OFFLINE_QUEUE = []; }
}

async function saveOfflineQueue() {
  try {
    var enc = await encryptLocal(OFFLINE_QUEUE);
    localStorage.setItem('barq_offline_queue_v2', enc);
  } catch(e){}
}

// ── إنشاء عملية جديدة (Operation) في الطابور ──
// opType: نوع منطقي للعملية (زي 'اعتماد_استلام') — يُستخدم للأولوية والعرض
// table/method/path/body: تفاصيل تنفيذ الكتابة الفعلية على Supabase
// parentUuid: لو العملية دي معتمدة على عملية تانية لسه ملهاش وجود على السيرفر
function createOperation(opType, table, method, path, body, parentUuid, meta) {
  return {
    uuid: genUUID(),
    opType: opType,
    priority: OP_PRIORITY[opType] || 9,
    table: table, method: method, path: path, body: body,
    headers: (meta&&meta.headers) || {},
    user: (role && ROLES[role]) ? ROLES[role].label : '—',
    device: (navigator.userAgent||'').slice(0,80),
    createdAt: new Date().toISOString(),
    status: 'pending', // pending | syncing | synced | failed
    retryCount: 0,
    lastError: null,
    lastAttempt: null,
    parentUuid: parentUuid || null,
    label: (meta&&meta.label) || opType,
    beforeData: (meta&&meta.beforeData) || null,
    afterData: (meta&&meta.afterData) || null
  };
}

// كتابة آمنة Offline-First — أي كتابة في النظام تمر من هنا
async function sbWrite(path, opts, queueMeta) {
  opts = opts || {};
  queueMeta = queueMeta || {};
  var opType = queueMeta.opType || 'عملية';
  var table = (path.split('?')[0]) || '';

  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    var result = await sbFetch(path, opts);
    logAuditSync(opType, 'synced', queueMeta.label);
    return { ok:true, data:result, queued:false, uuid:null };
  } catch(e) {
    var op = createOperation(opType, table, (opts.method||'POST'), path, opts.body||null, queueMeta.parentUuid, queueMeta);
    OFFLINE_QUEUE.push(op);
    await saveOfflineQueue();
    updateOfflineIndicator();
    scheduleSyncRetry();
    return { ok:false, data:null, queued:true, uuid:op.uuid };
  }
}

function logAuditSync(opType, status, label) {
  // تسجيل خفيف بدون حجب الواجهة — يفيد في سجل التدقيق النهائي
}

// ── محرك المزامنة: أولوية + تسلسل الاعتماد (Parent/Child) + Exponential Backoff ──
async function syncOfflineQueue() {
  if (IS_SYNCING || !OFFLINE_QUEUE.length || !navigator.onLine) return;
  IS_SYNCING = true;
  CONN_STATE = 'syncing';
  updateConnBadge();

  // ترتيب حسب الأولوية، ثم حسب وقت الإنشاء (الأقدم أولاً)
  var queue = OFFLINE_QUEUE.filter(function(o){ return o.status!=='synced'; })
    .sort(function(a,b){
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

  SYNC_PROGRESS = { done:0, total:queue.length };
  var succeeded = 0, failed = 0;

  for (var i=0; i<queue.length; i++) {
    var op = queue[i];

    // لا تحاول تنفيذ عملية Child قبل ما الـ Parent بتاعها يخلص بنجاح
    if (op.parentUuid) {
      var parent = OFFLINE_QUEUE.find(function(x){ return x.uuid===op.parentUuid; });
      if (parent && parent.status !== 'synced') { continue; } // نأجلها للدورة الجاية
    }

    op.status = 'syncing';
    op.lastAttempt = new Date().toISOString();
    SYNC_PROGRESS.done = i;
    render(); // تحديث شريط التقدم لو ظاهر

    try {
      await sbFetch(op.path, { method:op.method, body:op.body, headers:op.headers });
      op.status = 'synced';
      op.lastError = null;
      succeeded++;
    } catch(e) {
      op.status = 'failed';
      op.retryCount = (op.retryCount||0) + 1;
      op.lastError = (e.message||'خطأ غير معروف').slice(0,200);
      failed++;
    }
  }

  // نحتفظ بالعمليات غير المتزامنة فقط (نظّف المتزامن بنجاح بعد شوية عشان يبان في السجل مؤقتاً)
  OFFLINE_QUEUE = OFFLINE_QUEUE.filter(function(o){ return o.status !== 'synced'; });
  await saveOfflineQueue();

  IS_SYNCING = false;
  SYNC_PROGRESS = null;
  CONN_STATE = navigator.onLine ? 'online' : 'offline';
  updateOfflineIndicator();
  updateConnBadge();

  if (succeeded > 0) {
    toast('✅ تمت مزامنة '+succeeded+' عملية'+(failed?' — ⚠️ '+failed+' فشلت وستُعاد المحاولة':''));
    SYNC_BACKOFF_MS = 20000; // reset بعد نجاح
    try { localStorage.setItem('barq_last_sync_time', new Date().toISOString()); } catch(e){}
    if (role) loadFromSupabase();
  }
  if (failed > 0 && succeeded === 0) {
    SYNC_BACKOFF_MS = Math.min(SYNC_BACKOFF_MS * 2, SYNC_BACKOFF_MAX); // Exponential Backoff
    scheduleSyncRetry();
  }
  render();
}

function scheduleSyncRetry() {
  if (SYNC_TIMER) clearTimeout(SYNC_TIMER);
  SYNC_TIMER = setTimeout(function(){ syncOfflineQueue(); }, SYNC_BACKOFF_MS);
}

async function retryFailedOperation(uuid) {
  var op = OFFLINE_QUEUE.find(function(o){ return o.uuid===uuid; });
  if (!op) return;
  op.status = 'pending';
  op.retryCount = 0;
  await saveOfflineQueue();
  syncOfflineQueue();
}

async function deleteFailedOperation(uuid) {
  if (!confirm('حذف العملية دي نهائياً من الطابور؟ لن تُرفع للسيرفر أبداً.')) return;
  OFFLINE_QUEUE = OFFLINE_QUEUE.filter(function(o){ return o.uuid!==uuid; });
  await saveOfflineQueue();
  updateOfflineIndicator();
  render();
}

function updateOfflineIndicator() {
  var el = document.getElementById('offline-indicator');
  if (!el) return;
  var pending = OFFLINE_QUEUE.filter(function(o){return o.status!=='synced';}).length;
  if (pending > 0) {
    el.style.display = 'inline-flex';
    el.textContent = '📴 '+pending+' عملية بالانتظار';
  } else {
    el.style.display = 'none';
  }
}

// ── مؤشر جودة الاتصال: 🟢 متصل / 🟡 ضعيف / 🔴 غير متصل / 🔄 مزامنة ──
function updateConnBadge() {
  var map = {
    online:   { icon:'🟢', label:'متصل',        color:'#1a7a40' },
    weak:     { icon:'🟡', label:'اتصال ضعيف',   color:'#d68910' },
    offline:  { icon:'🔴', label:'غير متصل',      color:'#c0392b' },
    syncing:  { icon:'🔄', label:'جاري المزامنة', color:'#1a5276' },
    connecting:{icon:'⏳', label:'جاري الاتصال',  color:'#888' }
  };
  var c = map[CONN_STATE] || map.connecting;
  var el = document.getElementById('conn-badge');
  if (el) { el.innerHTML = c.icon+' '+c.label; el.style.color = c.color; }
  var elLg = document.getElementById('conn-badge-lg');
  if (elLg) { elLg.innerHTML = c.icon+' '+c.label; elLg.style.color = c.color; }
}

// فحص جودة الاتصال دورياً (ping خفيف على Supabase لقياس زمن الاستجابة)
async function checkConnectionQuality() {
  if (!navigator.onLine) { CONN_STATE = 'offline'; updateConnBadge(); return; }
  if (IS_SYNCING) { CONN_STATE = 'syncing'; updateConnBadge(); return; }
  var start = Date.now();
  try {
    await fetch(SB_URL + '/rest/v1/', { method:'HEAD', headers:SB_HEADERS, signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
    var elapsed = Date.now() - start;
    CONN_STATE = elapsed > 2000 ? 'weak' : 'online';
  } catch(e) {
    CONN_STATE = 'offline';
  }
  updateConnBadge();
}

window.addEventListener('online', function(){
  toast('🟢 عاد الاتصال بالإنترنت — جاري المزامنة');
  SYNC_BACKOFF_MS = 20000;
  syncOfflineQueue();
  checkConnectionQuality();
});
window.addEventListener('offline', function(){
  toast('🔴 انقطع الاتصال — سيتم حفظ العمل محلياً تلقائياً');
  CONN_STATE = 'offline';
  updateConnBadge();
});

setInterval(checkConnectionQuality, 15000);
setInterval(function(){ if (OFFLINE_QUEUE.length && navigator.onLine && !IS_SYNCING) syncOfflineQueue(); }, 20000);


async function sbFetch(path, opts) {
  opts = opts || {};
  var r = await fetch(SB_URL + '/rest/v1/' + path, Object.assign({}, opts, {
    headers: Object.assign({}, SB_HEADERS, opts.headers || {})
  }));
  if (!r.ok) { var t = await r.text(); throw new Error(t || r.statusText); }
  var txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ═══════════════════════════════════════════════
// MOCK DATA (fallback / seed — يتم استبدالها ببيانات Supabase عند تسجيل الدخول)
// ═══════════════════════════════════════════════
var MOCK_PO = [
  { id:'po1', po_number:'PO-2026-06-0001', supplier_name:'دينا فارمز', officer_name:'سمير',
    status:'تحت الاستلام', created_at:'2026-06-29T08:00:00Z',
    items: JSON.stringify([
      {sku:'sk-001', product_name:'جبنة بيضاء 500جم', unit:'كرتون', qty_ordered:20},
      {sku:'sk-002', product_name:'لبن كامل الدسم 1لتر', unit:'كرتون', qty_ordered:30},
      {sku:'sk-003', product_name:'زبادي طبيعي 170جم', unit:'كرتون', qty_ordered:15}
    ])},
  { id:'po2', po_number:'PO-2026-06-0002', supplier_name:'الحضارة للأغذية', officer_name:'عدوي',
    status:'تحت الاستلام', created_at:'2026-06-28T10:00:00Z',
    items: JSON.stringify([
      {sku:'sk-010', product_name:'جبنة رومي 1كجم', unit:'قطعة', qty_ordered:10},
      {sku:'sk-011', product_name:'سمن بقري 500جم', unit:'علبة', qty_ordered:24}
    ])}
];

var PRODUCTS = {
  'sk-001': {n:'جبنة بيضاء 500جم',    c:45.00, p:62.00, margin:27.4, bc:'6221031234561'},
  'sk-002': {n:'لبن كامل الدسم 1لتر', c:18.50, p:25.00, margin:26.0, bc:'6221031234562'},
  'sk-003': {n:'زبادي طبيعي 170جم',   c:12.00, p:16.50, margin:27.3, bc:'6221031234563'},
  'sk-010': {n:'جبنة رومي 1كجم',      c:110.00,p:145.00,margin:24.1, bc:'6221031234564'},
  'sk-011': {n:'سمن بقري 500جم',      c:65.00, p:88.00, margin:26.1, bc:'6221031234565'}
};

var DC_COST = {}; // sku -> آخر تكلفة من الداتا سنتر (dc_current_cost) — مرجع مستقل عن سجل الفواتير المحلي
// كانت DC_COST بتتعرض كسطر معلومات بس، من غير ما تُستخدم فعليًا في old_cost — فالتنبيه
// "بدون تكلفة سابقة" ومقارنة التكلفة وحفظ الطلب كانوا لسه معتمدين على كتالوج PRODUCTS المحلي
// (اللي بيتحدث بس لما الاستلام يمر من نفس الأداة). دلوقتي DC_COST هي المرجع الأول الفعلي.
function getCurrentCost(sku) {
  return (DC_COST[sku] != null && DC_COST[sku] > 0) ? DC_COST[sku] : ((PRODUCTS[sku]||{}).c || 0);
}

// inventory_item_sku (مادة مخزون) -> [{productSku, productName, quantity, unit, oldIngredientCost}]
// شيت المكونات (dc_product_ingredients) — يربط كل مادة بالمنتجات اللي بتدخل في تركيبها
var DC_INGREDIENTS_BY_MATERIAL = {};

// component_sku (مادة خام) -> [{producedSku, producedName, quantity, unit, source}]
// مصدرين: dc_inventory_item_ingredients (تقرير "Inventory Items Ingredients" الحقيقي من
// فودكس نفسه — مادة مُصنّعة من مواد تانية، مثال: "كيري بسطرمة" مُصنّعة من كيري+بسطرمة+زبدة)
// و custom_material_recipes (شيت يدوي احتياطي لأي صنف مش موجود في تصدير فودكس)
var CUSTOM_RECIPES_BY_COMPONENT = {};

// بيرجع كل المواد/المنتجات المتأثرة (على أي عدد من المستويات) لما مادة خام يتغير سعرها —
// بيتتبع "المادة X داخلة في تصنيع المادة Y" (شيت المكونات) ثم "المادة Y داخلة في تركيب المنتج Z" (شيت فودكس)
// مع الحماية من الحلقات اللانهائية (لو حصل خطأ إدخال دوّار)
function getAffectedChain(rootSku) {
  var results = []; // [{sku, name, kind:'material'|'product', path:[names], isRepack, source}]
  var visited = {};
  function walk(sku, path) {
    if (visited[sku] || path.length > 8) return;
    visited[sku] = true;
    (CUSTOM_RECIPES_BY_COMPONENT[sku] || []).forEach(function(m){
      var nextPath = path.concat(m.producedName || m.producedSku);
      results.push({ sku: m.producedSku, name: m.producedName, kind: 'material', path: nextPath, isRepack: false, source: m.source });
      walk(m.producedSku, nextPath);
    });
    (DC_INGREDIENTS_BY_MATERIAL[sku] || []).forEach(function(p){
      var nextPath = path.concat(p.productName || p.productSku);
      results.push({ sku: p.productSku, name: p.productName, kind: 'product', path: nextPath, isRepack: !!p.isRepack });
      walk(p.productSku, nextPath);
    });
  }
  walk(rootSku, []);
  return results;
}

var MOCK_REQUESTS = [];
var MOCK_SUPPLIERS = []; // حسابات الموردين (تتبنى تلقائياً عند أول فاتورة)

// ── قاعدة بيانات الموردين الحقيقية من فودكس (341 مورد) ──
var SUPPLIERS_DB = [{"id": "9d22b4a1-ab98-4c80-888f-73e507d04b85", "name": "مزارع دينا", "contact": "مصطفي سعيد", "phone": "1225214129"}, {"id": "9d22c76e-511b-4a76-9113-05a485a0ed59", "name": "اطياب", "contact": "هاني عبد اللطيف", "phone": "1207151065"}, {"id": "9d2406ef-911d-421e-b5d3-fa9ed5502ebe", "name": "رودس", "contact": "محمد", "phone": "1266772020"}, {"id": "9d2446b8-78b2-4c02-8848-c7bbf463f6d5", "name": "قتيلو", "contact": "شريف", "phone": "1281419222"}, {"id": "9d26566e-7b70-402f-9768-310231ce65f1", "name": "فيليب بيتاس", "contact": "", "phone": ""}, {"id": "9d2685cb-5ddf-4aaf-82b7-4474d129e933", "name": "عسل ابو الفضل", "contact": "", "phone": ""}, {"id": "9d27f7fc-89c0-4dfb-a51f-58e93b47228b", "name": "شوفان المتحدة", "contact": "", "phone": ""}, {"id": "9d283860-1ac0-43ca-943c-727ab48a11e7", "name": "ميلك مان", "contact": "حسن مختار", "phone": "1067503208"}, {"id": "9d2a299a-a20a-4259-8fdc-ed745e2aabda", "name": "جيفركس", "contact": "مدحت وليد", "phone": "1226117992"}, {"id": "9d2abbe6-c369-423e-8a91-0c2da4d57bd8", "name": "الحمد موتزريلا", "contact": "محمود شعبان", "phone": "1145838535"}, {"id": "9d99c110-621f-411b-abd2-549a42604d96", "name": "ابو الفضل", "contact": "", "phone": ""}, {"id": "9d9a82c9-355b-4c6c-81f7-9c2481efe24e", "name": "لافاش كيري", "contact": "كرم محمود ابراهيم", "phone": "1283543974"}, {"id": "9d9a8b61-468a-43cd-87bc-f4332d8586ca", "name": "ام مصطفي فطير", "contact": "", "phone": ""}, {"id": "9d9ca269-4e64-427a-a1dc-d92513388306", "name": "لمار", "contact": "يوسف احمد", "phone": "1282174506"}, {"id": "9d9cb396-b07b-4fb2-9961-46e303a7e906", "name": "ريتش بيك", "contact": "علي محمد - ايهاب المشرف", "phone": ""}, {"id": "9d9cbd3e-b449-4774-aed2-442b61eb21ed", "name": "بريد واي", "contact": "محمود رجب", "phone": "1143316319"}, {"id": "9d9cbd8d-2b87-4785-882e-47a5a85ec8b4", "name": "المراعي زبادي", "contact": "", "phone": ""}, {"id": "9d9cf78c-8ad9-4852-8038-581cbe4fd0f0", "name": "جهينة زبادي", "contact": "", "phone": ""}, {"id": "9d9d1187-514d-45f1-82f6-800d97f6ec29", "name": "دوبيلا", "contact": "", "phone": ""}, {"id": "9da4ca44-67c9-4e41-8a78-0efac88824c9", "name": "حلواني اخوان", "contact": "", "phone": ""}, {"id": "9da70e90-ad94-40d8-9725-f4e2a00b1aa6", "name": "H.M مجمدات", "contact": "محمد عبد الوهاب", "phone": "1211595355"}, {"id": "9daac9b4-fa57-40b9-994a-64c83471dac5", "name": "كاريبي", "contact": "محمد السكري", "phone": "1096546754"}, {"id": "9daad9d5-b6c8-4b2d-84ea-0e3d7f9d8f9c", "name": "OVEN", "contact": "", "phone": ""}, {"id": "9dab70b8-d30a-43b5-be79-dff6f87b1130", "name": "الطلخاوي", "contact": "", "phone": ""}, {"id": "9dad1c1f-2cfb-4b27-a18d-1f7cd2caea32", "name": "تنور الشام", "contact": "احمد عبد النعيم", "phone": "1287191407"}, {"id": "9dad601e-2ba7-47ef-985d-6863fe1ef78f", "name": "الفلاح نوتيلا سما", "contact": "", "phone": ""}, {"id": "9daea74a-3523-4c7b-9282-9bb5fae52d2a", "name": "بون بان", "contact": "", "phone": ""}, {"id": "9db0cc5d-7e5e-47d2-841f-4d66a4729712", "name": "هاينز", "contact": "محمد ايمن", "phone": "1271378110"}, {"id": "9db2d042-2e4f-4893-8284-e57e37107a55", "name": "ايديتا - فورني", "contact": "", "phone": ""}, {"id": "9db39452-ef6a-402f-8e98-69822f2e9e84", "name": "ابو السيد رنجة", "contact": "", "phone": ""}, {"id": "9db8f4bc-aab0-49d8-997a-b73bc5c550d4", "name": "امتنان", "contact": "", "phone": ""}, {"id": "9db8f69c-50df-4c7c-9f85-587c9dcf740d", "name": "A.M.R رسلان", "contact": "وليد", "phone": "1211604899"}, {"id": "9db94bce-9f94-4a1d-9bd4-419b91bd9b76", "name": "فريش فارم", "contact": "", "phone": ""}, {"id": "9dbb0429-33a8-4ed7-b9e1-51bab1346bcf", "name": "خشالة - افانتي", "contact": "عمر شفيق", "phone": "1288371909"}, {"id": "9dbb3165-44f6-4445-aee0-c60cf4ef5bda", "name": "دومتي جبنة", "contact": "مصطفي", "phone": "1207300704"}, {"id": "9dbd1aec-3418-4d6c-8053-1d1ce3b49cfb", "name": "امريكانا", "contact": "محمود جمال", "phone": "1210280545"}, {"id": "9dbf0fa4-6bbd-47ac-a44e-9bd326bf2ced", "name": "سينابون", "contact": "", "phone": ""}, {"id": "9dc319d9-7e87-4db4-8e25-17af7cfea994", "name": "زبده فيرن", "contact": "يوسف", "phone": "1208401668"}, {"id": "9dcd4ebc-051e-4c9f-bd70-987cb8aae5df", "name": "احمد مجمدات", "contact": "", "phone": ""}, {"id": "9dd9fd36-b38b-4585-a40d-0d6921ba4554", "name": "تصنيع المعمل", "contact": "", "phone": ""}, {"id": "9de00514-b468-41c2-8bf9-5f2ec699faf1", "name": "النوساني مخلل", "contact": "يونس النوساني", "phone": "1050897576"}, {"id": "9de603eb-5e89-4114-a03f-e084d4615926", "name": "فاكهة و خضروات", "contact": "", "phone": ""}, {"id": "9deb6b50-d099-4b0c-9524-609ab46f233e", "name": "الوراق", "contact": "", "phone": ""}, {"id": "9df3b3c2-ad79-4c8a-99e5-17d1fc0a4b0f", "name": "كيلوجز نودلز", "contact": "", "phone": ""}, {"id": "9e0d75d1-d21b-4ef0-bff9-7fc27807f9b7", "name": "ميلكا", "contact": "", "phone": ""}, {"id": "9e13bae5-56e1-4a88-92b7-338cdb67e331", "name": "الشركة العربية اجبان مستوردة", "contact": "", "phone": ""}, {"id": "9e25a2d8-3085-4909-8b84-eb2159b4e8a6", "name": "تيميز", "contact": "وليد", "phone": "1229362437"}, {"id": "9e29aae6-5a98-4f0a-9e18-f1a6a8013a45", "name": "البستان السورى", "contact": "", "phone": ""}, {"id": "9e4e06ba-0103-47a7-a63b-7cb637dbb853", "name": "فرجينيا", "contact": "", "phone": ""}, {"id": "9e4fae46-3220-40ee-9480-384255712d55", "name": "عبد الرحمن السوري", "contact": "", "phone": ""}, {"id": "9e541853-c7eb-48a6-b7a3-bcd89cfc9d5d", "name": "الاصدقاء", "contact": "", "phone": ""}, {"id": "9e6ec8cc-2a7a-44ae-b7df-69977b957346", "name": "الصعيدي", "contact": "", "phone": ""}, {"id": "9e7458ca-ea54-45e1-9745-c1130081454a", "name": "الطحان", "contact": "", "phone": ""}, {"id": "9eb48222-ba55-49ca-a445-daec552f7754", "name": "رصيد اول المدة", "contact": "", "phone": ""}, {"id": "9ebc9740-c44a-4327-9e56-797cf4054c22", "name": "احمد تي", "contact": "بركات", "phone": "1050591885"}, {"id": "9ebc9b6b-1129-44c7-96f8-2249d5c823c5", "name": "البان ميدو", "contact": "", "phone": ""}, {"id": "9ebc9b7b-8562-4e1f-9d85-242ce676847e", "name": "البان علي غزال", "contact": "", "phone": "1093991571"}, {"id": "9ebc9b87-0a71-4767-81c9-4a7d4c3320f2", "name": "البان مصطفي", "contact": "مصطفي", "phone": "1225414050"}, {"id": "9ebc9d4a-7056-4352-8865-3dbe5f943380", "name": "جريت فودز", "contact": "عصام", "phone": "1206254411"}, {"id": "9ebcaacd-76fc-4927-9266-7c18d77bce9e", "name": "جولدن فودز", "contact": "", "phone": ""}, {"id": "9ebcae8b-a8fc-4331-a617-f382ce3c0e6d", "name": "ريجينا", "contact": "", "phone": ""}, {"id": "9ebcb0f7-9176-4fa3-8505-0bf61408d081", "name": "عبد الله مخلل", "contact": "عبد الله", "phone": "1208111659"}, {"id": "9ebcbc3e-80af-4c98-b84b-257000f10cdb", "name": "كريستال", "contact": "سمير صابر", "phone": "1221764838"}, {"id": "9ebe80ab-945c-4dc3-95bf-ee3ddaba32fd", "name": "نستلة مشروبات غازية", "contact": "", "phone": ""}, {"id": "9ebe9c09-0768-417f-899f-bd51195d8751", "name": "ايه زد جروب", "contact": "", "phone": ""}, {"id": "9ebea300-7e5a-4286-bcfe-92a72213923e", "name": "خالد بيض", "contact": "", "phone": ""}, {"id": "9ebea38d-8d4a-4ef3-a2b7-3b3fc373b83c", "name": "احمد بيض", "contact": "", "phone": ""}, {"id": "9ebea3b2-4db4-4371-8ba2-087213fa3842", "name": "الشيخ طيور", "contact": "", "phone": ""}, {"id": "9ebea42f-f3ba-4d06-b518-7d6ee2b2bbe8", "name": "ميلكي", "contact": "عبدو", "phone": "1281882488"}, {"id": "9ebea439-5d97-41d4-a845-eaf238d7c432", "name": "قباء منظفات", "contact": "", "phone": ""}, {"id": "9ebea4a3-32cf-45c2-8d13-f457636591f1", "name": "ارما", "contact": "", "phone": ""}, {"id": "9ebea614-097c-4f44-8331-d809d70d5b0d", "name": "اجبان ماضي", "contact": "", "phone": ""}, {"id": "9ebea7bd-b2b4-46fc-9e10-8150b145188f", "name": "بيبسي", "contact": "مصطفي", "phone": "1274783265"}, {"id": "9ebea7cc-11fd-4b23-9f58-07de6b2be8a2", "name": "كوكاكولا", "contact": "", "phone": ""}, {"id": "9ebea89b-7762-4699-9afc-7c14e3cd8c5b", "name": "المنصور نوتيلا", "contact": "", "phone": ""}, {"id": "9ebeaa91-108f-4eb5-8fc7-87ff79b22d9f", "name": "اجبان مصطفي النجم", "contact": "مصطفي النجم", "phone": "1206887008"}, {"id": "9ebeaabc-ff83-4c07-b90f-c87aed17e3f9", "name": "الفارس حلاوة", "contact": "", "phone": ""}, {"id": "9ebeaac5-f66d-44ea-805f-1fcc9e587581", "name": "الراعي حلاوة", "contact": "احمد عشماوي", "phone": "1288484586"}, {"id": "9ebeab72-f230-4c54-aa2b-6123269a1a40", "name": "سافولا اسكندرية الوطنية", "contact": "عمر شاهين", "phone": "1225062707"}, {"id": "9ebeaba5-7eb4-46fd-aebb-3a978c462ca4", "name": "كريم سجق", "contact": "كريم", "phone": "1280209364"}, {"id": "9ebeabbc-e736-4d2e-b685-71887fa68cfa", "name": "الجيار", "contact": "", "phone": ""}, {"id": "9ebeabdc-9a3a-4a3c-81a5-1a195732ef28", "name": "الشبراوي نصر مجمدات", "contact": "نصر الشبراوي", "phone": "1205386064"}, {"id": "9ebeac33-9cf3-49f4-9bcc-22d4b1704eae", "name": "الصفوة", "contact": "وليد", "phone": "1280343599"}, {"id": "9ec06dfe-304f-4636-9f5a-0edd865751c9", "name": "الاسكندرية للكيماويات ادكو", "contact": "", "phone": ""}, {"id": "9ec47423-4801-4595-887f-91e9cb2d2bf6", "name": "ديكسي ميلز", "contact": "محمد عبد الحليم", "phone": "1273114685"}, {"id": "9ec5504b-40dc-445b-b210-35c7c7dccdc6", "name": "المارمش فريسكا", "contact": "ايمن عبد الفتاح", "phone": "1206230058"}, {"id": "9ec6b234-5824-4c78-a0ad-b24ae7d47ecc", "name": "اجبان زهرة ابو داود مصطفي", "contact": "مصطفي حسن", "phone": "1055470212"}, {"id": "9ec8cc9a-91dc-435d-9c67-46e39fc7d3a8", "name": "ايجيبت فودز بيج شيبسي", "contact": "", "phone": "1010498820"}, {"id": "9eca9356-cdca-4c10-ab63-f6781ca99a1d", "name": "حلواني العبد", "contact": "", "phone": ""}, {"id": "9ecada59-5245-4147-91e7-44cb5beaa1d7", "name": "اوزمو", "contact": "محمد", "phone": "1275040321"}, {"id": "9ecade9b-68af-49bc-a7a6-847096797da2", "name": "اولكر", "contact": "اولكر", "phone": ""}, {"id": "9ecca9c9-b64f-42b9-a69a-07c98bce6f3c", "name": "الشمعدان", "contact": "", "phone": ""}, {"id": "9ece72ff-7e87-4f35-9a06-96e9d9af43dd", "name": "اوكسي", "contact": "", "phone": ""}, {"id": "9ece77c1-0018-4ea4-bc8f-a3fb22aa796d", "name": "روتانا زبدة", "contact": "", "phone": ""}, {"id": "9ecea357-ed24-4d73-91b2-293b73aca275", "name": "الجبل", "contact": "عمرو سمير", "phone": "1223683366"}, {"id": "9ececa47-ae9d-4b8a-9278-42b3cfbba46f", "name": "اتش ام جروب", "contact": "محمد عبد الوهاب", "phone": "1211595355"}, {"id": "9eceee7e-b5f1-4dde-a3ad-a78848eb95fd", "name": "تصنيع", "contact": "", "phone": ""}, {"id": "9ed25300-33c1-4be4-b6d8-21af55659a6b", "name": "وايت مناديل", "contact": "", "phone": ""}, {"id": "9ed25db4-f281-4ad4-a7ca-90fd0ed4bc96", "name": "اجبان ماينز ديري", "contact": "ممدوح 60", "phone": ""}, {"id": "9ed25f8b-4efc-40f6-a4ff-b9674653d8ce", "name": "مودرن ميلك مبستر", "contact": "احمد عبد الحميد", "phone": "1005141175"}, {"id": "9ed26e03-c491-4a98-bbb6-d83263231286", "name": "جود فرانس تريد جيت للتوكيلات التجارية", "contact": "سيد راغب", "phone": "1206979590"}, {"id": "9ed276d0-95dd-434d-8ac8-142b2765954d", "name": "لايون", "contact": "", "phone": ""}, {"id": "9ed2b02c-c8c7-4e2c-8624-7d9401ff0fe5", "name": "اجبان علاء النوام", "contact": "", "phone": ""}, {"id": "9ed2b760-02df-4758-845c-20bd62b49059", "name": "اي زد الزهراء احمد", "contact": "احمد", "phone": "1284023314"}, {"id": "9ed2cb05-05bc-4aaa-a1f9-07711211e717", "name": "دريم", "contact": "محمد طارق", "phone": "1270709155"}, {"id": "9ed2d3e6-10f7-4c8b-bd69-7b29dede5b6d", "name": "البوادي", "contact": "", "phone": ""}, {"id": "9ed451bd-d01a-44fd-a381-03defbadbd7a", "name": "محمد السيد بسطرمة", "contact": "محمد السيد", "phone": "1280209364"}, {"id": "9ed4ae89-b2b5-463e-807e-42fdf4a63af2", "name": "دمشق السوري", "contact": "كريم وحيد", "phone": "1229766373"}, {"id": "9ed4b29d-d53d-4f8a-ab17-820973642a03", "name": "اجبان ابراهيم النجار", "contact": "", "phone": ""}, {"id": "9ed4c25c-10dc-4f7e-b679-b5ff0ebab835", "name": "بن العميد فوديكا بلس", "contact": "", "phone": ""}, {"id": "9ed4f8f8-5b8a-4f40-abda-8d6a74c29b53", "name": "يونيليفر المتحدة جلال منظفات", "contact": "", "phone": ""}, {"id": "9ed527a2-e460-412a-9ed8-e8f0c98aabc2", "name": "اجبان الشيخ اسلام", "contact": "", "phone": ""}, {"id": "9ed66c39-8630-4271-967c-50741e98002d", "name": "فيدريكو اجبان مستوردة", "contact": "محمد محب", "phone": "1066886878"}, {"id": "9ed672f9-f52f-4c8b-b2a4-bde7a0318981", "name": "شيبسي", "contact": "", "phone": ""}, {"id": "9ed67b4a-2b58-482e-b3df-ab4d2bda1db6", "name": "كوين بلاستك", "contact": "", "phone": ""}, {"id": "9ed67ec3-6d10-4fab-83c4-7d1415d459ed", "name": "ميلكانا", "contact": "احمد ابراهيم", "phone": "1069925057"}, {"id": "9ed6c9ea-fa5b-4598-827d-d68310d85d3c", "name": "ليدز لانشون", "contact": "", "phone": ""}, {"id": "9ed73303-8165-431c-bdb7-4f52dd6d7d4e", "name": "خالد منظفات", "contact": "", "phone": "1007391620"}, {"id": "9ed8583b-50ad-4cbb-8bbc-cb5c360a56cd", "name": "الزمردة الساعة", "contact": "مصطفي كمال", "phone": "1066623749"}, {"id": "9ed877e6-b28c-4459-85e8-bf8e972aaa3b", "name": "طيبة لانشون", "contact": "احمد جمال", "phone": "1200960786"}, {"id": "9ed89ce2-544a-4e21-b4cf-07b4e9f9db5d", "name": "كادبوري شوكولاتة", "contact": "اسلام السيد", "phone": "1116552871"}, {"id": "9ed8c755-e6a3-4a72-be00-76a70bb6841c", "name": "فريدة شاور (الموزعين)", "contact": "", "phone": "1156008993"}, {"id": "9ed8cbff-227b-484c-afff-8d1498f4786a", "name": "حلويات مستوردة", "contact": "محمد", "phone": "1275040321"}, {"id": "9ed943e2-d4a0-45c4-aed4-721f38437bcc", "name": "لاروز", "contact": "ابراهيم هشام", "phone": "1288490423"}, {"id": "9ed948a2-9ffc-4a0b-bf37-3bd82f5db8bb", "name": "وابي عبد المقصود", "contact": "عبد المقصود", "phone": "1000495082"}, {"id": "9eda7efc-bb88-4d6c-8584-ac94181ee235", "name": "المهندس خالد كيري", "contact": "خالد", "phone": "1278834481"}, {"id": "9edab55f-d0d6-486d-af97-8c96e098af1d", "name": "زينة", "contact": "", "phone": ""}, {"id": "9edae951-2a39-4e83-a32f-5516ad87bcdb", "name": "ابو عوف بن", "contact": "", "phone": ""}, {"id": "9edb622a-ed2b-4bf0-b0a0-a2cfccf2ac77", "name": "اوليس مرشميلو", "contact": "ياسر محمود", "phone": "1110774772"}, {"id": "9edb96ea-6ede-4d40-91e6-970a8f6a966d", "name": "عافية", "contact": "", "phone": ""}, {"id": "9edc73bd-83cd-46c7-9a41-f2a618795983", "name": "روفان مياة", "contact": "", "phone": ""}, {"id": "9edc78b7-bcf5-4a1a-b491-7e2948a754c2", "name": "اي زد الزهراء ماركو", "contact": "محمد سليمان", "phone": "1281818746"}, {"id": "9edc99e1-349a-4d8f-bdbc-9906405a44ea", "name": "صن شاين", "contact": "احمد عبد الرحيم", "phone": "1224921380"}, {"id": "9edce90b-d332-4a1b-8df3-7688dfdae8fe", "name": "عسل نحل المصطفي", "contact": "عبد الله صالح", "phone": "1211713907"}, {"id": "9edd32e4-b139-423d-ade6-1a8b0062fa67", "name": "عبدو الروبي", "contact": "", "phone": ""}, {"id": "9ee0a55b-007a-469c-bed7-1f716d15a224", "name": "فوديكا V7 كولا", "contact": "الحسيني محمد", "phone": "1000642980"}, {"id": "9ee0e715-2da6-465a-ae9c-775102a60ed0", "name": "يوسف قراعة زبدة / كريمة", "contact": "يوسف قراعة", "phone": "127766475"}, {"id": "9ee2e9fc-6158-41c1-805e-ded598e1c8c6", "name": "محمد جابر رومي", "contact": "", "phone": ""}, {"id": "9ee3635e-a50f-409f-97b3-c3c900120432", "name": "محمد العوفي", "contact": "محمد العوفي", "phone": "1159092034"}, {"id": "9ee49053-25d6-48b7-ac66-aaefe6c4d4a8", "name": "طيبة المرشدي", "contact": "محمد ابراهيم", "phone": "1222579601"}, {"id": "9ee4a36b-3f02-4dbf-9f1f-1a1c10168cac", "name": "نيسكافية", "contact": "", "phone": ""}, {"id": "9ee685f2-6019-4e89-ad81-471a1e51f6d8", "name": "ريجيانو موتزريلا", "contact": "", "phone": ""}, {"id": "9ee873d5-e919-4143-aac3-8f300b2c6e44", "name": "فارم فريتس", "contact": "", "phone": ""}, {"id": "9ee8c174-daf2-49dc-b80f-494c7c7f0336", "name": "مدار جروب منظفات", "contact": "", "phone": "1155557060"}, {"id": "9eeaa618-ace0-44cb-8643-29eafcf62ecc", "name": "كلوركس منظفات", "contact": "احمد ابراهيم", "phone": "1156008993"}, {"id": "9eeee9c4-64de-4a04-985e-60f6cfe39d97", "name": "الضحي", "contact": "ابراهيم مبروك", "phone": "1203232383"}, {"id": "9ef06961-a416-46ac-85dd-ccd395363971", "name": "اجبان الشيخ محمد الاشراف", "contact": "الشيخ محمد", "phone": "100002209"}, {"id": "9ef0b41e-318d-4485-ba98-1b906c98eac2", "name": "الشيخ سردين", "contact": "", "phone": ""}, {"id": "9ef0c70c-053b-4a64-81e1-e0e73e9d7b4a", "name": "اللحيمي", "contact": "السيد سعد", "phone": "1044938462"}, {"id": "9ef0ff0d-9ad9-42f7-87f8-bf360bc94b96", "name": "الرحيق المختوم", "contact": "عبدالله كامل", "phone": "1024500298"}, {"id": "9ef288eb-eb2f-47ec-9c80-d26dbf8d2f0c", "name": "مودرن كريمة لباني", "contact": "احمد عبدالحميد", "phone": "1005141175"}, {"id": "9ef30aca-3bdc-46fe-ba9d-ab03ff41bc17", "name": "صبحي عبدالمقصود", "contact": "عبدالرحمن صبحي", "phone": "1069499380"}, {"id": "9ef4a677-a20a-4040-8208-66adf54711ff", "name": "عبدالله السوري", "contact": "", "phone": ""}, {"id": "9ef4c8a0-ced4-44ef-ab65-0e5c75dd83e5", "name": "خالد رنجة", "contact": "", "phone": ""}, {"id": "9ef4cc0f-eaa3-4302-a208-ebe01648d1a1", "name": "فيتراك", "contact": "احمد سعيد", "phone": "1270861339"}, {"id": "9ef708e3-69b7-4156-acad-667076120ada", "name": "برسيل", "contact": "", "phone": ""}, {"id": "9ef92d51-0cd5-42e4-989a-90f5e7334c16", "name": "وكالة العطار", "contact": "عين شمس", "phone": ""}, {"id": "9ef9657f-a8cc-4d87-afe5-752e7ee8943c", "name": "قباء حلويات", "contact": "بيمبو", "phone": ""}, {"id": "9efc9f9c-d17d-4ea7-83f6-6807af378220", "name": "كيري", "contact": "يسري مرسي", "phone": "1211133764"}, {"id": "9f015173-999a-4e70-a39a-9dcada97bfd9", "name": "جبل موسي", "contact": "محمد عبدالفتاح", "phone": "1101254829"}, {"id": "9f048bcd-cfbf-49ba-824b-68295fccefc4", "name": "الرحمة طحينة", "contact": "", "phone": ""}, {"id": "9f04c3b2-2ad3-4d32-b95e-9b61c452e7c1", "name": "روتانا شيدر", "contact": "محمد سعيد", "phone": "1210696276"}, {"id": "9f0b9deb-c3b6-4252-a250-39e8413651c7", "name": "شركة دوتس اسبرسو", "contact": "", "phone": "1556669674"}, {"id": "9f0cfb6d-b27a-463f-84d5-f62e9aead0f7", "name": "واي جا اف", "contact": "", "phone": ""}, {"id": "9f0fd5ed-00ee-4cbc-9463-3c607f655df6", "name": "المصرية جيت فليفر", "contact": "35926033", "phone": "35926033"}, {"id": "9f111fa6-b529-4898-ad79-48425f15b6ed", "name": "بن عبدالمعبود", "contact": "محمد يحي", "phone": "1284477671"}, {"id": "9f20ce88-a76b-473a-b7f0-a5ac0fb3522b", "name": "اي ام جروب", "contact": "", "phone": ""}, {"id": "9f20da9a-8a5a-408e-9a98-ab3398e50d26", "name": "بسكو مصر", "contact": "", "phone": ""}, {"id": "9f20e671-b51c-4283-86bd-9c263758ed67", "name": "عبور لاند", "contact": "", "phone": ""}, {"id": "9f22e962-630d-4223-88d9-1912c51e47b8", "name": "اندومي", "contact": "", "phone": ""}, {"id": "9f2335c1-2129-4d4d-9af7-66c3f4f1586d", "name": "ريف", "contact": "ريف", "phone": ""}, {"id": "9f235585-1c06-4ef8-8b98-ba89b7f50221", "name": "ايفريدي", "contact": "", "phone": ""}, {"id": "9f25ab7f-4b99-46a4-9496-24f435505c63", "name": "الغوطة الدمشقية", "contact": "", "phone": "1220230974"}, {"id": "9f26e519-06bb-4f56-988b-43547103a9e3", "name": "ليدر لانشون", "contact": "", "phone": ""}, {"id": "9f2edb36-0b62-400d-8794-7fb9da0dd676", "name": "هيلثي حليب", "contact": "احمد عبدد الحميد", "phone": "1286296424"}, {"id": "9f2eee22-7414-41c3-a103-9b3854b0ff3e", "name": "قنديل سيترس منظفات", "contact": "", "phone": ""}, {"id": "9f3135d3-935b-4a0b-86ed-cfae3e54aa89", "name": "مصر المانيا تيست بيور", "contact": "", "phone": ""}, {"id": "9f31615c-8178-4932-8243-6463e2bc9802", "name": "ماي واي", "contact": "", "phone": ""}, {"id": "9f352420-a2c1-4259-bdd8-9146103f535c", "name": "ايمن افندي حلويات مستورد", "contact": "احمد حسن", "phone": "1554868088"}, {"id": "9f353101-3b2b-47bb-abed-b497dc5d91ba", "name": "المنصور لبنيتا", "contact": "يوسف بدران", "phone": "1226398076"}, {"id": "9f358b84-5bb3-4a25-ae02-42738ca23f1d", "name": "ياسر فاكهة", "contact": "", "phone": ""}, {"id": "9f36f36d-024f-4147-bc4c-228b74e9bf63", "name": "اجبان زهرة ابو داود الشركة", "contact": "محمد ابو داوود 01123940544", "phone": "1016565600"}, {"id": "9f3bd9f0-2f99-494a-b3dc-1a5bc428c834", "name": "الوكالة فاكهة", "contact": "", "phone": ""}, {"id": "9f3f9ee3-942e-4f6a-9220-664d8963334b", "name": "اسماعيل لحوم مجمدة", "contact": "", "phone": "1007149741"}, {"id": "9f403092-bb09-41be-b3b4-2ad301b7a521", "name": "اي فروتي ايس كريم", "contact": "", "phone": ""}, {"id": "9f4356cc-6fc4-44dd-8070-01d150b3ca1a", "name": "جرين فواكهة مجمدة", "contact": "", "phone": "1288836960"}, {"id": "9f45f293-03ef-4a10-9984-7f6471435bd2", "name": "شركة مقتتفات للبن", "contact": "", "phone": ""}, {"id": "9f48d6d5-7675-48b9-b7eb-e062c36227df", "name": "ام مهند", "contact": "", "phone": ""}, {"id": "9f4929fd-cce4-4b08-b340-047588fda192", "name": "المجموعة الاقتصادية الكابوس", "contact": "", "phone": ""}, {"id": "9f494332-d4b8-42d7-8593-5885c3bd8cf0", "name": "الشريف منظفات", "contact": "هشام بسيوني", "phone": ""}, {"id": "9f498676-1ad6-4754-a401-132bd5898c37", "name": "اجبان الشاذلي", "contact": "", "phone": ""}, {"id": "9f4b0d57-611f-4679-9932-695a9145efb4", "name": "احمد ابو جهل فسيخ", "contact": "احمد", "phone": "1200484325"}, {"id": "9f4b5390-b2c8-43f7-bbaf-9a5308886548", "name": "الرشيدي الميزان", "contact": "", "phone": ""}, {"id": "9f4d9f24-3dc5-4396-a6a9-d8aa28b16207", "name": "منظفات مينا", "contact": "", "phone": ""}, {"id": "9f5544a1-4dd3-4470-b54d-ce8b05e0c972", "name": "جزارة الطلخاوي", "contact": "", "phone": ""}, {"id": "9f5552f9-538d-4c80-baf5-10f48d5ed473", "name": "طيور الاتحاد والامانة والعمل", "contact": "", "phone": ""}, {"id": "9f5728ad-412f-4d67-9b28-60eb16dc51e3", "name": "ممدوح السيد ستين", "contact": "عمرو عشري", "phone": "1091519234"}, {"id": "9f5f519c-b31d-4088-9fca-3dde16857d8d", "name": "ماركت ليدرز الخير ملح", "contact": "", "phone": ""}, {"id": "9f618db4-139f-4113-bdc1-23a1e5e1cd22", "name": "رمضان", "contact": "", "phone": ""}, {"id": "9f63416c-603b-46c4-9942-d48f4d947862", "name": "سويتال", "contact": "", "phone": ""}, {"id": "9f639bf0-a8de-4d20-854d-a299f3a06553", "name": "الحرية صولا بونبون", "contact": "محمود عبد الناصر", "phone": "1285373711"}, {"id": "9f65beb2-8631-4875-937d-e3f07686b58c", "name": "العالمية بسطرمة", "contact": "", "phone": "1289940136"}, {"id": "9f65d6b0-d170-4545-8a61-aa907449fdde", "name": "تعديل كميات", "contact": "", "phone": ""}, {"id": "9f664046-6a54-45a4-a0bb-925a75872ec1", "name": "مصطفى بدوي طباعة", "contact": "", "phone": ""}, {"id": "9f695abe-8fb6-4a70-8f8e-04f8c4737dbb", "name": "تاج الملوك", "contact": "", "phone": ""}, {"id": "9f6c0a2f-04b6-4329-93e1-0cce01a1a9a7", "name": "شركة البيومي", "contact": "احمد بيومي", "phone": "1555573781"}, {"id": "9f6fd63b-2569-43d8-8d84-f00ac73ca2cf", "name": "كولد ستون", "contact": "سمير", "phone": "1204691890"}, {"id": "9f719dc8-e23e-4ff8-b4ef-a7c8bfb57115", "name": "محمد مجزر فراخ", "contact": "محمد", "phone": "1224354800"}, {"id": "9f72414d-7048-451b-97ac-00c92ad4f744", "name": "مهندس خالد دراجون", "contact": "", "phone": ""}, {"id": "9f7bd994-1e33-4cb9-9c98-daacdc93d528", "name": "طيبة مونين", "contact": "", "phone": ""}, {"id": "9f7bdb27-c5ac-4d21-b597-b5b114d95500", "name": "رفعت بيض", "contact": "رفعت", "phone": "1023759548"}, {"id": "9f7d68bf-78ec-49d7-8f56-366a0b592397", "name": "الاسلامية للدواجن", "contact": "", "phone": "1140770445"}, {"id": "9f7d80bb-baaf-4981-94a2-6000826cd26d", "name": "سمارت جرين", "contact": "احمد علي محمد", "phone": "1229815336"}, {"id": "9f87e15e-4f9e-4c2f-a82c-3cfdd238b1ae", "name": "محمود باشون فروت", "contact": "", "phone": ""}, {"id": "9f895cc6-cbdc-4005-a78d-aa6690ac952d", "name": "شركة فيمكو", "contact": "", "phone": ""}, {"id": "9f9e6e12-dbea-47a9-85aa-27914116c9ec", "name": "اترجة عسل ملكات", "contact": "", "phone": "1113274044"}, {"id": "9f9f7691-a38f-4e9a-96cb-6beb838926fb", "name": "اجبان سراج", "contact": "", "phone": ""}, {"id": "9fa5ecfe-6ac6-420d-943e-b9a9c6a80050", "name": "مزارع دينا ايس كريم", "contact": "", "phone": ""}, {"id": "9fa99303-ecdc-48a6-bf38-6ee437c154fa", "name": "حمودة فراخ بيضاء", "contact": "", "phone": ""}, {"id": "9faccc78-3cd4-4d84-abe7-ada988e170d0", "name": "الشاجيع اليمنية", "contact": "", "phone": ""}, {"id": "9fb4d083-b638-47d7-b2ad-9dbe61ebf19e", "name": "جزارة مكة", "contact": "", "phone": ""}, {"id": "9fb4e0b8-0f96-4548-86a9-b0182ae588fa", "name": "ايجيبت عطا ابو حمص مكسرات", "contact": "مكسرات", "phone": ""}, {"id": "9fb6e69e-6158-45fc-8de5-d6e57da56a11", "name": "الليثي للاعسال", "contact": "", "phone": ""}, {"id": "9fbff5bf-439a-42a2-a55e-461706b0a822", "name": "علب و تغليف الشيخ خالد", "contact": "الشيخ خالد", "phone": "1112981116"}, {"id": "9fc49b19-eff1-44c4-93ad-21b105d69c37", "name": "تصنيع السمالهي", "contact": "", "phone": ""}, {"id": "9fd65ec1-cab4-4905-ad3a-73a0e5de76a3", "name": "عين شمس", "contact": "", "phone": ""}, {"id": "9fde5ede-6fc4-4669-8c56-1f88789311d4", "name": "اوغندي للاستراد", "contact": "الدكتور محمد اوغندي", "phone": ""}, {"id": "9fe00435-22f3-494d-9672-5adbd8f619d2", "name": "جهينة حليب", "contact": "", "phone": ""}, {"id": "9fe00459-e2d2-4451-9a60-75dc395ff36c", "name": "المراعي حليب", "contact": "بيتر", "phone": "1276083257"}, {"id": "9fe00b81-6ada-4f26-9aa1-65a1f825eb0b", "name": "اجبان الفريد", "contact": "", "phone": ""}, {"id": "9fe4142a-0b36-4355-a164-33bbd65d95d0", "name": "ايليت باك", "contact": "", "phone": ""}, {"id": "9fec3a64-0bfa-4cb4-8ef5-011ef4c4a4db", "name": "الوفاء حلويات مستوردة", "contact": "محمود", "phone": "1220040021"}, {"id": "9fee4a96-de1b-4eea-afd0-29b03e48f4a4", "name": "تريد بوكس بلاستيك", "contact": "", "phone": "201149658432"}, {"id": "9fee5bf8-e43f-4d69-8e4d-872583c28563", "name": "عمر العطار كرسبي", "contact": "", "phone": ""}, {"id": "9feed346-f1ce-431e-aede-dc5febb14f28", "name": "عاطف عطارة وكالة العطار", "contact": "", "phone": ""}, {"id": "9ff510ce-3437-4997-be84-2053bed5685e", "name": "بيروت 66", "contact": "", "phone": "1122226446"}, {"id": "a0003755-6dd0-443a-b5b6-458eb47ab298", "name": "دومتي مخبوزات", "contact": "", "phone": ""}, {"id": "a00a506d-928e-4c0b-94dd-11d5522640ee", "name": "نوبي ماركت", "contact": "", "phone": "1280020113"}, {"id": "a00e2e92-d638-44b8-97d9-69faf7b3b4e3", "name": "المنصور ريدبول", "contact": "", "phone": ""}, {"id": "a00e3157-5b7e-420c-8932-429c9cecfbeb", "name": "موبي اجبان مستوردة", "contact": "ياسر ابادير", "phone": "1221567009"}, {"id": "a01082e5-a21f-433e-8a4f-6a50a29075f9", "name": "دومتي جولد", "contact": "", "phone": ""}, {"id": "a0166841-a0a0-43be-a3ee-3a6636a8d19f", "name": "حلواني حلاوة", "contact": "", "phone": ""}, {"id": "a01e74e4-7097-4f26-967b-47504b7ccc2c", "name": "اجبان محمد الغرباوي", "contact": "", "phone": ""}, {"id": "a0213fbc-46e8-4adb-a647-87744aaa9f7c", "name": "احفاد سعد جمل مكسرات", "contact": "", "phone": ""}, {"id": "a021478a-b868-4a28-bbfb-b7b1a624fe11", "name": "مورد نقدي", "contact": "", "phone": ""}, {"id": "a0231044-4d11-4610-a6a9-ce8095b15fec", "name": "يوسف منصور", "contact": "", "phone": ""}, {"id": "a02e8d5d-21c5-4b48-bf4a-718ee4ebc9dd", "name": "اوريس كاندي", "contact": "", "phone": ""}, {"id": "a034ff78-500d-4426-a138-505e1798038e", "name": "الطحان جبنة", "contact": "", "phone": ""}, {"id": "a0377c87-fcd5-4602-8f0c-af3303f8584f", "name": "ابو غزالة جزارة بلدي", "contact": "", "phone": ""}, {"id": "a0398510-0ae4-4fee-8130-e61748d86d83", "name": "الامل حلويات مستوردة", "contact": "", "phone": ""}, {"id": "a03a6a82-30a9-40c1-bee6-58f8af848d19", "name": "ايديتا - شيبس رو", "contact": "", "phone": ""}, {"id": "a03e7721-3e1a-4732-9afb-859894da5e1b", "name": "الغانم برطمانات", "contact": "", "phone": "1095757599"}, {"id": "a044a27b-05fa-40b0-bfc1-f95bc1e5b878", "name": "عمر سالم بلاستيك (بلال منشية)", "contact": "", "phone": ""}, {"id": "a046c012-4848-481b-a0fd-39d7480383ad", "name": "مسالم زبده", "contact": "", "phone": ""}, {"id": "a04a896e-65d0-4a2e-be87-4abd79e4a50b", "name": "greko زبادي", "contact": "", "phone": ""}, {"id": "a04a9369-db50-47ed-9038-4810ae2916f7", "name": "لينو سباعي", "contact": "محمد السباعي", "phone": "123727695"}, {"id": "a04d1f21-d409-430c-91a6-4088befeb94e", "name": "عماد كريمة", "contact": "", "phone": ""}, {"id": "a0571779-3962-4510-93f0-ad47ca69c6b7", "name": "تمور احمد عبد القادر", "contact": "", "phone": "1203990421"}, {"id": "a057668b-279d-4150-a6e1-7d301e26ab0a", "name": "الدريني للاستيراد و التصدير تمر", "contact": "", "phone": ""}, {"id": "a058a30a-4bbe-440e-89f0-be8a2c11025e", "name": "ريماس لاند", "contact": "احمد", "phone": "1225605500"}, {"id": "a05f0240-4d94-4fb5-81a9-a40c7351524b", "name": "عسلي", "contact": "", "phone": ""}, {"id": "a05f053a-a7f6-44b5-a61d-6ad0ce57b69b", "name": "حلاوة يوكا", "contact": "", "phone": ""}, {"id": "a063136d-a3ac-4097-9f56-e154560013b7", "name": "ايلفان توفيكس", "contact": "احمد محمد", "phone": "1102506916"}, {"id": "a06392fd-83c1-4b82-a5cc-f74cba6750f5", "name": "مزرعة حميد زيت زيتون", "contact": "ابراهيم حميد", "phone": ""}, {"id": "a06ac4f7-1c97-45a4-bb7a-226a3121c678", "name": "مورد اخطاء", "contact": "", "phone": ""}, {"id": "a06b2ca9-f0cf-4f37-845d-e736fb7d918c", "name": "كورونا", "contact": "", "phone": ""}, {"id": "a06f2394-f897-4b14-bfbc-93a68d0fb577", "name": "سعيد بيض", "contact": "", "phone": ""}, {"id": "a071bb3d-4748-42c2-9b0a-dcd7b41d261b", "name": "السمان مخلل", "contact": "", "phone": ""}, {"id": "a0751271-2137-4304-9526-738a2231a0fb", "name": "جولدن تشيز", "contact": "", "phone": ""}, {"id": "a0793f86-a522-4f51-a1f6-466bb05a17e4", "name": "عمان سحلب", "contact": "", "phone": ""}, {"id": "a07c9440-137d-4ac9-965c-cff1d4a84da7", "name": "النصار", "contact": "1225379729", "phone": ""}, {"id": "a07d6821-1801-4b66-a2ab-b0011c5340db", "name": "ماستر PET", "contact": "", "phone": ""}, {"id": "a07ed16c-a997-4fe8-9232-b0cf48828a3f", "name": "الفهد كيري", "contact": "", "phone": ""}, {"id": "a07f2cd4-1b60-41fc-99da-5404845ba350", "name": "تمر قطوف", "contact": "", "phone": ""}, {"id": "a07f36b1-f807-44ec-92a2-32990863a5f9", "name": "محمود صافي فراولة", "contact": "", "phone": ""}, {"id": "a07f76a1-b0f1-4b9e-82d2-7f0b34ab223d", "name": "VIPتصنيع", "contact": "", "phone": ""}, {"id": "a0876f80-a9b6-4b9b-a6bb-772ba5763a88", "name": "الاخوة للتجارة والتوزيع شيفي ميكس", "contact": "احمد ناجي", "phone": "1202320011"}, {"id": "a08969ed-9139-456f-9ffc-eb2acb88ab92", "name": "فارم تشيز مستورد", "contact": "", "phone": ""}, {"id": "a08b445d-196f-4ecc-bf96-c1a692a30661", "name": "سبيرو سباتس", "contact": "", "phone": ""}, {"id": "a0957b3a-c856-4eb0-af00-082887ffb55a", "name": "ليبوبرد باك", "contact": "", "phone": ""}, {"id": "a0976864-bbb2-4872-958a-ff28f20462c9", "name": "لمسة حب cosmatics", "contact": "", "phone": ""}, {"id": "a0994d95-187a-4cf1-beb8-a0c023509266", "name": "الجسري سوري", "contact": "", "phone": ""}, {"id": "a09cf5ea-29c7-47d8-83a0-20e471af66c7", "name": "سمسم خامات المخبوزات", "contact": "", "phone": ""}, {"id": "a0aba1e6-d3f2-4769-a5f8-7a5c5b52f8f8", "name": "طلبه بن", "contact": "", "phone": ""}, {"id": "a0abe629-61b1-49dd-952d-38906fcbc3ee", "name": "بوندز كوفي بن", "contact": "", "phone": ""}, {"id": "a0abe67d-55ba-4729-be98-28988a293eb0", "name": "كوفي تاون بن", "contact": "", "phone": ""}, {"id": "a0b05896-315b-4559-b859-93877e1f0c36", "name": "شركة ربيع شريفي", "contact": "", "phone": ""}, {"id": "a0b2087a-e66a-424d-8c78-48fe91e59712", "name": "كوانتا كوفي", "contact": "", "phone": ""}, {"id": "a0b8257b-5846-4d50-a039-486a82241e26", "name": "مورد اون لاين", "contact": "", "phone": ""}, {"id": "a0ba03df-8cbd-4f0a-9a05-2166ecd25caa", "name": "الحبيب النبي", "contact": "", "phone": ""}, {"id": "a0c1bc72-8abb-480e-9e85-9bc0eb7945a8", "name": "شاهين بوردن", "contact": "", "phone": ""}, {"id": "a0c5689b-b678-4375-979d-c1020665e738", "name": "دومتي كلاسيك", "contact": "", "phone": ""}, {"id": "a0c5ef68-684d-4ab6-91c8-662682c49a36", "name": "سلامة دسوقي", "contact": "", "phone": ""}, {"id": "a0c5fc36-daa4-487d-a6b7-cba672485b61", "name": "ام جي تريدنج", "contact": "", "phone": ""}, {"id": "a0c79983-bd2b-4144-8bdd-b5b9f2e87ec0", "name": "تشيز سوليوشن اجبان مستوردة", "contact": "", "phone": ""}, {"id": "a0c7c12d-f102-415f-9798-b3ce3a4f8a14", "name": "H 3", "contact": "", "phone": ""}, {"id": "a0c7cce3-639d-49d7-891c-d21d37549a59", "name": "عناني شاي الوردة", "contact": "", "phone": ""}, {"id": "a0c7f87c-a64e-4edf-b3e0-f42f82dea9a6", "name": "رافت الدمنهوري", "contact": "", "phone": ""}, {"id": "a0c7fac5-f3e9-4374-a542-c106ce64d671", "name": "شيخ العرب", "contact": "", "phone": ""}, {"id": "a0c82a2d-aa8a-486f-aa92-a1dd26042720", "name": "حسن الاسناوي", "contact": "", "phone": ""}, {"id": "a0c9b6f0-4cb6-4e64-887b-29e8d100b20b", "name": "البحارة للاسماك", "contact": "", "phone": ""}, {"id": "a0c9d74d-98d3-44b3-bac2-a433a2b2c122", "name": "محمد يحيي ياميش", "contact": "", "phone": ""}, {"id": "a0d5c748-b3aa-4fbf-8ea2-e011683e065a", "name": "ابو العزم تعبئة وتغليف", "contact": "", "phone": ""}, {"id": "a0d65d0d-0df4-494a-9e21-e28bad48521a", "name": "الدكتور", "contact": "", "phone": ""}, {"id": "a0d7db94-7701-42c4-9cbc-0ee8b3e9fdab", "name": "عطارة زمان", "contact": "", "phone": ""}, {"id": "a0db78b9-be2e-4ea7-a1f5-d689dae6a902", "name": "طارق كريمة شهية", "contact": "طارق", "phone": "1227530035"}, {"id": "a0ddbcb1-4b37-4f9f-b586-d6dae3c6d0ec", "name": "اجبان زهرة الحرمين", "contact": "", "phone": ""}, {"id": "a0dfe0c5-e4d5-428b-9e70-b7cbc78431e5", "name": "رويال جرين مخلل", "contact": "", "phone": ""}, {"id": "a0e5ed5d-dba2-4bf3-a4cd-38603d451db3", "name": "المتحدة مستورد", "contact": "", "phone": ""}, {"id": "a0e7ff61-2d30-45f2-a42b-330cf78f0dea", "name": "لاتيو زيت الفا لتوزيع المواد الغذائية", "contact": "جلال احمد", "phone": "1229877394"}, {"id": "a0efabf6-4edd-4828-b79d-087d64482a26", "name": "اجبان السقيلي", "contact": "محمد صلاح", "phone": "1143158119"}, {"id": "a0f984af-936c-4c91-84f0-070d39cfc5d4", "name": "اللوتس بيض", "contact": "", "phone": ""}, {"id": "a0fdd63e-6c67-4816-9c59-cabfaaee42c1", "name": "اجبان شرابية", "contact": "طارق محمد جابر", "phone": "1220950323"}, {"id": "a0ffae09-036d-489d-bca3-d56dd42ee563", "name": "احمد سويلم فراخ", "contact": "", "phone": "1140770444"}, {"id": "a104f302-dfe9-40ea-88f0-fee54e907d8c", "name": "نزيه العطار", "contact": "", "phone": ""}, {"id": "a1107480-c36a-42d1-b041-d3a98ba2da53", "name": "رغد", "contact": "", "phone": ""}, {"id": "a11be0e4-0633-4fa3-857c-e05ff24da17b", "name": "سيف كريمة", "contact": "", "phone": ""}, {"id": "a11ef5d5-9c80-4001-8b50-0efc174f1ecb", "name": "ايلانو", "contact": "", "phone": ""}, {"id": "a12442a1-62ee-4aeb-91c8-3972742ea32b", "name": "جاردن فروت", "contact": "", "phone": ""}, {"id": "a1283b3f-e5c7-4c29-a9f2-840ef5e5d03f", "name": "معمل مدبولي رضا كريمة", "contact": "", "phone": ""}, {"id": "a1284f85-4909-4bac-b694-2e5a513661a4", "name": "ماكسي كولا", "contact": "", "phone": ""}, {"id": "a12a2dfa-f7bb-45e5-8410-b1a4b9f78316", "name": "اسبشيال فودز", "contact": "", "phone": ""}, {"id": "a12d0a27-f41d-4fac-8aa4-22d6188341f7", "name": "شركة الترامسي حلويات العيد", "contact": "", "phone": ""}, {"id": "a132e083-b015-4ccf-8c77-ed8b5bcb6393", "name": "شركة لوتس حلويات العيد", "contact": "", "phone": ""}, {"id": "a13f0f30-c025-4293-b977-80a0ad73b2d8", "name": "ابراهيم الامام اسماك مدخنه فسيخ", "contact": "", "phone": ""}, {"id": "a1406917-78a2-4b48-acef-d6147baf966d", "name": "راني", "contact": "", "phone": ""}, {"id": "a1491ea6-d979-46cf-9027-493b21edd972", "name": "تصنيع موالح المصنع", "contact": "", "phone": ""}, {"id": "a1689e06-3126-41f7-926b-25302107a85d", "name": "اجبان الحرمين الشريفين", "contact": "سيف غلاب", "phone": "1028780716"}, {"id": "a17842a1-6f84-44a3-96c3-242594e62409", "name": "مؤمن فاكهة استوائية", "contact": "مؤمن", "phone": "1554225017"}, {"id": "a1b13631-436a-496c-afce-4876b48e71b3", "name": "المحمصة السورية", "contact": "", "phone": ""}, {"id": "a1b584f1-6431-4d37-8511-7bc271d6b988", "name": "قصر المكسرات", "contact": "", "phone": ""}, {"id": "a1bd31ef-aebe-4c65-935c-4a1c3df2fd0e", "name": "شركة الملاذ حلاوة", "contact": "", "phone": ""}, {"id": "a1be94ad-c21c-4453-a43b-c48f6b737e84", "name": "ريتش لانشون", "contact": "", "phone": ""}, {"id": "a1c2ec6c-27d9-4235-8478-ba6282554ffb", "name": "بونص", "contact": "", "phone": ""}, {"id": "a1cb1889-c9c0-4518-a1cb-98e11be678cc", "name": "مورد فروقات", "contact": "", "phone": ""}, {"id": "a1d15b5e-a70a-49ed-b379-2098d4695b82", "name": "تركيانو", "contact": "", "phone": ""}, {"id": "a1d3ce59-598e-4418-8899-8dfb6b6f72d4", "name": "التوحيد", "contact": "", "phone": ""}, {"id": "a1d48f32-4733-4416-847d-9e6b2c6b1c7a", "name": "الروية زيت زيتون", "contact": "", "phone": ""}, {"id": "a1dd2f12-ed83-4559-9685-245447205fb5", "name": "شركة فاميلي", "contact": "", "phone": ""}, {"id": "a1ef525b-8b95-41eb-9676-f809903542ea", "name": "الطاهر السوري", "contact": "", "phone": "1024408372"}, {"id": "a1fd51ef-e2af-4a96-b4e7-fb303ff0aa5b", "name": "سان توب", "contact": "", "phone": ""}];

var AUDIT_LOG = [];
var PAYMENT_METHODS = [
  { id:'cash',    label:'نقدي',             icon:'💵' },
  { id:'check',   label:'شيك',              icon:'📝' },
  { id:'company', label:'حساب الشركة',      icon:'🏢' },
  { id:'omar',    label:'من خزينة عمر',     icon:'🔐' }
];

// ═══════════════════════════════════════════════
// ROLES & STATUS
// ═══════════════════════════════════════════════
var ROLES = {
  receiving: { label:'الاستلام', pass:'1111', icon:'📦', color:'#d68910' },
  pricing:   { label:'مسؤول التسعير', pass:'2222', icon:'💰', color:'#1a5276' },
  finance:   { label:'أمين الخزينة — أحمد صلاح', pass:'3333', icon:'🏦', color:'#6c3483' },
  finmgr:    { label:'مدير المالية — عمر أبو الفضل', pass:'4444', icon:'📊', color:'#1a3a2a' },
  purchmgr:  { label:'مدير قسم المشتريات', pass:'5555', icon:'📦', color:'#2c3e50' },
  ceo:       { label:'رئيس مجلس الإدارة', pass:'9999', icon:'👔', color:'#1a3a2a' }
};

var STATUSES = {
  receiving:    'تحت الاستلام',
  qty_approved: 'تم اعتماد الكميات',
  sent:         'تم إرسالها للمالية والتسعير',
  pricing:      'تحت مراجعة التسعير',
  price_done:   'تم اعتماد السعر',
  export_ready: 'جاهزة للتصدير إلى Foodics',
  exported:     'تم التصدير',
  rejected:     'مرفوض',
  deferred:     'معلق'
};
var DECISION_LOG = []; // سجل قرارات التسعير (اعتماد/رفض/تعليق) — قابل للطباعة والتصدير

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
var role = null;
var view = 'queue';
var detailId = null;
var recvPO = null;      // PO being received
var recvItems = [];     // items during receiving
var isManualInvoice = false; // فاتورة يدوية خارج أوامر الشراء (مؤقت)
var isReturnMode = false;    // وضع تسجيل مرتجع للمورد
var returnPerson = '';       // اسم الشخص الذي قام بالمرتجع
var returnReason = '';       // سبب المرتجع

// ── حفظ تلقائي للعمل الجاري وقت الاستلام (حماية من فقد البيانات عند الريفريش) ──
function autosaveReceiving() {
  try {
    if (recvPO && recvItems.length) {
      localStorage.setItem('barq_recv_draft', JSON.stringify({
        recvPO: recvPO, recvItems: recvItems,
        isManualInvoice: isManualInvoice, isReturnMode: isReturnMode,
        returnPerson: returnPerson, returnReason: returnReason
      }));
    } else {
      localStorage.removeItem('barq_recv_draft');
    }
  } catch(e) {}
}

function restoreReceivingDraft() {
  try {
    var raw = localStorage.getItem('barq_recv_draft');
    if (!raw) return false;
    var d = JSON.parse(raw);
    if (!d.recvPO || !d.recvItems || !d.recvItems.length) return false;
    recvPO = d.recvPO; recvItems = d.recvItems;
    isManualInvoice = !!d.isManualInvoice; isReturnMode = !!d.isReturnMode;
    returnPerson = d.returnPerson||''; returnReason = d.returnReason||'';
    return true;
  } catch(e) { return false; }
}

setInterval(autosaveReceiving, 4000); // حفظ تلقائي كل 4 ثواني أثناء العمل على أمر استلام

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
function fmt(n) {
  if (n==null || n==='') return '—';
  return Number(n).toLocaleString('ar-EG',{maximumFractionDigits:2});
}
// نصوص المستخدمين (اسم مورد/ملاحظة/اسم صنف...) بتتزامن Live لكل الأدوار المتصلة، فلازم تتنضف قبل ما تدخل innerHTML
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// تقسيم سطر CSV بيراعي الحقول المحاطة بعلامات اقتباس (زي اسم منتج فيه فاصلة)، بدل split(',') الساذج اللي بيزلق الأعمدة
function splitCSVLine(line) {
  var result = []; var cur = ''; var inQuotes = false;
  for (var i=0; i<line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else { inQuotes = false; } }
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result;
}
function calcMargin(c,p) {
  if (!c||!p||p<=0) return null;
  return (p-c)/p*100;
}
// هامش 100% أو أكتر بيخلي cost/(1-margin/100) يطلع Infinity، وده بيتحفظ null بصمت في الأسعار — نمنع ده بحد أقصى معقول
function clampMargin(m) {
  m = parseFloat(m);
  if (isNaN(m)) return 0;
  if (m < 0) return 0;
  if (m > 90) return 90;
  return m;
}
function mColor(pct) {
  if (pct==null) return '#888';
  return pct<10?'#c0392b':pct<20?'#d68910':'#1a7a40';
}
function bgClass(st) {
  var m = {};
  m[STATUSES.receiving]='bg-recv'; m[STATUSES.qty_approved]='bg-qty';
  m[STATUSES.sent]='bg-prc'; m[STATUSES.pricing]='bg-prc';
  m[STATUSES.price_done]='bg-ok'; m[STATUSES.export_ready]='bg-exp';
  m[STATUSES.exported]='bg-ok'; m[STATUSES.rejected]='bg-rej';
  m[STATUSES.deferred]='bg-recv';
  return m[st] || 'bg-recv';
}
function toast(msg,ms) {
  var t=document.getElementById('tas-toast');
  if(!t)return; t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._t); t._t=setTimeout(function(){t.style.opacity='0';},ms||3000);
}
function addAudit(action, who, detail) {
  AUDIT_LOG.unshift({
    time: new Date().toISOString(),
    action: action,
    who: who,
    detail: detail || ''
  });
  // كتابة آمنة في الخلفية — لو النت مقطوع تتحفظ في الطابور بدل ما تضيع صامتة
  sbWrite('audit_log_v3', {
    method:'POST',
    body: JSON.stringify({ action:action, who:who, detail:detail||'' })
  }, { opType:'سجل_نشاط', label: action+' — '+who });
}
function now() { return new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

// ═══════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════
function render() {
  var root = document.getElementById('tas-root');
  if (!root) return;
  try {
    if (!role) { root.innerHTML = renderAuth(); return; }
    if (detailId) { root.innerHTML = renderDetail(); updateConnBadge(); return; }
    root.innerHTML = renderTopBar() + '<div class="pg">' + renderMain() + '</div>';
    updateConnBadge();
    updateOfflineIndicator();
  } catch (e) {
    // من غير try/catch هنا، أي خطأ وسط بناء الشاشة كان بيسيب الشاشة القديمة زي ما هي —
    // فبيحصل إحساس إن الأداة "علّقت" وأي زرار تضغطه بيرجّعك لنفس الشاشة (لأن الحالة اتغيرت
    // فعليًا في الذاكرة بس الشاشة نفسها ما اتحدّثتش). دلوقتي بنعرض شاشة خطأ فيها رجوع/تحديث بدل التجميد الصامت.
    console.error('render() failed:', e);
    root.innerHTML = '<div style="padding:40px 20px;text-align:center">' +
      '<div style="font-size:40px;margin-bottom:10px">⚠️</div>' +
      '<div style="font-weight:800;margin-bottom:8px">حصل خطأ غير متوقع في عرض الشاشة</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:18px;direction:ltr">'+esc((e&&e.message)||'')+'</div>' +
      '<button class="big-action-btn" onclick="detailId=null;view=\'queue\';render()">🔙 الرجوع لقائمة الطلبات</button>' +
      '<button class="big-action-btn" style="margin-top:8px;background:var(--bg);border:1px solid var(--border)" onclick="location.reload()">🔄 إعادة تحميل الصفحة</button>' +
    '</div>';
  }
}

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════
function renderAuth() {
  var btns = Object.keys(ROLES).map(function(k){
    var r = ROLES[k];
    return '<div class="role-btn" id="rb-'+k+'" onclick="BARQ_TAS.selRole(\''+k+'\')">' +
      '<div class="ri">'+r.icon+'</div><div class="rn">'+r.label+'</div></div>';
  }).join('');
  return '<div class="auth-wrap"><div class="auth-card">' +
    '<div class="auth-logo">⚡</div><div class="auth-title">برق تسعير v3</div>' +
    '<div class="auth-sub">أبو الفضل — نسخة تجريبية</div>' +
    '<div class="role-grid">'+btns+'</div>' +
    '<input type="password" id="ap" class="auth-inp" placeholder="••••" maxlength="4" oninput="if(this.value.length===4)doLogin()">' +
    '<button class="auth-btn" onclick="BARQ_TAS.doLogin()">دخول</button>' +
    '<div class="auth-err" id="ae"></div></div></div>';
}
function selRole(k) {
  document.querySelectorAll('.role-btn').forEach(function(b){b.classList.remove('sel');});
  var el=document.getElementById('rb-'+k); if(el)el.classList.add('sel');
  var inp=document.getElementById('ap'); if(inp)inp.focus();
}
function doLogin() {
  var pass=(document.getElementById('ap')||{}).value||'';
  var found=null;
  Object.keys(ROLES).forEach(function(k){if(ROLES[k].pass===pass)found=k;});
  if(!found){var e=document.getElementById('ae');if(e)e.textContent='كلمة المرور غلط';return;}
  role=found; view='queue'; detailId=null; recvPO=null;
  try { localStorage.setItem('barq_session_role', role); } catch(e){}
  loadFromSupabase();
}
function doLogout() {
  role=null; view='queue'; detailId=null; recvPO=null;
  try { localStorage.removeItem('barq_session_role'); } catch(e){}
  if (window.BARQ_AUTH) { BARQ_AUTH.logout(); }
  if (window.BarqApp) { BarqApp.render(); return; }
  render();
}

// ═══════════════════════════════════════════════
// SUPABASE — LOAD ALL DATA
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// AUTO-REFRESH PURCHASE ORDERS — تحديث تلقائي من غير ما نعمل refresh
// ═══════════════════════════════════════════════
async function refreshPO() {
  try {
    var pos = await sbFetch('po_sync?select=*&status=eq.pending_invoice_match&order=created_at.desc');
    if (pos) {
      var newIds = pos.map(function(p){return p.id;});
      var oldIds = MOCK_PO.map(function(p){return p.id;});
      var hasNew = newIds.some(function(id){ return oldIds.indexOf(id) === -1; });

      MOCK_PO = pos.map(function(p){
        return {
          id: p.id, po_number: p.po_number, supplier_name: p.supplier_name,
          officer_name: p.officer_name || '—', status: 'تحت الاستلام',
          created_at: p.created_at, items: p.items
        };
      });

      // Re-render only if we're on the receiving queue (avoid interrupting user mid-entry)
      if (role === 'receiving' && !recvPO && view !== 'entry') {
        if (hasNew) toast('📦 وصل أمر شراء جديد من المخزون');
        render();
      }
    }
  } catch(e) { /* po_sync may not exist yet — keep current list */ }
}

// ═══════════════════════════════════════════════
// SUPABASE REALTIME — تحديث فوري بين كل النوافذ
// ═══════════════════════════════════════════════
var _realtimeLibLoaded = false;
var _realtimeChannel = null;

function loadRealtimeLib(cb) {
  if (_realtimeLibLoaded || window.supabase) { _realtimeLibLoaded = true; cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js';
  s.onload = function(){ _realtimeLibLoaded = true; cb(); };
  s.onerror = function(){ console.error('تعذر تحميل مكتبة التحديث الفوري'); };
  document.body.appendChild(s);
}

function startRealtime() {
  loadRealtimeLib(function(){
    if (!window.supabase || _realtimeChannel) return;
    var client = window.supabase.createClient(SB_URL, SB_KEY);

    _realtimeChannel = client
      .channel('barq-live-updates')
      // أوامر شراء جديدة/محدّثة من المخزون
      .on('postgres_changes', { event:'*', schema:'public', table:'po_sync' }, function(payload){
        if (role === 'receiving' && !recvPO) {
          refreshPO();
          if (payload.eventType === 'INSERT') toast('📦 وصل أمر شراء جديد من المخزون');
        }
      })
      // طلبات تسعير جديدة/محدّثة (من الاستلام أو اعتماد السعر)
      .on('postgres_changes', { event:'*', schema:'public', table:'pricing_requests_v3' }, function(payload){
        if (role === 'pricing' || role === 'finance' || role === 'finmgr' || role === 'ceo') {
          refreshPricingRequests();
        }
      })
      // دفعات/مرتجعات جديدة (المالية)
      .on('postgres_changes', { event:'*', schema:'public', table:'supplier_payments' }, function(){
        if (role === 'finance' || role === 'finmgr') refreshSuppliersData();
      })
      .on('postgres_changes', { event:'*', schema:'public', table:'supplier_returns' }, function(){
        if (role === 'finance' || role === 'finmgr') refreshSuppliersData();
      })
      .subscribe();
  });
}

// ── تحديث طلبات التسعير فقط (بدون قطع تعديل جاري) ──
async function refreshPricingRequests() {
  if (detailId) return; // لا تقاطع مراجعة سعر جارية
  try {
    var reqs = await sbFetch('pricing_requests_v3?select=*&order=created_at.desc');
    MOCK_REQUESTS = (reqs || []).map(function(r){
      return {
        id: r.id, sku: r.sku, product_name: r.product_name, unit: r.unit,
        qty_ordered: r.qty_ordered, qty_received: r.qty_received,
        old_cost: r.old_cost, new_cost: r.new_cost, old_price: r.old_price,
        suggested_price: r.suggested_price, final_price: r.final_price,
        stored_margin: r.stored_margin, cost_changed: r.cost_changed,
        stock_before: r.stock_before,
        supplier_name: r.supplier_name, po_number: r.po_number,
        received_by: r.received_by, status: r.status, created_at: r.created_at
      };
    });
    render();
  } catch(e) {}
}

// ── تحديث بيانات الموردين (دفعات/مرتجعات) ──
async function refreshSuppliersData() {
  if (document.getElementById('fin-modal')) return; // لا تقاطع نافذة إدخال مفتوحة
  try {
    var accs = await sbFetch('supplier_accounts?select=*');
    var accMap = {};
    (accs||[]).forEach(function(a){ accMap[a.supplier_name] = a; });
    var pays = await sbFetch('supplier_payments?select=*&order=created_at.asc');
    var rets = await sbFetch('supplier_returns?select=*&order=created_at.asc');

    var supNames = new Set();
    Object.keys(accMap).forEach(function(n){ supNames.add(n); });
    (pays||[]).forEach(function(p){ supNames.add(p.supplier_name); });
    (rets||[]).forEach(function(r){ supNames.add(r.supplier_name); });
    MOCK_REQUESTS.forEach(function(r){ if(r.supplier_name) supNames.add(r.supplier_name); });

    MOCK_SUPPLIERS = Array.from(supNames).map(function(name){
      var acc = accMap[name] || {};
      return {
        name: name, balance: 0,
        opening: acc.opening_balance || 0, openingDate: acc.opening_date || null,
        payments: (pays||[]).filter(function(p){return p.supplier_name===name;}).map(function(p){
          return { amount: parseFloat(p.amount), method: p.method, method_label: p.method_label,
                   ref: p.ref, note: p.note, date: (p.created_at||'').slice(0,10), rawDate: p.created_at };
        }),
        returns: (rets||[]).filter(function(r){return r.supplier_name===name;}).map(function(r){
          return { amount: parseFloat(r.amount), reason: r.reason, detail: r.detail,
                   date: (r.created_at||'').slice(0,10), rawDate: r.created_at };
        })
      };
    });
    render();
  } catch(e) {}
}

// Fallback: polling كل 45 ثانية كضمان احتياطي لو الـ Realtime انقطع
setInterval(function(){
  if (role === 'receiving' && !recvPO) refreshPO();
}, 45000);

async function loadFromSupabase() {
  render(); // show auth-less shell while loading
  var root = document.getElementById('tas-root');
  if (root) root.innerHTML = '<div class="auth-wrap"><div style="color:#fff;font-size:16px">⏳ جاري تحميل البيانات...</div></div>';

  try {
    // 1. Load pricing requests (استلام + تسعير)
    var reqs = await sbFetch('pricing_requests_v3?select=*&order=created_at.desc');
    MOCK_REQUESTS = (reqs || []).map(function(r){
      return {
        id: r.id, sku: r.sku, product_name: r.product_name, unit: r.unit,
        qty_ordered: r.qty_ordered, qty_received: r.qty_received,
        old_cost: r.old_cost, new_cost: r.new_cost, old_price: r.old_price,
        suggested_price: r.suggested_price, final_price: r.final_price,
        stored_margin: r.stored_margin, cost_changed: r.cost_changed,
        stock_before: r.stock_before,
        supplier_name: r.supplier_name, po_number: r.po_number,
        received_by: r.received_by, status: r.status, created_at: r.created_at
      };
    });

    // 2. Load supplier accounts (opening balances)
    var accs = await sbFetch('supplier_accounts?select=*');
    var accMap = {};
    (accs||[]).forEach(function(a){ accMap[a.supplier_name] = a; });

    // 3. Load payments
    var pays = await sbFetch('supplier_payments?select=*&order=created_at.asc');
    // 4. Load returns
    var rets = await sbFetch('supplier_returns?select=*&order=created_at.asc');

    // Rebuild MOCK_SUPPLIERS from Supabase data
    var supNames = new Set();
    Object.keys(accMap).forEach(function(n){ supNames.add(n); });
    (pays||[]).forEach(function(p){ supNames.add(p.supplier_name); });
    (rets||[]).forEach(function(r){ supNames.add(r.supplier_name); });
    MOCK_REQUESTS.forEach(function(r){ if(r.supplier_name) supNames.add(r.supplier_name); });

    MOCK_SUPPLIERS = Array.from(supNames).map(function(name){
      var acc = accMap[name] || {};
      return {
        name: name,
        balance: 0,
        opening: acc.opening_balance || 0,
        openingDate: acc.opening_date || null,
        payments: (pays||[]).filter(function(p){return p.supplier_name===name;}).map(function(p){
          return { amount: parseFloat(p.amount), method: p.method, method_label: p.method_label,
                   ref: p.ref, note: p.note, date: (p.created_at||'').slice(0,10), rawDate: p.created_at };
        }),
        returns: (rets||[]).filter(function(r){return r.supplier_name===name;}).map(function(r){
          return { amount: parseFloat(r.amount), reason: r.reason, detail: r.detail,
                   date: (r.created_at||'').slice(0,10), rawDate: r.created_at };
        })
      };
    });

    // 5. Load PO from po_sync (real purchase orders from makhzoun)
    await refreshPO();

    // 6. Load audit log
    try {
      var logs = await sbFetch('audit_log_v3?select=*&order=created_at.desc&limit=50');
      AUDIT_LOG = (logs||[]).map(function(l){
        return { time: l.created_at, action: l.action, who: l.who, detail: l.detail||'' };
      });
    } catch(e) {}

    // 7. Load products_master (تكلفة/سعر/باركود دائم — بديل رفع الملف اليومي)
    try {
      var allProducts = [];
      var pOffset = 0, pBatch = 1000;
      while (true) {
        var batch = await sbFetch('products_master?select=*&order=sku&limit='+pBatch+'&offset='+pOffset);
        if (!batch || !batch.length) break;
        allProducts = allProducts.concat(batch);
        if (batch.length < pBatch) break;
        pOffset += pBatch;
      }
      if (allProducts.length) {
        allProducts.forEach(function(p){
          PRODUCTS[p.sku] = { n:p.name||'', c:parseFloat(p.cost)||0, p:parseFloat(p.price)||0,
                               bc:p.barcode||'', margin: parseFloat(p.margin)||22 };
        });
        PRODUCTS_MASTER_LOADED = true;
      }
    } catch(e) { /* products_master may not exist yet */ }

    // 7b. Load dc_current_cost (آخر تكلفة موحّدة من الداتا سنتر — مرجع للمقارنة وقت الاستلام والتسعير)
    try {
      var dcRows = [];
      var dOffset = 0, dBatch = 1000;
      while (true) {
        var dBatch2 = await sbFetch('dc_current_cost?select=sku,current_cost&limit='+dBatch+'&offset='+dOffset);
        if (!dBatch2 || !dBatch2.length) break;
        dcRows = dcRows.concat(dBatch2);
        if (dBatch2.length < dBatch) break;
        dOffset += dBatch;
      }
      dcRows.forEach(function(r){ if (r.sku && r.current_cost != null) DC_COST[r.sku] = parseFloat(r.current_cost); });
    } catch(e) { /* data center tables may not exist yet */ }

    // 7c. Load dc_product_ingredients (شيت المكونات — أي مادة مخزون داخلة في تركيب أي منتجات)
    // بيسمح إننا لما مادة يزيد سعرها، نعرف فورًا كل المنتجات المتأثرة قبل ما تتباع بسعر قديم أقل من التكلفة الحقيقية
    try {
      var ingOffset = 0, ingBatch = 1000;
      while (true) {
        var ingRows = await sbFetch('dc_product_ingredients?select=product_sku,product_name,inventory_item_sku,quantity,unit,ingredient_cost&limit='+ingBatch+'&offset='+ingOffset);
        if (!ingRows || !ingRows.length) break;
        ingRows.forEach(function(r){
          if (!r.inventory_item_sku || !r.product_sku) return;
          // كنا بنستبعد صفوف "المنتج نفسه = المادة نفسها" باعتبارها مش وصفة مركّبة —
          // ده غلط: دي عملية "إعادة تعبئة/بيع نفس المادة كمنتج" ولو سعر المادة زاد، المنتج ده لازم سعره يتراجع برضه
          (DC_INGREDIENTS_BY_MATERIAL[r.inventory_item_sku] = DC_INGREDIENTS_BY_MATERIAL[r.inventory_item_sku] || []).push({
            productSku: r.product_sku, productName: r.product_name||'',
            quantity: parseFloat(r.quantity)||0, unit: r.unit||'',
            oldIngredientCost: parseFloat(r.ingredient_cost)||0,
            isRepack: r.product_sku === r.inventory_item_sku
          });
        });
        if (ingRows.length < ingBatch) break;
        ingOffset += ingBatch;
      }
    } catch(e) { /* dc_product_ingredients may not exist yet */ }

    // 7d. Load dc_inventory_item_ingredients — الشيت الحقيقي من فودكس نفسه (تقرير "Inventory
    // Items Ingredients"، مختلف عن "Product Ingredients" اللي في dc_product_ingredients):
    // بيربط مادة مخزون مُصنّعة بمكوناتها من مواد مخزون تانية (مثال حقيقي: "سبريد كريمي بسطرمة"
    // مُصنّع من زبدة + "الوراق كيري بسطرمة" + هدر + زيت). ده المصدر الأساسي والموثوق.
    try {
      var diiOffset = 0, diiBatch = 1000;
      while (true) {
        var diiRows = await sbFetch('dc_inventory_item_ingredients?select=inventory_item_sku,inventory_item_name,ingredient_item_sku,ingredient_name,quantity,unit&limit='+diiBatch+'&offset='+diiOffset);
        if (!diiRows || !diiRows.length) break;
        diiRows.forEach(function(r){
          if (!r.ingredient_item_sku || !r.inventory_item_sku) return;
          (CUSTOM_RECIPES_BY_COMPONENT[r.ingredient_item_sku] = CUSTOM_RECIPES_BY_COMPONENT[r.ingredient_item_sku] || []).push({
            producedSku: r.inventory_item_sku, producedName: r.inventory_item_name||'',
            quantity: r.quantity, unit: r.unit||'', source: 'foodics'
          });
        });
        if (diiRows.length < diiBatch) break;
        diiOffset += diiBatch;
      }
    } catch(e) { /* dc_inventory_item_ingredients may not exist yet */ }

    // 7e. Load custom_material_recipes (شيت مكونات يدوي احتياطي — لأي صنف مش موجود في تصدير
    // فودكس، أو لو حابب تسجّل وصفة إضافية بنفسك)
    try {
      var cmrOffset = 0, cmrBatch = 1000;
      while (true) {
        var cmrRows = await sbFetch('custom_material_recipes?select=produced_sku,produced_name,component_sku,component_name,quantity,unit&limit='+cmrBatch+'&offset='+cmrOffset);
        if (!cmrRows || !cmrRows.length) break;
        cmrRows.forEach(function(r){
          if (!r.component_sku || !r.produced_sku) return;
          (CUSTOM_RECIPES_BY_COMPONENT[r.component_sku] = CUSTOM_RECIPES_BY_COMPONENT[r.component_sku] || []).push({
            producedSku: r.produced_sku, producedName: r.produced_name||'',
            quantity: r.quantity, unit: r.unit||'', source: 'manual'
          });
        });
        if (cmrRows.length < cmrBatch) break;
        cmrOffset += cmrBatch;
      }
    } catch(e) { /* custom_material_recipes may not exist yet */ }

    // 8. Load menu_analysis (تصنيف Star/Dog/Workhorse/Challenge)
    try {
      var menuRows = [];
      var mOffset = 0, mBatch = 1000;
      while (true) {
        var mBatchData = await sbFetch('menu_analysis?select=*&order=sku&limit='+mBatch+'&offset='+mOffset);
        if (!mBatchData || !mBatchData.length) break;
        menuRows = menuRows.concat(mBatchData);
        if (mBatchData.length < mBatch) break;
        mOffset += mBatch;
      }
      if (menuRows.length) {
        menuRows.forEach(function(r){ MENU_ANALYSIS[r.sku] = r; });
        MENU_ANALYSIS_LOADED = true;
      }
    } catch(e) { /* menu_analysis may not exist yet */ }

    SB_CONNECTED = true;
    startRealtime();
  } catch(e) {
    SB_CONNECTED = false;
    console.error('Supabase load error:', e);
  }

  // استعادة عمل الاستلام الجاري لو كان فيه ريفريش وسط العملية
  if (role === 'receiving' && restoreReceivingDraft()) {
    toast('✅ تم استرجاع العمل غير المكتمل — '+recvItems.length+' صنف');
  }

  render();
}

// ═══════════════════════════════════════════════
// TOPBAR
// ═══════════════════════════════════════════════
function renderTopBar() {
  var r=ROLES[role]; var btns='';
  if (role!=='ceo' && role!=='finmgr' && role!=='purchmgr')
    btns += '<button class="tb'+(view==='queue'?' on':'')+'\" onclick="BARQ_TAS.goQueue()">📋 الطلبات</button>';
  if (role==='ceo')    btns += '<button class="tb on">📊 Dashboard</button>';
  if (role==='finmgr') btns += '<button class="tb on">📊 المالية</button>';
  if (role==='purchmgr') btns += '<button class="tb on">📦 عمليات المشتريات</button>';
  if (role==='pricing') btns += '<button class="tb" onclick="BARQ_TAS.showMenuAnalysisUpload()">📊 تحليل القائمة'+(MENU_ANALYSIS_LOADED?' ✅':' ⚠️')+'</button>';
  if (role==='pricing') btns += '<button class="tb" onclick="BARQ_TAS.showFoodicsUpload()">📂 رفع تكلفة المنتجات'+((FOODICS_CSV_LOADED||PRODUCTS_MASTER_LOADED)?' ✅':' ⚠️')+'</button>';
  if (role==='pricing') btns += '<button class="tb'+(view==='decisionlog'?' on':'')+'" onclick="view=\'decisionlog\';detailId=null;render()">📋 سجل القرارات</button>';
  if (role==='pricing') btns += '<button class="tb" onclick="BARQ_TAS.exportCSV()">📤 تصدير Foodics</button>';
  btns += '<button class="tb'+(view==='synccenter'?' on':'')+'" onclick="view=\'synccenter\';detailId=null;render()">🔄 المزامنة</button>';

  var connBadge = '<span id="conn-badge" style="font-size:11px;font-weight:800;margin-right:6px"></span>';
  var pendingCount = OFFLINE_QUEUE.filter(function(o){return o.status!=='synced';}).length;
  var offlineBadge = '<span id="offline-indicator" onclick="view=\'synccenter\';detailId=null;render()" ' +
    'style="display:'+(pendingCount?'inline-flex':'none')+';align-items:center;gap:4px;background:#d68910;color:#fff;padding:4px 10px;border-radius:14px;font-size:11px;font-weight:800;cursor:pointer;margin-left:6px">' +
    '📴 '+pendingCount+' عملية بالانتظار</span>';
  // شريط الـ shell أصلاً بيعرض اسم القسم وهوية المستخدم وزرار الخروج — هنا
  // بس أزرار أدوات القسم + شارة الاتصال/المزامنة اللي مش موجودة هناك
  return '<div class="topbar topbar--slim"><div><div class="tb-role">'+connBadge+r.icon+' '+r.label+offlineBadge+'</div></div>' +
    '<div class="tb-btns">'+btns+'</div></div>';
}

// ═══════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════
function renderMain() {
  if (view === 'synccenter') return '<div class="pg">'+renderSyncCenter()+'</div>';
  if (role==='ceo')      return renderDashboard();
  if (role==='finmgr')   return '<div class="pg">'+renderFinMgr()+'</div>';
  if (role==='purchmgr') return '<div class="pg">'+renderPurchMgr()+'</div>';
  if (role==='receiving') return recvPO ? (isReturnMode ? renderReturnEntry() : renderReceiving()) : renderRecvQueue();
  if (role==='pricing')  return view==='decisionlog' ? renderDecisionLog() : renderPricingQueue();
  if (role==='finance')  return renderFinance();
  return '';
}
function goQueue() { view='queue'; detailId=null; recvPO=null; render(); }

// ═══════════════════════════════════════════════
// 1. RECEIVING (الاستلام)
// ═══════════════════════════════════════════════
function renderRecvQueue() {
  var pending = MOCK_PO.filter(function(p){return p.status===STATUSES.receiving;});

  var topBtns = '<div class="cd" style="background:linear-gradient(135deg,#fafdfb,#f0f9f4)">' +
    '<div class="ct" style="margin-bottom:8px">⚙️ أدوات</div>' +
    '<div class="br" style="margin-top:0">' +
      '<button class="bn bn-b" onclick="BARQ_TAS.showProductUpload()">📂 رفع مواد المخزون</button>' +
      '<button class="bn bn-o" onclick="BARQ_TAS.openManualInvoice()">🧾 إنشاء فاتورة يدوية (خارج أوامر الشراء)</button>' +
      '<button class="bn" style="background:#8e44ad;color:#fff" onclick="BARQ_TAS.openReturnEntry()">↩️ تسجيل مرتجع للمورد</button>' +
    '</div>' +
    '<div id="prod-up-wrap" style="display:none;margin-top:12px">' +
      '<div class="up-zone" onclick="BARQ_TAS.triggerProdUpload()">' +
        '<input type="file" id="prod-up-inp" accept=".xlsx,.xls,.csv" onchange="BARQ_TAS.handleProductUpload(this)" style="display:none">' +
        '<div style="font-size:26px;margin-bottom:6px">📂</div>' +
        '<div style="font-weight:700;color:var(--primary)">اضغط لرفع ملف مواد المخزون</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:4px">✅ الأفضل: تقرير "مستويات المخزون" (Inventory Levels) — تكلفة أدق وأشمل<br>يقبل أيضاً: ملف المنتجات الكامل من فودكس (22 عمود) أو ملف مبسط</div>' +
        '<div style="font-size:11px;color:var(--muted)">Excel أو CSV — يحدّث يومياً</div>' +
      '</div>' +
      '<div id="prod-up-result" style="margin-top:10px;font-size:12px"></div>' +
    '</div>' +
  '</div>';

  if (!pending.length) return topBtns + '<div class="cd"><div class="ct">📦 الاستلام</div>' +
    '<div class="empty"><div class="empty-i">📭</div><div>لا توجد أوامر شراء للاستلام</div></div></div>';

  var cards = pending.map(function(po){
    var items=[]; try{items=JSON.parse(po.items);}catch(e){}
    return '<div class="po-card st-recv" onclick="BARQ_TAS.openReceive(\''+po.id+'\')">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
        '<div><div style="font-weight:800;color:var(--primary);font-size:14px">'+po.po_number+'</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:3px">🏪 '+esc(po.supplier_name)+' | 👤 '+esc(po.officer_name)+' | 📦 '+items.length+' صنف</div></div>' +
        '<span class="bg bg-recv">'+STATUSES.receiving+'</span>' +
      '</div></div>';
  }).join('');

  return topBtns + '<div class="cd"><div class="ct">📦 أوامر الشراء الواردة <span class="bg bg-recv">'+pending.length+'</span></div>'+cards+'</div>';
}

function openReceive(poId) {
  var po = MOCK_PO.find(function(p){return p.id===poId;});
  if (!po) return;
  recvPO = po;
  isManualInvoice = false;
  var items=[]; try{items=JSON.parse(po.items);}catch(e){}
  recvItems = items.map(function(item){
    var prod = PRODUCTS[item.sku] || {};
    return {
      sku: item.sku||'', name: item.product_name||'', unit: item.unit||'', bc: prod.bc||'',
      qty_ordered: item.qty_ordered||0, qty_received: '',
      old_cost: getCurrentCost(item.sku), old_price: prod.p||0, stored_margin: prod.margin||22,
      stock_before: (item.current_stock!==undefined && item.current_stock!==null) ? item.current_stock : null,
      new_cost: '', match: 'pending'
    };
  });
  render();
}

function openManualInvoice() {
  recvPO = { id:'manual', po_number:'فاتورة-يدوية-'+Date.now().toString().slice(-5), supplier_name:'', officer_name: ROLES.receiving.label };
  recvItems = [];
  isManualInvoice = true;
  isReturnMode = false;
  render();
}

function openReturnEntry() {
  recvPO = { id:'return', po_number:'مرتجع-'+Date.now().toString().slice(-5), supplier_name:'', officer_name: ROLES.receiving.label };
  recvItems = [];
  isManualInvoice = false;
  isReturnMode = true;
  returnPerson = '';
  returnReason = '';
  render();
}

// ── Supplier search (341 مورد حقيقي من فودكس) ──
function supplierSearch() {
  var inp = document.getElementById('rv-supplier-search');
  var box = document.getElementById('supplier-results');
  if (!inp || !box) return;
  var q = inp.value.trim().toLowerCase();
  recvPO.supplier_name = inp.value; // keep typed text live (validated on approve)

  if (!q) { box.style.display='none'; box.innerHTML=''; return; }

  var matches = SUPPLIERS_DB.filter(function(s){
    return s.name.toLowerCase().indexOf(q) >= 0;
  }).slice(0, 12);

  if (!matches.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--muted)">لا يوجد مورد بهذا الاسم في فودكس — تأكد من الاسم بالضبط</div>';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = matches.map(function(s){
    return '<div onclick="BARQ_TAS.selectSupplier(\''+s.name.replace(/'/g,"\\'")+'\')" ' +
      'style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;display:flex;justify-content:space-between" ' +
      'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">' +
      '<span style="font-weight:600">'+esc(s.name)+'</span>' +
      (s.contact ? '<span style="color:var(--muted);font-size:11px">'+esc(s.contact)+'</span>' : '') +
    '</div>';
  }).join('');
}

function selectSupplier(name) {
  recvPO.supplier_name = name;
  var inp = document.getElementById('rv-supplier-search');
  if (inp) inp.value = name;
  var box = document.getElementById('supplier-results');
  if (box) { box.style.display='none'; box.innerHTML=''; }
}

// Close supplier dropdown when clicking outside
document.addEventListener('click', function(e){
  var box = document.getElementById('supplier-results');
  var inp = document.getElementById('rv-supplier-search');
  if (box && box.style.display!=='none' && e.target!==inp && !box.contains(e.target)) {
    box.style.display = 'none';
  }
});

function manualAddProduct(sku) {
  var prod = PRODUCTS[sku];
  if (!prod) return;
  if (recvItems.find(function(it){return it.sku===sku;})) { toast('الصنف مضاف بالفعل'); return; }
  recvItems.push({
    sku: sku, name: prod.n, unit: 'وحدة', bc: prod.bc||'',
    qty_ordered: 0, qty_received: 1,
    old_cost: getCurrentCost(sku), old_price: prod.p||0, stored_margin: prod.margin||22,
    new_cost: '', match: 'manual'
  });
  render();
  refocusScan();
}

function manualSearchProducts() {
  var q = ((document.getElementById('manual-search')||{}).value||'').trim().toLowerCase();
  var box = document.getElementById('manual-search-results');
  if (!box) return;
  if (q.length < 2) { box.innerHTML=''; return; }
  var matches = Object.keys(PRODUCTS).filter(function(sku){
    var p = PRODUCTS[sku];
    return p.n.toLowerCase().indexOf(q)>=0 || sku.toLowerCase().indexOf(q)>=0 || (p.bc||'').indexOf(q)>=0;
  }).slice(0,8);
  if (!matches.length) { box.innerHTML = '<div style="padding:8px;color:var(--muted);font-size:12px">لا توجد نتائج</div>'; return; }
  box.innerHTML = matches.map(function(sku){
    var p = PRODUCTS[sku];
    return '<div onclick="BARQ_TAS.manualAddProduct(\''+sku+'\')" style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;display:flex;justify-content:space-between" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">' +
      '<span>'+esc(p.n)+'</span><span style="color:var(--muted)">'+sku+'</span></div>';
  }).join('');
}

function manualRemoveItem(i) {
  recvItems.splice(i,1);
  render();
}

// ═══════════════════════════════════════════════
// PRODUCT MASTER-DATA UPLOAD — رفع مواد المخزون (يومي)
// Expected columns (any order, case-insensitive): sku, name, barcode, cost, price
// ═══════════════════════════════════════════════
function showProductUpload() {
  var w = document.getElementById('prod-up-wrap');
  if (w) w.style.display = w.style.display==='none' ? 'block' : 'none';
}
function triggerProdUpload() {
  var el = document.getElementById('prod-up-inp');
  if (el) el.click();
}

var _xlsxLibLoaded = false;
function loadXlsxLib(cb) {
  if (_xlsxLibLoaded || window.XLSX) { _xlsxLibLoaded = true; cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js';
  s.onload = function(){ _xlsxLibLoaded = true; cb(); };
  s.onerror = function(){ toast('⚠️ تعذر تحميل مكتبة قراءة الإكسل'); };
  document.body.appendChild(s);
}

function handleProductUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var resBox = document.getElementById('prod-up-result');
  if (resBox) resBox.innerHTML = '⏳ جاري المعالجة...';

  var isCSV = /\.csv$/i.test(file.name);

  if (isCSV) {
    var reader = new FileReader();
    reader.onload = function(e){ processFoodicsFullFile(e.target.result, file.name, resBox); };
    reader.readAsText(file, 'UTF-8');
  } else {
    loadXlsxLib(function(){
      var reader = new FileReader();
      reader.onload = function(e){
        try {
          var data = new Uint8Array(e.target.result);
          var wb = XLSX.read(data, {type:'array'});
          var sheet = wb.Sheets[wb.SheetNames[0]];
          var json = XLSX.utils.sheet_to_json(sheet, {defval:''});
          processProductRows(json, file.name); // Excel path keeps simple sku/name/cost/price/barcode format
        } catch(err) {
          if (resBox) resBox.innerHTML = '⚠️ خطأ في قراءة الملف: '+err.message;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  input.value = '';
}

// ── Unified Foodics CSV parser — populates BOTH FOODICS_CACHE (full 22 cols, للتصدير)
// AND PRODUCTS (سعر/تكلفة/باركود مبسط، لشاشة الاستلام) من ملف واحد بس ──
async function processFoodicsFullFile(text, filename, resBox) {
  var lines = text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim();});
  if (!lines.length) { if(resBox) resBox.innerHTML = '⚠️ الملف فارغ'; return; }

  var headers = splitCSVLine(lines[0]).map(function(h){return h.replace(/^\uFEFF/,'').trim();});
  var hasFullFoodicsFormat = headers.indexOf('sku') > -1 && headers.indexOf('price') > -1;
  var hasInventoryFormat = headers.indexOf('SKU') > -1 && headers.indexOf('Cost Per Unit') > -1;

  if (hasInventoryFormat) {
    await processInventoryLevelsFile(lines, headers, filename, resBox);
    return;
  }

  if (!hasFullFoodicsFormat) {
    // Fallback: simple format (sku,name,barcode,cost,price)
    processProductRows(parseCSV(text), filename);
    return;
  }

  FOODICS_CACHE = {};
  var added = 0, updated = 0;
  var masterRows = [];
  for (var i=1; i<lines.length; i++) {
    var vals = splitCSVLine(lines[i]);
    var row = {};
    headers.forEach(function(h,j){ row[h] = (vals[j]||'').trim(); });
    if (!row.sku) continue;

    FOODICS_CACHE[row.sku] = row;

    // Derive simplified PRODUCTS entry for receiving screen
    var cost = parseFloat(row.cost) || 0;
    var price = parseFloat(row.price) || 0;
    if (PRODUCTS[row.sku]) {
      PRODUCTS[row.sku].n = row.name || PRODUCTS[row.sku].n;
      if (row.barcode) PRODUCTS[row.sku].bc = row.barcode;
      if (cost > 0) PRODUCTS[row.sku].c = cost;   // لا نستبدل تكلفة موجودة بصفر
      if (price > 0) PRODUCTS[row.sku].p = price;
      updated++;
    } else {
      PRODUCTS[row.sku] = {
        n: row.name || '', c: cost, p: price, bc: row.barcode || '',
        margin: (cost>0 && price>0) ? ((price-cost)/price*100) : 22
      };
      added++;
    }

    masterRows.push({
      sku: row.sku, name: row.name||'', barcode: row.barcode||'',
      cost: cost, price: price,
      margin: (cost>0 && price>0) ? ((price-cost)/price*100) : 22
    });
  }

  FOODICS_CSV_LOADED = true;
  if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#fef9e7;border-radius:8px;font-size:13px">⏳ جاري الحفظ الدائم في قاعدة البيانات...</div>';
  toast('⏳ جاري حفظ '+masterRows.length+' صنف بشكل دائم...');

  // Bulk upsert to products_master in batches of 500 (Supabase-friendly)
  var batchSize = 500;
  var queuedBatches = 0;
  for (var b=0; b<masterRows.length; b+=batchSize) {
    var chunk = masterRows.slice(b, b+batchSize);
    var res = await sbWrite('products_master?on_conflict=sku', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk)
    }, { opType:'تحديث_منتج', label:'دفعة تكلفة منتجات ('+chunk.length+' صنف)' });
    if (res.queued) queuedBatches++;
  }
  PRODUCTS_MASTER_LOADED = true;
  addAudit('رفع تكلفة المنتجات (حفظ دائم)', ROLES[role]?ROLES[role].label:'—', filename+' — جديد: '+added+' | محدّث: '+updated+' — محفوظ في القاعدة');
  if (queuedBatches > 0) {
    if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#fef9e7;border-radius:8px;font-size:13px">' +
      '📴 تم تحميل البيانات محلياً — '+queuedBatches+' دفعة ستُرفع تلقائياً عند عودة الاتصال<br>' +
      '<span style="font-size:11px;color:var(--muted)">'+added+' صنف جديد، '+updated+' صنف محدّث</span></div>';
    toast('📴 تم التحميل محلياً — سيُرفع تلقائياً');
  } else {
    if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#eafaf1;border-radius:8px;font-size:13px">' +
      '✅ تم: <strong>'+added+'</strong> صنف جديد، <strong>'+updated+'</strong> صنف محدّث<br>' +
      '<span style="font-size:11px;color:var(--muted)">تم الحفظ بشكل دائم — لن تحتاج لرفع هذا الملف مرة أخرى</span>' +
      '</div>';
    toast('✅ تم حفظ '+(added+updated)+' صنف بشكل دائم في قاعدة البيانات');
  }
}

// ── معالجة شيت "مستويات المخزون" — Name, SKU, Barcode, Storage Unit, Quantity, Cost Per Unit, Total Cost ──
async function processInventoryLevelsFile(lines, headers, filename, resBox) {
  var idx = {};
  headers.forEach(function(h,i){ idx[h] = i; });

  var added = 0, updated = 0, skipped = 0;
  var masterRows = [];

  for (var i=1; i<lines.length; i++) {
    var vals = splitCSVLine(lines[i]);
    var sku  = (vals[idx['SKU']]||'').trim();
    var name = (vals[idx['Name']]||'').trim();
    var bc   = (vals[idx['Barcode']]||'').trim();
    var cost = parseFloat(vals[idx['Cost Per Unit']]) || 0;
    if (!sku || !name) { skipped++; continue; }
    if (cost <= 0) { skipped++; continue; } // نتجاهل الأصناف اللي مالهاش تكلفة في هذا الشيت

    var existingPrice = PRODUCTS[sku] ? PRODUCTS[sku].p : 0;

    if (PRODUCTS[sku]) {
      PRODUCTS[sku].n = name;
      if (bc) PRODUCTS[sku].bc = bc;
      PRODUCTS[sku].c = cost; // شيت مستويات المخزون هو المرجع الأدق للتكلفة — يُستبدل دائماً
      updated++;
    } else {
      PRODUCTS[sku] = { n:name, c:cost, p:0, bc:bc, margin:22 };
      added++;
    }

    masterRows.push({
      sku: sku, name: name, barcode: bc, cost: cost,
      price: existingPrice, margin: (existingPrice>0) ? ((existingPrice-cost)/existingPrice*100) : 22
    });
  }

  if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#fef9e7;border-radius:8px;font-size:13px">⏳ جاري الحفظ الدائم في قاعدة البيانات...</div>';
  toast('⏳ جاري حفظ '+masterRows.length+' صنف من مستويات المخزون...');

  var batchSize = 500;
  var queuedBatches = 0;
  for (var b=0; b<masterRows.length; b+=batchSize) {
    var chunk = masterRows.slice(b, b+batchSize);
    var res = await sbWrite('products_master?on_conflict=sku', {
      method:'POST',
      headers: { 'Prefer':'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk)
    }, { opType:'تحديث_منتج', label:'دفعة تكلفة (مستويات المخزون) — '+chunk.length+' صنف' });
    if (res.queued) queuedBatches++;
  }
  PRODUCTS_MASTER_LOADED = true;
  FOODICS_CSV_LOADED = true;
  addAudit('رفع تكلفة المنتجات (مستويات المخزون)', ROLES[role]?ROLES[role].label:'—',
    filename+' — جديد: '+added+' | محدّث: '+updated+' | متجاهَل (بدون تكلفة): '+skipped);
  if (queuedBatches > 0) {
    if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#fef9e7;border-radius:8px;font-size:13px">📴 تم التحميل محلياً — '+queuedBatches+' دفعة ستُرفع تلقائياً</div>';
    toast('📴 تم التحميل محلياً — سيُرفع تلقائياً');
  } else {
    if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#eafaf1;border-radius:8px;font-size:13px">' +
      '✅ تم: <strong>'+added+'</strong> صنف جديد، <strong>'+updated+'</strong> صنف محدّث<br>' +
      '<span style="font-size:11px;color:var(--muted)">'+skipped+' صنف تم تجاهله (بدون تكلفة في هذا الشيت) — محفوظ بشكل دائم</span>' +
      '</div>';
    toast('✅ تم حفظ '+(added+updated)+' صنف بتكلفة حقيقية من مستويات المخزون');
  }
}

function parseCSV(text) {
  var lines = text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim();});
  if (!lines.length) return [];
  var headers = splitCSVLine(lines[0]).map(function(h){return h.trim();});
  return lines.slice(1).map(function(line){
    var vals = splitCSVLine(line);
    var obj = {};
    headers.forEach(function(h,i){ obj[h] = (vals[i]||'').trim(); });
    return obj;
  });
}

function processProductRows(rows, filename) {
  var resBox = document.getElementById('prod-up-result');
  if (!rows || !rows.length) {
    if (resBox) resBox.innerHTML = '⚠️ الملف فارغ أو غير صالح';
    return;
  }

  /* pickField() defined globally above */

  var added = 0, updated = 0;
  rows.forEach(function(row){
    var sku   = String(pickField(row, ['sku','code','كود'])).trim();
    var name  = String(pickField(row, ['name','الاسم','product_name'])).trim();
    var bc    = String(pickField(row, ['barcode','باركود','bc'])).trim();
    var cost  = parseFloat(pickField(row, ['cost','تكلفة','c'])) || 0;
    var price = parseFloat(pickField(row, ['price','سعر','p'])) || 0;
    if (!sku || !name) return;

    if (PRODUCTS[sku]) {
      PRODUCTS[sku].n = name;
      if (bc) PRODUCTS[sku].bc = bc;
      if (cost) PRODUCTS[sku].c = cost;
      if (price) PRODUCTS[sku].p = price;
      updated++;
    } else {
      PRODUCTS[sku] = { n:name, c:cost, p:price, bc:bc, margin: cost&&price ? ((price-cost)/price*100) : 22 };
      added++;
    }
  });

  addAudit('رفع مواد المخزون', ROLES[role] ? ROLES[role].label : '—', filename+' — جديد: '+added+' | محدّث: '+updated);
  if (resBox) resBox.innerHTML = '✅ تم: <strong>'+added+'</strong> صنف جديد، <strong>'+updated+'</strong> صنف محدّث (إجمالي القاعدة: '+Object.keys(PRODUCTS).length+')';
  toast('✅ تم تحديث مواد المخزون');
}

function renderReceiving() {
  var cards = recvItems.map(function(item,i){
    var noCost = (!item.old_cost || item.old_cost <= 0);
    var qtyOrderedLine = isManualInvoice ? '' :
      '<span style="color:var(--blue);font-weight:800">المطلوب: '+item.qty_ordered+'</span>';
    var removeBtn = isManualInvoice
      ? '<button onclick="BARQ_TAS.manualRemoveItem('+i+')" style="background:none;border:none;color:#c0392b;font-size:18px;padding:4px 8px">✕</button>'
      : '';
    var matchBadge = item.match==='ok' ? '<span style="background:#eafaf1;color:#1a7a40;font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px">✅ مطابق</span>'
      : item.match==='diff' ? '<span style="background:#fce4ec;color:#c0392b;font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px">⚠️ فرق</span>' : '';

    return '<div class="item-card-mobile'+(noCost?' warn':'')+'" id="row-'+i+'">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="item-name">'+esc(item.name)+'</div>' +
          '<div class="item-meta">'+item.sku+(item.bc?' | 🏷️'+esc(item.bc):'')+' | '+esc(item.unit)+'</div>' +
        '</div>' +
        removeBtn +
      '</div>' +
      (noCost ? '<div style="background:#c0392b;color:#fff;font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;display:inline-block;margin-bottom:8px">⚠️ بدون تكلفة سابقة</div>' : '') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        qtyOrderedLine + matchBadge +
      '</div>' +
      '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">الكمية المستلمة</label>' +
      '<div class="qty-stepper">' +
        '<button type="button" onclick="BARQ_TAS.stepQty('+i+',1)">+</button>' +
        '<input type="number" id="qr-'+i+'" inputmode="decimal" ' +
          'value="'+(item.qty_received===''?'':item.qty_received)+'" ' +
          'oninput="BARQ_TAS.checkQty('+i+',this.value)">' +
        '<button type="button" onclick="BARQ_TAS.stepQty('+i+',-1)">−</button>' +
      '</div>' +
      '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin:8px 0 4px">تكلفة الشراء (للوحدة)</label>' +
      '<input type="number" id="nc-'+i+'" class="cost-input-mobile" inputmode="decimal" placeholder="'+(item.old_cost>0?item.old_cost.toFixed(2):'0.00')+'" ' +
        'value="'+(item.new_cost===''?'':item.new_cost)+'" ' +
        'oninput="recvItems['+i+'].new_cost=parseFloat(this.value)||0">' +
      (item.old_cost>0 ?
        '<div style="font-size:11px;color:#1a7a40;margin-top:4px">💡 آخر تكلفة مسجلة: '+fmt(item.old_cost)+' ج</div>' : '') +
    '</div>';
  }).join('');

  var headerTitle = isManualInvoice
    ? '🧾 فاتورة يدوية (خارج أوامر الشراء)'
    : '📦 '+recvPO.po_number;

  var supplierBox = isManualInvoice
    ? '<div style="position:relative;margin-bottom:10px">' +
        '<input type="text" class="fi" id="rv-supplier-search" autocomplete="off" placeholder="🔍 ابحث عن المورد بالاسم..." ' +
        'style="padding:12px;font-size:14px" value="'+esc(recvPO.supplier_name||'')+'" oninput="BARQ_TAS.supplierSearch()" onfocus="BARQ_TAS.supplierSearch()">' +
        '<div id="supplier-results" style="display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:220px;overflow-y:auto;z-index:50;box-shadow:0 6px 18px rgba(0,0,0,.12);margin-top:3px"></div>' +
      '</div>'
    : '';

  var manualSearchBox = isManualInvoice
    ? '<div style="margin-bottom:10px">' +
        '<input type="text" id="manual-search" class="fi" placeholder="🔍 ابحث عن صنف بالاسم أو الكود..." ' +
          'style="padding:12px;font-size:14px" oninput="BARQ_TAS.manualSearchProducts()">' +
        '<div id="manual-search-results" style="border-radius:8px;overflow:hidden;border:1px solid var(--border);margin-top:6px"></div>' +
      '</div>'
    : '';

  var rejectBtn = isManualInvoice ? '' :
    '<button class="big-action-btn" style="background:var(--bg);color:#c0392b;border:2px solid #c0392b" onclick="BARQ_TAS.rejectRecv()">❌ رفض — فرق في الكميات</button>';

  return '<div>' +

    // شريط ملخص مضغوط
    '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--card);border-radius:12px;padding:10px 14px;margin-bottom:10px;border:1px solid var(--border)">' +
      '<div>' +
        '<div style="font-size:14px;font-weight:800;color:var(--primary)">'+headerTitle+'</div>' +
        '<div style="font-size:11px;color:var(--muted)">🏪 '+esc(recvPO.supplier_name||'—')+' | 👤 '+esc(recvPO.officer_name)+'</div>' +
      '</div>' +
      '<button style="background:none;border:none;font-size:13px;color:var(--muted);padding:6px" onclick="recvPO=null;isManualInvoice=false;render()">✕</button>' +
    '</div>' +

    supplierBox + manualSearchBox +

    // فرع + رقم فاتورة — مضغوطين
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
      '<select class="fi" id="rv-branch" style="padding:11px;font-size:13px"><option>المخزن الرئيسي</option><option>عين شمس</option><option>البتاش</option></select>' +
      '<input type="text" class="fi" id="rv-invoice" placeholder="رقم فاتورة المورد" style="padding:11px;font-size:13px">' +
    '</div>' +

    // شريط المسح — Sticky وكبير
    '<div class="scan-bar-mobile">' +
      '<input type="text" id="scan-inp" class="scan-input-mobile" autocomplete="off" ' +
        'placeholder="📷🔫⌨️ امسح الباركود..." ' +
        'onkeydown="if(event.key===\'Enter\'){handleScan(this.value);this.value=\'\';}" autofocus>' +
      '<div style="display:flex;gap:6px;margin-top:6px">' +
        '<button class="bn bn-o" style="flex:1;padding:10px;font-size:14px" onclick="BARQ_TAS.openCameraScan()">📷 مسح بالكاميرا</button>' +
      '</div>' +
    '</div>' +
    '<div id="scan-msg" style="font-size:13px;font-weight:700;text-align:center;margin-bottom:10px;min-height:20px"></div>' +
    '<div id="cam-scan-wrap" style="display:none;margin-bottom:12px;border-radius:12px;overflow:hidden;border:2px solid var(--accent)">' +
      '<div id="cam-reader" style="width:100%"></div>' +
      '<button class="bn bn-d" style="width:100%;border-radius:0;padding:12px" onclick="BARQ_TAS.closeCameraScan()">✕ إغلاق الكاميرا</button>' +
    '</div>' +

    // عداد الأصناف
    (recvItems.length ? '<div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">📦 '+recvItems.length+' صنف</div>' : '') +

    // بطاقات الأصناف
    (cards || '<div class="empty"><div class="empty-i">📭</div><div>امسح أول صنف للبدء</div></div>') +

    // الأزرار — full-width تحت بعض
    '<div style="margin-top:16px">' +
      '<button class="big-action-btn" style="background:var(--accent);color:#fff" onclick="BARQ_TAS.approveRecv()">✅ اعتماد الاستلام وإرسال</button>' +
      rejectBtn +
      '<button class="big-action-btn" style="background:var(--bg);color:var(--text);border:1px solid var(--border)" onclick="BARQ_TAS.exportFoodicsPurchase()">📤 تصدير CSV (فودكس)</button>' +
      '<button class="big-action-btn" style="background:var(--bg);color:var(--text);border:1px solid var(--border)" onclick="BARQ_TAS.printFoodicsInvoice()">🖨️ طباعة الفاتورة</button>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--muted);text-align:center;margin-top:6px">بعد الاعتماد يتم الإرسال تلقائياً للمالية والتسعير</div>' +
  '</div>';
}

// ── زيادة/إنقاص الكمية بلمسة واحدة (Stepper) ──
function stepQty(i, delta) {
  var current = parseFloat(recvItems[i].qty_received) || 0;
  var next = Math.max(0, current + delta);
  recvItems[i].qty_received = next;
  var inp = document.getElementById('qr-'+i);
  if (inp) inp.value = next;
  checkQty(i, next);
}


// ═══════════════════════════════════════════════
// RETURN ENTRY SCREEN — تسجيل مرتجع للمورد
// ═══════════════════════════════════════════════
function renderReturnEntry() {
  var rows = recvItems.map(function(item,i){
    var cost = item.old_cost || 0;
    var lineTotal = (parseFloat(item.qty_received)||0) * cost;
    return '<tr id="row-'+i+'">' +
      '<td style="font-weight:700">'+esc(item.name)+'<br><span style="font-size:10px;color:var(--muted)">'+item.sku+(item.bc?' | 🏷️'+esc(item.bc):'')+' | '+esc(item.unit)+'</span></td>' +
      '<td><input type="number" class="fi fi-green" id="qr-'+i+'" placeholder="الكمية المرتجعة" min="0" step="1" ' +
        'value="'+(item.qty_received===''?'':item.qty_received)+'" ' +
        'oninput="BARQ_TAS.returnUpdateQty('+i+',this.value)"></td>' +
      '<td style="text-align:center;font-weight:700;color:var(--blue)">'+fmt(cost)+' ج</td>' +
      '<td style="text-align:center;font-weight:800;color:var(--primary)" id="lt-'+i+'">'+fmt(lineTotal)+' ج</td>' +
      '<td><button class="bn bn-d" style="padding:4px 8px;font-size:11px" onclick="BARQ_TAS.manualRemoveItem('+i+')">✕</button></td>' +
    '</tr>';
  }).join('');

  var totalReturn = recvItems.reduce(function(s,it){ return s + (parseFloat(it.qty_received)||0)*(it.old_cost||0); }, 0);

  return '<div class="cd" style="border-right:4px solid #8e44ad">' +
    '<div class="ct">↩️ تسجيل مرتجع للمورد' +
      '<button class="bn bn-g" style="font-size:11px" onclick="recvPO=null;isReturnMode=false;render()">← رجوع</button></div>' +

    '<div style="position:relative;margin-bottom:12px">' +
      '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">المورد *</label>' +
      '<input type="text" class="fi" id="rv-supplier-search" autocomplete="off" placeholder="🔍 ابحث عن المورد بالاسم..." ' +
      'value="'+esc(recvPO.supplier_name||'')+'" oninput="BARQ_TAS.supplierSearch()" onfocus="BARQ_TAS.supplierSearch()">' +
      '<div id="supplier-results" style="display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:220px;overflow-y:auto;z-index:50;box-shadow:0 6px 18px rgba(0,0,0,.12);margin-top:3px"></div>' +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
      '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">اسم الشخص الذي قام بالمرتجع *</label>' +
        '<input type="text" class="fi" id="return-person" placeholder="اسم الموظف" value="'+returnPerson+'" ' +
        'oninput="returnPerson=this.value"></div>' +
      '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">رقم فاتورة المورد *</label>' +
        '<input type="text" class="fi" id="rv-invoice" placeholder="رقم الفاتورة المرتبطة بالمرتجع" required></div>' +
    '</div>' +

    '<div style="margin-bottom:14px">' +
      '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">سبب المرتجع *</label>' +
      '<select class="fi" id="return-reason" onchange="returnReason=this.value">' +
        '<option value="">-- اختار السبب --</option>' +
        '<option value="منتجات منتهية الصلاحية">منتجات منتهية الصلاحية</option>' +
        '<option value="عيب في المنتج">عيب في المنتج</option>' +
        '<option value="كمية زيادة عن المطلوب">كمية زيادة عن المطلوب</option>' +
        '<option value="غلط في التوريد">غلط في التوريد (صنف مختلف)</option>' +
        '<option value="رفض جودة">رفض جودة</option>' +
        '<option value="أخرى">أخرى</option>' +
      '</select>' +
    '</div>' +

    '<div style="padding:10px 12px;background:#f3e5f5;border-radius:8px;font-size:12px;margin-bottom:14px">' +
      '↩️ <strong>امسح أو ابحث عن الصنف المرتجع</strong> — سيتم خصم القيمة تلقائياً من حساب المورد</div>' +

    '<div style="display:flex;gap:6px;margin-bottom:14px;align-items:stretch">' +
      '<input type="text" id="scan-inp" class="fi" autocomplete="off" ' +
        'placeholder="📷🔫⌨️ امسح الباركود أو اكتبه يدوياً ثم Enter" ' +
        'style="flex:1;font-size:14px;font-weight:700;text-align:right;padding:11px" ' +
        'onkeydown="if(event.key===\'Enter\'){handleScan(this.value);this.value=\'\';}" autofocus>' +
      '<button class="bn bn-o" style="font-size:18px;padding:8px 14px" onclick="BARQ_TAS.openCameraScan()" title="مسح بكاميرا الموبايل">📷</button>' +
    '</div>' +
    '<div id="scan-msg" style="font-size:12px;margin-bottom:6px;min-height:18px"></div>' +

    '<div style="margin-bottom:14px">' +
      '<input type="text" id="manual-search" class="fi" placeholder="🔍 أو ابحث عن صنف بالاسم أو الكود..." ' +
        'oninput="BARQ_TAS.manualSearchProducts()" style="margin-bottom:6px">' +
      '<div id="manual-search-results" style="border-radius:8px;overflow:hidden;border:1px solid var(--border)"></div>' +
    '</div>' +

    '<div id="cam-scan-wrap" style="display:none;margin-bottom:14px;border-radius:10px;overflow:hidden;border:2px solid #8e44ad">' +
      '<div id="cam-reader" style="width:100%"></div>' +
      '<button class="bn bn-d" style="width:100%;border-radius:0" onclick="BARQ_TAS.closeCameraScan()">✕ إغلاق الكاميرا</button>' +
    '</div>' +

    '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border);margin-bottom:14px">' +
    '<table class="ft"><thead><tr>' +
      '<th>الصنف</th><th style="text-align:center;width:110px">الكمية المرتجعة</th>' +
      '<th style="text-align:center;width:100px">تكلفة الوحدة</th>' +
      '<th style="text-align:center;width:100px">الإجمالي</th><th style="width:40px"></th>' +
    '</tr></thead><tbody>'+(rows||'<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">لا توجد أصناف بعد</td></tr>')+'</tbody>' +
    '<tfoot><tr style="background:#f3e5f5">' +
      '<td colspan="3" style="padding:10px 12px;font-weight:800">إجمالي قيمة المرتجع</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:900;font-size:16px;color:#8e44ad" id="return-total">'+fmt(totalReturn)+' ج</td><td></td>' +
    '</tr></tfoot>' +
    '</table></div>' +

    '<div class="br">' +
      '<button class="bn" style="background:#8e44ad;color:#fff" onclick="BARQ_TAS.submitReturn()">↩️ تأكيد المرتجع وخصمه من حساب المورد</button>' +
      '<button class="bn bn-o" onclick="BARQ_TAS.exportReturnQtyAdjustment()">📤 رفع تعديل الكميات (فودكس)</button>' +
      '<button class="bn bn-g" onclick="recvPO=null;isReturnMode=false;render()">إلغاء</button>' +
    '</div>' +
  '</div>';
}

function exportReturnQtyAdjustment() {
  var items = recvItems.filter(function(it){ return parseFloat(it.qty_received) > 0; });
  if (!items.length) { toast('⚠️ أضف أصناف بكميات أولاً'); return; }
  var csv = '\uFEFFname,sku,storage_quantity,ingredients_quantity\n';
  items.forEach(function(it){
    var qty = parseFloat(it.qty_received) || 0;
    var name = (it.name||'').replace(/,/g,' ');
    // فودكس يطلب قيمة موجبة دائماً — الاتجاه (خصم/إضافة) يُحدَّد من نوع العملية وقت الرفع على فودكس نفسه
    // العمود الرابع لازم يكون موجود في الرأس لكن فارغ القيمة (وإلا يرفض فودكس الملف)
    csv += name+','+it.sku+','+qty+',\n';
  });
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'foodics_qty_adjustment_return_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('✅ تم تصدير ملف تعديل الكميات — '+items.length+' صنف');
}

function returnUpdateQty(i, val) {
  recvItems[i].qty_received = parseFloat(val) || 0;
  var lt = document.getElementById('lt-'+i);
  if (lt) lt.textContent = fmt(recvItems[i].qty_received * (recvItems[i].old_cost||0)) + ' ج';
  var totalEl = document.getElementById('return-total');
  if (totalEl) {
    var total = recvItems.reduce(function(s,it){ return s + (parseFloat(it.qty_received)||0)*(it.old_cost||0); }, 0);
    totalEl.textContent = fmt(total) + ' ج';
  }
}

async function submitReturn() {
  var supplierName = (document.getElementById('rv-supplier-search')||{}).value || recvPO.supplier_name || '';
  var invoiceNum = (document.getElementById('rv-invoice')||{}).value || '';
  var person = returnPerson.trim();
  var reason = returnReason;

  if (!supplierName.trim()) { toast('⚠️ اختار المورد أولاً'); return; }
  if (!person) { toast('⚠️ اكتب اسم الشخص الذي قام بالمرتجع'); return; }
  if (!invoiceNum.trim()) { toast('⚠️ رقم فاتورة المورد إجباري'); return; }
  if (!reason) { toast('⚠️ اختار سبب المرتجع'); return; }
  if (!recvItems.length) { toast('⚠️ أضف صنف واحد على الأقل'); return; }

  var hasQty = recvItems.some(function(it){ return parseFloat(it.qty_received) > 0; });
  if (!hasQty) { toast('⚠️ أدخل الكمية المرتجعة لصنف واحد على الأقل'); return; }

  var totalAmount = recvItems.reduce(function(s,it){ return s + (parseFloat(it.qty_received)||0)*(it.old_cost||0); }, 0);
  var itemsDetail = recvItems.filter(function(it){ return parseFloat(it.qty_received)>0; })
    .map(function(it){ return it.name+' × '+it.qty_received; }).join('، ');

  toast('⏳ جاري الحفظ...');
  var result = await sbWrite('supplier_returns', {
    method:'POST',
    body: JSON.stringify({
      supplier_name: supplierName.trim(),
      amount: totalAmount,
      reason: reason,
      detail: 'فاتورة: '+invoiceNum+' — بواسطة: '+person+' — الأصناف: '+itemsDetail,
      done_by: person
    })
  }, { opType:'مرتجع_مورد', label:'مرتجع استلام: '+supplierName+' — '+fmt(totalAmount)+' ج',
       afterData:{supplier:supplierName, amount:totalAmount} });

  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supplierName.trim();});
  if (!finSup) { finSup={name:supplierName.trim(),balance:0,payments:[],returns:[]}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.returns) finSup.returns=[];
  finSup.returns.push({ amount:totalAmount, reason:reason, detail:itemsDetail, date:now(), rawDate:new Date().toISOString() });

  addAudit('تسجيل مرتجع من الاستلام', ROLES.receiving.label,
    supplierName+' — '+fmt(totalAmount)+' ج — '+reason+' — بواسطة: '+person+' — فاتورة: '+invoiceNum);
  toast(result.queued ? '📴 تم الحفظ محلياً — سيُرفع تلقائياً' : '✅ تم تسجيل المرتجع وخصم '+fmt(totalAmount)+' ج من حساب '+supplierName);
  recvPO = null; isReturnMode = false; recvItems = [];
  autosaveReceiving();
  render();
}

// ═══════════════════════════════════════════════
// FOODICS PURCHASE EXPORT — صيغة استيراد الوحدات
// name, sku, order_quantity, storage_quantity, total_cost
// ═══════════════════════════════════════════════
function exportFoodicsPurchase() {
  var rows = recvItems.filter(function(it){ return parseFloat(it.qty_received) > 0; });
  if (!rows.length) { toast('⚠️ أدخل الكميات المستلمة أولاً'); return; }
  var csv = '\uFEFFname,sku,order_quantity,storage_quantity,total_cost\n';
  rows.forEach(function(it){
    var qty = parseFloat(it.qty_received) || 0;
    var cost = parseFloat(it.new_cost) || it.old_cost || 0;
    var total = (qty * cost).toFixed(2);
    var name = (it.name||'').replace(/,/g,' ');
    csv += name+','+it.sku+','+','+qty+','+total+'\n'; // order_quantity فاضي عمداً
  });
  var blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'foodics_purchase_'+(recvPO.po_number||'')+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('✅ تم تصدير ملف فودكس');
}

function printFoodicsInvoice() {
  var rows = recvItems.filter(function(it){ return parseFloat(it.qty_received) > 0; });
  if (!rows.length) { toast('⚠️ أدخل الكميات المستلمة أولاً'); return; }

  var branch = (document.getElementById('rv-branch')||{}).value || 'المخزن الرئيسي (W01)';
  var invNum = (document.getElementById('rv-invoice')||{}).value || '—';
  var officer = recvPO.officer_name || '—';
  var supplier = recvPO.supplier_name || '—';
  var nowStr = new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}) +
    ' ' + new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});

  var subtotal = 0;
  var itemsHTML = rows.map(function(it){
    var qty = parseFloat(it.qty_received)||0;
    var cost = parseFloat(it.new_cost)||it.old_cost||0;
    var total = qty*cost;
    subtotal += total;
    return '<tr>' +
      '<td style="padding:10px;border-bottom:1px solid #eee">'+it.name+'</td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:center">'+it.sku+'</td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:center">'+qty+' '+it.unit+'</td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:center">'+cost.toFixed(2)+' EGP</td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:center;font-weight:700">'+total.toFixed(2)+' EGP</td>' +
    '</tr>';
  }).join('');

  var win = window.open('', '_blank');
  win.document.write(
    '<html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة شراء '+recvPO.po_number+'</title>' +
    '<style>' +
    'body{font-family:Tahoma,Arial,sans-serif;padding:30px;color:#1a1a1a;max-width:800px;margin:0 auto}' +
    '.hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #6b21a8;padding-bottom:14px;margin-bottom:20px}' +
    '.logo{font-size:22px;font-weight:900;color:#6b21a8}' +
    '.status{background:#888;color:#fff;padding:4px 14px;border-radius:6px;font-size:12px}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}' +
    '.box{padding:10px 0}' +
    '.box label{display:block;font-size:11px;color:#888;margin-bottom:3px}' +
    '.box span{font-size:14px;font-weight:700}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:20px}' +
    'th{background:#f5f5f5;padding:10px;text-align:right;font-size:12px;color:#555;border-bottom:2px solid #ddd}' +
    '.totals{margin-top:16px;border-top:2px solid #333;padding-top:12px}' +
    '.totals .row{display:flex;justify-content:space-between;padding:5px 0;font-size:14px}' +
    '.totals .grand{font-size:18px;font-weight:900;color:#6b21a8;border-top:1px solid #ddd;padding-top:8px;margin-top:6px}' +
    '@media print{body{padding:10px}}' +
    '</style></head><body>' +
    '<div class="hdr"><div class="logo">⚡ Foodics — أبو الفضل</div><div class="status">مسودة</div></div>' +
    '<div class="grid">' +
      '<div class="box"><label>المورد</label><span>'+supplier+'</span></div>' +
      '<div class="box"><label>الفرع</label><span>'+branch+'</span></div>' +
      '<div class="box"><label>رقم الفاتورة</label><span>'+invNum+'</span></div>' +
      '<div class="box"><label>تاريخ الفاتورة</label><span>'+nowStr+'</span></div>' +
      '<div class="box"><label>المنشئ</label><span>'+officer+'</span></div>' +
      '<div class="box"><label>عدد الأصناف</label><span>'+rows.length+'</span></div>' +
    '</div>' +
    '<table><thead><tr><th>الاسم</th><th style="text-align:center">كود التعريف</th><th style="text-align:center">الكمية</th><th style="text-align:center">تكلفة الوحدة</th><th style="text-align:center">إجمالي التكلفة</th></tr></thead>' +
    '<tbody>'+itemsHTML+'</tbody></table>' +
    '<div class="totals">' +
      '<div class="row"><span>المجموع الفرعي</span><span>EGP '+subtotal.toFixed(2)+'</span></div>' +
      '<div class="row"><span>إجمالي الضريبة</span><span>EGP 0.00</span></div>' +
      '<div class="row"><span>التكلفة الإضافية</span><span>EGP 0.00</span></div>' +
      '<div class="row grand"><span>الإجمالي</span><span>EGP '+subtotal.toFixed(2)+'</span></div>' +
    '</div>' +
    '<scr'+'ipt>window.onload=function(){window.print();}</scr'+'ipt>' +
    '</body></html>'
  );
  win.document.close();
}

function checkQty(i, val) {
  var qty = parseFloat(val) || 0;
  recvItems[i].qty_received = qty;

  if (isReturnMode) {
    returnUpdateQty(i, qty);
    return;
  }

  var icon = document.getElementById('mi-'+i);
  var note = document.getElementById('mn-'+i);

  if (isManualInvoice) {
    recvItems[i].match = qty>0 ? 'manual' : 'pending';
    if (icon) icon.textContent = qty>0 ? '➕' : '⬜';
    if (note) note.textContent = '';
    return;
  }

  var ordered = recvItems[i].qty_ordered;
  if (!qty) {
    recvItems[i].match = 'pending';
    if(icon) icon.textContent = '⬜';
    if(note) note.textContent = '';
    return;
  }
  if (qty === ordered) {
    recvItems[i].match = 'ok';
    if(icon) icon.textContent = '✅';
    if(note) note.textContent = 'مطابق';
    note.style.color = '#1a7a40';
  } else {
    recvItems[i].match = 'diff';
    if(icon) icon.textContent = '⚠️';
    var diff = qty - ordered;
    if(note) note.textContent = (diff>0?'+':'')+diff;
    note.style.color = '#c0392b';
  }
  // Highlight row
  var row = document.getElementById('qr-'+i);
  if (row) {
    var tr = row.closest('tr');
    if (tr) {
      tr.className = qty===ordered ? 'match-ok' : 'match-diff';
    }
  }
}

// ═══════════════════════════════════════════════
// BARCODE SCAN — سكنر فيزيائي + كتابة يدوية + كاميرا
// ═══════════════════════════════════════════════
function handleScan(code) {
  code = (code||'').trim();
  if (!code) return;
  var msg = document.getElementById('scan-msg');

  // Search by barcode first, then by SKU, then by name match
  var idx = recvItems.findIndex(function(it){ return it.bc && it.bc === code; });
  if (idx === -1) idx = recvItems.findIndex(function(it){ return it.sku === code; });

  if (idx === -1) {
    // In manual-invoice or return mode, allow adding any product found in the master DB
    if (isManualInvoice || isReturnMode) {
      var foundSku = null;
      Object.keys(PRODUCTS).forEach(function(sku){
        if (PRODUCTS[sku].bc === code || sku === code) foundSku = sku;
      });
      if (foundSku) {
        manualAddProduct(foundSku);
        if (msg) { msg.innerHTML = '✅ تمت إضافة <strong>'+PRODUCTS[foundSku].n+'</strong>'; msg.style.color = '#1a7a40'; }
        refocusScan();
        return;
      }
    }
    if (msg) { msg.innerHTML = '⚠️ <strong>'+code+'</strong> — الصنف ده مش موجود'+((isManualInvoice||isReturnMode)?' في قاعدة البيانات':' في أمر الشراء ده'); msg.style.color = '#c0392b'; }
    toast('⚠️ باركود غير معروف');
    refocusScan();
    return;
  }

  // Increment received/returned qty by 1 (typical scanner behavior — scan each unit/carton once)
  var current = parseFloat(recvItems[idx].qty_received) || 0;
  var newQty = current + 1;
  recvItems[idx].qty_received = newQty;

  var inp = document.getElementById('qr-'+idx);
  if (inp) inp.value = newQty;
  checkQty(idx, newQty);

  if (msg) { msg.innerHTML = '✅ <strong>'+recvItems[idx].name+'</strong> — الكمية: '+newQty; msg.style.color = '#1a7a40'; }

  // Flash highlight on the row
  var row = document.getElementById('row-'+idx);
  if (row) {
    row.style.transition = 'background .15s';
    row.style.background = '#d4edda';
    setTimeout(function(){ row.style.background = ''; }, 500);
    row.scrollIntoView({behavior:'smooth', block:'center'});
  }

  refocusScan();
}

function refocusScan() {
  setTimeout(function(){
    var s = document.getElementById('scan-inp');
    if (s) s.focus();
  }, 50);
}

// ── Camera scan (mobile) using html5-qrcode (loaded on demand from CDN) ──
var _camScanner = null;
var _camLibLoaded = false;

function loadCamLib(cb) {
  if (_camLibLoaded || window.Html5Qrcode) { _camLibLoaded = true; cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  s.onload = function(){ _camLibLoaded = true; cb(); };
  s.onerror = function(){ toast('⚠️ تعذر تحميل مكتبة الكاميرا — تحقق من الاتصال بالإنترنت'); };
  document.body.appendChild(s);
}

function openCameraScan() {
  var wrap = document.getElementById('cam-scan-wrap');
  if (!wrap) return;
  wrap.style.display = 'block';
  loadCamLib(function(){
    if (!window.Html5Qrcode) return;
    _camScanner = new Html5Qrcode('cam-reader');
    Html5Qrcode.getCameras().then(function(devices){
      var camId = devices && devices.length ? devices[devices.length-1].id : null; // prefer back camera (last)
      if (!camId) { toast('⚠️ لا توجد كاميرا متاحة'); return; }
      _camScanner.start(
        camId,
        { fps: 10, qrbox: { width: 250, height: 150 } },
        function onScan(decodedText) {
          handleScan(decodedText);
          // brief pause to avoid duplicate rapid scans
          if (_camScanner) {
            _camScanner.pause(true);
            setTimeout(function(){ if (_camScanner) _camScanner.resume(); }, 1200);
          }
        },
        function onErr(){ /* ignore per-frame errors */ }
      ).catch(function(err){
        toast('⚠️ تعذر تشغيل الكاميرا: ' + (err.message||err));
      });
    }).catch(function(){
      toast('⚠️ لم يتم منح إذن الكاميرا');
    });
  });
}

function closeCameraScan() {
  var wrap = document.getElementById('cam-scan-wrap');
  if (_camScanner) {
    _camScanner.stop().then(function(){
      _camScanner.clear();
      _camScanner = null;
    }).catch(function(){ _camScanner = null; });
  }
  if (wrap) wrap.style.display = 'none';
  refocusScan();
}

async function approveRecv() {
  if (isManualInvoice && !(recvPO.supplier_name||'').trim()) { toast('⚠️ اكتب اسم المورد أولاً'); return; }
  if (!recvItems.length) { toast('⚠️ أضف أصناف للفاتورة أولاً'); return; }

  // Validate all quantities entered
  var allFilled = recvItems.every(function(item){ return item.qty_received !== '' && item.qty_received >= 0; });
  if (!allFilled) { toast('⚠️ أدخل الكميات المستلمة لكل الأصناف'); return; }

  var hasCost = recvItems.some(function(item){ return parseFloat(item.new_cost) > 0; });
  if (!hasCost) { toast('⚠️ أدخل تكلفة الشراء لصنف واحد على الأقل'); return; }

  toast('⏳ جاري الحفظ...');

  // Build requests and send to BOTH pricing and finance
  var invoiceTotal = 0;
  var newRequests = [];
  recvItems.forEach(function(item){
    var cost = parseFloat(item.new_cost) || item.old_cost;
    var qty = parseFloat(item.qty_received) || 0;
    invoiceTotal += cost * qty;

    var costChanged = cost !== item.old_cost;
    var storedMargin = clampMargin(item.stored_margin || 22);
    var suggestedPrice = cost / (1 - storedMargin/100);
    suggestedPrice = Math.ceil(suggestedPrice * 2) / 2;

    newRequests.push({
      sku: item.sku,
      product_name: item.name,
      unit: item.unit,
      qty_ordered: item.qty_ordered,
      qty_received: qty,
      old_cost: item.old_cost,
      new_cost: cost,
      old_price: item.old_price,
      suggested_price: suggestedPrice,
      final_price: suggestedPrice,
      stored_margin: storedMargin,
      cost_changed: costChanged,
      stock_before: item.stock_before,
      supplier_name: recvPO.supplier_name,
      po_number: recvPO.po_number,
      received_by: ROLES.receiving.label,
      status: STATUSES.sent
    });
  });

  // نولّد UUID حقيقي لكل صنف من الجهاز نفسه — يضمن Idempotency حقيقي حتى لو تكررت المحاولة
  newRequests.forEach(function(r){ r.id = genUUID(); });

  try {
    // 1. Save all pricing requests to Supabase — upsert بالـ id عشان أي إعادة محاولة متكررة لا تُنشئ تكراراً
    var writeResult = await sbWrite('pricing_requests_v3?on_conflict=id', {
      method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=representation'},
      body:JSON.stringify(newRequests)
    }, { opType:'اعتماد_استلام', label: 'استلام: '+recvPO.po_number, afterData:{count:newRequests.length} });

    newRequests.forEach(function(r){
      if (!writeResult.ok) { r._offline = true; r._insertOpUuid = writeResult.uuid; r.created_at = new Date().toISOString(); }
      MOCK_REQUESTS.push(r);
    });
    if (!writeResult.ok) toast('📴 تم الحفظ محلياً — سيتم الرفع تلقائياً عند عودة الاتصال');

    // 1b. Update products_master with the new cost (تحديث دائم للتكلفة)
    var costUpdates = newRequests.filter(function(r){ return r.new_cost > 0; }).map(function(r){
      return { sku:r.sku, name:r.product_name, cost:r.new_cost, price: PRODUCTS[r.sku]?PRODUCTS[r.sku].p:0,
               margin: PRODUCTS[r.sku]?PRODUCTS[r.sku].margin:22, barcode: PRODUCTS[r.sku]?PRODUCTS[r.sku].bc:'' };
    });
    if (costUpdates.length) {
      await sbWrite('products_master?on_conflict=sku', {
        method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify(costUpdates)
      }, { label:'تحديث تكلفة منتجات' });
    }

    // 2. Ensure supplier account exists (upsert)
    var sup = MOCK_SUPPLIERS.find(function(s){return s.name===recvPO.supplier_name;});
    if (!sup) {
      sup = { name: recvPO.supplier_name, balance:0, opening:0, payments:[], returns:[] };
      MOCK_SUPPLIERS.push(sup);
      await sbWrite('supplier_accounts', { method:'POST', body:JSON.stringify({ supplier_name: recvPO.supplier_name, opening_balance:0 }) },
        { label:'حساب مورد جديد: '+recvPO.supplier_name });
    }

    // 3. Mark PO as received in po_sync (if it's a real PO, not manual)
    if (!isManualInvoice && recvPO.id && recvPO.id !== 'manual') {
      await sbWrite('po_sync?id=eq.' + recvPO.id, {
        method:'PATCH', headers:{'Prefer':'return=minimal'},
        body: JSON.stringify({ status:'received' })
      }, { label:'تحديث حالة أمر شراء' });
    }

    addAudit(isManualInvoice?'اعتماد فاتورة يدوية':'اعتماد استلام', ROLES.receiving.label,
      recvPO.po_number + ' — ' + recvPO.supplier_name + ' — إجمالي: ' + fmt(invoiceTotal) + ' ج');
    toast('✅ تم الاعتماد وحفظه — أُرسل للمالية والتسعير');
    var doneId = recvPO.id;
    MOCK_PO = MOCK_PO.filter(function(p){ return p.id !== doneId; });
    recvPO = null;
    isManualInvoice = false;
    autosaveReceiving();
    render();
  } catch(e) {
    toast('⚠️ خطأ في الحفظ: ' + (e.message||'').slice(0,80));
  }
}

function rejectRecv() {
  addAudit('رفض استلام', ROLES.receiving.label, recvPO.po_number + ' — فرق في الكميات');
  toast('❌ تم رفض الاستلام');
  recvPO = null;
  autosaveReceiving();
  render();
}

// ═══════════════════════════════════════════════
// 2. PRICING (التسعير)
// ═══════════════════════════════════════════════
var PRICING_SELECTED = {}; // id -> true للاعتماد المجمع

function renderPricingQueue() {
  var list = MOCK_REQUESTS.filter(function(r){
    return r.status===STATUSES.sent || r.status===STATUSES.pricing || r.status===STATUSES.deferred;
  });

  var noCostCount = list.filter(function(r){ return !r.old_cost || r.old_cost<=0; }).length;
  var warnBanner = noCostCount ? '<div style="padding:10px 14px;background:#fce4ec;border-radius:10px;margin-bottom:12px;font-size:13px;font-weight:700;color:#c0392b">⚠️ يوجد '+noCostCount+' صنف بدون تكلفة سابقة مسجلة — يتطلب مراجعة يدوية دقيقة</div>' : '';

  var selCount = Object.keys(PRICING_SELECTED).filter(function(id){ return PRICING_SELECTED[id]; }).length;
  var bulkBar = selCount>0 ? '<div style="position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;background:#1a3a2a;color:#fff;border-radius:10px;margin-bottom:12px">' +
    '<span style="font-weight:800;font-size:13px">✓ '+selCount+' صنف محدد</span>' +
    '<div style="display:flex;gap:6px;margin-right:auto">' +
      '<button class="bn" style="background:#1a7a40;color:#fff" onclick="BARQ_TAS.bulkDecision(\'اعتماد\')">✅ اعتماد الكل</button>' +
      '<button class="bn" style="background:#c0392b;color:#fff" onclick="BARQ_TAS.bulkDecision(\'رفض\')">❌ رفض الكل</button>' +
      '<button class="bn" style="background:#d68910;color:#fff" onclick="BARQ_TAS.bulkDecision(\'معلق\')">⏸️ تعليق الكل</button>' +
      '<button class="bn bn-g" onclick="PRICING_SELECTED={};render()">إلغاء التحديد</button>' +
    '</div></div>' : '';

  var cards = list.length ? list.map(function(r){
    var m = calcMargin(r.new_cost, r.old_price);
    var mc = mColor(m);
    var costAlert = r.cost_changed;
    var diff = r.new_cost - r.old_cost;
    var noCostHistory = (!r.old_cost || r.old_cost<=0);
    var checked = !!PRICING_SELECTED[r.id];
    var costTag = noCostHistory
      ? '<div style="font-size:11px;margin-top:4px;padding:2px 8px;border-radius:6px;display:inline-block;background:#c0392b;color:#fff;font-weight:800">⚠️ بدون تكلفة سابقة</div>'
      : (costAlert ? '<div style="font-size:11px;margin-top:4px;padding:2px 8px;border-radius:6px;display:inline-block;'+(diff>0?'background:#fce4ec;color:#c0392b':'background:#eafaf1;color:#1a7a40')+'">'+
          (diff>0?'⬆️ ارتفاع ':'⬇️ انخفاض ')+Math.abs(diff).toFixed(2)+' ج'+'</div>' : '<div style="font-size:11px;margin-top:4px;color:var(--muted)">✅ التكلفة لم تتغير</div>');
    return '<div class="po-card st-prc" style="'+(noCostHistory?'border-right-color:#c0392b':'')+(checked?';background:#f0f9f4':'')+';display:flex;gap:10px;align-items:flex-start">' +
      '<input type="checkbox" '+(checked?'checked':'')+' onclick="event.stopPropagation();togglePricingSelect(\''+r.id+'\')" style="margin-top:4px;width:18px;height:18px;flex-shrink:0;cursor:pointer">' +
      '<div style="flex:1;cursor:pointer" onclick="BARQ_TAS.openPriceDetail(\''+r.id+'\')">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">' +
        '<div style="flex:1"><div style="font-weight:700;font-size:13px">'+esc(r.product_name)+'</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:3px">'+r.sku+' | PO: '+r.po_number+' | 🏪 '+esc(r.supplier_name)+'</div>' +
          costTag +
        '</div>' +
        '<div style="text-align:left">' +
          '<div style="font-weight:900;color:'+mc+';font-size:14px">'+(m?m.toFixed(1)+'%':'—')+'</div>' +
          '<div style="font-size:10px;color:var(--muted)">هامش</div></div>' +
      '</div></div></div>';
  }).join('') :
  '<div class="empty"><div class="empty-i">📭</div><div>لا توجد طلبات حالياً</div></div>';

  return '<div class="cd"><div class="ct">💰 مراجعة التسعير <span class="bg bg-prc">'+list.length+'</span></div>'+bulkBar+warnBanner+cards+'</div>';
}

function togglePricingSelect(id) {
  PRICING_SELECTED[id] = !PRICING_SELECTED[id];
  render();
}

async function bulkDecision(action) {
  var ids = Object.keys(PRICING_SELECTED).filter(function(id){ return PRICING_SELECTED[id]; });
  if (!ids.length) return;
  if (!confirm('تأكيد '+action+' لعدد '+ids.length+' صنف بالسعر المقترح الحالي لكل منهم؟')) return;

  toast('⏳ جاري تنفيذ '+ids.length+' عملية...');
  var statusMap = { 'اعتماد':STATUSES.export_ready, 'رفض':STATUSES.rejected, 'معلق':STATUSES.deferred };
  var opTypeMap = { 'اعتماد':'اعتماد_سعر', 'رفض':'رفض_سعر', 'معلق':'تعليق_سعر' };
  var newStatus = statusMap[action];
  var done = 0, queuedCount = 0;

  for (var i=0; i<ids.length; i++) {
    var r = MOCK_REQUESTS.find(function(x){ return x.id === ids[i]; });
    if (!r) continue;
    var patch = { status: newStatus };
    if (action==='اعتماد') patch.final_price = r.final_price || r.suggested_price;

    var result = await patchPricingRequest(r, patch, opTypeMap[action]);
    if (result.queued) queuedCount++;

    if (action==='اعتماد') {
      if (PRODUCTS[r.sku]) { PRODUCTS[r.sku].c = r.new_cost; PRODUCTS[r.sku].p = r.final_price; }
      await sbWrite('products_master?on_conflict=sku', {
        method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify([{ sku:r.sku, name:r.product_name, cost:r.new_cost, price:r.final_price, margin:r.stored_margin }])
      }, { opType:'تحديث_منتج', label:'تحديث تكلفة: '+r.sku });
    }
    logDecision(action, r);
    done++;
  }
  addAudit('اعتماد مجمع — '+action, ROLES.pricing.label, done+' صنف');
  PRICING_SELECTED = {};
  toast(queuedCount ? '📴 تم حفظ '+done+' عملية ('+queuedCount+' محلياً — ستُرفع تلقائياً)' : '✅ تم '+action+' '+done+' صنف بنجاح');
  render();
}

function openPriceDetail(id) {
  detailId = id;
  render();
}

// ═══════════════════════════════════════════════
// DECISION LOG — سجل قرارات التسعير (اعتماد/رفض/تعليق)
// ═══════════════════════════════════════════════
var decisionFilter = 'الكل';

function renderDecisionLog() {
  var filtered = decisionFilter === 'الكل' ? DECISION_LOG : DECISION_LOG.filter(function(d){ return d.action === decisionFilter; });

  var filterBtns = ['الكل','اعتماد','رفض','معلق'].map(function(f){
    var color = f==='اعتماد'?'#1a7a40':f==='رفض'?'#c0392b':f==='معلق'?'#d68910':'var(--primary)';
    var active = decisionFilter===f;
    return '<button class="bn" style="background:'+(active?color:'var(--bg)')+';color:'+(active?'#fff':'var(--text)')+';border:1px solid '+color+'" ' +
      'onclick="decisionFilter=\''+f+'\';render()">'+f+' ('+(f==='الكل'?DECISION_LOG.length:DECISION_LOG.filter(function(d){return d.action===f;}).length)+')</button>';
  }).join('');

  var rows = filtered.map(function(d){
    var margin = calcMargin(d.new_cost, d.suggested_price);
    var actionColor = d.action==='اعتماد'?'#1a7a40':d.action==='رفض'?'#c0392b':'#d68910';
    return '<tr>' +
      '<td style="padding:9px 10px;font-weight:600">'+d.name+'<br><span style="font-size:10px;color:var(--muted)">'+d.sku+'</span></td>' +
      '<td style="padding:9px 10px;text-align:center">'+fmt(d.qty)+'</td>' +
      '<td style="padding:9px 10px;text-align:center">'+fmt(d.old_cost)+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:var(--blue)">'+fmt(d.new_cost)+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center;color:var(--muted)">'+d.stock_before+'</td>' +
      '<td style="padding:9px 10px;text-align:center">'+fmt(d.old_price)+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:var(--accent)">'+fmt(d.suggested_price)+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center">'+(d.margin||'—')+'%</td>' +
      '<td style="padding:9px 10px;text-align:center"><span class="bg" style="background:'+actionColor+'22;color:'+actionColor+';font-weight:800">'+d.action+'</span></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--muted)">لا توجد قرارات مسجّلة بعد</td></tr>';

  return '<div class="cd">' +
    '<div class="ct">📋 سجل قرارات التسعير' +
      '<div style="display:flex;gap:6px"><button class="bn bn-b" onclick="BARQ_TAS.printDecisionLog()">🖨️ طباعة</button>' +
      '<button class="bn" style="background:#1a7a40;color:#fff" onclick="BARQ_TAS.exportDecisionLogExcel()">📊 تصدير Excel</button></div>' +
    '</div>' +
    '<div class="br" style="margin-bottom:14px">'+filterBtns+'</div>' +
    '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">' +
    '<table class="ft" id="decision-log-table"><thead><tr>' +
      '<th>اسم الصنف</th><th style="text-align:center">الكمية</th>' +
      '<th style="text-align:center">سعر الشراء آخر فاتورة</th><th style="text-align:center">سعر الشراء الحالي</th>' +
      '<th style="text-align:center">الكمية قبل الشراء</th><th style="text-align:center">سعر بيع فودكس الحالي</th>' +
      '<th style="text-align:center">سعر البيع للقطعة (مقترح)</th><th style="text-align:center">نسبة التسعير</th>' +
      '<th style="text-align:center">القرار</th>' +
    '</tr></thead><tbody>'+rows+'</tbody></table></div>' +
  '</div>';
}

function printDecisionLog() {
  var filtered = decisionFilter === 'الكل' ? DECISION_LOG : DECISION_LOG.filter(function(d){ return d.action === decisionFilter; });
  var today = new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'});
  var rows = filtered.map(function(d,i){
    return '<tr style="background:'+(i%2?'#f8fffe':'white')+'">' +
      '<td style="padding:7px 8px;border:1px solid #ddd">'+d.name+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+d.sku+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+fmt(d.qty)+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+fmt(d.old_cost)+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+fmt(d.new_cost)+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+d.stock_before+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+fmt(d.old_price)+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+fmt(d.suggested_price)+'</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center">'+(d.margin||'—')+'%</td>' +
      '<td style="padding:7px 8px;border:1px solid #ddd;text-align:center;font-weight:700">'+d.action+'</td>' +
    '</tr>';
  }).join('');

  var win = window.open('', '_blank');
  win.document.write(
    '<html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>سجل قرارات التسعير</title>' +
    '<style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#1a1a1a}' +
    'h2{color:#1a3a2a}table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th{background:#1a3a2a;color:#fff;padding:8px;border:1px solid #ddd}' +
    '@media print{body{padding:8px}}</style></head><body>' +
    '<h2>📋 سجل قرارات التسعير — '+decisionFilter+'</h2>' +
    '<div style="font-size:12px;color:#666;margin-bottom:14px">تاريخ الطباعة: '+today+' | عدد السجلات: '+filtered.length+'</div>' +
    '<table><thead><tr>' +
      '<th>اسم الصنف</th><th>SKU</th><th>الكمية</th><th>سعر آخر فاتورة</th><th>سعر حالي</th>' +
      '<th>كمية قبل الشراء</th><th>سعر بيع فودكس</th><th>سعر البيع للقطعة (مقترح)</th><th>نسبة التسعير</th><th>القرار</th>' +
    '</tr></thead><tbody>'+rows+'</tbody></table>' +
    '<scr'+'ipt>window.onload=function(){window.print();}</scr'+'ipt>' +
    '</body></html>'
  );
  win.document.close();
}

function exportDecisionLogExcel() {
  var filtered = decisionFilter === 'الكل' ? DECISION_LOG : DECISION_LOG.filter(function(d){ return d.action === decisionFilter; });
  if (!filtered.length) { toast('لا توجد بيانات للتصدير'); return; }
  var csv = '\uFEFFاسم الصنف,SKU,الكمية,سعر الشراء آخر فاتورة,سعر الشراء الحالي,الكمية الموجودة قبل الشراء,سعر بيع فودكس الحالي,سعر البيع للقطعة (مقترح),نسبة التسعير الثابتة,القرار,المورد,رقم أمر الشراء,التاريخ\n';
  filtered.forEach(function(d){
    var name = (d.name||'').replace(/,/g,' ');
    csv += [name, d.sku, d.qty, d.old_cost, d.new_cost, d.stock_before, d.old_price, d.suggested_price, (d.margin||'')+'%', d.action, (d.supplier_name||'').replace(/,/g,' '), d.po_number||'', d.date.slice(0,10)].join(',') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'سجل_قرارات_التسعير_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('✅ تم تصدير '+filtered.length+' قرار');
}

function renderDetail() {
  var r = MOCK_REQUESTS.find(function(x){return x.id===detailId;});
  if (!r) { detailId=null; render(); return ''; }

  var m = calcMargin(r.new_cost, r.final_price);
  var mc = mColor(m);
  var diff = r.new_cost - r.old_cost;
  var costAlert = r.cost_changed;

  var alertBox = '';
  var noCostHistory = (!r.old_cost || r.old_cost <= 0);

  if (noCostHistory) {
    alertBox = '<div style="padding:14px;background:#c0392b;color:#fff;border-radius:10px;margin-bottom:12px;font-size:14px;font-weight:800;display:flex;align-items:center;gap:10px">' +
      '<span style="font-size:22px">⚠️</span>' +
      '<div><div>لا توجد تكلفة سابقة مسجلة لهذا الصنف</div>' +
      '<div style="font-size:12px;font-weight:600;opacity:.9;margin-top:2px">هذا أول تسجيل — راجع السعر يدوياً بعناية قبل الاعتماد، لا يوجد أساس للمقارنة</div></div>' +
    '</div>';
  } else if (costAlert && diff > 0) {
    alertBox = '<div style="padding:12px;background:#fce4ec;border-radius:10px;margin-bottom:12px;font-size:13px">' +
      '⚠️ <strong>تنبيه:</strong> تكلفة الشراء ارتفعت بـ <strong>'+diff.toFixed(2)+' ج</strong> — مطلوب مراجعة سعر البيع</div>';
  } else if (costAlert && diff < 0) {
    alertBox = '<div style="padding:12px;background:#eafaf1;border-radius:10px;margin-bottom:12px;font-size:13px">' +
      '✅ تكلفة الشراء انخفضت بـ <strong>'+Math.abs(diff).toFixed(2)+' ج</strong></div>';
  } else {
    alertBox = '<div style="padding:12px;background:#e8f4fd;border-radius:10px;margin-bottom:12px;font-size:13px">' +
      '✅ التكلفة لم تتغير — السعر مطابق ولا يحتاج تعديل</div>';
  }

  // ── تأثير الوصفة: المادة دي داخلة (على أي عدد من المستويات) في تصنيع مواد/منتجات تانية — شيت المكونات ──
  var affectedHTML = '';
  var affectedChain = (costAlert && diff > 0) ? getAffectedChain(r.sku) : [];
  // إزالة تكرار نفس الـ sku لو وصلناله من أكتر من مسار
  var seenSku = {};
  var displayNodes = affectedChain.filter(function(n){ if (seenSku[n.sku]) return false; seenSku[n.sku]=true; return true; });

  if (displayNodes.length) {
    var rows = displayNodes.map(function(n){
      return '<div style="padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px">' +
        '<div>' + (n.kind === 'product' ? '🏷️' : '🧪') + ' ' + esc(n.name || n.sku) +
          (n.isRepack ? ' <span style="background:#e8f4fd;color:#1a5a8a;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px">🔁 نفس المادة معاد بيعها</span>' : '') +
          (n.source === 'foodics' ? ' <span style="background:#eafaf1;color:#1a7a40;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px">✅ من فودكس</span>'
            : n.source === 'manual' ? ' <span style="background:#f0eefc;color:#5b3fa8;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px">✍️ يدوي</span>' : '') +
        '</div>' +
        '<div style="color:var(--muted);font-size:11px;font-family:monospace;direction:ltr;display:inline-block">SKU: '+esc(n.sku)+'</div>' +
        '<div style="color:var(--muted);font-size:10px;margin-top:2px">المسار: '+esc(r.product_name)+' ← '+n.path.map(esc).join(' ← ')+'</div>' +
      '</div>';
    }).join('');
    affectedHTML = '<div style="padding:14px;background:#fff3e0;border:1px solid #f0c419;border-radius:10px;margin-bottom:12px">' +
      '<div style="font-weight:800;font-size:13px;margin-bottom:4px">🔗 المادة دي بتأثر على '+displayNodes.length+' صنف — راجع أسعارهم قبل البيع</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">🏷️ = منتج نهائي بيتباع في الفرع، 🧪 = مادة مخزون مُصنّعة (مكوّن وسيط). لو مادة مُصنّعة ظاهرة من غير منتج نهائي بعدها، يبقى لسه محتاج تربطها بالمنتج بتاعها من شاشة "مكونات هذا الصنف" في المخزون.</div>' +
      '<div style="max-height:260px;overflow-y:auto;border-radius:8px;background:var(--card)">' + rows + '</div>' +
    '</div>';
  }

  var canEdit = role==='pricing' && (r.status===STATUSES.sent || r.status===STATUSES.pricing || r.status===STATUSES.deferred);
  var mustDecide = costAlert && canEdit; // إلزام اتخاذ قرار عند تغيّر التكلفة لتقليل المخاطر

  var editHTML = '';
  if (canEdit) {
    editHTML = '<div class="cd"><div class="ct">✏️ قرار التسعير' +
      (mustDecide ? '<span style="background:#fce4ec;color:#c0392b;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800">⚠️ إلزامي — التكلفة تغيّرت</span>' : '') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">نسبة التسعير %</label>' +
          '<input type="number" class="fi" id="rv-margin" value="'+(r.stored_margin||22)+'" step="0.5" min="0" max="90" oninput="BARQ_TAS.liveCalc()"></div>' +
        '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">سعر البيع للقطعة</label>' +
          '<input type="number" class="fi fi-green" id="rv-price" value="'+(r.final_price||'')+'" step="0.5" oninput="BARQ_TAS.liveCalcFromPrice()" style="font-weight:800;font-size:15px"></div>' +
      '</div>' +
      '<div id="rv-margin-display" style="text-align:center;padding:10px;background:var(--bg);border-radius:8px;font-weight:700;margin-bottom:12px">' +
        'هامش الربح: <span style="color:'+mc+'">'+(m?m.toFixed(1)+'%':'—')+'</span></div>' +
      '<div class="br">' +
        '<button class="bn bn-p" onclick="BARQ_TAS.approvePrice()">✅ اعتماد السعر</button>' +
        '<button class="bn bn-d" onclick="BARQ_TAS.rejectPrice()">❌ رفض</button>' +
        '<button class="bn" style="background:#d68910;color:#fff" onclick="BARQ_TAS.deferPrice()">⏸️ تعليق للمراجعة لاحقاً</button>' +
      '</div></div>';
  }

  var backBtn = '<button class="bn bn-g" style="font-size:11px;flex-shrink:0" onclick="detailId=null;render()">← رجوع</button>';

  return '<div class="ds"><div class="dh"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
    '<div><div style="font-size:15px;font-weight:800">'+esc(r.product_name)+'</div>' +
      '<div style="font-size:11px;opacity:.8">'+r.sku+' | PO: '+r.po_number+' | 🏪 '+esc(r.supplier_name)+'</div></div>' +
    backBtn +
  '</div></div><div class="pg">' +
    alertBox +
    affectedHTML +
    menuClassBadge(r.sku) +
    '<div class="cd"><div class="ct">بيانات الصنف</div>' +
      '<div class="px-row">' +
        '<div class="px px-old"><label>تكلفة قديمة</label><span>'+fmt(r.old_cost)+' ج</span></div>' +
        '<div class="px '+(costAlert&&diff>0?'px-alert':'px-new')+'"><label>تكلفة جديدة</label><span>'+fmt(r.new_cost)+' ج</span></div>' +
        '<div class="px px-sell"><label>سعر البيع الحالي للقطعة</label><span>'+fmt(r.old_price)+' ج</span></div>' +
      '</div>' +
      '<div class="ig">' +
        '<div class="ib"><label>الكمية المطلوبة</label><span>'+r.qty_ordered+' '+r.unit+'</span></div>' +
        '<div class="ib"><label>الكمية المستلمة</label><span>'+r.qty_received+' '+r.unit+'</span></div>' +
        '<div class="ib"><label>نسبة التسعير المخزنة</label><span>'+(r.stored_margin||'—')+'%</span></div>' +
        '<div class="ib"><label>السعر المقترح</label><span style="color:var(--accent);font-size:15px">'+fmt(r.suggested_price)+' ج</span></div>' +
      '</div>' +
    '</div>' +
    editHTML +
  '</div></div>';
}

function liveCalc() {
  var r = MOCK_REQUESTS.find(function(x){return x.id===detailId;});
  if (!r) return;
  var margin = clampMargin((document.getElementById('rv-margin')||{}).value);
  var price = r.new_cost / (1 - margin/100);
  price = Math.ceil(price * 2) / 2;
  var priceEl = document.getElementById('rv-price');
  if (priceEl) priceEl.value = price.toFixed(2);
  updateMarginDisplay(r.new_cost, price);
}

function liveCalcFromPrice() {
  var r = MOCK_REQUESTS.find(function(x){return x.id===detailId;});
  if (!r) return;
  var price = parseFloat((document.getElementById('rv-price')||{}).value) || 0;
  var marginEl = document.getElementById('rv-margin');
  if (price > 0 && r.new_cost > 0) {
    var m = (price - r.new_cost) / price * 100;
    if (marginEl) marginEl.value = m.toFixed(1);
  }
  updateMarginDisplay(r.new_cost, price);
}

function updateMarginDisplay(cost, price) {
  var el = document.getElementById('rv-margin-display');
  if (!el) return;
  var m = calcMargin(cost, price);
  var c = mColor(m);
  el.innerHTML = 'هامش الربح: <span style="color:'+c+';font-size:18px">'+(m?m.toFixed(1)+'%':'—')+'</span>' +
    (m&&m<15?' ⚠️ منخفض':m&&m>=25?' ✅ ممتاز':'');
}

// ── سجل قرارات التسعير — يُستخدم للطباعة والتصدير ──
function logDecision(action, r) {
  DECISION_LOG.unshift({
    sku: r.sku, name: r.product_name, qty: r.qty_received,
    old_cost: r.old_cost, new_cost: r.new_cost,
    stock_before: (r.stock_before!==undefined && r.stock_before!==null) ? r.stock_before : '—',
    old_price: r.old_price, suggested_price: r.final_price || r.suggested_price,
    margin: r.stored_margin, action: action,
    supplier_name: r.supplier_name, po_number: r.po_number,
    by: ROLES.pricing.label, date: new Date().toISOString()
  });
}

// تحديث حالة طلب تسعير — يتعامل بذكاء مع العناصر اللي لسه في طابور الأوفلاين (مش وصلت للسيرفر بعد)
async function patchPricingRequest(r, patchBody, opType) {
  // لو الصنف ده لسه معلّق كعملية إدراج لم تتزامن، نربط عملية التعديل كـ Child تابعة لها
  var parentUuid = null;
  if (r._offline && r._insertOpUuid) {
    var stillPending = OFFLINE_QUEUE.find(function(o){ return o.uuid === r._insertOpUuid && o.status !== 'synced'; });
    if (stillPending) parentUuid = r._insertOpUuid;
  }

  var result = await sbWrite('pricing_requests_v3?id=eq.' + r.id, {
    method:'PATCH', headers:{'Prefer':'return=minimal'}, body: JSON.stringify(patchBody)
  }, { opType: opType||'اعتماد_سعر', label:'تحديث تسعير: '+r.product_name, parentUuid: parentUuid,
       beforeData: { status:r.status, final_price:r.final_price }, afterData: patchBody });
  Object.assign(r, patchBody);
  return result;
}

async function approvePrice() {
  var r = MOCK_REQUESTS.find(function(x){return x.id===detailId;});
  if (!r) return;
  var price = parseFloat((document.getElementById('rv-price')||{}).value) || r.final_price;
  var margin = clampMargin((document.getElementById('rv-margin')||{}).value || r.stored_margin);

  var result = await patchPricingRequest(r, { final_price: price, stored_margin: margin, status: STATUSES.export_ready }, 'اعتماد_سعر');
  if (PRODUCTS[r.sku]) {
    PRODUCTS[r.sku].c = r.new_cost;
    PRODUCTS[r.sku].p = price;
    PRODUCTS[r.sku].margin = margin;
  }
  await sbWrite('products_master?on_conflict=sku', {
    method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify([{ sku:r.sku, name:r.product_name, cost:r.new_cost, price:price, margin:margin,
                             barcode: PRODUCTS[r.sku]?PRODUCTS[r.sku].bc:'' }])
  }, { label:'تحديث تكلفة منتج: '+r.sku });

  logDecision('اعتماد', r);
  addAudit('اعتماد سعر', ROLES.pricing.label, r.product_name+' — سعر: '+price+' ج — هامش: '+margin+'%');
  toast(result.queued ? '📴 تم الحفظ محلياً — سيُرفع تلقائياً' : '✅ تم اعتماد السعر — جاهز للتصدير');
  detailId=null;
  render();
}

async function rejectPrice() {
  var r = MOCK_REQUESTS.find(function(x){return x.id===detailId;});
  if (!r) return;
  var result = await patchPricingRequest(r, { status: STATUSES.rejected }, 'رفض_سعر');
  logDecision('رفض', r);
  addAudit('رفض تسعير', ROLES.pricing.label, r.product_name);
  toast(result.queued ? '📴 تم الحفظ محلياً' : 'تم الرفض');
  detailId=null; render();
}

async function deferPrice() {
  var r = MOCK_REQUESTS.find(function(x){return x.id===detailId;});
  if (!r) return;
  var result = await patchPricingRequest(r, { status: STATUSES.deferred }, 'تعليق_سعر');
  logDecision('معلق', r);
  addAudit('تعليق تسعير', ROLES.pricing.label, r.product_name+' — بانتظار مراجعة لاحقة');
  toast(result.queued ? '📴 تم الحفظ محلياً' : '⏸️ تم تعليق الطلب للمراجعة لاحقاً');
  detailId=null; render();
}

// ═══════════════════════════════════════════════
// 3. FINANCE (المالية)
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// FINANCE STATE
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// AHMED SALAH (3333) — STATE
// ═══════════════════════════════════════════════
var financeView = 'suppliers'; // suppliers | detail | import | bill
var financeSelectedSupplier = null;
var financeActiveBill = null; // الفاتورة اللي بيراجعها دلوقتي
var VENDOR_BILLS = []; // كل الفواتير المسجلة

// Supplier master list (from SUPPLIERS_DB + sequential codes)
// Built once on first access, updated on import
var FIN_SUPPLIERS = null;

function getFinSuppliers() {
  if (FIN_SUPPLIERS) return FIN_SUPPLIERS;
  // Build from SUPPLIERS_DB with sequential codes
  var seen = {};
  FIN_SUPPLIERS = SUPPLIERS_DB.map(function(s, i){
    return {
      code: 'SUP-' + String(i+1).padStart(4,'0'),
      id:   s.id,
      name: s.name,
      contact: s.contact||'',
      phone: s.phone||''
    };
  }).filter(function(s){
    if (seen[s.name]) return false;
    seen[s.name] = true;
    return true;
  });
  return FIN_SUPPLIERS;
}

// ── Group invoices by PO/supplier (not per item) ──
// حساب موحّد لرصيد المورد (يشمل الرصيد الافتتاحي) — يستخدمه كل من شاشة المالية وشاشة مدير المالية عشان ميختلفش المستحق بين الشاشتين
function getSupplierBalance(name) {
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===name;}) || {payments:[],returns:[],opening:0};
  var payments = finSup.payments || [];
  var returns = finSup.returns || [];
  var opening = parseFloat(finSup.opening) || 0;
  var invoices = MOCK_REQUESTS.filter(function(r){ return r.supplier_name===name; });
  var totalInvoiced = invoices.reduce(function(s,r){ return s+(parseFloat(r.new_cost)||0)*(parseFloat(r.qty_received)||0); }, 0);
  var totalPaid = payments.reduce(function(s,p){ return s+p.amount; }, 0);
  var totalReturns = returns.reduce(function(s,r){ return s+r.amount; }, 0);
  var totalDue = opening + totalInvoiced - totalPaid - totalReturns;
  return { opening: opening, totalInvoiced: totalInvoiced, totalPaid: totalPaid, totalReturns: totalReturns, totalDue: totalDue };
}

function buildSupplierAccounts() {
  var accounts = {};
  // Group all requests by PO number first, then by supplier
  var byPO = {};
  MOCK_REQUESTS.forEach(function(r){
    var poKey = (r.po_number||'manual') + '||' + (r.supplier_name||'—');
    if (!byPO[poKey]) byPO[poKey] = { po_number:r.po_number, supplier_name:r.supplier_name, items:[], total:0, date:r.created_at };
    var line = (parseFloat(r.new_cost)||0)*(parseFloat(r.qty_received)||0);
    byPO[poKey].items.push(r);
    byPO[poKey].total += line;
  });

  // Group POs by supplier
  Object.keys(byPO).forEach(function(key){
    var po = byPO[key];
    var sup = po.supplier_name||'—';
    if (!accounts[sup]) accounts[sup] = { name:sup, invoices:[], totalInvoiced:0 };
    accounts[sup].invoices.push({ po_number:po.po_number, total:po.total, items:po.items, date:po.date });
    accounts[sup].totalInvoiced += po.total;
  });
  return accounts;
}

// ═══════════════════════════════════════════════
// AHMED SALAH — MAIN RENDER
// ═══════════════════════════════════════════════
function renderFinance() {
  var sidebar = renderFinanceSidebar();
  var main = '';
  if (financeView === 'detail' && financeSelectedSupplier) main = renderSupplierDetail(financeSelectedSupplier);
  else if (financeView === 'import') main = renderSupplierImport();
  else if (financeView === 'bill') main = renderVendorBillForm();
  else main = renderSupplierList();

  return '<div style="display:flex;gap:14px;align-items:flex-start">' +
    sidebar +
    '<div style="flex:1;min-width:0">' + main + '</div>' +
  '</div>';
}

// ── Sidebar ──
function renderFinanceSidebar() {
  var sups = getFinSuppliers();
  var accounts = buildSupplierAccounts();

  var items = sups.map(function(s){
    var acc = accounts[s.name];
    var hasBalance = acc && acc.totalInvoiced > 0;
    var due = hasBalance ? getSupplierBalance(s.name).totalDue : 0;
    var isActive = financeSelectedSupplier === s.name;
    var dotColor = due <= 0 ? '#1a7a40' : '#c0392b';
    return '<div onclick="BARQ_TAS.openSupplierDetail(\''+s.name.replace(/'/g,"\\'")+'\''+')" ' +
      'style="padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:2px;' +
      (isActive?'background:var(--accent);color:#fff;':'') +
      'display:flex;align-items:center;gap:8px" ' +
      'onmouseover="if(!'+isActive+')this.style.background=\'var(--bg)\'" onmouseout="if(!'+isActive+')this.style.background=\'\'">' +
      '<div style="width:7px;height:7px;border-radius:50%;background:'+(hasBalance?dotColor:'#ccc')+';flex-shrink:0"></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:'+(isActive?'#fff':'var(--text)')+'">'+esc(s.name)+'</div>' +
        '<div style="font-size:10px;color:'+(isActive?'rgba(255,255,255,.8)':'var(--muted)')+'">'+esc(s.code)+'</div>' +
      '</div>' +
      (hasBalance&&due>0 ? '<div style="font-size:10px;font-weight:700;color:'+(isActive?'#ffd':dotColor)+'">'+Math.round(due)+'</div>' : '') +
    '</div>';
  }).join('');

  return '<div style="width:220px;flex-shrink:0;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;position:sticky;top:14px;max-height:85vh;display:flex;flex-direction:column">' +
    '<div style="padding:12px 14px;background:var(--primary);color:#fff">' +
      '<div style="font-size:13px;font-weight:800;margin-bottom:2px">🏪 الموردون</div>' +
      '<div style="font-size:10px;opacity:.8">'+sups.length+' مورد</div>' +
    '</div>' +
    '<div style="padding:8px;border-bottom:1px solid var(--border)">' +
      '<input type="text" id="sup-sidebar-search" placeholder="🔍 بحث..." oninput="BARQ_TAS.filterSidebar()" ' +
        'style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:Cairo,sans-serif">' +
    '</div>' +
    '<div style="padding:6px;border-bottom:1px solid var(--border);display:flex;gap:4px;flex-wrap:wrap">' +
      '<button class="bn" style="flex:1;font-size:10px;padding:5px 6px;background:var(--bg);border:1px solid var(--border)" onclick="financeView=\'import\';financeSelectedSupplier=null;renderFinanceRoot()">📥 استيراد</button>' +
      '<button class="bn" style="flex:1;font-size:10px;padding:5px 6px;background:var(--bg);border:1px solid var(--border)" onclick="financeView=\'suppliers\';financeSelectedSupplier=null;renderFinanceRoot()">📋 الكل</button>' +
    '</div>' +
    '<div id="sup-sidebar-list" style="overflow-y:auto;flex:1;padding:6px">' + items + '</div>' +
  '</div>';
}

function filterSidebar() {
  var q = ((document.getElementById('sup-sidebar-search')||{}).value||'').toLowerCase();
  var items = document.querySelectorAll('#sup-sidebar-list > div');
  items.forEach(function(el){ el.style.display = !q || el.textContent.toLowerCase().indexOf(q)>=0 ? '' : 'none'; });
}

function renderFinanceRoot() {
  var root = document.getElementById('tas-root');
  if (root) root.innerHTML = renderTopBar() + '<div class="pg">' + renderFinance() + '</div>';
}

function openSupplierDetail(name) {
  financeSelectedSupplier = name;
  financeView = 'detail';
  renderFinanceRoot();
}

// ── Supplier List (main area) ──
function renderSupplierList() {
  var accounts = buildSupplierAccounts();
  var sups = getFinSuppliers();
  var rows = sups.filter(function(s){ return accounts[s.name]; }).map(function(s){
    var acc = accounts[s.name];
    var finSup = MOCK_SUPPLIERS.find(function(x){return x.name===s.name;}) || {payments:[],returns:[]};
    var paid = (finSup.payments||[]).reduce(function(t,p){return t+p.amount;},0);
    var rets = (finSup.returns||[]).reduce(function(t,r){return t+r.amount;},0);
    var due = acc.totalInvoiced - paid - rets;
    var color = due<=0?'#1a7a40':paid>0?'#d68910':'#c0392b';
    var bg    = due<=0?'#eafaf1':paid>0?'#fef9e7':'#fce4ec';
    var lbl   = due<=0?'مسدد':paid>0?'جزئي':'مستحق';
    return '<tr style="cursor:pointer" onclick="BARQ_TAS.openSupplierDetail(\''+s.name.replace(/'/g,"\\'")+'\''+')" ' +
      'onmouseover="this.style.background=\'#f8fffe\'" onmouseout="this.style.background=\'\'">' +
      '<td style="padding:10px 12px;font-size:11px;color:var(--muted)">'+s.code+'</td>' +
      '<td style="padding:10px 12px;font-weight:700;color:var(--blue)">'+s.name+'</td>' +
      '<td style="padding:10px 12px;text-align:center">'+acc.invoices.length+' فاتورة</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700">'+fmt(acc.totalInvoiced)+' ج</td>' +
      '<td style="padding:10px 12px;text-align:center;color:#1a7a40;font-weight:700">'+fmt(paid)+' ج</td>' +
      '<td style="padding:10px 12px;text-align:center;color:#e67e22">'+(rets>0?'('+fmt(rets)+')':'—')+'</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:900;color:'+color+';font-size:14px">'+fmt(due)+' ج</td>' +
      '<td style="padding:10px 12px;text-align:center"><span style="background:'+bg+';color:'+color+';padding:2px 8px;border-radius:20px;font-size:10px;font-weight:800">'+lbl+'</span></td>' +
    '</tr>';
  }).join('');

  if (!rows) return '<div class="empty"><div class="empty-i">📭</div><div>لا توجد فواتير بعد</div></div>';

  return '<div class="cd"><div class="ct">📊 حسابات الموردين</div>' +
    '<div style="overflow-x:auto"><table class="fnt"><thead><tr>' +
      '<th style="width:80px">الكود</th><th>المورد</th><th style="text-align:center">الفواتير</th>' +
      '<th style="text-align:center">إجمالي الفواتير</th><th style="text-align:center">المدفوع</th>' +
      '<th style="text-align:center">المرتجعات</th><th style="text-align:center">المتبقي</th><th style="text-align:center">الحالة</th>' +
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

// ── Supplier Detail (كشف حساب) ──
function renderSupplierDetail(name) {
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===name;});
  if (!finSup) { finSup={name:name,balance:0,payments:[],returns:[],opening:0}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.payments) finSup.payments=[];
  if (!finSup.returns)  finSup.returns=[];
  if (!finSup.opening)  finSup.opening=0;

  var accounts = buildSupplierAccounts();
  var acc = accounts[name] || {invoices:[],totalInvoiced:0};
  var sups = getFinSuppliers();
  var supInfo = sups.find(function(s){return s.name===name;}) || {code:'—'};

  var bal = getSupplierBalance(name);
  var totalPaid    = bal.totalPaid;
  var totalReturns = bal.totalReturns;
  var opening      = bal.opening;
  var totalDue     = bal.totalDue;

  // Timeline — invoices grouped as single entries (not per item)
  var timeline = [];
  // Add opening balance as first entry if exists
  if (opening > 0) {
    timeline.push({ type:'opening', rawDate:'2000-01-01', label:'رصيد افتتاحي',
      ref:'', detail:'رصيد مرحّل من قبل النظام', amount:opening });
  }
  acc.invoices.forEach(function(inv){
    timeline.push({ type:'invoice', rawDate:inv.date, label:'فاتورة شراء', ref:inv.po_number,
      detail:inv.items.length+' صنف', amount:inv.total });
  });
  finSup.payments.forEach(function(p){
    timeline.push({ type:'payment', rawDate:p.rawDate||new Date().toISOString(),
      label:'دفعة — '+(p.method_label||p.method||''), ref:p.ref||'', detail:p.note||'', amount:-p.amount });
  });
  finSup.returns.forEach(function(r){
    timeline.push({ type:'return', rawDate:r.rawDate||new Date().toISOString(),
      label:'مرتجع — '+r.reason, ref:'', detail:r.detail||'', amount:-r.amount });
  });
  timeline.sort(function(a,b){ return new Date(a.rawDate)-new Date(b.rawDate); });

  var running = 0;
  var tlHTML = timeline.map(function(t){
    running += t.amount;
    var icon = {invoice:'🧾',payment:'💰',return:'↩️',opening:'📂'}[t.type]||'•';
    var amtColor = t.amount>0?'#c0392b':'#1a7a40';
    return '<tr>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted);white-space:nowrap">'+(t.rawDate||'').slice(0,10)+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-size:16px">'+icon+'</td>' +
      '<td style="padding:9px 10px;font-weight:700">'+esc(t.label)+'</td>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted)">'+esc(t.ref)+(t.detail?' | '+esc(t.detail):'')+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:'+amtColor+'">'+(t.amount>0?'+':'')+fmt(Math.abs(t.amount))+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:900;color:'+(running>0?'#c0392b':'#1a7a40')+'">'+fmt(running)+' ج</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">لا توجد حركات</td></tr>';

  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">' +
    '<div><div style="font-size:15px;font-weight:800;color:var(--primary)">🏪 '+name+'</div>' +
      '<div style="font-size:11px;color:var(--muted)">'+supInfo.code+'</div></div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="bn bn-p" onclick="BARQ_TAS.openNewBill(\''+name.replace(/'/g,"\\'")+'\')">📄 فاتورة جديدة</button>' +
      '<button class="bn bn-g" onclick="BARQ_TAS.addPaymentModal(\''+name.replace(/'/g,"\\'")+'\')">💰 دفعة</button>' +
      '<button class="bn bn-o" onclick="BARQ_TAS.addReturnModal(\''+name.replace(/'/g,"\\'")+'\')">↩️ مرتجع</button>' +
      '<button class="bn" style="background:#7f8c8d;color:#fff" onclick="BARQ_TAS.openingBalanceModal(\''+name.replace(/'/g,"\\'")+'\')">📂 رصيد افتتاحي</button>' +
      '<button class="bn bn-b" onclick="window.print()">🖨️ طباعة</button>' +
    '</div>' +
  '</div>' +
  '<div class="dg" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">' +
    '<div class="db"><div class="dn" style="font-size:18px">'+fmt(acc.totalInvoiced)+'</div><div class="dl">إجمالي الفواتير</div></div>' +
    '<div class="db"><div class="dn" style="color:#1a7a40;font-size:18px">'+fmt(totalPaid)+'</div><div class="dl">المدفوع</div></div>' +
    '<div class="db"><div class="dn" style="color:#e67e22;font-size:18px">'+fmt(totalReturns)+'</div><div class="dl">المرتجعات</div></div>' +
    '<div class="db" style="border:2px solid '+(totalDue>0?'#c0392b':'#1a7a40')+'">' +
      '<div class="dn" style="font-size:18px;color:'+(totalDue>0?'#c0392b':'#1a7a40')+'">'+fmt(Math.abs(totalDue))+'</div>' +
      '<div class="dl">'+(totalDue>0?'متبقي':'رصيد دائن')+'</div>' +
    '</div>' +
  '</div>' +
  '<div class="cd"><div class="ct">كشف الحساب الكامل</div>' +
    '<div style="overflow-x:auto"><table class="fnt"><thead><tr>' +
      '<th style="white-space:nowrap">التاريخ</th><th style="width:40px;text-align:center">نوع</th>' +
      '<th>البيان</th><th>التفاصيل</th>' +
      '<th style="text-align:center">المبلغ</th><th style="text-align:center">الرصيد</th>' +
    '</tr></thead><tbody>'+tlHTML+'</tbody>' +
    '<tfoot><tr style="background:#f0f7f2">' +
      '<td colspan="4" style="padding:10px 12px;font-weight:900">الرصيد النهائي</td><td></td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:900;font-size:17px;color:'+(totalDue>0?'#c0392b':'#1a7a40')+'">'+fmt(Math.abs(totalDue))+' ج</td>' +
    '</tr></tfoot></table></div>' +
  '</div>';
}

// ── Import Suppliers from Foodics ──
// ═══════════════════════════════════════════════
// VENDOR BILL FORM — شاشة مراجعة فاتورة المورد
// ═══════════════════════════════════════════════
function openNewBill(supName) {
  // Find latest PO for this supplier from MOCK_REQUESTS
  var supReqs = MOCK_REQUESTS.filter(function(r){ return r.supplier_name === supName; });
  var poNumbers = [];
  var seen = {};
  supReqs.forEach(function(r){
    if (r.po_number && !seen[r.po_number]) { seen[r.po_number]=true; poNumbers.push(r.po_number); }
  });

  financeActiveBill = {
    id: 'BILL-' + Date.now(),
    supplier_name: supName,
    po_number: poNumbers[0] || '',
    invoice_number: '',
    invoice_date: new Date().toISOString().slice(0,10),
    due_date: '',
    items: [],
    vendor_total: 0,    // الإجمالي على الفاتورة الورقية
    status: 'draft'
  };

  // Pre-fill items from PO/received data
  supReqs.forEach(function(r){
    financeActiveBill.items.push({
      name: r.product_name,
      sku: r.sku,
      qty_ordered: parseFloat(r.qty_ordered)||0,
      qty_received: parseFloat(r.qty_received)||0,
      unit_price: parseFloat(r.new_cost)||0
    });
  });

  financeView = 'bill';
  financeSelectedSupplier = supName;
  renderFinanceRoot();
}

function renderVendorBillForm() {
  var bill = financeActiveBill;
  if (!bill) return '<div class="empty"><div class="empty-i">📄</div><div>اختار مورد وافتح فاتورة</div></div>';

  // النظام يحسب كل شيء من البيانات المسجلة فعلياً (الكمية المستلمة × التكلفة المعتمدة) — بدون أي تعديل يدوي
  var sysTotal = bill.items.reduce(function(s,i){
    return s + (parseFloat(i.qty_received)||0) * (parseFloat(i.unit_price)||0);
  }, 0);
  var vendorTotal = parseFloat(bill.vendor_total) || 0;
  var diff = vendorTotal - sysTotal;
  var diffOk = Math.abs(diff) < 0.01;

  var itemRows = bill.items.map(function(item){
    var sysLine = (parseFloat(item.qty_received)||0) * (parseFloat(item.unit_price)||0);
    return '<tr>' +
      '<td style="padding:9px 10px;font-weight:600;font-size:13px">'+esc(item.name)+'<br>'+
        '<span style="font-size:10px;color:var(--muted)">'+item.sku+'</span></td>' +
      '<td style="padding:9px 10px;text-align:center;color:var(--muted)">'+item.qty_ordered+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:var(--blue)">'+item.qty_received+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700">'+fmt(item.unit_price)+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:var(--primary)">'+fmt(sysLine)+' ج</td>' +
    '</tr>';
  }).join('');

  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">' +
    '<div>' +
      '<div style="font-size:15px;font-weight:800;color:var(--primary)">📄 مراجعة فاتورة مورد</div>' +
      '<div style="font-size:12px;color:var(--muted)">🏪 '+esc(bill.supplier_name)+'</div>' +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="bn bn-g" onclick="financeView=\'detail\';renderFinanceRoot()">← رجوع</button>' +
    '</div>' +
  '</div>' +

  // Bill header fields
  '<div class="cd">' +
    '<div class="ct">بيانات الفاتورة الورقية</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:4px">' +
      '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">رقم الفاتورة *</label>' +
        '<input type="text" id="bill-inv-num" class="fi" placeholder="رقم فاتورة المورد" value="'+bill.invoice_number+'" ' +
          'oninput="financeActiveBill.invoice_number=this.value"></div>' +
      '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">تاريخ الفاتورة</label>' +
        '<input type="date" id="bill-inv-date" class="fi" value="'+bill.invoice_date+'" ' +
          'oninput="financeActiveBill.invoice_date=this.value"></div>' +
      '<div><label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">تاريخ الاستحقاق</label>' +
        '<input type="date" id="bill-due-date" class="fi" value="'+bill.due_date+'" ' +
          'oninput="financeActiveBill.due_date=this.value"></div>' +
    '</div>' +
  '</div>' +

  // Items table
  '<div class="cd">' +
    '<div class="ct">📦 الأصناف المسجّلة (للمراجعة فقط — غير قابلة للتعديل)</div>' +
    '<div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border)">' +
    '<table class="ft"><thead><tr>' +
      '<th>الصنف</th>' +
      '<th style="text-align:center;width:90px">الكمية المطلوبة</th>' +
      '<th style="text-align:center;width:100px">الكمية المستلمة</th>' +
      '<th style="text-align:center;width:100px">سعر الوحدة المعتمد</th>' +
      '<th style="text-align:center;width:100px">إجمالي السطر</th>' +
    '</tr></thead>' +
    '<tbody>'+itemRows+'</tbody>' +
    '<tfoot><tr style="background:#f0f7f2">' +
      '<td colspan="4" style="padding:10px 12px;font-weight:800">الإجمالي المحسوب من النظام</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:900;font-size:16px;color:var(--primary)">'+fmt(sysTotal)+' ج</td>' +
    '</tr></tfoot>' +
    '</table></div>' +
  '</div>' +

  // Vendor total vs calculated
  '<div class="cd">' +
    '<div class="ct">🔍 مقارنة الإجماليات</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">' +
      // Vendor total (manual input)
      '<div style="padding:14px;background:var(--bg);border-radius:10px;text-align:center">' +
        '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">إجمالي فاتورة المورد الورقية</label>' +
        '<input type="number" id="bill-vendor-total" class="fi" step="0.01" ' +
          'value="'+(vendorTotal||'')+'" placeholder="اكتب الإجمالي من الورقة" ' +
          'oninput="financeActiveBill.vendor_total=parseFloat(this.value)||0;renderBillTotals()" ' +
          'style="font-size:18px;font-weight:900;text-align:center;border-color:var(--accent)">' +
      '</div>' +
      // System calculated
      '<div style="padding:14px;background:#e8f4fd;border-radius:10px;text-align:center;border:2px solid #1a5276">' +
        '<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">الإجمالي المحسوب</div>' +
        '<div style="font-size:22px;font-weight:900;color:#1a5276">'+fmt(sysTotal)+' ج</div>' +
      '</div>' +
      // Difference
      '<div id="bill-diff-box" style="padding:14px;border-radius:10px;text-align:center;border:2px solid '+(diffOk&&vendorTotal>0?'#1a7a40':vendorTotal>0?'#c0392b':'#ddd')+';background:'+(diffOk&&vendorTotal>0?'#eafaf1':vendorTotal>0?'#fce4ec':'var(--bg)')+'">' +
        '<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">الفرق</div>' +
        '<div id="bill-diff-val" style="font-size:22px;font-weight:900;color:'+(diffOk&&vendorTotal>0?'#1a7a40':vendorTotal>0?'#c0392b':'#888')+'">' +
          (vendorTotal>0 ? (diffOk?'✅ صفر':fmt(Math.abs(diff))+' ج') : '—') +
        '</div>' +
        (vendorTotal>0&&!diffOk ? '<div style="font-size:10px;color:#c0392b;margin-top:4px">'+(diff>0?'الفاتورة أعلى':'الفاتورة أقل')+'</div>' : '') +
      '</div>' +
    '</div>' +

    // Difference reason (if any)
    (vendorTotal>0 && !diffOk ?
      '<div style="margin-bottom:14px">' +
        '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">سبب الفرق *</label>' +
        '<select id="bill-diff-reason" class="fi" style="margin-bottom:8px">' +
          '<option value="">-- اختار السبب --</option>' +
          '<option value="خطأ في الفاتورة">خطأ في فاتورة المورد</option>' +
          '<option value="ضريبة غير متوقعة">ضريبة / رسوم إضافية</option>' +
          '<option value="خصم لم يطبق">خصم لم يطبق</option>' +
          '<option value="فرق سعر">فرق في سعر الوحدة</option>' +
          '<option value="أخرى">أخرى</option>' +
        '</select>' +
        '<input type="text" id="bill-diff-note" class="fi" placeholder="ملاحظات إضافية...">' +
      '</div>' : '') +

    // Action buttons
    '<div class="br">' +
      '<button class="bn bn-p" onclick="BARQ_TAS.approveBill()">✅ اعتماد واحتساب الدفع</button>' +
      '<button class="bn bn-d" onclick="BARQ_TAS.rejectBill()">❌ رفض الفاتورة</button>' +
      '<button class="bn bn-b" onclick="BARQ_TAS.printVendorBill()">🖨️ طباعة</button>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--muted);margin-top:8px">' +
      'ⓘ عند الاعتماد، المبلغ المحتسب للدفع هو الإجمالي المحسوب وليس إجمالي الفاتورة' +
    '</div>' +
  '</div>';
}

function renderBillTotals() {
  // Live update diff box without full re-render — يعتمد على البيانات المسجلة فعلياً فقط
  var bill = financeActiveBill;
  if (!bill) return;
  var sysTotal = bill.items.reduce(function(s,i){
    return s + (parseFloat(i.qty_received)||0)*(parseFloat(i.unit_price)||0);
  },0);
  var vendorTotal = parseFloat(bill.vendor_total)||0;
  var diff = vendorTotal - sysTotal;
  var diffOk = Math.abs(diff) < 0.01;
  var box = document.getElementById('bill-diff-box');
  var val = document.getElementById('bill-diff-val');
  if (!box||!val) return;
  box.style.border = '2px solid '+(diffOk?'#1a7a40':'#c0392b');
  box.style.background = diffOk?'#eafaf1':'#fce4ec';
  val.style.color = diffOk?'#1a7a40':'#c0392b';
  val.textContent = diffOk ? '✅ صفر' : fmt(Math.abs(diff))+' ج';
}

function approveBill() {
  var bill = financeActiveBill;
  if (!bill) return;
  if (!bill.invoice_number) { toast('⚠️ أدخل رقم الفاتورة'); return; }

  var sysTotal = bill.items.reduce(function(s,i){
    return s + (parseFloat(i.qty_received)||0)*(parseFloat(i.unit_price)||0);
  },0);
  var vendorTotal = parseFloat(bill.vendor_total)||0;
  var diff = vendorTotal - sysTotal;

  if (vendorTotal > 0 && Math.abs(diff) > 0.01) {
    var reason = (document.getElementById('bill-diff-reason')||{}).value||'';
    if (!reason) { toast('⚠️ اختار سبب الفرق في الإجمالي'); return; }
    bill.diff_reason = reason;
    bill.diff_note = (document.getElementById('bill-diff-note')||{}).value||'';
  }

  bill.status = 'approved';
  bill.approved_at = new Date().toISOString();
  bill.system_total = sysTotal;

  // Add to VENDOR_BILLS
  VENDOR_BILLS.push(bill);

  // Add invoice to supplier account in MOCK_SUPPLIERS
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===bill.supplier_name;});
  if (!finSup) { finSup={name:bill.supplier_name,balance:0,payments:[],returns:[],bills:[]}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.bills) finSup.bills=[];
  finSup.bills.push({
    bill_id: bill.id,
    invoice_number: bill.invoice_number,
    invoice_date: bill.invoice_date,
    due_date: bill.due_date,
    vendor_total: vendorTotal,
    system_total: sysTotal,
    amount_due: sysTotal, // نادفع الإجمالي المحسوب مش الورقي
    status: 'unpaid'
  });

  addAudit('اعتماد فاتورة', ROLES.finance.label,
    bill.supplier_name+' | '+bill.invoice_number+' | '+fmt(sysTotal)+' ج'+(Math.abs(diff)>0.01?' | فرق: '+fmt(diff)+' ج':''));

  toast('✅ تم اعتماد الفاتورة — المبلغ المستحق: '+fmt(sysTotal)+' ج');
  financeActiveBill = null;
  financeView = 'detail';
  renderFinanceRoot();
}

function rejectBill() {
  if (!financeActiveBill) return;
  addAudit('رفض فاتورة', ROLES.finance.label, financeActiveBill.supplier_name+' | '+financeActiveBill.invoice_number);
  toast('❌ تم رفض الفاتورة');
  financeActiveBill = null;
  financeView = 'detail';
  renderFinanceRoot();
}

function printVendorBill() {
  var bill = financeActiveBill;
  if (!bill) return;
  var sysTotal = bill.items.reduce(function(s,i){
    return s+(parseFloat(i.qty_received)||0)*(parseFloat(i.unit_price)||0);
  },0);
  var rows = bill.items.map(function(item,i){
    var lineTotal = (parseFloat(item.qty_received)||0)*(parseFloat(item.unit_price)||0);
    return '<tr style="background:'+(i%2?'#f8f9fa':'#fff')+'">' +
      '<td style="padding:8px 10px">'+esc(item.name)+'</td>' +
      '<td style="padding:8px 10px;text-align:center">'+item.sku+'</td>' +
      '<td style="padding:8px 10px;text-align:center">'+item.qty_ordered+'</td>' +
      '<td style="padding:8px 10px;text-align:center">'+item.qty_received+'</td>' +
      '<td style="padding:8px 10px;text-align:center">'+fmt(item.unit_price)+' ج</td>' +
      '<td style="padding:8px 10px;text-align:center;font-weight:700">'+fmt(lineTotal)+' ج</td>' +
    '</tr>';
  }).join('');

  var win = window.open('','_blank');
  win.document.write('<html dir="rtl" lang="ar"><head><meta charset="UTF-8">' +
    '<title>فاتورة '+bill.invoice_number+'</title>' +
    '<style>body{font-family:Tahoma,sans-serif;padding:24px;max-width:800px;margin:0 auto}' +
    'table{width:100%;border-collapse:collapse}th{background:#1a3a2a;color:#fff;padding:9px}' +
    '.total{text-align:left;font-size:20px;font-weight:900;color:#1a3a2a;margin-top:12px}' +
    '</style></head><body>' +
    '<div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a3a2a;padding-bottom:12px;margin-bottom:16px">' +
      '<div><div style="font-size:22px;font-weight:900;color:#1a3a2a">⚡ أبو الفضل</div></div>' +
      '<div style="text-align:left"><div style="font-size:16px;font-weight:800">'+bill.invoice_number+'</div>' +
        '<div style="font-size:12px;color:#888">'+bill.invoice_date+'</div></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px">' +
      '<div><span style="color:#888">المورد:</span> <strong>'+esc(bill.supplier_name)+'</strong></div>' +
      '<div><span style="color:#888">تاريخ الاستحقاق:</span> <strong>'+(bill.due_date||'—')+'</strong></div>' +
    '</div>' +
    '<table><thead><tr><th>الصنف</th><th>SKU</th><th>المطلوب</th><th>المستلم</th><th>السعر</th><th>الإجمالي</th></tr></thead>' +
    '<tbody>'+rows+'</tbody></table>' +
    '<div class="total">الإجمالي المستحق: '+fmt(sysTotal)+' ج</div>' +
    '<scr'+'ipt>window.onload=function(){window.print()}</scr'+'ipt>' +
    '</body></html>');
  win.document.close();
}

function renderSupplierImport() {
  return '<div class="cd"><div class="ct">📥 استيراد الموردين من فودكس</div>' +
    '<div style="margin-bottom:14px;padding:12px;background:#e8f4fd;border-radius:10px;font-size:13px">' +
      'ارفع ملف تصدير الموردين من فودكس (مسار: المخزون → الموردين → تصدير CSV).' +
      '<br>الأعمدة المطلوبة: <strong>name, id, contact_name, phone</strong>' +
    '</div>' +
    '<div class="up-zone" onclick="BARQ_TAS.triggerSupImport()" style="margin-bottom:14px">' +
      '<input type="file" id="sup-import-inp" accept=".xlsx,.xls,.csv" onchange="BARQ_TAS.handleSupImport(this)" style="display:none">' +
      '<div style="font-size:32px;margin-bottom:8px">📥</div>' +
      '<div style="font-weight:700;color:var(--primary)">اضغط لاستيراد الموردين</div>' +
      '<div style="font-size:11px;color:var(--muted)">Excel أو CSV من فودكس</div>' +
    '</div>' +
    '<div id="sup-import-result"></div>' +
    '<div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:8px;font-size:12px">' +
      '<strong>الموردين المحملين حالياً:</strong> '+getFinSuppliers().length+' مورد' +
    '</div>' +
  '</div>' +
  renderBulkOpeningSection();
}

function triggerSupImport() {
  var el = document.getElementById('sup-import-inp'); if(el) el.click();
}

function handleSupImport(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var res = document.getElementById('sup-import-result');
  if (res) res.innerHTML = '⏳ جاري المعالجة...';

  var isCSV = /\.csv$/i.test(file.name);
  if (isCSV) {
    var reader = new FileReader();
    reader.onload = function(e){ processSupImport(parseCSV(e.target.result), file.name); };
    reader.readAsText(file, 'UTF-8');
  } else {
    loadXlsxLib(function(){
      var reader = new FileReader();
      reader.onload = function(e){
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
          var sheet = wb.Sheets[wb.SheetNames[0]];
          processSupImport(XLSX.utils.sheet_to_json(sheet, {defval:''}), file.name);
        } catch(err) {
          var res = document.getElementById('sup-import-result');
          if (res) res.innerHTML = '⚠️ خطأ: '+err.message;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  input.value = '';
}

function processSupImport(rows, filename) {
  var res = document.getElementById('sup-import-result');
  if (!rows||!rows.length) { if(res) res.innerHTML='⚠️ الملف فارغ'; return; }
  // using top-level pickField()

  var seen = {};
  var added=0, skipped=0;
  var newList = [];
  // Keep existing
  getFinSuppliers().forEach(function(s){ seen[s.name]=true; newList.push(s); });

  rows.forEach(function(row){
    var name    = String(pickField(row,['name','الاسم'])).trim();
    var id      = String(pickField(row,['id',''])).trim();
    var contact = String(pickField(row,['contact_name','contact','المسؤول'])).trim();
    var phone   = String(pickField(row,['phone','الهاتف'])).trim();
    if (!name||seen[name]) { skipped++; return; }
    seen[name] = true;
    var code = 'SUP-'+String(newList.length+1).padStart(4,'0');
    newList.push({ code:code, id:id, name:name, contact:contact, phone:phone });
    added++;
  });

  FIN_SUPPLIERS = newList;
  addAudit('استيراد موردين', ROLES.finance.label, filename+' — جديد: '+added+' | مكرر: '+skipped);
  if (res) res.innerHTML = '<div style="padding:10px;background:#eafaf1;border-radius:8px;font-size:13px">'+
    '✅ تم: <strong>'+added+'</strong> مورد جديد | <strong>'+skipped+'</strong> مكرر | إجمالي: <strong>'+newList.length+'</strong></div>';
  toast('✅ تم استيراد '+added+' مورد جديد');
}

// ── Payment Modal (Ahmed Salah — with payment method) ──
function addPaymentModal(supName) {
  var ex=document.getElementById('fin-modal'); if(ex) ex.remove();
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;}) || {payments:[],returns:[]};
  var accounts = buildSupplierAccounts();
  var acc = accounts[supName] || {totalInvoiced:0};
  var paid = (finSup.payments||[]).reduce(function(s,p){return s+p.amount;},0);
  var rets = (finSup.returns||[]).reduce(function(s,r){return s+r.amount;},0);
  var remaining = acc.totalInvoiced - paid - rets;

  var modal=document.createElement('div');
  modal.id='fin-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:400px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">'+
    '<div style="font-size:15px;font-weight:800;color:var(--primary);margin-bottom:3px">💰 تسجيل دفعة</div>'+
    '<div style="font-size:12px;color:var(--blue);margin-bottom:14px">🏪 '+supName+
      ' | <span style="color:#c0392b">المتبقي: '+fmt(remaining)+' ج</span></div>'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">طريقة الصرف *</label>'+
    '<select id="pay-method" class="fi" style="margin-bottom:10px"><option value="">-- اختار طريقة الصرف --</option>'+
      (typeof PAYMENT_METHODS!=='undefined'?PAYMENT_METHODS.map(function(m){return '<option value="'+m.id+'">'+m.icon+' '+m.label+'</option>';}).join(''):'')+
    '</select>'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">المبلغ (ج) *</label>'+
    '<input type="number" id="pay-amount" class="fi" step="0.01" min="0.01" value="'+remaining.toFixed(2)+'" style="margin-bottom:10px">'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">رقم المرجع (شيك/تحويل)</label>'+
    '<input type="text" id="pay-ref" class="fi" placeholder="شيك رقم / رقم تحويل..." style="margin-bottom:10px">'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">ملاحظات</label>'+
    '<input type="text" id="pay-note" class="fi" placeholder="اختياري" style="margin-bottom:14px">'+
    '<div style="display:flex;gap:8px">'+
      '<button class="bn bn-p" style="flex:1" onclick="BARQ_TAS.confirmPayment(\''+supName.replace(/'/g,"\\'")+'\')">✅ تأكيد</button>'+
      '<button class="bn bn-g" onclick="document.getElementById(\'fin-modal\').remove()">إلغاء</button>'+
    '</div></div>';
  document.body.appendChild(modal);
}

async function confirmPayment(supName) {
  var method = (document.getElementById('pay-method')||{}).value||'';
  var amount = parseFloat((document.getElementById('pay-amount')||{}).value)||0;
  var ref    = (document.getElementById('pay-ref')||{}).value||'';
  var note   = (document.getElementById('pay-note')||{}).value||'';
  if (!method) { toast('⚠️ اختار طريقة الصرف'); return; }
  if (amount<=0) { toast('⚠️ أدخل مبلغ صحيح'); return; }
  var pm = (typeof PAYMENT_METHODS!=='undefined') ? PAYMENT_METHODS.find(function(m){return m.id===method;})||{label:method} : {label:method};

  var result = await sbWrite('supplier_payments', {
    method:'POST',
    body: JSON.stringify({ supplier_name:supName, amount:amount, method:method, method_label:pm.label, ref:ref, note:note, paid_by:ROLES[role].label })
  }, { opType:'دفعة_مورد', label:'دفعة: '+supName+' — '+fmt(amount)+' ج', afterData:{supplier:supName, amount:amount} });

  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;});
  if (!finSup) { finSup={name:supName,balance:0,payments:[],returns:[]}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.payments) finSup.payments=[];
  finSup.payments.push({amount:amount,method:method,method_label:pm.label,ref:ref,note:note,date:now(),rawDate:new Date().toISOString()});
  addAudit('تسجيل دفعة',ROLES[role].label,supName+' — '+fmt(amount)+' ج — '+pm.label+(ref?' ('+ref+')':''));
  var modal=document.getElementById('fin-modal'); if(modal) modal.remove();
  toast(result.queued ? '📴 تم الحفظ محلياً — سيُرفع تلقائياً' : '✅ تم تسجيل الدفعة: '+fmt(amount)+' ج عبر '+pm.label);
  openSupplierDetail(supName);
}

// ── Return Modal ──
function addReturnModal(supName) {
  var ex=document.getElementById('fin-modal'); if(ex) ex.remove();
  var modal=document.createElement('div');
  modal.id='fin-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:400px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">'+
    '<div style="font-size:15px;font-weight:800;color:#e67e22;margin-bottom:3px">↩️ تسجيل مرتجع / خصم</div>'+
    '<div style="font-size:12px;color:var(--blue);margin-bottom:14px">🏪 '+supName+'</div>'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">السبب *</label>'+
    '<select id="ret-reason" class="fi" style="margin-bottom:10px">'+
      '<option value="منتجات منتهية الصلاحية">منتجات منتهية الصلاحية</option>'+
      '<option value="عيب في المنتج">عيب في المنتج</option>'+
      '<option value="كمية زيادة">كمية زيادة</option>'+
      '<option value="غلط في الفاتورة">غلط في الفاتورة</option>'+
      '<option value="خصم متفق عليه">خصم متفق عليه</option>'+
      '<option value="أخرى">أخرى</option>'+
    '</select>'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">القيمة (ج) *</label>'+
    '<input type="number" id="ret-amount" class="fi" step="0.01" min="0.01" placeholder="0.00" style="margin-bottom:10px">'+
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">تفاصيل</label>'+
    '<input type="text" id="ret-detail" class="fi" placeholder="تفاصيل المرتجع..." style="margin-bottom:14px">'+
    '<div style="display:flex;gap:8px">'+
      '<button class="bn" style="flex:1;background:#e67e22;color:#fff" onclick="BARQ_TAS.confirmReturn(\''+supName.replace(/'/g,"\\'")+'\')">↩️ تأكيد</button>'+
      '<button class="bn bn-g" onclick="document.getElementById(\'fin-modal\').remove()">إلغاء</button>'+
    '</div></div>';
  document.body.appendChild(modal);
}

async function confirmReturn(supName) {
  var reason = (document.getElementById('ret-reason')||{}).value||'أخرى';
  var amount = parseFloat((document.getElementById('ret-amount')||{}).value)||0;
  var detail = (document.getElementById('ret-detail')||{}).value||'';
  if (amount<=0) { toast('⚠️ أدخل قيمة صحيحة'); return; }

  var result = await sbWrite('supplier_returns', {
    method:'POST',
    body: JSON.stringify({ supplier_name:supName, amount:amount, reason:reason, detail:detail, done_by:ROLES[role].label })
  }, { opType:'مرتجع_مورد', label:'مرتجع: '+supName+' — '+fmt(amount)+' ج', afterData:{supplier:supName, amount:amount, reason:reason} });

  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;});
  if (!finSup) { finSup={name:supName,balance:0,payments:[],returns:[]}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.returns) finSup.returns=[];
  finSup.returns.push({amount:amount,reason:reason,detail:detail,date:now(),rawDate:new Date().toISOString()});
  addAudit('مرتجع/خصم',ROLES[role].label,supName+' — '+fmt(amount)+' ج — '+reason);
  var modal=document.getElementById('fin-modal'); if(modal) modal.remove();
  toast(result.queued ? '📴 تم الحفظ محلياً — سيُرفع تلقائياً' : '↩️ تم خصم '+fmt(amount)+' ج من حساب '+supName);
  openSupplierDetail(supName);
}

// ═══════════════════════════════════════════════
// OPENING BALANCE — رصيد افتتاحي
// ═══════════════════════════════════════════════
function openingBalanceModal(supName) {
  var ex = document.getElementById('fin-modal'); if(ex) ex.remove();
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;}) || {};
  var current = parseFloat(finSup.opening)||0;

  var modal = document.createElement('div');
  modal.id = 'fin-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:400px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
    '<div style="font-size:15px;font-weight:800;color:#7f8c8d;margin-bottom:4px">📂 رصيد افتتاحي</div>' +
    '<div style="font-size:12px;color:var(--blue);font-weight:700;margin-bottom:6px">🏪 '+supName+'</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;padding:8px;background:#fef9e7;border-radius:8px">' +
      'ده الرصيد المستحق للمورد قبل بداية النظام — بيتضاف لأول الكشف' +
    '</div>' +
    (current>0 ? '<div style="font-size:12px;margin-bottom:12px;color:var(--muted)">الرصيد الحالي: <strong style="color:var(--primary)">'+fmt(current)+' ج</strong></div>' : '') +
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">الرصيد الافتتاحي (ج)</label>' +
    '<input type="number" id="opening-amount" class="fi" step="0.01" min="0" value="'+current+'" placeholder="0.00" style="margin-bottom:10px">' +
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">تاريخ بداية الحساب</label>' +
    '<input type="date" id="opening-date" class="fi" style="margin-bottom:14px" value="'+new Date().toISOString().slice(0,10)+'">' +
    '<div style="display:flex;gap:8px">' +
      '<button class="bn" style="flex:1;background:#7f8c8d;color:#fff" onclick="BARQ_TAS.confirmOpeningBalance(\''+supName.replace(/'/g,"\\'")+'\')">📂 تأكيد الرصيد</button>' +
      '<button class="bn bn-g" onclick="document.getElementById(\'fin-modal\').remove()">إلغاء</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(modal);
}

async function confirmOpeningBalance(supName) {
  var amount = parseFloat((document.getElementById('opening-amount')||{}).value)||0;
  var date   = (document.getElementById('opening-date')||{}).value || new Date().toISOString().slice(0,10);
  if (amount < 0) { toast('⚠️ الرصيد لازم يكون صفر أو أكبر'); return; }

  // Upsert مباشر بالـ supplier_name (عمود UNIQUE) — يعمل أونلاين وأوفلاين بدون الحاجة لقراءة مسبقة
  var result = await sbWrite('supplier_accounts?on_conflict=supplier_name', {
    method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify({ supplier_name:supName, opening_balance:amount, opening_date:date })
  }, { opType:'رصيد_افتتاحي', label:'رصيد افتتاحي: '+supName+' — '+fmt(amount)+' ج', afterData:{supplier:supName, amount:amount} });

  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;});
  if (!finSup) { finSup={name:supName,balance:0,payments:[],returns:[],opening:0}; MOCK_SUPPLIERS.push(finSup); }
  finSup.opening = amount;
  finSup.openingDate = date;
  addAudit('رصيد افتتاحي', ROLES[role].label, supName+' — '+fmt(amount)+' ج');
  var modal = document.getElementById('fin-modal'); if(modal) modal.remove();
  toast(result.queued ? '📴 تم الحفظ محلياً — سيُرفع تلقائياً' : '✅ تم تسجيل الرصيد الافتتاحي: '+fmt(amount)+' ج');
  openSupplierDetail(supName);
}

// ═══════════════════════════════════════════════
// BULK OPENING BALANCE — رفع من Excel/CSV
// ═══════════════════════════════════════════════
function renderBulkOpeningSection() {
  return '<div class="cd" style="margin-top:12px">' +
    '<div class="ct">📂 رفع أرصدة افتتاحية من Excel</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;padding:8px;background:#fef9e7;border-radius:8px">' +
      'الأعمدة المطلوبة: <strong>name, balance</strong> (اسم المورد + الرصيد المستحق)' +
    '</div>' +
    '<div class="up-zone" onclick="BARQ_TAS.triggerBulkOpening()">' +
      '<input type="file" id="bulk-opening-inp" accept=".xlsx,.xls,.csv" onchange="BARQ_TAS.handleBulkOpening(this)" style="display:none">' +
      '<div style="font-size:28px;margin-bottom:6px">📂</div>' +
      '<div style="font-weight:700;color:var(--primary)">اضغط لرفع شيت الأرصدة الافتتاحية</div>' +
      '<div style="font-size:11px;color:var(--muted)">Excel أو CSV</div>' +
    '</div>' +
    '<div id="bulk-opening-result" style="margin-top:10px"></div>' +
  '</div>';
}

function triggerBulkOpening() {
  var el = document.getElementById('bulk-opening-inp'); if(el) el.click();
}

function handleBulkOpening(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var res = document.getElementById('bulk-opening-result');
  if (res) res.innerHTML = '⏳ جاري المعالجة...';

  if (/\.csv$/i.test(file.name)) {
    var reader = new FileReader();
    reader.onload = function(e){ processBulkOpening(parseCSV(e.target.result), file.name); };
    reader.readAsText(file, 'UTF-8');
  } else {
    loadXlsxLib(function(){
      var reader = new FileReader();
      reader.onload = function(e){
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result),{type:'array'});
          processBulkOpening(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''}), file.name);
        } catch(err) {
          var res = document.getElementById('bulk-opening-result');
          if(res) res.innerHTML = '⚠️ خطأ: '+err.message;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  input.value='';
}

function processBulkOpening(rows, filename) {
  var res = document.getElementById('bulk-opening-result');
  if (!rows||!rows.length) { if(res) res.innerHTML='⚠️ الملف فارغ'; return; }

  // pickField moved to top-level utility

  var updated=0, notFound=0, notFoundList=[];
  rows.forEach(function(row){
    var name    = String(pickField(row,['name','الاسم','المورد'])).trim();
    var balance = parseFloat(pickField(row,['balance','رصيد','الرصيد','المديونية'])) || 0;
    if (!name) return;

    var finSup = MOCK_SUPPLIERS.find(function(s){ return s.name===name; });
    if (!finSup) {
      // Try partial match
      finSup = MOCK_SUPPLIERS.find(function(s){ return s.name.indexOf(name)>=0 || name.indexOf(s.name)>=0; });
    }
    if (finSup) {
      finSup.opening = balance;
      finSup.openingDate = new Date().toISOString().slice(0,10);
      updated++;
    } else {
      // Auto-create supplier account
      MOCK_SUPPLIERS.push({ name:name, balance:0, payments:[], returns:[], opening:balance, openingDate:new Date().toISOString().slice(0,10) });
      updated++;
      notFound++;
      notFoundList.push(name);
    }
  });

  addAudit('رفع أرصدة افتتاحية', ROLES[role].label, filename+' — تم: '+updated+' مورد');
  var html = '<div style="padding:10px;background:#eafaf1;border-radius:8px;font-size:13px;margin-bottom:8px">' +
    '✅ تم تحديث <strong>'+updated+'</strong> مورد</div>';
  if (notFoundList.length) {
    html += '<div style="padding:10px;background:#fef9e7;border-radius:8px;font-size:12px">' +
      '⚠️ تم إنشاء '+notFound+' مورد جديد (مش موجود في القائمة):<br>' +
      notFoundList.slice(0,5).join(' | ') + (notFoundList.length>5?' و'+( notFoundList.length-5)+' آخرين':'') +
    '</div>';
  }
  if (res) res.innerHTML = html;
  toast('✅ تم رفع الأرصدة الافتتاحية');
  renderFinanceRoot();
}



// ── Utility: pick field from object by multiple possible names ──
function pickField(obj, names) {
  var keys = Object.keys(obj);
  for (var i=0; i<names.length; i++) {
    var k = keys.find(function(kk){ return kk.toLowerCase().trim()===names[i]; });
    if (k !== undefined && obj[k] !== '') return obj[k];
  }
  return '';
}

function payMethodOptions(selected) {
  return PAYMENT_METHODS.map(function(m){
    return '<option value="'+m.id+'"'+(m.id===selected?' selected':'')+'>'+m.icon+' '+m.label+'</option>';
  }).join('');
}

// ═══════════════════════════════════════════════
// FINANCE MANAGER SCREEN (عمر أبو الفضل — 4444)
// ═══════════════════════════════════════════════
var finMgrView = 'suppliers'; // suppliers | detail
var finMgrSupplier = null;

function renderFinMgr() {
  if (finMgrView === 'detail' && finMgrSupplier) return renderFinMgrDetail(finMgrSupplier);
  return renderFinMgrSuppliers();
}

function renderFinMgrSuppliers() {
  // Build aggregated supplier data
  var supMap = {};
  MOCK_REQUESTS.forEach(function(r){
    var k = r.supplier_name||'—';
    if (!supMap[k]) supMap[k] = { name:k, invoices:[], totalInvoiced:0 };
    supMap[k].invoices.push(r);
    supMap[k].totalInvoiced += (parseFloat(r.new_cost)||0)*(parseFloat(r.qty_received)||0);
  });

  var allNames = [];
  Object.keys(supMap).forEach(function(k){ allNames.push(k); });
  MOCK_SUPPLIERS.forEach(function(s){ if (allNames.indexOf(s.name)===-1) allNames.push(s.name); });

  var rows = allNames.map(function(name){
    var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===name;}) || {payments:[],returns:[]};
    var data = supMap[name] || {totalInvoiced:0,invoices:[]};
    var bal = getSupplierBalance(name);
    var lastPay = finSup.payments&&finSup.payments.length ? finSup.payments[finSup.payments.length-1] : null;
    return { name:name, totalInvoiced:data.totalInvoiced, totalPaid:bal.totalPaid, totalReturns:bal.totalReturns, totalDue:bal.totalDue, lastPay:lastPay, invoices:data.invoices };
  }).filter(function(r){ return r.totalInvoiced>0||r.totalPaid>0; });

  var grandInvoiced = rows.reduce(function(s,r){return s+r.totalInvoiced;},0);
  var grandPaid     = rows.reduce(function(s,r){return s+r.totalPaid;},0);
  var grandReturns  = rows.reduce(function(s,r){return s+r.totalReturns;},0);
  var grandDue      = rows.reduce(function(s,r){return s+r.totalDue;},0);

  if (!rows.length) return '<div class="cd"><div class="ct">📊 مدير المالية — حسابات الموردين</div>' +
    '<div class="empty"><div class="empty-i">📭</div><div>لا توجد فواتير بعد</div></div></div>';

  var tableRows = rows.map(function(r){
    var statusColor = r.totalDue<=0?'#1a7a40':r.totalPaid>0?'#d68910':'#c0392b';
    var statusBg    = r.totalDue<=0?'#eafaf1':r.totalPaid>0?'#fef9e7':'#fce4ec';
    var statusLbl   = r.totalDue<=0?'مسدد':r.totalPaid>0?'جزئي':'مستحق';
    var lastPayInfo = r.lastPay ? fmt(r.lastPay.amount)+' ج ('+r.lastPay.method_label+')' : '—';
    return '<tr style="cursor:pointer" onclick="BARQ_TAS.openFinMgrDetail(\''+r.name.replace(/'/g,"\\'")+'\''+')" ' +
      'onmouseover="this.style.background=\'#f8fffe\'" onmouseout="this.style.background=\'\'">' +
      '<td style="padding:11px 12px;font-weight:700;color:var(--blue)">🏪 '+esc(r.name)+'</td>' +
      '<td style="padding:11px 12px;text-align:center">'+r.invoices.length+'</td>' +
      '<td style="padding:11px 12px;text-align:center;font-weight:700">'+fmt(r.totalInvoiced)+' ج</td>' +
      '<td style="padding:11px 12px;text-align:center;color:#1a7a40;font-weight:700">'+fmt(r.totalPaid)+' ج</td>' +
      '<td style="padding:11px 12px;text-align:center;color:#e67e22">'+(r.totalReturns>0?'('+fmt(r.totalReturns)+' ج)':'—')+'</td>' +
      '<td style="padding:11px 12px;text-align:center;font-weight:900;color:'+statusColor+';font-size:15px">'+fmt(r.totalDue)+' ج</td>' +
      '<td style="padding:11px 12px;text-align:center"><span style="background:'+statusBg+';color:'+statusColor+';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800">'+statusLbl+'</span></td>' +
      '<td style="padding:11px 12px;font-size:11px;color:var(--muted)">'+lastPayInfo+'</td>' +
    '</tr>';
  }).join('');

  return '<div class="dg" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
    '<div class="db"><div class="dn" style="font-size:20px">'+fmt(grandInvoiced)+'</div><div class="dl">إجمالي الفواتير</div></div>' +
    '<div class="db"><div class="dn" style="color:#1a7a40;font-size:20px">'+fmt(grandPaid)+'</div><div class="dl">إجمالي المدفوع</div></div>' +
    '<div class="db"><div class="dn" style="color:#e67e22;font-size:20px">'+fmt(grandReturns)+'</div><div class="dl">إجمالي المرتجعات</div></div>' +
    '<div class="db" style="border:2px solid '+(grandDue>0?'#c0392b':'#1a7a40')+'">' +
      '<div class="dn" style="color:'+(grandDue>0?'#c0392b':'#1a7a40')+';font-size:20px">'+fmt(grandDue)+'</div>' +
      '<div class="dl">إجمالي المتبقي</div>' +
    '</div>' +
  '</div>' +

  '<div class="cd">' +
    '<div class="ct">📊 مدير المالية — حسابات جميع الموردين</div>' +
    '<div style="overflow-x:auto"><table class="fnt"><thead><tr>' +
      '<th>المورد</th>' +
      '<th style="text-align:center">الفواتير</th>' +
      '<th style="text-align:center">إجمالي الفواتير</th>' +
      '<th style="text-align:center">المدفوع</th>' +
      '<th style="text-align:center">المرتجعات</th>' +
      '<th style="text-align:center">المتبقي</th>' +
      '<th style="text-align:center">الحالة</th>' +
      '<th>آخر دفعة</th>' +
    '</tr></thead><tbody>'+tableRows+'</tbody>' +
    '<tfoot><tr style="background:#f0f7f2;font-weight:900">' +
      '<td style="padding:11px 12px">الإجمالي</td><td></td>' +
      '<td style="padding:11px 12px;text-align:center">'+fmt(grandInvoiced)+' ج</td>' +
      '<td style="padding:11px 12px;text-align:center;color:#1a7a40">'+fmt(grandPaid)+' ج</td>' +
      '<td style="padding:11px 12px;text-align:center;color:#e67e22">'+(grandReturns>0?'('+fmt(grandReturns)+' ج)':'—')+'</td>' +
      '<td style="padding:11px 12px;text-align:center;color:'+(grandDue>0?'#c0392b':'#1a7a40')+';font-size:16px">'+fmt(grandDue)+' ج</td>' +
      '<td colspan="2"></td>' +
    '</tr></tfoot>' +
    '</table></div>' +
  '</div>';
}

function openFinMgrDetail(name) {
  finMgrSupplier = name;
  finMgrView = 'detail';
  var root = document.getElementById('tas-root');
  if (root) root.innerHTML = renderTopBar() + '<div class="pg">' + renderFinMgrDetail(name) + '</div>';
}

function renderFinMgrDetail(name) {
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===name;}) || {payments:[],returns:[]};
  if (!finSup.payments) finSup.payments=[];
  if (!finSup.returns)  finSup.returns=[];

  var invoices    = MOCK_REQUESTS.filter(function(r){return r.supplier_name===name;});
  var bal = getSupplierBalance(name);
  var totalInvoiced = bal.totalInvoiced;
  var totalPaid     = bal.totalPaid;
  var totalReturns  = bal.totalReturns;
  var totalDue      = bal.totalDue;
  var opening       = bal.opening;

  // Timeline
  var timeline = [];
  if (opening > 0) {
    timeline.push({ type:'opening', rawDate:'2000-01-01', label:'رصيد افتتاحي', ref:'', detail:'رصيد مرحّل من قبل النظام', amount:opening });
  }
  invoices.forEach(function(r){
    var line = (parseFloat(r.new_cost)||0)*(parseFloat(r.qty_received)||0);
    timeline.push({ type:'invoice', rawDate:r.created_at, label:'فاتورة', ref:r.po_number, detail:r.product_name, amount:line });
  });
  finSup.payments.forEach(function(p){
    timeline.push({ type:'payment', rawDate:p.rawDate||new Date().toISOString(), label:'دفعة — '+p.method_label, ref:p.ref||'', detail:p.note||'', amount:-p.amount });
  });
  finSup.returns.forEach(function(r){
    timeline.push({ type:'return', rawDate:r.rawDate||new Date().toISOString(), label:'مرتجع — '+r.reason, ref:'', detail:r.detail||'', amount:-r.amount });
  });
  timeline.sort(function(a,b){ return new Date(a.rawDate)-new Date(b.rawDate); });

  var running = 0;
  var tlHTML = timeline.map(function(t){
    running += t.amount;
    var icon = {invoice:'🧾',payment:'💰',return:'↩️',opening:'📂'}[t.type]||'•';
    var amtColor = t.amount>0?'#c0392b':'#1a7a40';
    return '<tr>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted);white-space:nowrap">'+(t.rawDate||'').slice(0,10)+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-size:16px">'+icon+'</td>' +
      '<td style="padding:9px 10px;font-weight:700">'+esc(t.label)+'</td>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted)">'+esc(t.ref)+(t.detail?' | '+esc(t.detail):'')+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:'+amtColor+'">'+(t.amount>0?'+':'')+fmt(Math.abs(t.amount))+' ج</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:900;color:'+(running>0?'#c0392b':'#1a7a40')+'">'+fmt(running)+' ج</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">لا توجد حركات</td></tr>';

  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">' +
    '<button class="bn bn-g" onclick="finMgrView=\'suppliers\';render()">← رجوع</button>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="bn bn-p" onclick="BARQ_TAS.finMgrPayModal(\''+name.replace(/'/g,"\\'")+'\')">💰 تسجيل دفعة</button>' +
      '<button class="bn bn-o" onclick="BARQ_TAS.finMgrReturnModal(\''+name.replace(/'/g,"\\'")+'\')">↩️ تسجيل مرتجع</button>' +
      '<button class="bn bn-b" onclick="window.print()">🖨️ طباعة كشف الحساب</button>' +
    '</div>' +
  '</div>' +

  '<div class="dg" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
    '<div class="db"><div class="dn" style="font-size:20px">'+fmt(totalInvoiced)+'</div><div class="dl">إجمالي الفواتير</div></div>' +
    '<div class="db"><div class="dn" style="color:#1a7a40;font-size:20px">'+fmt(totalPaid)+'</div><div class="dl">إجمالي المدفوع</div></div>' +
    '<div class="db"><div class="dn" style="color:#e67e22;font-size:20px">'+fmt(totalReturns)+'</div><div class="dl">المرتجعات</div></div>' +
    '<div class="db" style="border:2px solid '+(totalDue>0?'#c0392b':'#1a7a40')+'">' +
      '<div class="dn" style="font-size:20px;color:'+(totalDue>0?'#c0392b':'#1a7a40')+'">'+fmt(Math.abs(totalDue))+'</div>' +
      '<div class="dl">'+(totalDue>0?'متبقي مستحق':'رصيد دائن')+'</div>' +
    '</div>' +
  '</div>' +

  '<div class="cd">' +
    '<div class="ct">🏪 '+name+' — كشف الحساب الكامل</div>' +
    '<div style="overflow-x:auto"><table class="fnt"><thead><tr>' +
      '<th style="white-space:nowrap">التاريخ</th><th style="width:40px;text-align:center">نوع</th>' +
      '<th>البيان</th><th>التفاصيل</th>' +
      '<th style="text-align:center">المبلغ</th><th style="text-align:center">الرصيد التراكمي</th>' +
    '</tr></thead><tbody>'+tlHTML+'</tbody>' +
    '<tfoot><tr style="background:#f0f7f2">' +
      '<td colspan="4" style="padding:11px 12px;font-weight:900">الرصيد النهائي</td><td></td>' +
      '<td style="padding:11px 12px;text-align:center;font-weight:900;font-size:18px;color:'+(totalDue>0?'#c0392b':'#1a7a40')+'">'+fmt(Math.abs(totalDue))+' ج</td>' +
    '</tr></tfoot>' +
    '</table></div>' +
  '</div>';
}

// ── Modal: دفعة (مدير المالية — طريقة الصرف) ──
function finMgrPayModal(supName) {
  var ex = document.getElementById('fin-modal'); if(ex) ex.remove();
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;}) || {payments:[],returns:[]};
  var totalPaid = (finSup.payments||[]).reduce(function(s,p){return s+p.amount;},0);
  var totalReturns = (finSup.returns||[]).reduce(function(s,r){return s+r.amount;},0);
  var invoiceTotal = MOCK_REQUESTS.filter(function(r){return r.supplier_name===supName;})
    .reduce(function(s,r){return s+(parseFloat(r.new_cost)||0)*(parseFloat(r.qty_received)||0);},0);
  var remaining = invoiceTotal - totalPaid - totalReturns;

  var modal = document.createElement('div');
  modal.id = 'fin-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:420px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
    '<div style="font-size:16px;font-weight:800;color:var(--primary);margin-bottom:4px">💰 تسجيل دفعة</div>' +
    '<div style="font-size:13px;color:var(--blue);font-weight:700;margin-bottom:16px">🏪 '+supName+
      ' <span style="color:#c0392b;margin-right:8px">المتبقي: '+fmt(remaining)+' ج</span></div>' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">طريقة الصرف *</label>' +
    '<select id="pay-method" class="fi" style="margin-bottom:12px"><option value="">-- اختار طريقة الصرف --</option>'+payMethodOptions('')+'</select>' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">المبلغ (ج) *</label>' +
    '<input type="number" id="pay-amount" class="fi" placeholder="0.00" step="0.01" min="0.01" style="margin-bottom:12px" value="'+remaining.toFixed(2)+'">' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">رقم المرجع (شيك/تحويل)</label>' +
    '<input type="text" id="pay-ref" class="fi" placeholder="مثال: شيك رقم 00123" style="margin-bottom:12px">' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">ملاحظات</label>' +
    '<input type="text" id="pay-note" class="fi" placeholder="اختياري" style="margin-bottom:16px">' +

    '<div style="display:flex;gap:8px">' +
      '<button class="bn bn-p" style="flex:1" onclick="BARQ_TAS.confirmFinMgrPayment(\''+supName.replace(/'/g,"\\'")+'\')">✅ تأكيد الدفعة</button>' +
      '<button class="bn bn-g" onclick="document.getElementById(\'fin-modal\').remove()">إلغاء</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(modal);
}

function confirmFinMgrPayment(supName) {
  var method = (document.getElementById('pay-method')||{}).value||'';
  var amount = parseFloat((document.getElementById('pay-amount')||{}).value)||0;
  var ref    = (document.getElementById('pay-ref')||{}).value||'';
  var note   = (document.getElementById('pay-note')||{}).value||'';
  if (!method) { toast('⚠️ اختار طريقة الصرف'); return; }
  if (amount<=0) { toast('⚠️ أدخل مبلغ صحيح'); return; }
  var methodObj = PAYMENT_METHODS.find(function(m){return m.id===method;}) || {label:method};
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;});
  if (!finSup) { finSup={name:supName,balance:0,payments:[],returns:[]}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.payments) finSup.payments=[];
  finSup.payments.push({ amount:amount, method:method, method_label:methodObj.label, ref:ref, note:note, date:now(), rawDate:new Date().toISOString() });
  addAudit('تسجيل دفعة', ROLES.finmgr.label, supName+' — '+fmt(amount)+' ج — '+methodObj.label+(ref?' — '+ref:''));
  var modal = document.getElementById('fin-modal'); if(modal) modal.remove();
  toast('✅ تم تسجيل الدفعة: '+fmt(amount)+' ج عبر '+methodObj.label);
  openFinMgrDetail(supName);
}

// ── Modal: مرتجع (مدير المالية) ──
function finMgrReturnModal(supName) {
  var ex = document.getElementById('fin-modal'); if(ex) ex.remove();
  var modal = document.createElement('div');
  modal.id = 'fin-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:420px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
    '<div style="font-size:16px;font-weight:800;color:#e67e22;margin-bottom:4px">↩️ تسجيل مرتجع</div>' +
    '<div style="font-size:13px;color:var(--blue);font-weight:700;margin-bottom:16px">🏪 '+supName+'</div>' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">سبب المرتجع *</label>' +
    '<select id="ret-reason" class="fi" style="margin-bottom:12px">' +
      '<option value="منتجات منتهية الصلاحية">منتجات منتهية الصلاحية</option>' +
      '<option value="عيب في المنتج">عيب في المنتج</option>' +
      '<option value="كمية زيادة">كمية زيادة</option>' +
      '<option value="غلط في الفاتورة">غلط في الفاتورة</option>' +
      '<option value="خصم متفق عليه">خصم متفق عليه</option>' +
      '<option value="أخرى">أخرى</option>' +
    '</select>' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">قيمة المرتجع / الخصم (ج) *</label>' +
    '<input type="number" id="ret-amount" class="fi" placeholder="0.00" step="0.01" min="0.01" style="margin-bottom:12px">' +

    '<label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">تفاصيل</label>' +
    '<input type="text" id="ret-detail" class="fi" placeholder="مثال: 10 قطعة منتهية الصلاحية" style="margin-bottom:16px">' +

    '<div style="display:flex;gap:8px">' +
      '<button class="bn" style="flex:1;background:#e67e22;color:#fff" onclick="BARQ_TAS.confirmFinMgrReturn(\''+supName.replace(/'/g,"\\'")+'\')">↩️ تأكيد المرتجع</button>' +
      '<button class="bn bn-g" onclick="document.getElementById(\'fin-modal\').remove()">إلغاء</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(modal);
}

function confirmFinMgrReturn(supName) {
  var reason = (document.getElementById('ret-reason')||{}).value||'أخرى';
  var amount = parseFloat((document.getElementById('ret-amount')||{}).value)||0;
  var detail = (document.getElementById('ret-detail')||{}).value||'';
  if (amount<=0) { toast('⚠️ أدخل قيمة صحيحة'); return; }
  var finSup = MOCK_SUPPLIERS.find(function(s){return s.name===supName;});
  if (!finSup) { finSup={name:supName,balance:0,payments:[],returns:[]}; MOCK_SUPPLIERS.push(finSup); }
  if (!finSup.returns) finSup.returns=[];
  finSup.returns.push({ amount:amount, reason:reason, detail:detail, date:now(), rawDate:new Date().toISOString() });
  addAudit('تسجيل مرتجع/خصم', ROLES.finmgr.label, supName+' — '+fmt(amount)+' ج — '+reason);
  var modal = document.getElementById('fin-modal'); if(modal) modal.remove();
  toast('↩️ تم خصم '+fmt(amount)+' ج من حساب '+supName);
  openFinMgrDetail(supName);
}

// ═══════════════════════════════════════════════
// PURCHASING MANAGER — مدير قسم المشتريات (مشاهدة فقط)
// ═══════════════════════════════════════════════
var purchMgrFilter = 'الكل'; // الكل | مشاكل | معتمد | مرفوض | معلق

function renderPurchMgr() {
  var all = MOCK_REQUESTS.slice().sort(function(a,b){ return new Date(b.created_at)-new Date(a.created_at); });

  var total = all.length;
  var costChanged = all.filter(function(r){ return r.cost_changed; }).length;
  var noCost = all.filter(function(r){ return !r.old_cost || r.old_cost<=0; }).length;
  var approved = all.filter(function(r){ return r.status===STATUSES.export_ready || r.status===STATUSES.exported; }).length;
  var rejected = all.filter(function(r){ return r.status===STATUSES.rejected; }).length;
  var deferred = all.filter(function(r){ return r.status===STATUSES.deferred; }).length;
  var pending = all.filter(function(r){ return r.status===STATUSES.sent || r.status===STATUSES.pricing; }).length;

  var filters = {
    'الكل': all,
    'مشاكل': all.filter(function(r){ return r.cost_changed || !r.old_cost || r.old_cost<=0; }),
    'معتمد': all.filter(function(r){ return r.status===STATUSES.export_ready || r.status===STATUSES.exported; }),
    'مرفوض': all.filter(function(r){ return r.status===STATUSES.rejected; }),
    'معلق': all.filter(function(r){ return r.status===STATUSES.deferred; }),
    'قيد الانتظار': all.filter(function(r){ return r.status===STATUSES.sent || r.status===STATUSES.pricing; })
  };
  var list = filters[purchMgrFilter] || all;

  var filterBtns = Object.keys(filters).map(function(f){
    var active = purchMgrFilter===f;
    return '<button class="bn" style="background:'+(active?'#2c3e50':'var(--bg)')+';color:'+(active?'#fff':'var(--text)')+';border:1px solid #2c3e50" ' +
      'onclick="purchMgrFilter=\''+f+'\';render()">'+f+' ('+filters[f].length+')</button>';
  }).join('');

  var rows = list.slice(0,100).map(function(r){
    var m = calcMargin(r.new_cost, r.final_price||r.suggested_price);
    var mc = mColor(m);
    var diff = r.new_cost - r.old_cost;
    var issueTag = (!r.old_cost||r.old_cost<=0) ? '<span class="bg" style="background:#c0392b22;color:#c0392b">بدون تكلفة سابقة</span>' :
      r.cost_changed ? '<span class="bg" style="background:'+(diff>0?'#c0392b22;color:#c0392b':'#1a7a4022;color:#1a7a40')+'">'+(diff>0?'ارتفاع ':'انخفاض ')+Math.abs(diff).toFixed(1)+' ج</span>' :
      '<span class="bg" style="background:#1a7a4022;color:#1a7a40">لا تغيير</span>';
    return '<tr>' +
      '<td style="padding:9px 10px;font-weight:600;font-size:12px">'+esc(r.product_name)+'<br><span style="font-size:10px;color:var(--muted)">'+r.sku+'</span></td>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted)">'+(r.po_number||'—')+'<br>🏪 '+esc(r.supplier_name||'—')+'</td>' +
      '<td style="padding:9px 10px;text-align:center">'+fmt(r.qty_received)+'</td>' +
      '<td style="padding:9px 10px;text-align:center">'+issueTag+'</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:700;color:'+mc+'">'+(m?m.toFixed(1)+'%':'—')+'</td>' +
      '<td style="padding:9px 10px;text-align:center"><span class="bg '+bgClass(r.status)+'">'+(r.status||'—')+'</span></td>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted)">'+(r.received_by||'—')+'</td>' +
      '<td style="padding:9px 10px;font-size:10px;color:var(--muted)">'+new Date(r.created_at).toLocaleDateString('ar-EG')+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">لا توجد عمليات</td></tr>';

  // Recent audit log (receiving + pricing actions only)
  var relevantActions = ['اعتماد استلام','اعتماد فاتورة يدوية','رفض استلام','اعتماد سعر','رفض تسعير','تعليق تسعير','اعتماد مجمع — اعتماد','اعتماد مجمع — رفض','اعتماد مجمع — معلق','تسجيل مرتجع من الاستلام'];
  var logItems = AUDIT_LOG.filter(function(l){ return relevantActions.indexOf(l.action)>=0; }).slice(0,15).map(function(l){
    var d = new Date(l.time);
    var timeStr = d.toLocaleDateString('ar-EG',{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    return '<div class="log-item"><div class="log-dot" style="background:#2c3e50"></div>' +
      '<div class="log-info"><div style="font-weight:700">'+l.action+'</div>' +
      '<div style="color:var(--muted);font-size:11px">'+l.who+' — '+timeStr+'</div>' +
      (l.detail?'<div style="font-size:11px;color:var(--blue)">'+esc(l.detail)+'</div>':'') +
      '</div></div>';
  }).join('') || '<div style="color:var(--muted);text-align:center;padding:16px">لا توجد عمليات بعد</div>';

  return '<div class="dg">' +
    '<div class="db"><div class="dn">'+total+'</div><div class="dl">إجمالي العمليات</div></div>' +
    '<div class="db"><div class="dn" style="color:#d68910">'+pending+'</div><div class="dl">قيد المراجعة</div></div>' +
    '<div class="db"><div class="dn" style="color:#c0392b">'+costChanged+'</div><div class="dl">تغيّرت تكلفتها</div></div>' +
    '<div class="db"><div class="dn" style="color:#c0392b">'+noCost+'</div><div class="dl">بدون تكلفة سابقة</div></div>' +
  '</div>' +
  '<div class="dg">' +
    '<div class="db"><div class="dn" style="color:#1a7a40">'+approved+'</div><div class="dl">معتمدة</div></div>' +
    '<div class="db"><div class="dn" style="color:#c0392b">'+rejected+'</div><div class="dl">مرفوضة</div></div>' +
    '<div class="db"><div class="dn" style="color:#d68910">'+deferred+'</div><div class="dl">معلّقة</div></div>' +
    '<div class="db"><div class="dn">'+Math.round((approved/(total||1))*100)+'%</div><div class="dl">نسبة الاعتماد</div></div>' +
  '</div>' +
  '<div class="cd">' +
    '<div class="ct">📦 كل عمليات الاستلام والتسعير</div>' +
    '<div class="br" style="margin-bottom:14px">'+filterBtns+'</div>' +
    '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">' +
    '<table class="fnt"><thead><tr>' +
      '<th>الصنف</th><th>المورد / PO</th><th style="text-align:center">الكمية</th>' +
      '<th style="text-align:center">حالة التكلفة</th><th style="text-align:center">الهامش</th>' +
      '<th style="text-align:center">الحالة</th><th>بواسطة</th><th>التاريخ</th>' +
    '</tr></thead><tbody>'+rows+'</tbody></table></div>' +
    (list.length>100 ? '<div style="text-align:center;padding:10px;color:var(--muted);font-size:12px">عرض أول 100 من '+list.length+' عملية</div>' : '') +
  '</div>' +
  '<div class="cd"><div class="ct">📋 آخر العمليات (سجل التدقيق)</div>'+logItems+'</div>';
}

// ═══════════════════════════════════════════════
// 4. DASHBOARD (CEO)
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// SYNC CENTER — مركز المزامنة الكامل
// ═══════════════════════════════════════════════
var SYNC_LOG_FILTER = 'all'; // all | pending | syncing | failed

function opTypeIcon(t) {
  var m = { 'اعتماد_استلام':'📦', 'رفض_استلام':'❌', 'اعتماد_سعر':'💰', 'رفض_سعر':'❌',
            'تعليق_سعر':'⏸️', 'تحديث_مورد':'🏪', 'دفعة_مورد':'💵', 'مرتجع_مورد':'↩️',
            'رصيد_افتتاحي':'📂', 'تحديث_منتج':'📊', 'ملاحظة':'📝', 'سجل_نشاط':'📋' };
  return m[t] || '⚙️';
}

function renderSyncCenter() {
  var lastSync = localStorage.getItem('barq_last_sync_time') || null;
  var pending = OFFLINE_QUEUE.filter(function(o){ return o.status==='pending'; });
  var syncing = OFFLINE_QUEUE.filter(function(o){ return o.status==='syncing'; });
  var failed  = OFFLINE_QUEUE.filter(function(o){ return o.status==='failed'; });

  var filtered = OFFLINE_QUEUE;
  if (SYNC_LOG_FILTER==='pending') filtered = pending;
  if (SYNC_LOG_FILTER==='syncing') filtered = syncing;
  if (SYNC_LOG_FILTER==='failed')  filtered = failed;

  var progressBar = SYNC_PROGRESS ? '<div class="cd" style="border-right:4px solid #1a5276">' +
    '<div class="ct">🔄 جاري الرفع الآن</div>' +
    '<div style="font-size:13px;margin-bottom:8px">'+SYNC_PROGRESS.done+' / '+SYNC_PROGRESS.total+' عملية</div>' +
    '<div style="height:10px;background:var(--bg);border-radius:6px;overflow:hidden">' +
      '<div style="height:100%;background:#1a5276;width:'+Math.round(SYNC_PROGRESS.done/Math.max(SYNC_PROGRESS.total,1)*100)+'%;transition:width .3s"></div>' +
    '</div></div>' : '';

  var filterBtns = [
    {k:'all',label:'الكل',count:OFFLINE_QUEUE.length},
    {k:'pending',label:'قيد الانتظار',count:pending.length},
    {k:'syncing',label:'جاري الرفع',count:syncing.length},
    {k:'failed',label:'فشلت',count:failed.length}
  ].map(function(f){
    var active = SYNC_LOG_FILTER===f.k;
    return '<button class="bn" style="background:'+(active?'#1a3a2a':'var(--bg)')+';color:'+(active?'#fff':'var(--text)')+'" ' +
      'onclick="SYNC_LOG_FILTER=\'' + f.k + '\';render()">'+f.label+' ('+f.count+')</button>';
  }).join('');

  var rows = filtered.length ? filtered.map(function(op){
    var statusMap = {
      pending: {bg:'#fef9e7',color:'#d68910',label:'قيد الانتظار'},
      syncing: {bg:'#e8f4fd',color:'#1a5276',label:'جاري الرفع'},
      failed:  {bg:'#fce4ec',color:'#c0392b',label:'فشلت'},
      synced:  {bg:'#eafaf1',color:'#1a7a40',label:'تمت'}
    };
    var st = statusMap[op.status] || statusMap.pending;
    return '<tr>' +
      '<td style="padding:9px 10px;font-size:16px;text-align:center">'+opTypeIcon(op.opType)+'</td>' +
      '<td style="padding:9px 10px;font-weight:700;font-size:12px">'+op.label+'<br>' +
        '<span style="font-size:10px;color:var(--muted)">'+op.opType+' | أولوية '+op.priority+'</span></td>' +
      '<td style="padding:9px 10px;font-size:11px;color:var(--muted)">'+op.user+'</td>' +
      '<td style="padding:9px 10px;font-size:10px;color:var(--muted)">'+new Date(op.createdAt).toLocaleString('ar-EG')+'</td>' +
      '<td style="padding:9px 10px;text-align:center"><span class="bg" style="background:'+st.bg+';color:'+st.color+'">'+st.label+'</span></td>' +
      '<td style="padding:9px 10px;font-size:10px;color:#c0392b">'+(op.lastError||'')+(op.retryCount?' (محاولة '+op.retryCount+')':'')+'</td>' +
      '<td style="padding:9px 10px;text-align:center">' +
        (op.status==='failed' ? '<button class="bn bn-p" style="font-size:10px;padding:4px 8px" onclick="BARQ_TAS.retryFailedOperation(\''+op.uuid+'\')">🔁 إعادة</button> ' : '') +
        '<button class="bn bn-g" style="font-size:10px;padding:4px 8px" onclick="BARQ_TAS.viewOperationDetails(\''+op.uuid+'\')">👁️ تفاصيل</button> ' +
        (op.status!=='syncing' ? '<button class="bn bn-d" style="font-size:10px;padding:4px 8px" onclick="BARQ_TAS.deleteFailedOperation(\''+op.uuid+'\')">🗑️</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">لا توجد عمليات في هذا الفلتر</td></tr>';

  return '<div class="dg">' +
    '<div class="db"><div class="dn" style="color:#d68910">'+pending.length+'</div><div class="dl">قيد الانتظار</div></div>' +
    '<div class="db"><div class="dn" style="color:#1a5276">'+syncing.length+'</div><div class="dl">جاري الرفع</div></div>' +
    '<div class="db"><div class="dn" style="color:#c0392b">'+failed.length+'</div><div class="dl">فشلت</div></div>' +
    '<div class="db"><div class="dn" id="conn-badge-lg" style="font-size:16px"></div><div class="dl">حالة الاتصال</div></div>' +
  '</div>' +
  progressBar +
  '<div class="cd">' +
    '<div class="ct">🔄 مركز المزامنة (Sync Center)' +
      '<div style="display:flex;gap:6px">' +
        '<button class="bn bn-p" onclick="BARQ_TAS.syncOfflineQueue()">🔁 Sync Now</button>' +
        '<button class="bn" style="background:#c0392b;color:#fff" onclick="BARQ_TAS.retryAllFailed()">🔁 Retry Failed</button>' +
        '<button class="bn bn-b" onclick="BARQ_TAS.exportSyncLog()">📤 Export Log</button>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">آخر مزامنة ناجحة: '+(lastSync?new Date(lastSync).toLocaleString('ar-EG'):'لم تتم بعد')+'</div>' +
    '<div class="br" style="margin-bottom:14px">'+filterBtns+'</div>' +
    '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">' +
    '<table class="ft"><thead><tr>' +
      '<th style="width:40px"></th><th>العملية</th><th>المستخدم</th><th>الوقت</th>' +
      '<th style="text-align:center">الحالة</th><th>السبب (لو فشلت)</th><th style="text-align:center">إجراءات</th>' +
    '</tr></thead><tbody>'+rows+'</tbody></table></div>' +
  '</div>' +
  '<div class="cd" style="background:var(--bg);font-size:11px;color:var(--muted)">' +
    '🔒 البيانات المحفوظة محلياً على هذا الجهاز مشفّرة (AES-256) — لا يمكن قراءتها كملف عادي خارج التطبيق. ' +
    'لكن كما هو الحال في أي تطبيق يعمل من المتصفح فقط، هذا الإجراء يحمي من القراءة العرضية وليس بديلاً كاملاً عن تشفير من جهة خادم مستقل.' +
  '</div>';
}

function retryAllFailed() {
  OFFLINE_QUEUE.forEach(function(op){ if (op.status==='failed') { op.status='pending'; op.retryCount=0; } });
  saveOfflineQueue();
  syncOfflineQueue();
}

function viewOperationDetails(uuid) {
  var op = OFFLINE_QUEUE.find(function(o){ return o.uuid===uuid; });
  if (!op) return;
  var modal = document.createElement('div');
  modal.id = 'fin-modal';
  var existing = document.getElementById('fin-modal'); if(existing) existing.remove();
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:22px;width:100%;max-width:480px;font-family:Cairo,sans-serif;direction:rtl;max-height:80vh;overflow-y:auto">' +
    '<div style="font-size:15px;font-weight:800;color:var(--primary);margin-bottom:12px">'+opTypeIcon(op.opType)+' '+op.label+'</div>' +
    '<div style="font-size:12px;line-height:2">' +
      '<div><strong>UUID:</strong> <span style="font-family:monospace;font-size:10px">'+op.uuid+'</span></div>' +
      '<div><strong>النوع:</strong> '+op.opType+' (أولوية '+op.priority+')</div>' +
      '<div><strong>المستخدم:</strong> '+op.user+'</div>' +
      '<div><strong>الجهاز:</strong> '+op.device+'</div>' +
      '<div><strong>وقت الإنشاء:</strong> '+new Date(op.createdAt).toLocaleString('ar-EG')+'</div>' +
      '<div><strong>آخر محاولة:</strong> '+(op.lastAttempt?new Date(op.lastAttempt).toLocaleString('ar-EG'):'—')+'</div>' +
      '<div><strong>عدد المحاولات:</strong> '+(op.retryCount||0)+'</div>' +
      '<div><strong>الحالة:</strong> '+op.status+'</div>' +
      (op.lastError ? '<div style="color:#c0392b"><strong>سبب الفشل:</strong> '+op.lastError+'</div>' : '') +
      (op.parentUuid ? '<div><strong>تعتمد على عملية:</strong> <span style="font-family:monospace;font-size:10px">'+op.parentUuid+'</span></div>' : '') +
    '</div>' +
    (op.afterData ? '<div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:8px;font-size:11px;font-family:monospace;white-space:pre-wrap">'+JSON.stringify(op.afterData,null,2)+'</div>' : '') +
    '<button class="bn bn-g" style="width:100%;margin-top:14px" onclick="document.getElementById(\'fin-modal\').remove()">إغلاق</button>' +
  '</div>';
  document.body.appendChild(modal);
}

function exportSyncLog() {
  if (!OFFLINE_QUEUE.length) { toast('لا توجد عمليات لتصديرها'); return; }
  var csv = '\uFEFFUUID,النوع,البيان,المستخدم,الوقت,الحالة,عدد المحاولات,سبب الفشل\n';
  OFFLINE_QUEUE.forEach(function(op){
    csv += [op.uuid, op.opType, (op.label||'').replace(/,/g,' '), op.user, op.createdAt, op.status, op.retryCount||0, (op.lastError||'').replace(/,/g,' ')].join(',') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'sync_log_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('✅ تم تصدير سجل المزامنة');
}

function renderDashboard() {
  var total = MOCK_REQUESTS.length;
  var pending = MOCK_REQUESTS.filter(function(r){return r.status===STATUSES.sent||r.status===STATUSES.pricing;}).length;
  var approved = MOCK_REQUESTS.filter(function(r){return r.status===STATUSES.export_ready||r.status===STATUSES.exported;}).length;
  var totalValue = MOCK_REQUESTS.reduce(function(s,r){return s+(parseFloat(r.new_cost)||0)*(parseFloat(r.qty_received)||0);},0);
  var costChanged = MOCK_REQUESTS.filter(function(r){return r.cost_changed;}).length;

  // تحليل معقولية الشراء: مقارنة الكمية المشتراة بالرصيد الموجود وقت الاستلام
  function purchaseAssessment(r) {
    var stock = r.stock_before;
    var qty = parseFloat(r.qty_received) || 0;
    if (stock === null || stock === undefined || qty <= 0) return { label:'—', color:'#888', bg:'#f0f0f0' };
    stock = parseFloat(stock) || 0;
    if (stock <= 0) return { label:'✅ منطقي (رصيد كان صفر)', color:'#1a7a40', bg:'#eafaf1' };
    var ratio = qty / stock;
    if (ratio > 3) return { label:'⚠️ مبالغ فيه ('+ratio.toFixed(1)+'× الرصيد)', color:'#c0392b', bg:'#fce4ec' };
    if (ratio > 1.5) return { label:'🔶 مرتفع نسبياً', color:'#d68910', bg:'#fef9e7' };
    return { label:'✅ منطقي', color:'#1a7a40', bg:'#eafaf1' };
  }
  var unreasonableCount = MOCK_REQUESTS.filter(function(r){ return purchaseAssessment(r).label.indexOf('مبالغ')>=0; }).length;

  // Status distribution
  var allCards = MOCK_REQUESTS.map(function(r){
    var m = calcMargin(r.new_cost, r.final_price);
    var mc = mColor(m);
    var pa = purchaseAssessment(r);
    return '<tr>' +
      '<td style="font-weight:600;font-size:12px">'+esc(r.product_name)+'</td>' +
      '<td style="font-size:11px;color:var(--muted)">'+esc(r.supplier_name)+'</td>' +
      '<td style="text-align:center"><span class="bg '+bgClass(r.status)+'">'+r.status+'</span></td>' +
      '<td style="text-align:center">'+fmt(r.old_cost)+'</td>' +
      '<td style="text-align:center;font-weight:700;color:var(--blue)">'+fmt(r.new_cost)+'</td>' +
      '<td style="text-align:center;font-weight:700;color:var(--accent)">'+fmt(r.final_price)+'</td>' +
      '<td style="text-align:center;font-weight:700;color:'+mc+'">'+(m?m.toFixed(1)+'%':'—')+'</td>' +
      '<td style="text-align:center">'+((r.stock_before!==null&&r.stock_before!==undefined)?fmt(r.stock_before):'—')+'</td>' +
      '<td style="text-align:center"><span class="bg" style="background:'+pa.bg+';color:'+pa.color+';font-size:10px">'+pa.label+'</span></td>' +
      '<td style="font-size:11px;color:var(--muted)">'+r.received_by+'</td>' +
    '</tr>';
  }).join('');

  // Audit log
  var logHTML = AUDIT_LOG.slice(0,20).map(function(l){
    var d = new Date(l.time);
    var timeStr = d.toLocaleDateString('ar-EG',{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    return '<div class="log-item">' +
      '<div class="log-dot" style="background:var(--accent)"></div>' +
      '<div class="log-info"><div style="font-weight:700">'+l.action+'</div>' +
        '<div style="color:var(--muted);font-size:11px">'+l.who+' — '+timeStr+'</div>' +
        (l.detail?'<div style="font-size:11px;color:var(--blue)">'+esc(l.detail)+'</div>':'') +
      '</div></div>';
  }).join('') || '<div style="color:var(--muted);text-align:center;padding:20px">لا توجد سجلات بعد</div>';

  return '<div class="dg">' +
    '<div class="db"><div class="dn">'+total+'</div><div class="dl">إجمالي العمليات</div></div>' +
    '<div class="db"><div class="dn" style="color:#d68910">'+pending+'</div><div class="dl">تحت المراجعة</div></div>' +
    '<div class="db"><div class="dn" style="color:#1a7a40">'+approved+'</div><div class="dl">معتمدة</div></div>' +
    '<div class="db"><div class="dn" style="color:var(--blue)">'+fmt(totalValue)+'</div><div class="dl">إجمالي المشتريات (ج)</div></div>' +
  '</div>' +
  '<div class="cd" style="background:linear-gradient(135deg,#1a3a2a,#2d8653);text-align:center;padding:20px">' +
    '<div style="color:#fff;font-size:15px;font-weight:800;margin-bottom:4px">🤖 تحليل ذكي شامل لعمليات اليوم</div>' +
    '<div style="color:rgba(255,255,255,.85);font-size:12px;margin-bottom:14px">تحذيرات عاجلة، أصناف اشترتها بشكل غير منطقي، أداء الموردين، وخلاصة القرارات</div>' +
    '<button class="bn" style="background:#fff;color:#1a3a2a;font-weight:800;padding:11px 26px" onclick="BARQ_TAS.runSmartAnalysis()">✨ ابدأ التحليل</button>' +
  '</div>' +
  '<div id="smart-analysis-report"></div>' +
  (unreasonableCount ? '<div style="padding:10px 14px;background:#fce4ec;border-radius:10px;margin-bottom:12px;font-size:13px;font-weight:700;color:#c0392b">⚠️ '+unreasonableCount+' عملية شراء تبدو مبالغ فيها مقارنة بالرصيد الموجود وقت الاستلام</div>' : '') +
  // Cost changes alert
  (costChanged ? '<div style="padding:10px 14px;background:#fff3cd;border-radius:10px;margin-bottom:12px;font-size:13px">' +
    '⚠️ <strong>'+costChanged+'</strong> منتج تغيرت تكلفته</div>' : '') +
  // All requests table
  '<div class="cd"><div class="ct">كل العمليات' +
    '<button class="bn bn-b" style="font-size:11px" onclick="BARQ_TAS.exportCSV()">📤 Foodics</button></div>' +
    '<div style="overflow-x:auto"><table class="fnt"><thead><tr>' +
      '<th>المنتج</th><th>المورد</th><th style="text-align:center">الحالة</th>' +
      '<th style="text-align:center">تكلفة قديمة</th><th style="text-align:center">تكلفة جديدة</th>' +
      '<th style="text-align:center">سعر البيع</th><th style="text-align:center">الهامش</th>' +
      '<th style="text-align:center">الرصيد وقت الاستلام</th><th style="text-align:center">تقييم الشراء</th><th>من</th>' +
    '</tr></thead><tbody>'+allCards+'</tbody></table></div></div>' +
  // Audit log
  '<div class="cd"><div class="ct">📋 سجل العمليات (من قام / متى / إيه)</div>'+logHTML+'</div>';
}

// ═══════════════════════════════════════════════
// SMART ANALYSIS — تحليل ذكي شامل لعمليات الاستلام والتسعير
// ═══════════════════════════════════════════════
function aiBlock(title, color, bodyHtml) {
  return '<div class="cd" style="border-right:4px solid '+color+'"><div class="ct" style="color:'+color+'">'+title+'</div><ul style="margin:0;padding-right:18px;font-size:13px;line-height:2">'+bodyHtml+'</ul></div>';
}

function runSmartAnalysis() {
  var reportEl = document.getElementById('smart-analysis-report');
  if (!reportEl) return;
  reportEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">⏳ جاري التحليل...</div>';

  setTimeout(function(){
    try {
      var all = MOCK_REQUESTS;
      var today = new Date().toISOString().slice(0,10);
      var todayItems = all.filter(function(r){ return (r.created_at||'').slice(0,10) === today; });

      var noCost = all.filter(function(r){ return !r.old_cost || r.old_cost<=0; });
      var rejected = all.filter(function(r){ return r.status===STATUSES.rejected; });
      var deferred = all.filter(function(r){ return r.status===STATUSES.deferred; });

      // أصناف بمعدل زيادة تكلفة كبير
      var bigJumps = all.filter(function(r){
        return r.cost_changed && r.old_cost>0 && ((r.new_cost-r.old_cost)/r.old_cost*100) > 20;
      }).sort(function(a,b){ return ((b.new_cost-b.old_cost)/b.old_cost) - ((a.new_cost-a.old_cost)/a.old_cost); }).slice(0,10);

      // تحليل معقولية الشراء (نفس منطق الجدول)
      function assessRatio(r) {
        var stock = parseFloat(r.stock_before);
        var qty = parseFloat(r.qty_received)||0;
        if (isNaN(stock) || stock<=0 || qty<=0) return 0;
        return qty/stock;
      }
      var overbought = all.filter(function(r){ return assessRatio(r) > 3; })
        .sort(function(a,b){ return assessRatio(b)-assessRatio(a); }).slice(0,10);

      // هامش ربح منخفض بعد التسعير
      var lowMargin = all.filter(function(r){
        var m = calcMargin(r.new_cost, r.final_price||r.suggested_price);
        return m!==null && m < 12 && (r.status===STATUSES.export_ready||r.status===STATUSES.exported);
      }).sort(function(a,b){ return calcMargin(a.new_cost,a.final_price)-calcMargin(b.new_cost,b.final_price); }).slice(0,10);

      // أداء الموردين — مين بيرفع أسعاره كتير
      var supStats = {};
      all.forEach(function(r){
        if (!r.supplier_name) return;
        if (!supStats[r.supplier_name]) supStats[r.supplier_name] = { total:0, increased:0, sumIncrease:0 };
        supStats[r.supplier_name].total++;
        if (r.cost_changed && r.new_cost > r.old_cost) {
          supStats[r.supplier_name].increased++;
          supStats[r.supplier_name].sumIncrease += (r.new_cost - r.old_cost);
        }
      });
      var supRanked = Object.keys(supStats).map(function(name){
        var s = supStats[name];
        return { name:name, total:s.total, increased:s.increased, pct: s.total?Math.round(s.increased/s.total*100):0 };
      }).filter(function(s){ return s.increased>0; }).sort(function(a,b){ return b.pct-a.pct; }).slice(0,8);

      // خلاصة القرارات حسب الشخص
      var byPerson = {};
      DECISION_LOG.forEach(function(d){
        if (!byPerson[d.by]) byPerson[d.by] = { اعتماد:0, رفض:0, معلق:0 };
        byPerson[d.by][d.action] = (byPerson[d.by][d.action]||0)+1;
      });

      var html = '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:10px 14px;background:var(--card);border-radius:10px;border:1px solid var(--border);margin-bottom:12px;font-size:12px;color:var(--muted)">' +
        '<span>📅 '+new Date().toLocaleString('ar-EG')+'</span>' +
        '<span>📦 '+all.length+' عملية إجمالاً</span>' +
        '<span>🆕 '+todayItems.length+' عملية اليوم</span>' +
        '<span>💰 '+fmt(all.reduce(function(s,r){return s+(r.new_cost||0)*(r.qty_received||0);},0))+' ج</span>' +
      '</div>';

      // 1) تحذيرات عاجلة
      var urgentBody = '';
      if (noCost.length) urgentBody += '<li><strong>'+noCost.length+' صنف بدون تكلفة سابقة</strong> — تم تسعيرها بدون مرجع للمقارنة: '+esc(noCost.slice(0,5).map(function(r){return r.product_name;}).join('، '))+(noCost.length>5?' ...':'')+'</li>';
      if (overbought.length) urgentBody += '<li><strong>'+overbought.length+' صنف تم شراؤه بكمية مبالغ فيها</strong> مقارنة بالرصيد الموجود وقت الاستلام</li>';
      if (bigJumps.length) urgentBody += '<li><strong>'+bigJumps.length+' صنف</strong> ارتفعت تكلفته أكتر من 20% دفعة واحدة</li>';
      if (!urgentBody) urgentBody = '<li>لا توجد تحذيرات عاجلة حالياً ✅</li>';
      html += aiBlock('🚨 تحذيرات عاجلة', '#c0392b', urgentBody);

      // 2) أصناف اشتُريت بشكل غير منطقي
      var overBody = overbought.length
        ? overbought.map(function(r){ return '<li><strong>'+esc(r.product_name)+'</strong> — اشتُري '+fmt(r.qty_received)+' مقابل رصيد '+fmt(r.stock_before)+' ('+assessRatio(r).toFixed(1)+'× الرصيد) — من '+esc(r.supplier_name||'—')+'</li>'; }).join('')
        : '<li>لا توجد كميات شراء غير منطقية حالياً ✅</li>';
      html += aiBlock('📦➕ أصناف اشتُريت بكميات مبالغ فيها', '#e67e22', overBody);

      // 3) قفزات تكلفة كبيرة
      var jumpBody = bigJumps.length
        ? bigJumps.map(function(r){ var pct=((r.new_cost-r.old_cost)/r.old_cost*100).toFixed(0); return '<li><strong>'+esc(r.product_name)+'</strong> — من '+fmt(r.old_cost)+' إلى '+fmt(r.new_cost)+' ج (+'+pct+'%) — المورد: '+esc(r.supplier_name||'—')+'</li>'; }).join('')
        : '<li>لا توجد قفزات تكلفة كبيرة حالياً ✅</li>';
      html += aiBlock('📈 أصناف ارتفعت تكلفتها بشكل حاد', '#d68910', jumpBody);

      // 4) هامش ربح منخفض بعد الاعتماد
      var marginBody = lowMargin.length
        ? lowMargin.map(function(r){ var m=calcMargin(r.new_cost,r.final_price||r.suggested_price); return '<li><strong>'+esc(r.product_name)+'</strong> — هامش '+(m?m.toFixed(1):'0')+'% فقط بعد الاعتماد — راجع السعر</li>'; }).join('')
        : '<li>لا توجد أصناف بهامش منخفض بشكل ملحوظ ✅</li>';
      html += aiBlock('📉 أصناف معتمدة بهامش ربح منخفض (أقل من 12%)', '#8890a8', marginBody);

      // 5) أداء الموردين
      var supBody = supRanked.length
        ? supRanked.map(function(s){ return '<li><strong>'+s.name+'</strong> — رفع السعر في '+s.increased+' من '+s.total+' عملية ('+s.pct+'%)</li>'; }).join('')
        : '<li>لا توجد بيانات كافية عن أداء الموردين بعد</li>';
      html += aiBlock('🏪 الموردون الأكثر رفعاً للأسعار', '#9b59b6', supBody);

      // 6) خلاصة القرارات حسب الشخص
      var personBody = Object.keys(byPerson).length
        ? Object.keys(byPerson).map(function(name){
            var s = byPerson[name];
            return '<li><strong>'+name+'</strong> — اعتماد: '+(s['اعتماد']||0)+' | رفض: '+(s['رفض']||0)+' | معلق: '+(s['معلق']||0)+'</li>';
          }).join('')
        : '<li>لا توجد قرارات مسجّلة بعد — راجع 📋 سجل القرارات في شاشة التسعير</li>';
      html += aiBlock('👤 أداء اتخاذ القرار حسب الموظف', '#1a5276', personBody);

      // 7) خلاصة عامة
      var pendingCount = all.filter(function(r){return r.status===STATUSES.sent||r.status===STATUSES.pricing;}).length;
      var summaryBody =
        '<li>نسبة الأصناف المعتمدة من الإجمالي: <strong>'+(all.length?Math.round(all.filter(function(r){return r.status===STATUSES.export_ready||r.status===STATUSES.exported;}).length/all.length*100):0)+'%</strong></li>' +
        '<li>عدد الأصناف المرفوضة: <strong>'+rejected.length+'</strong> | المعلّقة: <strong>'+deferred.length+'</strong> | قيد الانتظار: <strong>'+pendingCount+'</strong></li>' +
        (overbought.length ? '<li>⚠️ راجع سياسة الشراء مع أوامر الشراء اللي فيها كميات مبالغ فيها — دي بتجمّد فلوس في المخزون</li>' : '<li>سياسة الشراء تبدو متوازنة مع مستويات المخزون الحالية ✅</li>');
      html += aiBlock('✅ خلاصة', '#1a7a40', summaryBody);

      reportEl.innerHTML = html;
    } catch(err) {
      reportEl.innerHTML = '<div class="cd" style="border-right:4px solid #c0392b"><div class="ct" style="color:#c0392b">❌ حدث خطأ</div><div>'+err.message+'</div></div>';
    }
  }, 300);
}

// ═══════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// FOODICS PRODUCTS CACHE — رفع مرة واحدة
// ═══════════════════════════════════════════════
var PRODUCTS_MASTER_LOADED = false; // true لو التكلفة اتحملت من قاعدة البيانات (مش محتاج رفع يومي)
var FOODICS_CACHE = {}; // sku -> full row object
var FOODICS_COLS = ['id','name','sku','category_reference','tax_group_reference',
  'is_sold_by_weight','is_active','is_stock_product','price','cost',
  'barcode','description','preparation_time','calories',
  'walking_minutes_to_burn_calories','is_high_salt','image',
  'name_localized','description_localized','ereceipt_item_type',
  'ereceipt_item_code','ereceipt_unit_type'];
var FOODICS_CSV_LOADED = false;

// ── Upload original Foodics CSV (once per session) ──
// ═══════════════════════════════════════════════
// MENU ANALYSIS — تحليل القائمة (شعبية + ربحية + تصنيف Star/Dog/Workhorse/Challenge)
// ═══════════════════════════════════════════════
var MENU_ANALYSIS = {}; // sku -> {class, profit_cat, popularity_cat, ...}
var MENU_ANALYSIS_LOADED = false;

function showMenuAnalysisUpload() {
  var ex = document.getElementById('fin-modal'); if(ex) ex.remove();
  var modal = document.createElement('div');
  modal.id = 'fin-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:440px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
    '<div style="font-size:15px;font-weight:800;color:var(--primary);margin-bottom:4px">📊 رفع تحليل القائمة</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:14px">يوضح شعبية وربحية كل صنف (Star/Dog/Workhorse/Challenge) — يُرفع دورياً (أسبوعي مثلاً)</div>' +
    '<div style="padding:10px;background:#e8f4fd;border-radius:8px;font-size:12px;margin-bottom:14px">' +
      '📥 المسار في فودكس:<br><strong>التقارير → تحليل القائمة (Menu Engineering)</strong>' +
    '</div>' +
    '<div class="up-zone" onclick="BARQ_TAS.triggerMenuAnalysisUpload()" style="margin-bottom:14px">' +
      '<input type="file" id="menu-analysis-inp" accept=".csv" onchange="BARQ_TAS.handleMenuAnalysisUpload(this)" style="display:none">' +
      '<div style="font-size:28px;margin-bottom:6px">📊</div>' +
      '<div style="font-weight:700;color:var(--primary)">اضغط لرفع ملف تحليل القائمة</div>' +
      '<div style="font-size:11px;color:var(--muted)">CSV فقط</div>' +
    '</div>' +
    '<div id="menu-analysis-result"></div>' +
    (MENU_ANALYSIS_LOADED ? '<div style="padding:8px;background:#eafaf1;border-radius:8px;font-size:12px;margin:12px 0">✅ محمّل بشكل دائم — '+Object.keys(MENU_ANALYSIS).length+' صنف مصنّف</div>' : '') +
    '<button class="bn bn-g" style="width:100%;margin-top:8px" onclick="document.getElementById(\'fin-modal\').remove()">إغلاق</button>' +
  '</div>';
  document.body.appendChild(modal);
}

function triggerMenuAnalysisUpload() {
  var el = document.getElementById('menu-analysis-inp'); if(el) el.click();
}

function handleMenuAnalysisUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var res = document.getElementById('menu-analysis-result');
  if (res) res.innerHTML = '⏳ جاري المعالجة والمطابقة بالاسم...';
  var reader = new FileReader();
  reader.onload = function(e){ processMenuAnalysisFile(e.target.result, file.name, res); };
  reader.readAsText(file, 'UTF-8');
  input.value = '';
}

async function processMenuAnalysisFile(text, filename, resBox) {
  var lines = text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim();});
  if (!lines.length) { if(resBox) resBox.innerHTML='⚠️ الملف فارغ'; return; }
  var headers = splitCSVLine(lines[0]).map(function(h){return h.replace(/^\uFEFF/,'').trim();});
  var idx = {}; headers.forEach(function(h,i){ idx[h]=i; });

  if (idx['Product']===undefined || idx['Class']===undefined) {
    if (resBox) resBox.innerHTML = '⚠️ صيغة الملف غير معروفة — تأكد إنه تقرير "تحليل القائمة"';
    return;
  }

  // بناء خريطة الاسم → SKU من قاعدة المنتجات المحملة بالفعل
  var nameToSku = {};
  Object.keys(PRODUCTS).forEach(function(sku){ nameToSku[(PRODUCTS[sku].n||'').trim()] = sku; });

  var matched = 0, unmatched = 0;
  var rows = [];
  for (var i=1; i<lines.length; i++) {
    // التعامل مع الفواصل داخل نصوص محاطة بـ "" لو وجدت
    var vals = splitCSVLine(lines[i]);
    var name = (vals[idx['Product']]||'').trim();
    var sku = nameToSku[name];
    if (!sku) { unmatched++; continue; }
    matched++;
    rows.push({
      sku: sku, product_name: name,
      sales: parseFloat(vals[idx['Sales']])||0,
      quantity: parseFloat(vals[idx['Quantity']])||0,
      total_cost: parseFloat(vals[idx['Total Cost']])||0,
      item_profit: parseFloat(vals[idx['Item Profit']])||0,
      total_profit: parseFloat(vals[idx['Total Profit']])||0,
      profit_pct: parseFloat(vals[idx['(نسبة الربح %)']])||0,
      popularity_pct: parseFloat(vals[idx['Popularity']])||0,
      profit_category: (vals[idx['Profit Category']]||'').trim(),
      popularity_category: (vals[idx['Popularity Category']]||'').trim(),
      class: (vals[idx['Class']]||'').trim()
    });
  }

  if (resBox) resBox.innerHTML = '⏳ جاري الحفظ الدائم...';
  var batchSize = 500;
  var queuedBatches = 0;
  for (var b=0; b<rows.length; b+=batchSize) {
    var chunk = rows.slice(b, b+batchSize);
    var res = await sbWrite('menu_analysis?on_conflict=sku', {
      method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
      body: JSON.stringify(chunk)
    }, { opType:'تحديث_منتج', label:'دفعة تحليل قائمة — '+chunk.length+' صنف' });
    if (res.queued) queuedBatches++;
  }
  rows.forEach(function(r){ MENU_ANALYSIS[r.sku] = r; });
  MENU_ANALYSIS_LOADED = true;
  addAudit('رفع تحليل القائمة', ROLES[role]?ROLES[role].label:'—', filename+' — مطابق: '+matched+' | غير مطابق: '+unmatched);
  if (queuedBatches > 0) {
    if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#fef9e7;border-radius:8px;font-size:13px">📴 تم التحميل محلياً — '+queuedBatches+' دفعة ستُرفع تلقائياً</div>';
    toast('📴 تم التحميل محلياً — سيُرفع تلقائياً');
  } else {
    if (resBox) resBox.innerHTML = '<div style="padding:10px;background:#eafaf1;border-radius:8px;font-size:13px">' +
      '✅ تم ربط <strong>'+matched+'</strong> صنف بنجاح' + (unmatched?' | ⚠️ '+unmatched+' صنف لم يُطابق (اسم مختلف)':'') +
      '<br><span style="font-size:11px;color:var(--muted)">محفوظ بشكل دائم — سيظهر تلقائياً عند مراجعة كل صنف</span></div>';
    toast('✅ تم ربط '+matched+' صنف بتحليل القائمة');
  }
}

function menuClassBadge(sku) {
  var d = MENU_ANALYSIS[sku];
  if (!d || !d.class) return '';
  var map = {
    'Star':      { icon:'⭐', color:'#1a7a40', bg:'#eafaf1', label:'نجم — مبيعات وربح مرتفعين', note:'راجع السعر بحذر شديد — أي زيادة قد تؤثر على المبيعات' },
    'Dog':       { icon:'🐕', color:'#888',    bg:'#f0f0f0', label:'ضعيف — مبيعات وربح منخفضين', note:'مجال أوسع للتسعير — أثره محدود على الإجمالي' },
    'Workhorse': { icon:'🐴', color:'#d68910', bg:'#fef9e7', label:'عالي الطلب منخفض الربح', note:'مرشح جيد لزيادة السعر — الطلب عليه ثابت' },
    'Challenge': { icon:'❓', color:'#1a5276', bg:'#e8f4fd', label:'ربح مرتفع مبيعات منخفضة', note:'راجع سبب ضعف المبيعات قبل رفع السعر أكتر' }
  };
  var c = map[d.class];
  if (!c) return '';
  return '<div style="padding:12px;background:'+c.bg+';border-radius:10px;margin-bottom:12px;border:1px solid '+c.color+'33">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<span style="font-size:20px">'+c.icon+'</span>' +
      '<span style="font-weight:800;color:'+c.color+';font-size:13px">'+c.label+'</span>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted)">'+c.note+'</div>' +
    '<div style="font-size:11px;color:var(--muted);margin-top:6px">شعبية: '+(d.popularity_pct||0).toFixed(2)+'% | ربحية: '+(d.profit_pct||0).toFixed(1)+'%</div>' +
  '</div>';
}

function showFoodicsUpload() {
  var ex = document.getElementById('fin-modal'); if(ex) ex.remove();
  var modal = document.createElement('div');
  modal.id = 'fin-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:440px;font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
    '<div style="font-size:15px;font-weight:800;color:var(--primary);margin-bottom:4px">📂 رفع تكلفة المنتجات</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:14px">ارفعه مرة واحدة فقط في أول اليوم — يحدد تكلفة كل الأصناف اللي في أوامر الشراء طول اليوم</div>' +
    '<div style="padding:10px;background:#e8f4fd;border-radius:8px;font-size:12px;margin-bottom:14px">' +
      '📥 المسار في فودكس:<br><strong>قائمة المنتجات → تصدير → CSV</strong><br>' +
      'نفس ملف تكلفة المنتجات اللي بترفعه كل يوم' +
    '</div>' +
    '<div class="up-zone" onclick="BARQ_TAS.triggerFoodicsUpload()" style="margin-bottom:14px">' +
      '<input type="file" id="foodics-csv-inp" accept=".csv" onchange="BARQ_TAS.handleFoodicsUpload(this)" style="display:none">' +
      '<div style="font-size:28px;margin-bottom:6px">📂</div>' +
      '<div style="font-weight:700;color:var(--primary)">اضغط لرفع ملف تكلفة المنتجات</div>' +
      '<div style="font-size:11px;color:var(--muted)">CSV فقط — من فودكس مباشرة</div>' +
    '</div>' +
    (PRODUCTS_MASTER_LOADED ? '<div style="padding:8px;background:#eafaf1;border-radius:8px;font-size:12px;margin-bottom:12px">✅ محمّل بشكل دائم من قاعدة البيانات — '+Object.keys(PRODUCTS).length+' صنف</div>' :
     FOODICS_CSV_LOADED ? '<div style="padding:8px;background:#fef9e7;border-radius:8px;font-size:12px;margin-bottom:12px">⏳ محمّل مؤقتاً لهذه الجلسة فقط — '+Object.keys(FOODICS_CACHE).length+' منتج</div>' : '') +
    '<button class="bn bn-g" style="width:100%" onclick="document.getElementById(\'fin-modal\').remove()">إغلاق</button>' +
  '</div>';
  document.body.appendChild(modal);
}

function triggerFoodicsUpload() {
  var el = document.getElementById('foodics-csv-inp'); if(el) el.click();
}

function handleFoodicsUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    processFoodicsFullFile(e.target.result, file.name, null);
    var modal = document.getElementById('fin-modal'); if(modal) modal.remove();
  };
  reader.readAsText(file, 'UTF-8');
  input.value = '';
}

// ── Export to Foodics — full 22-column format ──
function exportCSV() {
  var ready = MOCK_REQUESTS.filter(function(r){ return r.status === STATUSES.export_ready; });
  if (!ready.length) { toast('مفيش طلبات جاهزة للتصدير'); return; }

  var useFullFormat = FOODICS_CSV_LOADED && Object.keys(FOODICS_CACHE).length > 0;
  var csvRows, exported = 0, notFound = [];

  if (useFullFormat) {
    // صيغة فودكس الكاملة (22 عمود) — متاحة فقط لو اترفع ملف المنتجات الكامل في هذه الجلسة
    csvRows = ['\uFEFF' + FOODICS_COLS.join(',')];
    ready.forEach(function(r){
      var sku = r.sku || '';
      var cached = FOODICS_CACHE[sku];
      if (!cached) { notFound.push(sku + ' (' + r.product_name + ')'); return; }
      var rowData = FOODICS_COLS.map(function(col){
        if (col === 'price') return r.final_price || cached.price || '';
        if (col === 'cost')  return r.new_cost    || cached.cost  || '';
        var val = cached[col] || '';
        if (String(val).indexOf(',') > -1) val = '"' + val + '"';
        return val;
      });
      csvRows.push(rowData.join(','));
      r.status = STATUSES.exported;
      exported++;
    });
  } else {
    // صيغة مبسطة (sku,name,price,cost,barcode) — تعمل دائماً بالاعتماد على قاعدة البيانات الدائمة
    csvRows = ['\uFEFFsku,name,price,cost,barcode'];
    ready.forEach(function(r){
      var p = PRODUCTS[r.sku] || {};
      var name = (r.product_name||'').replace(/,/g,' ');
      csvRows.push([r.sku||'', name, r.final_price||p.p||'', r.new_cost||p.c||'', p.bc||''].join(','));
      r.status = STATUSES.exported;
      exported++;
    });
  }

  if (!exported) { toast('⚠️ لا توجد أصناف صالحة للتصدير'); return; }

  // Download
  var csv = csvRows.join('\n');
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'foodics_prices_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);

  addAudit('تصدير Foodics', ROLES[role].label, exported+' منتج');
  var msg = '✅ تم تصدير '+exported+' منتج';
  if (notFound.length) msg += ' | ⚠️ '+notFound.length+' مش موجود في الملف';
  toast(msg, 5000);
  render();
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
window.addEventListener('load', async function(){
  await loadOfflineQueue();
  checkConnectionQuality();

  var pendingCount = OFFLINE_QUEUE.filter(function(o){return o.status!=='synced';}).length;
  if (pendingCount > 0) {
    setTimeout(function(){ toast('📴 تم العثور على '+pendingCount+' عملية غير متزامنة — جاري المزامنة تلقائياً'); }, 500);
  }

  var savedRole = null;
  try { savedRole = localStorage.getItem('barq_session_role'); } catch(e){}
  if (savedRole && ROLES[savedRole]) {
    role = savedRole;
    view = 'queue';
    await loadFromSupabase(); // يعيد تحميل البيانات من القاعدة تلقائياً بعد أي refresh
  } else {
    render();
  }

  if (pendingCount > 0 && navigator.onLine) syncOfflineQueue();
});


// ============================================================
// نقطة الدمج مع الغلاف الموحّد — الإضافة الوحيدة اللي مش موجودة في
// tas3eer_v3_proto.html الأصلي. شاشة الدخول الداخلية (دور + رقم سري)
// بقت متجاوَزة: الدور بياخده الموديول من BARQ_AUTH (نفس أدوار PIN
// المعرّفة أصلاً في ROLES هنا وفي auth.js الموحّد)، بدل ما يدخل تاني مرة.
// render() هنا أصلاً فيه حماية لو #root مش موجود، فمحتجناش نلمسها.
// ============================================================
function syncFromShellAuth(sectionKey) {
  var shellUser = window.BARQ_AUTH && BARQ_AUTH.getCurrentUser();
  var newRole = null;
  if (shellUser && shellUser.method === 'pin' && ROLES[shellUser.role]) {
    // مستخدم من أدوار الإدارة (pricing/finance/finmgr/purchmgr/receiving/ceo) —
    // نفس الدور اللي دخل بيه فعلاً هو اللي بيحدد الشاشة، زي الأصل بالظبط.
    newRole = shellUser.role;
  } else if (shellUser && shellUser.role === 'admin') {
    // مدير عام (يوزر/باسورد) عنده صلاحية "تسعير" و"مالية" في القائمة الموحّدة
    // بس مش من أدوار PIN المعروفة هنا — من غير المابّينج ده كان بيشوف شاشة
    // اختيار الدور الداخلية القديمة بدل المحتوى مباشرة. نربطه بالدور المناسب
    // لنفس القسم اللي فتحه فعلاً من القائمة الجانبية. "مالية" بقت تبويبين
    // (خزينة أحمد صلاح / مدير المالية) — كل واحد بياخد دوره الصح بدل ما
    // يتقفل دايمًا على مدير المالية بس.
    if (sectionKey === 'finance-treasury') newRole = 'finance';
    else if (sectionKey === 'finance-mgr' || sectionKey === 'finance') newRole = 'finmgr';
    else newRole = 'pricing';
  }
  if (newRole && newRole !== role) {
    role = newRole; view = 'queue'; detailId = null; recvPO = null;
    loadFromSupabase();
  } else if (!newRole) {
    role = null;
  }
}

function mount(container, sectionKey) {
  container.innerHTML = '<div id="tas-toast"></div><div id="tas-root" class="tas-mod"></div>';
  syncFromShellAuth(sectionKey);
  render();
}


  return {
    addAudit: addAudit,
    addPaymentModal: addPaymentModal,
    addReturnModal: addReturnModal,
    aiBlock: aiBlock,
    approveBill: approveBill,
    approvePrice: approvePrice,
    approveRecv: approveRecv,
    autosaveReceiving: autosaveReceiving,
    bgClass: bgClass,
    buildSupplierAccounts: buildSupplierAccounts,
    bulkDecision: bulkDecision,
    calcMargin: calcMargin,
    checkConnectionQuality: checkConnectionQuality,
    checkQty: checkQty,
    clampMargin: clampMargin,
    closeCameraScan: closeCameraScan,
    confirmFinMgrPayment: confirmFinMgrPayment,
    confirmFinMgrReturn: confirmFinMgrReturn,
    confirmOpeningBalance: confirmOpeningBalance,
    confirmPayment: confirmPayment,
    confirmReturn: confirmReturn,
    createOperation: createOperation,
    decryptLocal: decryptLocal,
    deferPrice: deferPrice,
    deleteFailedOperation: deleteFailedOperation,
    doLogin: doLogin,
    doLogout: doLogout,
    encryptLocal: encryptLocal,
    esc: esc,
    exportCSV: exportCSV,
    exportDecisionLogExcel: exportDecisionLogExcel,
    exportFoodicsPurchase: exportFoodicsPurchase,
    exportReturnQtyAdjustment: exportReturnQtyAdjustment,
    exportSyncLog: exportSyncLog,
    filterSidebar: filterSidebar,
    finMgrPayModal: finMgrPayModal,
    finMgrReturnModal: finMgrReturnModal,
    fmt: fmt,
    genUUID: genUUID,
    getAffectedChain: getAffectedChain,
    getCurrentCost: getCurrentCost,
    getFinSuppliers: getFinSuppliers,
    getLocalCryptoKey: getLocalCryptoKey,
    getSupplierBalance: getSupplierBalance,
    goQueue: goQueue,
    handleBulkOpening: handleBulkOpening,
    handleFoodicsUpload: handleFoodicsUpload,
    handleMenuAnalysisUpload: handleMenuAnalysisUpload,
    handleProductUpload: handleProductUpload,
    handleScan: handleScan,
    handleSupImport: handleSupImport,
    liveCalc: liveCalc,
    liveCalcFromPrice: liveCalcFromPrice,
    loadCamLib: loadCamLib,
    loadFromSupabase: loadFromSupabase,
    loadOfflineQueue: loadOfflineQueue,
    loadRealtimeLib: loadRealtimeLib,
    loadXlsxLib: loadXlsxLib,
    logAuditSync: logAuditSync,
    logDecision: logDecision,
    mColor: mColor,
    manualAddProduct: manualAddProduct,
    manualRemoveItem: manualRemoveItem,
    manualSearchProducts: manualSearchProducts,
    menuClassBadge: menuClassBadge,
    now: now,
    opTypeIcon: opTypeIcon,
    openCameraScan: openCameraScan,
    openFinMgrDetail: openFinMgrDetail,
    openManualInvoice: openManualInvoice,
    openNewBill: openNewBill,
    openPriceDetail: openPriceDetail,
    openReceive: openReceive,
    openReturnEntry: openReturnEntry,
    openSupplierDetail: openSupplierDetail,
    openingBalanceModal: openingBalanceModal,
    parseCSV: parseCSV,
    patchPricingRequest: patchPricingRequest,
    payMethodOptions: payMethodOptions,
    pickField: pickField,
    printDecisionLog: printDecisionLog,
    printFoodicsInvoice: printFoodicsInvoice,
    printVendorBill: printVendorBill,
    processBulkOpening: processBulkOpening,
    processFoodicsFullFile: processFoodicsFullFile,
    processInventoryLevelsFile: processInventoryLevelsFile,
    processMenuAnalysisFile: processMenuAnalysisFile,
    processProductRows: processProductRows,
    processSupImport: processSupImport,
    refocusScan: refocusScan,
    refreshPO: refreshPO,
    refreshPricingRequests: refreshPricingRequests,
    refreshSuppliersData: refreshSuppliersData,
    rejectBill: rejectBill,
    rejectPrice: rejectPrice,
    rejectRecv: rejectRecv,
    render: render,
    renderAuth: renderAuth,
    renderBillTotals: renderBillTotals,
    renderBulkOpeningSection: renderBulkOpeningSection,
    renderDashboard: renderDashboard,
    renderDecisionLog: renderDecisionLog,
    renderDetail: renderDetail,
    renderFinMgr: renderFinMgr,
    renderFinMgrDetail: renderFinMgrDetail,
    renderFinMgrSuppliers: renderFinMgrSuppliers,
    renderFinance: renderFinance,
    renderFinanceRoot: renderFinanceRoot,
    renderFinanceSidebar: renderFinanceSidebar,
    renderMain: renderMain,
    renderPricingQueue: renderPricingQueue,
    renderPurchMgr: renderPurchMgr,
    renderReceiving: renderReceiving,
    renderRecvQueue: renderRecvQueue,
    renderReturnEntry: renderReturnEntry,
    renderSupplierDetail: renderSupplierDetail,
    renderSupplierImport: renderSupplierImport,
    renderSupplierList: renderSupplierList,
    renderSyncCenter: renderSyncCenter,
    renderTopBar: renderTopBar,
    renderVendorBillForm: renderVendorBillForm,
    restoreReceivingDraft: restoreReceivingDraft,
    retryAllFailed: retryAllFailed,
    retryFailedOperation: retryFailedOperation,
    returnUpdateQty: returnUpdateQty,
    runSmartAnalysis: runSmartAnalysis,
    saveOfflineQueue: saveOfflineQueue,
    sbFetch: sbFetch,
    sbWrite: sbWrite,
    scheduleSyncRetry: scheduleSyncRetry,
    selRole: selRole,
    selectSupplier: selectSupplier,
    showFoodicsUpload: showFoodicsUpload,
    showMenuAnalysisUpload: showMenuAnalysisUpload,
    showProductUpload: showProductUpload,
    splitCSVLine: splitCSVLine,
    startRealtime: startRealtime,
    stepQty: stepQty,
    submitReturn: submitReturn,
    supplierSearch: supplierSearch,
    syncOfflineQueue: syncOfflineQueue,
    toast: toast,
    togglePricingSelect: togglePricingSelect,
    triggerBulkOpening: triggerBulkOpening,
    triggerFoodicsUpload: triggerFoodicsUpload,
    triggerMenuAnalysisUpload: triggerMenuAnalysisUpload,
    triggerProdUpload: triggerProdUpload,
    triggerSupImport: triggerSupImport,
    updateConnBadge: updateConnBadge,
    updateMarginDisplay: updateMarginDisplay,
    updateOfflineIndicator: updateOfflineIndicator,
    viewOperationDetails: viewOperationDetails,
    mount: mount
  };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['pricing'] = { mount: BARQ_TAS.mount };
window.BARQ_MODULES['finance'] = { mount: BARQ_TAS.mount };
window.BARQ_MODULES['finance-treasury'] = { mount: BARQ_TAS.mount };
window.BARQ_MODULES['finance-mgr'] = { mount: BARQ_TAS.mount };

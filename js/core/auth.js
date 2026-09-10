// ============================================================
// برق — نظام الدخول والصلاحيات الموحد
//
// كل المستخدمين (فروع + إدارة) في جدول واحد على نفس مشروع Supabase
// (app_users) — مش مخزنين محليًا في كل جهاز لوحده زي ما كانوا الأول.
// ده مهم لسبب بسيط: أي تغيير (باسورد جديد، توقيف حساب، مستخدم جديد) من
// شاشة "المستخدمين والصلاحيات" لازم يبان فورًا على أي جهاز، مش بس على
// الجهاز اللي عمل التغيير. كل مستخدم عنده اسم مستخدم + كلمة سر مشفّرة
// (SHA-256) + دور. الدور نفسه (ROLES) هو اللي بيحدد الصلاحيات وأقسام
// القائمة الجانبية (sections) ومنطق can[] الداخلي — وده لسه محلي وثابت
// في الكود، مش من الجدول.
// ============================================================

var BARQ_AUTH = (function () {

  // ---------- سجل الأدوار (الصلاحيات وأقسام القائمة الجانبية بس، من غير أي بيانات دخول) ----------
  var ROLES = {
    admin:    { label: 'مدير عام',   icon: '👑', method: 'password', can: ['order','history','dashboard','manage_users','admin_panel','admin_settings','data_entry','production','freezer','factory_receive'], sections: ['orders','purchasing','pricing','receiving','finance','barcode','stocktake','shelf-check','reports','decision-kitchen','access-list','support-admin'] },
    manager:  { label: 'مدير فرع',   icon: '🏪', method: 'password', can: ['order','dashboard','production','freezer','factory_receive'], sections: ['orders','reports'] },
    staff:    { label: 'موظف',       icon: '👤', method: 'password', can: ['data_entry','admin_panel','freezer','factory_receive'], sections: ['orders'] },
    receiving: { label: 'الاستلام',                    icon: '📦', method: 'pin', sections: ['receiving','stocktake','shelf-check'] },
    pricing:   { label: 'مسؤول التسعير',                icon: '💰', method: 'pin', sections: ['pricing'] },
    finance:   { label: 'أمين الخزينة',                 icon: '🏦', method: 'pin', sections: ['finance'] },
    finmgr:    { label: 'مدير المالية',                 icon: '📊', method: 'pin', sections: ['finance'] },
    purchmgr:  { label: 'مدير قسم المشتريات',            icon: '📦', method: 'pin', sections: ['purchasing'] },
    ceo:       { label: 'رئيس مجلس الإدارة',             icon: '👔', method: 'pin', sections: ['orders','purchasing','pricing','receiving','finance','barcode','stocktake','shelf-check','reports','decision-kitchen','access-list','support-admin'] },
    deptprep:  { label: 'تحضير الأقسام',                 icon: '🏭', method: 'pin', sections: ['dept-prep'] },
    // يوزرات مستقلة لكل وضع جوه "استلام وجرد" — كل واحد بيفتحله وضعه بس، من
    // غير شاشة اختيار ومن غير ما يشوف الأوضاع التانية خالص
    stockcount: { label: 'الجرد',                        icon: '🔢', method: 'pin', sections: ['stocktake'] },
    shelfcheck: { label: 'شيلفات',                        icon: '🔖', method: 'pin', sections: ['shelf-check'] },
    // يوزرات مستقلة لكل قسم من أقسام "تحضير الأقسام" — كل واحد بيدخل بيوزره
    // ويوصله على طول لقسمه بس، من غير شاشة اختيار القسم/الباسورد الداخلية
    deptprep_vip:     { label: 'تحضير — VIP',              icon: '🏭', method: 'pin', sections: ['dept-vip'] },
    deptprep_masnaat: { label: 'تحضير — مصنعات',           icon: '🏭', method: 'pin', sections: ['dept-masnaat'] },
    deptprep_lahom:   { label: 'تحضير — مصنعات لحوم ودواجن', icon: '🏭', method: 'pin', sections: ['dept-lahom'] },
    deptprep_mo3mal:  { label: 'تحضير — معمل',              icon: '🏭', method: 'pin', sections: ['dept-mo3mal'] }
  };

  var SESSION_KEY = 'barq_unified_session';

  function findUser(username) {
    return sb('app_users?username=eq.' + encodeURIComponent(username) + '&select=*')
      .then(function (rows) { return (rows && rows[0]) || null; });
  }

  // SHA-256 محلي — نسخة طبق الأصل من forou3.html (hashPassword/_sha256)
  function _sha256(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var result = '';
    var words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = _sha256.h = _sha256.h || [];
    var k = _sha256.k = _sha256.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (var i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (var j2 = 0; j2 < words.length;) {
      var w = words.slice(j2, j2 += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (var i2 = 0; i2 < 64; i2++) {
        var w15 = w[i2 - 15], w2 = w[i2 - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i2]
          + (w[i2] = (i2 < 16) ? w[i2] : (
            w[i2 - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i2 - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0
          );
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (var i3 = 0; i3 < 8; i3++) {
        hash[i3] = (hash[i3] + oldHash[i3]) | 0;
      }
    }
    for (var i4 = 0; i4 < 8; i4++) {
      for (var j3 = 3; j3 + 1; j3--) {
        var b = (hash[i4] >> (j3 * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function hashPassword(str) {
    if (typeof sha256 === 'function') {
      try { return sha256(str); } catch (e) {}
    }
    return _sha256(str);
  }

  // ---------- الحالة والجلسة ----------
  var currentUser = null; // { role, label, icon, username?, branch? }

  function saveSession() {
    if (!currentUser) { localStorage.removeItem(SESSION_KEY); return; }
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  }

  function restoreSession() {
    try {
      var saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return null;
      var sess = JSON.parse(saved);
      if (sess && sess.role && ROLES[sess.role]) {
        currentUser = sess;
        return currentUser;
      }
    } catch (e) {}
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  // ---------- دخول موحّد: اسم مستخدم + كلمة سر بس ----------
  // اليوزر والباسورد بيحددوا الحساب في app_users، والدور المرتبط بيه (role)
  // هو اللي بيستدعي الصلاحيات وأقسام القائمة الجانبية تلقائيًا.
  // سجل تدقيق بسيط (audit_log_v3 — نفس الجدول اللي التطبيق أصلاً بيسجل فيه
  // بعض الأحداث) — بيسجل كل محاولة دخول (ناجحة أو فاشلة)، عشان لو حصل تسريب
  // بيانات نقدر نرجع نعرف مين دخل وامتى بالظبط. تسجيل بس، من غير ما يوقف
  // أي حاجة لو فشل (مفيش إنترنت مثلاً) — مش شرط لنجاح تسجيل الدخول نفسه.
  function logAudit(action, who, detail) {
    if (typeof sb !== 'function') return;
    try {
      sb('audit_log_v3', { method: 'POST', body: JSON.stringify({ action: action, who: who || '—', detail: detail || '' }) })
        .catch(function () {});
    } catch (e) {}
  }

  // login بقت async (بترجع Promise) لأنها بقت بتقرا من Supabase مش من
  // localStorage محلي — أي حد بيستدعيها لازم يستنى النتيجة بـ .then()
  function login(username, password) {
    username = (username || '').trim();
    return findUser(username).then(function (user) {
      if (!user) { logAudit('login_failed', username, 'اسم مستخدم غير موجود'); return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }; }
      if (!user.active) { logAudit('login_blocked', username, 'محاولة دخول لحساب موقوف'); return { ok: false, error: 'الحساب موقوف — تواصل مع مدير النظام' }; }
      if (hashPassword(password) !== user.password_hash) { logAudit('login_failed', username, 'كلمة سر خاطئة'); return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }; }
      var roleDef = ROLES[user.role];
      if (!roleDef) return { ok: false, error: 'الدور المرتبط بالحساب غير معروف' };
      currentUser = {
        method: roleDef.method,
        role: user.role,
        label: user.label || roleDef.label,
        icon: roleDef.icon,
        username: user.username,
        branch: user.branch
      };
      saveSession();
      logAudit('login', user.username, roleDef.label + (user.branch ? ' — ' + user.branch : ''));
      return { ok: true, user: currentUser };
    }).catch(function (e) {
      console.error(e);
      return { ok: false, error: 'تعذر الاتصال بالسيرفر — تأكد من الإنترنت وحاول تاني' };
    });
  }

  // للتوافق مع أي كود قديم بيستدعيها بالاسم ده
  function loginWithPassword(username, password) { return login(username, password); }

  function logout() {
    currentUser = null;
    saveSession();
  }

  function can(action) {
    if (!currentUser) return false;
    var roleDef = ROLES[currentUser.role];
    return !!(roleDef && roleDef.can && roleDef.can.indexOf(action) !== -1);
  }

  function allowedSections() {
    if (!currentUser) return [];
    var roleDef = ROLES[currentUser.role];
    return (roleDef && roleDef.sections) || [];
  }

  // ---------- إدارة المستخدمين (شاشة "المستخدمين والصلاحيات") ----------
  // الأربعة دول كلهم async دلوقتي (بيرجعوا Promise) — بيقروا/يكتبوا في
  // app_users مباشرة، فأي تعديل بيبان فورًا لأي جهاز تاني.
  function listUsers() {
    return sb('app_users?select=username,role,label,branch,active,created_at&order=created_at.asc');
  }

  function addUser(data) {
    var username = (data.username || '').trim();
    if (!username) return Promise.resolve({ ok: false, error: 'اسم المستخدم مطلوب' });
    if (!ROLES[data.role]) return Promise.resolve({ ok: false, error: 'دور غير معروف' });
    if (!data.password) return Promise.resolve({ ok: false, error: 'كلمة السر مطلوبة' });
    return findUser(username).then(function (existing) {
      if (existing) return { ok: false, error: 'اسم المستخدم ده موجود بالفعل' };
      return sb('app_users', {
        method: 'POST',
        body: JSON.stringify({
          username: username,
          password_hash: hashPassword(data.password),
          role: data.role,
          label: data.label || null,
          branch: data.branch || null,
          active: true
        })
      }).then(function () { return { ok: true }; });
    }).catch(function (e) {
      console.error(e);
      return { ok: false, error: 'تعذر الحفظ — تأكد من الاتصال بالإنترنت' };
    });
  }

  function updateUser(username, changes) {
    if (!ROLES[changes.role] && changes.role) return Promise.resolve({ ok: false, error: 'دور غير معروف' });
    var patch = {};
    if (changes.role) patch.role = changes.role;
    if (typeof changes.active === 'boolean') patch.active = changes.active;
    if (changes.label !== undefined) patch.label = changes.label || null;
    if (changes.branch !== undefined) patch.branch = changes.branch || null;
    if (changes.password) patch.password_hash = hashPassword(changes.password);
    patch.updated_at = new Date().toISOString();
    return sb('app_users?username=eq.' + encodeURIComponent(username), { method: 'PATCH', body: JSON.stringify(patch) })
      .then(function () { return { ok: true }; })
      .catch(function (e) {
        console.error(e);
        return { ok: false, error: 'تعذر الحفظ — تأكد من الاتصال بالإنترنت' };
      });
  }

  function deleteUser(username) {
    if (currentUser && currentUser.username === username) {
      return Promise.resolve({ ok: false, error: 'مينفعش تمسح الحساب اللي داخل بيه دلوقتي' });
    }
    return sb('app_users?username=eq.' + encodeURIComponent(username), { method: 'DELETE' })
      .then(function () { return { ok: true }; })
      .catch(function (e) {
        console.error(e);
        return { ok: false, error: 'تعذر الحذف — تأكد من الاتصال بالإنترنت' };
      });
  }

  function rolesList() {
    return Object.keys(ROLES).map(function (k) {
      return { key: k, label: ROLES[k].label, icon: ROLES[k].icon };
    });
  }

  return {
    ROLES: ROLES,
    getCurrentUser: function () { return currentUser; },
    restoreSession: restoreSession,
    login: login,
    loginWithPassword: loginWithPassword,
    logout: logout,
    can: can,
    allowedSections: allowedSections,
    listUsers: listUsers,
    addUser: addUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    rolesList: rolesList
  };
})();

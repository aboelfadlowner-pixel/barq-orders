// ============================================================
// برق — القائمة الجانبية الموحدة + تركيب شاشة الدخول
// ============================================================

var BARQ_SECTIONS = [
  { key: 'orders',      label: 'الطلبيات',              icon: '🛒' },
  // الفريزر و"استلام من المصنع" اتشالوا من هنا — شغالين بالفعل في أداة
  // تانية برا برق، مفيش داعي يتكرروا هنا. "المصنع" و"الإنتاج"/"تحضير
  // الأقسام" (بقت "الإنتاج والتصنيع") هما اللي فضلوا.
  { key: 'inventory',   label: 'المخزون',               icon: '🏭',
    subsections: [
      // "الإنتاج والتصنيع" — بند واحد جامع، تابات جواه لكل قسم تحضير
      // (زي تابات تطبيق الفروع بالظبط). يوزر عام (admin/ceo/manager)
      // بيشوف كل التابات؛ يوزر قسم معيّن (deptprep_vip مثلاً) بيشوف
      // بس تابه هو بفضل roleOnly — تمامًا زي خزينة/مدير المالية تحت.
      { key: 'orders-production', label: 'الإنتاج والتصنيع' },
      { key: 'dept-vip',          label: 'تحضير — VIP',                roleOnly: 'deptprep_vip' },
      { key: 'dept-masnaat',      label: 'تحضير — مصنعات',             roleOnly: 'deptprep_masnaat' },
      { key: 'dept-lahom',        label: 'تحضير — مصنعات لحوم ودواجن', roleOnly: 'deptprep_lahom' },
      { key: 'dept-mo3mal',       label: 'تحضير — معمل',               roleOnly: 'deptprep_mo3mal' },
      { key: 'orders-factory',    label: 'المصنع' }
    ] },
  { key: 'purchasing',  label: 'لوحة تحكم المشتريات',   icon: '📦' },
  { key: 'pricing',     label: 'تسعير',                  icon: '💰' },
  { key: 'receiving',   label: 'استلامات',               icon: '📥' },
  // "مالية" كانت دايمًا بتوريك شاشة "مدير المالية" بس لما تدخل بحساب admin،
  // مفيش طريقة توصل بيها لشاشة "أمين الخزينة" (اللي الفاتورة بتوصلها بعد
  // الاستلام) غير بحساب PIN مخصص ليها. دلوقتي بقت تبويبين واضحين — الأدمن/
  // الـCEO يقدروا يفتحوا أي واحد فيهم، وكل يوزر PIN مخصص (finance/finmgr)
  // بيشوف بس شاشته هو
  { key: 'finance',     label: 'مالية',                  icon: '🏦',
    subsections: [
      { key: 'finance-treasury', label: 'خزينة (أمين الخزينة)', roleOnly: 'finance' },
      { key: 'finance-mgr',      label: 'مدير المالية',       roleOnly: 'finmgr' }
    ] },
  { key: 'stocktake',   label: 'جرد',                    icon: '🔢' },
  // "تسويق": باركود وطباعة + شيلفات بقوا تبويبين جوه قسم واحد — يوزر
  // "تسويق" المخصص بيشوف الاتنين بس ومفيش حاجة تانية، وباقي الأدوار
  // (admin/ceo/receiving/shelfcheck) بتشوف اللي كانت شايفاه بالظبط زي
  // الأول من غير ما نكرر القسم في مكانين
  { key: 'marketing',   label: 'تسويق',                  icon: '📣',
    subsections: [
      { key: 'barcode',    label: 'باركود وطباعة', roles: ['admin', 'ceo', 'marketing'] },
      { key: 'shelf-check', label: 'شيلفات',        roles: ['admin', 'ceo', 'marketing', 'receiving', 'shelfcheck'] }
    ] },
  { key: 'reports', label: 'تقارير', icon: '📊' },
  { key: 'decision-kitchen', label: 'مطبخ القرار', icon: '🍳' },
  { key: 'market-products', label: 'المنتجات', icon: '🏪' },
  // قسم جديد: روابط مباشرة لأدوات مستقلة برا برق (بتفتح في تاب جديد،
  // مفيهاش أي منطق/موديول جوه برق نفسه)
  { key: 'addons', label: 'الملحقات', icon: '🧩',
    subsections: [
      { key: 'addon-pos', label: '🖨 نقطة البيع (POS)', url: '../touch-print-market.html' },
      { key: 'addon-pda', label: '📋 استلام وجرد PDA',  url: '../istilam-w-gerd.html' }
    ] },
  { key: 'access-list', label: 'المستخدمين والصلاحيات', icon: '👥' },
  { key: 'support-admin', label: 'بلاغات المستخدمين', icon: '🆘' }
];

// سجل الموديولات — كل مرحلة قادمة بتسجل نفسها هنا: BARQ_MODULES['orders'] = { mount(container){...} }
var BARQ_MODULES = window.BARQ_MODULES || (window.BARQ_MODULES = {});

var BarqApp = (function () {
  var activeSection = null;
  var activeSub = null;

  // دخول مباشر من رابط خارجي (زي سكانر شاشة الكاشير touch-print-market.html
  // لما يلاقي باركود مش موجود) — بيفتح القسم المطلوب وبيشغّل الإضافة
  // بالباركود تلقائي أول ما القسم يخلص تحميل. بيتشال أول ما يتستخدم عشان
  // رفرش الصفحة بعد كده ميعيدش نفس الفتح.
  var deepLinkParams = (function () {
    var p = new URLSearchParams(window.location.search);
    if (p.get('openAdd') === '1' && p.get('section')) {
      return { section: p.get('section'), barcode: p.get('barcode') || '' };
    }
    return null;
  })();

  function root() { return document.getElementById('barq-root'); }

  function render() {
    var user = BARQ_AUTH.getCurrentUser();
    if (!user) { renderAuth(); return; }
    renderShell(user);
  }

  // ---------------- شاشة الدخول (بسيطة: اسم مستخدم + كلمة سر بس) ----------------
  var authError = '';

  function renderAuth() {
    root().innerHTML =
      '<div class="auth-screen">' +
      '  <div class="auth-card">' +
      '    <div class="auth-logo"></div>' +
      '    <h1>برق <span class="brand-en">BARQ</span></h1>' +
      '    <p class="sub">نظام إدارة الفروع — سجّل دخولك للمتابعة</p>' +
      '    <form id="auth-form">' +
      '      <div class="auth-field-group">' +
      '        <label class="auth-field-label" for="f-username">اسم المستخدم</label>' +
      '        <input class="auth-field" type="text" id="f-username" autocomplete="username" autofocus>' +
      '      </div>' +
      '      <div class="auth-field-group">' +
      '        <label class="auth-field-label" for="f-password">كلمة المرور</label>' +
      '        <input class="auth-field" type="password" id="f-password" autocomplete="current-password">' +
      '      </div>' +
      '      <button type="submit" class="auth-btn">دخول</button>' +
      '    </form>' +
      (authError ? '<div class="auth-error">' + authError + '</div>' : '') +
      '    <div class="auth-footer-note">⚡ برق — نظام إدارة متكامل</div>' +
      '  </div>' +
      '</div>';

    var form = document.getElementById('auth-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = document.getElementById('f-username').value.trim();
      var p = document.getElementById('f-password').value;
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'جاري الدخول...';
      BARQ_AUTH.login(u, p).then(function (res) {
        if (!res.ok) { authError = res.error; render(); return; }
        authError = '';
        render();
      });
    });
  }

  // أدوار forou3 (orders.js) بتستخدم نظام صلاحيات داخلي (ROLES[role].can[])
  // منفصل عن نظام الأقسام هنا — نفس القيم بالظبط من orders.js، عشان تبويبات
  // الإنتاج/الفريزر/استلام المصنع (اللي بقت subsections مستقلة بدل ما تكون
  // تابات جوه شاشة الطلبية) تفضل متسقة مع صلاحيات forou3 الأصلية، ومحدش
  // يشوف تبويب مالوش صلاحية عليه أصلاً (زي staff اللي معاهاش 'production').
  // ceo بتتحول جوه orders.js نفسها لصلاحيات admin كاملة (syncFromShellAuth)،
  // فبتاخد نفس قائمة admin هنا.
  var ORDERS_ROLE_CAN = {
    admin: ['production', 'freezer', 'factory_receive'],
    ceo: ['production', 'freezer', 'factory_receive'],
    manager: ['production', 'freezer', 'factory_receive'],
    staff: ['freezer', 'factory_receive']
  };
  function visibleSubsections(section, user) {
    if (!section.subsections) return null;
    // لو اليوزر ده صاحب تبويب مخصص (roleOnly) جوه القسم ده — لازم يشوف
    // تبويبه بس ومفيش حاجة تانية خالص، حتى لو فيه تبويبات تانية جوه نفس
    // القسم من غير roleOnly أصلاً (زي "الإنتاج والتصنيع"/"المصنع" جوه
    // المخزون — دول لازم يتخفوا عن يوزر deptprep_vip مثلاً، مش يظهروا
    // بالغلط لأنهم من غير قيد أصلاً)
    var ownerRoles = section.subsections.filter(function (s) { return s.roleOnly; }).map(function (s) { return s.roleOnly; });
    var isDedicatedOwner = ownerRoles.indexOf(user.role) !== -1;
    return section.subsections.filter(function (sub) {
      if (isDedicatedOwner) return sub.roleOnly === user.role;
      if (sub.cap) {
        var allowedCaps = ORDERS_ROLE_CAN[user.role];
        if (!(allowedCaps ? allowedCaps.indexOf(sub.cap) !== -1 : true)) return false;
      }
      // roles: لستة أدوار مسموح لها بس (لما أكتر من دور محتاج يشوف نفس
      // التبويب — زي باركود اللي محتاج يظهر لـ admin/ceo/تسويق مع بعض)
      if (sub.roles) return sub.roles.indexOf(user.role) !== -1;
      return true;
    });
  }

  // ---------------- هيكل التطبيق بعد الدخول ----------------
  function renderShell(user) {
    var allowed = BARQ_AUTH.allowedSections();
    if (!activeSection || allowed.indexOf(activeSection) === -1) {
      activeSection = (deepLinkParams && allowed.indexOf(deepLinkParams.section) !== -1) ? deepLinkParams.section : (allowed[0] || null);
      var initDef = BARQ_SECTIONS.find(function (s) { return s.key === activeSection; });
      // لازم نختار أول تبويب فرعي *ظاهر فعلاً لليوزر ده* (مش أول عنصر خام
      // في المصفوفة) — وإلا يوزر قسم معيّن (زي deptprep_vip) ممكن يفتح
      // افتراضيًا على تبويب مش بتاعه أصلًا (زي "الإنتاج والتصنيع" العام)
      var initSubs = initDef ? visibleSubsections(initDef, user) : null;
      var firstVisibleSub = initSubs && initSubs.filter(function (s) { return !s.url; })[0];
      activeSub = firstVisibleSub ? firstVisibleSub.key : null;
    }

    var visibleSections = BARQ_SECTIONS.filter(function (s) {
      return allowed.indexOf(s.key) !== -1;
    });

    var sectionsHtml = visibleSections.map(function (s, i) {
      var isActive = activeSection === s.key;
      var subs = visibleSubsections(s, user);
      var hasSub = !!(subs && subs.length);
      var subHtml = '';
      if (hasSub) {
        subHtml = '<div class="sidebar-subnav">' + subs.map(function (sub) {
          if (sub.url) {
            return '<a class="sidebar-subitem sidebar-subitem-link" href="' + sub.url + '" target="_blank" rel="noopener">' + sub.label + ' ↗</a>';
          }
          return '<div class="sidebar-subitem ' + (isActive && activeSub === sub.key ? 'active' : '') + '" data-section="' + s.key + '" data-sub="' + sub.key + '">' + sub.label + '</div>';
        }).join('') + '</div>';
      }
      // فاصل بسيط قبل "المستخدمين والصلاحيات" — قسم إداري منفصل عن الأقسام التشغيلية
      var divider = (s.key === 'access-list') ? '<div class="sidebar-divider"></div>' : '';
      return divider + '<div class="sidebar-section ' + (hasSub ? 'has-sub' : '') + ' ' + (isActive ? 'open active' : '') + '" data-section="' + s.key + '">' +
        '<span class="ic">' + s.icon + '</span><span>' + s.label + '</span>' +
        '</div>' + subHtml;
    }).join('');

    var currentSectionDef = BARQ_SECTIONS.find(function (s) { return s.key === activeSection; });

    root().innerHTML =
      '<div class="app-shell" id="app-shell">' +
      '  <aside class="sidebar" id="sidebar">' +
      '    <div class="sidebar-header"><span class="logo"></span><span class="title">برق <span class="title-en">BARQ</span></span></div>' +
      '    <div class="sidebar-eyebrow">الأقسام</div>' +
      '    <nav class="sidebar-nav">' + sectionsHtml + '</nav>' +
      '  </aside>' +
      '  <div class="main-area">' +
      '    <div class="topbar">' +
      '      <button class="menu-toggle" id="btn-menu">☰ رجوع</button>' +
      '      <div class="section-title">' + (currentSectionDef ? currentSectionDef.icon + ' ' + currentSectionDef.label : '') + '</div>' +
      '      <div class="topbar-user">' +
      '        <button class="topbar-user-btn" id="btn-user-menu"><span class="avatar-sm">' + user.icon + '</span><span class="welcome">مرحبا ' + user.label + '</span><span class="caret">▾</span></button>' +
      '        <div class="user-dropdown" id="user-dropdown">' +
      '          <button id="btn-edit-self">✏️ تعديل بياناتي</button>' +
      '          <button id="btn-logout">🚪 تسجيل الخروج</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="content-area" id="content-area"></div>' +
      '  </div>' +
      '  <button class="report-fab" id="btn-report-fab" title="بلاغ عن مشكلة">🆘</button>' +
      '  <div class="report-modal-backdrop" id="report-modal-backdrop">' +
      '    <div class="report-modal">' +
      '      <h3>🆘 بلاغ عن مشكلة</h3>' +
      '      <p class="report-modal-sub">اكتب المشكلة اللي واجهتك وهتوصلنا فورًا.</p>' +
      '      <textarea id="report-msg" class="report-textarea" rows="5" placeholder="اكتب المشكلة هنا..."></textarea>' +
      '      <div class="report-modal-err" id="report-modal-err"></div>' +
      '      <div class="report-modal-actions">' +
      '        <button class="report-btn report-btn-primary" id="btn-report-send">إرسال البلاغ</button>' +
      '        <button class="report-btn" id="btn-report-cancel">إلغاء</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="report-modal-backdrop" id="self-edit-backdrop">' +
      '    <div class="report-modal">' +
      '      <h3>✏️ تعديل بياناتي</h3>' +
      '      <p class="report-modal-sub">الاسم اللي هيظهرلك في الترحيب. تفاصيل الدور والصلاحيات بتتعدّل من "المستخدمين والصلاحيات".</p>' +
      '      <label class="mp-flabel" style="display:block;font-size:12px;color:var(--muted);margin-bottom:12px">الاسم الظاهر<input type="text" id="self-edit-label" class="mp-input" style="width:100%;margin-top:5px;box-sizing:border-box" value="' + (user.label || '') + '"></label>' +
      '      <label class="mp-flabel" style="display:block;font-size:12px;color:var(--muted);margin-bottom:12px">كلمة سر جديدة (سيبها فاضية لو مش عايز تغيّرها)<input type="password" id="self-edit-password" class="mp-input" style="width:100%;margin-top:5px;box-sizing:border-box"></label>' +
      '      <div class="report-modal-err" id="self-edit-err"></div>' +
      '      <div class="report-modal-actions">' +
      '        <button class="report-btn report-btn-primary" id="btn-self-edit-save">💾 حفظ</button>' +
      '        <button class="report-btn" id="btn-self-edit-cancel">إلغاء</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    document.getElementById('btn-logout').addEventListener('click', function () {
      BARQ_AUTH.logout();
      activeSection = null; activeSub = null;
      render();
    });
    var menuBtn = document.getElementById('btn-menu');
    if (menuBtn) {
      menuBtn.addEventListener('click', function () {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('app-shell').classList.toggle('sidebar-open');
      });
    }

    root().querySelectorAll('.sidebar-section').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.sidebar-subitem')) return;
        activeSection = el.getAttribute('data-section');
        var secDef = BARQ_SECTIONS.find(function (s) { return s.key === activeSection; });
        var secSubs = secDef ? visibleSubsections(secDef, user) : null;
        var firstVisibleSecSub = secSubs && secSubs.filter(function (s) { return !s.url; })[0];
        activeSub = firstVisibleSecSub ? firstVisibleSecSub.key : null;
        render();
        mountActiveContent();
      });
    });
    root().querySelectorAll('.sidebar-subitem:not(.sidebar-subitem-link)').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        activeSection = el.getAttribute('data-section');
        activeSub = el.getAttribute('data-sub');
        render();
        mountActiveContent();
      });
    });
    // روابط الملحقات (POS/PDA) بتاعت <a target="_blank"> — بتفتح لوحدها
    // طبيعي، بس لازم توقف الكليك من إنه يطلع لفوق ويقفل/يبدّل القسم المفتوح
    root().querySelectorAll('.sidebar-subitem-link').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); });
    });

    bindReportFab();
    bindUserMenu(user);
    mountActiveContent();
  }

  // ---------------- قايمة المستخدم (أعلى يسار الشاشة، برا القائمة الجانبية) ----------------
  function bindUserMenu(user) {
    var menuBtn = document.getElementById('btn-user-menu');
    var dropdown = document.getElementById('user-dropdown');
    if (!menuBtn || !dropdown) return;

    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', function () { dropdown.classList.remove('open'); });
    dropdown.addEventListener('click', function (e) { e.stopPropagation(); });

    var editBackdrop = document.getElementById('self-edit-backdrop');
    document.getElementById('btn-edit-self').addEventListener('click', function () {
      dropdown.classList.remove('open');
      document.getElementById('self-edit-err').textContent = '';
      document.getElementById('self-edit-label').value = user.label || '';
      document.getElementById('self-edit-password').value = '';
      editBackdrop.classList.add('open');
    });
    document.getElementById('btn-self-edit-cancel').addEventListener('click', function () { editBackdrop.classList.remove('open'); });
    editBackdrop.addEventListener('click', function (e) { if (e.target === editBackdrop) editBackdrop.classList.remove('open'); });

    document.getElementById('btn-self-edit-save').addEventListener('click', function () {
      var newLabel = document.getElementById('self-edit-label').value.trim();
      var newPassword = document.getElementById('self-edit-password').value.trim();
      var errEl = document.getElementById('self-edit-err');
      var saveBtn = document.getElementById('btn-self-edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'جاري الحفظ...';
      BARQ_AUTH.updateUser(user.username, { label: newLabel, password: newPassword || undefined }).then(function (res) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 حفظ';
        if (!res.ok) { errEl.textContent = res.error || 'تعذر الحفظ'; return; }
        BARQ_AUTH.updateOwnLabel(newLabel);
        editBackdrop.classList.remove('open');
        render();
      });
    });
  }

  // ---------------- زرار البلاغ العائم ----------------
  function bindReportFab() {
    var fab = document.getElementById('btn-report-fab');
    var backdrop = document.getElementById('report-modal-backdrop');
    var cancelBtn = document.getElementById('btn-report-cancel');
    var sendBtn = document.getElementById('btn-report-send');
    if (!fab || !backdrop) return;

    function openModal() {
      backdrop.classList.add('open');
      document.getElementById('report-modal-err').textContent = '';
      document.getElementById('report-msg').value = '';
      document.getElementById('report-msg').focus();
    }
    function closeModal() { backdrop.classList.remove('open'); }

    fab.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });

    sendBtn.addEventListener('click', function () {
      var msg = document.getElementById('report-msg').value.trim();
      var errEl = document.getElementById('report-modal-err');
      if (!msg) { errEl.textContent = 'اكتب المشكلة الأول'; return; }
      sendBtn.disabled = true;
      sendBtn.textContent = 'جاري الإرسال...';
      var user = BARQ_AUTH.getCurrentUser();
      var sectionTitleEl = document.querySelector('.section-title');
      sb('support_reports', {
        method: 'POST',
        body: JSON.stringify({
          username: user ? (user.username || user.label) : null,
          role_label: user ? user.label : null,
          branch: user ? user.branch : null,
          section: sectionTitleEl ? sectionTitleEl.textContent.trim() : null,
          message: msg
        })
      }).then(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال البلاغ';
        closeModal();
        showReportToast('✅ تم إرسال البلاغ، هيتم التعامل معاه قريبًا');
      }).catch(function (e) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'إرسال البلاغ';
        errEl.textContent = 'تعذر الإرسال — تأكد من الاتصال بالإنترنت';
        console.error(e);
      });
    });
  }

  function showReportToast(msg) {
    var t = document.createElement('div');
    t.className = 'report-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3000);
  }

  function mountActiveContent() {
    var container = document.getElementById('content-area');
    if (!container) return;
    if (!activeSection) {
      container.innerHTML = '<div class="placeholder-card"><div class="pic">🔒</div><h3>لا توجد أقسام متاحة لهذا الدور</h3></div>';
      return;
    }
    var key = activeSub || activeSection;
    var mod = BARQ_MODULES[key];
    if (mod && typeof mod.mount === 'function') {
      var mountResult = mod.mount(container, key);
      if (deepLinkParams && activeSection === deepLinkParams.section && typeof mod.openScan === 'function') {
        var barcode = deepLinkParams.barcode;
        deepLinkParams = null;
        // نمسح البارامترز من الرابط عشان أي رفرش بعد كده ميعيدش فتح نفس الإضافة
        window.history.replaceState({}, '', window.location.pathname);
        (mountResult && typeof mountResult.then === 'function' ? mountResult : Promise.resolve()).then(function () {
          mod.openScan(barcode);
        });
      }
      return;
    }
    var def = BARQ_SECTIONS.find(function (s) { return s.key === activeSection; });
    var msg = (def && def.subsections && def.subsections.every(function (s) { return s.url; }))
      ? 'دوس على أي رابط من القايمة الفرعية هنا عشان يفتحلك في تاب جديد.'
      : 'هذا القسم قيد النقل من التطبيق القديم — قريبًا.';
    container.innerHTML = '<div class="placeholder-card"><div class="pic">' + (def ? def.icon : '⚡') + '</div><h3>' + (def ? def.label : '') + '</h3><p>' + msg + '</p></div>';
  }

  return { render: render };
})();

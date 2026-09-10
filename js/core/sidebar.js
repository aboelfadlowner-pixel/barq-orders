// ============================================================
// برق — القائمة الجانبية الموحدة + تركيب شاشة الدخول
// ============================================================

var BARQ_SECTIONS = [
  { key: 'orders',      label: 'الطلبيات',              icon: '🛒',
    subsections: [
      { key: 'orders-main',       label: 'الأصناف والطلبيات' },
      { key: 'orders-production', label: 'الإنتاج',              cap: 'production' },
      { key: 'orders-freezer',    label: 'الفريزر',               cap: 'freezer' },
      { key: 'orders-receive',    label: 'استلام من المصنع',       cap: 'factory_receive' },
      { key: 'orders-factory',    label: 'المصنع' },
      { key: 'orders-dept',       label: 'تحضير الأقسام' }
    ] },
  { key: 'purchasing',  label: 'المشتريات والمخزون',   icon: '📦' },
  { key: 'pricing',     label: 'تسعير',                  icon: '💰' },
  { key: 'receiving',   label: 'استلامات',               icon: '📥' },
  // "مالية" كانت دايمًا بتوريك شاشة "مدير المالية" بس لما تدخل بحساب admin،
  // مفيش طريقة توصل بيها لشاشة "أمين الخزينة — أحمد صلاح" (اللي الفاتورة
  // بتوصلها بعد الاستلام) غير بحساب PIN مخصص ليها. دلوقتي بقت تبويبين
  // واضحين — الأدمن/الـCEO يقدروا يفتحوا أي واحد فيهم، وكل يوزر PIN مخصص
  // (finance/finmgr) بيشوف بس شاشته هو
  { key: 'finance',     label: 'مالية',                  icon: '🏦',
    subsections: [
      { key: 'finance-treasury', label: 'خزينة (أحمد صلاح)', roleOnly: 'finance' },
      { key: 'finance-mgr',      label: 'مدير المالية',       roleOnly: 'finmgr' }
    ] },
  { key: 'barcode',     label: 'باركود وطباعة',          icon: '🏷️' },
  { key: 'stocktake',   label: 'جرد',                    icon: '🔢' },
  { key: 'shelf-check', label: 'شيلفات',                 icon: '🔖' },
  // نفس موديول "تحضير الأقسام" (تبويب فرعي جوه الطلبيات) بس كقسم مستقل —
  // ده اللي بيظهر لليوزر المخصص deptprep (كل الأقسام)، اللي مالوش صلاحية
  // على "الطلبيات" نفسها. وتحته 4 يوزرات مخصصة، كل واحد لقسم واحد بس
  { key: 'dept-prep',   label: 'تحضير الأقسام',          icon: '🏭' },
  { key: 'dept-vip',      label: 'تحضير — VIP',              icon: '🏭' },
  { key: 'dept-masnaat',  label: 'تحضير — مصنعات',           icon: '🏭' },
  { key: 'dept-lahom',    label: 'تحضير — مصنعات لحوم ودواجن', icon: '🏭' },
  { key: 'dept-mo3mal',   label: 'تحضير — معمل',              icon: '🏭' },
  { key: 'reports', label: 'تقارير', icon: '📊' },
  { key: 'decision-kitchen', label: 'مطبخ القرار', icon: '🍳' },
  { key: 'access-list', label: 'المستخدمين والصلاحيات', icon: '👥' },
  { key: 'support-admin', label: 'بلاغات المستخدمين', icon: '🆘' }
];

// سجل الموديولات — كل مرحلة قادمة بتسجل نفسها هنا: BARQ_MODULES['orders'] = { mount(container){...} }
var BARQ_MODULES = window.BARQ_MODULES || (window.BARQ_MODULES = {});

var BarqApp = (function () {
  var activeSection = null;
  var activeSub = null;

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
      '    <h1>برق</h1>' +
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
    return section.subsections.filter(function (sub) {
      if (sub.cap) {
        var allowedCaps = ORDERS_ROLE_CAN[user.role];
        if (!(allowedCaps ? allowedCaps.indexOf(sub.cap) !== -1 : true)) return false;
      }
      // roleOnly: تبويب خاص بيوزر PIN مخصص واحد بس (زي finance/finmgr) —
      // يظهر لصاحبه فقط، أو لأي حد تاني عنده وصول عام على القسم (admin/ceo)
      // اللي مش من أصحاب اليوزرات المخصصة دي أصلًا
      if (sub.roleOnly) {
        var ownerRoles = section.subsections.filter(function (s) { return s.roleOnly; }).map(function (s) { return s.roleOnly; });
        var isDedicatedOwner = ownerRoles.indexOf(user.role) !== -1;
        if (isDedicatedOwner) return sub.roleOnly === user.role;
      }
      return true;
    });
  }

  // ---------------- هيكل التطبيق بعد الدخول ----------------
  function renderShell(user) {
    var allowed = BARQ_AUTH.allowedSections();
    if (!activeSection || allowed.indexOf(activeSection) === -1) {
      activeSection = allowed[0] || null;
      var initDef = BARQ_SECTIONS.find(function (s) { return s.key === activeSection; });
      activeSub = (initDef && initDef.subsections && initDef.subsections[0]) ? initDef.subsections[0].key : null;
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
      '    <div class="sidebar-header"><span class="logo"></span><span class="title">برق</span></div>' +
      '    <div class="sidebar-user"><span class="avatar">' + user.icon + '</span><div class="info"><span class="name">' + (user.username || user.label) + '</span><span class="role">' + user.label + '</span></div></div>' +
      '    <button class="sidebar-logout-top" id="btn-logout">تسجيل الخروج</button>' +
      '    <div class="sidebar-eyebrow">الأقسام</div>' +
      '    <nav class="sidebar-nav">' + sectionsHtml + '</nav>' +
      '  </aside>' +
      '  <div class="main-area">' +
      '    <div class="topbar">' +
      '      <button class="menu-toggle" id="btn-menu">☰ رجوع</button>' +
      '      <div class="section-title">' + (currentSectionDef ? currentSectionDef.icon + ' ' + currentSectionDef.label : '') + '</div>' +
      '      <div></div>' +
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
        activeSub = (secDef && secDef.subsections && secDef.subsections[0]) ? secDef.subsections[0].key : null;
        render();
        mountActiveContent();
      });
    });
    root().querySelectorAll('.sidebar-subitem').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        activeSection = el.getAttribute('data-section');
        activeSub = el.getAttribute('data-sub');
        render();
        mountActiveContent();
      });
    });

    bindReportFab();
    mountActiveContent();
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
      mod.mount(container, key);
      return;
    }
    var def = BARQ_SECTIONS.find(function (s) { return s.key === activeSection; });
    container.innerHTML = '<div class="placeholder-card"><div class="pic">' + (def ? def.icon : '⚡') + '</div><h3>' + (def ? def.label : '') + '</h3><p>هذا القسم قيد النقل من التطبيق القديم — قريبًا.</p></div>';
  }

  return { render: render };
})();

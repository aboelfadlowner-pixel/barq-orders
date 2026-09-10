// ============================================================
// برق — موديول "مطبخ القرار" (جديد، مبني من "foodicsanalytics.html" اللي
// المستخدم رفعه، بس معاد ربطه ببيانات Supabase الحقيقية بدل مولّد البيانات
// التجريبي بتاعه الأصلي)
// المصدر: جدول menu_analysis — بيتغذّى برفع يومي لكل فرع لوحده (صف واحد
// لكل صنف/فرع/يوم — PK: sku+branch+report_date). الموديول ده قراءة بس —
// بيفلتر بفرع (أو "كل الفروع" مجمّعة) وفترة تاريخ، وبيجمّع/يعيد حساب
// النسب والتصنيف على الأرقام المجمّعة نفسها (مش بس بيعرض القيم الخام
// المخزّنة لكل صف لأنها ممكن تختلف يوم عن يوم أو فرع عن فرع).
// مفيش أي تعديل على الجدول — قراءة بس.
// ============================================================

var BARQ_KITCHEN = (function () {
  var RAW_ROWS = [];      // كل الصفوف الخام اللي رجعت من الفترة/الفرع المختار
  var ROWS = [];          // بعد التجميع لكل صنف + إعادة حساب النسب والتصنيف
  var branchNames = [];
  var selectedBranch = '';
  var search = '';
  var classFilter = 'all';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('ar-EG') + ' ج.م'; }
  function fmt(n) { return (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('ar-EG'); }
  function pct(n) { return (n == null || isNaN(n)) ? '—' : (Math.round(parseFloat(n) * 10) / 10).toLocaleString('ar-EG') + '%'; }
  function mean(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function todayStr() { return new Date().toISOString().split('T')[0]; }
  function daysAgoStr(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

  var CLASS_MAP = {
    star: ['⭐ نجم', 'good'], horse: ['🐎 حصان شغل', 'info'], opp: ['💡 فرصة', 'accent'], weak: ['⚠ ضعيف', 'bad']
  };
  function classChip(cls) {
    var m = CLASS_MAP[cls] || ['—', 'info'];
    return '<span class="chip chip-' + m[1] + '">' + m[0] + '</span>';
  }
  function catChip(level) {
    var m = { high: ['مرتفع', 'good'], medium: ['متوسط', 'warn'], low: ['منخفض', 'bad'] }[level] || ['—', 'info'];
    return '<span class="chip chip-' + m[1] + '">' + m[0] + '</span>';
  }

  // ============ تحميل أسماء الفروع (للفلتر) ============
  function loadBranchNames() {
    return sb('menu_analysis?select=branch').then(function (rows) {
      var set = {};
      (rows || []).forEach(function (r) { if (r.branch) set[r.branch] = true; });
      branchNames = Object.keys(set).sort();
    }).catch(function (e) { console.error(e); });
  }

  // ============ تحميل الصفوف الخام حسب الفلاتر، وتجميعها لكل صنف ============
  function loadData() {
    var root = document.getElementById('mk-root');
    if (root) root.innerHTML = '<div class="mk-loading">⏳ جاري تحميل بيانات مطبخ القرار...</div>';
    var from = document.getElementById('mk-from') ? document.getElementById('mk-from').value : daysAgoStr(6);
    var to = document.getElementById('mk-to') ? document.getElementById('mk-to').value : todayStr();
    var path = 'menu_analysis?select=*&report_date=gte.' + from + '&report_date=lte.' + to;
    if (selectedBranch) path += '&branch=eq.' + encodeURIComponent(selectedBranch);
    return sb(path).then(function (rows) {
      RAW_ROWS = rows || [];
      ROWS = aggregate(RAW_ROWS);
      renderShell(from, to);
    }).catch(function (e) {
      if (root) root.innerHTML = '<div class="mk-empty mk-error">⚠️ تعذر تحميل بيانات مطبخ القرار</div>';
      console.error(e);
    });
  }

  // بيجمّع كل الصفوف الخام (ممكن تكون لأيام و/أو فروع متعددة) لكل صنف،
  // وبعدين بيعيد حساب الهامش/الشعبية والتصنيف الرباعي على الأرقام المجمّعة
  // (مش بيعتمد على class/category المخزّنة في كل صف لوحده لأنها بتختلف
  // حسب اليوم/الفرع ومش هينفع تتوسّط أو تتجمّع بشكل مباشر)
  function aggregate(rows) {
    var bySku = {};
    rows.forEach(function (r) {
      var key = r.sku;
      if (!bySku[key]) bySku[key] = { sku: r.sku, product_name: r.product_name, quantity: 0, sales: 0, total_cost: 0 };
      bySku[key].quantity += parseFloat(r.quantity) || 0;
      bySku[key].sales += parseFloat(r.sales) || 0;
      bySku[key].total_cost += parseFloat(r.total_cost) || 0;
      if (r.product_name) bySku[key].product_name = r.product_name;
    });
    var list = Object.values(bySku).map(function (r) {
      r.total_profit = r.sales - r.total_cost;
      r.profit_pct = r.sales > 0 ? (r.total_profit / r.sales * 100) : 0;
      r.item_profit = r.quantity > 0 ? (r.total_profit / r.quantity) : 0;
      return r;
    });
    var totalSalesAll = list.reduce(function (a, r) { return a + r.sales; }, 0);
    list.forEach(function (r) { r.popularity_pct = totalSalesAll > 0 ? (r.sales / totalSalesAll * 100) : 0; });

    var salesMedian = median(list.map(function (r) { return r.sales; }));
    var marginMedian = median(list.map(function (r) { return r.profit_pct; }));
    list.forEach(function (r) {
      var highSales = r.sales >= salesMedian, highMargin = r.profit_pct >= marginMedian;
      r.class = highSales && highMargin ? 'star' : highSales && !highMargin ? 'horse' : !highSales && highMargin ? 'opp' : 'weak';
      r.profit_category = r.profit_pct >= marginMedian * 1.15 ? 'high' : r.profit_pct >= marginMedian * 0.7 ? 'medium' : 'low';
      r.popularity_category = r.sales >= salesMedian * 1.15 ? 'high' : r.sales >= salesMedian * 0.7 ? 'medium' : 'low';
    });
    return list;
  }

  function distinctClasses() {
    var set = {};
    ROWS.forEach(function (r) { if (r.class) set[r.class] = true; });
    return Object.keys(set);
  }

  function filteredRows() {
    var rows = ROWS;
    if (search) rows = rows.filter(function (r) { return (r.product_name || '').indexOf(search) !== -1 || (r.sku || '').indexOf(search) !== -1; });
    if (classFilter !== 'all') rows = rows.filter(function (r) { return r.class === classFilter; });
    return rows;
  }

  function branchFieldHtml() {
    return '<select class="mk-select" id="mk-branch"><option value="">كل الفروع (مجمّعة)</option>' +
      branchNames.map(function (b) { return '<option value="' + esc(b) + '"' + (b === selectedBranch ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
      '</select>';
  }

  function renderShell(from, to) {
    var root = document.getElementById('mk-root');
    if (!root) return;

    var filtersHtml =
      '<div class="mk-filters">' +
      branchFieldHtml() +
      '<label class="mk-flabel">من <input type="date" class="mk-input" id="mk-from" value="' + (from || daysAgoStr(6)) + '"></label>' +
      '<label class="mk-flabel">إلى <input type="date" class="mk-input" id="mk-to" value="' + (to || todayStr()) + '"></label>' +
      '<button class="mk-btn mk-btn-primary" id="mk-go">📊 عرض</button>' +
      '</div>';

    if (!ROWS.length) {
      root.innerHTML =
        '<div class="mk-header"><h2>🍳 مطبخ القرار</h2><p class="mk-sub">تحليل أداء الأصناف (مبيعات / ربحية / شعبية)</p></div>' +
        filtersHtml +
        '<div class="mk-empty">لا توجد بيانات لهذه الفترة/الفرع — تأكد إن البيانات اتربطت من الداتا سنتر ليوم/فرع من ضمن الفترة المختارة.</div>';
      bindFilterEvents();
      return;
    }

    var totalSales = ROWS.reduce(function (a, r) { return a + r.sales; }, 0);
    var totalProfit = ROWS.reduce(function (a, r) { return a + r.total_profit; }, 0);
    var avgMargin = mean(ROWS.map(function (r) { return r.profit_pct; }));
    var needsReview = ROWS.filter(function (r) { return r.class === 'weak'; }).length;
    var kpis = [
      { l: 'إجمالي المبيعات', v: money(totalSales) },
      { l: 'إجمالي الأرباح', v: money(totalProfit) },
      { l: 'متوسط هامش الربح', v: pct(avgMargin) },
      { l: 'عدد الأصناف', v: fmt(ROWS.length) },
      { l: 'يحتاج مراجعة', v: fmt(needsReview) }
    ];
    var classes = distinctClasses();

    root.innerHTML =
      '<div class="mk-header"><h2>🍳 مطبخ القرار</h2>' +
      '<p class="mk-sub">' + (selectedBranch ? 'فرع: ' + esc(selectedBranch) : 'كل الفروع مجمّعة') + ' — من ' + from + ' إلى ' + to + '</p></div>' +
      filtersHtml +
      '<div class="mk-kpis">' + kpis.map(function (k) { return '<div class="mk-kpi"><div class="lbl">' + k.l + '</div><div class="val">' + k.v + '</div></div>'; }).join('') + '</div>' +
      '<div class="mk-chart-wrap"><canvas id="mk-chart-top"></canvas></div>' +
      '<div class="mk-filters">' +
      '<input class="mk-input" id="mk-search" placeholder="🔍 بحث بالاسم أو SKU" value="' + esc(search) + '">' +
      '<select class="mk-select" id="mk-class-filter"><option value="all">كل التصنيفات</option>' + classes.map(function (c) { return '<option value="' + esc(c) + '"' + (c === classFilter ? ' selected' : '') + '>' + CLASS_MAP[c][0] + '</option>'; }).join('') + '</select>' +
      '</div>' +
      '<div id="mk-table-wrap"></div>' +
      '<div class="mk-modal-overlay" id="mk-overlay"><div class="mk-modal" id="mk-modal-content"></div></div>';

    bindFilterEvents();
    document.getElementById('mk-search').addEventListener('input', function (e) { search = e.target.value.trim(); renderTable(); });
    document.getElementById('mk-class-filter').addEventListener('change', function (e) { classFilter = e.target.value; renderTable(); });
    document.getElementById('mk-overlay').addEventListener('click', function (e) { if (e.target.id === 'mk-overlay') e.currentTarget.classList.remove('open'); });

    renderTable();
    renderChart();
  }

  function bindFilterEvents() {
    var branchSel = document.getElementById('mk-branch');
    if (branchSel) branchSel.addEventListener('change', function (e) { selectedBranch = e.target.value; loadData(); });
    var goBtn = document.getElementById('mk-go');
    if (goBtn) goBtn.addEventListener('click', function () { loadData(); });
  }

  var sortKey = 'sales', sortDir = -1;
  var COLS = [
    { key: 'product_name', label: 'الصنف' },
    { key: 'quantity', label: 'الكمية', num: true },
    { key: 'sales', label: 'المبيعات', num: true },
    { key: 'total_cost', label: 'التكلفة', num: true },
    { key: 'item_profit', label: 'ربح الوحدة', num: true },
    { key: 'total_profit', label: 'إجمالي الربح', num: true },
    { key: 'profit_pct', label: 'الهامش %', num: true },
    { key: 'popularity_category', label: 'الشعبية' },
    { key: 'profit_category', label: 'الربحية' },
    { key: 'class', label: 'التصنيف' }
  ];

  function renderTable() {
    var wrap = document.getElementById('mk-table-wrap');
    if (!wrap) return;
    var rows = filteredRows().slice();
    rows.sort(function (a, b) {
      var va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string' || typeof vb === 'string') return sortDir * String(va || '').localeCompare(String(vb || ''), 'ar');
      return sortDir * ((parseFloat(va) || 0) - (parseFloat(vb) || 0));
    });
    var thead = '<tr>' + COLS.map(function (c) {
      return '<th class="' + (c.num ? 'num-col' : '') + '" data-k="' + c.key + '">' + c.label + (c.key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</th>';
    }).join('') + '</tr>';
    var tbody = rows.map(function (r) {
      return '<tr class="mk-row" data-sku="' + esc(r.sku) + '">' +
        '<td><div class="mk-name">' + esc(r.product_name) + '</div><div class="mk-sku">' + esc(r.sku) + '</div></td>' +
        '<td class="num-col num">' + fmt(r.quantity) + '</td>' +
        '<td class="num-col num">' + money(r.sales) + '</td>' +
        '<td class="num-col num">' + money(r.total_cost) + '</td>' +
        '<td class="num-col num">' + money(r.item_profit) + '</td>' +
        '<td class="num-col num">' + money(r.total_profit) + '</td>' +
        '<td class="num-col num">' + pct(r.profit_pct) + '</td>' +
        '<td>' + catChip(r.popularity_category) + '</td>' +
        '<td>' + catChip(r.profit_category) + '</td>' +
        '<td>' + classChip(r.class) + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="' + COLS.length + '" class="mk-empty-cell">لا توجد أصناف مطابقة</td></tr>';

    wrap.innerHTML = '<table class="mk-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
    wrap.querySelectorAll('th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = -1; }
        renderTable();
      });
    });
    wrap.querySelectorAll('.mk-row').forEach(function (tr) {
      tr.addEventListener('click', function () { openItemModal(tr.getAttribute('data-sku')); });
    });
  }

  function renderChart() {
    if (typeof Chart === 'undefined') return;
    var top = ROWS.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, 10);
    var canvas = document.getElementById('mk-chart-top');
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas, {
      type: 'bar',
      data: { labels: top.map(function (r) { return r.product_name; }), datasets: [{ label: 'المبيعات', data: top.map(function (r) { return r.sales; }), backgroundColor: '#12c77a', borderRadius: 5 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: function (v) { return fmt(v); } } } } }
    });
  }

  function openItemModal(sku) {
    var r = ROWS.find(function (x) { return x.sku === sku; });
    if (!r) return;
    var verdict;
    if (r.class === 'horse') {
      verdict = 'الصنف من "أحصنة الشغل" — مبيعات مرتفعة لكن هامش ربحه أقل من متوسط القائمة. يُنصح بمراجعة سعر البيع أو تكلفة المكونات.';
    } else if (r.class === 'opp') {
      verdict = 'الصنف يحقق هامش ربح جيد لكن مبيعاته منخفضة نسبيًا — فرصة جيدة للترويج له وإبرازه في القائمة.';
    } else if (r.class === 'weak') {
      verdict = 'الصنف ضعيف في المبيعات والربحية معًا خلال الفترة دي — يُنصح بمراجعة استمراره ضمن القائمة أو أسباب الضعف.';
    } else {
      verdict = 'صنف "نجم" — مبيعات مرتفعة وهامش ربح جيد بالمقارنة بباقي القائمة. يُنصح بضمان توافره الدائم والتركيز عليه في الترويج.';
    }
    document.getElementById('mk-modal-content').innerHTML =
      '<div class="mk-im-head"><button class="mk-close" id="mk-modal-close">✕</button>' +
      '<h3>' + esc(r.product_name) + '</h3><div class="mk-im-meta">SKU: ' + esc(r.sku) + (selectedBranch ? ' — فرع: ' + esc(selectedBranch) : ' — كل الفروع مجمّعة') + '</div></div>' +
      '<div class="mk-im-grid">' +
      '<div class="mk-im-row"><span>الكمية المباعة</span><b>' + fmt(r.quantity) + '</b></div>' +
      '<div class="mk-im-row"><span>المبيعات</span><b>' + money(r.sales) + '</b></div>' +
      '<div class="mk-im-row"><span>التكلفة الإجمالية</span><b>' + money(r.total_cost) + '</b></div>' +
      '<div class="mk-im-row"><span>ربح الوحدة</span><b>' + money(r.item_profit) + '</b></div>' +
      '<div class="mk-im-row"><span>إجمالي الربح</span><b>' + money(r.total_profit) + '</b></div>' +
      '<div class="mk-im-row"><span>هامش الربح</span><b>' + pct(r.profit_pct) + '</b></div>' +
      '<div class="mk-im-row"><span>نسبة الشعبية</span><b>' + pct(r.popularity_pct) + '</b></div>' +
      '<div class="mk-im-row"><span>تصنيف الشعبية</span>' + catChip(r.popularity_category) + '</div>' +
      '<div class="mk-im-row"><span>تصنيف الربحية</span>' + catChip(r.profit_category) + '</div>' +
      '<div class="mk-im-row"><span>الفئة</span>' + classChip(r.class) + '</div>' +
      '</div>' +
      '<div class="mk-im-note"><b>قرار النظام:</b> ' + verdict + '</div>';
    document.getElementById('mk-modal-close').addEventListener('click', function () { document.getElementById('mk-overlay').classList.remove('open'); });
    document.getElementById('mk-overlay').classList.add('open');
  }

  function mount(container) {
    search = ''; classFilter = 'all'; sortKey = 'sales'; sortDir = -1; selectedBranch = ''; RAW_ROWS = []; ROWS = [];
    container.innerHTML = '<div class="mk-mod"><div id="mk-root"><div class="mk-loading">⏳ جاري التحميل...</div></div></div>';
    loadBranchNames().then(loadData);
  }

  return { mount: mount };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['decision-kitchen'] = { mount: BARQ_KITCHEN.mount };

// ============================================================
// برق — موديول "تقارير" (جديد بالكامل، مش منقول من أي ملف قديم)
// بيقرا من نفس جداول Supabase المستخدمة في باقي التطبيق (عبر sb()):
// branch_orders / branch_order_items (طلبيات الفروع)
// purchase_orders / purchase_order_items (المشتريات)
// branch_order_receipts (الفرق بين المطلوب والمستلم، من شاشة الاستلام)
// مفيش أي تعديل على الجداول دي — قراءة بس.
// ============================================================

var BARQ_REPORTS = (function () {
  var activeTab = 'branch';
  var branchNames = [];
  var purchaseBranchNames = [];
  // مدير الفرع (role === 'manager') بيشوف تقارير فرعه بس، بدون أي اختيار —
  // مقفول على البراند بتاعه من user.branch. الأدمن/الـ CEO عندهم الاختيار الكامل.
  var lockedBranch = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtNum(n) {
    n = parseFloat(n) || 0;
    return (Math.round(n * 100) / 100).toLocaleString('ar-EG');
  }

  function todayStr() { return new Date().toISOString().split('T')[0]; }
  function daysAgoStr(n) {
    var d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  // تسجيل كل عملية تصدير CSV في audit_log_v3 — التقارير دي فيها بيانات
  // حساسة (تكاليف/موردين/أرقام مبيعات)، فتصدير جماعي بالـ CSV هو أسهل طريقة
  // لتسريب بيانات، فلازم يبقى ليه أثر واضح مين عمله وامتى
  function logExport(reportName, filename) {
    if (!window.BARQ_AUTH || typeof sb !== 'function') return;
    var user = BARQ_AUTH.getCurrentUser();
    try {
      sb('audit_log_v3', {
        method: 'POST',
        body: JSON.stringify({ action: 'export_csv', who: user ? (user.username || user.label) : '—', detail: reportName + ' — ' + filename })
      }).catch(function () {});
    } catch (e) {}
  }

  function downloadCSV(filename, headers, rows) {
    var csv = '﻿' + headers.join(',') + '\n';
    rows.forEach(function (row) {
      csv += row.map(function (v) {
        v = (v == null ? '' : String(v)).replace(/"/g, '""');
        return /[,\n"]/.test(v) ? '"' + v + '"' : v;
      }).join(',') + '\n';
    });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============ التبويبات ============
  var TABS = [
    { key: 'branch', label: '🏪 طلبيات الفروع' },
    { key: 'purchasing', label: '📦 المشتريات' },
    { key: 'shortage', label: '⚠️ النواقص (المطلوب مقابل المستلم)' },
    { key: 'topitems', label: '🔥 الأكثر طلبًا' },
    { key: 'pricing', label: '💰 تغيّر التكلفة' }
  ];

  function visibleTabs() {
    // مدير الفرع بيشوف بس التقارير المرتبطة بفرعه (طلبيات + نواقص) — مفيش
    // وصول لتقارير المشتريات/التكلفة (بيانات مالية/موردين مش خاصة بفرعه)
    if (lockedBranch) return TABS.filter(function (t) { return t.key === 'branch' || t.key === 'shortage'; });
    return TABS;
  }

  function renderShell() {
    var root = document.getElementById('rp-root');
    if (!root) return;
    var tabs = visibleTabs();
    if (!tabs.some(function (t) { return t.key === activeTab; })) activeTab = tabs[0].key;
    var tabsHtml = tabs.map(function (t) {
      return '<button class="rp-tab ' + (activeTab === t.key ? 'active' : '') + '" onclick="BARQ_REPORTS.setTab(\'' + t.key + '\')">' + t.label + '</button>';
    }).join('');
    root.innerHTML =
      '<div class="rp-header"><h2>📊 تقارير</h2><p class="rp-sub">' + (lockedBranch ? 'تقارير فرعك (' + esc(lockedBranch) + ')' : 'تقارير مبنية على نفس بيانات التطبيق الحية.') + '</p></div>' +
      '<div class="rp-tabs">' + tabsHtml + '</div>' +
      '<div id="rp-body"></div>';
    renderTabBody();
  }

  function renderTabBody() {
    var body = document.getElementById('rp-body');
    if (!body) return;
    if (activeTab === 'branch') return renderBranchTab(body);
    if (activeTab === 'purchasing') return renderPurchasingTab(body);
    if (activeTab === 'shortage') return renderShortageTab(body);
    if (activeTab === 'topitems') return renderTopItemsTab(body);
    if (activeTab === 'pricing') return renderPricingTab(body);
  }

  function setTab(key) { activeTab = key; renderTabBody(); }

  function branchFieldHtml(branchId, names) {
    if (lockedBranch) {
      return '<select class="rp-select" id="' + branchId + '" disabled title="مقفول على فرعك"><option value="' + esc(lockedBranch) + '" selected>🔒 ' + esc(lockedBranch) + '</option></select>';
    }
    return '<select class="rp-select" id="' + branchId + '"><option value="">كل الفروع</option>' + names.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join('') + '</select>';
  }

  function filtersBarHtml(opts) {
    // opts: { withBranch, fromId, toId, branchId, btnId, extra }
    return '' +
      '<div class="rp-filters">' +
      (opts.withBranch ? branchFieldHtml(opts.branchId, branchNames) : '') +
      '<label class="rp-flabel">من <input type="date" class="rp-input" id="' + opts.fromId + '" value="' + daysAgoStr(30) + '"></label>' +
      '<label class="rp-flabel">إلى <input type="date" class="rp-input" id="' + opts.toId + '" value="' + todayStr() + '"></label>' +
      '<button class="rp-btn rp-btn-primary" id="' + opts.btnId + '">📊 عرض التقرير</button>' +
      '</div>';
  }

  function readBranchFilter(selectId) {
    if (lockedBranch) return lockedBranch;
    var el = document.getElementById(selectId);
    return el ? el.value : '';
  }

  // ============ تقرير 1: طلبيات الفروع ============
  function renderBranchTab(body) {
    body.innerHTML =
      filtersBarHtml({ withBranch: true, fromId: 'rp-b-from', toId: 'rp-b-to', branchId: 'rp-b-branch', btnId: 'rp-b-go' }) +
      '<div id="rp-b-result" class="rp-result"></div>';
    document.getElementById('rp-b-go').addEventListener('click', loadBranchReport);
    if (!lockedBranch && !branchNames.length) loadBranchNames();
  }

  function loadBranchNames() {
    sb('branch_orders?select=branch_name').then(function (rows) {
      var set = {};
      (rows || []).forEach(function (r) { if (r.branch_name) set[r.branch_name] = true; });
      branchNames = Object.keys(set).sort();
      var sel = document.getElementById('rp-b-branch');
      if (sel) {
        sel.innerHTML = '<option value="">كل الفروع</option>' + branchNames.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join('');
      }
    }).catch(function (e) { console.error(e); });
  }

  function loadBranchReport() {
    var resultEl = document.getElementById('rp-b-result');
    var branch = readBranchFilter('rp-b-branch');
    var from = document.getElementById('rp-b-from').value;
    var to = document.getElementById('rp-b-to').value;
    resultEl.innerHTML = '<div class="rp-loading">⏳ جاري التحميل...</div>';

    var path = 'branch_orders?select=id,branch_name,created_at&created_at=gte.' + from + '&created_at=lte.' + to + 'T23:59:59';
    if (branch) path += '&branch_name=eq.' + encodeURIComponent(branch);

    sb(path).then(function (orders) {
      if (!orders || !orders.length) { resultEl.innerHTML = '<div class="rp-empty">لا توجد طلبيات في هذه الفترة</div>'; return null; }
      var ids = orders.map(function (o) { return o.id; });
      return sb('branch_order_items?select=sku,product_name,quantity,unit,order_id&order_id=in.(' + ids.join(',') + ')').then(function (items) {
        var agg = {};
        (items || []).forEach(function (it) {
          var key = it.sku || it.product_name;
          if (!agg[key]) agg[key] = { name: it.product_name, sku: it.sku, unit: it.unit, qty: 0, orders: {} };
          agg[key].qty += parseFloat(it.quantity) || 0;
          agg[key].orders[it.order_id] = true;
        });
        var rows = Object.values(agg).sort(function (a, b) { return b.qty - a.qty; });
        renderBranchResult(resultEl, orders, rows, branch, from, to);
      });
    }).catch(function (e) {
      resultEl.innerHTML = '<div class="rp-empty rp-error">⚠️ تعذر تحميل التقرير</div>';
      console.error(e);
    });
  }

  function renderBranchResult(el, orders, rows, branch, from, to) {
    var tableRows = rows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.sku) + '</td><td>' + fmtNum(r.qty) + ' ' + esc(r.unit || '') + '</td><td>' + Object.keys(r.orders).length + '</td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="rp-summary">📦 ' + orders.length + ' طلبية' + (branch ? ' — ' + esc(branch) : ' — كل الفروع') + ' — من ' + from + ' إلى ' + to + '</div>' +
      '<button class="rp-btn" id="rp-b-export">📥 تصدير CSV</button>' +
      '<table class="rp-table"><thead><tr><th>الصنف</th><th>SKU</th><th>الكمية الإجمالية</th><th>عدد الطلبيات</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
    document.getElementById('rp-b-export').addEventListener('click', function () {
      logExport('طلبيات الفروع', 'تقرير_طلبيات_' + (branch || 'كل_الفروع') + '_' + from + '_' + to + '.csv');
      downloadCSV('تقرير_طلبيات_' + (branch || 'كل_الفروع') + '_' + from + '_' + to + '.csv',
        ['الصنف', 'SKU', 'الكمية الإجمالية', 'الوحدة', 'عدد الطلبيات'],
        rows.map(function (r) { return [r.name, r.sku, fmtNum(r.qty), r.unit || '', Object.keys(r.orders).length]; }));
    });
  }

  // ============ تقرير 2: المشتريات ============
  function renderPurchasingTab(body) {
    body.innerHTML =
      '<div class="rp-filters">' +
      branchFieldHtml('rp-p-branch', purchaseBranchNames) +
      '<label class="rp-flabel">من <input type="date" class="rp-input" id="rp-p-from" value="' + daysAgoStr(30) + '"></label>' +
      '<label class="rp-flabel">إلى <input type="date" class="rp-input" id="rp-p-to" value="' + todayStr() + '"></label>' +
      '<button class="rp-btn rp-btn-primary" id="rp-p-go">📊 عرض التقرير</button>' +
      '</div>' +
      '<div id="rp-p-result" class="rp-result"></div>';
    document.getElementById('rp-p-go').addEventListener('click', loadPurchasingReport);
    if (!purchaseBranchNames.length) {
      sb('purchase_orders?select=branch').then(function (rows) {
        var set = {};
        (rows || []).forEach(function (r) { if (r.branch) set[r.branch] = true; });
        purchaseBranchNames = Object.keys(set).sort();
        var sel = document.getElementById('rp-p-branch');
        if (sel && !lockedBranch) sel.innerHTML = '<option value="">كل الفروع</option>' + purchaseBranchNames.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join('');
      }).catch(function (e) { console.error(e); });
    }
  }

  function loadPurchasingReport() {
    var resultEl = document.getElementById('rp-p-result');
    var branch = readBranchFilter('rp-p-branch');
    var from = document.getElementById('rp-p-from').value;
    var to = document.getElementById('rp-p-to').value;
    resultEl.innerHTML = '<div class="rp-loading">⏳ جاري التحميل...</div>';

    var path = 'purchase_orders?select=id,po_number,supplier_name,branch,created_at,status&created_at=gte.' + from + '&created_at=lte.' + to + 'T23:59:59';
    if (branch) path += '&branch=eq.' + encodeURIComponent(branch);
    sb(path).then(function (pos) {
      if (!pos || !pos.length) { resultEl.innerHTML = '<div class="rp-empty">لا توجد أوامر شراء في هذه الفترة</div>'; return null; }
      var ids = pos.map(function (p) { return p.id; });
      return sb('purchase_order_items?select=po_id,sku,product_name,unit,qty_ordered,total_price&po_id=in.(' + ids.join(',') + ')').then(function (items) {
        var agg = {};
        (items || []).forEach(function (it) {
          var key = it.sku || it.product_name;
          if (!agg[key]) agg[key] = { name: it.product_name, sku: it.sku, unit: it.unit, qty: 0, total: 0 };
          agg[key].qty += parseFloat(it.qty_ordered) || 0;
          agg[key].total += parseFloat(it.total_price) || 0;
        });
        var rows = Object.values(agg).sort(function (a, b) { return b.total - a.total; });
        renderPurchasingResult(resultEl, pos, rows, branch, from, to);
      });
    }).catch(function (e) {
      resultEl.innerHTML = '<div class="rp-empty rp-error">⚠️ تعذر تحميل التقرير</div>';
      console.error(e);
    });
  }

  function renderPurchasingResult(el, pos, rows, branch, from, to) {
    var grandTotal = rows.reduce(function (s, r) { return s + r.total; }, 0);
    var tableRows = rows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.sku) + '</td><td>' + fmtNum(r.qty) + ' ' + esc(r.unit || '') + '</td><td>' + fmtNum(r.total) + ' ج.م</td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="rp-summary">🧾 ' + pos.length + ' أمر شراء' + (branch ? ' — ' + esc(branch) : ' — كل الفروع') + ' — من ' + from + ' إلى ' + to + ' — الإجمالي: ' + fmtNum(grandTotal) + ' ج.م</div>' +
      '<button class="rp-btn" id="rp-p-export">📥 تصدير CSV</button>' +
      '<table class="rp-table"><thead><tr><th>الصنف</th><th>SKU</th><th>الكمية المشتراة</th><th>الإجمالي</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
    document.getElementById('rp-p-export').addEventListener('click', function () {
      logExport('المشتريات', 'تقرير_المشتريات_' + (branch || 'كل_الفروع') + '_' + from + '_' + to + '.csv');
      downloadCSV('تقرير_المشتريات_' + (branch || 'كل_الفروع') + '_' + from + '_' + to + '.csv',
        ['الصنف', 'SKU', 'الكمية المشتراة', 'الوحدة', 'الإجمالي'],
        rows.map(function (r) { return [r.name, r.sku, fmtNum(r.qty), r.unit || '', fmtNum(r.total)]; }));
    });
  }

  // ============ تقرير 3: النواقص (المطلوب مقابل المستلم) ============
  function renderShortageTab(body) {
    body.innerHTML =
      filtersBarHtml({ withBranch: true, fromId: 'rp-s-from', toId: 'rp-s-to', branchId: 'rp-s-branch', btnId: 'rp-s-go' }) +
      '<div id="rp-s-result" class="rp-result"></div>';
    document.getElementById('rp-s-go').addEventListener('click', loadShortageReport);
    if (!lockedBranch) { if (!branchNames.length) loadBranchNamesInto('rp-s-branch'); else fillBranchSelect('rp-s-branch'); }
  }

  function loadBranchNamesInto(selectId) {
    sb('branch_orders?select=branch_name').then(function (rows) {
      var set = {};
      (rows || []).forEach(function (r) { if (r.branch_name) set[r.branch_name] = true; });
      branchNames = Object.keys(set).sort();
      fillBranchSelect(selectId);
    }).catch(function (e) { console.error(e); });
  }
  function fillBranchSelect(selectId) {
    var sel = document.getElementById(selectId);
    if (sel) sel.innerHTML = '<option value="">كل الفروع</option>' + branchNames.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join('');
  }

  function loadShortageReport() {
    var resultEl = document.getElementById('rp-s-result');
    var branch = readBranchFilter('rp-s-branch');
    var from = document.getElementById('rp-s-from').value;
    var to = document.getElementById('rp-s-to').value;
    resultEl.innerHTML = '<div class="rp-loading">⏳ جاري التحميل...</div>';

    var path = 'branch_order_receipts?select=branch,sku,product_name,qty_ordered,qty_received,unit,created_at&created_at=gte.' + from + '&created_at=lte.' + to + 'T23:59:59';
    if (branch) path += '&branch=eq.' + encodeURIComponent(branch);

    sb(path).then(function (rows0) {
      if (!rows0 || !rows0.length) { resultEl.innerHTML = '<div class="rp-empty">لا توجد بيانات استلام في هذه الفترة</div>'; return; }
      var agg = {};
      rows0.forEach(function (r) {
        var key = (r.branch || '') + '|' + (r.sku || r.product_name);
        if (!agg[key]) agg[key] = { branch: r.branch, name: r.product_name, sku: r.sku, unit: r.unit, ordered: 0, received: 0 };
        agg[key].ordered += parseFloat(r.qty_ordered) || 0;
        agg[key].received += parseFloat(r.qty_received) || 0;
      });
      var rows = Object.values(agg).map(function (r) { r.diff = r.ordered - r.received; return r; })
        .filter(function (r) { return r.diff > 0.001; })
        .sort(function (a, b) { return b.diff - a.diff; });
      renderShortageResult(resultEl, rows, branch, from, to);
    }).catch(function (e) {
      resultEl.innerHTML = '<div class="rp-empty rp-error">⚠️ تعذر تحميل التقرير</div>';
      console.error(e);
    });
  }

  function renderShortageResult(el, rows, branch, from, to) {
    if (!rows.length) { el.innerHTML = '<div class="rp-empty">✅ مفيش نواقص مسجلة في الفترة دي — كل حاجة اتوصلت كاملة</div>'; return; }
    var tableRows = rows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.sku) + '</td><td>' + esc(r.branch) + '</td><td>' + fmtNum(r.ordered) + '</td><td>' + fmtNum(r.received) + '</td><td class="rp-shortage">' + fmtNum(r.diff) + ' ' + esc(r.unit || '') + '</td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="rp-summary">⚠️ ' + rows.length + ' صنف عليه نقص' + (branch ? ' — ' + esc(branch) : '') + ' — من ' + from + ' إلى ' + to + '</div>' +
      '<button class="rp-btn" id="rp-s-export">📥 تصدير CSV</button>' +
      '<table class="rp-table"><thead><tr><th>الصنف</th><th>SKU</th><th>الفرع</th><th>المطلوب</th><th>المستلم</th><th>النقص</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
    document.getElementById('rp-s-export').addEventListener('click', function () {
      logExport('النواقص', 'تقرير_النواقص_' + (branch || 'كل_الفروع') + '_' + from + '_' + to + '.csv');
      downloadCSV('تقرير_النواقص_' + (branch || 'كل_الفروع') + '_' + from + '_' + to + '.csv',
        ['الصنف', 'SKU', 'الفرع', 'المطلوب', 'المستلم', 'النقص', 'الوحدة'],
        rows.map(function (r) { return [r.name, r.sku, r.branch, fmtNum(r.ordered), fmtNum(r.received), fmtNum(r.diff), r.unit || '']; }));
    });
  }

  // ============ تقرير 4: الأكثر طلبًا ============
  function renderTopItemsTab(body) {
    body.innerHTML =
      filtersBarHtml({ withBranch: false, fromId: 'rp-t-from', toId: 'rp-t-to', btnId: 'rp-t-go' }) +
      '<div class="rp-filters" style="margin-top:-6px">' +
      '  <label class="rp-flabel"><input type="radio" name="rp-t-sort" value="qty" checked> ترتيب بالكمية</label>' +
      '  <label class="rp-flabel"><input type="radio" name="rp-t-sort" value="count"> ترتيب بعدد مرات الطلب</label>' +
      '</div>' +
      '<div id="rp-t-result" class="rp-result"></div>';
    document.getElementById('rp-t-go').addEventListener('click', loadTopItemsReport);
  }

  function loadTopItemsReport() {
    var resultEl = document.getElementById('rp-t-result');
    var from = document.getElementById('rp-t-from').value;
    var to = document.getElementById('rp-t-to').value;
    var sortBy = document.querySelector('input[name="rp-t-sort"]:checked').value;
    resultEl.innerHTML = '<div class="rp-loading">⏳ جاري التحميل...</div>';

    var path = 'branch_orders?select=id,created_at&created_at=gte.' + from + '&created_at=lte.' + to + 'T23:59:59';
    sb(path).then(function (orders) {
      if (!orders || !orders.length) { resultEl.innerHTML = '<div class="rp-empty">لا توجد طلبيات في هذه الفترة</div>'; return null; }
      var ids = orders.map(function (o) { return o.id; });
      return sb('branch_order_items?select=sku,product_name,quantity,unit,order_id&order_id=in.(' + ids.join(',') + ')').then(function (items) {
        var agg = {};
        (items || []).forEach(function (it) {
          var key = it.sku || it.product_name;
          if (!agg[key]) agg[key] = { name: it.product_name, sku: it.sku, unit: it.unit, qty: 0, orders: {} };
          agg[key].qty += parseFloat(it.quantity) || 0;
          agg[key].orders[it.order_id] = true;
        });
        var rows = Object.values(agg).map(function (r) { r.count = Object.keys(r.orders).length; return r; });
        rows.sort(function (a, b) { return sortBy === 'count' ? b.count - a.count : b.qty - a.qty; });
        rows = rows.slice(0, 30);
        renderTopItemsResult(resultEl, rows, from, to, sortBy);
      });
    }).catch(function (e) {
      resultEl.innerHTML = '<div class="rp-empty rp-error">⚠️ تعذر تحميل التقرير</div>';
      console.error(e);
    });
  }

  function renderTopItemsResult(el, rows, from, to, sortBy) {
    var tableRows = rows.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.sku) + '</td><td>' + fmtNum(r.qty) + ' ' + esc(r.unit || '') + '</td><td>' + r.count + '</td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="rp-summary">🔥 أعلى ' + rows.length + ' صنف — من ' + from + ' إلى ' + to + ' (' + (sortBy === 'count' ? 'بعدد مرات الطلب' : 'بالكمية') + ')</div>' +
      '<button class="rp-btn" id="rp-t-export">📥 تصدير CSV</button>' +
      '<table class="rp-table"><thead><tr><th>#</th><th>الصنف</th><th>SKU</th><th>الكمية الإجمالية</th><th>عدد مرات الطلب</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
    document.getElementById('rp-t-export').addEventListener('click', function () {
      logExport('الأكثر طلبًا', 'تقرير_الأكثر_طلبًا_' + from + '_' + to + '.csv');
      downloadCSV('تقرير_الأكثر_طلبًا_' + from + '_' + to + '.csv',
        ['الترتيب', 'الصنف', 'SKU', 'الكمية الإجمالية', 'الوحدة', 'عدد مرات الطلب'],
        rows.map(function (r, i) { return [i + 1, r.name, r.sku, fmtNum(r.qty), r.unit || '', r.count]; }));
    });
  }

  // ============ تقرير 5: تغيّر التكلفة (تسعير) ============
  // بيقرا من pricing_requests_v3 — نفس الجدول اللي شاشة "تسعير" بتسجّل فيه
  // كل مرة التكلفة الجديدة (وقت الاستلام) تختلف عن آخر تكلفة مسجلة (old_cost
  // مقابل new_cost)، مع received_by (اللي استلم/أدخل التكلفة الجديدة).
  function renderPricingTab(body) {
    body.innerHTML =
      '<div class="rp-filters">' +
      '  <label class="rp-flabel">من <input type="date" class="rp-input" id="rp-pr-from" value="' + daysAgoStr(30) + '"></label>' +
      '  <label class="rp-flabel">إلى <input type="date" class="rp-input" id="rp-pr-to" value="' + todayStr() + '"></label>' +
      '  <select class="rp-select" id="rp-pr-dir">' +
      '    <option value="all">الكل (زيادة ونقص)</option>' +
      '    <option value="up">زيادة في التكلفة فقط</option>' +
      '    <option value="down">نقص في التكلفة فقط</option>' +
      '  </select>' +
      '  <button class="rp-btn rp-btn-primary" id="rp-pr-go">📊 عرض التقرير</button>' +
      '</div>' +
      '<div id="rp-pr-result" class="rp-result"></div>';
    document.getElementById('rp-pr-go').addEventListener('click', loadPricingReport);
  }

  function loadPricingReport() {
    var resultEl = document.getElementById('rp-pr-result');
    var from = document.getElementById('rp-pr-from').value;
    var to = document.getElementById('rp-pr-to').value;
    var dir = document.getElementById('rp-pr-dir').value;
    resultEl.innerHTML = '<div class="rp-loading">⏳ جاري التحميل...</div>';

    var path = 'pricing_requests_v3?select=sku,product_name,unit,old_cost,new_cost,supplier_name,po_number,received_by,created_at' +
      '&cost_changed=eq.true&created_at=gte.' + from + '&created_at=lte.' + to + 'T23:59:59&order=created_at.desc';

    sb(path).then(function (rows0) {
      var rows = (rows0 || []).map(function (r) {
        var oldC = parseFloat(r.old_cost) || 0;
        var newC = parseFloat(r.new_cost) || 0;
        r.delta = newC - oldC;
        r.pct = oldC > 0 ? (r.delta / oldC * 100) : null;
        return r;
      }).filter(function (r) {
        if (dir === 'up') return r.delta > 0;
        if (dir === 'down') return r.delta < 0;
        return r.delta !== 0;
      }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });

      if (!rows.length) { resultEl.innerHTML = '<div class="rp-empty">لا يوجد تغيّر في التكلفة مسجل في هذه الفترة</div>'; return; }
      renderPricingResult(resultEl, rows, from, to);
    }).catch(function (e) {
      resultEl.innerHTML = '<div class="rp-empty rp-error">⚠️ تعذر تحميل التقرير</div>';
      console.error(e);
    });
  }

  function renderPricingResult(el, rows, from, to) {
    var upCount = rows.filter(function (r) { return r.delta > 0; }).length;
    var downCount = rows.filter(function (r) { return r.delta < 0; }).length;
    var tableRows = rows.map(function (r) {
      var cls = r.delta > 0 ? 'rp-cost-up' : 'rp-cost-down';
      var arrow = r.delta > 0 ? '▲' : '▼';
      var pctText = r.pct == null ? '—' : (r.pct > 0 ? '+' : '') + fmtNum(r.pct) + '%';
      return '<tr>' +
        '<td>' + esc(r.product_name) + '</td><td>' + esc(r.sku) + '</td>' +
        '<td>' + esc(r.supplier_name || '—') + '</td><td>' + esc(r.received_by || '—') + '</td>' +
        '<td>' + fmtNum(r.old_cost) + '</td><td>' + fmtNum(r.new_cost) + '</td>' +
        '<td class="' + cls + '">' + arrow + ' ' + fmtNum(Math.abs(r.delta)) + '</td>' +
        '<td class="' + cls + '">' + pctText + '</td>' +
        '<td>' + new Date(r.created_at).toLocaleDateString('ar-EG') + '</td>' +
        '</tr>';
    }).join('');
    el.innerHTML =
      '<div class="rp-summary">💰 ' + rows.length + ' صنف تغيّرت تكلفته — ▲ ' + upCount + ' زيادة، ▼ ' + downCount + ' نقص — من ' + from + ' إلى ' + to + '</div>' +
      '<button class="rp-btn" id="rp-pr-export">📥 تصدير CSV</button>' +
      '<table class="rp-table"><thead><tr><th>الصنف</th><th>SKU</th><th>المورد</th><th>من استلم/سعّر</th><th>التكلفة القديمة</th><th>التكلفة الجديدة</th><th>الفرق</th><th>%</th><th>التاريخ</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
    document.getElementById('rp-pr-export').addEventListener('click', function () {
      logExport('تغيّر التكلفة', 'تقرير_تغيّر_التكلفة_' + from + '_' + to + '.csv');
      downloadCSV('تقرير_تغيّر_التكلفة_' + from + '_' + to + '.csv',
        ['الصنف', 'SKU', 'المورد', 'من استلم/سعّر', 'التكلفة القديمة', 'التكلفة الجديدة', 'الفرق', 'النسبة %', 'التاريخ'],
        rows.map(function (r) { return [r.product_name, r.sku, r.supplier_name || '', r.received_by || '', fmtNum(r.old_cost), fmtNum(r.new_cost), fmtNum(r.delta), r.pct == null ? '' : fmtNum(r.pct), new Date(r.created_at).toLocaleDateString('ar-EG')]; }));
    });
  }

  function mount(container) {
    activeTab = 'branch';
    branchNames = [];
    purchaseBranchNames = [];
    var user = window.BARQ_AUTH && BARQ_AUTH.getCurrentUser();
    lockedBranch = (user && user.role === 'manager' && user.branch) ? user.branch : null;
    container.innerHTML = '<div class="rp-mod"><div id="rp-root"></div></div>';
    renderShell();
  }

  return { mount: mount, setTab: setTab };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['reports'] = { mount: BARQ_REPORTS.mount };

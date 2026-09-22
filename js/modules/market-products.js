// ============================================================
// برق — موديول "إدارة منتجات الكاشير" (لوحة تحكم إدارية، جديد بالكامل)
// ده المصدر المركزي الوحيد لتعديل كتالوج السوق (dc_products) وأقسامه
// (sku_departments) — شاشة البيع (touch-print-market.html) بتقرا منهم
// بس، ومفيهاش أي تعديل بنفسها. أي إضافة/تعديل/حذف لازم يحصل من هنا،
// عشان كل الأجهزة والشاشات تفضل متزامنة على نفس المصدر.
// ============================================================

var BARQ_MARKET_PRODUCTS = (function () {
  var rows = [];
  var departments = [];
  var search = '';
  var deptFilter = '';
  var loading = false;
  var PAGE_SIZE = 100;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('ar-EG'); }

  function loadDepartments() {
    return sb('sku_departments?select=department').then(function (r) {
      var set = {};
      (r || []).forEach(function (x) { if (x.department) set[x.department] = true; });
      departments = Object.keys(set).sort();
    }).catch(function (e) { console.error(e); });
  }

  function loadProducts() {
    loading = true;
    render();
    var path = 'dc_products?select=sku,name,barcode,price,is_active&order=name.asc&limit=' + PAGE_SIZE;
    if (search) path += '&name=ilike.*' + encodeURIComponent(search) + '*';
    return sb(path).then(function (products) {
      var skus = products.map(function (p) { return "'" + p.sku.replace(/'/g, "''") + "'"; });
      if (!skus.length) { rows = []; loading = false; render(); return; }
      return sb('sku_departments?select=sku,department&sku=in.(' + skus.join(',') + ')').then(function (deptRows) {
        var deptBySku = {};
        (deptRows || []).forEach(function (d) { deptBySku[d.sku] = d.department; });
        rows = products.map(function (p) {
          p.department = deptBySku[p.sku] || null;
          return p;
        });
        if (deptFilter) rows = rows.filter(function (r) { return r.department === deptFilter; });
        loading = false;
        render();
      });
    }).catch(function (e) {
      console.error(e);
      loading = false;
      render();
    });
  }

  function renderShell() {
    var root = document.getElementById('mp-root');
    if (!root) return;
    var deptOptions = '<option value="">كل الأقسام</option>' + departments.map(function (d) { return '<option value="' + esc(d) + '"' + (d === deptFilter ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('');
    root.innerHTML =
      '<div class="mp-header"><h2>🏪 إدارة منتجات الكاشير</h2><p class="mp-sub">المصدر المركزي لكتالوج شاشة البيع — أي تعديل هنا بيظهر تلقائي في كل شاشات الكاشير.</p></div>' +
      '<div class="mp-filters">' +
      '<input class="mp-input" id="mp-search" placeholder="🔍 دور بالاسم..." value="' + esc(search) + '">' +
      '<select class="mp-select" id="mp-dept">' + deptOptions + '</select>' +
      '<button class="mp-btn mp-btn-primary" id="mp-add">➕ إضافة منتج</button>' +
      '</div>' +
      '<div id="mp-table-wrap"></div>' +
      '<div class="mp-modal-overlay" id="mp-overlay"><div class="mp-modal" id="mp-modal-content"></div></div>';

    document.getElementById('mp-search').addEventListener('input', debounce(function (e) { search = e.target.value.trim(); loadProducts(); }, 400));
    document.getElementById('mp-dept').addEventListener('change', function (e) { deptFilter = e.target.value; loadProducts(); });
    document.getElementById('mp-add').addEventListener('click', function () { openProductModal(null); });
    document.getElementById('mp-overlay').addEventListener('click', function (e) { if (e.target.id === 'mp-overlay') closeModal(); });

    renderTable();
  }

  var debounceTimer;
  function debounce(fn, ms) {
    return function () {
      var args = arguments;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function renderTable() {
    var wrap = document.getElementById('mp-table-wrap');
    if (!wrap) return;
    if (loading) { wrap.innerHTML = '<div class="mp-loading">⏳ جاري التحميل...</div>'; return; }
    if (!rows.length) { wrap.innerHTML = '<div class="mp-empty">لا توجد منتجات مطابقة</div>'; return; }
    var body = rows.map(function (r) {
      return '<tr' + (r.is_active === false ? ' style="opacity:.5"' : '') + '>' +
        '<td><div class="mp-name">' + esc(r.name) + (r.is_active === false ? ' <span class="mp-chip mp-chip-bad">معطّل</span>' : '') + '</div><div class="mp-sku">' + esc(r.sku) + (r.barcode ? ' · ' + esc(r.barcode) : '') + '</div></td>' +
        '<td class="num-col num">' + fmt(r.price) + ' ج.م</td>' +
        '<td>' + (r.department ? '<span class="mp-chip mp-chip-info">' + esc(r.department) + '</span>' : '<span class="mp-chip">بدون قسم</span>') + '</td>' +
        '<td><button class="mp-btn-sm" data-sku="' + esc(r.sku) + '" data-act="edit">✏️ تعديل</button> ' +
        '<button class="mp-btn-sm mp-btn-danger" data-sku="' + esc(r.sku) + '" data-act="toggle">' + (r.is_active === false ? '↩️ تفعيل' : '🚫 تعطيل') + '</button></td>' +
        '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="mp-table"><thead><tr><th>الصنف</th><th class="num-col">السعر</th><th>القسم</th><th>إجراءات</th></tr></thead><tbody>' + body + '</tbody></table>' +
      (rows.length >= PAGE_SIZE ? '<div class="mp-hint">بيعرض أول ' + PAGE_SIZE + ' نتيجة — ضيّق بالبحث لو مش لاقي اللي عايزه</div>' : '');

    wrap.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sku = btn.getAttribute('data-sku');
        var row = rows.find(function (r) { return r.sku === sku; });
        if (btn.getAttribute('data-act') === 'edit') openProductModal(row);
        else toggleActive(row);
      });
    });
  }

  function toggleActive(row) {
    var newVal = row.is_active === false ? true : false;
    if (!confirm((newVal ? 'تفعيل' : 'تعطيل') + ' "' + row.name + '"؟' + (newVal ? '' : ' هيختفي من شاشة البيع فورًا.'))) return;
    sb('dc_products?sku=eq.' + encodeURIComponent(row.sku), {
      method: 'PATCH',
      body: JSON.stringify({ is_active: newVal })
    }).then(function () { loadProducts(); }).catch(function (e) {
      console.error(e); alert('حصل خطأ، حاول تاني');
    });
  }

  function openProductModal(row) {
    var isEdit = !!row;
    var deptOptions = '<option value="">— بدون قسم —</option>' + departments.map(function (d) {
      return '<option value="' + esc(d) + '"' + (row && row.department === d ? ' selected' : '') + '>' + esc(d) + '</option>';
    }).join('');
    document.getElementById('mp-modal-content').innerHTML =
      '<h3>' + (isEdit ? '✏️ تعديل منتج' : '➕ إضافة منتج جديد') + '</h3>' +
      '<label class="mp-flabel">اسم الصنف<input type="text" id="mpf-name" class="mp-input" value="' + esc(row ? row.name : '') + '"></label>' +
      '<label class="mp-flabel">الباركود<input type="text" id="mpf-barcode" class="mp-input" value="' + esc(row ? row.barcode || '' : '') + '"></label>' +
      '<label class="mp-flabel">SKU' + (isEdit ? '' : ' (اختياري — لو فاضي هيتولّد تلقائي)') + '<input type="text" id="mpf-sku" class="mp-input" value="' + esc(row ? row.sku : '') + '" ' + (isEdit ? 'readonly' : '') + '></label>' +
      '<label class="mp-flabel">السعر<input type="number" step="0.01" id="mpf-price" class="mp-input" value="' + (row ? row.price : '') + '"></label>' +
      '<label class="mp-flabel">القسم<select id="mpf-dept" class="mp-select" style="width:100%">' + deptOptions + '</select></label>' +
      '<div class="mp-modal-actions">' +
      '<button class="mp-btn" id="mp-cancel">إلغاء</button>' +
      '<button class="mp-btn mp-btn-primary" id="mp-save">💾 حفظ</button>' +
      '</div>';
    document.getElementById('mp-overlay').classList.add('open');
    document.getElementById('mp-cancel').addEventListener('click', closeModal);
    document.getElementById('mp-save').addEventListener('click', function () { saveProduct(row); });
  }

  function closeModal() {
    document.getElementById('mp-overlay').classList.remove('open');
  }

  function saveProduct(existing) {
    var name = document.getElementById('mpf-name').value.trim();
    var barcode = document.getElementById('mpf-barcode').value.trim();
    var sku = document.getElementById('mpf-sku').value.trim() || (existing ? existing.sku : ('local-' + Date.now()));
    var price = parseFloat(document.getElementById('mpf-price').value) || 0;
    var department = document.getElementById('mpf-dept').value || null;
    if (!name) { alert('لازم اسم الصنف'); return; }

    var row = { sku: sku, name: name, barcode: barcode || null, price: price, is_active: true };
    sb('dc_products', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row)
    }).then(function () {
      if (department) {
        return sb('sku_departments', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ sku: sku, department: department })
        });
      } else if (existing && existing.department) {
        // شال القسم عن صنف كان ليه قسم قبل كده
        return sb('sku_departments?sku=eq.' + encodeURIComponent(sku), { method: 'DELETE' });
      }
    }).then(function () {
      closeModal();
      loadProducts();
    }).catch(function (e) {
      console.error(e);
      alert('حصل خطأ وإحنا بنحفظ — اتأكد من الاتصال وحاول تاني');
    });
  }

  function render() {
    renderShell();
  }

  function mount(container) {
    search = ''; deptFilter = ''; rows = [];
    container.innerHTML = '<div class="mp-mod"><div id="mp-root"></div></div>';
    loadDepartments().then(loadProducts);
  }

  return { mount: mount };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['market-products'] = { mount: BARQ_MARKET_PRODUCTS.mount };

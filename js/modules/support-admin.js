// ============================================================
// برق — موديول "بلاغات المستخدمين" (لوحة الأدمن)
// موديول جديد بالكامل. بيقرأ من جدول support_reports في نفس مشروع
// Supabase المستخدم في باقي التطبيق (عبر sb() من supabase-client.js).
// مفيش رد داخل التطبيق — الأدمن يشوف البلاغ وبيرد بره (واتساب/مكالمة)،
// وبس بيعلّم البلاغ كمقروء/متعامل معاه هنا.
// ============================================================

var BARQ_SUPPORT = (function () {
  var reports = [];
  var loading = true;
  var loadError = '';
  var filter = 'open'; // open | done | all

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function timeAgo(iso) {
    var d = new Date(iso);
    return d.toLocaleString('ar-EG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    var root = document.getElementById('support-root');
    if (!root) return;

    var visible = reports.filter(function (r) {
      if (filter === 'open') return r.status !== 'done';
      if (filter === 'done') return r.status === 'done';
      return true;
    });

    var openCount = reports.filter(function (r) { return r.status !== 'done'; }).length;

    var rowsHtml = visible.map(function (r) {
      var isNew = r.status === 'new';
      return '' +
        '<div class="sup-card ' + (r.status === 'done' ? 'sup-done' : '') + '">' +
        '  <div class="sup-card-top">' +
        '    <div class="sup-meta">' +
        '      <span class="sup-user">👤 ' + esc(r.username || '—') + '</span>' +
        (r.role_label ? '<span class="sup-role">' + esc(r.role_label) + '</span>' : '') +
        (r.branch ? '<span class="sup-branch">🏪 ' + esc(r.branch) + '</span>' : '') +
        (r.section ? '<span class="sup-section">📍 ' + esc(r.section) + '</span>' : '') +
        '    </div>' +
        '    <span class="sup-time">' + timeAgo(r.created_at) + '</span>' +
        '  </div>' +
        '  <div class="sup-msg">' + esc(r.message).replace(/\n/g, '<br>') + '</div>' +
        '  <div class="sup-actions">' +
        (isNew ? '<button class="sup-btn" onclick="BARQ_SUPPORT.setStatus(' + r.id + ',\'seen\')">✓ اتشاف</button>' : '') +
        (r.status !== 'done' ? '<button class="sup-btn sup-btn-primary" onclick="BARQ_SUPPORT.setStatus(' + r.id + ',\'done\')">✅ اتعمل فيه اللازم</button>' : '<span class="sup-done-label">✅ اتعمل فيه اللازم</span>') +
        '    <button class="sup-btn sup-btn-danger" onclick="BARQ_SUPPORT.remove(' + r.id + ')">حذف</button>' +
        '  </div>' +
        '</div>';
    }).join('');

    root.innerHTML =
      '<div class="sup-header">' +
      '  <div>' +
      '    <h2>🆘 بلاغات المستخدمين</h2>' +
      '    <p class="sup-sub">أي بلاغ بيبعته أي مستخدم من أي شاشة في التطبيق بيظهر هنا. الرد بيكون بره التطبيق (واتساب/مكالمة).</p>' +
      '  </div>' +
      '  <button class="sup-btn" onclick="BARQ_SUPPORT.reload()">🔄 تحديث</button>' +
      '</div>' +
      '<div class="sup-filters">' +
      '  <button class="sup-filter ' + (filter === 'open' ? 'active' : '') + '" onclick="BARQ_SUPPORT.setFilter(\'open\')">مفتوحة (' + openCount + ')</button>' +
      '  <button class="sup-filter ' + (filter === 'done' ? 'active' : '') + '" onclick="BARQ_SUPPORT.setFilter(\'done\')">اتعمل فيها اللازم</button>' +
      '  <button class="sup-filter ' + (filter === 'all' ? 'active' : '') + '" onclick="BARQ_SUPPORT.setFilter(\'all\')">الكل</button>' +
      '</div>' +
      (loading ? '<div class="sup-empty">⏳ جاري التحميل...</div>' :
        loadError ? '<div class="sup-empty sup-error">⚠️ ' + esc(loadError) + '</div>' :
        (visible.length ? rowsHtml : '<div class="sup-empty">لا توجد بلاغات هنا حاليًا 🎉</div>'));
  }

  function load() {
    loading = true;
    loadError = '';
    render();
    sb('support_reports?select=*&order=created_at.desc')
      .then(function (rows) {
        reports = rows || [];
        loading = false;
        render();
      })
      .catch(function (e) {
        loading = false;
        loadError = 'تعذر تحميل البلاغات — تأكد من الاتصال';
        render();
        console.error(e);
      });
  }

  function reload() { load(); }

  function setFilter(f) { filter = f; render(); }

  function setStatus(id, status) {
    sb('support_reports?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: status }) })
      .then(function () {
        var r = reports.find(function (x) { return x.id === id; });
        if (r) r.status = status;
        render();
      })
      .catch(function (e) { alert('تعذر التحديث'); console.error(e); });
  }

  function remove(id) {
    if (!confirm('تأكيد حذف البلاغ؟')) return;
    sb('support_reports?id=eq.' + id, { method: 'DELETE' })
      .then(function () {
        reports = reports.filter(function (x) { return x.id !== id; });
        render();
      })
      .catch(function (e) { alert('تعذر الحذف'); console.error(e); });
  }

  function mount(container) {
    filter = 'open';
    container.innerHTML = '<div class="sup-mod"><div id="support-root"></div></div>';
    load();
  }

  return {
    mount: mount,
    reload: reload,
    setFilter: setFilter,
    setStatus: setStatus,
    remove: remove
  };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['support-admin'] = { mount: BARQ_SUPPORT.mount };

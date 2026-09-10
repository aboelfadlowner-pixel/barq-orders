// ============================================================
// برق — موديول "المستخدمين والصلاحيات" (Access List)
// موديول جديد بالكامل (مش منقول من أي ملف قديم) — شاشة إدارة بسيطة
// لإضافة/تعديل/حذف المستخدمين، كل مستخدم بياخد صلاحياته من الدور
// المرتبط بيه (BARQ_AUTH.ROLES) تلقائيًا وقت الدخول.
// ============================================================

var BARQ_ACCESS = (function () {
  var editingUsername = null; // لو مفتوح فورم تعديل مستخدم معيّن
  var showAddForm = false;
  var formError = '';
  var users = []; // آخر نسخة محمّلة من app_users — بتتحدّث بعد أي إضافة/تعديل/حذف
  var loading = true;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function roleOptionsHtml(selected) {
    return BARQ_AUTH.rolesList().map(function (r) {
      return '<option value="' + r.key + '" ' + (r.key === selected ? 'selected' : '') + '>' + r.icon + ' ' + esc(r.label) + '</option>';
    }).join('');
  }

  function loadUsers() {
    loading = true;
    render();
    return BARQ_AUTH.listUsers().then(function (rows) {
      users = rows || [];
      loading = false;
      render();
    }).catch(function (e) {
      loading = false;
      formError = 'تعذر تحميل المستخدمين — تأكد من الاتصال بالإنترنت';
      render();
      console.error(e);
    });
  }

  function render() {
    var root = document.getElementById('access-root');
    if (!root) return;

    if (loading) { root.innerHTML = '<div class="al-empty">⏳ جاري التحميل...</div>'; return; }

    var rolesByKey = {};
    BARQ_AUTH.rolesList().forEach(function (r) { rolesByKey[r.key] = r; });

    var rows = users.map(function (u) {
      var role = rolesByKey[u.role] || { label: u.role, icon: '❓' };
      var isEditing = editingUsername === u.username;
      if (isEditing) {
        return '' +
          '<tr class="al-row al-editing">' +
          '  <td>' + esc(u.username) + '</td>' +
          '  <td><select class="al-select" id="al-edit-role">' + roleOptionsHtml(u.role) + '</select></td>' +
          '  <td><input class="al-input" type="text" id="al-edit-branch" placeholder="اسم الفرع (لو دوره مدير فرع)" value="' + esc(u.branch || '') + '"></td>' +
          '  <td><input class="al-input" type="password" id="al-edit-pass" placeholder="سيبها فاضية لو مش هتغيّرها"></td>' +
          '  <td><label class="al-switch"><input type="checkbox" id="al-edit-active" ' + (u.active ? 'checked' : '') + '> نشط</label></td>' +
          '  <td class="al-actions">' +
          '    <button class="al-btn al-btn-primary" onclick="BARQ_ACCESS.saveEdit(\'' + esc(u.username) + '\')">حفظ</button>' +
          '    <button class="al-btn" onclick="BARQ_ACCESS.cancelEdit()">إلغاء</button>' +
          '  </td>' +
          '</tr>';
      }
      return '' +
        '<tr class="al-row">' +
        '  <td>' + esc(u.username) + '</td>' +
        '  <td><span class="al-role-chip">' + role.icon + ' ' + esc(u.label || role.label) + '</span></td>' +
        '  <td>' + (u.branch ? esc(u.branch) : '—') + '</td>' +
        '  <td><span class="al-status ' + (u.active ? 'al-status-on' : 'al-status-off') + '">' + (u.active ? '● نشط' : '● موقوف') + '</span></td>' +
        '  <td class="al-actions">' +
        '    <button class="al-btn" onclick="BARQ_ACCESS.startEdit(\'' + esc(u.username) + '\')">تعديل</button>' +
        '    <button class="al-btn al-btn-danger" onclick="BARQ_ACCESS.remove(\'' + esc(u.username) + '\')">حذف</button>' +
        '  </td>' +
        '</tr>';
    }).join('');

    var addFormHtml = !showAddForm ? '' : (
      '<div class="al-card al-add-card">' +
      '  <h3>مستخدم جديد</h3>' +
      '  <div class="al-add-grid">' +
      '    <input class="al-input" type="text" id="al-new-username" placeholder="اسم المستخدم" autocomplete="off">' +
      '    <input class="al-input" type="password" id="al-new-password" placeholder="كلمة السر" autocomplete="new-password">' +
      '    <input class="al-input" type="text" id="al-new-label" placeholder="اسم ظاهر (اختياري)">' +
      '    <select class="al-select" id="al-new-role">' + roleOptionsHtml(null) + '</select>' +
      '    <input class="al-input" type="text" id="al-new-branch" placeholder="اسم الفرع (لو دوره مدير فرع)">' +
      '  </div>' +
      '  <div class="al-add-actions">' +
      '    <button class="al-btn al-btn-primary" onclick="BARQ_ACCESS.submitAdd()">إضافة المستخدم</button>' +
      '    <button class="al-btn" onclick="BARQ_ACCESS.toggleAddForm()">إلغاء</button>' +
      '  </div>' +
      (formError ? '<div class="al-error">' + esc(formError) + '</div>' : '') +
      '</div>'
    );

    root.innerHTML =
      '<div class="al-header">' +
      '  <div>' +
      '    <h2>👥 المستخدمين والصلاحيات</h2>' +
      '    <p class="al-sub">كل مستخدم بياخد أقسام القائمة الجانبية والصلاحيات تلقائيًا حسب الدور المرتبط بحسابه.</p>' +
      '  </div>' +
      '  <button class="al-btn al-btn-primary" onclick="BARQ_ACCESS.toggleAddForm()">' + (showAddForm ? '✕ إغلاق' : '+ مستخدم جديد') + '</button>' +
      '</div>' +
      addFormHtml +
      '<div class="al-card">' +
      '  <table class="al-table">' +
      '    <thead><tr><th>اسم المستخدم</th><th>الدور</th><th>الفرع</th><th>الحالة</th><th></th></tr></thead>' +
      '    <tbody>' + (rows || '<tr><td colspan="5" class="al-empty">مفيش مستخدمين</td></tr>') + '</tbody>' +
      '  </table>' +
      '</div>';
  }

  function toggleAddForm() {
    showAddForm = !showAddForm;
    formError = '';
    render();
  }

  function submitAdd() {
    var username = document.getElementById('al-new-username').value;
    var password = document.getElementById('al-new-password').value;
    var label = document.getElementById('al-new-label').value;
    var role = document.getElementById('al-new-role').value;
    var branch = document.getElementById('al-new-branch').value;
    BARQ_AUTH.addUser({ username: username, password: password, label: label, role: role, branch: branch }).then(function (res) {
      if (!res.ok) { formError = res.error; render(); return; }
      showAddForm = false;
      formError = '';
      loadUsers();
    });
  }

  function startEdit(username) {
    editingUsername = username;
    formError = '';
    render();
  }

  function cancelEdit() {
    editingUsername = null;
    render();
  }

  function saveEdit(username) {
    var role = document.getElementById('al-edit-role').value;
    var branch = document.getElementById('al-edit-branch').value;
    var password = document.getElementById('al-edit-pass').value;
    var active = document.getElementById('al-edit-active').checked;
    var changes = { role: role, active: active, branch: branch };
    if (password) changes.password = password;
    BARQ_AUTH.updateUser(username, changes).then(function (res) {
      if (!res.ok) { formError = res.error; render(); return; }
      editingUsername = null;
      loadUsers();
    });
  }

  function remove(username) {
    if (!confirm('تأكيد حذف المستخدم "' + username + '"؟')) return;
    BARQ_AUTH.deleteUser(username).then(function (res) {
      if (!res.ok) { alert(res.error); return; }
      loadUsers();
    });
  }

  function mount(container) {
    editingUsername = null;
    showAddForm = false;
    formError = '';
    users = [];
    container.innerHTML = '<div class="al-mod"><div id="access-root"></div></div>';
    loadUsers();
  }

  return {
    mount: mount,
    toggleAddForm: toggleAddForm,
    submitAdd: submitAdd,
    startEdit: startEdit,
    cancelEdit: cancelEdit,
    saveEdit: saveEdit,
    remove: remove
  };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['access-list'] = { mount: BARQ_ACCESS.mount };

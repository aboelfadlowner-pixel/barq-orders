// ============================================================
// برق — موديول "المشتريات والمخزون"
// منقول من makhzoun_v2.html بنفس المنطق حرفيًا (لوحة التحكم، قرارات
// الطلب، كل الأصناف، إعدادات التصنيف، السجل، تحليل ذكي، الموردين،
// أوامر الشراء) — بما فيها مصدر بيانات المخزون (مزامنة تلقائية من
// الداتا سنتر عبر Supabase، بدون رفع يدوي هنا — ده مختلف عن باقي
// الموديولات اللي بيها رفع يدوي، ومتقصود إنه يفضل كده).
// الملف الأصلي مكانش فيه أي تسجيل دخول، فمفيش جسر مع BARQ_AUTH.
// التعديلات الوحيدة: (1) IIFE باسم BARQ_MK، (2) تأجيل ربط مستمعي
// إغلاق النوافذ المنبثقة واستدعاء renderHistory() اليتيم وسلسلة تهيئة
// البيانات (IndexedDB/Supabase) من وقت تحميل السكريبت إلى mount().
// ============================================================

var BARQ_MK_MARKUP = "<div class=\"mk-mod\">\n<div class=\"header header--slim\">\n  <div class=\"header-stats\">\n    <div>تاريخ اليوم: <strong id=\"todayDate\">١٢‏/٦‏/٢٠٢٦</strong></div>\n    <div>آخر رفع: <strong id=\"lastUpload\">لم يتم الرفع بعد</strong></div>\n    <div style=\"display:flex;gap:8px;align-items:center\">\n    <span id=\"saveStatus\" style=\"font-size:12px;color:var(--accent);display:none\">✅ محفوظ</span>\n    <button onclick=\"BARQ_MK.exportBackup()\" style=\"padding:7px 16px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer\">📤 تصدير نسخة</button>\n    <button onclick=\"document.getElementById('importFile').click()\" style=\"padding:7px 16px;background:#0984e3;color:#fff;border:none;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer\">📥 استيراد نسخة</button>\n    <input type=\"file\" id=\"importFile\" accept=\".json\" style=\"display:none\" onchange=\"BARQ_MK.importBackup(this.files[0])\">\n  </div>\n  </div>\n</div>\n\n<div class=\"nav\">\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('dashboard')\">📊 لوحة التحكم</button>\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('orders')\">📋 قرارات الطلب</button>\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('all')\">📦 كل الأصناف</button>\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('settings')\">⚙️ إعدادات التصنيف</button>\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('history')\">🕐 السجل</button>\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('ai')\">🤖 تحليل ذكي</button>\n  <button class=\"nav-btn\" onclick=\"BARQ_MK.showTab('suppliers')\">🏪 الموردين</button>\n    <button class=\"nav-btn\" id=\"btn-po\" onclick=\"BARQ_MK.showTab('po')\">🧾 أوامر الشراء</button>\n</div>\n\n<div class=\"main\">\n\n  <!-- DASHBOARD TAB -->\n  <div id=\"tab-dashboard\" style=\"display: none;\">\n    <div class=\"upload-zone\" id=\"syncZone\">\n      <div class=\"icon\">🔄</div>\n      <h3>الداتا سنتر</h3>\n      <p id=\"syncStatusText\">جاري المزامنة...</p>\n      <button class=\"btn btn-primary\" style=\"margin-top:10px\" onclick=\"BARQ_MK.syncDataCenter()\">🔄 مزامنة الآن</button>\n      <p style=\"font-size:12px;color:var(--muted);margin-top:8px\">الملفات بترفع في مجلد الداتا سنتر على Drive — مفيش رفع يدوي هنا تاني</p>\n    </div>\n\n    <div id=\"summaryCards\" style=\"display:none\">\n      <div class=\"section-title\">ملخص اليوم <span class=\"date-badge\" id=\"uploadDateBadge\"></span></div>\n      <div class=\"cards\">\n        <div class=\"card ok\"><div class=\"card-val\" id=\"totalItems\">0</div><div class=\"card-lbl\">إجمالي الأصناف</div></div>\n        <div class=\"card A\"><div class=\"card-val\" id=\"countA\">0</div><div class=\"card-lbl\">طلب عالي</div></div>\n        <div class=\"card B\"><div class=\"card-val\" id=\"countB\">0</div><div class=\"card-lbl\">طلب عادي</div></div>\n        <div class=\"card C\"><div class=\"card-val\" id=\"countC\">0</div><div class=\"card-lbl\">طلب متوسط</div></div>\n        <div class=\"card D\"><div class=\"card-val\" id=\"countD\">0</div><div class=\"card-lbl\">طلب منخفض</div></div>\n        <div class=\"card E\"><div class=\"card-val\" id=\"countE\">0</div><div class=\"card-lbl\">طلب منخفض جدًا</div></div>\n        <div class=\"card F\"><div class=\"card-val\" id=\"countF\">0</div><div class=\"card-lbl\">طلب متدني</div></div>\n        <div class=\"card warn\"><div class=\"card-val\" id=\"orderNow\">0</div><div class=\"card-lbl\">يحتاج طلب الآن</div></div>\n        <div class=\"card warn\"><div class=\"card-val\" id=\"negStock\">0</div><div class=\"card-lbl\">مخزون سالب ⚠️</div></div>\n      </div>\n\n      <!-- Charts -->\n      <div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:16px; margin-bottom:24px;\">\n        <div style=\"background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px;\">\n          <div class=\"section-title\">توزيع ABC</div>\n          <canvas id=\"abcChart\" width=\"300\" height=\"200\"></canvas>\n        </div>\n        <div style=\"background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px;\">\n          <div class=\"section-title\">أصناف تحتاج طلب فوري</div>\n          <div id=\"urgentList\" style=\"max-height:200px; overflow-y:auto;\"></div>\n        </div>\n      </div>\n    </div>\n\n    <div id=\"emptyDash\" class=\"empty\">\n      <div class=\"icon\">📊</div>\n      <h3>جاري تحميل بيانات المخزون من الداتا سنتر...</h3>\n      <p>لو الصفحة فضلت هنا، دوس \"🔄 مزامنة الآن\" فوق</p>\n    </div>\n  </div>\n\n  <!-- ORDERS TAB -->\n  <div id=\"tab-orders\" style=\"display:none\">\n    <div class=\"section-title\">قرارات الطلب</div>\n    <div class=\"legend\">\n      <span><span class=\"dot\" style=\"background:var(--A)\"></span> عالي</span>\n      <span><span class=\"dot\" style=\"background:var(--B)\"></span> عادي</span>\n      <span><span class=\"dot\" style=\"background:var(--C)\"></span> متوسط</span>\n      <span><span class=\"dot\" style=\"background:var(--D)\"></span> منخفض</span>\n      <span><span class=\"dot\" style=\"background:var(--E)\"></span> منخفض جدًا</span>\n      <span><span class=\"dot\" style=\"background:var(--F)\"></span> متدني</span>\n    </div>\n    <div class=\"filters\">\n      <input type=\"text\" id=\"searchOrders\" placeholder=\"ابحث عن صنف...\" oninput=\"BARQ_MK.renderOrders()\">\n      <button class=\"filter-btn active\" id=\"fAll\" onclick=\"BARQ_MK.setOrderFilter('all')\">الكل</button>\n      <button class=\"filter-btn\" id=\"fOrder\" onclick=\"BARQ_MK.setOrderFilter('order')\">🔴 اطلب الآن</button>\n      <button class=\"filter-btn\" id=\"fOk\" onclick=\"BARQ_MK.setOrderFilter('ok')\">🟢 لا تطلب</button>\n      <button class=\"filter-btn\" id=\"fA\" onclick=\"BARQ_MK.setOrderFilter('A')\">عالي</button>\n      <button class=\"filter-btn\" id=\"fB\" onclick=\"BARQ_MK.setOrderFilter('B')\">عادي</button>\n      <button class=\"filter-btn\" id=\"fC\" onclick=\"BARQ_MK.setOrderFilter('C')\">متوسط</button>\n      <button class=\"filter-btn\" id=\"fD\" onclick=\"BARQ_MK.setOrderFilter('D')\">منخفض</button>\n      <button class=\"filter-btn\" id=\"fE\" onclick=\"BARQ_MK.setOrderFilter('E')\">منخفض جدًا</button>\n      <button class=\"filter-btn\" id=\"fF\" onclick=\"BARQ_MK.setOrderFilter('F')\">متدني</button>\n      <button class=\"export-btn\" onclick=\"BARQ_MK.exportOrders()\">⬇ تصدير CSV</button>\n    </div>\n    <div class=\"table-wrap\">\n      <table>\n        <thead>\n          <tr>\n            <th onclick=\"BARQ_MK.sortBy('name')\">اسم الصنف ↕</th>\n            <th onclick=\"BARQ_MK.sortBy('sku')\">SKU</th>\n            <th>الوحدة</th>\n            <th onclick=\"BARQ_MK.sortBy('class')\">شريحة ↕</th>\n            <th>الأهمية</th>\n            <th onclick=\"BARQ_MK.sortBy('qty')\">الكمية ↕</th>\n            <th onclick=\"BARQ_MK.sortBy('minQty')\">الحد الأدنى</th>\n            <th>آخر سعر</th>\n            <th>قرار الطلب</th>\n            <th>تعديل</th>\n          </tr>\n        </thead>\n        <tbody id=\"ordersBody\"></tbody>\n      </table>\n    </div>\n    <div class=\"pagination\" id=\"ordersPager\"></div>\n  </div>\n\n  <!-- ALL ITEMS TAB -->\n  <div id=\"tab-all\" style=\"display:none\">\n    <div class=\"section-title\">كل الأصناف</div>\n    <div class=\"filters\">\n      <input type=\"text\" id=\"searchAll\" placeholder=\"ابحث...\" oninput=\"BARQ_MK.renderAll()\">\n      <button class=\"filter-btn active\" id=\"aAll\" onclick=\"BARQ_MK.setAllFilter('all')\">الكل</button>\n      <button class=\"filter-btn\" id=\"aA\" onclick=\"BARQ_MK.setAllFilter('A')\">عالي</button>\n      <button class=\"filter-btn\" id=\"aB\" onclick=\"BARQ_MK.setAllFilter('B')\">عادي</button>\n      <button class=\"filter-btn\" id=\"aC\" onclick=\"BARQ_MK.setAllFilter('C')\">متوسط</button>\n      <button class=\"filter-btn\" id=\"aD\" onclick=\"BARQ_MK.setAllFilter('D')\">منخفض</button>\n      <button class=\"filter-btn\" id=\"aE\" onclick=\"BARQ_MK.setAllFilter('E')\">منخفض جدًا</button>\n      <button class=\"filter-btn\" id=\"aF\" onclick=\"BARQ_MK.setAllFilter('F')\">متدني</button>\n      <button class=\"export-btn\" onclick=\"BARQ_MK.exportAll()\">⬇ تصدير CSV</button>\n    </div>\n    <div class=\"table-wrap\">\n      <table>\n        <thead>\n          <tr>\n            <th onclick=\"BARQ_MK.sortAllBy('name')\">اسم الصنف ↕</th>\n            <th onclick=\"BARQ_MK.sortAllBy('sku')\">SKU</th>\n            <th>وحدة</th>\n            <th onclick=\"BARQ_MK.sortAllBy('qty')\">الكمية ↕</th>\n            <th onclick=\"BARQ_MK.sortAllBy('cost')\">التكلفة الإجمالية ↕</th>\n            <th onclick=\"BARQ_MK.sortAllBy('class')\">شريحة ↕</th>\n            <th>الأهمية</th>\n            <th>آخر سعر</th>\n            <th>قرار</th>\n            <th>تعديل</th>\n          </tr>\n        </thead>\n        <tbody id=\"allBody\"></tbody>\n      </table>\n    </div>\n    <div class=\"pagination\" id=\"allPager\"></div>\n  </div>\n\n  <!-- SETTINGS TAB -->\n  <div id=\"tab-settings\" style=\"display:none\">\n    <div class=\"section-title\">⚙️ إعدادات مستويات الطلب</div>\n    <div style=\"background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; max-width:700px; margin-bottom:24px;\">\n      <p style=\"color:var(--muted); font-size:14px; margin-bottom:20px; line-height:1.8;\">\n        كل صنف بيتصنف تلقائياً لمستوى طلب بناءً على <strong style=\"color:var(--text)\">نسبة تكلفته التراكمية</strong> من إجمالي قيمة المخزون.\n        كل مستوى ليه حد أعلى % (نسبة تراكمية) وحد أدنى افتراضي للكمية (نقطة إعادة الطلب).\n      </p>\n\n      <div class=\"table-wrap\">\n        <table>\n          <thead>\n            <tr>\n              <th>المستوى</th>\n              <th>الحد الأعلى % (تراكمي)</th>\n              <th>الحد الأدنى للكمية (نقطة الطلب)</th>\n            </tr>\n          </thead>\n          <tbody>\n            <tr><td><span class=\"badge badge-A\">عالي</span></td><td><input type=\"number\" id=\"cut0\" value=\"50\" min=\"1\" max=\"99\" step=\"1\"></td><td><input type=\"number\" id=\"min0\" value=\"15\" min=\"0\"></td></tr>\n            <tr><td><span class=\"badge badge-B\">عادي</span></td><td><input type=\"number\" id=\"cut1\" value=\"70\" min=\"1\" max=\"99\" step=\"1\"></td><td><input type=\"number\" id=\"min1\" value=\"10\" min=\"0\"></td></tr>\n            <tr><td><span class=\"badge badge-C\">متوسط</span></td><td><input type=\"number\" id=\"cut2\" value=\"85\" min=\"1\" max=\"99\" step=\"1\"></td><td><input type=\"number\" id=\"min2\" value=\"7\" min=\"0\"></td></tr>\n            <tr><td><span class=\"badge badge-D\">منخفض</span></td><td><input type=\"number\" id=\"cut3\" value=\"93\" min=\"1\" max=\"99\" step=\"1\"></td><td><input type=\"number\" id=\"min3\" value=\"5\" min=\"0\"></td></tr>\n            <tr><td><span class=\"badge badge-E\">منخفض جدًا</span></td><td><input type=\"number\" id=\"cut4\" value=\"97\" min=\"1\" max=\"99\" step=\"1\"></td><td><input type=\"number\" id=\"min4\" value=\"3\" min=\"0\"></td></tr>\n            <tr><td><span class=\"badge badge-F\">متدني</span></td><td style=\"color:var(--muted);font-size:12px\">الباقي تلقائياً</td><td><input type=\"number\" id=\"min5\" value=\"1\" min=\"0\"></td></tr>\n          </tbody>\n        </table>\n      </div>\n\n      <button class=\"btn btn-primary\" style=\"width:100%; margin-top:16px;\" onclick=\"BARQ_MK.saveSettings()\">💾 حفظ الإعدادات وإعادة التصنيف</button>\n    </div>\n\n    <div class=\"section-title\">🔧 تعديل تصنيف صنف بعينه</div>\n    <div style=\"background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; max-width:600px;\">\n      <p style=\"color:var(--muted); font-size:13px; margin-bottom:16px;\">يمكنك تغيير شريحة أي صنف يدوياً — التعديل اليدوي له أولوية على التصنيف التلقائي</p>\n      <div class=\"filters\" style=\"margin-bottom:0\">\n        <input type=\"text\" id=\"searchManual\" placeholder=\"ابحث عن الصنف...\" oninput=\"BARQ_MK.renderManualList()\" style=\"flex:1\">\n      </div>\n      <div id=\"manualList\" style=\"max-height:300px; overflow-y:auto; margin-top:12px;\"></div>\n    </div>\n  </div>\n\n  <!-- HISTORY TAB -->\n  <div id=\"tab-history\" style=\"display:none\">\n    <div class=\"section-title\">📅 سجل الرفعات اليومية</div>\n    <div id=\"historyList\" class=\"history-list\">\n    <div class=\"history-item\">\n      <div>\n        <div style=\"font-size:14px;font-weight:700\">مستويات المخزون Report.csv</div>\n        <div class=\"history-date\">١٢‏/٦‏/٢٠٢٦، ١١:٢٧:٤٩ م</div>\n      </div>\n      <div class=\"history-count\">5041 صنف</div>\n    </div>\n  \n    <div class=\"history-item\">\n      <div>\n        <div style=\"font-size:14px;font-weight:700\">مستويات المخزون Report.csv</div>\n        <div class=\"history-date\">١٢‏/٦‏/٢٠٢٦، ١٠:٢١:٣٧ م</div>\n      </div>\n      <div class=\"history-count\">5041 صنف</div>\n    </div>\n  \n    <div class=\"history-item\">\n      <div>\n        <div style=\"font-size:14px;font-weight:700\">مستويات المخزون Report.csv</div>\n        <div class=\"history-date\">١٢‏/٦‏/٢٠٢٦، ١٠:١٠:٤٧ م</div>\n      </div>\n      <div class=\"history-count\">5041 صنف</div>\n    </div>\n  </div>\n    <div class=\"empty\" id=\"emptyHistory\" style=\"display:none\">\n      <div class=\"icon\">📅</div>\n      <h3>لا يوجد سجل بعد</h3>\n    </div>\n  </div>\n\n\n  <!-- SUPPLIERS TAB -->\n  <div id=\"tab-suppliers\" style=\"display: block;\">\n    <div style=\"display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:10px;\">\n      <div class=\"section-title\" style=\"margin-bottom:0\">🏪 دليل الموردين</div>\n      <div style=\"display:flex;gap:8px;flex-wrap:wrap;align-items:center\">\n        <button class=\"export-btn\" onclick=\"BARQ_MK.downloadSupplierTemplate()\" title=\"حمّل نموذج Excel\">📥 نموذج Excel</button>\n        <label style=\"display: flex; align-items: center; gap: 6px; padding: 9px 16px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; font-family: Cairo, sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; color: var(--accent); transition: 0.2s;\" onmouseover=\"this.style.background='var(--accent)';this.style.color='#fff'\" onmouseout=\"this.style.background='var(--surface2)';this.style.color='var(--accent)'\">\n          📤 رفع Excel\n          <input type=\"file\" accept=\".xlsx,.xls\" style=\"display:none\" onchange=\"BARQ_MK.importSuppliersExcel(this.files[0]);this.value=''\">\n        </label>\n        <button class=\"sup-add-btn\" style=\"margin-bottom:0\" onclick=\"BARQ_MK.openSupModal()\">＋ إضافة مورد</button>\n      </div>\n    </div>\n    <p style=\"color:var(--muted);font-size:13px;margin-bottom:18px;\">أضف موردينك وارتباطهم بالأصناف — ادوس على الصنف في أي جدول ليطلع لك المورد المسؤول</p>\n    <div class=\"sup-search filters\">\n      <input type=\"text\" id=\"searchSup\" placeholder=\"ابحث عن مورد أو صنف...\" oninput=\"BARQ_MK.renderSuppliers()\">\n    </div>\n    <div id=\"supGrid\" class=\"sup-grid\"></div>\n    <div id=\"supEmpty\" class=\"empty\" style=\"display:none\">\n      <div class=\"icon\">🏪</div>\n      <h3>لا يوجد موردين بعد</h3>\n      <p>ابدأ بإضافة مورد من الزر بالأعلى</p>\n    </div>\n  </div>\n\n  <!-- AI TAB -->\n  <div id=\"tab-ai\" style=\"display:none\">\n    <div class=\"section-title\">🤖 تحليل ذكي بالذكاء الاصطناعي</div>\n\n    <div id=\"aiNoData\" class=\"ai-empty\">\n      <div class=\"icon\">🤖</div>\n      <h3>ارفع بيانات المخزون أولاً</h3>\n      <p>ارفع ملف CSV من تاب لوحة التحكم ثم عد هنا للتحليل</p>\n    </div>\n\n    <div id=\"aiReady\" style=\"display:none\">\n      <p style=\"color:var(--muted);font-size:14px;margin-bottom:20px;line-height:1.8;\">\n        تحليل فوري لبياناتك: أكتر الأصناف طلباً، أصناف لازم تزود فيها، أصناف عندك زيادة منها، وأهم الملاحظات على المخزون.\n      </p>\n      <button class=\"ai-analyze-btn\" id=\"aiBtn\" onclick=\"BARQ_MK.runAIAnalysis()\">\n        <span>✨</span> ابدأ التحليل\n      </button>\n      <div id=\"aiLoading\" class=\"ai-loading\" style=\"display:none\">\n        <div class=\"ai-spinner\"></div>\n        <span id=\"aiLoadingText\">Claude بيحلل بياناتك...</span>\n      </div>\n      <div id=\"aiReport\" class=\"ai-report\"></div>\n    </div>\n  </div>\n\n</div>\n\n\n<!-- SUPPLIER MODAL -->\n<div class=\"overlay\" id=\"supModal\">\n  <div class=\"modal\" id=\"supModalInner\">\n    <h3 id=\"supModalTitle\">🏪 إضافة مورد</h3>\n    <input type=\"hidden\" id=\"supId\">\n    <div class=\"form-group\">\n      <label>اسم المندوب / المورد</label>\n      <input type=\"text\" id=\"supName\" placeholder=\"مثال: أحمد السيد\">\n    </div>\n    <div class=\"form-group\">\n      <label>اسم الشركة (اختياري)</label>\n      <input type=\"text\" id=\"supCompany\" placeholder=\"مثال: شركة النيل للتوزيع\">\n    </div>\n    <div class=\"form-group\">\n      <label>رقم التليفون</label>\n      <input type=\"tel\" id=\"supPhone\" placeholder=\"01001234567\">\n    </div>\n    <div class=\"form-group\">\n      <label>ملاحظات (اختياري)</label>\n      <textarea id=\"supNote\" placeholder=\"أوقات التوريد، شروط الدفع...\"></textarea>\n    </div>\n    <div class=\"form-group\">\n      <label>الأصناف المرتبطة</label>\n      <div class=\"item-sup-list\" id=\"supLinkedItems\" style=\"margin-bottom:8px;max-height:150px;overflow-y:auto;\"></div>\n      <input type=\"text\" class=\"sup-link-search\" id=\"supLinkSearch\" placeholder=\"ابحث عن صنف لإضافته...\" oninput=\"BARQ_MK.renderSupLinkResults()\" style=\"margin-bottom:6px\">\n      <div class=\"sup-link-results\" id=\"supLinkResults\"></div>\n    </div>\n    <div class=\"modal-actions\">\n      <button class=\"btn btn-primary\" onclick=\"BARQ_MK.saveSupplier()\">💾 حفظ</button>\n      <button class=\"btn btn-ghost\" onclick=\"BARQ_MK.closeSupModal()\">إلغاء</button>\n    </div>\n  </div>\n</div>\n\n<!-- ITEM SUPPLIERS POPUP -->\n<div class=\"overlay\" id=\"itemSupModal\">\n  <div class=\"modal\" style=\"max-width:440px\">\n    <h3>📦 موردو الصنف</h3>\n    <div style=\"font-size:14px;font-weight:700;margin-bottom:14px;color:var(--muted)\" id=\"itemSupName\"></div>\n    <div id=\"itemSupList\" class=\"item-sup-list\"></div>\n    <p id=\"itemSupEmpty\" style=\"color:var(--muted);font-size:13px;display:none\">لا يوجد موردون مرتبطون بهذا الصنف.<br>أضفهم من تاب الموردين.</p>\n    <div class=\"modal-actions\" style=\"margin-top:20px\">\n      <button class=\"btn btn-ghost\" onclick=\"BARQ_MK.closeItemSupModal()\">إغلاق</button>\n      <button class=\"btn btn-primary\" onclick=\"BARQ_MK.showTab('suppliers');closeItemSupModal()\">إدارة الموردين</button>\n    </div>\n  </div>\n</div>\n\n<!-- ITEM RECIPE POPUP (شيت المكونات — مواد داخلة في تصنيع هذه المادة) -->\n<div class=\"overlay\" id=\"itemRecipeModal\">\n  <div class=\"modal\" style=\"max-width:480px\">\n    <h3>🧪 مكونات هذا الصنف</h3>\n    <div style=\"font-size:14px;font-weight:700;margin-bottom:6px;color:var(--muted)\" id=\"itemRecipeName\"></div>\n    <div style=\"font-size:12px;color:var(--muted);margin-bottom:14px\">أغلب الوصفات بتيجي أوتوماتيك من تقرير \"Inventory Items Ingredients\" بتاع فودكس. استخدم الشاشة دي بس لو صنف مُصنّع مش موجود ليه وصفة في فودكس، أو عايز تضيف/تصحح ربط بنفسك.</div>\n    <div style=\"position:relative;margin-bottom:10px\">\n      <input type=\"text\" id=\"recipeCompSearch\" class=\"po-field\" autocomplete=\"off\" placeholder=\"🔍 دور على مكون بالاسم أو SKU...\" oninput=\"BARQ_MK.recipeComponentSearch()\">\n      <div id=\"recipeCompResults\" style=\"display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:220px;overflow-y:auto;z-index:60;box-shadow:0 6px 18px rgba(0,0,0,.12);margin-top:3px\"></div>\n    </div>\n    <div id=\"itemRecipeList\" class=\"item-sup-list\"></div>\n    <p id=\"itemRecipeEmpty\" style=\"color:var(--muted);font-size:13px;display:none\">لسه مفيش مكونات مضافة لهذا الصنف.</p>\n    <div class=\"modal-actions\" style=\"margin-top:20px\">\n      <button class=\"btn btn-ghost\" onclick=\"BARQ_MK.closeItemRecipeModal()\">إغلاق</button>\n    </div>\n  </div>\n</div>\n\n<!-- EDIT MODAL -->\n<div class=\"overlay\" id=\"editModal\">\n  <div class=\"modal\">\n    <h3>✏️ تعديل صنف</h3>\n    <input type=\"hidden\" id=\"editSku\">\n    <div class=\"form-group\">\n      <label>اسم الصنف</label>\n      <input type=\"text\" id=\"editName\" disabled=\"\">\n    </div>\n    <div class=\"form-group\">\n      <label>الشريحة (مستوى الطلب — التصنيف اليدوي)</label>\n      <select id=\"editClass\">\n        <option value=\"\">تلقائي (من البيانات)</option>\n        <option value=\"A\">عالي</option>\n        <option value=\"B\">عادي</option>\n        <option value=\"C\">متوسط</option>\n        <option value=\"D\">منخفض</option>\n        <option value=\"E\">منخفض جدًا</option>\n        <option value=\"F\">متدني</option>\n      </select>\n    </div>\n    <div class=\"form-group\">\n      <label>الأهمية (تقييمك الشخصي للصنف — مستقل عن الشريحة)</label>\n      <select id=\"editImportance\">\n        <option value=\"\">بدون تقييم</option>\n        <option value=\"عالية\">عالية</option>\n        <option value=\"متوسطة\">متوسطة</option>\n        <option value=\"منخفضة\">منخفضة</option>\n      </select>\n    </div>\n    <div class=\"form-group\">\n      <label>الحد الأدنى للمخزون (يدوي)</label>\n      <input type=\"number\" id=\"editMin\" placeholder=\"اتركه فارغاً للقيمة التلقائية\" min=\"0\">\n    </div>\n    <div class=\"form-group\">\n      <label>💰 آخر سعر شراء (تعديل يدوي — يتفوق على قيمة الداتا سنتر التلقائية)</label>\n      <input type=\"number\" id=\"editLastPrice\" placeholder=\"مثال: 45.50\" min=\"0\" step=\"0.01\">\n    </div>\n    <div class=\"form-group\">\n      <label>📝 ملاحظات (مورد، وقت توريد، أي تفاصيل...)</label>\n      <textarea id=\"editNotes\" placeholder=\"مثال: مورد النيل – يتوفر الاثنين والخميس – التواصل: 01001234567\"></textarea>\n    </div>\n    <div class=\"modal-actions\">\n      <button class=\"btn btn-primary\" onclick=\"BARQ_MK.saveEdit()\">💾 حفظ</button>\n      <button class=\"btn btn-ghost\" onclick=\"BARQ_MK.closeModal()\">إلغاء</button>\n    </div>\n  </div>\n</div>\n<!-- ══ PURCHASE ORDERS TAB ══ -->\n  <div id=\"tab-po\" style=\"display:none; padding:4px 0;\">\n\n    \n    <!-- Connection bar -->\n    <div style=\"display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:9px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;flex-wrap:wrap;gap:8px;\">\n      <div style=\"display:flex;align-items:center;gap:8px;\">\n        <span style=\"font-size:13px;font-weight:700;\">🏭 المخزون</span>\n        <span style=\"color:var(--muted);\">⇄</span>\n        <span style=\"font-size:13px;font-weight:700;\">💰 التسعير</span>\n        <div id=\"po-conn-dot\" style=\"width:9px;height:9px;border-radius:50%;background:#d4ac0d;animation:pulse 1s infinite;margin-right:4px;\"></div>\n        <span id=\"po-conn-text\" style=\"font-size:12px;color:var(--muted);\">جاري الاتصال</span>\n      </div>\n      <span id=\"po-sb-badge\" style=\"font-size:12px;padding:4px 12px;border-radius:20px;background:#fef9e7;color:#d4ac0d;font-weight:700;\">⏳</span>\n    </div>\n\n    <!-- Toolbar -->\n    <div style=\"display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;\">\n      <button class=\"primary-btn\" onclick=\"BARQ_MK.poShowView('list')\">📋 الأوامر</button>\n      <button class=\"secondary-btn\" onclick=\"BARQ_MK.poNewOrder()\">➕ أمر جديد</button>\n      <button class=\"secondary-btn\" id=\"btn-po-split\" onclick=\"BARQ_MK.poOpenSplit()\" style=\"display:none;\">🧮 وزّع السلة على الموردين (<span id=\"po-split-count\">0</span>)</button>\n    </div>\n\n    <!-- ── LIST VIEW ── -->\n    <div id=\"po-view-list\">\n      <div style=\"display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;\">\n        <input type=\"text\" id=\"po-search\" placeholder=\"ابحث برقم الأمر أو المورد...\" oninput=\"BARQ_MK.poRenderList()\" class=\"po-field\" style=\"flex:1;min-width:160px;\">\n        <select id=\"po-status-filter\" onchange=\"BARQ_MK.poRenderList()\" class=\"po-field\" style=\"flex:0 0 auto;width:auto;\">\n          <option value=\"\">كل الأوامر</option>\n          <option value=\"draft\">مسودة</option>\n          <option value=\"sent\">مرسل</option>\n          <option value=\"received\">مستلم</option>\n          <option value=\"approved\">معتمد</option>\n        </select>\n      </div>\n      <div id=\"po-list-body\"></div>\n    </div>\n\n    <!-- ── NEW/EDIT FORM ── -->\n    <div id=\"po-view-new\" style=\"display:none;\">\n\n      <!-- Header info -->\n      <div class=\"po-card\">\n        <h3 style=\"font-size:15px;font-weight:700;color:var(--accent);margin:0 0 14px;\">🧾 بيانات أمر الشراء</h3>\n        <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:12px;\">\n          <div style=\"position:relative;\">\n            <label class=\"po-label\">المورد *</label>\n            <input type=\"text\" id=\"po-sup-search\" class=\"po-field\" autocomplete=\"off\"\n              placeholder=\"🔍 ابحث أو اكتب اسم المورد...\" oninput=\"BARQ_MK.poSupplierSearch()\" onfocus=\"BARQ_MK.poSupplierSearch()\">\n            <input type=\"hidden\" id=\"po-sup-sel\">\n            <div id=\"po-sup-results\" style=\"display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:220px;overflow-y:auto;z-index:60;box-shadow:0 6px 18px rgba(0,0,0,.12);margin-top:3px;\"></div>\n          </div>\n          <div style=\"position:relative;\">\n            <label class=\"po-label\">اسم المسؤول / المشتري *</label>\n            <input type=\"text\" id=\"po-officer-inp\" class=\"po-field\" autocomplete=\"off\"\n              placeholder=\"اكتب اسم الشخص المسؤول عن الأمر\" oninput=\"BARQ_MK.poOfficerSearch()\" onfocus=\"BARQ_MK.poOfficerSearch()\">\n            <div id=\"po-officer-results\" style=\"display:none;position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:200px;overflow-y:auto;z-index:60;box-shadow:0 6px 18px rgba(0,0,0,.12);margin-top:3px;\"></div>\n          </div>\n          <div>\n            <label class=\"po-label\">تاريخ التوريد المتوقع</label>\n            <input type=\"date\" id=\"po-exp-date\" class=\"po-field\">\n          </div>\n          <div>\n            <label class=\"po-label\">ملاحظات</label>\n            <input type=\"text\" id=\"po-notes-inp\" placeholder=\"اختياري...\" class=\"po-field\">\n          </div>\n        </div>\n      </div>\n\n      <!-- Items search + checkbox list -->\n      <div class=\"po-card\">\n        <h3 style=\"font-size:15px;font-weight:700;color:var(--accent);margin:0 0 14px;\">📦 الأصناف</h3>\n\n        <div style=\"display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;\">\n          <input type=\"text\" id=\"po-item-q\" placeholder=\"ابحث عن صنف بالاسم أو SKU...\" oninput=\"BARQ_MK.poSearchItems()\"\n            class=\"po-field\" style=\"flex:1;min-width:200px;\">\n          <button class=\"secondary-btn\" onclick=\"BARQ_MK.poAddLowStock()\">⚠️ الأصناف الناقصة</button>\n        </div>\n\n        <!-- Search results as checkboxes -->\n        <div id=\"po-search-results\" style=\"margin-bottom:10px;max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;display:none;background:var(--surface);\"></div>\n\n        <!-- Selected items list -->\n        <div id=\"po-selected-header\" style=\"display:none;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;justify-content:space-between;align-items:center;\">\n          <span>الأصناف المختارة:</span>\n          <button class=\"filter-btn\" style=\"padding:4px 10px;font-size:11px\" onclick=\"BARQ_MK.clearCart()\">🧹 امسح السلة</button>\n        </div>\n        <div id=\"po-items-list\" style=\"border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px;\">\n          <div id=\"po-items-empty\" style=\"text-align:center;padding:24px;color:var(--muted);font-size:13px;\">لم يتم اختيار أصناف بعد</div>\n        </div>\n\n        <!-- Total -->\n        <div style=\"text-align:left;padding:8px 4px;font-size:15px;font-weight:900;color:var(--accent);\">\n          الإجمالي: <span id=\"po-grand-tot\">0.00</span> ج\n        </div>\n\n        <!-- Actions -->\n        <div style=\"display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;\">\n          <button class=\"primary-btn\" onclick=\"BARQ_MK.poSave('draft')\">💾 حفظ مسودة</button>\n          <button class=\"primary-btn\" style=\"background:#1a3a5c;\" onclick=\"BARQ_MK.poSave('sent')\">📤 إرسال وتأكيد</button>\n          <button class=\"primary-btn\" style=\"background:#555;\" onclick=\"BARQ_MK.poPrint()\">🖨️ طباعة</button>\n          <button class=\"secondary-btn\" onclick=\"BARQ_MK.poCancelNew()\">إلغاء</button>\n        </div>\n        <div style=\"font-size:11px;color:var(--muted);margin-top:8px;\">\n          ⓘ \"إرسال وتأكيد\" يرسل الأمر لمطابقة الفاتورة ومراجعة الكميات والتسعير في آن واحد\n        </div>\n      </div>\n    </div>\n\n    <!-- ── DETAIL VIEW ── -->\n    <div id=\"po-view-detail\" style=\"display:none;\"></div>\n\n    <!-- ── SPLIT-BY-SUPPLIER VIEW ── -->\n    <div id=\"po-view-split\" style=\"display:none;\"></div>\n  </div>\n\n  <!-- Print Frame -->\n  <!-- Print Frame -->\n  <div id=\"po-print-frame\" style=\"display:none;position:fixed;inset:0;background:white;z-index:9999;padding:30px;font-family:Cairo,sans-serif;direction:rtl;overflow:auto;\">\n    <div style=\"display:flex;justify-content:space-between;margin-bottom:20px;\">\n      <button onclick=\"document.getElementById('po-print-frame').style.display='none'\" style=\"padding:8px 16px;border-radius:8px;border:1px solid #ccc;cursor:pointer;font-family:Cairo,sans-serif;\">✕ إغلاق</button>\n      <button onclick=\"window.print()\" style=\"padding:8px 20px;border-radius:8px;border:none;background:#1a7a40;color:white;font-family:Cairo,sans-serif;font-weight:700;cursor:pointer;\">🖨️ طباعة</button>\n    </div>\n    <div id=\"po-print-content\"></div>\n  </div>\n</div>";

var BARQ_MK = (function () {
// =================== STATE ===================
let rawData = [];
let processedData = [];
let orderFilter = 'all';
let allFilter = 'all';
let sortField = 'totalCost';
let sortDir = -1;
let sortFieldAll = 'totalCost';
let sortDirAll = -1;
let ordersPage = 1;
let allPage = 1;
const PAGE_SIZE = 50;

let tierCut = [50, 70, 85, 93, 97];
let tierMin = [15, 10, 7, 5, 3, 1];
let overrides = {}, suppliers = [], supEditId = null, supLinkedSkus = [];
let dcCostMap = {}; // sku -> آخر تكلفة من الداتا سنتر (dc_current_cost)
let history = [];

// =================== TIER / IMPORTANCE / UNIT HELPERS ===================
const TIER_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TIER_LABELS = { A: 'عالي', B: 'عادي', C: 'متوسط', D: 'منخفض', E: 'منخفض جدًا', F: 'متدني' };

function classifyPct(pct) {
  for (let i = 0; i < tierCut.length; i++) { if (pct <= tierCut[i]) return TIER_KEYS[i]; }
  return TIER_KEYS[TIER_KEYS.length - 1];
}

const IMPORTANCE_RANK = { 'عالية': 0, 'متوسطة': 1, 'منخفضة': 3 };
function importanceRank(r) { return IMPORTANCE_RANK[r.importance] ?? 2; }

const UNIT_LABELS = {
  'kilogram':'كيلو','kg':'كيلو','كيلو':'كيلو','كيلوجرام':'كيلو',
  'gram':'جرام','g':'جرام','جرام':'جرام','جم':'جرام',
  'piece':'وحدة','pieces':'وحدة','each':'وحدة','وحدة':'وحدة',
  'carton':'كرتونة','box':'كرتونة','كرتونة':'كرتونة','كرتون':'كرتونة',
  'liter':'لتر','litre':'لتر','لتر':'لتر'
};
function unitLabel(u) {
  if (!u) return '—';
  const key = String(u).trim().toLowerCase();
  return UNIT_LABELS[key] || String(u).trim();
}

// أسماء الأصناف بتيجي من ملف CSV مرفوع، والملاحظات/الموردين بيتكتبوا يدوي — لازم تتنضف قبل ما تدخل innerHTML
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// =================== INDEXEDDB ENGINE ===================
let db;
const DB_NAME = 'barq_makhzoun', DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function dbGet(k) {
  return new Promise(res => {
    const r = db.transaction('kv','readonly').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result ? r.result.v : null);
    r.onerror = () => res(null);
  });
}

function dbSet(k, v) {
  return new Promise(res => {
    if (!db) { console.warn('DB not ready yet'); res(); return; }
    try {
      const tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put({ k, v });
      tx.oncomplete = () => { flashSaved(); res(); };
      tx.onerror = () => res();
    } catch(e) { console.error('dbSet error:', e); res(); }
  });
}

function flashSaved() {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.style.display = 'inline';
  clearTimeout(window._st);
  window._st = setTimeout(() => { el.style.display = 'none'; }, 2000);
}

async function loadAllData() {
  const s = await dbGet('settings');
  if (s) { tierCut = s.tierCut || tierCut; tierMin = s.tierMin || tierMin; }
  const ov = await dbGet('overrides'); if (ov) Object.assign(overrides, ov);
  const sup = await dbGet('suppliers'); if (sup) suppliers = sup;
  const hist = await dbGet('history'); if (hist) { history.length=0; history.push(...hist); }
}

function applySettingsToInputs() {
  tierCut.forEach((v, i) => { const el = document.getElementById('cut'+i); if (el) el.value = v; });
  tierMin.forEach((v, i) => { const el = document.getElementById('min'+i); if (el) el.value = v; });
}

// =================== BACKUP ===================
function exportBackup() {
  const data = { version:2, exportedAt: new Date().toLocaleString('ar-EG'),
    suppliers, overrides, settings:{tierCut,tierMin}, history };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download = 'barq_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const d = JSON.parse(e.target.result);
      if (d.suppliers) { suppliers=d.suppliers; await dbSet('suppliers',suppliers); }
      if (d.overrides) { Object.assign(overrides,d.overrides); await dbSet('overrides',overrides); }
      if (d.settings) {
        tierCut = d.settings.tierCut || tierCut;
        tierMin = d.settings.tierMin || tierMin;
        await dbSet('settings',{tierCut,tierMin});
        applySettingsToInputs();
      }
      if (d.history) { history.length=0; history.push(...d.history); await dbSet('history',history); renderHistory(); }
      renderSuppliers();
      if (processedData.length) processData();
      alert('✅ تم الاستيراد بنجاح');
    } catch(err) { alert('❌ خطأ: '+err.message); }
  };
  reader.readAsText(file);
  document.getElementById('importFile').value='';
}

// =================== DATA CENTER — آخر تكلفة (dc_current_cost) ===================
// المصدر الموحّد للتكلفة الحالية، تُستخدم في أمر الشراء وأي مكان محتاج "آخر سعر"
async function loadDcCurrentCost() {
  try {
    const rows = await fetchAllPaginated(PO_SB_URL + '/rest/v1/dc_current_cost?select=sku,current_cost');
    dcCostMap = {};
    rows.forEach(row => { if (row.sku && row.current_cost != null) dcCostMap[row.sku] = parseFloat(row.current_cost); });
    if (rawData.length) processData(); // نعيد الحساب لو الملف كان محمّل قبل ما التكلفة توصل
  } catch (e) { console.error('[loadDcCurrentCost]', e); }
}

// Supabase/PostgREST بيحدد أقصى 1000 صف في الرد الواحد افتراضيًا — لازم نصفّح لو العدد أكبر
async function fetchAllPaginated(url) {
  const pageSize = 1000;
  let offset = 0;
  let all = [];
  while (true) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'offset=' + offset + '&limit=' + pageSize, { headers: PO_SB_H });
    if (!r.ok) break;
    const page = await r.json();
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// =================== INIT ===================
function initModuleData() {
  openDB().then(loadAllData).then(() => {
    document.getElementById('todayDate').textContent = new Date().toLocaleDateString('ar-EG');
    applySettingsToInputs();
    renderHistory();
    renderSuppliers();
    updateCartBadge();
    syncDataCenter(); // مزامنة تلقائية أول ما تفتح الصفحة — بدل الرفع اليدوي
  });
}

// =================== الداتا سنتر — مصدر مستويات المخزون (بدل الرفع اليدوي) ===================
// كل الرفع بقى مركزي: الملفات بتترفع في مجلد الداتا سنتر على Drive، والمزامنة هنا
// بتسحب النسخة الأحدث من Supabase (بعد ما تكون اتزامنت من هناك) وتبني عليها التحليل.
function setSyncStatus(msg, isError) {
  const el = document.getElementById('syncStatusText');
  if (el) { el.textContent = msg; el.style.color = isError ? 'var(--red)' : ''; }
}

async function loadStockFromDataCenter() {
  const rows = await fetchAllPaginated(PO_SB_URL + '/rest/v1/dc_stock_levels?select=sku,name,unit,barcode,qty,cost_per_unit,total_cost');
  if (!rows.length) return false;
  rawData = rows.map(row => ({
    'SKU': row.sku || '', 'Name': row.name || '', 'Storage Unit': row.unit || '',
    'Quantity': row.qty ?? 0, 'Cost Per Unit': row.cost_per_unit ?? 0, 'Total Cost': row.total_cost ?? 0
  }));
  processData();
  saveToHistory('مزامنة الداتا سنتر');
  document.getElementById('lastUpload').textContent = new Date().toLocaleTimeString('ar-EG');
  document.getElementById('uploadDateBadge').textContent = new Date().toLocaleDateString('ar-EG');
  return true;
}

async function syncDataCenter() {
  setSyncStatus('⏳ جاري سحب أحدث نسخة من الملفات وتحديث اللي اتغيّر...');
  try {
    const r = await fetch(PO_SB_URL + '/functions/v1/dc-sync', {
      method: 'POST', headers: {'apikey': PO_SB_KEY, 'Authorization': 'Bearer ' + PO_SB_KEY, 'Content-Type':'application/json'}, body: JSON.stringify({})
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const failed = (data.results || []).filter(x => x.status === 'failed');
    if (failed.length) {
      setSyncStatus('⚠️ فيه مشكلة في المزامنة: ' + failed.map(f => f.table + ' — ' + f.error).join(' | '), true);
    } else {
      const summary = (data.results || []).map(x => x.table + ': ' + (x.inserted!=null ? `+${x.inserted} جديد / ${x.updated} اتحدّث / ${x.unchanged} زي ما هو` : `${x.total} صف`)).join(' — ');
      setSyncStatus('✅ آخر مزامنة: ' + new Date().toLocaleString('ar-EG') + ' — ' + summary);
    }
  } catch (e) {
    setSyncStatus('⚠️ تعذّرت المزامنة التلقائية (' + e.message + ') — هنعرض آخر نسخة محفوظة', true);
  }
  try {
    await loadDcCurrentCost();
    await loadStockFromDataCenter();
    await loadDcSupplierLinks();
  } catch (e) {
    setSyncStatus('⚠️ ' + e.message, true);
  }
}

// =================== الداتا سنتر — ربط الموردين وأصنافهم (لتوزيع سلة الشراء تلقائي) ===================
// بندمج دليل موردين الداتا سنتر (dc_suppliers) + ربط الأصناف بالموردين (dc_supplier_items)
// في دليل الموردين المحلي، عشان توزيع سلة الشراء يعرف مورد كل صنف تلقائي من غير ربط يدوي.
async function loadDcSupplierLinks() {
  try {
    const [dcSuppliers, dcLinks] = await Promise.all([
      fetchAllPaginated(PO_SB_URL + '/rest/v1/dc_suppliers?select=name,code,contact_name,phone'),
      fetchAllPaginated(PO_SB_URL + '/rest/v1/dc_supplier_items?select=supplier_name,inventory_item_sku')
    ]);
    if (!dcSuppliers.length) return;

    const skusByName = {};
    dcLinks.forEach(l => {
      if (!l.supplier_name || !l.inventory_item_sku) return;
      (skusByName[l.supplier_name] = skusByName[l.supplier_name] || []).push(l.inventory_item_sku);
    });

    let changed = false;
    dcSuppliers.forEach(dc => {
      if (!dc.name) return;
      let local = suppliers.find(s => (s.name || '').trim() === dc.name.trim());
      if (!local) {
        local = { id: 'dc-' + dc.name.trim(), name: dc.name.trim(), phone: dc.phone || '', company: '', note: '', skus: [] };
        suppliers.push(local);
        changed = true;
      }
      const dcSkus = skusByName[dc.name] || [];
      const merged = Array.from(new Set([...(local.skus || []), ...dcSkus]));
      if (merged.length !== (local.skus || []).length) { local.skus = merged; changed = true; }
      if (!local.phone && dc.phone) { local.phone = dc.phone; changed = true; }
    });

    if (changed) { await saveSuppliers(); renderSuppliers(); if (typeof poUpdateSplitButton === 'function') poUpdateSplitButton(); }
  } catch (e) { console.error('[loadDcSupplierLinks]', e); }
}

// =================== PROCESS DATA ===================
function processData() {
  const totalCost = rawData.reduce((s, r) => s + (parseFloat(r['Total Cost']) || 0), 0);
  let sorted = [...rawData].sort((a, b) => (parseFloat(b['Total Cost']) || 0) - (parseFloat(a['Total Cost']) || 0));

  let cumulative = 0;
  const classified = sorted.map(row => {
    const cost = parseFloat(row['Total Cost']) || 0;
    cumulative += cost;
    const pct = totalCost > 0 ? (cumulative / totalCost) * 100 : 0;
    let autoClass = classifyPct(pct);
    const sku = row['SKU'] || '';
    const ov = overrides[sku] || {};
    const finalClass = ov.class || autoClass;
    const tierIdx = TIER_KEYS.indexOf(finalClass);
    const defaultMin = tierMin[tierIdx] ?? tierMin[tierMin.length - 1];
    const minQty = ov.minQty !== undefined ? ov.minQty : defaultMin;
    const qty = parseFloat(row['Quantity']) || 0;
    const needOrder = qty <= minQty;

    return {
      name: row['Name'] || '',
      sku: sku,
      unit: row['Storage Unit'] || '',
      qty: qty,
      costPerUnit: parseFloat(row['Cost Per Unit']) || 0,
      totalCost: cost,
      autoClass,
      class: finalClass,
      minQty,
      needOrder,
      pct,
      notes: ov.notes || '',
      importance: ov.importance || '',
      lastPrice: ov.lastPrice !== undefined && ov.lastPrice !== null ? ov.lastPrice : (dcCostMap[sku] ?? null),
      lastPriceFromDC: !(ov.lastPrice !== undefined && ov.lastPrice !== null) && dcCostMap[sku] != null
    };
  });

  processedData = classified;
  updateSummary();
  renderOrders();
  renderAll();
  renderManualList();
  drawChart();

  document.getElementById('summaryCards').style.display = 'block';
  document.getElementById('emptyDash').style.display = 'none';
} // end processData

// =================== SUMMARY ===================
function updateSummary() {
  document.getElementById('totalItems').textContent = processedData.length;
  TIER_KEYS.forEach(k => {
    const el = document.getElementById('count' + k);
    if (el) el.textContent = processedData.filter(r => r.class === k).length;
  });
  document.getElementById('orderNow').textContent = processedData.filter(r => r.needOrder).length;
  document.getElementById('negStock').textContent = processedData.filter(r => r.qty < 0).length;

  // Urgent list — أهم الأصناف (الأهمية اليدوية أولاً، بعدين الشريحة الأعلى)
  const urgent = processedData.filter(r => r.needOrder && (r.class === 'A' || r.importance === 'عالية'))
    .sort((a, b) => importanceRank(a) - importanceRank(b))
    .slice(0, 10);
  document.getElementById('urgentList').innerHTML = urgent.length
    ? urgent.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>${escapeHtml(r.name)}</span>
        <span class="${r.qty < 0 ? 'qty-neg' : 'qty-low'}">${r.qty.toFixed(2)}</span>
      </div>`).join('')
    : '<p style="color:var(--muted);font-size:13px;margin-top:12px;">✅ لا توجد أصناف عالية الطلب تحتاج طلب فوري</p>';
}

// =================== CHART ===================
function drawChart() {
  const canvas = document.getElementById('abcChart');
  const ctx = canvas.getContext('2d');
  const counts = TIER_KEYS.map(k => processedData.filter(r => r.class === k).length);
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2 - 30, cy = H / 2, r = Math.min(cx, cy) - 20;
  const tierColors = { A:'#1a7a40', B:'#0984e3', C:'#7a8c80', D:'#f5a623', E:'#e17055', F:'#c0392b' };
  const data = TIER_KEYS.map((k, i) => ({ val: counts[i], color: tierColors[k], label: `${TIER_LABELS[k]} (${counts[i]})` }));
  let start = -Math.PI / 2;
  data.forEach(d => {
    const angle = (d.val / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    start += angle;
  });

  // Legend
  let ly = cy - 30;
  data.forEach(d => {
    ctx.fillStyle = d.color;
    ctx.fillRect(W - 70, ly, 14, 14);
    ctx.fillStyle = '#e8eaf0';
    ctx.font = '13px Cairo';
    ctx.textAlign = 'right';
    ctx.fillText(d.label, W, ly + 12);
    ly += 24;
  });
}

// =================== ORDERS TABLE ===================
function setOrderFilter(f) {
  orderFilter = f;
  ordersPage = 1;
  ['fAll','fOrder','fOk','fA','fB','fC','fD','fE','fF'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  const map = { all: 'fAll', order: 'fOrder', ok: 'fOk', A: 'fA', B: 'fB', C: 'fC', D: 'fD', E: 'fE', F: 'fF' };
  document.getElementById(map[f])?.classList.add('active');
  renderOrders();
}

function sortBy(field) {
  if (sortField === field) sortDir *= -1;
  else { sortField = field; sortDir = -1; }
  ordersPage = 1;
  renderOrders();
}

function renderOrders() {
  const q = (document.getElementById('searchOrders')?.value || '').toLowerCase();
  let data = [...processedData];

  if (orderFilter === 'order') data = data.filter(r => r.needOrder);
  else if (orderFilter === 'ok') data = data.filter(r => !r.needOrder);
  else if (TIER_KEYS.includes(orderFilter)) data = data.filter(r => r.class === orderFilter);

  if (q) data = data.filter(r => r.name.includes(q) || r.sku.toLowerCase().includes(q));

  const fmap = { name: 'name', sku: 'sku', class: 'class', qty: 'qty', minQty: 'minQty', totalCost: 'totalCost' };
  const f = fmap[sortField] || 'totalCost';
  data.sort((a, b) => {
    const imp = importanceRank(a) - importanceRank(b);
    if (imp !== 0) return imp;
    const va = typeof a[f] === 'string' ? a[f] : a[f] ?? 0;
    const vb = typeof b[f] === 'string' ? b[f] : b[f] ?? 0;
    return va > vb ? sortDir : va < vb ? -sortDir : 0;
  });

  const total = data.length;
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  if (ordersPage > pages) ordersPage = pages;
  const slice = data.slice((ordersPage - 1) * PAGE_SIZE, ordersPage * PAGE_SIZE);

  const tbody = document.getElementById('ordersBody');
  tbody.innerHTML = slice.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td style="color:var(--muted);font-size:12px">${r.sku}</td>
      <td style="color:var(--muted)">${unitLabel(r.unit)}</td>
      <td><span class="badge badge-${r.class}">${TIER_LABELS[r.class]}</span></td>
      <td>${r.importance ? `<span class="badge badge-imp-${r.importance}">${r.importance}</span>` : '<span style="color:var(--muted);font-size:12px">—</span>'}</td>
      <td class="${r.qty < 0 ? 'qty-neg' : r.needOrder ? 'qty-low' : 'qty-ok'}">${r.qty.toFixed(2)}</td>
      <td style="color:var(--muted)">${r.minQty}</td>
      <td>${r.lastPrice != null ? r.lastPrice.toFixed(2) + ' ج' : '<span style="color:var(--muted);font-size:12px">—</span>'}${r.lastPriceFromDC ? ' <span style="font-size:9px;color:#1a7a40">DC</span>' : ''}</td>
      <td>${r.needOrder ? '<span class="order-yes">🔴 اطلب</span>' : '<span class="order-no">✅ لا تطلب</span>'}</td>
      <td style="display:flex;align-items:center;gap:6px">
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.addToCart('${r.sku}')" title="أضف لسلة أمر الشراء">🧾+</button>
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.openEdit('${r.sku}')">✏️</button>
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.openItemSupModal('${r.sku}','${r.name.replace(/'/g,"\\'")}')" title="موردو هذا الصنف">🏪</button>
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.openItemRecipeModal('${r.sku}','${r.name.replace(/'/g,"\\'")}')" title="مكونات هذا الصنف">🧪</button>
        ${r.notes ? `<span class="note-chip" title="${escapeHtml(r.notes)}" onclick="BARQ_MK.openEdit('${r.sku}')">📝 ${escapeHtml(r.notes)}</span>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">لا توجد نتائج</td></tr>';

  renderPager('ordersPager', pages, ordersPage, p => { ordersPage = p; renderOrders(); });
}

// =================== ALL TABLE ===================
function setAllFilter(f) {
  allFilter = f;
  allPage = 1;
  ['aAll','aA','aB','aC','aD','aE','aF'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  const map = { all: 'aAll', A: 'aA', B: 'aB', C: 'aC', D: 'aD', E: 'aE', F: 'aF' };
  document.getElementById(map[f])?.classList.add('active');
  renderAll();
}

function sortAllBy(field) {
  if (sortFieldAll === field) sortDirAll *= -1;
  else { sortFieldAll = field; sortDirAll = -1; }
  allPage = 1;
  renderAll();
}

function renderAll() {
  const q = (document.getElementById('searchAll')?.value || '').toLowerCase();
  let data = [...processedData];
  if (allFilter !== 'all') data = data.filter(r => r.class === allFilter);
  if (q) data = data.filter(r => r.name.includes(q) || r.sku.toLowerCase().includes(q));

  const fmap = { name: 'name', sku: 'sku', class: 'class', qty: 'qty', cost: 'totalCost' };
  const f = fmap[sortFieldAll] || 'totalCost';
  data.sort((a, b) => {
    const imp = importanceRank(a) - importanceRank(b);
    if (imp !== 0) return imp;
    const va = typeof a[f] === 'string' ? a[f] : a[f] ?? 0;
    const vb = typeof b[f] === 'string' ? b[f] : b[f] ?? 0;
    return va > vb ? sortDirAll : va < vb ? -sortDirAll : 0;
  });

  const pages = Math.ceil(data.length / PAGE_SIZE) || 1;
  if (allPage > pages) allPage = pages;
  const slice = data.slice((allPage - 1) * PAGE_SIZE, allPage * PAGE_SIZE);

  document.getElementById('allBody').innerHTML = slice.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td style="color:var(--muted);font-size:12px">${r.sku}</td>
      <td style="color:var(--muted)">${unitLabel(r.unit)}</td>
      <td class="${r.qty < 0 ? 'qty-neg' : r.qty === 0 ? 'qty-low' : 'qty-ok'}">${r.qty.toFixed(2)}</td>
      <td>${r.totalCost.toLocaleString('ar-EG', {minimumFractionDigits:0})} ج</td>
      <td><span class="badge badge-${r.class}">${TIER_LABELS[r.class]}</span></td>
      <td>${r.importance ? `<span class="badge badge-imp-${r.importance}">${r.importance}</span>` : '<span style="color:var(--muted);font-size:12px">—</span>'}</td>
      <td>${r.lastPrice != null ? r.lastPrice.toFixed(2) + ' ج' : '<span style="color:var(--muted);font-size:12px">—</span>'}${r.lastPriceFromDC ? ' <span style="font-size:9px;color:#1a7a40">DC</span>' : ''}</td>
      <td>${r.needOrder ? '<span class="order-yes">🔴 اطلب</span>' : '<span class="order-no">✅ لا تطلب</span>'}</td>
      <td style="display:flex;align-items:center;gap:6px">
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.addToCart('${r.sku}')" title="أضف لسلة أمر الشراء">🧾+</button>
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.openEdit('${r.sku}')">✏️</button>
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.openItemSupModal('${r.sku}','${r.name.replace(/'/g,"\\'")}')" title="موردو هذا الصنف">🏪</button>
        <button class="filter-btn" style="padding:5px 10px;font-size:12px" onclick="BARQ_MK.openItemRecipeModal('${r.sku}','${r.name.replace(/'/g,"\\'")}')" title="مكونات هذا الصنف">🧪</button>
        ${r.notes ? `<span class="note-chip" title="${escapeHtml(r.notes)}" onclick="BARQ_MK.openEdit('${r.sku}')">📝 ${escapeHtml(r.notes)}</span>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">لا توجد نتائج</td></tr>';

  renderPager('allPager', pages, allPage, p => { allPage = p; renderAll(); });
}

// =================== PAGER ===================
function renderPager(id, pages, current, onClick) {
  const el = document.getElementById(id);
  if (pages <= 1) { el.innerHTML = ''; return; }
  let btns = '';
  if (current > 1) btns += `<button class="page-btn" onclick="(${onClick.toString()})(${current-1})">‹</button>`;
  for (let i = Math.max(1, current-2); i <= Math.min(pages, current+2); i++) {
    btns += `<button class="page-btn ${i===current?'active':''}" onclick="(${onClick.toString()})(${i})">${i}</button>`;
  }
  if (current < pages) btns += `<button class="page-btn" onclick="(${onClick.toString()})(${current+1})">›</button>`;
  btns += `<span class="page-info">صفحة ${current} من ${pages}</span>`;
  el.innerHTML = btns;
}

// =================== MANUAL LIST ===================
function renderManualList() {
  const q = (document.getElementById('searchManual')?.value || '').toLowerCase();
  const data = processedData.filter(r => !q || r.name.includes(q) || r.sku.toLowerCase().includes(q)).slice(0, 30);
  document.getElementById('manualList').innerHTML = data.map(r => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);gap:10px;flex-wrap:wrap;">
      <span style="font-size:13px;flex:1;min-width:120px">${escapeHtml(r.name)}</span>
      <span class="badge badge-${r.autoClass}" style="font-size:11px">${TIER_LABELS[r.autoClass]} تلقائي</span>
      <select onchange="BARQ_MK.quickOverride('${r.sku}', this.value)" style="padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:'Cairo',sans-serif;font-size:12px;">
        <option value="" ${!overrides[r.sku]?.class ? 'selected' : ''}>تلقائي</option>
        <option value="A" ${overrides[r.sku]?.class === 'A' ? 'selected' : ''}>عالي</option>
        <option value="B" ${overrides[r.sku]?.class === 'B' ? 'selected' : ''}>عادي</option>
        <option value="C" ${overrides[r.sku]?.class === 'C' ? 'selected' : ''}>متوسط</option>
        <option value="D" ${overrides[r.sku]?.class === 'D' ? 'selected' : ''}>منخفض</option>
        <option value="E" ${overrides[r.sku]?.class === 'E' ? 'selected' : ''}>منخفض جدًا</option>
        <option value="F" ${overrides[r.sku]?.class === 'F' ? 'selected' : ''}>متدني</option>
      </select>
      <select onchange="BARQ_MK.quickOverrideImportance('${r.sku}', this.value)" style="padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:'Cairo',sans-serif;font-size:12px;">
        <option value="" ${!overrides[r.sku]?.importance ? 'selected' : ''}>بدون أهمية</option>
        <option value="عالية" ${overrides[r.sku]?.importance === 'عالية' ? 'selected' : ''}>أهمية عالية</option>
        <option value="متوسطة" ${overrides[r.sku]?.importance === 'متوسطة' ? 'selected' : ''}>أهمية متوسطة</option>
        <option value="منخفضة" ${overrides[r.sku]?.importance === 'منخفضة' ? 'selected' : ''}>أهمية منخفضة</option>
      </select>
    </div>
  `).join('');
}

function quickOverride(sku, val) {
  if (val) overrides[sku] = { ...overrides[sku], class: val };
  else if (overrides[sku]) delete overrides[sku].class;
  saveOverrides();
  if (processedData.length) processData();
}

function quickOverrideImportance(sku, val) {
  if (val) overrides[sku] = { ...overrides[sku], importance: val };
  else if (overrides[sku]) delete overrides[sku].importance;
  saveOverrides();
  if (processedData.length) processData();
}

// =================== EDIT MODAL ===================
function openEdit(sku) {
  const row = processedData.find(r => r.sku === sku);
  if (!row) return;
  document.getElementById('editSku').value = sku;
  document.getElementById('editName').value = row.name;
  document.getElementById('editClass').value = overrides[sku]?.class || '';
  document.getElementById('editImportance').value = overrides[sku]?.importance || '';
  document.getElementById('editMin').value = overrides[sku]?.minQty !== undefined ? overrides[sku].minQty : '';
  document.getElementById('editLastPrice').value = overrides[sku]?.lastPrice !== undefined && overrides[sku]?.lastPrice !== null ? overrides[sku].lastPrice : '';
  document.getElementById('editNotes').value = overrides[sku]?.notes || '';
  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
}

function saveEdit() {
  const sku = document.getElementById('editSku').value;
  const cls = document.getElementById('editClass').value;
  const imp = document.getElementById('editImportance').value;
  const mn = document.getElementById('editMin').value;
  const lp = document.getElementById('editLastPrice').value;
  const notes = document.getElementById('editNotes').value.trim();
  overrides[sku] = {};
  if (cls) overrides[sku].class = cls;
  if (imp) overrides[sku].importance = imp;
  if (mn !== '') overrides[sku].minQty = parseFloat(mn);
  if (lp !== '') overrides[sku].lastPrice = parseFloat(lp);
  if (notes) overrides[sku].notes = notes;
  saveOverrides();
  closeModal();
  if (processedData.length) processData();
}

async function saveOverrides() {
  await dbSet('overrides', overrides);
}

// =================== SETTINGS ===================
async function saveSettings() {
  tierCut = [0,1,2,3,4].map(i => parseFloat(document.getElementById('cut'+i).value) || tierCut[i]);
  tierMin = [0,1,2,3,4,5].map(i => {
    const v = parseFloat(document.getElementById('min'+i).value);
    return isNaN(v) ? tierMin[i] : v;
  });
  await dbSet('settings', { tierCut, tierMin });
  if (processedData.length) processData();
  alert('✅ تم الحفظ وإعادة التصنيف');
}

// =================== HISTORY ===================
async function saveToHistory(filename) {
  history.unshift({ date: new Date().toLocaleString('ar-EG'), file: filename, count: rawData.length });
  if (history.length > 30) history.pop();
  await dbSet('history', history);
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('historyList');
  const emp = document.getElementById('emptyHistory');
  if (!history.length) { el.innerHTML = ''; emp.style.display = 'block'; return; }
  emp.style.display = 'none';
  el.innerHTML = history.map(h => `
    <div class="history-item">
      <div>
        <div style="font-size:14px;font-weight:700">${h.file}</div>
        <div class="history-date">${h.date}</div>
      </div>
      <div class="history-count">${h.count} صنف</div>
    </div>
  `).join('');
}

// =================== EXPORT ===================
function exportOrders() {
  const q = (document.getElementById('searchOrders')?.value || '').toLowerCase();
  let data = [...processedData];
  if (orderFilter === 'order') data = data.filter(r => r.needOrder);
  else if (orderFilter === 'ok') data = data.filter(r => !r.needOrder);
  else if (TIER_KEYS.includes(orderFilter)) data = data.filter(r => r.class === orderFilter);
  if (q) data = data.filter(r => r.name.includes(q) || r.sku.toLowerCase().includes(q));
  exportCSV(data, 'barq_orders');
}

function exportAll() {
  const q = (document.getElementById('searchAll')?.value || '').toLowerCase();
  let data = [...processedData];
  if (allFilter !== 'all') data = data.filter(r => r.class === allFilter);
  if (q) data = data.filter(r => r.name.includes(q) || r.sku.toLowerCase().includes(q));
  exportCSV(data, 'barq_all');
}

function exportCSV(data, name) {
  const headers = ['الاسم', 'SKU', 'الوحدة', 'الكمية', 'الحد الأدنى', 'الشريحة', 'الأهمية', 'القرار', 'آخر سعر', 'التكلفة الإجمالية'];
  const rows = data.map(r => [
    r.name, r.sku, unitLabel(r.unit), r.qty.toFixed(2), r.minQty, TIER_LABELS[r.class], r.importance || '—',
    r.needOrder ? 'اطلب' : 'لا تطلب', r.lastPrice != null ? r.lastPrice.toFixed(2) : '—', r.totalCost.toFixed(2)
  ]);
  const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// =================== TABS ===================
function showTab(name) {
  const allTabs = ['dashboard','orders','all','settings','history','ai','suppliers','po'];
  allTabs.forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === name ? 'block' : 'none';
  });
  // Fix active button by onclick attribute match
  document.querySelectorAll('.nav-btn').forEach(b => {
    const onclick = b.getAttribute('onclick') || '';
    b.classList.toggle('active', onclick.includes("'" + name + "'"));
  });
  if (name === 'settings') renderManualList();
  if (name === 'history') renderHistory();
  if (name === 'ai') refreshAITab();
  if (name === 'suppliers') renderSuppliers();
  if (name === 'po') { poPopulateSuppliers(); poLoad(); }
}

// Close modal on overlay click

// =================== AI ANALYSIS ===================
function refreshAITab() {
  if (!processedData.length) {
    document.getElementById('aiNoData').style.display = 'block';
    document.getElementById('aiReady').style.display = 'none';
  } else {
    document.getElementById('aiNoData').style.display = 'none';
    document.getElementById('aiReady').style.display = 'block';
  }
}

function runAIAnalysis() {
  const btn = document.getElementById('aiBtn');
  const loading = document.getElementById('aiLoading');
  const report = document.getElementById('aiReport');

  btn.disabled = true;
  loading.style.display = 'flex';
  report.classList.remove('visible');
  report.innerHTML = '';
  document.getElementById('aiLoadingText').textContent = 'بيحلل بياناتك...';

  setTimeout(() => {
    try {
      const total = processedData.length;
      const needOrder = processedData.filter(r => r.needOrder);
      const negStock = processedData.filter(r => r.qty < 0);
      const classA = processedData.filter(r => r.class === 'A');
      const classB = processedData.filter(r => r.class === 'B');
      const classC = processedData.filter(r => r.class === 'C');
      const classAOrder = classA.filter(r => r.needOrder);
      const totalValue = processedData.reduce((s, r) => s + r.totalCost, 0);

      // أعلى 10 أصناف من حيث القيمة (أكتر حاجة بتاخد فلوس)
      const top10Cost = [...processedData].sort((a, b) => b.totalCost - a.totalCost).slice(0, 10);

      // أصناف حرجة تحتاج طلب فوري (أولوية للأهمية اليدوية ثم الشريحة الأعلى)
      const criticalItems = [...needOrder].sort((a, b) => {
        const imp = importanceRank(a) - importanceRank(b);
        if (imp !== 0) return imp;
        return TIER_KEYS.indexOf(a.class) - TIER_KEYS.indexOf(b.class);
      }).slice(0, 15);

      // أصناف راكدة: شريحة C بس كمية عالية جداً (يعني تكلفة معدومة لكن مخزون مكدّس)
      const skuToSupplier = {};
      suppliers.forEach(s => (s.skus || []).forEach(sku => { skuToSupplier[sku] = s.name; }));
      const noSupplierItems = processedData.filter(r => r.class === 'A' && !skuToSupplier[r.sku]).slice(0, 10);

      // أصناف بكمية عالية جداً مقارنة بالحد الأدنى (احتمال تكديس/زيادة طلب)
      const overstock = processedData
        .filter(r => r.minQty > 0 && r.qty > r.minQty * 4)
        .sort((a, b) => (b.qty / (b.minQty || 1)) - (a.qty / (a.minQty || 1)))
        .slice(0, 10);

      // أقل 10 أصناف من حيث القيمة ضمن شريحة A أو B (يعني مش بتتباع كتير رغم أهميتها)
      const lowMovement = [...classA, ...classB]
        .filter(r => r.qty > 0)
        .sort((a, b) => a.totalCost - b.totalCost)
        .slice(0, 8);

      let html = `<div class="ai-meta">
        <span>📅 ${new Date().toLocaleString('ar-EG')}</span>
        <span>📦 ${total} صنف</span>
        <span>🔴 ${needOrder.length} يحتاج طلب</span>
        <span>💰 ${totalValue.toLocaleString('ar-EG', {maximumFractionDigits:0})} ج</span>
      </div>`;

      // 1) تحذيرات عاجلة
      let urgentBody = '';
      if (negStock.length) {
        urgentBody += `<li><strong>${negStock.length} صنف بمخزون سالب</strong> — خطأ في الجرد أو بيع بدون تسجيل: ${negStock.slice(0,5).map(r=>r.name).join('، ')}${negStock.length>5?' ...':''}</li>`;
      }
      if (classAOrder.length) {
        urgentBody += `<li><strong>${classAOrder.length} صنف من شريحة A</strong> (الأهم) تحتاج طلب فوري — دول بياخدوا أكبر نسبة من قيمة مخزونك</li>`;
      }
      if (!urgentBody) urgentBody = '<li>لا توجد تحذيرات عاجلة حالياً ✅</li>';
      html += aiBlock('🚨 تحذيرات عاجلة', '#d63031', urgentBody);

      // 2) أكتر الأصناف طلباً / احتياجاً (الأهم - تتكرر باستمرار)
      let orderBody = criticalItems.length
        ? criticalItems.map(r => `<li><strong>${escapeHtml(r.name)}</strong> — شريحة ${r.class} | الكمية الحالية: ${r.qty.toFixed(2)} ${r.unit||''} | الحد الأدنى: ${r.minQty}</li>`).join('')
        : '<li>لا توجد أصناف تحتاج طلب حالياً ✅</li>';
      html += aiBlock('📦 الأكتر طلباً الآن (لازم تزوّد)', '#1a7a40', orderBody);

      // 3) أصناف "مش بتتطلب" / حركة بطيئة رغم أهميتها
      let slowBody = lowMovement.length
        ? lowMovement.map(r => `<li><strong>${escapeHtml(r.name)}</strong> — شريحة ${r.class} | قيمة منخفضة نسبياً: ${r.totalCost.toLocaleString('ar-EG',{maximumFractionDigits:0})} ج رغم إنه من الأصناف المهمة</li>`).join('')
        : '<li>لا توجد ملاحظات هنا</li>';
      html += aiBlock('📉 أصناف مهمة لكن حركتها ضعيفة', '#8890a8', slowBody);

      // 4) أصناف مكدّسة (طلب زيادة عن اللزوم)
      let overBody = overstock.length
        ? overstock.map(r => `<li><strong>${escapeHtml(r.name)}</strong> — الكمية ${r.qty.toFixed(2)} مقابل حد أدنى ${r.minQty} (زيادة ${(r.qty/(r.minQty||1)).toFixed(1)}x) — قلل الطلب القادم</li>`).join('')
        : '<li>لا يوجد تكديس ملحوظ ✅</li>';
      html += aiBlock('📦➕ أصناف عندك زيادة منها (قلل الطلب)', '#e67e22', overBody);

      // 5) أعلى قيمة في المخزون
      let costBody = top10Cost.map(r => `<li><strong>${escapeHtml(r.name)}</strong> — ${r.totalCost.toLocaleString('ar-EG',{maximumFractionDigits:0})} ج | شريحة ${r.class} | كمية: ${r.qty.toFixed(2)}</li>`).join('');
      html += aiBlock('💰 أعلى 10 أصناف بتاخد فلوسك', '#0984e3', costBody);

      // 6) أصناف مهمة بدون مورد مرتبط
      let supBody = noSupplierItems.length
        ? noSupplierItems.map(r => `<li><strong>${escapeHtml(r.name)}</strong> (شريحة A) — مفيش مورد مرتبط بيه، اربطه من تاب الموردين</li>`).join('')
        : '<li>كل أصناف شريحة A مرتبطة بموردين ✅</li>';
      html += aiBlock('🏪 أصناف مهمة بدون مورد محدد', '#9b59b6', supBody);

      // 7) خلاصة عامة
      const summaryBody = `
        <li>عندك <strong>${classA.length}</strong> صنف شريحة A (الأهم) و <strong>${classB.length}</strong> شريحة B و <strong>${classC.length}</strong> شريحة C</li>
        <li>نسبة الأصناف اللي محتاجة طلب: <strong>${total ? ((needOrder.length/total)*100).toFixed(0) : 0}%</strong></li>
        <li>ركّز جهدك على شريحة A — دي اللي بتحرك أكبر قيمة في مخزونك</li>
      `;
      html += aiBlock('✅ خلاصة', '#27ae60', summaryBody);

      loading.style.display = 'none';
      btn.disabled = false;
      btn.innerHTML = '<span>🔄</span> تحديث التحليل';

      report.innerHTML = html;
      report.classList.add('visible');

    } catch (err) {
      loading.style.display = 'none';
      btn.disabled = false;
      report.innerHTML = `<div class="ai-block"><h4>❌ حدث خطأ</h4><p>${err.message}</p></div>`;
      report.classList.add('visible');
    }
  }, 400);
}

function aiBlock(title, color, bodyHtml) {
  return `<div class="ai-block" style="border-right-color:${color}"><h4 style="color:${color}">${title}</h4><ul>${bodyHtml}</ul></div>`;
}



// =================== SUPPLIERS ===================
async function saveSuppliers() {
  await dbSet('suppliers', suppliers);
}

function renderSuppliers() {
  const q = (document.getElementById('searchSup')?.value || '').toLowerCase();
  let data = suppliers;
  if (q) data = data.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.phone || '').includes(q) ||
    (s.company || '').toLowerCase().includes(q) ||
    (s.skus || []).some(sku => {
      const item = processedData.find(r => r.sku === sku);
      return item && item.name.toLowerCase().includes(q);
    })
  );
  const grid = document.getElementById('supGrid');
  const empty = document.getElementById('supEmpty');
  if (!data.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = data.map(s => {
    const linkedItems = (s.skus || []).map(sku => processedData.find(r => r.sku === sku)).filter(Boolean);
    const tags = linkedItems.slice(0, 4).map(item =>
      `<span class="sup-item-tag" onclick="BARQ_MK.openItemSupModal('${item.sku}','${item.name.replace(/'/g,"\\'")}')">📦 ${escapeHtml(item.name)}</span>`
    ).join('');
    const moreCount = linkedItems.length > 4 ? `<span class="sup-item-tag" style="background:var(--accent);color:#fff;border-color:var(--accent)">+${linkedItems.length - 4} أصناف</span>` : '';
    return `<div class="sup-card" id="sup-card-${s.id}">
      <div class="sup-card-actions">
        <button onclick="BARQ_MK.openSupModal('${s.id}')">✏️</button>
        <button onclick="BARQ_MK.deleteSupplier('${s.id}')">🗑</button>
      </div>
      <div class="sup-card-name" onclick="BARQ_MK.toggleSupDetail('${s.id}')" style="cursor:pointer">🏪 ${escapeHtml(s.name)} <span style="font-size:11px;color:var(--muted)" id="sup-arrow-${s.id}">▼</span></div>
      ${s.company ? `<div style="font-size:12px;color:var(--muted);margin-bottom:2px">🏢 ${escapeHtml(s.company)}</div>` : ''}
      <div class="sup-card-phone">📞 ${escapeHtml(s.phone) || '—'}</div>
      ${s.note ? `<div class="sup-card-note">${escapeHtml(s.note)}</div>` : ''}
      ${tags || moreCount ? `<div class="sup-card-items">${tags}${moreCount}</div>` : '<div style="font-size:12px;color:var(--muted);margin-top:8px">لا توجد أصناف مرتبطة بعد</div>'}
      <div id="sup-detail-${s.id}" style="display:none;margin-top:12px">
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px;border-top:1px solid var(--border);padding-top:10px">📦 الأصناف المرتبطة (${linkedItems.length})</div>
        ${linkedItems.length ? `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="background:var(--surface2)">
            <th style="padding:6px 8px;text-align:right;white-space:nowrap">الصنف</th>
            <th style="padding:6px 8px;text-align:right">الكمية</th>
            <th style="padding:6px 8px;text-align:right">شريحة</th>
            <th style="padding:6px 8px;text-align:right">قرار</th>
          </tr></thead>
          <tbody>${linkedItems.map(item => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:6px 8px">${escapeHtml(item.name)}</td>
            <td style="padding:6px 8px;color:${item.qty < 0 ? 'var(--red)' : item.needOrder ? 'var(--A)' : 'var(--green)'};font-weight:700">${item.qty.toFixed(2)} ${item.unit}</td>
            <td style="padding:6px 8px"><span class="badge badge-${item.class}">${item.class}</span></td>
            <td style="padding:6px 8px">${item.needOrder ? '🔴 اطلب' : '✅ لا تطلب'}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p style="color:var(--muted);font-size:12px;margin-top:4px">ما في أصناف مرتبطة — ارفع بيانات المخزون أو أضف أصناف للمورد</p>'}
      </div>
    </div>`;
  }).join('');
}

function toggleSupDetail(id) {
  const el = document.getElementById('sup-detail-' + id);
  const arrow = document.getElementById('sup-arrow-' + id);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (arrow) arrow.textContent = open ? '▲' : '▼';
}

function openSupModal(id) {
  supEditId = id || null;
  const sup = id ? suppliers.find(s => s.id === id) : null;
  document.getElementById('supModalTitle').textContent = sup ? '✏️ تعديل مورد' : '🏪 إضافة مورد';
  document.getElementById('supId').value = id || '';
  document.getElementById('supName').value = sup?.name || '';
  document.getElementById('supCompany').value = sup?.company || '';
  document.getElementById('supPhone').value = sup?.phone || '';
  document.getElementById('supNote').value = sup?.note || '';
  supLinkedSkus = sup ? [...(sup.skus || [])] : [];
  document.getElementById('supLinkSearch').value = '';
  renderSupLinkedItems();
  renderSupLinkResults();
  document.getElementById('supModal').classList.add('open');
}

function closeSupModal() {
  document.getElementById('supModal').classList.remove('open');
}

function renderSupLinkedItems() {
  const el = document.getElementById('supLinkedItems');
  if (!supLinkedSkus.length) { el.innerHTML = '<p style="color:var(--muted);font-size:12px">لا توجد أصناف مرتبطة</p>'; return; }
  el.innerHTML = supLinkedSkus.map(sku => {
    const item = processedData.find(r => r.sku === sku);
    const name = item ? item.name : sku;
    return `<div class="sup-linked-item"><span>${name}</span><button onclick="BARQ_MK.supRemoveSku('${sku}')" title="إزالة">✕</button></div>`;
  }).join('');
}

function supRemoveSku(sku) {
  supLinkedSkus = supLinkedSkus.filter(s => s !== sku);
  renderSupLinkedItems();
  renderSupLinkResults();
}

function renderSupLinkResults() {
  const q = (document.getElementById('supLinkSearch')?.value || '').toLowerCase();
  const el = document.getElementById('supLinkResults');
  if (!processedData.length) { el.innerHTML = '<p style="color:var(--muted);font-size:12px">ارفع بيانات المخزون أولاً لربط الأصناف</p>'; return; }
  let items = processedData.filter(r => !supLinkedSkus.includes(r.sku));
  if (q) items = items.filter(r => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
  items = items.slice(0, 8);
  if (!items.length) { el.innerHTML = q ? '<p style="color:var(--muted);font-size:12px">لا توجد نتائج</p>' : ''; return; }
  el.innerHTML = items.map(r => `<div class="sup-link-row" onclick="BARQ_MK.supAddSku('${r.sku}')">
    <span>${escapeHtml(r.name)}</span><span style="color:var(--accent);font-size:12px">＋ إضافة</span>
  </div>`).join('');
}

function supAddSku(sku) {
  if (!supLinkedSkus.includes(sku)) supLinkedSkus.push(sku);
  renderSupLinkedItems();
  renderSupLinkResults();
}

function saveSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { alert('اكتب اسم المورد'); return; }
  const phone = document.getElementById('supPhone').value.trim();
  const company = document.getElementById('supCompany').value.trim();
  const note = document.getElementById('supNote').value.trim();
  if (supEditId) {
    const idx = suppliers.findIndex(s => s.id === supEditId);
    if (idx !== -1) suppliers[idx] = { ...suppliers[idx], name, phone, company, note, skus: supLinkedSkus };
  } else {
    suppliers.push({ id: Date.now().toString(), name, phone, company, note, skus: supLinkedSkus });
  }
  saveSuppliers();
  closeSupModal();
  renderSuppliers();
}

function deleteSupplier(id) {
  if (!confirm('حذف هذا المورد؟')) return;
  suppliers = suppliers.filter(s => s.id !== id);
  saveSuppliers();
  renderSuppliers();
}

// =================== EXCEL IMPORT FOR SUPPLIERS ===================
function importSuppliersExcel(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      let added = 0, skipped = 0;
      rows.forEach(row => {
        const name = (row['اسم المورد'] || row['name'] || row['Name'] || '').toString().trim();
        if (!name) { skipped++; return; }
        const phone = (row['التليفون'] || row['هاتف'] || row['phone'] || row['Phone'] || '').toString().trim();
        const company = (row['الشركة'] || row['company'] || row['Company'] || '').toString().trim();
        const note = (row['ملاحظات'] || row['note'] || row['Notes'] || '').toString().trim();
        const existing = suppliers.find(s => s.name === name);
        if (existing) { skipped++; return; }
        suppliers.push({ id: Date.now().toString() + Math.random().toString(36).slice(2), name, phone, company, note, skus: [] });
        added++;
      });
      saveSuppliers();
      renderSuppliers();
      alert(`✅ تم الاستيراد بنجاح\n✔️ مضاف: ${added} مورد\n⏭️ متجاهل (مكرر/فارغ): ${skipped}`);
    } catch(err) {
      alert('❌ خطأ في قراءة الملف: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function downloadSupplierTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['اسم المورد','التليفون','الشركة','ملاحظات'],
    ['أحمد للبهارات','01001234567','شركة النيل للتوزيع','يوريد الاثنين والخميس'],
    ['مورد الألبان المركزي','01112345678','','شروط دفع 30 يوم'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'الموردين');
  XLSX.writeFile(wb, 'نموذج_الموردين.xlsx');
}

// Item → suppliers popup
function openItemSupModal(sku, name) {
  const linked = suppliers.filter(s => (s.skus || []).includes(sku));
  document.getElementById('itemSupName').textContent = name;
  const list = document.getElementById('itemSupList');
  const empty = document.getElementById('itemSupEmpty');
  if (!linked.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    list.innerHTML = linked.map(s => `
      <div class="item-sup-row">
        <span class="sup-name">🏪 ${escapeHtml(s.name)}</span>
        <div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end">
          ${s.company ? `<span style="font-size:11px;color:var(--muted)">🏢 ${escapeHtml(s.company)}</span>` : ''}
          <span class="sup-phone">📞 ${escapeHtml(s.phone) || '—'}</span>
          ${s.phone ? `<a href="tel:${escapeHtml(s.phone)}" style="font-size:12px;color:var(--accent)">اتصل</a>` : ''}
        </div>
      </div>
    `).join('');
  }
  document.getElementById('itemSupModal').classList.add('open');
}

function closeItemSupModal() {
  document.getElementById('itemSupModal').classList.remove('open');
}


// =================== شيت المكونات (مواد داخلة في تصنيع مادة أخرى) ===================
// بيتخزن في Supabase (custom_material_recipes) — مش IndexedDB زي الموردين، عشان أداة
// التسعير (tas3eer_v3_proto.html) لازم تقدر تقراه هي كمان لحساب تأثير تغيّر التكلفة
var recipeCurrentSku = null;
var recipeCurrentName = '';
var recipeItems = []; // [{id, componentSku, componentName, quantity, unit}] — للصنف المفتوح حاليًا
var recipeCompMatches = [];

async function openItemRecipeModal(sku, name) {
  recipeCurrentSku = sku;
  recipeCurrentName = name;
  document.getElementById('itemRecipeName').textContent = name;
  document.getElementById('recipeCompSearch').value = '';
  document.getElementById('recipeCompResults').style.display = 'none';
  document.getElementById('itemRecipeModal').classList.add('open');
  document.getElementById('itemRecipeList').innerHTML = '<p style="color:var(--muted);font-size:13px">⏳ جاري التحميل...</p>';
  try {
    var rows = await poSbFetch('custom_material_recipes?select=*&produced_sku=eq.' + encodeURIComponent(sku));
    recipeItems = (rows || []).map(function(r){
      return { id: r.id, componentSku: r.component_sku, componentName: r.component_name, quantity: r.quantity, unit: r.unit };
    });
  } catch(e) {
    recipeItems = [];
    showToast('⚠️ تعذر تحميل المكونات: ' + (e.message || '').slice(0, 80));
  }
  renderItemRecipeList();
}

function closeItemRecipeModal() {
  document.getElementById('itemRecipeModal').classList.remove('open');
}

function renderItemRecipeList() {
  const list = document.getElementById('itemRecipeList');
  const empty = document.getElementById('itemRecipeEmpty');
  if (!recipeItems.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = recipeItems.map(function(c, i){
    return `<div class="item-sup-row">
      <span class="sup-name">🧪 ${escapeHtml(c.componentName || c.componentSku)} <span style="color:var(--muted);font-size:11px">(${escapeHtml(c.componentSku)})</span></span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--muted)">${c.quantity != null ? c.quantity : ''} ${escapeHtml(c.unit || '')}</span>
        <button class="filter-btn" style="padding:3px 8px;font-size:11px;background:#c0392b;color:#fff" onclick="BARQ_MK.removeRecipeComponent(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function recipeComponentSearch() {
  const q = (document.getElementById('recipeCompSearch').value || '').trim().toLowerCase();
  const box = document.getElementById('recipeCompResults');
  if (!q) { box.style.display = 'none'; box.innerHTML = ''; recipeCompMatches = []; return; }
  recipeCompMatches = processedData.filter(function(p){
    return p.sku !== recipeCurrentSku &&
      !recipeItems.some(function(c){ return c.componentSku === p.sku; }) &&
      (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }).slice(0, 15);
  if (!recipeCompMatches.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--muted)">لا توجد نتائج</div>';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = recipeCompMatches.map(function(p, i){
    return `<div onclick="BARQ_MK.addRecipeComponent(${i})" style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px" onmouseover="this.style.background='var(--surface2,#f5f5f5)'" onmouseout="this.style.background=''">
      <strong>${escapeHtml(p.name)}</strong> <span style="color:var(--muted);font-size:11px">(${escapeHtml(p.sku)})</span>
    </div>`;
  }).join('');
}

async function addRecipeComponent(i) {
  const p = recipeCompMatches[i];
  if (!p) return;
  const qtyStr = prompt('الكمية المستخدمة من "' + p.name + '" في تصنيع "' + recipeCurrentName + '"؟ (اختياري)', '1');
  if (qtyStr === null) return; // المستخدم لغى
  const unitStr = prompt('الوحدة؟ (مثال: كيلو، جرام، قطعة)', unitLabel(p.unit) || '');
  const payload = {
    produced_sku: recipeCurrentSku, produced_name: recipeCurrentName,
    component_sku: p.sku, component_name: p.name,
    quantity: parseFloat(qtyStr) || null, unit: unitStr || null
  };
  try {
    const res = await poSbFetch('custom_material_recipes?on_conflict=produced_sku,component_sku', {
      method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload)
    });
    const saved = (res && res[0]) || payload;
    recipeItems.push({ id: saved.id, componentSku: p.sku, componentName: p.name, quantity: payload.quantity, unit: payload.unit });
    document.getElementById('recipeCompSearch').value = '';
    document.getElementById('recipeCompResults').style.display = 'none';
    renderItemRecipeList();
    showToast('✅ اتضاف "' + p.name + '" كمكون');
  } catch(e) {
    showToast('⚠️ فشل الحفظ: ' + (e.message || '').slice(0, 80));
  }
}

async function removeRecipeComponent(i) {
  const c = recipeItems[i];
  if (!c) return;
  if (!confirm('تشيل "' + (c.componentName || c.componentSku) + '" من مكونات "' + recipeCurrentName + '"؟')) return;
  try {
    if (c.id) await poSbFetch('custom_material_recipes?id=eq.' + c.id, { method: 'DELETE' });
    recipeItems.splice(i, 1);
    renderItemRecipeList();
  } catch(e) {
    showToast('⚠️ فشل الحذف: ' + (e.message || '').slice(0, 80));
  }
}

// =================== SAVE SNAPSHOT (replaced by exportBackup) ===================
function saveSnapshot() { exportBackup(); }

// ══════════════════════════════════════════════════════════════
// BARQ — PURCHASE ORDERS MODULE v2
// ══════════════════════════════════════════════════════════════

const PO_SB_URL = 'https://ojvbydnvywbsgyhqftap.supabase.co';
const PO_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qdmJ5ZG52eXdic2d5aHFmdGFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzODQyMDcsImV4cCI6MjA5Njk2MDIwN30.3UyyKGcmehGVxadPotOgwYF6CmDbkdb8gw7BFxlYFcU';
const PO_SB_H = {
  'apikey': PO_SB_KEY,
  'Authorization': 'Bearer ' + PO_SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// ── Toast ──
function showToast(msg, ms) {
  var t = document.getElementById('barq-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'barq-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e2235;color:white;padding:11px 22px;border-radius:22px;font-size:14px;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none;font-family:Cairo,sans-serif;white-space:nowrap;max-width:90vw;text-align:center;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.style.opacity='0'; }, ms || 3000);
}

// ── Supabase Fetch ──
async function poSbFetch(path, opts) {
  opts = opts || {};
  var r = await fetch(PO_SB_URL + '/rest/v1/' + path, Object.assign({}, opts, {
    headers: Object.assign({}, PO_SB_H, opts.headers || {})
  }));
  if (!r.ok) throw new Error(await r.text() || r.statusText);
  var t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ── Connection Status ──
function poSetStatus(state, msg) {
  var dot = document.getElementById('po-conn-dot');
  var txt = document.getElementById('po-conn-text');
  var bdg = document.getElementById('po-sb-badge');
  if (!dot) return;
  if (state === 'ok') {
    dot.style.background = '#1a7a40'; dot.style.animation = 'none';
    if (txt) txt.textContent = 'متصل';
    if (bdg) { bdg.textContent = '🟢 متصل'; bdg.style.background = '#eafaf1'; bdg.style.color = '#1a7a40'; }
  } else if (state === 'wait') {
    dot.style.background = '#d4ac0d'; dot.style.animation = 'pulse 1s infinite';
    if (txt) txt.textContent = msg || 'جاري...';
    if (bdg) { bdg.textContent = '⏳'; bdg.style.background = '#fef9e7'; bdg.style.color = '#d4ac0d'; }
  } else {
    dot.style.background = '#c0392b'; dot.style.animation = 'pulse 1s infinite';
    if (txt) txt.textContent = 'خطأ في الاتصال';
    if (bdg) { bdg.textContent = '🔴 خطأ'; bdg.style.background = '#fce4ec'; bdg.style.color = '#c0392b'; }
  }
}

// ── State ──
var poList = [];
var poItems = []; // [{sku, name, unit, qty, stock}]  — no price field
var poEditId = null;

// ── New Order ──
// ملحوظة: poItems عبارة عن "سلة" مستمرة — ممكن تتضاف لها أصناف من جدول المخزون مباشرة
// (زرار 🧾+) قبل ما تفتح "أمر جديد"، فمش بنصفرها هنا عشان محدش يفقد الأصناف اللي ضافها بالفعل.
function poNewOrder() {
  poEditId = null;
  poShowView('new');
  setTimeout(function(){
    poPopulateSuppliers();
    poRenderItemsList();
    var d = document.getElementById('po-exp-date');
    if (d && !d.value) {
      var dt = new Date(); dt.setDate(dt.getDate()+1);
      d.value = dt.toISOString().split('T')[0];
    }
  }, 30);
}

// ── Cart (from inventory tables) ──
function addToCart(sku) {
  var row = (typeof processedData !== 'undefined') ? processedData.find(function(p){ return p.sku === sku; }) : null;
  if (!row) return;
  var exists = poItems.find(function(x){ return x.sku === sku; });
  if (exists) { showToast('⚠️ الصنف موجود بالفعل في سلة أمر الشراء'); return; }
  poItems.push({ sku: row.sku, name: row.name, unit: row.unit || '', qty: 1, stock: row.qty || 0, lastPrice: row.lastPrice ?? null, lastPriceFromDC: !!row.lastPriceFromDC });
  updateCartBadge();
  poRenderItemsList();
  showToast('✅ اتضاف لسلة أمر الشراء (' + poItems.length + ' صنف) — اضغط "🧾 أوامر الشراء" للمتابعة');
}

function clearCart() {
  if (!poItems.length) return;
  if (!confirm('تفريغ سلة أمر الشراء الحالية؟')) return;
  poItems = [];
  updateCartBadge();
  poRenderItemsList();
}

function updateCartBadge() {
  if (typeof poUpdateSplitButton === 'function') poUpdateSplitButton();
  var btn = document.getElementById('btn-po');
  if (!btn) return;
  var badge = document.getElementById('poCartBadge');
  if (!poItems.length) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'poCartBadge';
    badge.style.cssText = 'background:#d63031;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:700;margin-right:6px;';
    btn.appendChild(badge);
  }
  badge.textContent = poItems.length;
}

// ── Load POs ──
async function poLoad() {
  poSetStatus('wait', 'جاري التحميل');
  try {
    var data = await poSbFetch('purchase_orders?select=*,purchase_order_items(*)&order=created_at.desc');
    poList = data || [];
    poSetStatus('ok');
    poRenderList();
  } catch(e) {
    poSetStatus('err');
    poList = [];
    poRenderList();
  }
}

// ── Gen PO Number ──
// السيستم ده مشترك بين فروع (عين شمس/البتاش)، فطول poList المحلي ممكن يكون قديم أو ناقص طلبات اتحذفت/اتفلترت.
// بنجيب أعلى رقم تسلسلي مستخدم فعليًا لنفس الشهر من السيرفر مباشرة قبل التوليد عشان نقلل فرصة تصادم رقمين POs
// في نفس اللحظة من فرعين مختلفين — الحل النهائي المضمون 100% لازم يكون sequence على مستوى قاعدة البيانات.
async function poGenNum() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth()+1).padStart(2,'0');
  var prefix = 'PO-' + y + '-' + m + '-';
  var nums = poList.map(function(p){ return p.po_number || ''; });
  try {
    var fresh = await poSbFetch('purchase_orders?select=po_number&po_number=like.' + prefix + '*');
    if (fresh) nums = nums.concat(fresh.map(function(p){ return p.po_number || ''; }));
  } catch(e) { /* لو الجلب فشل، نكمل بالأرقام المحلية المتاحة بس */ }
  var maxN = nums.reduce(function(max, num){
    if (num.indexOf(prefix) === 0) {
      var n = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max;
  }, 0);
  return prefix + String(maxN + 1).padStart(4,'0');
}

// نسخة مزامنة بس (من غير طلب سيرفر) للمعاينة/الطباعة قبل الحفظ — الرقم الحقيقي المحفوظ فعليًا بييجي من poGenNum() الأدق وقت الحفظ
function poGenNumPreview() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth()+1).padStart(2,'0');
  var prefix = 'PO-' + y + '-' + m + '-';
  var maxN = poList.reduce(function(max, p){
    var num = p.po_number || '';
    if (num.indexOf(prefix) === 0) {
      var n = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max;
  }, 0);
  return prefix + String(maxN + 1).padStart(4,'0');
}

// ── Save PO ──
async function poSave(status) {
  var supId    = (document.getElementById('po-sup-sel') || {}).value || '';
  var supTyped = (document.getElementById('po-sup-search') || {}).value || '';
  var officer  = (document.getElementById('po-officer-inp') || {}).value || '';
  var expDate  = (document.getElementById('po-exp-date') || {}).value || '';
  var notes    = (document.getElementById('po-notes-inp') || {}).value || '';

  var sups = (typeof suppliers !== 'undefined') ? suppliers : [];

  // Fallback: resolve supplier by exact typed name if no ID was set (user typed without clicking suggestion)
  if (!supId && supTyped.trim()) {
    var exactMatch = sups.find(function(s){ return (s.name||'').trim().toLowerCase() === supTyped.trim().toLowerCase(); });
    if (exactMatch) supId = exactMatch.id;
  }

  if (!supId)     { showToast('⚠️ اختار المورد من القائمة (اضغط على الاسم اللي يظهر تحت الحقل)'); return; }
  if (!officer.trim()) { showToast('⚠️ اكتب اسم المسؤول'); return; }
  if (!poItems.length) { showToast('⚠️ أضف أصناف للأمر'); return; }

  poSaveOfficerName(officer.trim());

  var sup = sups.find(function(s){ return s.id === supId; }) || {};
  var existingPO = poEditId ? poList.find(function(p){ return p.id == poEditId; }) : null;

  var po = {
    po_number: existingPO ? existingPO.po_number : await poGenNum(),
    supplier_id: supId,
    supplier_name: sup.name || '',
    officer_name: officer.trim(),
    expected_date: expDate || null,
    notes: notes,
    status: status,
    total_amount: 0,
    synced_to_pricing: status === 'sent',
    updated_at: new Date().toISOString()
  };
  if (!poEditId) po.created_at = new Date().toISOString();

  poSetStatus('wait', 'جاري الحفظ');
  try {
    var savedId;
    if (poEditId) {
      await poSbFetch('purchase_orders?id=eq.' + poEditId, { method:'PATCH', body:JSON.stringify(po) });
      savedId = poEditId;
      await poSbFetch('purchase_order_items?po_id=eq.' + poEditId, { method:'DELETE' });
    } else {
      var res = await poSbFetch('purchase_orders', { method:'POST', body:JSON.stringify(po) });
      savedId = (res && res[0]) ? res[0].id : String(Date.now());
    }

    // Save items (no price — price comes later from invoice matching)
    var itemsPayload = poItems.map(function(item){
      return {
        po_id: savedId,
        sku: item.sku || '',
        product_name: item.name || '',
        unit: item.unit || '',
        qty_ordered: parseFloat(item.qty) || 1,
        unit_price: 0,
        total_price: 0,
        current_stock: parseFloat(item.stock) || 0
      };
    });
    if (itemsPayload.length) {
      await poSbFetch('purchase_order_items', { method:'POST', body:JSON.stringify(itemsPayload) });
    }

    // ── SEND TO ALL 3 STAGES IN ONE CLICK ──
    if (status === 'sent') {
      var syncPayload = {
        po_number: po.po_number,
        po_id: String(savedId),
        supplier_name: po.supplier_name,
        officer_name: officer.trim(),
        status: 'pending_invoice_match',   // Stage 1: مطابقة فاتورة المورد
        total_amount: 0,
        items: JSON.stringify(itemsPayload),
        created_at: new Date().toISOString()
      };
      try {
        await poSbFetch('po_sync', { method:'POST', body:JSON.stringify(syncPayload) });
      } catch(e) {
        poSetStatus('err');
        showToast('\u26a0\ufe0f \u0641\u0634\u0644 \u0627\u0644\u0625\u0631\u0633\u0627\u0644: ' + (e.message||'').slice(0,100));
        return;
      }
    }

    poSetStatus('ok');
    showToast(status === 'sent' ? '📤 تم الإرسال — مطابقة فاتورة + مراجعة كميات + تسعير ✓' : '💾 تم الحفظ كمسودة ✓');
    poReset();
    await poLoad();
    poShowView('list');
  } catch(e) {
    poSetStatus('err');
    showToast('⚠️ خطأ: ' + (e.message || '').slice(0,80));
  }
}

// ── Render List ──
function poRenderList() {
  var q  = ((document.getElementById('po-search') || {}).value || '').toLowerCase();
  var sf = (document.getElementById('po-status-filter') || {}).value || '';
  var list = poList.filter(function(p){
    var match = !q || (p.po_number||'').toLowerCase().indexOf(q) >= 0 || (p.supplier_name||'').toLowerCase().indexOf(q) >= 0 || (p.officer_name||'').toLowerCase().indexOf(q) >= 0;
    var stMatch = !sf || p.status === sf;
    return match && stMatch;
  });
  var c = document.getElementById('po-list-body');
  if (!c) return;

  var stL  = { draft:'مسودة', sent:'مرسل', received:'مستلم', approved:'معتمد' };
  var stCl = { draft:'#888', sent:'#0984e3', received:'#1a7a40', approved:'#27ae60' };

  if (!list.length) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">' +
      '<div style="font-size:40px;margin-bottom:8px;">📋</div>' +
      '<div>لا توجد أوامر شراء</div>' +
      '<button class="primary-btn" style="margin-top:12px;" onclick="BARQ_MK.poNewOrder()">➕ إنشاء أول أمر</button>' +
    '</div>';
    return;
  }

  c.innerHTML = list.map(function(po) {
    var items = po.purchase_order_items || [];
    var color = stCl[po.status] || '#888';
    var syncTag = po.synced_to_pricing ?
      '<span class="po-chip" style="background:#e8f5e9;color:#1a7a40;">🔗 مرسل</span>' : '';
    return '<div style="background:var(--surface);border:1px solid var(--border);border-right:4px solid ' + color + ';border-radius:10px;padding:13px 15px;margin-bottom:9px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:4px;">' +
            '<span style="font-size:14px;font-weight:700;color:var(--accent);">' + (po.po_number||'—') + '</span>' +
            '<span class="po-chip" style="background:#f0f0f0;color:' + color + ';">' + (stL[po.status]||po.status) + '</span>' +
            syncTag +
          '</div>' +
          '<div style="font-size:12px;color:var(--muted);line-height:1.7;">' +
            '🏪 ' + escapeHtml(po.supplier_name||'—') + ' &nbsp;|&nbsp; ' +
            '👤 ' + escapeHtml(po.officer_name||'—') + ' &nbsp;|&nbsp; ' +
            '📅 ' + (po.expected_date||'—') + ' &nbsp;|&nbsp; ' +
            '📦 ' + items.length + ' صنف' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
          '<div style="display:flex;gap:5px;">' +
            '<button onclick="BARQ_MK.poViewDetail(\'' + po.id + '\')" style="padding:5px 9px;border-radius:7px;border:1px solid var(--border);background:transparent;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;">👁️ عرض</button>' +
            (po.status === 'draft' ? '<button onclick="BARQ_MK.poEdit(\'' + po.id + '\')" style="padding:5px 9px;border-radius:7px;border:1px solid var(--border);background:transparent;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;">✏️ تعديل</button>' : '') +
            '<button onclick="BARQ_MK.poPrintById(\'' + po.id + '\')" style="padding:5px 9px;border-radius:7px;border:none;background:#1a3a5c;color:white;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;">🖨️</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Search matches cache (indexed to avoid JSON in HTML) ──
var poSearchMatches = [];

// ── Search Items (shows checkboxes + Add button) ──
function poSearchItems() {
  var q = ((document.getElementById('po-item-q') || {}).value || '').toLowerCase().trim();
  var box = document.getElementById('po-search-results');
  if (!box) return;
  if (q.length < 2) { box.style.display = 'none'; box.innerHTML = ''; poSearchMatches = []; return; }

  var data = (typeof processedData !== 'undefined') ? processedData : [];
  poSearchMatches = data.filter(function(p){
    return p.name.toLowerCase().indexOf(q) >= 0 || (p.sku||'').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 30);

  if (!poSearchMatches.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">لا توجد نتائج</div>';
    return;
  }

  poRenderSearchBox();
}

function poRenderSearchBox() {
  var box = document.getElementById('po-search-results');
  if (!box) return;

  var rows = poSearchMatches.map(function(p, i){
    var alreadyIn = !!poItems.find(function(x){ return x.sku === (p.sku||'') && x.name === p.name; });
    var stockColor = (p.qty||0) <= 0 ? '#c0392b' : (p.needOrder ? '#d4ac0d' : '#1a7a40');
    var checkStyle = alreadyIn
      ? 'background:#1a7a40;border-color:#1a7a40;'
      : 'background:white;border-color:#ccc;';
    var checkMark = alreadyIn ? '✓' : '';
    return '<div class="po-check-row" onclick="BARQ_MK.poSelectRow(' + i + ')" id="po-row-' + i + '" style="' + (alreadyIn ? 'opacity:.5;' : '') + '">' +
      '<div style="width:20px;height:20px;border-radius:4px;border:2px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:13px;color:white;flex-shrink:0;transition:all .15s;' + checkStyle + '" id="po-chk-' + i + '">' + checkMark + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + p.name + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">' + (p.sku||'—') + ' | ' + unitLabel(p.unit) + '</div>' +
      '</div>' +
      '<span style="font-size:12px;font-weight:700;color:' + stockColor + ';flex-shrink:0;margin-left:8px;">' + (parseFloat(p.qty)||0).toFixed(1) + '</span>' +
    '</div>';
  }).join('');

  var selectedCount = poSearchMatches.filter(function(p, i){
    return document.getElementById('po-chk-' + i) && document.getElementById('po-chk-' + i).textContent === '✓';
  }).length;

  box.style.display = 'block';
  box.innerHTML =
    '<div style="max-height:260px;overflow-y:auto;">' + rows + '</div>' +
    '<div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--surface);">' +
      '<span id="po-sel-count" style="font-size:12px;color:var(--muted);">اختار الأصناف ثم اضغط إضافة</span>' +
      '<button onclick="BARQ_MK.poAddSelected()" style="padding:7px 18px;border-radius:8px;border:none;background:var(--accent,#1a7a40);color:white;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✅ إضافة المحدد</button>' +
    '</div>';
}

// ── Selected indices ──
var poSelectedIdx = [];

function poSelectRow(i) {
  var p = poSearchMatches[i];
  if (!p) return;
  var alreadyIn = poItems.find(function(x){ return x.sku === (p.sku||'') && x.name === p.name; });
  if (alreadyIn) return; // already added, skip

  var idx = poSelectedIdx.indexOf(i);
  var chk = document.getElementById('po-chk-' + i);
  var row = document.getElementById('po-row-' + i);
  if (idx >= 0) {
    // Deselect
    poSelectedIdx.splice(idx, 1);
    if (chk) { chk.textContent=''; chk.style.background='white'; chk.style.borderColor='#ccc'; }
    if (row) row.style.background='';
  } else {
    // Select
    poSelectedIdx.push(i);
    if (chk) { chk.textContent='✓'; chk.style.background='var(--accent,#1a7a40)'; chk.style.borderColor='var(--accent,#1a7a40)'; }
    if (row) row.style.background='var(--surface2,#f0f7f2)';
  }
  var cnt = document.getElementById('po-sel-count');
  if (cnt) cnt.textContent = poSelectedIdx.length ? poSelectedIdx.length + ' صنف محدد' : 'اختار الأصناف ثم اضغط إضافة';
}

// ── Add selected items ──
function poAddSelected() {
  if (!poSelectedIdx.length) { showToast('⚠️ لم تختر أي صنف'); return; }
  var added = 0;
  poSelectedIdx.forEach(function(i){
    var p = poSearchMatches[i];
    if (!p) return;
    var exists = poItems.find(function(x){ return x.sku === (p.sku||'') && x.name === p.name; });
    if (!exists) {
      poItems.push({ sku:p.sku||'', name:p.name, unit:p.unit||'', qty:1, stock:parseFloat(p.qty)||0, lastPrice: p.lastPrice ?? null, lastPriceFromDC: !!p.lastPriceFromDC });
      added++;
    }
  });
  poSelectedIdx = [];
  poRenderItemsList();
  updateCartBadge();
  // Clear search
  var q = document.getElementById('po-item-q'); if(q) q.value='';
  var box = document.getElementById('po-search-results'); if(box){ box.style.display='none'; box.innerHTML=''; }
  poSearchMatches = [];
  showToast('✅ تم إضافة ' + added + ' صنف');
}

// ── Add low-stock items ──
function poAddLowStock() {
  var data = (typeof processedData !== 'undefined') ? processedData : [];
  var low = data.filter(function(p){
    return p.needOrder && !poItems.find(function(i){ return i.sku === p.sku; });
  });
  if (!low.length) { showToast('لا توجد أصناف ناقصة غير مضافة'); return; }
  low.forEach(function(p){
    poItems.push({ sku:p.sku||'', name:p.name, unit:p.unit||'', qty: parseFloat(p.minQty)||1, stock: parseFloat(p.qty)||0, lastPrice: p.lastPrice ?? null, lastPriceFromDC: !!p.lastPriceFromDC });
  });
  poRenderItemsList();
  updateCartBadge();
  showToast('✅ تم إضافة ' + low.length + ' صنف ناقص');
  // Re-render search to update checkboxes
  var q = document.getElementById('po-item-q');
  if (q && q.value.length >= 2) poSearchItems();
}

// ── Render selected items as compact rows ──
function poRenderItemsList() {
  var hdr = document.getElementById('po-selected-header');
  var container = document.getElementById('po-items-list');
  var emptyMsg  = document.getElementById('po-items-empty');
  if (!container) return;

  if (!poItems.length) {
    if (hdr) hdr.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(emptyMsg || document.createTextNode(''));
    poCalcTotal();
    return;
  }

  if (hdr) hdr.style.display = 'flex';
  if (emptyMsg) emptyMsg.style.display = 'none';

  container.innerHTML = poItems.map(function(item, i){
    var stockColor = item.stock <= 0 ? '#c0392b' : (item.stock < 5 ? '#d4ac0d' : '#1a7a40');
    return '<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
      // Remove button
      '<button onclick="BARQ_MK.poRemoveItem(' + i + ')" style="padding:2px 7px;border:none;background:#c0392b;color:white;border-radius:5px;cursor:pointer;font-size:12px;flex-shrink:0;">✕</button>' +
      // Name + SKU
      '<div style="flex:1;min-width:120px;">' +
        '<div style="font-size:13px;font-weight:600;">' + (item.name||'—') + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">' + (item.sku||'—') + ' | ' + unitLabel(item.unit) + ' | مخزون: <span style="color:' + stockColor + ';font-weight:700;">' + (item.stock||0).toFixed(1) + '</span>' +
          ' | آخر سعر: <strong>' + (item.lastPrice != null ? parseFloat(item.lastPrice).toFixed(2) + ' ج' : '—') + '</strong>' +
          (item.lastPriceFromDC ? ' <span style="background:#eafaf1;color:#1a7a40;border-radius:8px;padding:1px 6px;font-size:10px;">من الداتا سنتر</span>' : '') + '</div>' +
      '</div>' +
      // Qty
      '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
        '<span style="font-size:12px;color:var(--muted);">الكمية:</span>' +
        '<input type="number" value="' + (item.qty||1) + '" min="0.1" step="0.1" ' +
          'oninput="poItems[' + i + '].qty=parseFloat(this.value)||1;poCalcTotal()" ' +
          'class="po-qty-inp">' +
        '<span style="font-size:12px;color:var(--muted);">' + (item.unit||'') + '</span>' +
      '</div>' +
    '</div>';
  }).join('') +
  // Empty last row placeholder
  '<div style="padding:6px 12px;"></div>';

  poCalcTotal();
}

function poRemoveItem(i) {
  poItems.splice(i, 1);
  poRenderItemsList();
  updateCartBadge();
  // Refresh checkboxes
  var q = document.getElementById('po-item-q');
  if (q && q.value.length >= 2) poSearchItems();
}

function poCalcTotal() {
  // No prices at this stage — just show item count
  var el = document.getElementById('po-grand-tot');
  if (el) el.textContent = poItems.length + ' صنف';
}

// =================== توزيع سلة الشراء على الموردين ===================
// السلة ممكن تتجمع من موردين مختلفين (من قرارات الطلب/كل الأصناف) — هنا بنقسّمها
// لمجموعات حسب المورد المرتبط بكل SKU، وبنسيب اللي بلا مورد أو المرتبط بأكتر من مورد
// عشان المستخدم يحددهم يدويًا قبل ما ينشئ أمر شراء منفصل لكل مورد.
var poPendingSplit = null;   // باقي أصناف السلة اللي لسه محتاجة أمر شراء لموردها بعد إنشاء أمر لمورد واحد
var poSplitAssign = {};      // sku -> supplierId (تحديد يدوي مؤقت للأصناف بلا مورد أو بأكتر من مورد)

function poCartGroups() {
  var sups = (typeof suppliers !== 'undefined') ? suppliers : [];
  var groups = {};      // supplierId -> items[]
  var unassigned = [];  // مفيش مورد مرتبط بيه، ومفيش تحديد يدوي
  var ambiguous = [];   // مرتبط بأكتر من مورد، ومفيش تحديد يدوي

  poItems.forEach(function(item){
    if (poSplitAssign[item.sku]) {
      var sid = poSplitAssign[item.sku];
      (groups[sid] = groups[sid] || []).push(item);
      return;
    }
    var matches = sups.filter(function(s){ return (s.skus||[]).includes(item.sku); });
    if (matches.length === 1) {
      (groups[matches[0].id] = groups[matches[0].id] || []).push(item);
    } else if (matches.length > 1) {
      ambiguous.push({ item: item, matches: matches });
    } else {
      unassigned.push(item);
    }
  });

  return { groups: groups, unassigned: unassigned, ambiguous: ambiguous, suppliers: sups };
}

function poUpdateSplitButton() {
  var btn = document.getElementById('btn-po-split');
  var cnt = document.getElementById('po-split-count');
  if (!btn) return;
  if (!poItems.length) { btn.style.display = 'none'; return; }
  var g = poCartGroups();
  var supplierCount = Object.keys(g.groups).length + (g.unassigned.length ? 1 : 0) + (g.ambiguous.length ? 1 : 0);
  if (supplierCount > 1) {
    btn.style.display = 'inline-block';
    if (cnt) cnt.textContent = poItems.length;
  } else {
    btn.style.display = 'none';
  }
}

function poOpenSplit() {
  poShowView('split');
  poRenderSplitView();
}

function poRenderSplitView() {
  var c = document.getElementById('po-view-split');
  if (!c) return;
  if (!poItems.length) {
    c.innerHTML = '<div class="po-card" style="text-align:center;padding:30px;color:var(--muted);">السلة فاضية</div>';
    return;
  }

  var g = poCartGroups();
  var html = '<div class="po-card"><h3 style="font-size:15px;font-weight:700;color:var(--accent);margin:0 0 10px;">🧮 توزيع السلة على الموردين</h3>' +
    '<p style="font-size:12px;color:var(--muted);margin:0 0 16px;">كل مجموعة هتتحول لأمر شراء منفصل لمورده. الأصناف اللي بلا مورد أو مرتبطة بأكتر من مورد لازم تتحدد يدويًا الأول.</p>';

  // Groups with a known single supplier
  Object.keys(g.groups).forEach(function(sid){
    var sup = g.suppliers.find(function(s){ return s.id === sid; });
    var items = g.groups[sid];
    html += '<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<strong style="font-size:14px;">🏭 ' + escapeHtml(sup ? sup.name : 'مورد محذوف') + '</strong>' +
        '<button class="primary-btn" style="padding:5px 12px;font-size:12px;" onclick="BARQ_MK.poSplitCreateOrder(\'' + sid + '\')">🧾 إنشاء أمر شراء (' + items.length + ' صنف)</button>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);">' + items.map(function(i){ return escapeHtml(i.name); }).join('، ') + '</div>' +
    '</div>';
  });

  // Ambiguous: linked to more than one supplier — quick pick
  if (g.ambiguous.length) {
    html += '<div style="border:1px solid #f0c419;background:#fffbea;border-radius:10px;padding:12px;margin-bottom:10px;">' +
      '<strong style="font-size:13px;">⚠️ أصناف مرتبطة بأكتر من مورد — حدد المورد لكل صنف</strong>';
    g.ambiguous.forEach(function(pair){
      html += '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 0;border-top:1px solid #f0e0a0;">' +
        '<span style="font-size:12px;">' + escapeHtml(pair.item.name) + '</span>' +
        '<select onchange="poSplitAssign[\'' + pair.item.sku + '\']=this.value; poRenderSplitView();" class="po-field" style="width:auto;font-size:12px;">' +
          '<option value="">اختر مورد...</option>' +
          pair.matches.map(function(s){ return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; }).join('') +
        '</select>' +
      '</div>';
    });
    html += '</div>';
  }

  // Unassigned: no supplier linked at all — manual pick + optional permanent save
  if (g.unassigned.length) {
    html += '<div style="border:1px solid #e74c3c;background:#fdf2f0;border-radius:10px;padding:12px;margin-bottom:10px;">' +
      '<strong style="font-size:13px;">🔗 أصناف بلا مورد مرتبط — حدد المورد يدويًا</strong>';
    g.unassigned.forEach(function(item){
      html += '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 0;border-top:1px solid #f5d5d0;flex-wrap:wrap;">' +
        '<span style="font-size:12px;">' + escapeHtml(item.name) + ' <span style="color:var(--muted);">(' + escapeHtml(item.sku||'—') + ')</span></span>' +
        '<div style="display:flex;align-items:center;gap:6px;position:relative;">' +
          '<input type="text" id="po-split-search-' + item.sku + '" class="po-field" autocomplete="off" placeholder="🔍 دور على المورد بالاسم..." ' +
            'style="width:170px;font-size:12px;padding:6px 8px;" oninput="BARQ_MK.poSplitSupplierSearch(\'' + item.sku + '\', this.value)">' +
          '<input type="hidden" id="po-split-sel-' + item.sku + '">' +
          '<div id="po-split-results-' + item.sku + '" style="display:none;position:absolute;top:100%;left:0;right:auto;min-width:200px;background:#fff;border:1px solid var(--border);border-radius:8px;max-height:180px;overflow-y:auto;z-index:60;box-shadow:0 6px 18px rgba(0,0,0,.12);margin-top:3px;"></div>' +
          '<button class="secondary-btn" style="padding:4px 10px;font-size:11px;" onclick="BARQ_MK.poSplitConfirmManual(\'' + item.sku + '\')">تحديد</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  html += '<button class="secondary-btn" onclick="BARQ_MK.poShowView(\'list\')">إغلاق</button></div>';
  c.innerHTML = html;
}

// ── بحث بالاسم للمورد في شاشة توزيع السلة (بدل قايمة منسدلة طويلة بكل الموردين) ──
function poSplitSupplierSearch(sku, val) {
  var box = document.getElementById('po-split-results-' + sku);
  var hidden = document.getElementById('po-split-sel-' + sku);
  if (!box) return;
  if (hidden) hidden.value = ''; // الكتابة بتلغي أي اختيار سابق لحد ما يختار من النتائج تاني
  var q = (val||'').trim().toLowerCase();
  if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }

  var sups = (typeof suppliers !== 'undefined') ? suppliers : [];
  var matches = sups.filter(function(s){
    return (s.name||'').toLowerCase().indexOf(q) >= 0 || (s.company||'').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 15);

  if (!matches.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--muted);">لا يوجد مورد بهذا الاسم</div>';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = matches.map(function(s){
    return '<div onclick="BARQ_MK.poSplitSelectSupplier(\'' + sku + '\',\'' + s.id + '\',\'' + (s.name||'').replace(/'/g,"\\'") + '\')" ' +
      'style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;" ' +
      'onmouseover="this.style.background=\'var(--surface2,#f5f5f5)\'" onmouseout="this.style.background=\'\'">' +
      escapeHtml(s.name) + (s.company ? ' <span style="color:var(--muted);font-size:11px;">(' + escapeHtml(s.company) + ')</span>' : '') +
    '</div>';
  }).join('');
}

function poSplitSelectSupplier(sku, id, name) {
  var inp = document.getElementById('po-split-search-' + sku);
  var hidden = document.getElementById('po-split-sel-' + sku);
  var box = document.getElementById('po-split-results-' + sku);
  if (inp) inp.value = name;
  if (hidden) hidden.value = id;
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function poSplitConfirmManual(sku) {
  var hidden = document.getElementById('po-split-sel-' + sku);
  if (!hidden || !hidden.value) { showToast('⚠️ ابحث عن المورد واختاره من النتائج الأول'); return; }
  poSplitAssign[sku] = hidden.value;
  // اسأل لو عايز يحفظ الربط دائمًا عشان المرة الجاية يتجمع تلقائي
  var sup = suppliers.find(function(s){ return s.id === hidden.value; });
  if (sup && confirm('تحفظ ربط "' + (poItems.find(function(i){return i.sku===sku;})||{}).name + '" بمورد "' + sup.name + '" بشكل دائم عشان يتجمع تلقائي المرة الجاية؟')) {
    sup.skus = sup.skus || [];
    if (!sup.skus.includes(sku)) sup.skus.push(sku);
    saveSuppliers();
  }
  poRenderSplitView();
}

function poSplitCreateOrder(supplierId) {
  var g = poCartGroups();
  var groupItems = g.groups[supplierId] || [];
  if (!groupItems.length) return;
  var sup = suppliers.find(function(s){ return s.id === supplierId; });

  // الباقي (من موردين تانيين) بيفضل في السلة لحد ما يتعمله أمر شراء منفصل
  var remaining = poItems.filter(function(i){ return groupItems.indexOf(i) === -1; });
  poPendingSplit = remaining;
  poItems = groupItems;
  poSplitAssign = {}; // اتستخدم بالفعل في التجميع

  poNewOrder();
  setTimeout(function(){
    var searchInp = document.getElementById('po-sup-search');
    var hidden = document.getElementById('po-sup-sel');
    if (searchInp && sup) searchInp.value = sup.name;
    if (hidden && sup) hidden.value = sup.id;
  }, 40);
}

// ── View Detail ──
function poViewDetail(id) {
  var po = poList.find(function(p){ return p.id == id; });
  if (!po) return;
  var items = po.purchase_order_items || [];
  var stL = { draft:'مسودة', sent:'مرسل', received:'مستلم', approved:'معتمد' };
  ['po-view-list','po-view-new'].forEach(function(v){ var e=document.getElementById(v); if(e) e.style.display='none'; });
  var d = document.getElementById('po-view-detail');
  if (!d) return;
  d.style.display = 'block';

  var itemsHTML = items.length ? items.map(function(item, i){
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;">' +
      '<div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">' + (i+1) + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;">' + escapeHtml(item.product_name||'—') + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">' + escapeHtml(item.sku||'—') + ' | ' + escapeHtml(item.unit||'—') + '</div>' +
      '</div>' +
      '<div style="text-align:center;min-width:60px;">' +
        '<div style="font-size:15px;font-weight:900;color:var(--accent);">' + (item.qty_ordered||0) + '</div>' +
        '<div style="font-size:10px;color:var(--muted);">مطلوب</div>' +
      '</div>' +
      '<div style="text-align:center;min-width:60px;">' +
        '<div style="font-size:13px;color:var(--muted);">' + (item.current_stock||0).toFixed(1) + '</div>' +
        '<div style="font-size:10px;color:var(--muted);">مخزون</div>' +
      '</div>' +
    '</div>';
  }).join('') :
  '<div style="text-align:center;padding:24px;color:var(--muted);">لا توجد أصناف</div>';

  d.innerHTML =
    '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">' +
      '<button class="secondary-btn" onclick="BARQ_MK.poShowView(\'list\')">← رجوع</button>' +
      '<button onclick="BARQ_MK.poPrintById(\'' + po.id + '\')" style="padding:8px 16px;border-radius:8px;border:none;background:#1a3a5c;color:white;font-family:Cairo,sans-serif;font-size:13px;cursor:pointer;">🖨️ طباعة</button>' +
    '</div>' +
    '<div class="po-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
        '<div>' +
          '<div style="font-size:16px;font-weight:700;">' + (po.po_number||'—') + '</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:2px;">👤 المسؤول: ' + escapeHtml(po.officer_name||'—') + '</div>' +
        '</div>' +
        '<span class="po-chip" style="background:#eafaf1;color:#1a7a40;font-size:13px;">' + (stL[po.status]||po.status) + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:16px;">' +
        '<div><span style="color:var(--muted);font-size:11px;display:block;">المورد</span><strong>' + escapeHtml(po.supplier_name||'—') + '</strong></div>' +
        '<div><span style="color:var(--muted);font-size:11px;display:block;">تاريخ التوريد</span><strong>' + (po.expected_date||'—') + '</strong></div>' +
        '<div><span style="color:var(--muted);font-size:11px;display:block;">ملاحظات</span>' + escapeHtml(po.notes||'—') + '</div>' +
        '<div><span style="color:var(--muted);font-size:11px;display:block;">حالة الإرسال</span>' + (po.synced_to_pricing ? '<span style="color:#1a7a40;font-weight:700;">✅ مرسل لكل المراحل</span>' : '<span style="color:#888;">مسودة</span>') + '</div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:8px;">📦 الأصناف (' + items.length + ')</div>' +
      '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">' + itemsHTML + '</div>' +
    '</div>';
}

// ── Edit PO ──
function poEdit(id) {
  var po = poList.find(function(p){ return p.id == id; });
  if (!po) return;
  poEditId = id;
  poItems = (po.purchase_order_items || []).map(function(i){
    return { sku:i.sku||'', name:i.product_name||'', unit:i.unit||'', qty:i.qty_ordered||1, stock:i.current_stock||0, lastPrice: i.unit_price || null };
  });
  poShowView('new');
  setTimeout(function(){
    var g = function(id){ return document.getElementById(id); };
    if (g('po-sup-sel'))     g('po-sup-sel').value     = po.supplier_id   || '';
    if (g('po-sup-search'))  g('po-sup-search').value  = po.supplier_name || '';
    if (g('po-officer-inp')) g('po-officer-inp').value = po.officer_name  || '';
    if (g('po-exp-date'))    g('po-exp-date').value    = po.expected_date || '';
    if (g('po-notes-inp'))   g('po-notes-inp').value   = po.notes         || '';
    poRenderItemsList();
    updateCartBadge();
  }, 60);
}

// ── Print ──
function poPrint() {
  var sups = (typeof suppliers !== 'undefined') ? suppliers : [];
  var supEl = document.getElementById('po-sup-sel');
  var sup = supEl ? (sups.find(function(s){ return s.id === supEl.value; }) || {}) : {};
  var officer = (document.getElementById('po-officer-inp') || {}).value || '—';
  var fakePO = {
    po_number: poGenNumPreview() + ' (مسودة)',
    supplier_name: sup.name || '—',
    officer_name: officer,
    expected_date: (document.getElementById('po-exp-date') || {}).value || '',
    notes: (document.getElementById('po-notes-inp') || {}).value || '',
    status: 'draft',
    purchase_order_items: poItems.map(function(i){
      return { product_name:i.name, sku:i.sku, unit:i.unit, current_stock:i.stock, qty_ordered:i.qty };
    })
  };
  poShowPrint(fakePO);
}

function poPrintById(id) {
  var po = poList.find(function(p){ return p.id == id; });
  if (po) poShowPrint(po);
}

function poShowPrint(po) {
  var items = po.purchase_order_items || [];
  var today = new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'});
  var stL = { draft:'مسودة', sent:'مرسل ومعتمد', received:'مستلم', approved:'معتمد نهائياً' };

  var itemsHTML = items.map(function(item, i){
    return '<tr style="background:' + (i%2 ? '#f8fffe' : 'white') + '">' +
      '<td style="padding:7px 10px;text-align:center;border:1px solid #e0e0e0;">' + (i+1) + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e0e0e0;">' + escapeHtml(item.product_name||item.name||'') + '</td>' +
      '<td style="padding:7px 10px;font-size:11px;color:#888;border:1px solid #e0e0e0;">' + escapeHtml(item.sku||'') + '</td>' +
      '<td style="padding:7px 10px;text-align:center;border:1px solid #e0e0e0;">' + escapeHtml(item.unit||'') + '</td>' +
      '<td style="padding:7px 10px;text-align:center;color:#888;border:1px solid #e0e0e0;">' + ((item.current_stock||0)).toFixed(1) + '</td>' +
      '<td style="padding:7px 10px;text-align:center;font-weight:700;font-size:15px;border:1px solid #e0e0e0;">' + (item.qty_ordered||item.qty||0) + '</td>' +
      '<td style="padding:7px 10px;text-align:center;border:1px solid #e0e0e0;">___________</td>' +
    '</tr>';
  }).join('');

  var printEl = document.getElementById('po-print-content');
  if (!printEl) return;
  printEl.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a7a40;padding-bottom:14px;margin-bottom:18px;">' +
      '<div>' +
        '<div style="font-size:26px;font-weight:900;color:#1a7a40;">⚡ أبو الفضل</div>' +
        '<div style="font-size:12px;color:#5a7a66;">سلسلة الجبن والمقطعات والمجمدات</div>' +
      '</div>' +
      '<div style="text-align:left;">' +
        '<div style="font-size:20px;font-weight:900;color:#1a3a5c;">' + (po.po_number||'') + '</div>' +
        '<div style="font-size:12px;color:#5a7a66;">تاريخ الإصدار: ' + today + '</div>' +
        '<div style="font-size:12px;margin-top:4px;padding:3px 8px;border-radius:10px;background:#eafaf1;color:#1a7a40;display:inline-block;">' + (stL[po.status]||po.status) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:20px;font-weight:700;text-align:center;margin-bottom:16px;color:#1a3a5c;">أمر الشراء</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px;font-size:13px;">' +
      '<div style="padding:8px 12px;background:#f0f7f2;border-radius:8px;"><span style="color:#5a7a66;font-size:11px;display:block;">المورد</span><strong>' + escapeHtml(po.supplier_name||'—') + '</strong></div>' +
      '<div style="padding:8px 12px;background:#f0f7f2;border-radius:8px;"><span style="color:#5a7a66;font-size:11px;display:block;">المسؤول / المشتري</span><strong>' + escapeHtml(po.officer_name||'—') + '</strong></div>' +
      '<div style="padding:8px 12px;background:#f0f7f2;border-radius:8px;"><span style="color:#5a7a66;font-size:11px;display:block;">تاريخ التوريد المتوقع</span><strong>' + (po.expected_date||'—') + '</strong></div>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">' +
      '<thead><tr style="background:#1a7a40;color:white;">' +
        '<th style="padding:9px 10px;border:1px solid #1a7a40;">#</th>' +
        '<th style="padding:9px 10px;text-align:right;border:1px solid #1a7a40;">اسم الصنف</th>' +
        '<th style="padding:9px 10px;text-align:right;border:1px solid #1a7a40;">SKU</th>' +
        '<th style="padding:9px 10px;border:1px solid #1a7a40;">الوحدة</th>' +
        '<th style="padding:9px 10px;border:1px solid #1a7a40;">المخزون الحالي</th>' +
        '<th style="padding:9px 10px;border:1px solid #1a7a40;">الكمية المطلوبة</th>' +
        '<th style="padding:9px 10px;border:1px solid #1a7a40;">الكمية المستلمة</th>' +
      '</tr></thead>' +
      '<tbody>' + itemsHTML + '</tbody>' +
    '</table>' +
    (po.notes ? '<div style="padding:10px 14px;background:#f9f9f9;border-radius:8px;font-size:13px;margin-bottom:18px;"><strong>ملاحظات:</strong> ' + escapeHtml(po.notes) + '</div>' : '') +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:30px;">' +
      '<div style="border-top:2px solid #333;padding-top:8px;text-align:center;font-size:12px;">المورد / المستلم<br><br><br>التوقيع: ___________</div>' +
      '<div style="border-top:2px solid #333;padding-top:8px;text-align:center;font-size:12px;">المراجع<br><br><br>التوقيع: ___________</div>' +
      '<div style="border-top:2px solid #333;padding-top:8px;text-align:center;font-size:12px;">المدير<br><br><br>التوقيع: ___________</div>' +
    '</div>';

  document.getElementById('po-print-frame').style.display = 'block';
}

// ── Show sub-views ──
function poShowView(view) {
  ['list','new','detail','split'].forEach(function(v){
    var el = document.getElementById('po-view-' + v);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  if (view === 'list') { poRenderList(); }
  var sr = document.getElementById('po-search-results');
  if (view !== 'new' && sr) { sr.style.display='none'; sr.innerHTML=''; }
}

function poCancelNew() {
  // لو جايين من "توزيع السلة" وألغى قبل ما يحفظ، رجّع باقي الأصناف (لموردين تانيين) للسلة
  if (poPendingSplit && poPendingSplit.length) {
    poItems = poItems.concat(poPendingSplit);
    poPendingSplit = null;
    updateCartBadge();
  }
  poShowView('list');
}

function poReset() {
  // لو جايين من تدفق "توزيع السلة على الموردين"، رجّع باقي الأصناف (لموردين تانيين) للسلة بدل ما تتمسح
  poItems = (poPendingSplit && poPendingSplit.length) ? poPendingSplit : [];
  poPendingSplit = null;
  poEditId = null;
  ['po-sup-search','po-sup-sel','po-officer-inp','po-exp-date','po-notes-inp','po-item-q'].forEach(function(id){
    var e = document.getElementById(id); if(e) e.value='';
  });
  var sr = document.getElementById('po-search-results'); if(sr){sr.style.display='none';sr.innerHTML='';}
  var spr = document.getElementById('po-sup-results'); if(spr){spr.style.display='none';spr.innerHTML='';}
  var ofr = document.getElementById('po-officer-results'); if(ofr){ofr.style.display='none';ofr.innerHTML='';}
  poRenderItemsList();
  updateCartBadge();
}

// ── Supplier searchable typeahead ──
function poSupplierSearch() {
  var inp = document.getElementById('po-sup-search');
  var box = document.getElementById('po-sup-results');
  var hidden = document.getElementById('po-sup-sel');
  if (!inp || !box) return;
  var q = inp.value.trim().toLowerCase();
  var sups = (typeof suppliers !== 'undefined') ? suppliers : [];

  if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }

  var matches = sups.filter(function(s){
    return (s.name||'').toLowerCase().indexOf(q) >= 0 || (s.company||'').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 15);

  if (!matches.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--muted);">لا يوجد مورد بهذا الاسم — تأكد من الإملاء</div>';
    if (hidden) hidden.value = '';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = matches.map(function(s){
    return '<div onclick="BARQ_MK.poSelectSupplier(\'' + s.id + '\',\'' + (s.name||'').replace(/'/g,"\\'") + '\')" ' +
      'style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;" ' +
      'onmouseover="this.style.background=\'var(--surface2,#f5f5f5)\'" onmouseout="this.style.background=\'\'">' +
      '<strong>' + escapeHtml(s.name) + '</strong>' + (s.company ? ' <span style="color:var(--muted);font-size:11px;">(' + escapeHtml(s.company) + ')</span>' : '') +
    '</div>';
  }).join('');
}

function poSelectSupplier(id, name) {
  var inp = document.getElementById('po-sup-search');
  var hidden = document.getElementById('po-sup-sel');
  var box = document.getElementById('po-sup-results');
  if (inp) inp.value = name;
  if (hidden) hidden.value = id;
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

// ── Officer/buyer searchable typeahead with local memory ──
function poGetOfficersList() {
  try {
    var raw = localStorage.getItem('barq_officers_list');
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}
function poSaveOfficerName(name) {
  name = (name||'').trim();
  if (!name) return;
  var list = poGetOfficersList();
  if (list.indexOf(name) === -1) {
    list.push(name);
    try { localStorage.setItem('barq_officers_list', JSON.stringify(list)); } catch(e) {}
  }
}

function poOfficerSearch() {
  var inp = document.getElementById('po-officer-inp');
  var box = document.getElementById('po-officer-results');
  if (!inp || !box) return;
  var q = inp.value.trim().toLowerCase();
  var list = poGetOfficersList();

  if (!q) {
    if (!list.length) { box.style.display='none'; box.innerHTML=''; return; }
    box.style.display = 'block';
    box.innerHTML = list.map(function(name){
      return '<div onclick="BARQ_MK.poSelectOfficer(\'' + name.replace(/'/g,"\\'") + '\')" ' +
        'style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;" ' +
        'onmouseover="this.style.background=\'var(--surface2,#f5f5f5)\'" onmouseout="this.style.background=\'\'">' + escapeHtml(name) + '</div>';
    }).join('');
    return;
  }

  var matches = list.filter(function(name){ return name.toLowerCase().indexOf(q) >= 0; });
  box.style.display = 'block';

  var html = matches.map(function(name){
    return '<div onclick="BARQ_MK.poSelectOfficer(\'' + name.replace(/'/g,"\\'") + '\')" ' +
      'style="padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;" ' +
      'onmouseover="this.style.background=\'var(--surface2,#f5f5f5)\'" onmouseout="this.style.background=\'\'">' + escapeHtml(name) + '</div>';
  }).join('');

  var exactMatch = list.some(function(n){ return n.toLowerCase() === q; });
  if (!exactMatch) {
    html += '<div onclick="BARQ_MK.poSelectOfficer(\'' + inp.value.trim().replace(/'/g,"\\'") + '\')" ' +
      'style="padding:9px 12px;cursor:pointer;font-size:13px;color:var(--accent);font-weight:700;" ' +
      'onmouseover="this.style.background=\'var(--surface2,#f5f5f5)\'" onmouseout="this.style.background=\'\'">' +
      '➕ إضافة "' + escapeHtml(inp.value.trim()) + '" كاسم جديد</div>';
  }
  box.innerHTML = html;
}

function poSelectOfficer(name) {
  var inp = document.getElementById('po-officer-inp');
  var box = document.getElementById('po-officer-results');
  if (inp) inp.value = name;
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  poSaveOfficerName(name);
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e){
  var supBox = document.getElementById('po-sup-results');
  var supInp = document.getElementById('po-sup-search');
  if (supBox && supBox.style.display!=='none' && e.target!==supInp && !supBox.contains(e.target)) {
    supBox.style.display = 'none';
  }
  var offBox = document.getElementById('po-officer-results');
  var offInp = document.getElementById('po-officer-inp');
  if (offBox && offBox.style.display!=='none' && e.target!==offInp && !offBox.contains(e.target)) {
    offBox.style.display = 'none';
  }
});

// ── Populate supplier dropdown (kept for backward-compat calls; now no-op on select) ──
function poPopulateSuppliers() {
  // Legacy no-op — supplier field is now a searchable typeahead (see poSupplierSearch above)
}

// ── Test connection on load ──
window.addEventListener('load', function(){
  setTimeout(function(){
    poSbFetch('purchase_orders?select=id&limit=1')
      .then(function(){ poSetStatus('ok'); })
      .catch(function(){ poSetStatus('err'); });
  }, 1500);
});


function bindModalCloseHandlers() {
  document.getElementById('editModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
  document.getElementById('supModal').addEventListener('click', function(e) { if (e.target === this) closeSupModal(); });
  document.getElementById('itemSupModal').addEventListener('click', function(e) { if (e.target === this) closeItemSupModal(); });
  document.getElementById('itemRecipeModal').addEventListener('click', function(e) { if (e.target === this) closeItemRecipeModal(); });
}

// ============================================================
// نقطة الدمج مع الغلاف الموحّد — الإضافة الوحيدة اللي مش موجودة في
// makhzoun_v2.html الأصلي. الملف ده أصلًا مفيهوش أي تسجيل دخول (كان
// مفتوح بالكامل)، فمفيش جسر مع BARQ_AUTH مطلوب هنا. التعديل الوحيد:
// (1) استدعاءات addEventListener + استدعاء renderHistory() اليتيم اللي
// كانوا بيتنفذوا فور تحميل السكريبت (وبيفترضوا إن عناصر الـ DOM بتاعتهم
// موجودة) بقوا جوه mount()، (2) سلسلة التهيئة (openDB/loadAllData/
// syncDataCenter) بقت جوه initModuleData() بدل ما تتنفذ فور تحميل السكريبت.
// ============================================================
function mount(container) {
  container.innerHTML = BARQ_MK_MARKUP;
  bindModalCloseHandlers();
  renderHistory();
  initModuleData();
}


  return {
    addRecipeComponent: addRecipeComponent,
    addToCart: addToCart,
    aiBlock: aiBlock,
    applySettingsToInputs: applySettingsToInputs,
    bindModalCloseHandlers: bindModalCloseHandlers,
    classifyPct: classifyPct,
    clearCart: clearCart,
    closeItemRecipeModal: closeItemRecipeModal,
    closeItemSupModal: closeItemSupModal,
    closeModal: closeModal,
    closeSupModal: closeSupModal,
    dbGet: dbGet,
    dbSet: dbSet,
    deleteSupplier: deleteSupplier,
    downloadSupplierTemplate: downloadSupplierTemplate,
    drawChart: drawChart,
    escapeHtml: escapeHtml,
    exportAll: exportAll,
    exportBackup: exportBackup,
    exportCSV: exportCSV,
    exportOrders: exportOrders,
    fetchAllPaginated: fetchAllPaginated,
    flashSaved: flashSaved,
    importBackup: importBackup,
    importSuppliersExcel: importSuppliersExcel,
    importanceRank: importanceRank,
    initModuleData: initModuleData,
    loadAllData: loadAllData,
    loadDcCurrentCost: loadDcCurrentCost,
    loadDcSupplierLinks: loadDcSupplierLinks,
    loadStockFromDataCenter: loadStockFromDataCenter,
    mount: mount,
    openDB: openDB,
    openEdit: openEdit,
    openItemRecipeModal: openItemRecipeModal,
    openItemSupModal: openItemSupModal,
    openSupModal: openSupModal,
    poAddLowStock: poAddLowStock,
    poAddSelected: poAddSelected,
    poCalcTotal: poCalcTotal,
    poCancelNew: poCancelNew,
    poCartGroups: poCartGroups,
    poEdit: poEdit,
    poGenNum: poGenNum,
    poGenNumPreview: poGenNumPreview,
    poGetOfficersList: poGetOfficersList,
    poLoad: poLoad,
    poNewOrder: poNewOrder,
    poOfficerSearch: poOfficerSearch,
    poOpenSplit: poOpenSplit,
    poPopulateSuppliers: poPopulateSuppliers,
    poPrint: poPrint,
    poPrintById: poPrintById,
    poRemoveItem: poRemoveItem,
    poRenderItemsList: poRenderItemsList,
    poRenderList: poRenderList,
    poRenderSearchBox: poRenderSearchBox,
    poRenderSplitView: poRenderSplitView,
    poReset: poReset,
    poSave: poSave,
    poSaveOfficerName: poSaveOfficerName,
    poSbFetch: poSbFetch,
    poSearchItems: poSearchItems,
    poSelectOfficer: poSelectOfficer,
    poSelectRow: poSelectRow,
    poSelectSupplier: poSelectSupplier,
    poSetStatus: poSetStatus,
    poShowPrint: poShowPrint,
    poShowView: poShowView,
    poSplitConfirmManual: poSplitConfirmManual,
    poSplitCreateOrder: poSplitCreateOrder,
    poSplitSelectSupplier: poSplitSelectSupplier,
    poSplitSupplierSearch: poSplitSupplierSearch,
    poSupplierSearch: poSupplierSearch,
    poUpdateSplitButton: poUpdateSplitButton,
    poViewDetail: poViewDetail,
    processData: processData,
    quickOverride: quickOverride,
    quickOverrideImportance: quickOverrideImportance,
    recipeComponentSearch: recipeComponentSearch,
    refreshAITab: refreshAITab,
    removeRecipeComponent: removeRecipeComponent,
    renderAll: renderAll,
    renderHistory: renderHistory,
    renderItemRecipeList: renderItemRecipeList,
    renderManualList: renderManualList,
    renderOrders: renderOrders,
    renderPager: renderPager,
    renderSupLinkResults: renderSupLinkResults,
    renderSupLinkedItems: renderSupLinkedItems,
    renderSuppliers: renderSuppliers,
    runAIAnalysis: runAIAnalysis,
    saveEdit: saveEdit,
    saveOverrides: saveOverrides,
    saveSettings: saveSettings,
    saveSnapshot: saveSnapshot,
    saveSupplier: saveSupplier,
    saveSuppliers: saveSuppliers,
    saveToHistory: saveToHistory,
    setAllFilter: setAllFilter,
    setOrderFilter: setOrderFilter,
    setSyncStatus: setSyncStatus,
    showTab: showTab,
    showToast: showToast,
    sortAllBy: sortAllBy,
    sortBy: sortBy,
    supAddSku: supAddSku,
    supRemoveSku: supRemoveSku,
    syncDataCenter: syncDataCenter,
    toggleSupDetail: toggleSupDetail,
    unitLabel: unitLabel,
    updateCartBadge: updateCartBadge,
    updateSummary: updateSummary,
    mount: mount
  };
})();

window.BARQ_MODULES = window.BARQ_MODULES || {};
window.BARQ_MODULES['purchasing'] = { mount: BARQ_MK.mount };

"use strict";
/* لوحة المدير: تعديل المنيو وإدارة الحسابات (بتظهر لدور manager بس) */
window.Admin = (function () {
  var $ = function (i) { return document.getElementById(i); };
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function req(url, method, body) { return SadaAPI.call(url, method || "GET", body); }
  function field(ph, val, type, w) { var i = el("input"); i.type = type || "text"; i.placeholder = ph; i.value = val == null ? "" : val; i.setAttribute("aria-label", ph); i.style.border = "1px solid var(--line)"; if (w) i.style.maxWidth = w; return i; }
  function button(txt, cls, fn) { var b = el("button", "btn " + (cls || ""), txt); b.type = "button"; b.onclick = function () { b.disabled = true; Promise.resolve(fn()).then(function () { b.disabled = false; }, function (e) { b.disabled = false; msg(e.message); }); }; return b; }
  var msgT = null;
  function msg(t) { var m = $("admmsg"); if (!m) return; m.textContent = t; clearTimeout(msgT); msgT = setTimeout(function () { m.textContent = ""; }, 5000); }

  /* ----- المنيو ----- */
  function drawMenu() {
    var box = $("vm"); box.innerHTML = "";
    box.appendChild(el("p", "sub", "أي تعديل هنا بيظهر للزبون على طول من غير ما تلمس الكود. الأصناف الموقوفة بتختفي من المنيو وبتفضل محفوظة."));
    box.appendChild(el("p", "nonote")).id = "admmsg";
    req("/api/admin/menu").then(function (menu) {
      var cats = Object.keys(menu), dl = el("datalist"); dl.id = "catlist";
      cats.forEach(function (c) { var o = el("option"); o.value = c; dl.appendChild(o); }); box.appendChild(dl);

      var add = el("div", "card"); add.appendChild(el("h3", "", "إضافة صنف جديد"));
      var fc = field("القسم", "", "text"), fn = field("اسم الصنف", ""), fd = field("وصف قصير", ""), fp = field("السعر", "", "number", "120px"), fx = field("خصم % (اختياري)", "", "number", "160px");
      fx.min = 0; fx.max = 90; fx.inputMode = "numeric";
      fc.setAttribute("list", "catlist"); fp.min = 0; fp.inputMode = "numeric";
      var r1 = el("div", "row2"); r1.appendChild(fc); r1.appendChild(fn);
      var r2 = el("div", "row2"); r2.appendChild(fd); r2.appendChild(fp);
      add.appendChild(r1); add.appendChild(r2); add.appendChild(fx); add.appendChild(el("br"));
      add.appendChild(button("إضافة", "", function () {
        return req("/api/admin/menu", "POST", { category: fc.value, name: fn.value, descr: fd.value, price: fp.value, discount: fx.value || 0 }).then(drawMenu);
      }));
      box.appendChild(add);

      cats.forEach(function (c) {
        box.appendChild(el("h3", "", c));
        menu[c].forEach(function (it) {
          var cd = el("div", "card"), n = field("الاسم", it.name), d = field("الوصف", it.descr), p = field("السعر", it.price, "number", "120px"), k = field("القسم", it.category), x = field("خصم % على الصنف", it.discount || "", "number", "160px");
          k.setAttribute("list", "catlist"); p.min = 0; p.inputMode = "numeric"; x.min = 0; x.max = 90; x.inputMode = "numeric";
          if (!it.active) cd.style.opacity = ".6";
          var a = el("div", "row2"); a.appendChild(n); a.appendChild(p);
          var b = el("div", "row2"); b.appendChild(d); b.appendChild(k);
          cd.appendChild(a); cd.appendChild(b); cd.appendChild(x);
          var hint = el("div", "meta"); function upd() { var pc = Number(x.value) || 0, pr = Number(p.value) || 0; hint.textContent = pc ? "الزبون هيشوفه بـ " + Math.round(pr * (100 - pc) / 100) + " ج.م بدل " + pr + " ج.م" : ""; }
          x.oninput = p.oninput = upd; upd(); cd.appendChild(hint);
          var acts = el("div", "acts");
          acts.appendChild(button("حفظ", "", function () {
            return req("/api/admin/menu/" + it.id, "PATCH", { name: n.value, descr: d.value, price: p.value, category: k.value, discount: x.value || 0 }).then(function () { msg("اتحفظ: " + n.value); });
          }));
          acts.appendChild(button(it.active ? "إيقاف" : "تفعيل", "red", function () {
            return req("/api/admin/menu/" + it.id, "PATCH", { active: !it.active }).then(drawMenu);
          }));
          acts.appendChild(button("حذف", "red", function () {
            if (!confirm("تحذف «" + it.name + "» نهائيًا؟ (لو عايز تخفيه بس استخدم إيقاف)")) return Promise.resolve();
            return req("/api/admin/menu/" + it.id, "DELETE").then(drawMenu);
          }));
          cd.appendChild(acts); box.appendChild(cd);
        });
      });
    }).catch(function (e) { msg(e.message); });
  }


  /* ----- المبيعات ----- */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtDate(ts) { var d = new Date(ts); return iso(d); }
  function fmtTime(ts) { var d = new Date(ts), h = d.getHours(); return pad(h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " ص" : " م"); }
  var salesRange = null, lastSales = null;
  function drawSales(range) {
    var box = $("vs"); salesRange = range || salesRange || { from: iso(new Date()), to: iso(new Date()) };
    box.innerHTML = "";
    box.appendChild(el("p", "sub", "الطلبات اللي اتسلّمت بس هي اللي بتتحسب فلوس داخلة. كل طلب مكتوب عليه حساب اللي سلّمه والتاريخ والساعة."));
    box.appendChild(el("p", "nonote")).id = "admmsg";
    var bar = el("div", "card"), fr = field("من", salesRange.from, "date"), to = field("إلى", salesRange.to, "date");
    var r = el("div", "row2"); r.appendChild(fr); r.appendChild(to); bar.appendChild(r);
    var acts = el("div", "acts");
    acts.appendChild(button("عرض", "", function () { drawSales({ from: fr.value, to: to.value || fr.value }); return Promise.resolve(); }));
    function q(txt, days) { acts.appendChild(button(txt, "red", function () { var e = new Date(), s = new Date(); s.setDate(s.getDate() - days); drawSales({ from: iso(s), to: iso(days == 1 ? s : e) }); return Promise.resolve(); })); }
    q("النهارده", 0); q("امبارح", 1); q("آخر 7 أيام", 6); q("آخر 30 يوم", 29);
    acts.appendChild(button("تصدير Excel", "red", function () { exportCsv(); return Promise.resolve(); }));
    bar.appendChild(acts); box.appendChild(bar);
    req("/api/admin/sales?from=" + salesRange.from + "&to=" + salesRange.to).then(function (d) {
      lastSales = d;
      var st = el("div", "stats");
      [[d.total + " ج.م", "إجمالي الفلوس الداخلة"], [d.count, "عدد الطلبات"], [d.discounts + " ج.م", "خصومات الأكواد"], [d.count ? Math.round(d.total / d.count) + " ج.م" : "0 ج.م", "متوسط الطلب"]].forEach(function (p) { var s = el("div", "stat"); s.appendChild(el("b", "", p[0])); s.appendChild(document.createTextNode(p[1])); st.appendChild(s); });
      box.appendChild(st);
      var pay = d.byPayment || {cash:0,card:0,instapay:0};
      var payStats = el("div", "stats");
      [[d.total + " ج.م", "إجمالي المبيعات"],[pay.cash + " ج.م", "إجمالي الكاش"],[pay.card + " ج.م", "إجمالي الفيزا"],[pay.instapay + " ج.م", "إجمالي إنستا باي"]].forEach(function(p){var st=el("div","stat");st.appendChild(el("b","",p[0]));st.appendChild(document.createTextNode(p[1]));payStats.appendChild(st);});
      box.appendChild(el("h3", "", "المبيعات حسب طريقة الدفع")); box.appendChild(payStats);
      box.appendChild(el("h3", "", "حسب الحساب"));
      if (!d.byUser.length) box.appendChild(el("p", "nonote", "مفيش مبيعات في المدة دي."));
      d.byUser.forEach(function (u) { var c = el("div", "card"), t = el("div", "top"); t.appendChild(el("span", "", u.username)); t.appendChild(el("span", "price", u.total + " ج.م")); c.appendChild(t); c.appendChild(el("div", "meta", u.count + " طلب")); box.appendChild(c); });
      if (d.byDay.length > 1) {
        box.appendChild(el("h3", "", "حسب اليوم"));
        d.byDay.forEach(function (x) { var c = el("div", "card"), t = el("div", "top"); t.appendChild(el("span", "", x.day)); t.appendChild(el("span", "price", x.total + " ج.م")); c.appendChild(t); c.appendChild(el("div", "meta", x.count + " طلب")); box.appendChild(c); });
      }
      box.appendChild(el("h3", "", "كل الطلبات"));
      d.orders.forEach(function (o) {
        var c = el("div", "card"), t = el("div", "top");
        t.appendChild(el("span", "", "#" + o.id + " — " + o.place + " — " + o.name)); t.appendChild(el("span", "price", o.total + " ج.م")); c.appendChild(t);
        c.appendChild(el("div", "meta", "📅 " + fmtDate(o.at) + "   🕒 " + fmtTime(o.at) + "   👤 " + (o.by || "غير مسجّل")));
        c.appendChild(el("div", "meta", o.items.map(function (i) { return i.n + " × " + i.q; }).join("، ")));
        if (o.promo) c.appendChild(el("div", "meta", "🏷️ كود " + o.promo + " (−" + o.discount + " ج.م)"));
        c.appendChild(el("div", "meta", "💳 الدفع: " + (o.payment_method === "card" ? "فيزا" : o.payment_method === "instapay" ? "إنستا باي" : "كاش")));
        if (o.notes) c.appendChild(el("div", "need", "📝 ملحوظة: " + o.notes));
        box.appendChild(c);
      });
    }).catch(function (e) { msg(e.message); });
  }
  function csvCell(v) { v = String(v); return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }
  function exportCsv() {
    if (!lastSales) return;
    var rows = [["رقم الطلب", "التاريخ", "الساعة", "الحساب", "المكان", "الاسم", "الأصناف", "كود الخصم", "قيمة الخصم", "طريقة الدفع", "ملحوظة", "الإجمالي"]];
    lastSales.orders.forEach(function (o) { rows.push([o.id, fmtDate(o.at), fmtTime(o.at), o.by || "غير مسجّل", o.place, o.name, o.items.map(function (i) { return i.n + " × " + i.q; }).join(" | "), o.promo, o.discount, o.payment_method || "cash", o.notes || "", o.total]); });
    var csv = "\ufeff" + rows.map(function (r) { return r.map(function (c) { return '"' + csvCell(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
    var a = el("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "sales-" + lastSales.from + "_" + lastSales.to + ".csv"; a.click();
  }


  /* ----- العروض وأكواد الخصم ----- */
  function drawPromos() {
    var box = $("vp"); box.innerHTML = "";
    box.appendChild(el("p", "sub", "خصم الصنف بتحطه من تاب المنيو (خانة «خصم %»). هنا أكواد خصم الزبون بيكتبها على الطلب كله."));
    box.appendChild(el("p", "nonote")).id = "admmsg";
    var add = el("div", "card"); add.appendChild(el("h3", "", "كود جديد"));
    var code = field("الكود (مثلًا SADA10)", ""), kind = el("select"), val = field("القيمة", "", "number"), min = field("حد أدنى للطلب (اختياري)", "", "number"), mx = field("أقصى عدد استخدامات (فاضي = مفتوح)", "", "number"), ex = field("ينتهي يوم (اختياري)", "", "date");
    code.autocapitalize = "characters"; kind.setAttribute("aria-label", "نوع الخصم"); kind.style.border = "1px solid var(--line)";
    [["percent", "نسبة %"], ["fixed", "مبلغ ثابت (ج.م)"]].forEach(function (r) { var o = el("option", "", r[1]); o.value = r[0]; kind.appendChild(o); });
    [val, min, mx].forEach(function (i) { i.min = 0; i.inputMode = "numeric"; });
    var r1 = el("div", "row2"); r1.appendChild(code); r1.appendChild(kind); var r2 = el("div", "row2"); r2.appendChild(val); r2.appendChild(min); var r3 = el("div", "row2"); r3.appendChild(mx); r3.appendChild(ex);
    add.appendChild(r1); add.appendChild(r2); add.appendChild(r3);
    add.appendChild(button("إضافة الكود", "", function () {
      return req("/api/admin/promos", "POST", { code: code.value, kind: kind.value, value: val.value, min_total: min.value || 0, max_uses: mx.value || 0, expires: ex.value }).then(drawPromos);
    }));
    box.appendChild(add);
    req("/api/admin/promos").then(function (list) {
      if (!list.length) box.appendChild(el("p", "nonote", "مفيش أكواد لسه."));
      list.forEach(function (x) {
        var cd = el("div", "card"), t = el("div", "top"), expired = x.expires && x.expires < iso(new Date()), full = x.max_uses && x.used >= x.max_uses;
        if (!x.active || expired || full) cd.style.opacity = ".6";
        t.appendChild(el("span", "", x.code)); t.appendChild(el("span", "tag", x.kind == "percent" ? x.value + "%" : x.value + " ج.م")); cd.appendChild(t);
        cd.appendChild(el("div", "meta", "استُخدم " + x.used + (x.max_uses ? " من " + x.max_uses : " مرة") + (x.min_total ? " — من " + x.min_total + " ج.م" : "") + (x.expires ? " — ينتهي " + x.expires : "") + (expired ? " (منتهي)" : full ? " (خلص)" : !x.active ? " (موقوف)" : "")));
        var acts = el("div", "acts");
        acts.appendChild(button(x.active ? "إيقاف" : "تفعيل", "red", function () { return req("/api/admin/promos/" + x.id, "PATCH", { active: !x.active }).then(drawPromos); }));
        acts.appendChild(button("حذف", "red", function () { if (!confirm("تحذف الكود " + x.code + "؟")) return Promise.resolve(); return req("/api/admin/promos/" + x.id, "DELETE").then(drawPromos); }));
        cd.appendChild(acts); box.appendChild(cd);
      });
    }).catch(function (e) { msg(e.message); });
  }

  /* ----- الحسابات ----- */
  function drawUsers() {
    var box = $("vu"); box.innerHTML = "";
    box.appendChild(el("p", "sub", "المدير يقدر يعدّل المنيو ويدير الحسابات. الباريستا يشوف الطلبات والحجوزات بس."));
    box.appendChild(el("p", "nonote")).id = "admmsg";
    var add = el("div", "card"); add.appendChild(el("h3", "", "حساب جديد"));
    var u = field("اسم المستخدم (إنجليزي)", ""), p = field("كلمة السر (8 حروف على الأقل)", "", "password"), role = el("select");
    u.autocapitalize = "none"; p.autocomplete = "new-password"; role.setAttribute("aria-label", "الدور"); role.style.border = "1px solid var(--line)";
    [["barista", "باريستا"], ["manager", "مدير"]].forEach(function (r) { var o = el("option", "", r[1]); o.value = r[0]; role.appendChild(o); });
    var r1 = el("div", "row2"); r1.appendChild(u); r1.appendChild(p); add.appendChild(r1); add.appendChild(role); add.appendChild(el("br"));
    add.appendChild(button("إضافة الحساب", "", function () {
      return req("/api/admin/users", "POST", { username: u.value, password: p.value, role: role.value }).then(drawUsers);
    }));
    box.appendChild(add);
    req("/api/admin/users").then(function (list) {
      list.forEach(function (x) {
        var cd = el("div", "card"), t = el("div", "top");
        t.appendChild(el("span", "", x.username)); t.appendChild(el("span", "tag", x.role == "manager" ? "مدير" : "باريستا")); cd.appendChild(t);
        cd.appendChild(el("div", "meta", "آخر دخول: " + (x.last_login ? fmtDate(x.last_login) + " — " + fmtTime(x.last_login) : "لسه ما دخلش")));
        cd.appendChild(el("div", "meta", "النهارده: سلّم " + x.today_orders + " طلب بإجمالي " + x.today_total + " ج.م"));
        var np = field("كلمة سر جديدة", "", "password"); np.autocomplete = "new-password"; cd.appendChild(np);
        var acts = el("div", "acts");
        acts.appendChild(button("تغيير كلمة السر", "", function () { return req("/api/admin/users/" + x.id, "PATCH", { password: np.value }).then(function () { np.value = ""; msg("اتغيّرت كلمة سر " + x.username); }); }));
        if (!window.ME || x.username != window.ME.username) acts.appendChild(button("حذف", "red", function () {
          if (!confirm("تحذف حساب " + x.username + "؟")) return Promise.resolve();
          return req("/api/admin/users/" + x.id, "DELETE").then(drawUsers);
        }));
        cd.appendChild(acts); box.appendChild(cd);
      });
    }).catch(function (e) { msg(e.message); });
  }

  /* ----- إعدادات الدفع: تظهر للمدير فقط وتتحمى كمان بسياسات قاعدة البيانات ----- */
  function drawPaymentSettings() {
    var box=$("vpay"); box.innerHTML="";
    box.appendChild(el("h3","","بيانات الدفع والاستلام"));
    box.appendChild(el("p","sub","البيانات دي خاصة بالمدير فقط. الباريستا مش هيشوف رقم الحساب البنكي أو إنستا باي هنا."));
    box.appendChild(el("p","nonote")).id="paymsg";
    req("/api/admin/payment-settings").then(function(d){
      var card=el("div","card"), bank=field("اسم البنك",d.bank_name), account=field("رقم الحساب / IBAN",d.bank_account), insta=field("رقم إنستا باي",d.instapay_number);
      card.appendChild(el("label","","اسم البنك")); card.appendChild(bank);
      card.appendChild(el("label","","رقم الحساب البنكي أو IBAN")); card.appendChild(account);
      card.appendChild(el("label","","رقم إنستا باي للتحويل")); card.appendChild(insta);
      card.appendChild(button("حفظ بيانات الدفع","",function(){return req("/api/admin/payment-settings","PATCH",{bank_name:bank.value,bank_account:account.value,instapay_number:insta.value}).then(function(){ $("paymsg").textContent="تم حفظ بيانات الدفع."; });}));
      box.appendChild(card);
    }).catch(function(e){$("paymsg").textContent=e.message;});
  }

  return {
    init: function (me) { window.ME = me; if (me.role == "manager") [].forEach.call(document.querySelectorAll(".mgr"), function (b) { b.hidden = false; }); },
    show: function (t) { t == "m" ? drawMenu() : t == "s" ? drawSales() : t == "p" ? drawPromos() : t == "pay" ? drawPaymentSettings() : drawUsers(); },
    reset: function () {
      [].forEach.call(document.querySelectorAll(".mgr"), function (b) { b.hidden = true; });
      $("vm").hidden = $("vu").hidden = $("vs").hidden = $("vp").hidden = $("vpay").hidden = true; $("vp").innerHTML = ""; $("vm").innerHTML = $("vu").innerHTML = $("vs").innerHTML = $("vpay").innerHTML = ""; salesRange = lastSales = null;
      window.tab = "o"; $("vo").hidden = false; $("vb").hidden = true;
      [].forEach.call($("btabs").children, function (x) { if (x.dataset.v) x.setAttribute("aria-selected", x.dataset.v == "o"); });
    }
  };
})();

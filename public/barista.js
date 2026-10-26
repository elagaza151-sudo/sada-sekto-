"use strict";
var $ = function (i) { return document.getElementById(i); };
var O = [], B = [], es = null, seenO = {}, seenB = {}, firstO = true, firstB = true, tab = "o", unseen = { o: 0, b: 0 }, muted = false;
try { muted = localStorage.getItem("sada_muted") == "1"; } catch (e) {}
function api(url, opt) {
  opt = opt || {};
  return SadaAPI.call(url, opt.method || (opt.body ? "POST" : "GET"), opt.body).catch(function (e) { if (e.status == 401 && url != "/api/login") showLogin(); throw e; });
}
function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
function ago(ts) { var m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? "دلوقتي" : "من " + m + " د"; }
function btn(txt, cls, fn) { var b = el("button", "btn " + (cls || ""), txt); b.type = "button"; b.onclick = function () { b.disabled = true; fn().catch(function () { b.disabled = false; }); }; return b; }
function link(txt, href, cls) { var a = el("a", "btn " + (cls || ""), txt); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }
var NEXT = { new: ["prep", "ابدأ التحضير"], prep: ["ready", "جاهز"], ready: ["done", "تم التسليم"] };

/* ----- الصوت والتنبيهات ----- */
function sndLabel() {
  var b = $("snd");
  b.textContent = muted ? "🔕 الصوت مقفول" : (window.Sound && Sound.running() ? "🔔 الصوت شغّال" : "🔔 اضغط لتفعيل الصوت");
}
$("snd").onclick = function () {
  if (!muted && !(Sound.running())) { Sound.unlock().then(function () { Sound.play("test"); sndLabel(); }); return; }
  muted = !muted; try { localStorage.setItem("sada_muted", muted ? "1" : "0"); } catch (e) {}
  if (!muted) Sound.unlock().then(function () { Sound.play("test"); sndLabel(); });
  sndLabel();
};
function notify(kind, n) {
  if (!muted && window.Sound) Sound.play(kind == "o" ? "order" : "booking");
  if (tab != kind) { unseen[kind] += n; }
  updateTabs();
}
function updateTabs() {
  var no = O.filter(function (o) { return o.status == "new"; }).length, nb = B.filter(function (b) { return b.status == "pending"; }).length;
  [["o", no], ["b", nb]].forEach(function (p) {
    var k = p[0], n = p[1], badge = $(k == "o" ? "bo" : "bb"), t = $("tab-" + k);
    badge.textContent = n; badge.hidden = !n;
    t.classList.toggle("alert", unseen[k] > 0 && tab != k);
  });
  document.title = (no + nb ? "(" + (no + nb) + ") " : "") + "شاشة الباريستا — ساده سكتو";
}

/* ----- الرسم ----- */
function draw() {
  ["new", "prep", "ready"].forEach(function (s) {
    var c = $("c-" + s); c.innerHTML = "";
    O.filter(function (o) { return o.status == s; }).forEach(function (o) {
      var cd = el("div", "card" + (s == "new" ? " new" : "")), t = el("div", "top");
      t.appendChild(el("span", "", "#" + o.id + " — " + o.place + " — " + o.name)); t.appendChild(el("span", "price", o.total + " ج.م")); cd.appendChild(t);
      var u = el("ul"); o.items.forEach(function (i) { u.appendChild(el("li", "", i.n + " × " + i.q)); }); cd.appendChild(u);
      if (o.promo) cd.appendChild(el("div", "meta", "🏷️ كود " + o.promo + " (−" + o.discount + " ج.م)"));
      cd.appendChild(el("div", "meta", ago(o.ts)));
      var nx = NEXT[s]; cd.appendChild(btn(nx[1], "", function () { return api("/api/orders/" + o.id, { method: "PATCH", body: { status: nx[0] } }); }));
      if (s == "new") cd.appendChild(btn("إلغاء", "red", function () { return api("/api/orders/" + o.id, { method: "DELETE" }); }));
      c.appendChild(cd);
    });
    if (!c.children.length) c.appendChild(el("p", "nonote", "مفيش طلبات."));
  });
  var done = O.filter(function (o) { return o.status == "done"; });
  $("s1").textContent = O.length - done.length; $("s2").textContent = done.length;
  $("s3").textContent = done.reduce(function (a, o) { return a + o.total; }, 0) + " ج.م";
  $("s4").textContent = B.filter(function (b) { return b.status != "no"; }).length;
  ["pending", "ok", "no"].forEach(function (s) {
    var c = $("b-" + s); c.innerHTML = "";
    B.filter(function (b) { return b.status == s; }).forEach(function (b) {
      var cd = el("div", "card" + (s == "pending" ? " new" : "")), t = el("div", "top"), ph = String(b.phone).replace(/\D/g, "");
      t.appendChild(el("span", "", b.name)); t.appendChild(el("span", "tag", b.guests + " أفراد")); cd.appendChild(t);
      cd.appendChild(el("div", "meta", b.date + " — " + b.time)); cd.appendChild(el("div", "meta", "📞 " + ph));
      if (s == "pending") cd.appendChild(el("div", "need", "كلّم العميل قبل التأكيد"));
      var acts = el("div", "acts");
      if (s != "no") { acts.appendChild(link("اتصال", "tel:" + ph, "red")); acts.appendChild(link("واتساب", "https://wa.me/2" + ph, "red")); }
      if (s != "ok") acts.appendChild(btn("تأكيد", "", function () { return api("/api/bookings/" + b.id, { method: "PATCH", body: { status: "ok" } }); }));
      if (s != "no") acts.appendChild(btn("إلغاء", "red", function () { return api("/api/bookings/" + b.id, { method: "PATCH", body: { status: "no" } }); }));
      cd.appendChild(acts); c.appendChild(cd);
    });
    if (!c.children.length) c.appendChild(el("p", "nonote", "مفيش حجوزات."));
  });
  updateTabs();
}

/* ----- تحميل البيانات (وكشف الجديد) ----- */
function fresh(list, seen, first, pred) {
  var added = list.filter(function (x) { return !seen[x.id] && pred(x); }).length;
  list.forEach(function (x) { seen[x.id] = 1; });
  return first ? 0 : added;
}
function loadOrders() {
  return api("/api/orders").then(function (r) {
    var n = fresh(r, seenO, firstO, function (o) { return o.status == "new"; }); firstO = false; O = r; draw(); if (n) notify("o", n);
  }).catch(function () {});
}
function loadBookings() {
  return api("/api/bookings").then(function (r) {
    var n = fresh(r, seenB, firstB, function (b) { return b.status == "pending"; }); firstB = false; B = r; draw(); if (n) notify("b", n);
  }).catch(function () {});
}
function showLogin() { ME = null; window.Admin && Admin.reset(); if (es) es.close(); es = null; $("app").hidden = true; $("out").hidden = true; $("login").hidden = false; firstO = firstB = true; seenO = {}; seenB = {}; }
var ME = null;
function showApp() {
  api("/api/me").then(function (m) { ME = m; window.Admin && Admin.init(m); }).catch(function () {});
  $("login").hidden = true; $("app").hidden = false; $("out").hidden = false; sndLabel();
  loadOrders(); loadBookings();
  if (es) es.close();
  es = SadaAPI.stream();
  es.addEventListener("orders", loadOrders); es.addEventListener("bookings", loadBookings);
  es.onopen = function () { $("live").hidden = true; loadOrders(); loadBookings(); };
  es.onerror = function () { $("live").hidden = false; };
}
$("lf").onsubmit = function (e) {
  e.preventDefault(); $("err").textContent = ""; Sound.unlock();
  api("/api/login", { body: { username: $("un").value, password: $("pw").value } }).then(function () { $("pw").value = ""; showApp(); }).catch(function (x) { $("err").textContent = x.message; });
};
$("out").onclick = function () { api("/api/logout", { method: "POST", body: {} }).then(showLogin); };
[].forEach.call($("btabs").children, function (b) {
  if (!b.dataset.v) return;
  b.onclick = function () {
    tab = b.dataset.v; unseen[tab] = 0;
    [].forEach.call($("btabs").children, function (x) { if (x.dataset.v) x.setAttribute("aria-selected", x == b); });
    $("vo").hidden = tab != "o"; $("vb").hidden = tab != "b"; $("vm").hidden = tab != "m"; $("vu").hidden = tab != "u"; $("vs").hidden = tab != "s"; $("vp").hidden = tab != "p";
    if (window.Admin && (tab == "m" || tab == "u" || tab == "s" || tab == "p")) Admin.show(tab);
    updateTabs();
  };
});
setInterval(function () { if (!$("app").hidden) { draw(); sndLabel(); } }, 30000);
addEventListener("click", function () { setTimeout(sndLabel, 50); });
api("/api/me").then(showApp).catch(function () {});

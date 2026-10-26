"use strict";
var M = {}, cart = {}, cat = "", $ = function (i) { return document.getElementById(i); };
function api(url, opt) { opt = opt || {}; return SadaAPI.call(url, opt.method || (opt.body ? "POST" : "GET"), opt.body); }
function tabs() {
  var t = $("tabs"); t.innerHTML = "";
  Object.keys(M).forEach(function (k) {
    var b = document.createElement("button"); b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", k == cat); b.textContent = k;
    b.onclick = function () { cat = k; tabs(); list(); }; t.appendChild(b);
  });
}
function list() {
  var u = $("items"); u.innerHTML = "";
  (M[cat] || []).forEach(function (p) {
    var l = document.createElement("li");
    l.innerHTML = '<div class="t"><b></b><small></small></div><span class="price"></span><button class="add" type="button" aria-label="أضف">+</button>';
    l.querySelector("b").textContent = p[0]; l.querySelector("small").textContent = p[1]; var pr = l.querySelector(".price"); pr.textContent = p[2] + " ج.م";
    if (p[3]) { var old = document.createElement("s"); old.textContent = p[3] + " ج.م"; old.style.cssText = "opacity:.6;margin-inline-end:6px;font-weight:400"; pr.prepend(old); }
    l.querySelector(".add").onclick = function () { cart[p[0]] = cart[p[0]] || { n: 0, p: p[2] }; cart[p[0]].n++; $("sent").textContent = ""; draw(); };
    u.appendChild(l);
  });
}
function sum() { var s = 0; for (var k in cart) s += cart[k].n * cart[k].p; return s; }
function draw() {
  var c = $("cart"), k = Object.keys(cart); c.innerHTML = "";
  k.forEach(function (n) {
    var it = cart[n], l = document.createElement("li");
    l.innerHTML = '<span></span><span><button class="rm" type="button" aria-label="شيل">−</button></span>';
    l.firstChild.textContent = n + " × " + it.n + " (" + it.n * it.p + ")";
    l.querySelector(".rm").onclick = function () { if (--it.n < 1) delete cart[n]; draw(); };
    c.appendChild(l);
  });
  $("empty").style.display = k.length ? "none" : "block"; $("total").textContent = sum() + " ج.م"; $("send").disabled = !k.length;
  recheckPromo();
}
var promo = { code: "", discount: 0 };
function cartItems() { return Object.keys(cart).map(function (n) { return { n: n, q: cart[n].n }; }); }
function showPromo(msg) {
  $("pm").textContent = msg || "";
  $("dl").hidden = !promo.discount; $("dv").textContent = "−" + promo.discount + " ج.م";
  $("total").textContent = (sum() - promo.discount) + " ج.م";
}
function recheckPromo() {
  if (!promo.code) return showPromo("");
  if (!Object.keys(cart).length) { promo.discount = 0; return showPromo("الكود محفوظ، ضيف أصناف عشان يتطبّق."); }
  api("/api/promo/check", { body: { items: cartItems(), code: promo.code } }).then(function (r) { promo.discount = r.discount; showPromo("تم تطبيق الكود " + promo.code + " ✅"); })
    .catch(function (e) { promo = { code: "", discount: 0 }; showPromo(e.message); });
}
$("pa").onclick = function () {
  var v = $("pc").value.trim().toUpperCase();
  if (!v) { promo = { code: "", discount: 0 }; return showPromo(""); }
  if (!Object.keys(cart).length) return showPromo("ضيف أصناف الأول وبعدين طبّق الكود.");
  promo.code = v; recheckPromo();
};
var STL = { new: "الطلب وصل للباريستا", prep: "بيتحضّر دلوقتي", ready: "جاهز، اتفضل استلمه", done: "اتسلّم، بالهنا والشفا" }, orderPoll = null, bookPoll = null, toastT = null, baseTitle = document.title;
function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function toast(msg, sound, sticky) {
  var t = $("toast"); $("toastTx").textContent = msg; t.hidden = false; clearTimeout(toastT);
  if (!sticky) toastT = setTimeout(function () { t.hidden = true; }, 12000);
  if (sound && window.Sound) Sound.play(sound);
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  if (document.hidden) document.title = "🔔 " + msg;
}
$("toastX").onclick = function () { $("toast").hidden = true; };
document.addEventListener("visibilitychange", function () { if (!document.hidden) document.title = baseTitle; });

function watchOrder(o) {
  clearInterval(orderPoll); var s = $("sent"), last = o.last || null;
  function tick() {
    api("/api/orders/track/" + o.ref).then(function (x) {
      s.textContent = "طلبك رقم " + o.id + ": " + (STL[x.status] || "");
      if (x.status != last) {
        last = x.status; o.last = last; store("sada_order", o);
        if (x.status == "prep") toast("طلبك رقم " + o.id + " بدأنا نحضّره", "test");
        if (x.status == "ready") toast("طلبك رقم " + o.id + " جاهز، اتفضل استلمه ☕", "ready", true);
      }
      if (x.status == "done") { clearInterval(orderPoll); store("sada_order", null); }
    }).catch(function (e) { if (/مش موجود/.test(e.message)) { clearInterval(orderPoll); store("sada_order", null); } });
  }
  tick(); orderPoll = setInterval(tick, 5000);
}
function watchBooking(b) {
  clearInterval(bookPoll); var o = $("ok");
  function tick() {
    api("/api/bookings/track/" + b.ref).then(function (x) {
      if (x.status == "ok") {
        o.style.display = "block"; o.textContent = "✅ تم تأكيد حجزك يوم " + x.date + " الساعة " + x.time + ". منتظرينك!";
        toast("تم تأكيد حجزك يوم " + x.date + " الساعة " + x.time + " ✅", "ready", true);
        clearInterval(bookPoll); store("sada_booking", null);
      } else if (x.status == "no") {
        o.style.display = "block"; o.textContent = "للأسف الحجز اتلغى. كلّمنا على 0100 000 0000 ونرتّب ميعاد تاني.";
        toast("للأسف حجزك اتلغى، كلّمنا نرتّب ميعاد تاني", "test", true);
        clearInterval(bookPoll); store("sada_booking", null);
      }
    }).catch(function (e) { if (/مش موجود/.test(e.message)) { clearInterval(bookPoll); store("sada_booking", null); } });
  }
  tick(); bookPoll = setInterval(tick, 8000);
}
$("send").onclick = function () {
  var items = Object.keys(cart).map(function (n) { return { n: n, q: cart[n].n }; }), s = $("sent"), b = $("send");
  if (window.Sound) Sound.unlock();
  b.disabled = true; s.textContent = "بنبعت طلبك...";
  api("/api/orders", { body: { items: items, name: $("on").value, place: $("ot").value, code: promo.code } }).then(function (r) {
    cart = {}; promo = { code: "", discount: 0 }; $("pc").value = ""; draw(); var o = { id: r.id, ref: r.ref, last: "new" }; store("sada_order", o); watchOrder(o);
  }).catch(function (e) { s.textContent = e.message; b.disabled = false; });
};
$("bf").onsubmit = function (e) {
  e.preventDefault(); var o = $("ok"); o.style.display = "block"; o.textContent = "بنسجّل حجزك...";
  if (window.Sound) Sound.unlock();
  api("/api/bookings", { body: { name: $("bn").value, phone: $("bp").value, date: $("bd").value, time: $("bt").value, guests: $("bg").value } })
    .then(function (r) {
      o.textContent = "تمام يا " + $("bn").value + "، حجزك اتسجّل ومستنيين تأكيد الكافيه. هنكلمك على الرقم، وأول ما يتأكّد هيظهر لك هنا (سيب الصفحة مفتوحة).";
      $("bf").reset(); $("bt").value = "19:00"; var b = { ref: r.ref }; store("sada_booking", b); watchBooking(b);
    }).catch(function (e) { o.textContent = e.message; });
};
(function () { var d = new Date(), p = function (n) { return n < 10 ? "0" + n : "" + n; }; $("bd").min = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })();
// QR الطاولة: ?t=طاولة 3 بيختار مكان الاستلام أوتوماتيك
(function () { try { var t = new URLSearchParams(location.search).get("t"); if (t) [].forEach.call($("ot").options, function (o) { if (o.text === t) $("ot").value = o.value; }); } catch (e) {} })();
(function () { var h = new Date().getHours(), on = h >= 8; if (on) $("dot").classList.add("on"); $("st").textContent = on ? "فاتحين دلوقتي حتى 12 بالليل" : "هنفتح الساعة 8 الصبح"; })();
api("/api/menu").then(function (m) { M = m; cat = Object.keys(M)[0]; tabs(); list(); draw(); }).catch(function () { $("items").textContent = "مقدرناش نحمّل المنيو، حدّث الصفحة."; });

(function () { var o = load("sada_order"), b = load("sada_booking"); if (o && o.ref) watchOrder(o); if (b && b.ref) { $("ok").style.display = "block"; $("ok").textContent = "حجزك مستني تأكيد الكافيه..."; watchBooking(b); } })();

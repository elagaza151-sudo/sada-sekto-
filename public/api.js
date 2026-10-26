"use strict";
/* طبقة الاتصال بـ Supabase: بتحاكي نفس مسارات /api القديمة عشان باقي الواجهة تفضل زي ما هي */
window.SadaAPI = (function () {
  var cfg = window.SADA_CONFIG || {}, DOMAIN = "@sada.example.com", sb = null;
  if (window.supabase && cfg.url && cfg.anonKey && cfg.url.indexOf("YOUR_") < 0) {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  function E(m, status) { var e = new Error(m); e.status = status || 400; return e; }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dayStart(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }

  // بيحوّل أي رد من Supabase لنتيجة أو خطأ بنفس شكل الـ API القديم
  function unwrap(r) {
    if (r.error) {
      var er = r.error, c = er.code || "", m = er.message || "";
      if (c === "23505") throw E("الاسم أو الكود موجود قبل كده.", 409);
      if (c === "42501" || c === "PGRST301" || /JWT|permission denied/i.test(m)) throw E("لازم تسجّل دخول.", 401);
      if (/fetch|network|load failed/i.test(m)) throw E("مفيش اتصال بالإنترنت، جرّب تاني.", 0);
      throw E("حصلت مشكلة، جرّب تاني.", 500);
    }
    if (r.data && typeof r.data === "object" && !Array.isArray(r.data) && r.data.error) throw E(r.data.error, 400);
    return r.data;
  }
  function rpc(fn, args) { return sb.rpc(fn, args || {}).then(unwrap); }
  function session() {
    return sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session; if (!s) throw E("لازم تسجّل دخول.", 401); return s;
    });
  }
  function staff(fn) { return function () { var a = arguments; return session().then(function () { return fn.apply(null, a); }); }; }

  function profile(uid) {
    return sb.from("profiles").select("username,role").eq("id", uid).maybeSingle().then(unwrap);
  }
  function me() {
    return session().then(function (s) {
      return profile(s.user.id).then(function (p) {
        if (!p) return sb.auth.signOut({ scope: "local" }).then(function () { throw E("لازم تسجّل دخول.", 401); });
        return { ok: true, role: p.role, username: p.username };
      });
    });
  }
  function login(b) {
    var u = clean(b.username || "barista", 30).toLowerCase(), bad = E("اسم المستخدم أو كلمة السر غلط.", 401);
    if (!/^[a-z0-9_.-]{3,30}$/.test(u)) return Promise.reject(bad);
    return sb.auth.signInWithPassword({ email: u + DOMAIN, password: String(b.password == null ? "" : b.password) }).then(function (r) {
      if (r.error) { if (/fetch|network/i.test(r.error.message)) throw E("مفيش اتصال بالإنترنت، جرّب تاني.", 0); throw bad; }
      return profile(r.data.user.id).then(function (p) {
        if (!p) return sb.auth.signOut({ scope: "local" }).then(function () { throw bad; });
        sb.rpc("touch_login").then(function () {}, function () {});
        return { ok: true, role: p.role, username: p.username };
      });
    });
  }

  /* ----- منيو ----- */
  function menuErr(m) {
    if (!m.category || !m.name || !(m.price >= 0 && m.price <= 100000)) return "راجع القسم والاسم والسعر.";
    if (!(m.discount >= 0 && m.discount <= 90)) return "الخصم لازم يكون من 0 لـ 90%.";
    return null;
  }
  function publicMenu() {
    return sb.from("menu_items").select("*").eq("active", true).order("pos").order("id").then(unwrap).then(function (rows) {
      var out = {};
      rows.forEach(function (r) {
        var eff = Math.round(r.price * (100 - (r.discount || 0)) / 100);
        (out[r.category] = out[r.category] || []).push(r.discount ? [r.name, r.descr, eff, r.price] : [r.name, r.descr, r.price]);
      });
      return out;
    });
  }
  function adminMenu() {
    return sb.from("menu_items").select("*").order("pos").order("id").then(unwrap).then(function (rows) {
      var out = {}; rows.forEach(function (r) { (out[r.category] = out[r.category] || []).push(r); }); return out;
    });
  }
  function menuAdd(b) {
    var m = { category: clean(b.category, 40), name: clean(b.name, 60), descr: clean(b.descr, 120), price: Math.floor(Number(b.price)), discount: Math.floor(Number(b.discount || 0)) };
    var e = menuErr(m); if (e) return Promise.reject(E(e));
    return sb.from("menu_items").select("pos").order("pos", { ascending: false }).limit(1).then(unwrap).then(function (r) {
      m.pos = (r.length ? r[0].pos : -1) + 1;
      return sb.from("menu_items").insert(m).then(function (x) { if (x.error && x.error.code === "23505") throw E("في صنف بنفس الاسم.", 409); return unwrap(x); });
    }).then(function () { return { ok: true }; });
  }
  function menuEdit(id, b) {
    return sb.from("menu_items").select("*").eq("id", id).maybeSingle().then(unwrap).then(function (cur) {
      if (!cur) throw E("الصنف مش موجود.", 404);
      var m = {
        category: b.category === undefined ? cur.category : clean(b.category, 40), name: b.name === undefined ? cur.name : clean(b.name, 60),
        descr: b.descr === undefined ? cur.descr : clean(b.descr, 120), price: b.price === undefined ? cur.price : Math.floor(Number(b.price)),
        discount: b.discount === undefined ? cur.discount : Math.floor(Number(b.discount || 0)), active: b.active === undefined ? cur.active : !!b.active
      };
      var e = menuErr(m); if (e) throw E(e);
      return sb.from("menu_items").update(m).eq("id", id).then(function (x) { if (x.error && x.error.code === "23505") throw E("في صنف بنفس الاسم.", 409); return unwrap(x); });
    }).then(function () { return { ok: true }; });
  }

  /* ----- أكواد الخصم ----- */
  function promoFields(b) {
    return { code: clean(b.code, 30).toUpperCase().replace(/\s+/g, ""), kind: b.kind === "fixed" ? "fixed" : "percent", value: Math.floor(Number(b.value)),
      min_total: Math.floor(Number(b.min_total || 0)), max_uses: Math.floor(Number(b.max_uses || 0)), expires: clean(b.expires, 10) || null };
  }
  function promoErr(p) {
    if (!/^[A-Z0-9ء-ي_-]{3,30}$/.test(p.code)) return "الكود: 3 لـ 30 حرف أو رقم من غير مسافات.";
    if (!(p.value >= 1 && p.value <= (p.kind === "percent" ? 100 : 100000))) return p.kind === "percent" ? "النسبة من 1 لـ 100." : "قيمة الخصم غلط.";
    if (!(p.min_total >= 0 && p.max_uses >= 0)) return "راجع الحد الأدنى وعدد الاستخدامات.";
    if (p.expires && !/^\d{4}-\d{2}-\d{2}$/.test(p.expires)) return "تاريخ الانتهاء غلط.";
    return null;
  }
  function dupMsg(x) { if (x.error && x.error.code === "23505") throw E("الكود موجود.", 409); return unwrap(x); }
  function promoEdit(id, b) {
    return sb.from("promos").select("*").eq("id", id).maybeSingle().then(unwrap).then(function (cur) {
      if (!cur) throw E("الكود مش موجود.", 404);
      var p = promoFields(Object.assign({}, cur, b, { expires: b.expires === undefined ? cur.expires : b.expires })), e = promoErr(p); if (e) throw E(e);
      p.active = b.active === undefined ? cur.active : !!b.active;
      return sb.from("promos").update(p).eq("id", id).then(dupMsg);
    }).then(function () { return { ok: true }; });
  }

  /* ----- المبيعات ----- */
  function fetchAll(build) {
    var all = [];
    function page(from) { return build().range(from, from + 999).then(unwrap).then(function (r) { all = all.concat(r); return r.length === 1000 ? page(from + 1000) : all; }); }
    return page(0);
  }
  function sales(q) {
    var re = /^\d{4}-\d{2}-\d{2}$/, from = re.test(q.from) ? q.from : iso(new Date()), to = re.test(q.to) ? q.to : from;
    var a = dayStart(from), b = new Date(dayStart(to).getTime()); b.setDate(b.getDate() + 1);
    if (b - a > 366 * 86400e3 || b <= a) return Promise.reject(E("المدة غلط (أقصاها سنة)."));
    return fetchAll(function () {
      return sb.from("orders").select("id,name,place,items,total,promo,discount,done_by,done_at").eq("status", "done").gte("done_at", a.toISOString()).lt("done_at", b.toISOString()).order("done_at", { ascending: false }).order("id");
    }).then(function (rows) {
      var orders = rows.map(function (r) { return { id: r.id, name: r.name, place: r.place, items: r.items, total: r.total, promo: r.promo || "", discount: r.discount || 0, by: r.done_by || "", at: Date.parse(r.done_at) }; });
      var byUser = {}, byDay = {};
      orders.forEach(function (o) {
        var u = o.by || "غير مسجّل", d = iso(new Date(o.at));
        (byUser[u] = byUser[u] || { username: u, count: 0, total: 0 }); byUser[u].count++; byUser[u].total += o.total;
        (byDay[d] = byDay[d] || { day: d, count: 0, total: 0 }); byDay[d].count++; byDay[d].total += o.total;
      });
      var sum = function (k) { return orders.reduce(function (x, o) { return x + o[k]; }, 0); };
      return { from: from, to: to, count: orders.length, total: sum("total"), discounts: sum("discount"),
        byUser: Object.keys(byUser).map(function (k) { return byUser[k]; }).sort(function (x, y) { return y.total - x.total; }),
        byDay: Object.keys(byDay).map(function (k) { return byDay[k]; }).sort(function (x, y) { return y.day.localeCompare(x.day); }), orders: orders };
    });
  }

  /* ----- الطلبات والحجوزات ----- */
  function listOrders() {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return sb.from("orders").select("*").or("status.neq.done,updated_at.gte." + t.toISOString()).order("created_at").then(unwrap).then(function (rows) {
      return rows.map(function (r) { return { id: r.id, name: r.name, place: r.place, items: r.items, total: r.total, status: r.status, ts: Date.parse(r.created_at), promo: r.promo || "", discount: r.discount || 0 }; });
    });
  }
  function listBookings() {
    return sb.from("bookings").select("id,name,phone,date,time,guests,status,created_at").gte("date", iso(new Date())).order("date").order("time").then(unwrap);
  }

  /* ----- الراوتر ----- */
  var routes = [
    ["GET", /^\/api\/menu$/, function () { return publicMenu(); }],
    ["POST", /^\/api\/orders$/, function (m, b) { return rpc("place_order", { p_items: b.items || [], p_place: String(b.place || ""), p_name: String(b.name || ""), p_code: String(b.code || "") }); }],
    ["POST", /^\/api\/promo\/check$/, function (m, b) { return rpc("check_promo", { p_items: b.items || [], p_code: String(b.code || "") }); }],
    ["GET", /^\/api\/orders\/track\/(.+)$/, function (m) { return rpc("track_order", { p_ref: m[1] }); }],
    ["POST", /^\/api\/bookings$/, function (m, b) { return rpc("place_booking", { p_name: String(b.name || ""), p_phone: String(b.phone || ""), p_date: String(b.date || ""), p_time: String(b.time || ""), p_guests: Math.floor(Number(b.guests)) || 0 }); }],
    ["GET", /^\/api\/bookings\/track\/(.+)$/, function (m) { return rpc("track_booking", { p_ref: m[1] }); }],
    ["POST", /^\/api\/login$/, function (m, b) { return login(b || {}); }],
    ["POST", /^\/api\/logout$/, function () { return sb.auth.signOut({ scope: "local" }).then(function () { return { ok: true }; }); }],
    ["GET", /^\/api\/me$/, function () { return me(); }],
    ["GET", /^\/api\/orders$/, staff(listOrders)],
    ["PATCH", /^\/api\/orders\/(\d+)$/, staff(function (m, b) { return rpc("set_order_status", { p_id: Number(m[1]), p_status: String(b.status) }); })],
    ["DELETE", /^\/api\/orders\/(\d+)$/, staff(function (m) { return rpc("cancel_order", { p_id: Number(m[1]) }); })],
    ["GET", /^\/api\/bookings$/, staff(listBookings)],
    ["PATCH", /^\/api\/bookings\/(\d+)$/, staff(function (m, b) {
      if (["pending", "ok", "no"].indexOf(b.status) < 0) throw E("حالة غلط.");
      return sb.from("bookings").update({ status: b.status }).eq("id", Number(m[1])).select("id").then(unwrap).then(function (r) { if (!r.length) throw E("الحجز مش موجود.", 404); return { ok: true }; });
    })],
    ["GET", /^\/api\/admin\/menu$/, staff(adminMenu)],
    ["POST", /^\/api\/admin\/menu$/, staff(function (m, b) { return menuAdd(b); })],
    ["PATCH", /^\/api\/admin\/menu\/(\d+)$/, staff(function (m, b) { return menuEdit(Number(m[1]), b); })],
    ["DELETE", /^\/api\/admin\/menu\/(\d+)$/, staff(function (m) { return sb.from("menu_items").delete().eq("id", Number(m[1])).then(unwrap).then(function () { return { ok: true }; }); })],
    ["GET", /^\/api\/admin\/promos$/, staff(function () { return sb.from("promos").select("id,code,kind,value,min_total,max_uses,used,expires,active").order("id", { ascending: false }).then(unwrap); })],
    ["POST", /^\/api\/admin\/promos$/, staff(function (m, b) {
      var p = promoFields(b), e = promoErr(p); if (e) throw E(e);
      return sb.from("promos").insert(p).then(dupMsg).then(function () { return { ok: true }; });
    })],
    ["PATCH", /^\/api\/admin\/promos\/(\d+)$/, staff(function (m, b) { return promoEdit(Number(m[1]), b); })],
    ["DELETE", /^\/api\/admin\/promos\/(\d+)$/, staff(function (m) { return sb.from("promos").delete().eq("id", Number(m[1])).then(unwrap).then(function () { return { ok: true }; }); })],
    ["GET", /^\/api\/admin\/users$/, staff(function () { return rpc("admin_users"); })],
    ["POST", /^\/api\/admin\/users$/, staff(function (m, b) { return rpc("admin_create_user", { p_username: String(b.username || ""), p_pw: String(b.password == null ? "" : b.password), p_role: b.role === "manager" ? "manager" : "barista" }); })],
    ["PATCH", /^\/api\/admin\/users\/([0-9a-f-]{36})$/, staff(function (m, b) { return rpc("admin_set_password", { p_id: m[1], p_pw: String(b.password == null ? "" : b.password) }); })],
    ["DELETE", /^\/api\/admin\/users\/([0-9a-f-]{36})$/, staff(function (m) { return rpc("admin_delete_user", { p_id: m[1] }); })],
    ["GET", /^\/api\/admin\/sales$/, staff(function (m, b, q) { return sales(q); })]
  ];
  function call(url, method, body) {
    if (!sb) { console.error("config.js مش متظبط (SADA_CONFIG)"); return Promise.reject(E("الموقع لسه متظبطش.", 500)); }
    var u = String(url).split("?"), path = u[0], q = {};
    (u[1] || "").split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ""); });
    method = (method || "GET").toUpperCase();
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i], m = r[0] === method && path.match(r[1]);
      if (m) { try { return Promise.resolve(r[2](m, body || {}, q)); } catch (e) { return Promise.reject(e); } }
    }
    return Promise.reject(E("مسار غلط.", 404));
  }

  /* التحديث اللحظي: نفس واجهة EventSource اللي الباريستا بيستخدمها */
  function stream() {
    var L = { orders: [], bookings: [] }, h = { onopen: null, onerror: null };
    function fire(t) { L[t].forEach(function (f) { try { f(); } catch (e) {} }); }
    h.addEventListener = function (t, f) { (L[t] = L[t] || []).push(f); };
    if (!sb) return Object.assign(h, { close: function () {} });
    var ch = sb.channel("sada-live-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, function () { fire("orders"); })
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, function () { fire("bookings"); })
      .subscribe(function (s) {
        if (s === "SUBSCRIBED") { if (h.onopen) h.onopen(); }
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") { if (h.onerror) h.onerror(); }
      });
    var poll = setInterval(function () { fire("orders"); fire("bookings"); }, 15000); // احتياطي لو الاتصال اللحظي وقع
    h.close = function () { clearInterval(poll); try { sb.removeChannel(ch); } catch (e) {} };
    return h;
  }
  return { call: call, stream: stream };
})();

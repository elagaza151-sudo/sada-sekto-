"use strict";

var $ = function (i) {
  return document.getElementById(i);
};

var O = [], B = [], es = null, seenO = {}, seenB = {};
var firstO = true, firstB = true, tab = "o";
var unseen = { o: 0, b: 0 }, muted = false;

try {
  muted = localStorage.getItem("sada_muted") == "1";
} catch (e) {}

function api(url, opt) {
  opt = opt || {};

  return SadaAPI.call(
    url,
    opt.method || (opt.body ? "POST" : "GET"),
    opt.body
  ).catch(function (e) {
    if (e.status == 401 && url != "/api/login") {
      showLogin();
    }
    throw e;
  });
}

function el(t, c, x) {
  var e = document.createElement(t);
  if (c) e.className = c;
  if (x != null) e.textContent = x;
  return e;
}

function ago(ts) {
  var m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? "دلوقتي" : "من " + m + " د";
}

function btn(txt, cls, fn) {
  var b = el("button", "btn " + (cls || ""), txt);
  b.type = "button";

  b.onclick = function () {
    b.disabled = true;

    Promise.resolve()
      .then(fn)
      .catch(function (e) {
        console.error(e);
        alert(e.message || "حصلت مشكلة، جرّب تاني.");
      })
      .finally(function () {
        b.disabled = false;
      });
  };

  return b;
}

function link(txt, href, cls) {
  var a = el("a", "btn " + (cls || ""), txt);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function payName(v) {
  return v === "card" ? "فيزا" :
    v === "instapay" ? "إنستا باي" : "كاش";
}

function printReceipt(o) {
  var w = window.open("", "_blank", "width=420,height=650");

  if (!w) {
    alert("اسمح بفتح النوافذ المنبثقة عشان تطبع الريسيت.");
    return;
  }

  var esc = function (x) {
    return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;"
      }[c];
    });
  };

  var lines = o.items.map(function (i) {
    return "<tr><td>" + esc(i.n) + " × " + esc(i.q) +
      "</td><td>" + esc((i.p || 0) * i.q) + " ج.م</td></tr>";
  }).join("");

  var html =
    '<!doctype html><html lang="ar" dir="rtl">' +
    '<meta charset="utf-8"><title>ريسيت #' + esc(o.id) + '</title>' +
    '<style>body{font:16px Tahoma,Arial;padding:18px;color:#111}' +
    'h2,p{text-align:center}table{width:100%;border-collapse:collapse}' +
    'td{padding:8px 2px;border-bottom:1px dashed #aaa}' +
    '.total{font-size:20px;font-weight:bold;margin-top:15px}' +
    '.muted{font-size:13px}</style>' +
    '<h2>☕ ساده سكتو</h2>' +
    '<p>ريسيت طلب رقم #' + esc(o.id) + '</p>' +
    '<p>' + esc(o.place) + " — " + esc(o.name) + '</p>' +
    '<table>' + lines + '</table>' +
    '<p class="total">الإجمالي: ' + esc(o.total) + ' ج.م</p>' +
    '<p>الدفع: ' + payName(o.payment_method) + '</p>' +
    (o.notes ? '<p>ملحوظة: ' + esc(o.notes) + '</p>' : '') +
    '<p class="muted">شكرًا لزيارتكم ❤️</p>';

  html += '<scr' +
    'ipt>window.onload=function(){window.print();window.close();};</scr' +
    'ipt></html>';

  w.document.write(html);
  w.document.close();
}

var NEXT = {
  new: ["prep", "ابدأ التحضير"],
  prep: ["ready", "جاهز"],
  ready: ["done", "تم التسليم"]
};

/* الصوت والتنبيهات */

function sndLabel() {
  var b = $("snd");
  if (!b) return;

  b.textContent = muted
    ? "🔕 الصوت مقفول"
    : (window.Sound && Sound.running()
      ? "🔔 الصوت شغّال"
      : "🔔 اضغط لتفعيل الصوت");
}

var sndButton = $("snd");

if (sndButton) {
  sndButton.onclick = function () {
    if (!muted && window.Sound && !Sound.running()) {
      Sound.unlock().then(function () {
        Sound.play("test");
        sndLabel();
      });
      return;
    }

    muted = !muted;

    try {
      localStorage.setItem("sada_muted", muted ? "1" : "0");
    } catch (e) {}

    if (!muted && window.Sound) {
      Sound.unlock().then(function () {
        Sound.play("test");
        sndLabel();
      });
    }

    sndLabel();
  };
}

function notify(kind, n) {
  if (!muted && window.Sound) {
    Sound.play(kind == "o" ? "order" : "booking");
  }

  if (tab != kind) {
    unseen[kind] += n;
  }

  updateTabs();
}

function updateTabs() {
  var no = O.filter(function (o) {
    return o.status == "new";
  }).length;

  var nb = B.filter(function (b) {
    return b.status == "pending";
  }).length;

  [["o", no], ["b", nb]].forEach(function (p) {
    var k = p[0], n = p[1];
    var badge = $(k == "o" ? "bo" : "bb");
    var t = $("tab-" + k);

    if (badge) {
      badge.textContent = n;
      badge.hidden = !n;
    }

    if (t) {
      t.classList.toggle("alert", unseen[k] > 0 && tab != k);
    }
  });

  document.title =
    (no + nb ? "(" + (no + nb) + ") " : "") +
    "شاشة الباريستا — ساده سكتو";
}

/* رسم الطلبات والحجوزات */

function draw() {
  ["new", "prep", "ready"].forEach(function (s) {
    var c = $("c-" + s);
    if (!c) return;

    c.innerHTML = "";

    O.filter(function (o) {
      return o.status == s;
    }).forEach(function (o) {
      var cd = el("div", "card" + (s == "new" ? " new" : ""));
      var t = el("div", "top");

      t.appendChild(el(
        "span",
        "",
        "#" + o.id + " — " + o.place + " — " + o.name
      ));

      t.appendChild(el("span", "price", o.total + " ج.م"));
      cd.appendChild(t);

      var u = el("ul");

      (o.items || []).forEach(function (i) {
        u.appendChild(el("li", "", i.n + " × " + i.q));
      });

      cd.appendChild(u);

      cd.appendChild(el(
        "div",
        "meta",
        "💳 طريقة الدفع: " + payName(o.payment_method)
      ));

      if (o.notes) {
        cd.appendChild(el("div", "need", "📝 ملحوظة: " + o.notes));
      }

      cd.appendChild(btn("🖨️ طباعة الريسيت", "red", function () {
        printReceipt(o);
      }));

      if (o.promo) {
        cd.appendChild(el(
          "div",
          "meta",
          "🏷️ كود " + o.promo + " (−" + o.discount + " ج.م)"
        ));
      }

      cd.appendChild(el("div", "meta", ago(o.ts)));

      var nx = NEXT[s];

      cd.appendChild(btn(nx[1], "", function () {
        return api("/api/orders/" + o.id, {
          method: "PATCH",
          body: { status: nx[0] }
        }).then(loadOrders);
      }));

      if (s == "new") {
        cd.appendChild(btn("إلغاء", "red", function () {
          return api("/api/orders/" + o.id, {
            method: "DELETE"
          }).then(loadOrders);
        }));
      }

      c.appendChild(cd);
    });

    if (!c.children.length) {
      c.appendChild(el("p", "nonote", "مفيش طلبات."));
    }
  });

  var done = O.filter(function (o) {
    return o.status == "done";
  });

  if ($("s1")) $("s1").textContent = O.length - done.length;
  if ($("s2")) $("s2").textContent = done.length;

  if ($("s3")) {
    $("s3").textContent =
      done.reduce(function (a, o) {
        return a + o.total;
      }, 0) + " ج.م";
  }

  if ($("s4")) {
    $("s4").textContent = B.filter(function (b) {
      return b.status != "no";
    }).length;
  }

  ["pending", "ok", "no"].forEach(function (s) {
    var c = $("b-" + s);
    if (!c) return;

    c.innerHTML = "";

    B.filter(function (b) {
      return b.status == s;
    }).forEach(function (b) {
      var cd = el("div", "card" + (s == "pending" ? " new" : ""));
      var t = el("div", "top");
      var ph = String(b.phone || "").replace(/\D/g, "");

      t.appendChild(el("span", "", b.name));
      t.appendChild(el("span", "tag", b.guests + " أفراد"));
      cd.appendChild(t);

      cd.appendChild(el("div", "meta", b.date + " — " + b.time));
      cd.appendChild(el("div", "meta", "📞 " + ph));

      if (s == "pending") {
        cd.appendChild(el("div", "need", "كلّم العميل قبل التأكيد"));
      }

      var acts = el("div", "acts");

      if (s != "no") {
        acts.appendChild(link("اتصال", "tel:" + ph, "red"));
        acts.appendChild(link("واتساب", "https://wa.me/2" + ph, "red"));
      }

      if (s != "ok") {
        acts.appendChild(btn("تأكيد", "", function () {
          return api("/api/bookings/" + b.id, {
            method: "PATCH",
            body: { status: "ok" }
          }).then(loadBookings);
        }));
      }

      if (s != "no") {
        acts.appendChild(btn("إلغاء", "red", function () {
          return api("/api/bookings/" + b.id, {
            method: "PATCH",
            body: { status: "no" }
          }).then(loadBookings);
        }));
      }

      cd.appendChild(acts);
      c.appendChild(cd);
    });

    if (!c.children.length) {
      c.appendChild(el("p", "nonote", "مفيش حجوزات."));
    }
  });

  updateTabs();
}

/* تحميل البيانات */

function fresh(list, seen, first, pred) {
  var added = list.filter(function (x) {
    return !seen[x.id] && pred(x);
  }).length;

  list.forEach(function (x) {
    seen[x.id] = 1;
  });

  return first ? 0 : added;
}

function loadOrders() {
  return api("/api/orders").then(function (r) {
    var n = fresh(r, seenO, firstO, function (o) {
      return o.status == "new";
    });

    firstO = false;
    O = r;
    draw();

    if (n) notify("o", n);
  }).catch(function (e) {
    console.error("تحميل الطلبات:", e);
  });
}

function loadBookings() {
  return api("/api/bookings").then(function (r) {
    var n = fresh(r, seenB, firstB, function (b) {
      return b.status == "pending";
    });

    firstB = false;
    B = r;
    draw();

    if (n) notify("b", n);
  }).catch(function (e) {
    console.error("تحميل الحجوزات:", e);
  });
}

/* تسجيل الدخول والخروج */

function showLogin() {
  ME = null;

  if (window.Admin) Admin.reset();

  if (es) es.close();
  es = null;

  if ($("app")) $("app").hidden = true;
  if ($("out")) $("out").hidden = true;
  if ($("login")) $("login").hidden = false;

  firstO = firstB = true;
  seenO = {};
  seenB = {};
}

var ME = null;

function showApp() {
  api("/api/me").then(function (m) {
    ME = m;
    if (window.Admin) Admin.init(m);
  }).catch(function (e) {
    console.error("التحقق من الحساب:", e);
    if (e.status == 401) showLogin();
    else if ($("err")) $("err").textContent = e.message;
  });

  if ($("login")) $("login").hidden = true;
  if ($("app")) $("app").hidden = false;
  if ($("out")) $("out").hidden = false;

  sndLabel();
  loadOrders();
  loadBookings();

  if (es) es.close();

  es = SadaAPI.stream();

  es.addEventListener("orders", loadOrders);
  es.addEventListener("bookings", loadBookings);

  es.onopen = function () {
    if ($("live")) $("live").hidden = true;
    loadOrders();
    loadBookings();
  };

  es.onerror = function () {
    if ($("live")) $("live").hidden = false;
  };
}

var loginForm = $("lf");

if (loginForm) {
  loginForm.onsubmit = function (e) {
    e.preventDefault();

    if ($("err")) $("err").textContent = "";

    if (window.Sound) Sound.unlock();

    api("/api/login", {
      body: {
        username: $("un").value,
        password: $("pw").value
      }
    }).then(function () {
      $("pw").value = "";
      showApp();
    }).catch(function (x) {
      console.error("خطأ تسجيل الدخول:", x);

      if ($("err")) {
        $("err").textContent =
          x.message || "تعذر تسجيل الدخول، حاول مرة أخرى.";
      }
    });
  };
}

var logoutButton = $("out");

if (logoutButton) {
  logoutButton.onclick = function () {
    api("/api/logout", {
      method: "POST",
      body: {}
    }).then(showLogin).catch(function (e) {
      console.error(e);
      showLogin();
    });
  };
}

/* التنقل بين التبويبات */

var bTabs = $("btabs");

if (bTabs) {
  [].forEach.call(bTabs.children, function (b) {
    if (!b.dataset.v) return;

    b.onclick = function () {
      tab = b.dataset.v;
      unseen[tab] = 0;

      [].forEach.call(bTabs.children, function (x) {
        if (x.dataset.v) {
          x.setAttribute("aria-selected", x == b);
        }
      });

      if ($("vo")) $("vo").hidden = tab != "o";
      if ($("vb")) $("vb").hidden = tab != "b";
      if ($("vm")) $("vm").hidden = tab != "m";
      if ($("vu")) $("vu").hidden = tab != "u";
      if ($("vs")) $("vs").hidden = tab != "s";
      if ($("vp")) $("vp").hidden = tab != "p";
      if ($("vpay")) $("vpay").hidden = tab != "pay";

      if (
        window.Admin &&
        ["m", "u", "s", "p", "pay"].indexOf(tab) !== -1
      ) {
        Admin.show(tab);
      }

      updateTabs();
    };
  });
}

/* تحديث دوري */

setInterval(function () {
  if ($("app") && !$("app").hidden) {
    draw();
    sndLabel();
  }
}, 30000);

addEventListener("click", function () {
  setTimeout(sndLabel, 50);
});

/* استعادة الجلسة السابقة */

api("/api/me").then(showApp).catch(function () {});

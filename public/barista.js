
[].forEach.call($("btabs").children, function (b) {
  if (!b.dataset.v) return;
  b.onclick = function () {
    tab = b.dataset.v;
    unseen[tab] = 0;

    [].forEach.call($("btabs").children, function (x) {
      if (x.dataset.v) x.setAttribute("aria-selected", x == b);
    });

    $("vo").hidden = tab != "o";
    $("vb").hidden = tab != "b";
    $("vm").hidden = tab != "m";
    $("vu").hidden = tab != "u";
    $("vs").hidden = tab != "s";
    $("vp").hidden = tab != "p";
    $("vpay").hidden = tab != "pay";

    // تم إصلاح المشكلة هنا: إضافة pay
    if (
      window.Admin &&
      (tab == "m" || tab == "u" || tab == "s" || tab == "p" || tab == "pay")
    ) {
      Admin.show(tab);
    }

    updateTabs();
  };
});

setInterval(function () {
  if (!$("app").hidden) {
    draw();
    sndLabel();
  }
}, 30000);

addEventListener("click", function () {
  setTimeout(sndLabel, 50);
});

api("/api/me").then(showApp).catch(function () {});

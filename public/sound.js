"use strict";
/* أصوات التنبيه بتتولّد بالكود (من غير ملفات). المتصفح بيمنع الصوت لحد ما المستخدم يضغط على الصفحة. */
window.Sound = (function () {
  var ctx = null;
  function C() { if (!ctx) { var A = window.AudioContext || window.webkitAudioContext; if (!A) return null; try { ctx = new A(); } catch (e) { return null; } } return ctx; }
  function unlock() { var c = C(); if (c && c.state !== "running" && c.resume) return c.resume().catch(function () {}); return Promise.resolve(); }
  function tone(f, t0, d, v) {
    var c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + d + 0.05);
  }
  var P = { order: [[880, 0], [1175, .18], [880, .5], [1175, .68]], booking: [[659, 0], [784, .2], [988, .4]], ready: [[523, 0], [659, .15], [784, .3], [1047, .45]], test: [[784, 0]] };
  function play(k) { var c = C(); if (!c || c.state !== "running") return false; var t = c.currentTime + .02; (P[k] || P.test).forEach(function (n) { tone(n[0], t + n[1], .3, .35); }); return true; }
  function running() { return !!ctx && ctx.state === "running"; }
  ["click", "keydown", "touchstart"].forEach(function (e) { addEventListener(e, unlock, { passive: true }); });
  return { unlock: unlock, play: play, running: running };
})();

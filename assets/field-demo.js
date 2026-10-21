/*
 * The field demo on laminae.co.nz's home page (Tim, 2026-10-21, QUESTIONS.md Q733: "Tap to start").
 *
 * This is the website's one script. It does nothing until the visitor presses the "Tap to play the field" button; until
 * then the page shows a still picture of cells drawn as inline SVG. After the press it runs a small toy field on a canvas:
 * each cell has a heading (shown as its hue) and an energy (shown as its brightness), the way Aesthesia's field is
 * coloured. A tap or drag on the canvas adds energy there, heading the way the finger moves. The field starts with a few
 * patches and adds none of its own after that (sparks is 0): as in Aesthesia, new energy comes from the visitor's finger, and
 * a field left alone fades to still.
 *
 * It is an impression of the field, written for this page, and not Aesthesia's engine: energy drifts one cell along its
 * heading, fades a little each frame, and turns a little towards its neighbours' headings. Nothing more.
 *
 * Limits (all values are configuration, Q213): the block's data- attributes set the grid, the frame rate, the running
 * time and the reduced-motion rate; the toy's own knobs below can be set the same way (data-fade="0.98" and so on). It
 * pauses while scrolled out of view or while the tab is hidden, and stops itself after the running time with a "Play
 * again" button. With prefers-reduced-motion it still starts only on a press and runs at the reduced rate. The stage's shape
 * follows data-cols and data-rows (the still picture is drawn by build_site.py for its own FIELD_DEMO grid).
 *
 * Touch: the running canvas takes touch-action: pan-y, so a vertical swipe still scrolls the page on a phone (the browser
 * takes that gesture and cancels the paint), while a tap or a sideways drag paints. The caption says so.
 *
 * Privacy: no sound, no network requests, no storage, no cookies; nothing leaves the page.
 */
(function () {
  "use strict";

  // Fallbacks for anything the block's data- attributes leave out. The block carries the limits with their defaults.
  var DEFAULTS = {
    cols: 96,          // grid width in cells
    rows: 54,          // grid height in cells
    fps: 15,           // frames a second
    seconds: 60,       // running time before it stops itself
    reducedRate: 0.5,  // share of the frame rate kept under prefers-reduced-motion
    cellPx: 8,         // canvas pixels per cell (the canvas is scaled to the block's width)
    gapPx: 1,          // canvas pixels between cells
    fade: 0.993,       // share of a cell's energy kept each frame
    drift: 0.5,        // share of a cell's energy that moves one cell along its heading each frame
    align: 0.12,       // how strongly a cell turns towards its four neighbours' headings
    wobble: 0.12,      // largest random turn per frame, in radians
    floor: 0.012,      // energy below this counts as an empty cell
    brush: 3.2,        // radius, in cells, of a tap or drag
    brushEnergy: 0.9,  // energy a tap adds at the brush's centre
    seeds: 12,         // patches of energy the field starts with
    sparks: 0,         // chance per frame of a small new patch somewhere; 0, so new energy comes only from the visitor
    hues: 36,          // hue steps the canvas draws with
    levels: 8          // brightness steps the canvas draws with
  };

  var block = document.querySelector("[data-field-demo]");
  if (!block) return;

  function setting(name) {
    var raw = block.dataset[name];
    var v = raw === undefined ? NaN : parseFloat(raw);
    return isFinite(v) ? v : DEFAULTS[name];
  }

  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = setting(k); });
  cfg.cols = Math.max(4, Math.round(cfg.cols));
  cfg.rows = Math.max(4, Math.round(cfg.rows));

  var stage = block.querySelector(".fd-stage");
  var poster = block.querySelector(".fd-poster");
  var canvas = block.querySelector("canvas");
  var button = block.querySelector("button");
  var status = block.querySelector(".fd-status");
  var howto = block.querySelector(".fd-howto");
  if (!stage || !canvas || !button || !canvas.getContext) return;
  var LABEL_PLAYING = "A small field of coloured cells, playing. Tap or drag sideways on it to add energy.";
  var LABEL_STOPPED = "A small field of coloured cells, stopped. Press Play again to run it once more.";

  var ctx = canvas.getContext("2d");
  var cols = cfg.cols, rows = cfg.rows, n = cols * rows;
  var E = new Float32Array(n), A = new Float32Array(n);     // energy and heading now
  var E2 = new Float32Array(n), VX = new Float32Array(n), VY = new Float32Array(n);  // the next frame, being built
  var TAU = Math.PI * 2;

  canvas.width = cols * cfg.cellPx;
  canvas.height = rows * cfg.cellPx;
  stage.style.aspectRatio = cols + " / " + rows;  // so a grid set only by data- attributes keeps its cells square

  // ---- colours, read from the page's tokens so the field follows the light or dark setting ----
  var ground = "#000", palette = [];
  function readTokens() {
    var css = getComputedStyle(block);
    ground = css.getPropertyValue("--field-bg").trim() || "#07090C";
    var s = css.getPropertyValue("--field-s").trim() || "80%";
    var l = css.getPropertyValue("--field-l").trim() || "62%";
    palette = [];
    for (var h = 0; h < cfg.hues; h++) palette.push("hsl(" + Math.round(h * 360 / cfg.hues) + "," + s + "," + l + ")");
  }
  readTokens();

  // ---- the toy ----
  function patch(cx, cy, r, heading, energy) {
    var r2 = r * r;
    for (var dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (var dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        var d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        var x = ((Math.round(cx) + dx) % cols + cols) % cols;
        var y = ((Math.round(cy) + dy) % rows + rows) % rows;
        var i = y * cols + x;
        var add = energy * (1 - Math.sqrt(d2) / (r + 0.5));
        if (add <= 0) continue;
        // the new energy's heading wins in proportion to how much it adds
        var w = add / (E[i] + add);
        A[i] = blendAngle(A[i], heading, w);
        E[i] = Math.min(1, E[i] + add);
      }
    }
  }

  function blendAngle(a, b, w) {
    var x = Math.cos(a) * (1 - w) + Math.cos(b) * w;
    var y = Math.sin(a) * (1 - w) + Math.sin(b) * w;
    return Math.atan2(y, x);
  }

  function seed() {
    E.fill(0);
    for (var i = 0; i < n; i++) A[i] = Math.random() * TAU;
    for (var k = 0; k < cfg.seeds; k++) {
      patch(Math.random() * cols, Math.random() * rows, 2 + Math.random() * 4, Math.random() * TAU, 0.6 + Math.random() * 0.4);
    }
  }

  function step() {
    E2.fill(0); VX.fill(0); VY.fill(0);
    var x, y, i, j, e, a, cx, cy;
    // move: part of each cell's energy stays, part goes one cell along its heading; headings travel with it
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        i = y * cols + x; e = E[i];
        if (e < cfg.floor) continue;
        a = A[i]; cx = Math.cos(a); cy = Math.sin(a);
        var stay = e * (1 - cfg.drift), go = e - stay;
        E2[i] += stay; VX[i] += stay * cx; VY[i] += stay * cy;
        j = ((y + Math.round(cy) + rows) % rows) * cols + (x + Math.round(cx) + cols) % cols;
        E2[j] += go; VX[j] += go * cx; VY[j] += go * cy;
      }
    }
    // settle: fade, then turn a little towards the neighbours' headings
    for (y = 0; y < rows; y++) {
      var up = ((y - 1 + rows) % rows) * cols, down = ((y + 1) % rows) * cols, row = y * cols;
      for (x = 0; x < cols; x++) {
        i = row + x;
        e = Math.min(1, E2[i] * cfg.fade);
        if (e < cfg.floor) { E[i] = 0; continue; }
        var left = row + (x - 1 + cols) % cols, right = row + (x + 1) % cols;
        var hx = VX[i] + cfg.align * (VX[left] + VX[right] + VX[up + x] + VX[down + x]);
        var hy = VY[i] + cfg.align * (VY[left] + VY[right] + VY[up + x] + VY[down + x]);
        E[i] = e;
        A[i] = Math.atan2(hy, hx) + (Math.random() - 0.5) * 2 * cfg.wobble;
      }
    }
    if (Math.random() < cfg.sparks) {
      patch(Math.random() * cols, Math.random() * rows, 2 + Math.random() * 3, Math.random() * TAU, 0.6 + Math.random() * 0.4);
    }
  }

  function draw() {
    var c = cfg.cellPx, g = cfg.gapPx, size = c - g;
    ctx.globalAlpha = 1;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var i = y * cols + x, e = E[i];
        if (e < cfg.floor) continue;
        var h = Math.round(((A[i] % TAU + TAU) % TAU) / TAU * cfg.hues) % cfg.hues;
        ctx.globalAlpha = Math.ceil(Math.sqrt(e) * cfg.levels) / cfg.levels;  // square root, so fading cells stay visible a little longer
        ctx.fillStyle = palette[h];
        ctx.fillRect(x * c, y * c, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- running, pausing and stopping ----
  var reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var started = false, done = false, onScreen = true, frame = 0, last = 0, prev = 0, ran = 0;

  function interval() {
    var fps = cfg.fps * (reduced && reduced.matches ? cfg.reducedRate : 1);
    return 1000 / Math.max(0.5, fps);
  }

  function say(text) { if (status) status.textContent = text; }

  function shouldRun() { return started && !done && onScreen && !document.hidden; }

  function tick(now) {
    frame = 0;
    if (!shouldRun()) return;
    var gap = interval();
    if (!last) last = prev = now;
    // count only time spent running (resume() starts the clock afresh), so a pause never eats the running time
    ran += Math.min(now - prev, gap * 2);
    prev = now;
    if (now - last >= gap) {
      // keep the remainder, so a 60 Hz screen still gives the configured rate rather than rounding down to every fifth frame
      last = now - ((now - last) % gap);
      step();
      draw();
    }
    if (ran >= cfg.seconds * 1000) { finish(); return; }
    frame = requestAnimationFrame(tick);
  }

  function resume() {
    if (frame || !shouldRun()) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function finish() {
    done = true;
    pause();
    canvas.style.touchAction = "";
    canvas.setAttribute("aria-label", LABEL_STOPPED);
    button.textContent = "Play again";
    button.hidden = false;
    if (document.activeElement === canvas) button.focus({ preventScroll: true });  // a keyboard user lands on the next control
    say("The field has stopped after " + cfg.seconds + " seconds. Press Play again to run it once more.");
  }

  function start() {
    seed();
    readTokens();
    draw();
    started = true; done = false; ran = 0;
    if (poster) poster.setAttribute("hidden", "");  // the poster is an SVG element, which has no .hidden property
    canvas.hidden = false;
    canvas.style.touchAction = "pan-y";  // a vertical swipe still scrolls the page; a tap or sideways drag paints
    canvas.setAttribute("aria-label", LABEL_PLAYING);
    button.hidden = true;
    canvas.focus({ preventScroll: true });
    say("The field is playing. Tap or drag sideways on it to add energy.");
    resume();
  }

  button.addEventListener("click", start);
  button.hidden = false;  // the button appears only when this script can run it
  if (howto) {             // and so does the caption's instruction, so a visitor without scripts reads none for a missing control
    howto.textContent = " Press play, then tap or drag sideways on the field to add energy; it runs for " + cfg.seconds + " seconds.";
    howto.hidden = false;
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) resume(); else pause();
    }).observe(stage);
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); else resume(); });
  if (window.matchMedia) {
    var light = window.matchMedia("(prefers-color-scheme: light)");
    var retheme = function () { readTokens(); if (started) draw(); };
    if (light.addEventListener) light.addEventListener("change", retheme);
  }

  // ---- touch: a tap adds a patch with a heading of its own; a drag paints along the way it moves ----
  var press = null;
  function cellAt(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * cols, y: (ev.clientY - r.top) / r.height * rows };
  }
  canvas.addEventListener("pointerdown", function (ev) {
    if (!started || done) return;
    var p = cellAt(ev);
    press = { x: p.x, y: p.y, heading: Math.random() * TAU };
    if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
    patch(p.x, p.y, cfg.brush, press.heading, cfg.brushEnergy);
    draw();
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!press || done) return;
    var p = cellAt(ev), dx = p.x - press.x, dy = p.y - press.y;
    if (dx * dx + dy * dy < 0.5) return;
    press.heading = Math.atan2(dy, dx);
    press.x = p.x; press.y = p.y;
    patch(p.x, p.y, cfg.brush * 0.75, press.heading, cfg.brushEnergy * 0.6);
  });
  var release = function () { press = null; };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
})();

/* ============================================================
 * DrawLib · tools.js
 * 画笔 / 橡皮擦 / 仿制图章 / 涂抹 / 油漆桶 / 取色器 / 直线 / 移动 / 抓手
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;

/* ------------------------------------------------------------
 * 描边笔触（沿路径按间距落笔，带压感与平滑）
 * ---------------------------------------------------------- */
function Stroke(app, g) {
  this.app = app;
  this.g = g;
  this.lx = 0; this.ly = 0;
  this.psize = 1;
  this.pflow = 1;
  this.ang = 0;
}
Stroke.prototype.start = function (x, y, p) {
  this.lx = x; this.ly = y;
  var s = this.app.brushParams(p);
  this.psize = s.size;
  this.pflow = s.flow;
  this.ang = s.angle;
  DL.brush.stamp(this.g, x, y, s);
  this.app.track(s.size, x, y);
};
Stroke.prototype.line = function (x, y, p) {
  var app = this.app;
  var dx = x - this.lx, dy = y - this.ly;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.02) return;
  var ang = Math.atan2(dy, dx);
  var cur = app.brushParams(p);
  var spacing = Math.max(0.65, ((cur.size + this.psize) / 2) * app.settings.brush.spacing);
  var steps = Math.max(1, Math.floor(dist / spacing));
  for (var i = 1; i <= steps; i++) {
    var f = i / steps;
    var px = this.lx + dx * f, py = this.ly + dy * f;
    var size = this.psize + (cur.size - this.psize) * f;
    var flow = this.pflow + (cur.flow - this.pflow) * f;
    DL.brush.stamp(this.g, px, py, {
      type: cur.type, size: size, hardness: cur.hardness, color: cur.color,
      flow: flow, erase: cur.erase, angle: cur.follow ? (ang + Math.PI / 2) : cur.angle
    });
    app.track(size, px, py);
  }
  var moved = steps * spacing;
  if (moved < dist) {
    var f2 = moved / dist;
    this.lx += dx * f2; this.ly += dy * f2;
  } else {
    this.lx = x; this.ly = y;
  }
  this.psize = cur.size;
  this.pflow = cur.flow;
  this.ang = ang;
};

/* 在两个点之间一次性画一条笔迹（直线工具用） */
Stroke.prototype.straight = function (x0, y0, x1, y1, p) {
  var app = this.app;
  var s = app.brushParams(p);
  DL.brush.stamp(this.g, x0, y0, s);
  this.app.track(s.size, x0, y0);
  this.lx = x0; this.ly = y0; this.psize = s.size; this.pflow = s.flow;
  this.line(x1, y1, p);
};

/* ------------------------------------------------------------
 * 仿制图章笔触
 * ---------------------------------------------------------- */
function CloneStroke(app, g, src, offx, offy) {
  this.app = app;
  this.g = g;
  this.src = src;
  this.offx = offx; this.offy = offy;
  this.lx = 0; this.ly = 0;
  this.psize = 1;
  this.pflow = 1;
  this.patch = null;
}
CloneStroke.prototype.start = function (x, y, p) {
  this.lx = x; this.ly = y;
  var s = this.app.brushParams(p);
  this.psize = s.size; this.pflow = s.flow;
  this.dab(x, y, s.size, s.flow, s);
  this.app.track(s.size, x, y);
};
CloneStroke.prototype.line = function (x, y, p) {
  var dx = x - this.lx, dy = y - this.ly;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.02) return;
  var cur = this.app.brushParams(p);
  var spacing = Math.max(0.7, ((cur.size + this.psize) / 2) * this.app.settings.brush.spacing);
  var steps = Math.max(1, Math.floor(dist / spacing));
  for (var i = 1; i <= steps; i++) {
    var f = i / steps;
    var size = this.psize + (cur.size - this.psize) * f;
    var flow = this.pflow + (cur.flow - this.pflow) * f;
    this.dab(this.lx + dx * f, this.ly + dy * f, size, flow, cur);
  }
  var moved = steps * spacing;
  if (moved < dist) { var f2 = moved / dist; this.lx += dx * f2; this.ly += dy * f2; }
  else { this.lx = x; this.ly = y; }
  this.psize = cur.size;
  this.pflow = cur.flow;
};
CloneStroke.prototype.dab = function (x, y, size, flow, cur) {
  var s = Math.max(2, Math.round(size));
  var mask = DL.brush.getMask(cur.type === 'spray' ? 'soft' : cur.type, s, cur.hardness, cur.angle, 0);
  var mw = mask.width, mh = mask.height;
  if (!this.patch) this.patch = DL.createCanvas(mw, mh);
  var c = this.patch;
  if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh; }
  var pg = c.getContext('2d');
  pg.setTransform(1, 0, 0, 1, 0, 0);
  pg.globalCompositeOperation = 'source-over';
  pg.globalAlpha = 1;
  pg.clearRect(0, 0, mw, mh);

  var sx = x + this.offx - mw / 2, sy = y + this.offy - mh / 2;
  var cx1 = Math.max(0, sx), cy1 = Math.max(0, sy);
  var cx2 = Math.min(this.src.width, sx + mw), cy2 = Math.min(this.src.height, sy + mh);
  if (cx2 > cx1 && cy2 > cy1) {
    pg.drawImage(this.src, cx1, cy1, cx2 - cx1, cy2 - cy1, cx1 - sx, cy1 - sy, cx2 - cx1, cy2 - cy1);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(mask, 0, 0);
    pg.globalCompositeOperation = 'source-over';
    this.g.globalAlpha = DL.clamp(flow, 0, 1);
    this.g.drawImage(c, x - mw / 2, y - mh / 2);
    this.g.globalAlpha = 1;
  }
  this.app.track(s, x, y);
};

/* ------------------------------------------------------------
 * 涂抹笔触（直接作用于实时图层）
 * ---------------------------------------------------------- */
function SmudgeStroke(app, g) {
  this.app = app;
  this.g = g;
  this.lx = 0; this.ly = 0;
  this.scratch = DL.createCanvas(8, 8);
}
SmudgeStroke.prototype.start = function (x, y, p) {
  this.lx = x; this.ly = y;
  this.app.track(1, x, y);
};
SmudgeStroke.prototype.line = function (x, y, p) {
  var app = this.app;
  var b = app.settings.brush;
  var dx = x - this.lx, dy = y - this.ly;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.3) return;
  var pres = p.pressure == null ? 1 : p.pressure;
  var size = b.pressureSize ? Math.max(2, b.size * (0.25 + 0.75 * pres)) : b.size;
  var spacing = Math.max(0.7, size * 0.12);
  var steps = Math.max(1, Math.floor(dist / spacing));
  for (var i = 1; i <= steps; i++) {
    var f = i / steps;
    var px = this.lx + dx * f, py = this.ly + dy * f;
    this.dab(px, py, size, Math.max(0.02, app.settings.opts.smudgeStrength * (b.pressureFlow ? pres : 1)), b.hardness);
  }
  if (steps * spacing < dist) { var f2 = steps * spacing / dist; this.lx += dx * f2; this.ly += dy * f2; }
  else { this.lx = x; this.ly = y; }
};
SmudgeStroke.prototype.dab = function (x, y, size, strength, hardness) {
  var live = this.app.liveCanvas;
  var mask = DL.brush.getMask(this.app.settings.brush.type === 'soft' ? 'soft' : 'round', size, hardness, 0, 0);
  var mw = mask.width, mh = mask.height;
  var sc = this.scratch;
  if (sc.width !== mw || sc.height !== mh) { sc.width = mw; sc.height = mh; }
  var sg = sc.getContext('2d');
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  sg.globalAlpha = 1;
  sg.clearRect(0, 0, mw, mh);

  /* 取上一落笔点附近的像素，做成带蒙版的“色块” */
  var sx = this.lx - mw / 2, sy = this.ly - mh / 2;
  var cx1 = Math.max(0, sx), cy1 = Math.max(0, sy);
  var cx2 = Math.min(live.width, sx + mw), cy2 = Math.min(live.height, sy + mh);
  if (cx2 <= cx1 || cy2 <= cy1) return;
  sg.drawImage(live, cx1, cy1, cx2 - cx1, cy2 - cy1, cx1 - sx, cy1 - sy, cx2 - cx1, cy2 - cy1);
  sg.globalCompositeOperation = 'destination-in';
  sg.drawImage(mask, 0, 0);
  sg.globalCompositeOperation = 'source-over';

  this.g.globalAlpha = DL.clamp(strength, 0, 1);
  this.g.drawImage(sc, x - mw / 2, y - mh / 2);
  this.g.globalAlpha = 1;
  this.app.track(size, x, y);
};

/* ------------------------------------------------------------
 * 工具定义
 * ---------------------------------------------------------- */
DL.createTools = function (app) {

  function locked() {
    var l = app.doc.activeLayer();
    if (!l) return true;
    if (l.locked) { app.status('图层已锁定，无法绘制'); return true; }
    return false;
  }

  var tools = {};
  var LIQ_NAME = { push: '推挤', bloat: '膨胀', pinch: '收缩', twirl: '旋转', restore: '重建' };

  /* ---------- 画笔 ---------- */
  tools.brush = {
    id: 'brush', name: '画笔', key: 'B', hint: '按住 Alt 临时取色',
    icon: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
    onDown: function (pt) {
      if (locked()) return;
      app.beginBuffer({ erase: false, opacity: app.settings.brush.opacity });
      this.stroke = new Stroke(app, app.stroke.ctx);
      this.stroke.start(pt.x, pt.y, pt);
    },
    onMove: function (pt) { if (this.stroke) this.stroke.line(pt.x, pt.y, pt); },
    onUp: function () { if (this.stroke) { this.stroke = null; app.commitBuffer('画笔'); } }
  };

  /* ---------- 橡皮擦 ---------- */
  tools.eraser = {
    id: 'eraser', name: '橡皮擦', key: 'E', hint: '擦除当前图层像素',
    icon: '<path d="M15 4 5 14a2 2 0 0 0 0 3l2 2a2 2 0 0 0 3 0L20 9a2 2 0 0 0 0-3l-2-2a2 2 0 0 0-3 0z"/><path d="m9 10 5 5"/><path d="M5 21h14"/>',
    onDown: function (pt) {
      if (locked()) return;
      app.beginBuffer({ erase: true, opacity: app.settings.brush.opacity });
      this.stroke = new Stroke(app, app.stroke.ctx);
      this.stroke.start(pt.x, pt.y, pt);
    },
    onMove: function (pt) { if (this.stroke) this.stroke.line(pt.x, pt.y, pt); },
    onUp: function () { if (this.stroke) { this.stroke = null; app.commitBuffer('橡皮擦'); } }
  };

  /* ---------- 仿制图章 ---------- */
  tools.clone = {
    id: 'clone', name: '仿制图章', key: 'S', hint: 'Alt + 单击设置取样源',
    icon: '<rect x="8" y="3" width="8" height="6" rx="1.5"/><path d="M6 21v-3.5A3.5 3.5 0 0 1 9.5 14h5a3.5 3.5 0 0 1 3.5 3.5V21z"/><path d="M12 9v5"/>',
    onDown: function (pt) {
      if (locked()) return;
      var o = app.settings.opts;
      if (!app.cloneSource) { app.status('请先按住 Alt 单击，设置仿制取样源'); return; }
      var src;
      if (o.cloneAllLayers) src = app.merged();
      else { var l = app.doc.activeLayer(); src = DL.copyCanvas(l.canvas); }
      var offx, offy;
      if (o.cloneAligned && app.cloneOffset) {
        offx = app.cloneOffset.x; offy = app.cloneOffset.y;
      } else {
        offx = app.cloneSource.x - pt.x;
        offy = app.cloneSource.y - pt.y;
        app.cloneOffset = { x: offx, y: offy };
      }
      app.beginBuffer({ erase: false, opacity: app.settings.brush.opacity });
      this.stroke = new CloneStroke(app, app.stroke.ctx, src, offx, offy);
      this.stroke.start(pt.x, pt.y, pt);
    },
    onMove: function (pt) { if (this.stroke) this.stroke.line(pt.x, pt.y, pt); },
    onUp: function () { if (this.stroke) { this.stroke = null; app.commitBuffer('仿制图章'); } }
  };

  /* ---------- 涂抹 ---------- */
  tools.smudge = {
    id: 'smudge', name: '涂抹', key: 'U', hint: '拖动以混合邻近颜色',
    icon: '<path d="M12 3.5c3.6 4.3 5.5 7.3 5.5 10.2A5.5 5.5 0 0 1 12 19.5a5.5 5.5 0 0 1-5.5-5.8C6.5 10.8 8.4 7.8 12 3.5z"/><path d="M9.6 14.2c0 1.3 1.1 2.4 2.4 2.4"/>',
    onDown: function (pt) {
      if (locked()) return;
      app.beginDirect();
      this.stroke = new SmudgeStroke(app, app.liveCtx);
      this.stroke.start(pt.x, pt.y, pt);
    },
    onMove: function (pt) { if (this.stroke) this.stroke.line(pt.x, pt.y, pt); },
    onUp: function () { if (this.stroke) { this.stroke = null; app.commitDirect('涂抹'); } }
  };

  /* ---------- 油漆桶 ---------- */
  tools.bucket = {
    id: 'bucket', name: '油漆桶', key: 'G', hint: '按容差填充相近颜色区域',
    icon: '<path d="M5.5 10.5 12 4l6.5 6.5-6.5 6.5-6.5-6.5z"/><path d="M9.5 2 11 3.5"/><path d="M19.5 14.5c1.4 2.1 1.4 3.8 0 3.8s-1.4-1.7 0-3.8z"/>',
    onDown: function (pt) {
      if (locked()) return;
      var o = app.settings.opts;
      var layer = app.doc.activeLayer();
      var d = app.doc;
      var src = o.bucketAllLayers ? app.merged() : layer.canvas;
      var data = src.getContext('2d').getImageData(0, 0, d.width, d.height).data;
      var res = o.bucketContiguous
        ? DL.floodFill(data, d.width, d.height, pt.x, pt.y, o.bucketTolerance)
        : DL.globalColorPick(data, d.width, d.height, pt.x, pt.y, o.bucketTolerance);
      if (!res) { app.status('未找到可填充区域'); return; }
      var fc = DL.maskToCanvas(res, d.width, d.height, DL.hexToRgb(app.fg()) || { r: 0, g: 0, b: 0 });
      var rect = { x: fc.x, y: fc.y, w: fc.w, h: fc.h };
      var before = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
      var g = layer.ctx;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = app.settings.brush.opacity;
      g.globalCompositeOperation = 'source-over';
      g.drawImage(fc.canvas, fc.x, fc.y);
      g.restore();
      layer.touch();
      var after = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
      app.history.record(DL.pixelEntry(app.doc, layer.id, rect, before, after, '油漆桶'));
      app.invalidate();
      app.status('已填充 ' + rect.w + ' × ' + rect.h);
    }
  };

  /* ---------- 取色器 ---------- */
  tools.eyedropper = {
    id: 'eyedropper', name: '取色器', key: 'I', hint: '从画面吸取颜色（Alt 快捷取色）',
    icon: '<path d="M14.5 3.5a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4L17 13l-2-2-6.3 6.3-3.2 1 1-3.2L12.8 9l-2-2 3.7-3.5z"/><path d="m13.5 10.5 2 2"/>',
    onDown: function (pt) { app.pickColorAt(pt); this.picking = true; },
    onMove: function (pt) { if (this.picking) app.pickColorAt(pt); },
    onUp: function () { this.picking = false; }
  };

  /* ---------- 直线 ---------- */
  tools.line = {
    id: 'line', name: '直线', key: 'L', hint: '拖动画直线，Shift 约束 45°',
    icon: '<path d="M4.5 19.5 19.5 4.5"/><circle cx="4.5" cy="19.5" r="1.7"/><circle cx="19.5" cy="4.5" r="1.7"/>',
    onDown: function (pt) {
      if (locked()) return;
      app.beginBuffer({ erase: false, opacity: app.settings.brush.opacity });
      this.startPt = pt;
      this.stroke = new Stroke(app, app.stroke.ctx);
      this.stroke.start(pt.x, pt.y, pt);
    },
    onMove: function (pt) {
      if (!this.stroke) return;
      var g = app.stroke.ctx, d = app.doc;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, d.width, d.height);
      app.stroke.rect = null;
      var a = this.startPt, b = pt;
      if (pt.shift) {
        var dx = pt.x - a.x, dy = pt.y - a.y;
        var ang = Math.atan2(dy, dx);
        var snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        var len = Math.sqrt(dx * dx + dy * dy);
        b = { x: a.x + Math.cos(snap) * len, y: a.y + Math.sin(snap) * len, pressure: pt.pressure };
      }
      this.stroke.straight(a.x, a.y, b.x, b.y, pt);
    },
    onUp: function (pt) {
      if (this.stroke) { this.stroke = null; app.commitBuffer('直线'); }
    }
  };

  /* ---------- 移动（有选区则移动选区内容，否则移动整层） ---------- */
  tools.move = {
    id: 'move', name: '移动', key: 'V', hint: '有选区时移动选区内容，否则移动整层',
    icon: '<path d="M12 3v18M3 12h18"/><path d="M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    onDown: function (pt) {
      if (locked()) return;
      if (app.selection && app.selectionHit(pt)) { this.floatStart(pt); return; }
      app.beginDirect();
      this.origin = pt;
      this.base = DL.copyCanvas(app.doc.activeLayer().canvas);
    },
    onMove: function (pt) {
      if (this.hole) { this.floatMove(pt); return; }
      if (!this.base) return;
      var dx = Math.round(pt.x - this.origin.x), dy = Math.round(pt.y - this.origin.y);
      this.dx = dx; this.dy = dy;
      var g = app.liveCtx, d = app.doc;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, d.width, d.height);
      g.drawImage(this.base, dx, dy);
      app.stroke.rect = { x: 0, y: 0, w: d.width, h: d.height };
      app.requestRender();
      app.status('偏移 ' + dx + ' , ' + dy);
    },
    onUp: function () {
      if (this.hole) { this.floatEnd(); return; }
      if (!this.base) return;
      this.base = null;
      app.commitDirect('移动图层');
    },

    /* --- 浮动选区（移动选区内的像素） --- */
    floatStart: function (pt) {
      var d = app.doc, layer = d.activeLayer();
      if (!layer || layer.locked) { app.status('图层已锁定，无法移动选区内容'); return; }
      app.beginDirect();
      this.origin = pt;
      this.dx = 0; this.dy = 0;
      this.moved = false;
      var maskCanvas = app.selMaskCanvas();
      this.base = DL.copyCanvas(layer.canvas);
      this.floatCanvas = DL.createCanvas(d.width, d.height);
      var fg = this.floatCanvas.getContext('2d');
      fg.drawImage(this.base, 0, 0);
      fg.globalCompositeOperation = 'destination-in';
      fg.drawImage(maskCanvas, 0, 0);
      fg.globalCompositeOperation = 'source-over';
      this.hole = DL.createCanvas(d.width, d.height);
      var hg = this.hole.getContext('2d');
      hg.drawImage(this.base, 0, 0);
      hg.globalCompositeOperation = 'destination-out';
      hg.drawImage(maskCanvas, 0, 0);
      hg.globalCompositeOperation = 'source-over';
      var lg = app.liveCtx;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = 'source-over';
      lg.globalAlpha = 1;
      lg.clearRect(0, 0, d.width, d.height);
      lg.drawImage(this.hole, 0, 0);
      app.stroke.rect = { x: 0, y: 0, w: d.width, h: d.height };
      app.requestRender();
      app.status('拖动以移动选区内容');
    },
    floatMove: function (pt) {
      var d = app.doc;
      var dx = Math.round(pt.x - this.origin.x), dy = Math.round(pt.y - this.origin.y);
      if (dx === this.dx && dy === this.dy) return;
      this.dx = dx; this.dy = dy; this.moved = true;
      var g = app.liveCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, d.width, d.height);
      g.drawImage(this.hole, 0, 0);
      g.drawImage(this.floatCanvas, dx, dy);
      app.stroke.rect = { x: 0, y: 0, w: d.width, h: d.height };
      app.requestRender();
      app.status('移动选区 ' + dx + ' , ' + dy);
    },
    floatEnd: function () {
      var moved = this.moved, dx = this.dx || 0, dy = this.dy || 0;
      this.hole = null; this.floatCanvas = null; this.base = null;
      this.moved = false; this.dx = 0; this.dy = 0;
      if (!moved) app._discard = true;
      app.commitDirect('移动选区');
      app._discard = false;
      if (moved) app.shiftSelection(dx, dy);
    }
  };

  /* ---------- 文字 ---------- */
  tools.text = {
    id: 'text', name: '文字', key: 'T', hint: '单击画面插入文字',
    icon: '<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>',
    onDown: function (pt) { app.ui.openTextDialog(pt); }
  };

  /* ---------- 色块选取（魔棒） ---------- */
  tools.select = {
    id: 'select', name: '色块选取', key: 'M', hint: '按颜色选取色块 · Shift 加选 · Alt 减选 · 拖动可移动',
    icon: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5" stroke-dasharray="3 3"/><path d="M10.5 11h3v3h-3z"/>',
    onDown: function (pt, e) {
      var o = app.settings.opts;
      if (app.selection && app.selectionHit(pt)) { this.startMove(pt); return; }
      app.makeColorSelection(pt, {
        add: !!(e && e.shiftKey),
        subtract: !!(e && e.altKey),
        global: o.selectGlobal,
        tolerance: o.selectTolerance,
        allLayers: o.selectAllLayers
      });
    },
    onMove: function (pt) {
      if (!this.hole) return;
      var d = app.doc;
      var dx = Math.round(pt.x - this.origin.x), dy = Math.round(pt.y - this.origin.y);
      if (dx === this.dx && dy === this.dy) return;
      this.dx = dx; this.dy = dy; this.moved = true;
      var g = app.liveCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, d.width, d.height);
      g.drawImage(this.hole, 0, 0);
      g.drawImage(this.floatCanvas, dx, dy);
      app.stroke.rect = { x: 0, y: 0, w: d.width, h: d.height };
      app.requestRender();
      app.status('移动选区 ' + dx + ' , ' + dy);
    },
    onUp: function () {
      if (!this.hole) return;
      var moved = this.moved;
      var dx = this.dx || 0, dy = this.dy || 0;
      this.hole = null; this.floatCanvas = null; this.moved = false;
      this.dx = 0; this.dy = 0;
      if (!moved) { app._discard = true; }
      app.commitDirect('移动选区');
      app._discard = false;
      if (moved) app.shiftSelection(dx, dy);
    },
    startMove: function (pt) {
      var d = app.doc, layer = d.activeLayer();
      if (!layer || layer.locked) { app.status('图层已锁定，无法移动选区内容'); return; }
      app.beginDirect();
      this.origin = pt;
      this.dx = 0; this.dy = 0;
      this.moved = false;
      var maskCanvas = app.selMaskCanvas();
      this.base = DL.copyCanvas(layer.canvas);
      this.floatCanvas = DL.createCanvas(d.width, d.height);
      var fg = this.floatCanvas.getContext('2d');
      fg.drawImage(this.base, 0, 0);
      fg.globalCompositeOperation = 'destination-in';
      fg.drawImage(maskCanvas, 0, 0);
      fg.globalCompositeOperation = 'source-over';
      this.hole = DL.createCanvas(d.width, d.height);
      var hg = this.hole.getContext('2d');
      hg.drawImage(this.base, 0, 0);
      hg.globalCompositeOperation = 'destination-out';
      hg.drawImage(maskCanvas, 0, 0);
      hg.globalCompositeOperation = 'source-over';
      var lg = app.liveCtx;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = 'source-over';
      lg.globalAlpha = 1;
      lg.clearRect(0, 0, d.width, d.height);
      lg.drawImage(this.hole, 0, 0);
      app.stroke.rect = { x: 0, y: 0, w: d.width, h: d.height };
      app.requestRender();
      app.status('拖动以移动选中色块');
    }
  };

  /* ---------- 对象选择（快速选择画笔） ---------- */
  tools.objectSelect = {
    id: 'objectSelect', name: '对象选择', key: 'O', hint: '刷过要选中的对象 · Shift 加选 · Alt 减选',
    icon: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3.4"/>',
    onDown: function (pt, e) {
      var d = app.doc;
      var mode = (e && e.altKey) ? 'sub' : ((e && e.shiftKey) ? 'add' : 'new');
      this.mode = mode;
      this.mask = (mode !== 'new' && app.selection) ? new Uint8Array(app.selection.mask) : new Uint8Array(d.width * d.height);
      this.bbox = null;
      this.lx = pt.x; this.ly = pt.y;
      this._lastT = 0;
      this.grow(pt, true);
    },
    onMove: function (pt) {
      if (!this.mask) return;
      var dx = pt.x - this.lx, dy = pt.y - this.ly;
      var step = Math.max(3, app.settings.brush.size * 0.3);
      if (dx * dx + dy * dy < step * step) return;
      /* 沿移动路径补点，避免快速拖动漏选 */
      var dist = Math.sqrt(dx * dx + dy * dy);
      var n = Math.max(1, Math.floor(dist / step));
      for (var i = 1; i <= n; i++) {
        var t = i / n;
        this.grow({ x: this.lx + dx * t, y: this.ly + dy * t }, false);
      }
      this.lx = pt.x; this.ly = pt.y;
    },
    onUp: function () {
      if (!this.mask) return;
      var m = this.mask;
      var bb = this.finishBBox();
      this.mask = null;
      if (!bb) { app.clearSelection(false); app.status('未选中任何像素'); return; }
      app.setSelection(m, bb);
      app.status('对象选择完成（' + (this.mode === 'sub' ? '减选' : (this.mode === 'add' ? '加选' : '新建')) +
        ' ' + bb.w + '×' + bb.h + '）');
    },
    grow: function (pt, force) {
      var d = app.doc, o = app.settings.opts;
      var src = o.selectAllLayers ? app.merged() : d.activeLayer().canvas;
      var data;
      try { data = src.getContext('2d').getImageData(0, 0, d.width, d.height).data; }
      catch (err) { return; }
      var res = DL.regionGrow(data, d.width, d.height, pt.x, pt.y,
        o.objectTolerance, Math.max(4, app.settings.brush.size / 2));
      if (res) {
        var m = this.mask, W = d.width;
        var on = this.mode !== 'sub';
        var bb = this.bbox;
        for (var y = 0; y < res.bh; y++) {
          var row = y * res.bw;
          var ay = res.y + y;
          for (var x = 0; x < res.bw; x++) {
            if (res.flag[row + x] !== 1) continue;
            var i = ay * W + (res.x + x);
            if (on) {
              m[i] = 1;
              bb = DL.rectUnion(bb, { x: res.x + x, y: ay, w: 1, h: 1 });
            } else if (m[i]) {
              m[i] = 0;
            }
          }
        }
        this.bbox = bb;
      }
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (force || now - this._lastT > 90) {
        this._lastT = now;
        if (this.bbox) app.setSelection(this.mask, this.bbox);
      }
    },
    finishBBox: function () {
      var d = app.doc, m = this.mask;
      var minX = d.width, minY = d.height, maxX = -1, maxY = -1;
      for (var y = 0; y < d.height; y++) {
        var row = y * d.width;
        for (var x = 0; x < d.width; x++) {
          if (!m[row + x]) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) return null;
      return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }
  };

  /* ---------- 液化 ---------- */
  tools.liquify = {
    id: 'liquify', name: '液化', key: 'Q', hint: '拖动推挤像素，可换膨胀/收缩/旋转/重建',
    icon: '<path d="M4 15c3-1 5-7 8-7s5 6 8 5"/><path d="M4 19c2.6-.7 4.4-3.6 6.6-5.4"/><circle cx="8" cy="7" r="2.2"/><path d="M15.5 17.5 20 21"/>',
    onDown: function (pt, e) {
      if (locked()) return;
      var d = app.doc;
      app.beginDirect();
      var base = DL.copyCanvas(d.activeLayer().canvas);
      this.lq = new DL.Liquify(d.width, d.height);
      this.lq.reset(base);
      this.lx = pt.x; this.ly = pt.y;
      this.restore = !!(e && (e.shiftKey || e.altKey));
      this.dab(pt.x, pt.y, 0, 0);
    },
    onMove: function (pt) {
      if (!this.lq) return;
      var dx = pt.x - this.lx, dy = pt.y - this.ly;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(1.2, app.settings.brush.size * 0.14);
      if (dist < 0.5) return;
      var n = Math.max(1, Math.floor(dist / step));
      for (var i = 1; i <= n; i++) {
        var t = i / n;
        var mx = dx / n, my = dy / n;
        this.dab(this.lx + dx * t, this.ly + dy * t, mx, my);
      }
      this.lx = pt.x; this.ly = pt.y;
    },
    onUp: function () {
      if (!this.lq) return;
      this.lq = null;
      app.commitDirect('液化');
    },
    dab: function (x, y, mvx, mvy) {
      var o = app.settings.opts;
      var mode = this.restore ? 'restore' : o.liquifyMode;
      var r = Math.max(4, app.settings.brush.size / 2);
      var amount = (mode === 'push' ? 1.0 : 1.0) * DL.clamp(o.liquifyPower, 0.02, 2);
      var rect = this.lq.warp(mode, x, y, r, amount, mvx, mvy);
      if (!rect) return;
      var grow = Math.ceil(r * 0.35) + 3;
      var cl = DL.rectClip(DL.rectGrow(rect, grow), app.doc.width, app.doc.height);
      if (!cl) return;
      this.lq.render(app.liveCtx, cl);
      app.stroke.rect = DL.rectUnion(app.stroke.rect, cl);
      app.status('液化：' + (this.restore ? '重建' : LIQ_NAME[mode]));
    }
  };

  /* ---------- 渐变 ---------- */
  tools.gradient = {
    id: 'gradient', name: '渐变', key: 'F', hint: '拖出方向与长度 · Shift 约束角度',
    icon: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M6.5 17h11" opacity=".35"/><path d="M6.5 14h9" opacity=".5"/><path d="M6.5 11h7" opacity=".7"/><path d="M6.5 8h5"/>',
    onDown: function (pt) {
      if (locked()) return;
      app.beginDirect();
      this.p0 = { x: pt.x, y: pt.y };
      this.p1 = { x: pt.x, y: pt.y };
      this.paint();
    },
    onMove: function (pt) {
      if (!this.p0) return;
      this.p1 = { x: pt.x, y: pt.y };
      if (pt.shift) {
        var dx = pt.x - this.p0.x, dy = pt.y - this.p0.y;
        var ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        var len = Math.sqrt(dx * dx + dy * dy);
        this.p1 = { x: this.p0.x + Math.cos(ang) * len, y: this.p0.y + Math.sin(ang) * len };
      }
      this.paint();
    },
    onUp: function () {
      if (!this.p0) return;
      this.p0 = null;
      app.overlayState.grad = null;
      app.renderer.renderOverlay();
      app.commitDirect('渐变');
    },
    paint: function () {
      var d = app.doc, o = app.settings.opts;
      var a = this.p0, b = this.p1;
      var g = app.liveCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, d.width, d.height);
      g.drawImage(d.activeLayer().canvas, 0, 0);

      var tmp = app._gradCanvas;
      if (!tmp || tmp.width !== d.width || tmp.height !== d.height) {
        app._gradCanvas = tmp = DL.createCanvas(d.width, d.height);
      }
      var tg = tmp.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.globalCompositeOperation = 'source-over';
      tg.globalAlpha = 1;
      tg.clearRect(0, 0, d.width, d.height);

      var grad;
      if (o.gradType === 'radial') {
        var rr = Math.max(1, Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2)));
        grad = tg.createRadialGradient(a.x, a.y, 0, a.x, a.y, rr);
      } else if (o.gradType === 'angle') {
        grad = tg.createConicGradient ? tg.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y) : null;
      } else {
        grad = tg.createLinearGradient(a.x, a.y, b.x, b.y);
      }
      if (!grad) grad = tg.createLinearGradient(a.x, a.y, b.x, b.y);

      var fg = DL.hexToRgb(app.fg()) || { r: 0, g: 0, b: 0 };
      var bg = DL.hexToRgb(app.settings.bgColor) || { r: 255, g: 255, b: 255 };
      var s0, s1;
      if (o.gradColor === 'fg-trans') { s0 = DL.rgba(fg, 1); s1 = DL.rgba(fg, 0); }
      else if (o.gradColor === 'bw') { s0 = '#000000'; s1 = '#ffffff'; }
      else if (o.gradColor === 'fg-bg-rev') { s0 = DL.rgba(bg, 1); s1 = DL.rgba(fg, 1); }
      else { s0 = DL.rgba(fg, 1); s1 = DL.rgba(bg, 1); }
      if (o.gradReverse) { var t = s0; s0 = s1; s1 = t; }
      grad.addColorStop(0, s0);
      grad.addColorStop(1, s1);

      tg.globalAlpha = DL.clamp(o.gradOpacity, 0.02, 1);
      tg.fillStyle = grad;
      if (o.gradType === 'radial') { tg.fillRect(0, 0, d.width, d.height); }
      else { tg.fillRect(0, 0, d.width, d.height); }
      tg.globalAlpha = 1;
      if (app.selection) {
        tg.globalCompositeOperation = 'destination-in';
        tg.drawImage(app.selMaskCanvas(), 0, 0);
        tg.globalCompositeOperation = 'source-over';
      }
      g.drawImage(tmp, 0, 0);

      app.overlayState.grad = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
      app.stroke.rect = { x: 0, y: 0, w: d.width, h: d.height };
      app.renderer.renderOverlay();
      app.requestRender();
      app.status('渐变 ' + Math.round(Math.abs(b.x - a.x)) + ' × ' + Math.round(Math.abs(b.y - a.y)));
    }
  };

  /* ---------- 模糊 / 锐化 ---------- */
  tools.blur = {
    id: 'blur', name: '模糊', key: 'R', hint: '涂抹模糊区域 · 按住 Alt 锐化',
    icon: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.2-4.2"/><path d="M8.5 11a2.5 2.5 0 0 1 2.5-2.5"/>',
    onDown: function (pt, e) {
      if (locked()) return;
      app.beginDirect();
      this.sharp = !!(e && e.altKey);
      this.lx = pt.x; this.ly = pt.y;
      this.dab(pt.x, pt.y);
    },
    onMove: function (pt) {
      if (!app.stroke.active) return;
      var dx = pt.x - this.lx, dy = pt.y - this.ly;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(2, app.settings.brush.size * 0.3);
      if (dist < step) return;
      var n = Math.max(1, Math.floor(dist / step));
      for (var i = 1; i <= n; i++) {
        var t = i / n;
        this.dab(this.lx + dx * t, this.ly + dy * t);
      }
      this.lx = pt.x; this.ly = pt.y;
    },
    onUp: function () {
      if (!app.stroke.active) return;
      app.commitDirect(this.sharp ? '锐化' : '模糊');
    },
    dab: function (x, y) {
      var d = app.doc, o = app.settings.opts;
      var size = Math.max(6, app.settings.brush.size);
      var rad = size / 2;
      var cl = DL.rectClip({ x: x - rad, y: y - rad, w: size, h: size }, d.width, d.height);
      if (!cl) return;
      var radius = DL.clamp(o.blurSize * (size / 110), 0.5, 50);
      var blur = DL.blurPatch(app.liveCanvas, cl.x, cl.y, cl.w, cl.h, radius);
      var patch = blur;
      if (this.sharp) {
        var srcP = DL.readRegion(app.liveCanvas, cl.x, cl.y, cl.w, cl.h);
        patch = DL.sharpenPatch(srcP.canvas, blur, cl.w, cl.h, DL.clamp(o.blurStrength * 0.9, 0, 2));
      }
      var st = DL.softDisk(cl.w, cl.h, app.settings.brush.hardness);
      var tmp = app._effCanvas;
      if (!tmp || tmp.width !== cl.w || tmp.height !== cl.h) {
        app._effCanvas = tmp = DL.createCanvas(cl.w, cl.h);
      }
      var tg = tmp.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.globalCompositeOperation = 'source-over';
      tg.globalAlpha = 1;
      tg.clearRect(0, 0, cl.w, cl.h);
      tg.drawImage(patch, 0, 0);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(st, 0, 0);
      tg.globalCompositeOperation = 'source-over';
      var lg = app.liveCtx;
      lg.save();
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = 'source-over';
      lg.globalAlpha = DL.clamp(o.blurStrength, 0.02, 1);
      lg.drawImage(tmp, cl.x, cl.y);
      lg.restore();
      app.track(size, x, y);
      app.status((this.sharp ? '锐化' : '模糊') + ' 强度 ' + Math.round(o.blurStrength * 100) + '%');
    }
  };

  /* ---------- 污点修复 ---------- */
  tools.heal = {
    id: 'heal', name: '污点修复', key: 'J', hint: '在瑕疵上涂抹，自动用周围纹理修补',
    icon: '<path d="M9 3.5h6v3l3.5 3.5v9a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V10L9 6.5v-3z"/><path d="M5.5 10h13"/><path d="M11 13.5v4M14.5 15.5v2"/>',
    onDown: function (pt) {
      if (locked()) return;
      app.beginDirect();
      this.lx = pt.x; this.ly = pt.y;
      this.dab(pt.x, pt.y);
    },
    onMove: function (pt) {
      if (!app.stroke.active) return;
      var dx = pt.x - this.lx, dy = pt.y - this.ly;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(2, app.settings.brush.size * 0.4);
      if (dist < step) return;
      var n = Math.max(1, Math.floor(dist / step));
      for (var i = 1; i <= n; i++) {
        var t = i / n;
        this.dab(this.lx + dx * t, this.ly + dy * t);
      }
      this.lx = pt.x; this.ly = pt.y;
    },
    onUp: function () {
      if (!app.stroke.active) return;
      app.commitDirect('污点修复');
    },
    dab: function (x, y) {
      var d = app.doc, o = app.settings.opts;
      var size = Math.max(8, app.settings.brush.size);
      var r = size / 2;
      var res = DL.healPatch(app.liveCanvas, app.liveCtx, d.width, d.height, x, y, r,
        o.healStrength, o.healSamples, o.healCore);
      if (!res) { app.status('该位置没有足够的取样区域'); return; }
      app.track(size * 1.4, x, y);
      app.status('污点修复 ' + Math.round(size) + 'px');
    }
  };

  /* ---------- 剪裁 ---------- */
  tools.crop = {
    id: 'crop', name: '剪裁', key: 'C', hint: '拖出裁剪框后按 Enter 应用',
    icon: '<path d="M6.5 2v15.5H22"/><path d="M2 6.5h15.5V22"/><path d="M6.5 6.5h9v9h-9z" opacity=".45"/>',
    onDown: function (pt) {
      this.a = { x: pt.x, y: pt.y };
      this.b = { x: pt.x, y: pt.y };
      app.overlayState.crop = { x: pt.x, y: pt.y, w: 0, h: 0 };
      app.renderer.renderOverlay();
    },
    onMove: function (pt) {
      if (!this.a) return;
      var d = app.doc;
      var x = DL.clamp(pt.x, 0, d.width), y = DL.clamp(pt.y, 0, d.height);
      this.b = { x: x, y: y };
      app.overlayState.crop = {
        x: Math.min(this.a.x, x), y: Math.min(this.a.y, y),
        w: Math.abs(x - this.a.x), h: Math.abs(y - this.a.y)
      };
      app.renderer.renderOverlay();
    },
    onUp: function () {
      if (!this.a) return;
      var c = app.overlayState.crop;
      this.a = null;
      if (!c || c.w < 8 || c.h < 8) {
        app.overlayState.crop = null;
        app.renderer.renderOverlay();
        app.status('裁剪框太小，请重新拖动');
        return;
      }
      app.ui.showCropBar(c);
    }
  };

  /* ---------- 抓手 ---------- */
  tools.pan = {
    id: 'pan', name: '抓手', key: 'H', hint: '拖动平移视图（空格临时启用）',
    icon: '<path d="M8 12.5V6a1.6 1.6 0 0 1 3.2 0v5"/><path d="M11.2 11V5.2a1.6 1.6 0 0 1 3.2 0V11"/><path d="M14.4 11.4V7a1.6 1.6 0 0 1 3.2 0v6.6c0 4-2.6 6.4-6 6.4s-6-2.2-6-5.4v-3.4a1.6 1.6 0 0 1 3.2 0"/>',
    onDown: function () { app.renderer.canvas.style.cursor = 'grabbing'; },
    onMove: function () {},
    onUp: function () { app.renderer.canvas.style.cursor = 'grab'; }
  };

  var order = [
    'brush', 'eraser', 'clone', 'smudge', 'blur', 'bucket', 'gradient', 'heal',
    'text', 'select', 'objectSelect', 'liquify', 'crop', 'eyedropper', 'line', 'move', 'pan'
  ];
  tools.__order = order;
  return tools;
};

})(window);

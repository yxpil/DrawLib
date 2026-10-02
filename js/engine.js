/* ============================================================
 * DrawLib · engine.js
 * 通用工具函数 / 颜色 / 图层与文档模型 / 撤销历史 / 渲染器 / 笔刷引擎
 * ============================================================ */
(function (global) {
'use strict';

var DL = (global.DL = global.DL || {});

/* ------------------------------------------------------------
 * 1. 通用工具
 * ---------------------------------------------------------- */
DL.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
DL.lerp = function (a, b, t) { return a + (b - a) * t; };

var _uidSeed = 0;
DL.uid = function (p) { return (p || 'id') + (++_uidSeed).toString(36) + Math.random().toString(36).slice(2, 6); };

DL.createCanvas = function (w, h) {
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
DL.copyCanvas = function (src) {
  var c = DL.createCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
};
DL.getRect = function (canvas, x, y, w, h) {
  return canvas.getContext('2d').getImageData(x, y, w, h);
};
DL.putRect = function (canvas, x, y, data) {
  canvas.getContext('2d').putImageData(data, x, y);
};

/* --- 颜色 --- */
DL.hsvToRgb = function (h, s, v) {
  h = ((h % 360) + 360) % 360;
  var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
};
DL.rgbToHsv = function (r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h: h, s: max > 0 ? d / max : 0, v: max };
};
DL.rgbToHex = function (r, g, b) {
  var f = function (v) { return ('0' + DL.clamp(Math.round(v), 0, 255).toString(16)).slice(-2); };
  return '#' + f(r) + f(g) + f(b);
};
DL.hexToRgb = function (hex) {
  hex = String(hex || '').trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
};
DL.rgba = function (c, a) { return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + a + ')'; };

/* 压感曲线：gamma 调整手感，minV 为最小输出比例 */
DL.applyCurve = function (p, gamma, minV) {
  p = DL.clamp(p, 0, 1);
  var v = (gamma && Math.abs(gamma - 1) > 0.001) ? Math.pow(p, gamma) : p;
  return (minV || 0) + (1 - (minV || 0)) * v;
};

/* 中文近似色名 */
DL.colorName = function (r, g, b) {
  var hsv = DL.rgbToHsv(r, g, b);
  var h = hsv.h, s = hsv.s, v = hsv.v;
  var base;
  if (v < 0.14) return '黑';
  if (s < 0.10) {
    if (v > 0.92) return '白';
    if (v > 0.72) return '浅灰';
    if (v > 0.42) return '灰';
    return '深灰';
  }
  if (h < 15 || h >= 345) base = '红';
  else if (h < 40) base = '橙';
  else if (h < 68) base = '黄';
  else if (h < 100) base = '黄绿';
  else if (h < 165) base = '绿';
  else if (h < 200) base = '青';
  else if (h < 250) base = '蓝';
  else if (h < 290) base = '紫';
  else base = '洋红';
  if (v < 0.38) return '深' + base;
  if (v > 0.86 && s < 0.55) return '浅' + base;
  return base;
};

/* 矩形工具 */
DL.rectUnion = function (a, b) {
  if (!a) return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  if (!b) return { x: a.x, y: a.y, w: a.w, h: a.h };
  var x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
  var x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};
DL.rectGrow = function (a, n) { return a ? { x: a.x - n, y: a.y - n, w: a.w + n * 2, h: a.h + n * 2 } : null; };
DL.rectClip = function (r, w, h) {
  if (!r) return null;
  var x1 = DL.clamp(Math.floor(r.x), 0, w), y1 = DL.clamp(Math.floor(r.y), 0, h);
  var x2 = DL.clamp(Math.ceil(r.x + r.w), 0, w), y2 = DL.clamp(Math.ceil(r.y + r.h), 0, h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};
DL.rectBytes = function (r) { return Math.max(1, r.w * r.h * 4); };

/* ------------------------------------------------------------
 * 2. 图层
 * ---------------------------------------------------------- */
function Layer(w, h, name, id) {
  this.id = id || DL.uid('L');
  this.name = name || '图层';
  this.canvas = DL.createCanvas(w, h);
  this.ctx = this.canvas.getContext('2d');
  this.visible = true;
  this.opacity = 1;
  this.blend = 'source-over';
  this.locked = false;
  this._thumb = null;
  this._thumbDirty = true;
}
Layer.prototype.clear = function () {
  this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  this.ctx.globalAlpha = 1;
  this.ctx.globalCompositeOperation = 'source-over';
  this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  this.touch();
};
Layer.prototype.touch = function () { this._thumbDirty = true; };
Layer.prototype.thumb = function (w, h) {
  if (!this._thumb) { this._thumb = DL.createCanvas(w, h); this._thumbDirty = true; }
  if (this._thumbDirty) {
    var g = this._thumb.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    var s = Math.min(w / this.canvas.width, h / this.canvas.height);
    var dw = this.canvas.width * s, dh = this.canvas.height * s;
    g.drawImage(this.canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
    this._thumbDirty = false;
  }
  return this._thumb;
};
DL.Layer = Layer;

/* ------------------------------------------------------------
 * 3. 文档
 * ---------------------------------------------------------- */
function Doc(w, h) {
  this.width = w;
  this.height = h;
  this.layers = [];
  this.active = 0;
  this.fileName = '未命名';
  this.addLayer('图层 1');
}
Doc.prototype.get = function (i) { return this.layers[i]; };
Doc.prototype.activeLayer = function () { return this.layers[this.active] || null; };
Doc.prototype.indexOfId = function (id) {
  for (var i = 0; i < this.layers.length; i++) if (this.layers[i].id === id) return i;
  return -1;
};
Doc.prototype.addLayer = function (name, at) {
  var l = new Layer(this.width, this.height, name || ('图层 ' + (this.layers.length + 1)));
  if (at == null) this.layers.push(l); else this.layers.splice(at, 0, l);
  this.active = at == null ? this.layers.length - 1 : at;
  return l;
};
Doc.prototype.removeLayer = function (i) {
  if (this.layers.length <= 1) return false;
  this.layers.splice(i, 1);
  this.active = DL.clamp(this.active, 0, this.layers.length - 1);
  return true;
};
Doc.prototype.moveLayer = function (i, dir) {
  var j = i + dir;
  if (j < 0 || j >= this.layers.length) return false;
  var t = this.layers[i];
  this.layers[i] = this.layers[j];
  this.layers[j] = t;
  this.active = j;
  return true;
};
Doc.prototype.mergeDown = function (i) {
  if (i <= 0) return false;
  var top = this.layers[i], below = this.layers[i - 1];
  var g = below.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = top.opacity;
  g.globalCompositeOperation = top.blend;
  g.drawImage(top.canvas, 0, 0);
  g.restore();
  below.touch();
  this.layers.splice(i, 1);
  this.active = i - 1;
  return true;
};
Doc.prototype.moveLayerTo = function (from, to) {
  if (from === to || from < 0 || from >= this.layers.length) return false;
  to = DL.clamp(to, 0, this.layers.length - 1);
  var l = this.layers.splice(from, 1)[0];
  this.layers.splice(to, 0, l);
  this.active = to;
  return true;
};
Doc.prototype.mergeVisible = function () {
  var visible = [];
  for (var i = 0; i < this.layers.length; i++) if (this.layers[i].visible) visible.push(i);
  if (visible.length < 2) return false;
  var bottomIdx = visible[0];
  var bottom = this.layers[bottomIdx];
  var g = bottom.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (var k = 1; k < visible.length; k++) {
    var l = this.layers[visible[k]];
    g.globalAlpha = l.opacity;
    g.globalCompositeOperation = l.blend;
    g.drawImage(l.canvas, 0, 0);
  }
  g.restore();
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  bottom.touch();
  for (var j = visible.length - 1; j >= 1; j--) this.layers.splice(visible[j], 1);
  this.active = this.layers.indexOf(bottom);
  return true;
};
DL.Doc = Doc;

/* 文档快照（结构性操作的历史记录） */
DL.snapshotDoc = function (doc) {
  return {
    width: doc.width, height: doc.height, active: doc.active, fileName: doc.fileName,
    layers: doc.layers.map(function (l) {
      return {
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        blend: l.blend, locked: l.locked, canvas: DL.copyCanvas(l.canvas)
      };
    })
  };
};
DL.restoreDoc = function (doc, snap) {
  doc.width = snap.width; doc.height = snap.height; doc.fileName = snap.fileName;
  doc.layers = snap.layers.map(function (s) {
    var l = new Layer(snap.width, snap.height, s.name, s.id);
    l.visible = s.visible; l.opacity = s.opacity; l.blend = s.blend; l.locked = s.locked;
    l.ctx.drawImage(s.canvas, 0, 0);
    return l;
  });
  doc.active = DL.clamp(snap.active, 0, doc.layers.length - 1);
};
DL.snapBytes = function (snap) {
  var b = 0;
  for (var i = 0; i < snap.layers.length; i++) b += snap.layers[i].canvas.width * snap.layers[i].canvas.height * 4;
  return b;
};

/* ------------------------------------------------------------
 * 4. 撤销历史（上一步 / 下一步）
 * ---------------------------------------------------------- */
function History(limit, byteLimit) {
  this.limit = limit || 80;
  this.byteLimit = byteLimit || 620 * 1024 * 1024;
  this.stack = [];
  this.index = -1;
  this.bytes = 0;
  this.onChange = null;
}
History.prototype.record = function (entry) {
  /* 丢弃被撤销之后的分支 */
  var dropped = this.stack.splice(this.index + 1);
  for (var i = 0; i < dropped.length; i++) this.bytes -= dropped[i].bytes || 0;
  entry.bytes = entry.bytes || 0;
  this.stack.push(entry);
  this.bytes += entry.bytes;
  /* 超限裁剪：保留最近 8 步，其余按内存预算淘汰 */
  while (this.stack.length > this.limit || (this.bytes > this.byteLimit && this.stack.length > 8)) {
    var gone = this.stack.shift();
    this.bytes -= gone.bytes || 0;
  }
  this.index = this.stack.length - 1;
  this._changed();
};
History.prototype._changed = function () { if (this.onChange) this.onChange(); };
History.prototype.canUndo = function () { return this.index >= 0; };
History.prototype.canRedo = function () { return this.index < this.stack.length - 1; };
History.prototype.undo = function () {
  if (!this.canUndo()) return null;
  var e = this.stack[this.index];
  e.undo();
  this.index--;
  this._changed();
  return e;
};
History.prototype.redo = function () {
  if (!this.canRedo()) return null;
  var e = this.stack[this.index + 1];
  e.redo();
  this.index++;
  this._changed();
  return e;
};
History.prototype.clear = function () {
  this.stack = []; this.index = -1; this.bytes = 0; this._changed();
};
/* 跳转到任意历史点：t = -1 表示回到初始状态，t 为栈下标表示该步已执行 */
History.prototype.jump = function (t) {
  t = Math.max(-1, Math.min(this.stack.length - 1, t | 0));
  if (t === this.index) return false;
  var guard = 0;
  while (this.index > t) {
    if (this.index < 0) break;
    this.stack[this.index].undo();
    this.index--;
    if (++guard > 5000) break;
  }
  while (this.index < t) {
    var nx = this.index + 1;
    if (nx >= this.stack.length) break;
    this.stack[nx].redo();
    this.index = nx;
    if (++guard > 5000) break;
  }
  this._changed();
  return true;
};
History.prototype.entries = function () {
  var out = [];
  for (var i = 0; i < this.stack.length; i++) {
    out.push({ i: i, label: this.stack[i].label || '操作', done: i <= this.index });
  }
  return out;
};
History.prototype.label = function (dir) {
  if (dir === 'undo' && this.canUndo()) return this.stack[this.index].label || '操作';
  if (dir === 'redo' && this.canRedo()) return this.stack[this.index + 1].label || '操作';
  return '';
};
DL.History = History;

/* 生成一条像素级历史（只保存脏矩形，省内存） */
DL.pixelEntry = function (doc, layerId, rect, before, after, label) {
  return {
    label: label || '绘制',
    bytes: DL.rectBytes(rect) * 2,
    undo: function () {
      var l = DL.findLayer(doc, layerId);
      if (l) { DL.putRect(l.canvas, rect.x, rect.y, before); l.touch(); }
    },
    redo: function () {
      var l = DL.findLayer(doc, layerId);
      if (l) { DL.putRect(l.canvas, rect.x, rect.y, after); l.touch(); }
    }
  };
};
DL.findLayer = function (doc, id) {
  for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].id === id) return doc.layers[i];
  return null;
};

/* ------------------------------------------------------------
 * 5. 泛洪填充（油漆桶）
 * ---------------------------------------------------------- */
DL.floodFill = function (data, w, h, sx, sy, tol) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  var mask = new Uint8Array(w * h);
  var thr = (tol / 100) * 255;
  var o0 = (sy * w + sx) * 4;
  var a0 = data[o0 + 3];
  var r0 = data[o0] * a0 / 255, g0 = data[o0 + 1] * a0 / 255, b0 = data[o0 + 2] * a0 / 255;

  function match(i) {
    var o = i * 4, a = data[o + 3];
    var r = data[o] * a / 255, g = data[o + 1] * a / 255, b = data[o + 2] * a / 255;
    var dr = r - r0, dg = g - g0, db = b - b0, da = a - a0;
    if (dr < 0) dr = -dr; if (dg < 0) dg = -dg; if (db < 0) db = -db; if (da < 0) da = -da;
    var m = dr > dg ? dr : dg; if (db > m) m = db; if (da > m) m = da;
    return m <= thr;
  }

  var minX = sx, maxX = sx, minY = sy, maxY = sy;
  var stack = [sx, sy];
  while (stack.length) {
    var y = stack.pop(), x = stack.pop();
    if (mask[y * w + x] || !match(y * w + x)) continue;
    var x1 = x;
    while (x1 > 0 && !mask[y * w + x1 - 1] && match(y * w + x1 - 1)) x1--;
    var x2 = x;
    while (x2 < w - 1 && !mask[y * w + x2 + 1] && match(y * w + x2 + 1)) x2++;
    if (x1 < minX) minX = x1; if (x2 > maxX) maxX = x2;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (var xi = x1; xi <= x2; xi++) {
      mask[y * w + xi] = 1;
      if (y > 0) { var u = (y - 1) * w + xi; if (!mask[u] && match(u)) stack.push(xi, y - 1); }
      if (y < h - 1) { var d = (y + 1) * w + xi; if (!mask[d] && match(d)) stack.push(xi, y + 1); }
    }
  }
  return { mask: mask, x1: minX, y1: minY, x2: maxX, y2: maxY };
};

/* 全图同色替换（非连续模式） */
DL.globalColorPick = function (data, w, h, sx, sy, tol) {
  var mask = new Uint8Array(w * h);
  var thr = (tol / 100) * 255;
  var o0 = (Math.floor(sy) * w + Math.floor(sx)) * 4;
  var a0 = data[o0 + 3];
  var r0 = data[o0] * a0 / 255, g0 = data[o0 + 1] * a0 / 255, b0 = data[o0 + 2] * a0 / 255;
  var minX = w, maxX = 0, minY = h, maxY = 0, any = false;
  for (var i = 0, n = w * h; i < n; i++) {
    var o = i * 4, a = data[o + 3];
    var r = data[o] * a / 255, g = data[o + 1] * a / 255, b = data[o + 2] * a / 255;
    var m = Math.max(Math.abs(r - r0), Math.abs(g - g0), Math.abs(b - b0), Math.abs(a - a0));
    if (m <= thr) {
      mask[i] = 1; any = true;
      var x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!any) return null;
  return { mask: mask, x1: minX, y1: minY, x2: maxX, y2: maxY };
};

/* 蒙版 → 颜色图层（带 1px 膨胀，消除抗锯齿缝隙） */
DL.maskToCanvas = function (res, w, h, color, dilate) {
  var x1 = res.x1, y1 = res.y1, x2 = res.x2, y2 = res.y2;
  if (dilate !== false) {
    x1 = Math.max(0, x1 - 1); y1 = Math.max(0, y1 - 1);
    x2 = Math.min(w - 1, x2 + 1); y2 = Math.min(h - 1, y2 + 1);
  }
  var bw = x2 - x1 + 1, bh = y2 - y1 + 1;
  var src = res.mask;
  var out = new Uint8ClampedArray(bw * bh * 4);
  for (var y = y1; y <= y2; y++) {
    for (var x = x1; x <= x2; x++) {
      var on = src[y * w + x];
      if (!on && dilate !== false) {
        if (x > 0 && src[y * w + x - 1]) on = 1;
        else if (x < w - 1 && src[y * w + x + 1]) on = 1;
        else if (y > 0 && src[(y - 1) * w + x]) on = 1;
        else if (y < h - 1 && src[(y + 1) * w + x]) on = 1;
      }
      if (!on) continue;
      var o = ((y - y1) * bw + (x - x1)) * 4;
      out[o] = color.r; out[o + 1] = color.g; out[o + 2] = color.b; out[o + 3] = 255;
    }
  }
  var c = DL.createCanvas(bw, bh);
  c.getContext('2d').putImageData(new ImageData(out, bw, bh), 0, 0);
  return { canvas: c, x: x1, y: y1, w: bw, h: bh };
};

/* ------------------------------------------------------------
 * 5.5 颜色量化 / 按颜色分层
 * ---------------------------------------------------------- */
function nearestIn(pal, r, g, b) {
  var bi = 0, bd = Infinity;
  for (var i = 0; i < pal.length; i++) {
    var dr = pal[i].r - r, dg = pal[i].g - g, db = pal[i].b - b;
    var d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.8;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/**
 * 量化图片颜色：直方图 + 中位切分
 * 返回 { palette:[{r,g,b}], assign:Uint8Array(256 表示透明), counts:[] }
 */
DL.quantize = function (data, w, h, maxColors) {
  var hist = new Map();
  var n = w * h;
  var sampleStep = n > 1600000 ? 3 : (n > 500000 ? 2 : 1);
  for (var y = 0; y < h; y += sampleStep) {
    var row = y * w;
    for (var x = 0; x < w; x += sampleStep) {
      var i = (row + x) * 4;
      if (data[i + 3] < 8) continue;
      var R = data[i], G = data[i + 1], B = data[i + 2];
      var key = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
      var e = hist.get(key);
      if (!e) { e = { key: key, r: 0, g: 0, b: 0, n: 0 }; hist.set(key, e); }
      e.r += R; e.g += G; e.b += B; e.n++;
    }
  }
  var buckets = [];
  hist.forEach(function (e) {
    buckets.push({ key: e.key, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n });
  });
  if (!buckets.length) return null;

  function boxCount(bx) { var s = 0; for (var i = 0; i < bx.length; i++) s += bx[i].n; return s; }
  function longestCh(bx) {
    var mn = { r: 255, g: 255, b: 255 }, mx = { r: 0, g: 0, b: 0 };
    for (var i = 0; i < bx.length; i++) {
      var c = bx[i];
      if (c.r < mn.r) mn.r = c.r; if (c.r > mx.r) mx.r = c.r;
      if (c.g < mn.g) mn.g = c.g; if (c.g > mx.g) mx.g = c.g;
      if (c.b < mn.b) mn.b = c.b; if (c.b > mx.b) mx.b = c.b;
    }
    var dr = mx.r - mn.r, dg = mx.g - mn.g, db = mx.b - mn.b;
    if (dr >= dg && dr >= db) return 'r';
    return dg >= db ? 'g' : 'b';
  }

  var boxes = [buckets];
  while (boxes.length < maxColors && boxes.length < buckets.length) {
    var bi = -1, best = -1;
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      var sc = boxCount(boxes[i]);
      if (sc > best) { best = sc; bi = i; }
    }
    if (bi < 0) break;
    var box = boxes[bi];
    var ch = longestCh(box);
    box.sort(function (a, b) { return a[ch] - b[ch]; });
    var total = boxCount(box), acc = 0, cut = box.length >> 1;
    for (var j = 0; j < box.length - 1; j++) {
      acc += box[j].n;
      if (acc >= total / 2) { cut = j + 1; break; }
    }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }

  var palette = boxes.map(function (bx) {
    var r = 0, g = 0, b = 0, s = 0;
    for (var i = 0; i < bx.length; i++) { r += bx[i].r * bx[i].n; g += bx[i].g * bx[i].n; b += bx[i].b * bx[i].n; s += bx[i].n; }
    return { r: Math.round(r / s), g: Math.round(g / s), b: Math.round(b / s), n: s };
  });
  palette.sort(function (a, b) { return b.n - a.n; });
  palette.forEach(function (p) { p.hex = DL.rgbToHex(p.r, p.g, p.b); p.name = DL.colorName(p.r, p.g, p.b); });

  /* 桶 → 调色板 索引 */
  var map = new Map();
  buckets.forEach(function (bk) {
    map.set(bk.key, nearestIn(palette, bk.r, bk.g, bk.b));
  });

  var assign = new Uint8Array(n);
  var counts = new Array(palette.length);
  for (var k = 0; k < palette.length; k++) counts[k] = 0;
  for (var yy = 0; yy < h; yy++) {
    var ro = yy * w;
    for (var xx = 0; xx < w; xx++) {
      var p = ro + xx, o = p * 4;
      if (data[o + 3] < 8) { assign[p] = 255; continue; }
      var kk = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
      var gi = map.get(kk);
      if (gi === undefined) gi = nearestIn(palette, data[o], data[o + 1], data[o + 2]);
      assign[p] = gi;
      counts[gi]++;
    }
  }
  return { palette: palette, assign: assign, counts: counts };
};

/* 从画布提取一套色板（用于“画面色板取色”） */
DL.extractPalette = function (canvas, maxColors) {
  var max = 240;
  var s = Math.min(1, max / Math.max(canvas.width, canvas.height));
  var tw = Math.max(1, Math.round(canvas.width * s));
  var th = Math.max(1, Math.round(canvas.height * s));
  var c = DL.createCanvas(tw, th);
  var g = c.getContext('2d');
  g.drawImage(canvas, 0, 0, tw, th);
  var data = g.getImageData(0, 0, tw, th).data;
  var q = DL.quantize(data, tw, th, maxColors || 20);
  if (!q) return [];
  return q.palette.filter(function (p) { return p.n > 0; });
};

/* ------------------------------------------------------------
 * 5.6 选区：蒙版 → 轮廓线段（行进蚂蚁）
 * ---------------------------------------------------------- */
DL.buildOutline = function (mask, w, h, rect) {
  var segs = [];
  var x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  function get(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return mask[y * w + x] ? 1 : 0;
  }
  /* 水平边 */
  for (var y = y0; y <= y1; y++) {
    var start = -1;
    for (var x = x0; x <= x1; x++) {
      var a = (y > y0) ? get(x, y - 1) : 0;
      var b = (y < y1) ? get(x, y) : 0;
      var diff = (a !== b);
      if (diff) { if (start < 0) start = x; }
      else if (start >= 0) { segs.push(start, y, x, y); start = -1; }
    }
    if (start >= 0) segs.push(start, y, x1, y);
  }
  /* 垂直边 */
  for (var xx = x0; xx <= x1; xx++) {
    var st = -1;
    for (var yy = y0; yy <= y1; yy++) {
      var c = (xx > x0) ? get(xx - 1, yy) : 0;
      var d = (xx < x1) ? get(xx, yy) : 0;
      var df = (c !== d);
      if (df) { if (st < 0) st = yy; }
      else if (st >= 0) { segs.push(xx, st, xx, yy); st = -1; }
    }
    if (st >= 0) segs.push(xx, st, xx, y1);
  }
  return segs;
};

/* 蒙版 → 整幅 alpha 画布（用于裁剪绘制）
 * valueAlpha = true 时把蒙版数值本身当作 alpha（支持羽化软边） */
DL.maskToAlphaCanvas = function (mask, w, h, color, valueAlpha) {
  var c = DL.createCanvas(w, h);
  var g = c.getContext('2d');
  var img = g.createImageData(w, h);
  var d = img.data;
  var r = color ? color.r : 255, gg = color ? color.g : 255, b = color ? color.b : 255;
  for (var i = 0, n = w * h; i < n; i++) {
    var v = mask[i];
    var a = valueAlpha ? (v > 255 ? 255 : v) : (v ? 255 : 0);
    if (a) { var o = i * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = a; }
  }
  g.putImageData(img, 0, 0);
  return c;
};

/* 带位移地复制蒙版 */
DL.shiftMask = function (mask, w, h, dx, dy) {
  var out = new Uint8Array(w * h);
  for (var y = 0; y < h; y++) {
    var sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (var x = 0; x < w; x++) {
      var sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      if (mask[sy * w + sx]) out[y * w + x] = 1;
    }
  }
  return out;
};

/* ------------------------------------------------------------
 * 5.7 局部像素特效：模糊 / 锐化 / 液化 / 污点修复 / 裁剪
 * ---------------------------------------------------------- */

/* 圆形软蒙版（局部混合用），带缓存 */
var _diskCache = new Map();
DL.softDisk = function (w, h, hardness) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  var hh = Math.round(DL.clamp(hardness, 0, 1) * 100);
  var key = w + 'x' + h + '|' + hh;
  var c = _diskCache.get(key);
  if (c) return c;
  c = DL.createCanvas(w, h);
  var g = c.getContext('2d');
  var R = Math.min(w, h) / 2;
  var st = DL.clamp(hardness, 0, 0.94);
  var grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(0.5, R));
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(st, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  if (_diskCache.size > 80) _diskCache.clear();
  _diskCache.set(key, c);
  return c;
};

/* 圆周减淡蒙版（污点修复：只有中心完全替换） */
var _healCache = new Map();
DL.healDisk = function (w, h, core) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  var key = w + 'x' + h + '|' + Math.round(core * 100);
  var c = _healCache.get(key);
  if (c) return c;
  c = DL.createCanvas(w, h);
  var g = c.getContext('2d');
  var img = g.createImageData(w, h);
  var d = img.data;
  var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var dd = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy)) / R;
      var a = dd <= core ? 1 : Math.max(0, 1 - Math.pow((dd - core) / Math.max(0.001, 1 - core), 1.6));
      var o = (y * w + x) * 4;
      d[o] = 255; d[o + 1] = 255; d[o + 2] = 255;
      d[o + 3] = Math.round(DL.clamp(a, 0, 1) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  if (_healCache.size > 40) _healCache.clear();
  _healCache.set(key, c);
  return c;
};

/* 取一块越界安全的区域内容 */
DL.readRegion = function (src, x, y, w, h) {
  var x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  var x1 = Math.min(src.width, Math.ceil(x + w)), y1 = Math.min(src.height, Math.ceil(y + h));
  var bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  var c = DL.createCanvas(bw, bh);
  if (x1 > x0 && y1 > y0) c.getContext('2d').drawImage(src, x0, y0, bw, bh, 0, 0, bw, bh);
  return { canvas: c, x: x0, y: y0, w: bw, h: bh };
};

/* 局部模糊：返回 w×h 的模糊结果（边缘带 padding，避免吸到透明） */
DL.blurPatch = function (src, x, y, w, h, radius) {
  radius = Math.max(0.3, radius);
  var pad = Math.ceil(radius * 2.5) + 2;
  var pw = w + pad * 2, ph = h + pad * 2;
  var tmp = DL.createCanvas(pw, ph);
  var tg = tmp.getContext('2d');
  tg.drawImage(src, x - pad, y - pad, pw, ph, 0, 0, pw, ph);
  var out = DL.createCanvas(w, h);
  var g = out.getContext('2d');
  g.filter = 'blur(' + radius.toFixed(2) + 'px)';
  g.drawImage(tmp, pad, pad, w, h, 0, 0, w, h);
  g.filter = 'none';
  return out;
};

/* USM 锐化：out = src + k * (src - blur) */
DL.sharpenPatch = function (src, blurred, w, h, k) {
  var sg = src.getContext('2d'), bg = blurred.getContext('2d');
  var sd = sg.getImageData(0, 0, w, h), bd = bg.getImageData(0, 0, w, h);
  var s = sd.data, b = bd.data;
  for (var i = 0; i < s.length; i += 4) {
    if (s[i + 3] < 6) continue;
    for (var c = 0; c < 3; c++) {
      var v = s[i + c] + k * (s[i + c] - b[i + c]);
      s[i + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
  }
  sg.putImageData(sd, 0, 0);
  return src;
};

/* --- 液化：累积位移场 + 双线性重采样 --- */
function Liquify(w, h) {
  this.w = w; this.h = h;
  this.dx = new Float32Array(w * h);
  this.dy = new Float32Array(w * h);
  this.base = null;
  this.data = null;
}
Liquify.prototype.reset = function (baseCanvas) {
  this.dx.fill(0);
  this.dy.fill(0);
  this.base = baseCanvas;
  this.data = baseCanvas.getContext('2d').getImageData(0, 0, this.w, this.h).data;
};
/* 施加一次笔刷形变，返回受影响的包围盒 */
Liquify.prototype.warp = function (mode, cx, cy, r, amount, mvx, mvy) {
  var W = this.w, H = this.h;
  var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;
  var dxa = this.dx, dya = this.dy;
  for (var y = y0; y <= y1; y++) {
    var dyv = y - cy;
    var row = y * W;
    for (var x = x0; x <= x1; x++) {
      var dxv = x - cx;
      var dd = Math.sqrt(dxv * dxv + dyv * dyv);
      if (dd > r) continue;
      var t = dd / r;
      var f = 1 - t * t; f = f * f;
      var i = row + x;
      if (mode === 'push') {
        dxa[i] += mvx * f * amount;
        dya[i] += mvy * f * amount;
      } else if (mode === 'bloat' || mode === 'pinch') {
        var sgn = mode === 'bloat' ? 1 : -1;
        var ux = dd > 0.0001 ? dxv / dd : 0, uy = dd > 0.0001 ? dyv / dd : 0;
        var mag = sgn * amount * f * r * 0.12;
        dxa[i] += ux * mag;
        dya[i] += uy * mag;
      } else if (mode === 'twirl') {
        var a = amount * f * 0.32;
        var ca = Math.cos(a), sa = Math.sin(a);
        var sx = dxv - dxa[i], sy = dyv - dya[i];
        var nx = sx * ca - sy * sa, ny = sx * sa + sy * ca;
        dxa[i] = dxv - nx;
        dya[i] = dyv - ny;
      } else if (mode === 'restore') {
        dxa[i] *= (1 - f);
        dya[i] *= (1 - f);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
/* 按位移场重采样 base 写回实时画布 */
Liquify.prototype.render = function (liveCtx, rect) {
  var W = this.w, H = this.h;
  var d = this.data, dxa = this.dx, dya = this.dy;
  var img = liveCtx.createImageData(rect.w, rect.h);
  var out = img.data;
  for (var yy = 0; yy < rect.h; yy++) {
    var y = rect.y + yy;
    var row = y * W;
    for (var xx = 0; xx < rect.w; xx++) {
      var x = rect.x + xx;
      var i = row + x;
      var sx = x - dxa[i], sy = y - dya[i];
      if (sx < 0) sx = 0; else if (sx > W - 1) sx = W - 1;
      if (sy < 0) sy = 0; else if (sy > H - 1) sy = H - 1;
      var ix = sx | 0, iy = sy | 0;
      var fx = sx - ix, fy = sy - iy;
      var ix1 = ix + 1 < W ? ix + 1 : ix;
      var iy1 = iy + 1 < H ? iy + 1 : iy;
      var i00 = (iy * W + ix) * 4, i10 = (iy * W + ix1) * 4;
      var i01 = (iy1 * W + ix) * 4, i11 = (iy1 * W + ix1) * 4;
      var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      var w01 = (1 - fx) * fy, w11 = fx * fy;
      var o = (yy * rect.w + xx) * 4;
      out[o] = d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
      out[o + 1] = d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11;
      out[o + 2] = d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11;
      out[o + 3] = d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11;
    }
  }
  liveCtx.putImageData(img, rect.x, rect.y);
};
DL.Liquify = Liquify;

/* --- 污点修复：在周围环带里找最匹配的补丁，软边混合进来 --- */
DL.healPatch = function (live, liveCtx, W, H, cx, cy, r, strength, samples, core) {
  var ir = Math.ceil(r);
  var tx0 = Math.max(0, Math.floor(cx - ir)), ty0 = Math.max(0, Math.floor(cy - ir));
  var tx1 = Math.min(W, Math.ceil(cx + ir + 1)), ty1 = Math.min(H, Math.ceil(cy + ir + 1));
  var tw = tx1 - tx0, th = ty1 - ty0;
  if (tw < 5 || th < 5) return null;

  var reach = Math.ceil(r * 2.1) + 3;
  var ex0 = Math.max(0, tx0 - reach), ey0 = Math.max(0, ty0 - reach);
  var ex1 = Math.min(W, tx1 + reach), ey1 = Math.min(H, ty1 + reach);
  var ew = ex1 - ex0, eh = ey1 - ey0;
  if (ew < 5 || eh < 5) return null;

  var bd = liveCtx.getImageData(ex0, ey0, ew, eh).data;
  function off(x, y) { return ((y - ey0) * ew + (x - ex0)) * 4; }

  var N = Math.max(8, Math.round(samples || 24));
  var inner = r * 0.62, outer = r * 0.92;
  var best = null, bestCost = Infinity;
  for (var k = 0; k < N; k++) {
    var ang = (k / N) * Math.PI * 2 + Math.random() * 0.35;
    var dist = r * (1.28 + Math.random() * 0.7);
    var ox = Math.round(Math.cos(ang) * dist), oy = Math.round(Math.sin(ang) * dist);
    if (cx + ox - ir < ex0 || cx + ox + ir > ex1) continue;
    if (cy + oy - ir < ey0 || cy + oy + ir > ey1) continue;
    var cost = 0, cnt = 0;
    for (var y = ty0; y < ty1; y += 2) {
      var dyv = y - cy;
      for (var x = tx0; x < tx1; x += 2) {
        var dxv = x - cx;
        var dd = Math.sqrt(dxv * dxv + dyv * dyv);
        if (dd < inner || dd > outer) continue;
        var T = off(x, y), S = off(x + ox, y + oy);
        var dr = bd[T] - bd[S], dg = bd[T + 1] - bd[S + 1], db = bd[T + 2] - bd[S + 2];
        var da = (bd[T + 3] - bd[S + 3]) * 0.5;
        cost += dr * dr + dg * dg + db * db + da * da;
        cnt++;
      }
    }
    if (!cnt) continue;
    cost /= cnt;
    if (cost < bestCost) { bestCost = cost; best = { x: ox, y: oy }; }
  }
  if (!best) return null;

  var patch = DL.createCanvas(tw, th);
  var pg = patch.getContext('2d');
  var img = pg.createImageData(tw, th);
  var od = img.data;
  for (var yy = 0; yy < th; yy++) {
    for (var xx = 0; xx < tw; xx++) {
      var Tx = tx0 + xx + best.x, Ty = ty0 + yy + best.y;
      if (Tx < ex0 || Ty < ey0 || Tx >= ex1 || Ty >= ey1) continue;
      var S2 = ((Ty - ey0) * ew + (Tx - ex0)) * 4;
      var O2 = (yy * tw + xx) * 4;
      od[O2] = bd[S2]; od[O2 + 1] = bd[S2 + 1]; od[O2 + 2] = bd[S2 + 2]; od[O2 + 3] = bd[S2 + 3];
    }
  }
  pg.putImageData(img, 0, 0);
  pg.globalCompositeOperation = 'destination-in';
  pg.drawImage(DL.healDisk(tw, th, core == null ? 0.5 : core), 0, 0);
  pg.globalCompositeOperation = 'source-over';

  liveCtx.save();
  liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  liveCtx.globalCompositeOperation = 'source-over';
  liveCtx.globalAlpha = DL.clamp(strength == null ? 0.96 : strength, 0, 1);
  liveCtx.drawImage(patch, tx0, ty0);
  liveCtx.restore();
  return { x: tx0, y: ty0, w: tw, h: th };
};

/* --- 文档裁剪 --- */
DL.cropDoc = function (doc, x, y, w, h) {
  x = Math.round(x); y = Math.round(y);
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    var nc = DL.createCanvas(w, h);
    nc.getContext('2d').drawImage(l.canvas, -x, -y);
    l.canvas = nc;
    l.ctx = nc.getContext('2d');
    l.touch();
  }
  doc.width = w;
  doc.height = h;
};

/* --- 区域生长（对象选择 / 快速选择画笔） --- */
DL.regionGrow = function (data, w, h, sx, sy, tol, radius) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  var r = Math.max(1, radius);
  var r2 = r * r;
  var x0 = Math.max(0, sx - r), x1 = Math.min(w - 1, sx + r);
  var y0 = Math.max(0, sy - r), y1 = Math.min(h - 1, sy + r);
  var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  var flag = new Uint8Array(bw * bh); /* 0 未访问 / 1 命中 / 2 排除 */
  var thr = (tol / 100) * 255;
  var o0 = (sy * w + sx) * 4;
  var a0 = data[o0 + 3];
  var r0 = data[o0] * a0 / 255, g0 = data[o0 + 1] * a0 / 255, b0 = data[o0 + 2] * a0 / 255;
  var minX = sx, maxX = sx, minY = sy, maxY = sy, any = false;
  var stack = [sx, sy];
  while (stack.length) {
    var y = stack.pop(), x = stack.pop();
    var lx = x - x0, ly = y - y0;
    var fi = ly * bw + lx;
    if (flag[fi]) continue;
    var dxv = x - sx, dyv = y - sy;
    if (dxv * dxv + dyv * dyv > r2) { flag[fi] = 2; continue; }
    var o = (y * w + x) * 4, a = data[o + 3];
    var rr = data[o] * a / 255, gg = data[o + 1] * a / 255, bb = data[o + 2] * a / 255;
    var m = Math.abs(rr - r0);
    var t2 = Math.abs(gg - g0); if (t2 > m) m = t2;
    t2 = Math.abs(bb - b0); if (t2 > m) m = t2;
    t2 = Math.abs(a - a0); if (t2 > m) m = t2;
    if (m > thr) { flag[fi] = 2; continue; }
    flag[fi] = 1;
    any = true;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x > x0) stack.push(x - 1, y);
    if (x < x1) stack.push(x + 1, y);
    if (y > y0) stack.push(x, y - 1);
    if (y < y1) stack.push(x, y + 1);
  }
  if (!any) return null;
  return { flag: flag, bw: bw, bh: bh, x: x0, y: y0, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
};

/* ------------------------------------------------------------
 * 6. 渲染器
 * ---------------------------------------------------------- */
function Renderer(app) {
  this.app = app;
  this.canvas = document.getElementById('view');
  this.ctx = this.canvas.getContext('2d');
  this.overlay = document.getElementById('overlay');
  this.octx = this.overlay ? this.overlay.getContext('2d') : null;
  this.scale = 1;
  this.ox = 0;
  this.oy = 0;
  this.dpr = 1;
  this.vw = 0;
  this.vh = 0;
  this._raf = 0;
  this._antsRaf = 0;
  this.antsPhase = 0;
  this._tmp = null;
  this.checker = this._makeChecker();
}
Renderer.prototype._makeChecker = function (colored) {
  var c = DL.createCanvas(16, 16), g = c.getContext('2d');
  if (colored) {
    g.fillStyle = '#f6f7f9'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#dde1e8'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  } else {
    g.fillStyle = '#23262c'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#1b1e23'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  }
  return this.ctx.createPattern(c, 'repeat');
};
/* 透明区域棋盘：深色 / 彩色（浅色）两种观感 */
Renderer.prototype.setCheckerColored = function (on) {
  this.checkerColored = !!on;
  this.checker = this._makeChecker(this.checkerColored);
  this.requestRender();
};
Renderer.prototype.resize = function () {
  var stage = document.getElementById('stage');
  var w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  this.dpr = global.devicePixelRatio || 1;
  this.vw = w; this.vh = h;
  var pw = Math.round(w * this.dpr), ph = Math.round(h * this.dpr);
  this.canvas.width = pw; this.canvas.height = ph;
  this.canvas.style.width = w + 'px';
  this.canvas.style.height = h + 'px';
  if (this.overlay) {
    this.overlay.width = pw; this.overlay.height = ph;
    this.overlay.style.width = w + 'px';
    this.overlay.style.height = h + 'px';
  }
  this.renderOverlay();
  this.requestRender();
};
Renderer.prototype.fit = function () {
  var d = this.app.doc;
  var pad = 48;
  var s = Math.min((this.vw - pad) / d.width, (this.vh - pad) / d.height);
  if (!isFinite(s) || s <= 0) s = 1;
  this.scale = DL.clamp(s, 0.02, 16);
  this.center();
  if (this.app.ui) this.app.ui.updateZoom();
  this.requestRender();
};
Renderer.prototype.center = function () {
  var d = this.app.doc;
  this.ox = Math.round((this.vw - d.width * this.scale) / 2);
  this.oy = Math.round((this.vh - d.height * this.scale) / 2);
};
Renderer.prototype.zoomAt = function (factor, vx, vy) {
  var before = this.toDoc(vx, vy);
  var s = DL.clamp(this.scale * factor, 0.02, 24);
  if (s === this.scale) return;
  this.scale = s;
  var after = this.toDoc(vx, vy);
  this.ox += (after.x - before.x) * this.scale;
  this.oy += (after.y - before.y) * this.scale;
  if (this.app.ui) this.app.ui.updateZoom();
  this.requestRender();
};
Renderer.prototype.setZoom = function (s) {
  var c = { x: this.vw / 2, y: this.vh / 2 };
  this.zoomAt(s / this.scale, c.x, c.y);
};
Renderer.prototype.toDoc = function (vx, vy) {
  return { x: (vx - this.ox) / this.scale, y: (vy - this.oy) / this.scale };
};
Renderer.prototype.toView = function (x, y) {
  return { x: x * this.scale + this.ox, y: y * this.scale + this.oy };
};
Renderer.prototype.requestRender = function () {
  var self = this;
  if (this._raf) return;
  this._raf = requestAnimationFrame(function () { self._raf = 0; self.render(); });
};
Renderer.prototype.render = function () {
  var app = this.app, doc = app.doc, ctx = this.ctx;
  var W = this.canvas.width, H = this.canvas.height;
  if (!W || !H) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  var s = this.scale * this.dpr;
  var ox = this.ox * this.dpr, oy = this.oy * this.dpr;
  var dw = doc.width * s, dh = doc.height * s;

  /* 画纸投影（先画，随后被棋盘盖住，仅留边缘阴影） */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 22 * this.dpr;
  ctx.shadowOffsetY = 5 * this.dpr;
  ctx.fillStyle = 'rgba(0,0,0,.9)';
  ctx.fillRect(ox, oy, dw, dh);
  ctx.restore();

  /* 画纸（透明棋盘） */
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = this.checker;
  ctx.fillRect(0, 0, dw, dh);
  ctx.restore();

  var stroke = app.stroke;
  var activeIdx = doc.active;

  /* 橡皮擦实时预览需要一份临时图层 */
  var eraseTmp = null;
  if (stroke.active && stroke.mode === 'buffer' && stroke.erase) {
    var al = doc.activeLayer();
    if (!this._tmp) this._tmp = DL.createCanvas(doc.width, doc.height);
    var tc = this._tmp;
    if (tc.width !== doc.width || tc.height !== doc.height) { tc.width = doc.width; tc.height = doc.height; }
    var tg = tc.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, tc.width, tc.height);
    if (al) tg.drawImage(al.canvas, 0, 0);
    tg.globalCompositeOperation = 'destination-out';
    tg.globalAlpha = stroke.opacity;
    tg.drawImage(stroke.canvas, 0, 0);
    tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over';
    eraseTmp = tc;
  }

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.imageSmoothingEnabled = this.scale < 3;
  ctx.imageSmoothingQuality = 'high';

  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    if (!l.visible || l.opacity <= 0) continue;
    var isActive = (i === activeIdx);
    var src = l.canvas;
    if (isActive) {
      if (eraseTmp) src = eraseTmp;
      else if (stroke.active && stroke.mode === 'direct' && app.liveCanvas) src = app.liveCanvas;
    }
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    ctx.drawImage(src, 0, 0);

    if (isActive && stroke.active && stroke.mode === 'buffer' && !stroke.erase) {
      ctx.globalAlpha = l.opacity * stroke.opacity;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(stroke.canvas, 0, 0);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  /* 网格 */
  if (app.ui && app.ui.gridOn && this.scale > 0.12) {
    var step = 64;
    while (step * this.scale < 26) step *= 2;
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath();
    for (var gx = step; gx < doc.width; gx += step) { ctx.moveTo(gx, 0); ctx.lineTo(gx, doc.height); }
    for (var gy = step; gy < doc.height; gy += step) { ctx.moveTo(0, gy); ctx.lineTo(doc.width, gy); }
    ctx.stroke();
  }

  /* 边框 */
  ctx.lineWidth = 1 / this.scale;
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.strokeRect(-0.5 / this.scale, -0.5 / this.scale, doc.width + 1 / this.scale, doc.height + 1 / this.scale);
  ctx.restore();

  /* 仿制图章源点标记 */
  if (app.activeToolId && app.activeToolId() === 'clone' && app.cloneSource) {
    var p = this.toView(app.cloneSource.x, app.cloneSource.y);
    var r = 9 * this.dpr;
    ctx.save();
    ctx.translate(p.x * this.dpr, p.y * this.dpr);
    ctx.lineWidth = 1.4 * this.dpr;
    ctx.strokeStyle = 'rgba(255,120,120,.95)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, 0); ctx.lineTo(-r * .6, 0);
    ctx.moveTo(r * .6, 0); ctx.lineTo(r * 1.5, 0);
    ctx.moveTo(0, -r * 1.5); ctx.lineTo(0, -r * .6);
    ctx.moveTo(0, r * .6); ctx.lineTo(0, r * 1.5);
    ctx.stroke();
    ctx.restore();
  }
};
/* 覆盖层：选区轮廓（行进蚂蚁）、裁剪框、渐变指示、取色放大镜 */
Renderer.prototype.renderOverlay = function () {
  if (!this.octx) return;
  var app = this.app, ctx = this.octx;
  var W = this.overlay.width, H = this.overlay.height;
  if (!W || !H) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  var ov = app.overlayState || {};
  var s = this.scale * this.dpr;
  var ox = this.ox * this.dpr, oy = this.oy * this.dpr;
  var sel = app.selection;

  if (sel && sel.segs && sel.segs.length) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    var segs = sel.segs;
    function strokeAll(dash, offset, style, lw) {
      ctx.beginPath();
      for (var i = 0; i < segs.length; i += 4) {
        ctx.moveTo(segs[i], segs[i + 1]);
        ctx.lineTo(segs[i + 2], segs[i + 3]);
      }
      ctx.setLineDash(dash);
      ctx.lineDashOffset = offset;
      ctx.strokeStyle = style;
      ctx.lineWidth = lw / s;
      ctx.stroke();
    }
    strokeAll([], 0, 'rgba(0,0,0,.85)', 2);
    strokeAll([4, 4], this.antsPhase, 'rgba(255,255,255,.95)', 2);
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (ov.crop) this._drawCropBox(ctx, ov.crop, s, ox, oy);
  if (ov.grad) this._drawGradGuide(ctx, ov.grad, s, ox, oy);
  if (ov.loupe) this._drawLoupe(ctx, ov.loupe);
};

/* 裁剪框 */
Renderer.prototype._drawCropBox = function (ctx, c, s, ox, oy) {
  var W = this.overlay.width, H = this.overlay.height, dpr = this.dpr;
  var x = c.x * s + ox, y = c.y * s + oy, w = Math.max(0, c.w * s), h = Math.max(0, c.h * s);
  if (w < 1 || h < 1) return;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(0, 0, W, y);
  ctx.fillRect(0, y + h, W, H - y - h);
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, W - x - w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  for (var i = 1; i <= 2; i++) {
    ctx.moveTo(x + w * i / 3, y); ctx.lineTo(x + w * i / 3, y + h);
    ctx.moveTo(x, y + h * i / 3); ctx.lineTo(x + w, y + h * i / 3);
  }
  ctx.stroke();
  ctx.setLineDash([7 * dpr, 4 * dpr]);
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = 1.4 * dpr;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  var hs = 4 * dpr;
  [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (p) {
    ctx.fillRect(p[0] - hs / 2, p[1] - hs / 2, hs, hs);
  });
  var label = Math.round(c.w) + ' × ' + Math.round(c.h);
  ctx.font = (11 * dpr) + 'px "Segoe UI","Microsoft YaHei",sans-serif';
  var tw = ctx.measureText(label).width + 12 * dpr;
  var ly = Math.min(H - 22 * dpr, y + h + 8 * dpr);
  ctx.fillStyle = 'rgba(16,18,22,.88)';
  ctx.fillRect(x + w / 2 - tw / 2, ly, tw, 18 * dpr);
  ctx.fillStyle = '#dfe6f3';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, ly + 9 * dpr);
  ctx.restore();
};

/* 渐变方向指示 */
Renderer.prototype._drawGradGuide = function (ctx, g, s, ox, oy) {
  var dpr = this.dpr;
  var x0 = g.x0 * s + ox, y0 = g.y0 * s + oy;
  var x1 = g.x1 * s + ox, y1 = g.y1 * s + oy;
  ctx.save();
  ctx.lineWidth = 1.4 * dpr;
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineDashOffset = 5 * dpr;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(x0, y0, 5 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x1, y1, 5 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,22,28,.9)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
  ctx.restore();
};

/* 取色放大镜 */
Renderer.prototype._drawLoupe = function (ctx, l) {
  var app = this.app, dpr = this.dpr;
  var R = 66 * dpr;
  var cx = l.vx * dpr, cy = l.vy * dpr - R - 26 * dpr;
  if (cy - R < 6 * dpr) cy = l.vy * dpr + R + 26 * dpr;
  var zoom = 7;
  var s = this.scale * dpr;
  var R2 = R - 2.5 * dpr;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,14,18,.92)';
  ctx.fill();

  var layer = app.doc.activeLayer();
  var src = (app.settings.opts.sampleFrom === 'active' && layer) ? layer.canvas : app.merged();
  var d = this.toDoc(l.vx, l.vy);
  var q = R2 / Math.max(0.0001, s * zoom);

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R2, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, d.x - q, d.y - q, q * 2, q * 2, cx - R2, cy - R2, R2 * 2, R2 * 2);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();

  /* 中心像素方框 */
  var cell = Math.max(6 * dpr, s * zoom);
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = 1.4 * dpr;
  ctx.strokeRect(cx - cell / 2, cy - cell / 2, cell, cell);
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - R2, cy); ctx.lineTo(cx + R2, cy);
  ctx.moveTo(cx, cy - R2); ctx.lineTo(cx, cy + R2);
  ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();

  /* 色块 + HEX */
  var fg = app.fg();
  var pad = 8 * dpr, bw = 56 * dpr, bh = 22 * dpr;
  var by = cy + R + 6 * dpr;
  ctx.fillStyle = 'rgba(12,14,18,.92)';
  ctx.beginPath();
  var bx = cx - bw / 2 - pad / 2;
  if (ctx.roundRect) { ctx.roundRect(bx, by, bw + pad, bh, 6 * dpr); ctx.fill(); }
  else ctx.fillRect(bx, by, bw + pad, bh);
  ctx.fillStyle = fg;
  ctx.fillRect(bx + 4 * dpr, by + 4 * dpr, (bw + pad) - 8 * dpr - 62 * dpr, bh - 8 * dpr);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(bx + 4 * dpr, by + 4 * dpr, (bw + pad) - 8 * dpr - 62 * dpr, bh - 8 * dpr);
  ctx.fillStyle = '#e7eaf0';
  ctx.font = (11 * dpr) + 'px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(fg.toUpperCase(), bx + (bw + pad) - 58 * dpr, by + bh / 2);
  ctx.restore();
};
Renderer.prototype.startAnts = function () {
  if (this._antsRaf) return;
  var self = this;
  function tick() {
    self.antsPhase = (self.antsPhase - 0.6) % 8;
    self.renderOverlay();
    self._antsRaf = requestAnimationFrame(tick);
  }
  this._antsRaf = requestAnimationFrame(tick);
};
Renderer.prototype.stopAnts = function () {
  if (this._antsRaf) { cancelAnimationFrame(this._antsRaf); this._antsRaf = 0; }
  this.renderOverlay();
};

DL.Renderer = Renderer;

/* ------------------------------------------------------------
 * 7. 笔刷引擎
 * ---------------------------------------------------------- */
DL.brushTypes = [
  { id: 'round',       name: '硬边圆', spacing: 0.09, hardness: 0.92 },
  { id: 'soft',        name: '柔边圆', spacing: 0.07, hardness: 0.45 },
  { id: 'airbrush',    name: '喷枪',   spacing: 0.04, hardness: 0.05, flow: 0.22 },
  { id: 'pencil',      name: '铅笔',   spacing: 0.06, hardness: 1.00, flow: 0.75, grain: 'fine' },
  { id: 'marker',      name: '马克笔', spacing: 0.06, hardness: 1.00, flow: 0.62 },
  { id: 'chalk',       name: '粉笔',   spacing: 0.11, hardness: 0.95, grain: 'coarse' },
  { id: 'spray',       name: '喷溅',   spacing: 0.10, hardness: 1.00, flow: 0.30 },
  { id: 'calligraphy', name: '书法',   spacing: 0.05, hardness: 1.00, flow: 0.95, follow: true }
];

DL.brush = (function () {
  var maskCache = new Map();
  var tintCache = new Map();
  var TINT_MAX = 56;
  var PAD = 2;

  /* --- 颗粒纹理 --- */
  function makeGrain(size, coarse) {
    var c = DL.createCanvas(size, size), g = c.getContext('2d');
    var img = g.createImageData(size, size);
    var d = img.data;
    var cover = coarse ? 0.46 : 0.72;
    for (var i = 0; i < size * size; i++) {
      var a = Math.random() < cover ? (150 + Math.random() * 105) : 0;
      d[i * 4] = 255; d[i * 4 + 1] = 255; d[i * 4 + 2] = 255; d[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  var grains = {
    coarse: [makeGrain(96, true), makeGrain(96, true), makeGrain(96, true), makeGrain(96, true)],
    fine: [makeGrain(64, false), makeGrain(64, false), makeGrain(64, false), makeGrain(64, false)]
  };

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fill();
  }

  function buildMask(type, size, hardness, angle, variant) {
    var s = Math.max(1, size);
    var c = DL.createCanvas(s + PAD * 2, s + PAD * 2);
    var g = c.getContext('2d');
    var cx = c.width / 2, cy = c.height / 2, r = s / 2;
    var h = DL.clamp(hardness, 0, 1);

    if (type === 'marker' || type === 'calligraphy') {
      var w = type === 'calligraphy' ? s * 1.7 : s * 0.82;
      var hh = type === 'calligraphy' ? Math.max(1.2, s * 0.13) : Math.max(1.5, s * 0.62);
      g.save();
      g.translate(cx, cy);
      g.rotate(angle || 0);
      g.fillStyle = 'rgba(255,255,255,1)';
      roundRect(g, -w / 2, -hh / 2, w, hh, Math.min(hh / 2, 2));
      g.restore();
    } else {
      var grad = g.createRadialGradient(cx, cy, Math.max(0, r * 0.02), cx, cy, r);
      if (type === 'airbrush') {
        grad.addColorStop(0, 'rgba(255,255,255,0.55)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.28)');
        grad.addColorStop(0.7, 'rgba(255,255,255,0.09)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
      } else if (type === 'soft') {
        var st = DL.clamp(h, 0, 0.9);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(st, 'rgba(255,255,255,0.92)');
        grad.addColorStop(DL.clamp(st + (1 - st) * 0.55, 0, 0.96), 'rgba(255,255,255,0.34)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
      } else {
        var stop = type === 'pencil' ? 0.94 : DL.clamp(h, 0, 0.99);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        if (stop > 0.001) grad.addColorStop(stop, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
      }
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    }

    /* 颗粒化 */
    var gr = type === 'chalk' ? grains.coarse : (type === 'pencil' ? grains.fine : null);
    if (gr) {
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = g.createPattern(gr[(variant || 0) % gr.length], 'repeat');
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
    }
    c.__key = [type, size, Math.round(hardness * 100), Math.round((angle || 0) * 57.2958), variant || 0].join('|');
    return c;
  }

  function getMask(type, size, hardness, angle, variant) {
    var sizeQ = size < 6 ? Math.round(size * 2) / 2 : Math.round(size);
    var key = [type, sizeQ, Math.round(hardness * 100), Math.round((angle || 0) * 57.2958), variant || 0].join('|');
    var m = maskCache.get(key);
    if (m) return m;
    m = buildMask(type, sizeQ, hardness, angle, variant);
    if (maskCache.size > 220) maskCache.clear();
    maskCache.set(key, m);
    return m;
  }

  function tint(mask, color) {
    var key = mask.__key + '#' + color;
    var t = tintCache.get(key);
    if (t) return t;
    var c = DL.createCanvas(mask.width, mask.height);
    var g = c.getContext('2d');
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    if (tintCache.size > TINT_MAX) tintCache.clear();
    tintCache.set(key, c);
    return c;
  }

  /* 单次落笔（一个印章） */
  function stamp(g, x, y, p) {
    var size = Math.max(1, p.size);
    if (p.type === 'spray') return spray(g, x, y, p);
    var variant = (p.type === 'chalk' || p.type === 'pencil') ? ((Math.random() * 4) | 0) : 0;
    var mask = getMask(p.type, size, p.hardness, p.angle || 0, variant);
    var src = p.erase ? mask : tint(mask, p.color);
    g.globalAlpha = DL.clamp(p.flow, 0, 1);
    g.drawImage(src, x - mask.width / 2, y - mask.height / 2);
    g.globalAlpha = 1;
  }

  function spray(g, x, y, p) {
    var r = Math.max(0.6, p.size / 2);
    var n = Math.max(3, Math.round(p.size * 0.5));
    var dot = Math.max(0.4, p.size * 0.018);
    g.fillStyle = p.color;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var d = Math.sqrt(Math.random()) * r;
      g.globalAlpha = DL.clamp(p.flow * (0.18 + Math.random() * 0.82), 0, 1);
      g.beginPath();
      g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, dot, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  return {
    stamp: stamp,
    spray: spray,
    getMask: getMask,
    tint: tint,
    clearCache: function () { maskCache.clear(); tintCache.clear(); }
  };
})();

/* ------------------------------------------------------------
 * 8. 画笔预览图（工具栏 / 笔刷网格用）
 * ---------------------------------------------------------- */
DL.renderBrushPreview = function (canvas, type, color) {
  var w = canvas.width, h = canvas.height;
  var g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  var size = Math.min(h * 0.72, w * 0.72);
  var ctx2 = g;
  ctx2.globalCompositeOperation = 'source-over';
  var pts = [];
  var n = 16;
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    pts.push([4 + t * (w - 8), h / 2 + Math.sin(t * Math.PI * 1.35) * (h * 0.24)]);
  }
  var step = Math.max(0.6, size * (type === 'chalk' ? 0.14 : 0.10));
  for (var k = 0; k < pts.length - 1; k++) {
    var a = pts[k], b = pts[k + 1];
    var dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    var cnt = Math.max(1, Math.floor(dist / step));
    for (var j = 0; j <= cnt; j++) {
      var f = cnt ? j / cnt : 0;
      DL.brush.stamp(ctx2, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, {
        type: type, size: size * (0.55 + 0.45 * Math.sin(f * Math.PI)),
        hardness: 0.85, color: color || '#dfe6f3', flow: 0.95, angle: 0.6
      });
    }
  }
};

})(window);

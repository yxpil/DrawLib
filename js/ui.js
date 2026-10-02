/* ============================================================
 * DrawLib · ui.js
 * 界面绑定 / 取色器 / 图层面板 / 快捷键 / PNG 读写 / 主程序
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
}); };
DL.esc = esc;

/* ------------------------------------------------------------
 * 通用弹窗
 * ---------------------------------------------------------- */
DL.dialog = function (opts) {
  var backdrop = $('modal-backdrop'), modal = $('modal');
  return new Promise(function (resolve) {
    var done = false;
    modal.className = 'modal' + (opts.wide ? ' wide' : '') + (opts.cls ? ' ' + opts.cls : '');
    modal.innerHTML =
      '<h4>' + esc(opts.title || '') + '</h4>' +
      '<div class="modal-body">' + (opts.html || '') + '</div>' +
      '<div class="modal-actions"></div>';
    var actions = modal.querySelector('.modal-actions');
    function finish(v) {
      if (done) return; done = true;
      backdrop.hidden = true;
      modal.className = 'modal';
      backdrop.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve({ action: v, root: modal });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(null); }
      else if (e.key === 'Enter' && !opts.noEnter && e.target.tagName !== 'TEXTAREA') {
        var p = modal.querySelector('.btn.primary'); if (p) { e.preventDefault(); finish('ok'); }
      }
    }
    (opts.actions || [{ label: '确定', value: 'ok', primary: true }]).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', function () { finish(a.value); });
      actions.appendChild(b);
    });
    backdrop.hidden = false;
    backdrop.onclick = function (e) { if (e.target === backdrop) finish(null); };
    document.addEventListener('keydown', onKey, true);
    if (opts.onMount) opts.onMount(modal);
    var f = modal.querySelector('input[type=text],input[type=number]');
    if (f) { f.focus(); if (f.select) f.select(); }
  });
};

/* ------------------------------------------------------------
 * App
 * ---------------------------------------------------------- */
function App() {
  this.settings = {
    tool: 'brush',
    color: '#1A1A1A',
    bgColor: '#FFFFFF',
    recent: [],
    brush: {
      type: 'round', size: 24, opacity: 1, flow: 1,
      hardness: 0.75, spacing: 0.12, smoothing: 0.25,
      pressureSize: true, pressureFlow: false
    },
    opts: {
      smudgeStrength: 0.5,
      cloneAligned: true, cloneAllLayers: true,
      bucketTolerance: 32, bucketContiguous: true, bucketAllLayers: false,
      sampleSize: 3, sampleFrom: 'merged', loupe: true,
      pressureCurve: 1, pressureMin: 0.12,
      tiltEnabled: true, tiltAmount: 0.45,
      pinchZoom: true, threeFingerErase: true,
      selectTolerance: 32, selectGlobal: false, selectAllLayers: true,
      objectTolerance: 24,
      liquifyMode: 'push', liquifyPower: 0.55,
      gradType: 'linear', gradColor: 'fg-bg', gradOpacity: 0.9, gradReverse: false,
      blurSize: 30, blurStrength: 0.6,
      healStrength: 0.96, healSamples: 24, healCore: 0.5,
      cropDelete: true,
      dodgeMode: 'dodge', dodgeExposure: 0.5, dodgeRange: 'midtones'
    },
    text: {
      content: '', font: 'system', size: 64, bold: false, italic: false,
      align: 'left', newLayer: true
    },
    fonts: [
      { id: 'system', label: '系统默认', css: '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif' },
      { id: 'heiti', label: '黑体', css: '"Microsoft YaHei","SimHei","Heiti SC",sans-serif' },
      { id: 'songti', label: '宋体', css: '"SimSun","Songti SC",serif' },
      { id: 'kaiti', label: '楷体', css: '"KaiTi","Kaiti SC","STKaiti",serif' },
      { id: 'fangsong', label: '仿宋', css: '"FangSong","STFangsong",serif' },
      { id: 'arial', label: 'Arial', css: 'Arial,Helvetica,sans-serif' },
      { id: 'times', label: 'Times', css: '"Times New Roman",Times,serif' },
      { id: 'georgia', label: 'Georgia', css: 'Georgia,serif' },
      { id: 'courier', label: '等宽', css: '"Courier New",Consolas,monospace' },
      { id: 'impact', label: 'Impact', css: 'Impact,Charcoal,sans-serif' }
    ]
  };

  this.doc = new DL.Doc(1280, 800);
  this.doc.layers[0].name = '背景';
  (function (l) {
    var g = l.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, l.canvas.width, l.canvas.height);
  })(this.doc.layers[0]);

  this.history = new DL.History();
  this.history.onChange = function () { app.ui.updateUndo(); };
  var app = this;

  this.hsv = { h: 0, s: 0, v: 0.1 };
  this.cloneSource = null;
  this.cloneOffset = null;
  this.liveCanvas = null;
  this.liveCtx = null;
  this._merged = null;
  this._mergedDirty = true;
  this.gridOn = false;
  this.selection = null;
  this._selMaskCanvas = null;
  this._selMaskFor = null;
  this._forcedTool = null;
  this._discard = false;
  this.overlayState = { crop: null, grad: null, loupe: null };

  this.renderer = new DL.Renderer(this);
  this.tools = DL.createTools(this);
  this.stroke = {
    active: false, mode: 'buffer', erase: false, opacity: 1,
    canvas: DL.createCanvas(this.doc.width, this.doc.height),
    ctx: null, rect: null
  };
  this.stroke.ctx = this.stroke.canvas.getContext('2d');
  this.ui = new UI(this);
}

/* ---------- 颜色 ---------- */
App.prototype.fg = function () { return this.settings.color; };
App.prototype.setColor = function (hex, opts) {
  var rgb = DL.hexToRgb(hex);
  if (!rgb) return;
  this.settings.color = DL.rgbToHex(rgb.r, rgb.g, rgb.b);
  if (!opts || !opts.keepHsv) {
    var hsv = DL.rgbToHsv(rgb.r, rgb.g, rgb.b);
    if (hsv.s > 0.001) this.hsv.h = hsv.h;
    this.hsv.s = hsv.s; this.hsv.v = hsv.v;
  }
  if (!opts || !opts.silent) this.pushRecent(this.settings.color);
  this.ui.syncColor();
};
App.prototype.applyHsv = function () {
  var c = DL.hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
  this.settings.color = DL.rgbToHex(c.r, c.g, c.b);
  this.ui.syncColor(true);
};
App.prototype.pushRecent = function (hex) {
  var r = this.settings.recent;
  var i = r.indexOf(hex);
  if (i >= 0) r.splice(i, 1);
  r.unshift(hex);
  if (r.length > 20) r.length = 20;
  this.ui.renderRecent();
};

/* ---------- 笔刷参数 ---------- */
App.prototype.brushParams = function (pt) {
  var b = this.settings.brush, o = this.settings.opts;
  var raw = (pt && pt.pressure != null) ? pt.pressure : 1;
  var pres = DL.applyCurve(raw, o.pressureCurve, o.pressureMin);
  var size = b.pressureSize ? Math.max(1, b.size * (0.10 + 0.90 * pres)) : b.size;
  var flow = b.flow * (b.pressureFlow ? (0.12 + 0.88 * pres) : 1);
  var angle = b.type === 'marker' ? -0.62 : 0;

  /* 数位板倾斜：改变笔尖角度与宽度，模拟真实笔触 */
  if (o.tiltEnabled && pt && pt.tiltX != null && (pt.tiltX || pt.tiltY)) {
    var mag = Math.min(1, Math.sqrt(pt.tiltX * pt.tiltX + pt.tiltY * pt.tiltY) / 75);
    if (mag > 0.02) {
      angle = Math.atan2(pt.tiltY, pt.tiltX);
      size *= 1 + o.tiltAmount * mag * 0.8;
      if (b.type === 'round' || b.type === 'pencil' || b.type === 'chalk') {
        angle = 0;
        flow *= 1 - 0.25 * mag;
      }
    }
  }
  return {
    type: b.type, size: size, hardness: b.hardness, color: this.settings.color,
    flow: DL.clamp(flow, 0, 1),
    erase: this.activeToolId() === 'eraser',
    angle: angle,
    follow: b.type === 'calligraphy'
  };
};
App.prototype.activeToolId = function () { return this._forcedTool || this.settings.tool; };

/* ---------- 描边缓冲 ---------- */
App.prototype.ensureBuffers = function () {
  var d = this.doc;
  if (this.stroke.canvas.width !== d.width || this.stroke.canvas.height !== d.height) {
    this.stroke.canvas = DL.createCanvas(d.width, d.height);
    this.stroke.ctx = this.stroke.canvas.getContext('2d');
  }
  if (!this.liveCanvas || this.liveCanvas.width !== d.width || this.liveCanvas.height !== d.height) {
    this.liveCanvas = DL.createCanvas(d.width, d.height);
    this.liveCtx = this.liveCanvas.getContext('2d');
  }
};
App.prototype.beginBuffer = function (o) {
  this.ensureBuffers();
  var g = this.stroke.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, this.stroke.canvas.width, this.stroke.canvas.height);
  this.stroke.active = true;
  this.stroke.mode = 'buffer';
  this.stroke.erase = !!o.erase;
  this.stroke.opacity = o.opacity == null ? 1 : o.opacity;
  this.stroke.rect = null;
};
App.prototype.beginDirect = function () {
  this.ensureBuffers();
  var g = this.liveCtx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
  var l = this.doc.activeLayer();
  if (l) g.drawImage(l.canvas, 0, 0);
  this.stroke.active = true;
  this.stroke.mode = 'direct';
  this.stroke.opacity = 1;
  this.stroke.rect = null;
};
App.prototype.track = function (size, x, y) {
  var r = { x: x - size / 2 - 2, y: y - size / 2 - 2, w: size + 4, h: size + 4 };
  this.stroke.rect = DL.rectUnion(this.stroke.rect, r);
};
App.prototype._commit = function (label, fromLive) {
  var d = this.doc, layer = d.activeLayer();
  if (this._discard) {
    this.stroke.active = false;
    this.stroke.rect = null;
    this._clearStrokeCanvas();
    this.requestRender();
    return;
  }
  var rect = DL.rectClip(this.stroke.rect, d.width, d.height);
  this.stroke.active = false;
  if (!layer || !rect) {
    this.stroke.rect = null;
    if (this.stroke.mode === 'buffer') this._clearStrokeCanvas();
    this.requestRender();
    return;
  }
  /* 有选区时，笔迹被裁剪到选区内（与 Photoshop 一致） */
  var srcCanvas = this.stroke.canvas;
  if (!fromLive && this.selection) {
    var clip = this._clipCanvas;
    if (!clip || clip.width !== d.width || clip.height !== d.height) {
      this._clipCanvas = clip = DL.createCanvas(d.width, d.height);
    }
    var cg = clip.getContext('2d');
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.globalCompositeOperation = 'source-over';
    cg.globalAlpha = 1;
    cg.clearRect(0, 0, d.width, d.height);
    cg.drawImage(this.stroke.canvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(this.selMaskCanvas(), 0, 0);
    cg.globalCompositeOperation = 'source-over';
    srcCanvas = clip;
  }
  var before = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  var lg = layer.ctx;
  lg.save();
  lg.setTransform(1, 0, 0, 1, 0, 0);
  if (fromLive) {
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(rect.x, rect.y, rect.w, rect.h);
    lg.drawImage(this.liveCanvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  } else {
    lg.globalAlpha = this.stroke.opacity;
    lg.globalCompositeOperation = this.stroke.erase ? 'destination-out' : 'source-over';
    lg.drawImage(srcCanvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  }
  lg.restore();
  layer.touch();
  var after = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  this.history.record(DL.pixelEntry(d, layer.id, rect, before, after, label));
  this._clearStrokeCanvas();
  this.stroke.rect = null;
  this.invalidate();
  this.requestRender();
  this.ui.refreshLayers();
};
App.prototype.commitBuffer = function (label) { this._commit(label, false); };
App.prototype.commitDirect = function (label) { this._commit(label, true); };
App.prototype._clearStrokeCanvas = function () {
  var g = this.stroke.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, this.stroke.canvas.width, this.stroke.canvas.height);
};

/* ---------- 合成与缓存 ---------- */
App.prototype.merged = function () {
  var d = this.doc;
  if (!this._merged || this._merged.width !== d.width || this._merged.height !== d.height) {
    this._merged = DL.createCanvas(d.width, d.height);
    this._mergedDirty = true;
  }
  if (!this._mergedDirty) return this._merged;
  var g = this._merged.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, d.width, d.height);
  for (var i = 0; i < d.layers.length; i++) {
    var l = d.layers[i];
    if (!l.visible || l.opacity <= 0) continue;
    g.globalAlpha = l.opacity;
    g.globalCompositeOperation = l.blend;
    g.drawImage(l.canvas, 0, 0);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  this._mergedDirty = false;
  return this._merged;
};
App.prototype.invalidate = function () {
  this._mergedDirty = true;
  for (var i = 0; i < this.doc.layers.length; i++) this.doc.layers[i].touch();
};
App.prototype.requestRender = function () { this.renderer.requestRender(); };
App.prototype.setTool = function (id) { this.ui.setTool(id); return this; };
App.prototype.status = function (msg) {
  this.ui.setStatus(msg);
};

/* ---------- 取色 ---------- */
App.prototype.pickColorAt = function (pt) {
  var d = this.doc;
  var x = Math.floor(pt.x), y = Math.floor(pt.y);
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  var n = this.settings.opts.sampleSize || 1;
  var r = Math.floor(n / 2);
  var x0 = DL.clamp(x - r, 0, d.width - 1), y0 = DL.clamp(y - r, 0, d.height - 1);
  var w = Math.min(n, d.width - x0), h = Math.min(n, d.height - y0);
  var layer = d.activeLayer();
  var src = (this.settings.opts.sampleFrom === 'active' && layer) ? layer.canvas : this.merged();
  var data = src.getContext('2d').getImageData(x0, y0, w, h).data;
  var R = 0, G = 0, B = 0, A = 0;
  for (var i = 0; i < w * h; i++) {
    var a = data[i * 4 + 3];
    if (a <= 0) continue;
    var af = a / 255;
    R += data[i * 4] * af; G += data[i * 4 + 1] * af; B += data[i * 4 + 2] * af; A += af;
  }
  if (A <= 0.01) { this.status('此位置是透明的，没有颜色可吸取'); return; }
  var hex = DL.rgbToHex(R / A, G / A, B / A);
  this.setColor(hex);
  this.status('已吸取颜色 ' + hex.toUpperCase());
};

/* ---------- 裁剪 ---------- */
App.prototype.cropTo = function (rect) {
  var app = this, d = this.doc;
  var x = DL.clamp(Math.round(rect.x), 0, d.width - 1);
  var y = DL.clamp(Math.round(rect.y), 0, d.height - 1);
  var w = DL.clamp(Math.round(rect.w), 1, d.width - x);
  var h = DL.clamp(Math.round(rect.h), 1, d.height - y);
  var r = { x: x, y: y, w: w, h: h };
  if (!r || r.w < 2 || r.h < 2) { this.status('裁剪区域无效'); return; }
  this.snapshotOp('裁剪画布', function () {
    DL.cropDoc(app.doc, r.x, r.y, r.w, r.h);
  });
  this.renderer.fit();
  this.overlayState.crop = null;
  this.renderer.renderOverlay();
  this.status('已裁剪为 ' + r.w + ' × ' + r.h);
};
App.prototype.cropToSelection = function () {
  if (!this.selection) { this.status('请先创建选区'); return; }
  this.cropTo(this.selection.rect);
};

/* ---------- 选区 ---------- */
App.prototype.setSelection = function (mask, rect) {
  var d = this.doc;
  if (!mask) { this.clearSelection(false); return; }
  rect = DL.rectClip(rect, d.width, d.height);
  var segs = DL.buildOutline(mask, d.width, d.height, rect);
  this.selection = { mask: mask, rect: rect, segs: segs };
  this._selMaskCanvas = null;
  this._selMaskFor = null;
  this.renderer.startAnts();
  this.ui.updateSelectionBar();
  this.requestRender();
};
App.prototype.clearSelection = function (notify) {
  if (!this.selection) { this.ui.updateSelectionBar(); return; }
  this.selection = null;
  this._selMaskCanvas = null;
  this._selMaskFor = null;
  this.renderer.stopAnts();
  this.ui.updateSelectionBar();
  if (notify !== false) this.status('已取消选区');
};
App.prototype.selMaskCanvas = function () {
  if (this._selMaskCanvas && this._selMaskFor === this.selection) return this._selMaskCanvas;
  var d = this.doc;
  this._selMaskCanvas = DL.maskToAlphaCanvas(this.selection.mask, d.width, d.height);
  this._selMaskFor = this.selection;
  return this._selMaskCanvas;
};
App.prototype.selectionHit = function (pt) {
  var d = this.doc, s = this.selection;
  if (!s) return false;
  var x = Math.floor(pt.x), y = Math.floor(pt.y);
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return false;
  return !!s.mask[y * d.width + x];
};
App.prototype.makeColorSelection = function (pt, opt) {
  var d = this.doc;
  var o = this.settings.opts;
  var tol = opt && opt.tolerance != null ? opt.tolerance : o.selectTolerance;
  var allLayers = opt && opt.allLayers != null ? opt.allLayers : o.selectAllLayers;
  var src = allLayers ? this.merged() : d.activeLayer().canvas;
  var data = src.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  var res = (opt && opt.global)
    ? DL.globalColorPick(data, d.width, d.height, pt.x, pt.y, tol)
    : DL.floodFill(data, d.width, d.height, pt.x, pt.y, tol);
  if (!res) { this.status('未选中任何像素'); return; }
  var mask;
  if (opt && (opt.add || opt.subtract) && this.selection) {
    mask = new Uint8Array(this.selection.mask);
    var w = d.width, h = d.height;
    if (opt.subtract) {
      for (var y = res.y1; y <= res.y2; y++) {
        for (var x = res.x1; x <= res.x2; x++) {
          if (res.mask[y * w + x]) mask[y * w + x] = 0;
        }
      }
    } else {
      for (var y2 = res.y1; y2 <= res.y2; y2++) {
        for (var x2 = res.x1; x2 <= res.x2; x2++) {
          if (res.mask[y2 * w + x2]) mask[y2 * w + x2] = 1;
        }
      }
    }
    res = { mask: mask, x1: 0, y1: 0, x2: d.width - 1, y2: d.height - 1 };
  }
  mask = res.mask;
  /* 计算真实包围盒 */
  var minX = d.width, minY = d.height, maxX = 0, maxY = 0, any = false, count = 0;
  for (var yy = res.y1; yy <= res.y2; yy++) {
    for (var xx = res.x1; xx <= res.x2; xx++) {
      if (mask[yy * d.width + xx]) {
        any = true; count++;
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
      }
    }
  }
  if (!any) { this.clearSelection(false); this.status('未选中任何像素'); return; }
  this.setSelection(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  this.status('已选取 ' + count.toLocaleString() + ' 个像素（' + (maxX - minX + 1) + '×' + (maxY - minY + 1) + '）');
};
App.prototype.invertSelection = function () {
  var d = this.doc, n = d.width * d.height;
  var mask = new Uint8Array(n);
  var old = this.selection ? this.selection.mask : null;
  for (var i = 0; i < n; i++) mask[i] = (old && old[i]) ? 0 : 1;
  this.setSelection(mask, { x: 0, y: 0, w: d.width, h: d.height });
  this.status('已反选');
};
App.prototype.deleteSelection = function () {
  var app = this, d = this.doc, layer = d.activeLayer();
  if (!this.selection) return;
  if (layer.locked) { this.status('图层已锁定'); return; }
  var rect = this.selection.rect, id = layer.id, m = this.selection.mask;
  var before = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  var g = layer.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  g.drawImage(this.selMaskCanvas(), 0, 0);
  g.restore();
  layer.touch();
  var after = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  this.history.record(DL.pixelEntry(d, id, rect, before, after, '删除选区'));
  this.invalidate();
  this.requestRender();
  this.ui.refreshLayers();
  this.status('已删除选区内容');
};
App.prototype.fillSelection = function () {
  var d = this.doc, layer = d.activeLayer();
  if (!this.selection) return;
  if (layer.locked) { this.status('图层已锁定'); return; }
  var rect = this.selection.rect, id = layer.id;
  var before = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  var fill = DL.maskToAlphaCanvas(this.selection.mask, d.width, d.height, DL.hexToRgb(this.fg()));
  var g = layer.ctx;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = this.settings.brush.opacity;
  g.drawImage(fill, 0, 0);
  g.restore();
  layer.touch();
  var after = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  this.history.record(DL.pixelEntry(d, id, rect, before, after, '填充选区'));
  this.invalidate();
  this.requestRender();
  this.ui.refreshLayers();
  this.status('已用前景色填充选区');
};
App.prototype.selectionToLayer = function (cut) {
  var app = this, d = this.doc, layer = d.activeLayer();
  if (!this.selection) return;
  if (cut && layer.locked) { this.status('图层已锁定'); return; }
  var rect = this.selection.rect;
  var maskCanvas = this.selMaskCanvas();
  var srcId = layer.id;
  var before = DL.getRect(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  var beforeName = layer.name;
  this.snapshotOp(cut ? '剪切到新图层' : '选区分离到新图层', function () {
    var nl = d.addLayer(beforeName + ' 选区', d.active + 1);
    var g = nl.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    var tmp = DL.createCanvas(d.width, d.height);
    var tg = tmp.getContext('2d');
    tg.drawImage(layer.canvas, 0, 0);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(maskCanvas, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    g.drawImage(tmp, 0, 0);
    nl.touch();
    if (cut) {
      var lg = layer.ctx;
      lg.save();
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = 'destination-out';
      lg.drawImage(maskCanvas, 0, 0);
      lg.restore();
      layer.touch();
    }
  });
  this.status(cut ? '已剪切到新图层' : '已把选区分离到新图层');
};
App.prototype.shiftSelection = function (dx, dy) {
  if (!this.selection || (!dx && !dy)) return;
  var d = this.doc;
  var mask = DL.shiftMask(this.selection.mask, d.width, d.height, dx, dy);
  var rect = { x: this.selection.rect.x + dx, y: this.selection.rect.y + dy, w: this.selection.rect.w, h: this.selection.rect.h };
  this.setSelection(mask, rect);
};

/* ---------- 取消未完成的描边 ---------- */
App.prototype.cancelStroke = function () {
  if (!this.stroke.active) return;
  var tool = this.tools[this.activeToolId()];
  this._discard = true;
  if (tool && tool.onUp) { try { tool.onUp({ x: 0, y: 0, pressure: 1 }); } catch (e) { } }
  this._discard = false;
  this.stroke.active = false;
  this.stroke.rect = null;
  this._clearStrokeCanvas();
  this.requestRender();
};

/* ---------- 插入文字 ---------- */
App.prototype.buildFontString = function (t) {
  var css = 'sans-serif';
  for (var i = 0; i < this.settings.fonts.length; i++) {
    if (this.settings.fonts[i].id === t.font) css = this.settings.fonts[i].css;
  }
  return (t.italic ? 'italic ' : '') + (t.bold ? '700 ' : '') + Math.max(1, t.size) + 'px ' + css;
};
App.prototype.renderTextCanvas = function (t) {
  var lines = String(t.content == null ? '' : t.content).replace(/\r/g, '').split('\n');
  if (!lines.length) lines = [''];
  var probe = DL.createCanvas(4, 4).getContext('2d');
  var fontStr = this.buildFontString(t);
  probe.font = fontStr;
  var maxW = 0;
  for (var i = 0; i < lines.length; i++) maxW = Math.max(maxW, probe.measureText(lines[i]).width);
  var lh = Math.round(t.size * 1.28);
  var w = Math.max(2, Math.ceil(maxW) + 6);
  var h = Math.max(2, lines.length * lh + 4);
  var c = DL.createCanvas(w, h);
  var g = c.getContext('2d');
  g.font = fontStr;
  g.textBaseline = 'top';
  g.fillStyle = t.color || this.fg();
  g.textAlign = t.align;
  for (var k = 0; k < lines.length; k++) {
    var x = t.align === 'center' ? w / 2 : (t.align === 'right' ? w - 3 : 3);
    g.fillText(lines[k], x, 2 + k * lh);
  }
  return { canvas: c, w: w, h: h, lh: lh, lines: lines.length };
};
App.prototype.insertText = function (pt, t) {
  if (!String(t.content || '').trim()) { this.status('文字内容为空'); return; }
  var app = this, d = this.doc;
  var r = this.renderTextCanvas(t);
  var bx = Math.round(t.align === 'center' ? pt.x - r.w / 2 : (t.align === 'right' ? pt.x - r.w : pt.x));
  var by = Math.round(pt.y);
  this.snapshotOp('插入文字', function () {
    var target;
    if (t.newLayer) target = d.addLayer('文字 ' + String(t.content).slice(0, 8), d.active + 1);
    else target = d.activeLayer();
    var g = target.ctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(r.canvas, bx, by);
    g.restore();
    target.touch();
    d.active = d.layers.indexOf(target);
  });
  this.status('已插入文字（' + r.w + ' × ' + r.h + '）');
};

/* ---------- 按颜色分层 ---------- */
App.prototype.splitByColor = function (srcMode, colorCount, flat, keep, minPixels) {
  var app = this, d = this.doc;
  var src = srcMode === 'merged' ? this.merged() : d.activeLayer().canvas;
  var data;
  try {
    data = src.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  } catch (e) { this.status('读取像素失败'); return; }
  var q = DL.quantize(data, d.width, d.height, colorCount);
  if (!q || !q.palette.length) { this.status('没有可用于分层的颜色'); return; }

  /* 小色块并入最近的较大色块 */
  var target = [], big = [], n = q.palette.length;
  for (var i = 0; i < n; i++) if (q.counts[i] >= minPixels) big.push(i);
  if (!big.length) big = [0];
  for (var g0 = 0; g0 < n; g0++) {
    if (big.indexOf(g0) >= 0) { target[g0] = big.indexOf(g0); continue; }
    var bestI = big[0], bd = Infinity;
    for (var b1 = 0; b1 < big.length; b1++) {
      var p = q.palette[g0], pp = q.palette[big[b1]];
      var dd = Math.pow(p.r - pp.r, 2) + Math.pow(p.g - pp.g, 2) + Math.pow(p.b - pp.b, 2);
      if (dd < bd) { bd = dd; bestI = big[b1]; }
    }
    target[g0] = big.indexOf(bestI);
  }
  var groups = big.length;
  var W = d.width, H = d.height, N = W * H;

  this.snapshotOp('按颜色分层', function () {
    var datas = [];
    for (var k = 0; k < groups; k++) datas.push(new Uint8ClampedArray(N * 4));
    var assign = q.assign;
    for (var px = 0; px < N; px++) {
      var gi = assign[px];
      if (gi === 255) continue;
      var t = target[gi];
      var out = datas[t], o = px * 4;
      if (flat) {
        var pc = q.palette[big[t]];
        out[o] = pc.r; out[o + 1] = pc.g; out[o + 2] = pc.b; out[o + 3] = 255;
      } else {
        out[o] = data[o]; out[o + 1] = data[o + 1]; out[o + 2] = data[o + 2]; out[o + 3] = data[o + 3];
      }
    }
    if (!keep) { d.activeLayer().clear(); }
    var base = d.active;
    /* 大的色块先建立（层序：出现多的在下） */
    var order = [];
    for (var b2 = 0; b2 < groups; b2++) order.push(b2);
    order.sort(function (a, bb) { return q.counts[big[bb]] - q.counts[big[a]]; });
    for (var oi = 0; oi < order.length; oi++) {
      var grp = order[oi];
      var pc2 = q.palette[big[grp]];
      var name = pc2.name + ' ' + pc2.hex.toUpperCase();
      var lay = d.addLayer(name, base + 1 + oi);
      var lg = lay.ctx;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.putImageData(new ImageData(datas[grp], W, H), 0, 0);
      lay.touch();
      lay._colorHex = pc2.hex;
    }
    d.active = base + groups;
  });
  this.status('已按颜色拆分为 ' + groups + ' 个图层');
};

/* ---------- 文档操作 ---------- */
App.prototype.afterStructural = function () {
  this.invalidate();
  this.ensureBuffers();
  this.cloneOffset = null;
  if (this.selection) this.clearSelection(false);
  this.ui.refreshLayers();
  this.ui.updateUndo();
  this.ui.updateDocInfo();
  this.requestRender();
};
App.prototype.snapshotOp = function (label, fn) {
  var before = DL.snapshotDoc(this.doc);
  fn();
  var after = DL.snapshotDoc(this.doc);
  var app = this;
  this.history.record({
    label: label,
    bytes: DL.snapBytes(before) + DL.snapBytes(after),
    undo: function () { DL.restoreDoc(app.doc, before); app.afterStructural(); },
    redo: function () { DL.restoreDoc(app.doc, after); app.afterStructural(); }
  });
  this.afterStructural();
};
App.prototype.loadDocument = function (doc, noFit) {
  this.doc = doc;
  this.cloneSource = null;
  this.cloneOffset = null;
  this._merged = null;
  this._mergedDirty = true;
  this.liveCanvas = null;
  this._clipCanvas = null;
  this._gradCanvas = null;
  this._effCanvas = null;
  this.overlayState.crop = null;
  this.overlayState.grad = null;
  this.overlayState.loupe = null;
  if (this.selection) this.clearSelection(false);
  this.ensureBuffers();
  this.history.clear();
  if (!noFit) this.renderer.fit();
  this.afterStructural();
  this.ui.updateToolOptions();
};

/* ---------- 文件 ---------- */
App.prototype.savePNG = function () {
  var app = this, d = this.doc;
  DL.dialog({
    title: '导出 PNG 图片',
    html:
      '<div class="field"><label>文件名</label><input type="text" id="sv-name" value="' + esc(d.fileName || '未命名') + '"></div>' +
      '<div class="field"><label>尺寸</label><span style="color:#9fb0c9">' + d.width + ' × ' + d.height + ' px</span></div>' +
      '<div class="checks"><label><input type="checkbox" id="sv-white"> 铺设白色背景（不勾选则保留透明）</label></div>',
    actions: [{ label: '取消', value: null }, { label: '导出 PNG', value: 'ok', primary: true }]
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var name = (r.root.querySelector('#sv-name').value || '未命名').replace(/[\\/:*?"<>|]/g, '_');
    var white = r.root.querySelector('#sv-white').checked;
    var c = DL.createCanvas(d.width, d.height);
    var g = c.getContext('2d');
    if (white) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, d.width, d.height); }
    g.drawImage(app.merged(), 0, 0);
    c.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      app.status('已导出 ' + name + '.png');
    }, 'image/png');
  });
};
App.prototype.openImageFile = function (file) {
  var app = this;
  var url = URL.createObjectURL(file);
  var img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(url);
    app._loadImage(img, file.name.replace(/\.[^.]+$/, ''));
  };
  img.onerror = function () { URL.revokeObjectURL(url); app.status('图片读取失败'); };
  img.src = url;
};
App.prototype._loadImage = function (img, name) {
  var app = this, d = this.doc;
  var same = (img.width === d.width && img.height === d.height);
  DL.dialog({
    title: '打开图片',
    html:
      '<div class="opt-note">图片尺寸 <b>' + img.width + ' × ' + img.height + '</b>，当前画布 <b>' +
      d.width + ' × ' + d.height + '</b>。</div>' +
      '<div class="opt-note">选择打开方式：</div>',
    actions: [
      { label: '取消', value: null },
      { label: '作为新图层', value: 'layer' },
      { label: same ? '替换当前画布' : '新建文档', value: 'doc', primary: true }
    ]
  }).then(function (r) {
    if (!r.action) return;
    if (r.action === 'doc') {
      var nd = new DL.Doc(img.width, img.height);
      nd.fileName = name || '未命名';
      nd.layers[0].name = '背景';
      nd.layers[0].ctx.drawImage(img, 0, 0);
      nd.layers[0].touch();
      app.loadDocument(nd);
      app.status('已打开 ' + img.width + ' × ' + img.height);
    } else {
      app.snapshotOp('置入图片', function () {
        var l = app.doc.addLayer(name || '图片');
        var g = l.ctx;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(img, 0, 0);
        l.touch();
      });
      app.status('已作为新图层置入');
    }
  });
};
App.prototype.newDocument = function () {
  var app = this;
  var presets = [[1280, 800, '横版 1280×800'], [1920, 1080, '全高清 1920×1080'], [1080, 1080, '方形 1080×1080'], [800, 1280, '竖版 800×1280']];
  DL.dialog({
    title: '新建文件',
    html:
      '<div class="field"><label>宽度</label><input type="number" id="nw" min="1" max="8000" value="1280"><span class="opt-note">px</span></div>' +
      '<div class="field"><label>高度</label><input type="number" id="nh" min="1" max="8000" value="800"><span class="opt-note">px</span></div>' +
      '<div class="preset-grid" style="margin-top:6px">' + presets.map(function (p) {
        return '<button class="btn" data-w="' + p[0] + '" data-h="' + p[1] + '">' + p[2] + '</button>';
      }).join('') + '</div>' +
      '<div class="sect-title">背景</div>' +
      '<div class="seg" id="bg-seg">' +
        '<button class="btn on" data-bg="white">白色</button>' +
        '<button class="btn" data-bg="transparent">透明</button>' +
        '<button class="btn" data-bg="color">当前背景色</button>' +
      '</div>',
    actions: [{ label: '取消', value: null }, { label: '创建', value: 'ok', primary: true }],
    onMount: function (root) {
      var bg = 'white';
      root.querySelectorAll('.preset-grid .btn').forEach(function (b) {
        b.addEventListener('click', function () {
          root.querySelector('#nw').value = b.dataset.w;
          root.querySelector('#nh').value = b.dataset.h;
        });
      });
      root.querySelectorAll('#bg-seg .btn').forEach(function (b) {
        b.addEventListener('click', function () {
          bg = b.dataset.bg;
          root.querySelectorAll('#bg-seg .btn').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        });
      });
      root._getBg = function () { return bg; };
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var w = DL.clamp(parseInt(r.root.querySelector('#nw').value, 10) || 1280, 1, 8000);
    var h = DL.clamp(parseInt(r.root.querySelector('#nh').value, 10) || 800, 1, 8000);
    var bg = r.root._getBg ? r.root._getBg() : 'white';
    var nd = new DL.Doc(w, h);
    nd.layers[0].name = '背景';
    if (bg !== 'transparent') {
      var g = nd.layers[0].ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = bg === 'white' ? '#ffffff' : app.settings.bgColor;
      g.fillRect(0, 0, w, h);
    }
    nd.layers[0].touch();
    app.loadDocument(nd);
    app.status('已新建 ' + w + ' × ' + h);
  });
};

/* ============================================================
 * UI 层
 * ============================================================ */
function UI(app) {
  this.app = app;
  this.stage = $('stage');
  this.view = $('view');
  this.ring = $('cursor-ring');
  this.hint = $('stage-hint');
  this.drag = null;
  this.pan = null;
  this.spaceDown = false;
  this.buildToolbar();
  this.buildBrushTypes();
  this.buildPalette();
  this.buildBlendOptions();
  this.bindColor();
  this.bindBrush();
  this.bindLayers();
  this.bindTopBar();
  this.bindTabletPanel();
  this.bindSelectionBar();
  this.bindCropBar();
  this.bindStage();
  this.bindKeys();
  this.renderExtracted();
  this.refreshLayers();
  this.syncColor();
  this.updateBrushUI();
  this.setTool('brush');
  this.updateUndo();
  this.updateDocInfo();

  var self = this;
  var ro = new ResizeObserver(function () { self.app.renderer.resize(); });
  ro.observe(this.stage);
  window.addEventListener('resize', function () { self.app.renderer.resize(); });
  this.app.renderer.resize();
  this.app.renderer.fit();
  this.setStatus('就绪 · 选择左侧工具开始作画');
  if (DL.studio && DL.studio.install) DL.studio.install(this);
}

/* ---------- 状态栏 ---------- */
UI.prototype.setStatus = function (msg) {
  var el = $('status-message');
  el.textContent = msg;
  clearTimeout(this._stTimer);
  this._stTimer = setTimeout(function () { el.textContent = '就绪'; }, 4000);
};
UI.prototype.updateDocInfo = function () {
  var d = this.app.doc;
  $('status-doc').textContent = d.width + ' × ' + d.height;
  $('status-layers').textContent = d.layers.length + ' 图层';
  $('layer-count').textContent = d.layers.length + ' 个';
};
UI.prototype.updateZoom = function () {
  var z = Math.round(this.app.renderer.scale * 100);
  $('btn-zoom-reset').textContent = z + '%';
};
UI.prototype.updateUndo = function () {
  var h = this.app.history;
  var u = $('btn-undo'), r = $('btn-redo');
  u.disabled = !h.canUndo();
  r.disabled = !h.canRedo();
  u.title = h.canUndo() ? '上一步：' + h.label('undo') + ' (Ctrl+Z)' : '上一步 (Ctrl+Z)';
  r.title = h.canRedo() ? '下一步：' + h.label('redo') + ' (Ctrl+Shift+Z)' : '下一步 (Ctrl+Shift+Z)';
};

/* ---------- 工具栏 ---------- */
UI.prototype.makeToolBtn = function (id) {
  var self = this, t = this.app.tools;
  var tool = t[id];
  var b = document.createElement('button');
  b.className = 'tool-btn';
  b.dataset.tool = id;
  b.title = tool.name + ' (' + tool.key + ')  ' + tool.hint;
  b.innerHTML = '<svg viewBox="0 0 24 24">' + tool.icon + '</svg>';
  b.addEventListener('click', function () { self.setTool(id); });
  return b;
};

UI.prototype.buildToolbar = function () {
  var self = this, tb = $('toolbar'), t = this.app.tools;
  var frag = document.createDocumentFragment();
  var seen = {};
  var groups = (DL.toolGroups && DL.toolGroups.length) ? DL.toolGroups : null;

  function addGroup(name, ids) {
    ids = (ids || []).filter(function (id) { return t[id] && !seen[id]; });
    if (!ids.length) return;
    ids.forEach(function (id) { seen[id] = 1; });
    if (frag.childNodes.length) {
      var sep = document.createElement('div');
      sep.className = 'tb-sep';
      frag.appendChild(sep);
    }
    if (name) {
      var cap = document.createElement('div');
      cap.className = 'tb-cap';
      cap.textContent = name;
      frag.appendChild(cap);
    }
    ids.forEach(function (id) { frag.appendChild(self.makeToolBtn(id)); });
  }

  if (groups) {
    groups.forEach(function (g) { addGroup(g.name, g.tools); });
    /* 未分组（插件注册等）追加到末尾 */
    addGroup('插件', t.__order.filter(function (id) { return !seen[id]; }));
  } else {
    addGroup(null, t.__order.slice());
  }
  tb.appendChild(frag);
};
UI.prototype.setTool = function (id) {
  var app = this.app;
  if (app.settings.tool !== id && app.stroke.active) app.cancelStroke();
  app.settings.tool = id;
  var t = app.tools[id];
  Array.prototype.forEach.call(document.querySelectorAll('.tool-btn'), function (b) {
    b.classList.toggle('active', b.dataset.tool === id);
  });
  app.overlayState.grad = null;
  if (app.overlayState.crop && id !== 'crop') app.overlayState.crop = null;
  if (app.overlayState.loupe && id !== 'eyedropper') app.overlayState.loupe = null;
  this.hideCropBar();
  this.applyCursor();
  $('status-tool').textContent = t.name;
  this.updateToolOptions();
  this.ring.hidden = true;
  app.renderer.renderOverlay();
};

/* ---------- 笔刷类型 ---------- */
UI.prototype.buildBrushTypes = function () {
  var self = this, wrap = $('brush-types');
  var color = this.app.fg();
  DL.brushTypes.forEach(function (bt) {
    var b = document.createElement('button');
    b.className = 'brush-btn';
    b.dataset.type = bt.id;
    b.title = bt.name;
    var cv = document.createElement('canvas');
    cv.width = 46; cv.height = 22;
    b.appendChild(cv);
    var sp = document.createElement('span');
    sp.textContent = bt.name;
    b.appendChild(sp);
    b.addEventListener('click', function () { self.setBrushType(bt.id); });
    wrap.appendChild(b);
  });
  this.renderBrushPreviews();
};
UI.prototype.renderBrushPreviews = function () {
  var color = this.app.fg();
  Array.prototype.forEach.call($('brush-types').children, function (b) {
    DL.renderBrushPreview(b.querySelector('canvas'), b.dataset.type, '#e2e8f4');
  });
};
UI.prototype.setBrushType = function (id) {
  var b = this.app.settings.brush;
  var def = null;
  DL.brushTypes.forEach(function (t) { if (t.id === id) def = t; });
  if (!def) return;
  b.type = id;
  if (def.hardness != null) b.hardness = def.hardness;
  if (def.spacing != null) b.spacing = def.spacing;
  if (def.flow != null) b.flow = def.flow;
  this.updateBrushUI();
  var self = this;
  Array.prototype.forEach.call($('brush-types').children, function (x) {
    x.classList.toggle('active', x.dataset.type === id);
  });
};

/* ---------- 颜色面板 ---------- */
UI.prototype.buildPalette = function () {
  var self = this, wrap = $('palette');
  var colors = [
    '#000000', '#3d3d3d', '#7a7a7a', '#b5b5b5', '#ffffff',
    '#7f1010', '#e8281e', '#ff7a1a', '#ffc61a', '#fff36b',
    '#146b32', '#2fbf5b', '#00a3a3', '#1a7fd4', '#5b8cff',
    '#5a2a9c', '#b44ce0', '#ff4fa3', '#8a5a2b', '#f0c9a0'
  ];
  colors.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'sw';
    b.style.background = c;
    b.title = c.toUpperCase();
    b.addEventListener('click', function () { self.app.setColor(c); });
    wrap.appendChild(b);
  });
};
UI.prototype.renderRecent = function () {
  var self = this, wrap = $('recent');
  wrap.innerHTML = '';
  this.app.settings.recent.slice(0, 20).forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'sw';
    b.style.background = c;
    b.title = c.toUpperCase();
    b.addEventListener('click', function () { self.app.setColor(c); });
    wrap.appendChild(b);
  });
};
UI.prototype.paintSV = function () {
  var app = this.app, cv = $('sv-canvas'), g = cv.getContext('2d');
  var w = cv.width, h = cv.height;
  var base = DL.hsvToRgb(app.hsv.h, 1, 1);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = DL.rgbToHex(base.r, base.g, base.b);
  g.fillRect(0, 0, w, h);
  var gw = g.createLinearGradient(0, 0, w, 0);
  gw.addColorStop(0, 'rgba(255,255,255,1)');
  gw.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gw; g.fillRect(0, 0, w, h);
  var gh = g.createLinearGradient(0, 0, 0, h);
  gh.addColorStop(0, 'rgba(0,0,0,0)');
  gh.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gh; g.fillRect(0, 0, w, h);
  this.drawPickerMarkers();
  var hc = $('hue-canvas'), hg = hc.getContext('2d');
  var grad = hg.createLinearGradient(0, 0, hc.width, 0);
  for (var i = 0; i <= 6; i++) {
    var c = DL.hsvToRgb(i * 60, 1, 1);
    grad.addColorStop(i / 6, DL.rgbToHex(c.r, c.g, c.b));
  }
  hg.fillStyle = grad;
  hg.fillRect(0, 0, hc.width, hc.height);
  var hx = (app.hsv.h / 360) * hc.width;
  hg.fillStyle = '#fff';
  hg.strokeStyle = 'rgba(0,0,0,.7)';
  hg.lineWidth = 2;
  hg.beginPath();
  hg.rect(DL.clamp(hx - 2, 0, hc.width - 4), 0, 4, hc.height);
  hg.fill(); hg.stroke();
};
UI.prototype.drawPickerMarkers = function () {
  var app = this.app, cv = $('sv-canvas'), g = cv.getContext('2d');
  var x = app.hsv.s * cv.width, y = (1 - app.hsv.v) * cv.height;
  g.beginPath();
  g.arc(DL.clamp(x, 3, cv.width - 3), DL.clamp(y, 3, cv.height - 3), 6, 0, Math.PI * 2);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1; g.stroke();
};
UI.prototype.bindColor = function () {
  var self = this, app = this.app;
  function svFromEvent(e) {
    var cv = $('sv-canvas'), r = cv.getBoundingClientRect();
    app.hsv.s = DL.clamp((e.clientX - r.left) / r.width, 0, 1);
    app.hsv.v = DL.clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    app.applyHsv();
    self.paintSV();
  }
  $('sv-canvas').addEventListener('pointerdown', function (e) {
    e.preventDefault();
    this.setPointerCapture(e.pointerId);
    svFromEvent(e);
    this._drag = true;
  });
  $('sv-canvas').addEventListener('pointermove', function (e) { if (this._drag) svFromEvent(e); });
  $('sv-canvas').addEventListener('pointerup', function () { this._drag = false; });

  function hueFromEvent(e) {
    var cv = $('hue-canvas'), r = cv.getBoundingClientRect();
    app.hsv.h = DL.clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
    app.applyHsv();
    self.paintSV();
  }
  $('hue-canvas').addEventListener('pointerdown', function (e) {
    e.preventDefault();
    this.setPointerCapture(e.pointerId);
    hueFromEvent(e);
    this._drag = true;
  });
  $('hue-canvas').addEventListener('pointermove', function (e) { if (this._drag) hueFromEvent(e); });
  $('hue-canvas').addEventListener('pointerup', function () { this._drag = false; });

  $('hex-input').addEventListener('change', function () {
    var rgb = DL.hexToRgb(this.value);
    if (rgb) app.setColor(DL.rgbToHex(rgb.r, rgb.g, rgb.b));
    else self.syncColor();
  });
  $('native-color').addEventListener('input', function () {
    app.setColor(this.value);
  });
  $('swap-fg').addEventListener('click', function () { $('native-color').click(); });
  $('swap-bg').addEventListener('click', function () {
    var c = app.settings.bgColor;
    var inp = document.createElement('input');
    inp.type = 'color'; inp.value = c;
    inp.addEventListener('input', function () { app.settings.bgColor = inp.value; self.syncColor(); });
    inp.click();
  });
  $('btn-swap').addEventListener('click', function () {
    var tmp = app.settings.bgColor;
    app.settings.bgColor = app.settings.color;
    app.setColor(tmp, { silent: true });
    self.syncColor();
  });
  $('btn-clear-recent').addEventListener('click', function () {
    app.settings.recent.length = 0;
    self.renderRecent();
  });
  $('btn-extract').addEventListener('click', function () { self.extractPaletteFromImage(); });
};
UI.prototype.syncColor = function (hsvChanged) {
  var app = this.app;
  var fg = $('swap-fg');
  fg.style.background = app.settings.color;
  $('swap-bg').style.background = app.settings.bgColor;
  if (document.activeElement !== $('hex-input')) $('hex-input').value = app.settings.color.toUpperCase();
  $('native-color').value = app.settings.color;
  this.paintSV();
  this.renderBrushPreviews();
};

/* ---------- 笔刷面板 ---------- */
UI.prototype.bindBrush = function () {
  var self = this, app = this.app, b = app.settings.brush;
  function slider(id, get, set, fmt) {
    var el = $(id);
    el.addEventListener('input', function () {
      set(parseFloat(el.value));
      self.updateBrushUI();
      if (id === 's-opacity' || id === 's-flow') self.renderBrushPreviews();
    });
    return el;
  }
  slider('s-size', null, function (v) { b.size = v; });
  slider('s-opacity', null, function (v) { b.opacity = v / 100; });
  slider('s-flow', null, function (v) { b.flow = v / 100; });
  slider('s-hardness', null, function (v) { b.hardness = v / 100; });
  slider('s-spacing', null, function (v) { b.spacing = v / 100; });
  slider('s-smoothing', null, function (v) { b.smoothing = v / 100; });
  $('s-pressure-size').addEventListener('change', function () { b.pressureSize = this.checked; });
  $('s-pressure-flow').addEventListener('change', function () { b.pressureFlow = this.checked; });
};
UI.prototype.updateBrushUI = function () {
  var b = this.app.settings.brush;
  var set = function (id, val, txt) {
    var el = $(id);
    if (document.activeElement !== el) el.value = val;
    $(id + '-val').textContent = txt;
  };
  set('s-size', b.size, Math.round(b.size) + 'px');
  set('s-opacity', Math.round(b.opacity * 100), Math.round(b.opacity * 100) + '%');
  set('s-flow', Math.round(b.flow * 100), Math.round(b.flow * 100) + '%');
  set('s-hardness', Math.round(b.hardness * 100), Math.round(b.hardness * 100) + '%');
  set('s-spacing', Math.round(b.spacing * 100), Math.round(b.spacing * 100) + '%');
  set('s-smoothing', Math.round(b.smoothing * 100), Math.round(b.smoothing * 100) + '%');
  $('s-pressure-size').checked = b.pressureSize;
  $('s-pressure-flow').checked = b.pressureFlow;
  var wrap = $('brush-types');
  if (wrap) Array.prototype.forEach.call(wrap.children, function (x) {
    x.classList.toggle('active', x.dataset.type === b.type);
  });
  var hd = $('s-hardness');
  var disable = (b.type === 'marker' || b.type === 'calligraphy' || b.type === 'pencil' || b.type === 'spray');
  hd.disabled = disable;
  hd.parentElement.style.opacity = disable ? .45 : 1;
};

/* ---------- 工具专属选项 ---------- */
UI.prototype.updateToolOptions = function () {
  var app = this.app, wrap = $('tool-options');
  var tool = app.settings.tool, o = app.settings.opts;
  var html = '';
  if (tool === 'clone') {
    var src = app.cloneSource;
    html =
      '<div class="opt-note">按住 <b>Alt</b> 单击画面设置取样源。<br>当前源点：<b>' +
      (src ? (Math.round(src.x) + ' , ' + Math.round(src.y)) : '未设置') + '</b></div>' +
      '<div class="checks" style="margin-top:7px">' +
      '<label><input type="checkbox" id="o-align"' + (o.cloneAligned ? ' checked' : '') + '> 对齐（保持取样偏移）</label>' +
      '<label><input type="checkbox" id="o-all"' + (o.cloneAllLayers ? ' checked' : '') + '> 从所有图层取样</label>' +
      '</div>' +
      '<button class="btn" id="o-clone-clear" style="width:100%;justify-content:center;margin-top:9px">清除取样源</button>';
  } else if (tool === 'smudge') {
    html = '<div class="opt-row"><label>强度</label><input type="range" id="o-smudge" min="5" max="100" value="' +
      Math.round(o.smudgeStrength * 100) + '"><span class="val" id="o-smudge-val">' + Math.round(o.smudgeStrength * 100) + '%</span></div>' +
      '<div class="opt-note" style="margin-top:6px">拖动时把上一位置的颜色带向当前位置，用于柔和过渡与混合。</div>';
  } else if (tool === 'bucket') {
    html =
      '<div class="opt-row"><label>容差</label><input type="range" id="o-tol" min="0" max="100" value="' +
      o.bucketTolerance + '"><span class="val" id="o-tol-val">' + o.bucketTolerance + '</span></div>' +
      '<div class="checks" style="margin-top:7px">' +
      '<label><input type="checkbox" id="o-contig"' + (o.bucketContiguous ? ' checked' : '') + '> 仅填充相连区域</label>' +
      '<label><input type="checkbox" id="o-ball"' + (o.bucketAllLayers ? ' checked' : '') + '> 从所有图层取样</label>' +
      '</div>' +
      '<div class="opt-note" style="margin-top:6px">填充使用前景色，受“不透明度”影响。</div>';
  } else if (tool === 'eyedropper') {
    html = '<div class="opt-row"><label>取样范围</label><select id="o-sample">' +
      [[1, '单像素'], [3, '3 × 3 平均'], [5, '5 × 5 平均']].map(function (p) {
        return '<option value="' + p[0] + '"' + (o.sampleSize === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="opt-row"><label>取样来源</label><select id="o-sfrom">' +
        '<option value="merged"' + (o.sampleFrom === 'merged' ? ' selected' : '') + '>所有可见图层</option>' +
        '<option value="active"' + (o.sampleFrom === 'active' ? ' selected' : '') + '>当前图层</option>' +
      '</select></div>' +
      '<div class="checks"><label><input type="checkbox" id="o-loupe"' + (o.loupe ? ' checked' : '') + '> 显示放大镜预览</label></div>' +
      '<div class="opt-note" style="margin-top:6px">拖动可连续取色；在任意工具下按住 <b>Alt</b> 单击也可临时取色。</div>';
  } else if (tool === 'objectSelect') {
    html =
      '<div class="opt-row"><label>容差</label><input type="range" id="o-otol" min="2" max="80" value="' +
      o.objectTolerance + '"><span class="val" id="o-otol-val">' + o.objectTolerance + '</span></div>' +
      '<div class="checks" style="margin-top:7px">' +
      '<label><input type="checkbox" id="o-oall"' + (o.selectAllLayers ? ' checked' : '') + '> 从所有图层取样</label>' +
      '</div>' +
      '<div class="opt-note" style="margin-top:6px">在要选中的对象上<b>涂抹</b>，自动按颜色与连通性扩展选区；<b>Shift</b> 加选、<b>Alt</b> 减选。笔刷越大地域越宽。</div>';
  } else if (tool === 'liquify') {
    html =
      '<div class="opt-row"><label>模式</label><select id="o-lmode">' +
        [['push', '推挤'], ['bloat', '膨胀'], ['pinch', '收缩'], ['twirl', '旋转']].map(function (m) {
          return '<option value="' + m[0] + '"' + (o.liquifyMode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="opt-row"><label>力度</label><input type="range" id="o-lpower" min="5" max="200" value="' +
      Math.round(o.liquifyPower * 100) + '"><span class="val" id="o-lpower-val">' + Math.round(o.liquifyPower * 100) + '%</span></div>' +
      '<div class="btn-row"><button class="btn wide" id="o-lreset">重置形变</button></div>' +
      '<div class="opt-note" style="margin-top:7px">拖动推挤像素；<b>Shift</b> 或 <b>Alt</b> 拖动 = 把该处恢复原样。笔刷大小决定影响范围。</div>';
  } else if (tool === 'gradient') {
    html =
      '<div class="opt-row"><label>类型</label><select id="o-gtype">' +
        [['linear', '线性'], ['radial', '径向'], ['angle', '角度 / 锥形']].map(function (m) {
          return '<option value="' + m[0] + '"' + (o.gradType === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="opt-row"><label>配色</label><select id="o-gcolor">' +
        [['fg-bg', '前景色 → 背景色'], ['fg-trans', '前景色 → 透明'], ['bw', '黑 → 白'], ['fg-bg-rev', '背景色 → 前景色']].map(function (m) {
          return '<option value="' + m[0] + '"' + (o.gradColor === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="opt-row"><label>不透明度</label><input type="range" id="o-gop" min="5" max="100" value="' +
      Math.round(o.gradOpacity * 100) + '"><span class="val" id="o-gop-val">' + Math.round(o.gradOpacity * 100) + '%</span></div>' +
      '<div class="checks"><label><input type="checkbox" id="o-grev"' + (o.gradReverse ? ' checked' : '') + '> 反向渐变</label></div>' +
      '<div class="opt-note" style="margin-top:6px">拖出方向与长度，<b>Shift</b> 约束为 45° 倍数；有选区时只填充选区内。</div>';
  } else if (tool === 'blur') {
    html =
      '<div class="opt-row"><label>模糊半径</label><input type="range" id="o-bsize" min="2" max="100" value="' +
      o.blurSize + '"><span class="val" id="o-bsize-val">' + o.blurSize + '</span></div>' +
      '<div class="opt-row"><label>强度</label><input type="range" id="o-bstr" min="5" max="100" value="' +
      Math.round(o.blurStrength * 100) + '"><span class="val" id="o-bstr-val">' + Math.round(o.blurStrength * 100) + '%</span></div>' +
      '<div class="opt-note" style="margin-top:6px">在画面上涂抹即可柔化；按住 <b>Alt</b> 涂抹则变为<b>锐化</b>（USM）。</div>';
  } else if (tool === 'heal') {
    html =
      '<div class="opt-row"><label>强度</label><input type="range" id="o-hstr" min="20" max="100" value="' +
      Math.round(o.healStrength * 100) + '"><span class="val" id="o-hstr-val">' + Math.round(o.healStrength * 100) + '%</span></div>' +
      '<div class="opt-row"><label>取样数</label><input type="range" id="o-hn" min="8" max="48" value="' +
      o.healSamples + '"><span class="val" id="o-hn-val">' + o.healSamples + '</span></div>' +
      '<div class="opt-row"><label>边缘融合</label><input type="range" id="o-hcore" min="10" max="90" value="' +
      Math.round(o.healCore * 100) + '"><span class="val" id="o-hcore-val">' + Math.round(o.healCore * 100) + '%</span></div>' +
      '<div class="opt-note" style="margin-top:6px">在污点 / 瑕疵上涂抹，程序会在周围环带寻找最接近的纹理补进来，边缘自动融合。用短笔点按效果最好。</div>';
  } else if (tool === 'crop') {
    html =
      '<div class="opt-note">在画面上拖出裁剪框，然后点击上方操作条或按 <b>Enter</b> 确认，<b>Esc</b> 取消。也可用「裁剪到选区」按选区外框裁剪。</div>' +
      '<div class="btn-row"><button class="btn wide" id="o-cropsel">裁剪到选区</button></div>';
  } else if (tool === 'line') {
    html = '<div class="opt-note">拖动预览直线，按住 <b>Shift</b> 约束为 45° 倍数。使用当前笔刷与颜色。</div>';
  } else if (tool === 'eraser') {
    html = '<div class="opt-note">橡皮擦沿用当前笔刷的<b>形状 / 大小 / 硬度 / 流量</b>，擦除的是当前图层像素，<b>不透明度</b>决定擦除强度。</div>';
  } else if (tool === 'select') {
    html =
      '<div class="opt-row"><label>容差</label><input type="range" id="o-stol" min="0" max="100" value="' +
      o.selectTolerance + '"><span class="val" id="o-stol-val">' + o.selectTolerance + '</span></div>' +
      '<div class="checks" style="margin-top:7px">' +
      '<label><input type="checkbox" id="o-sglobal"' + (o.selectGlobal ? ' checked' : '') + '> 全图同色（不限相连）</label>' +
      '<label><input type="checkbox" id="o-sall"' + (o.selectAllLayers ? ' checked' : '') + '> 从所有图层取样</label>' +
      '</div>' +
      '<div class="opt-note" style="margin-top:6px">单击色块即选中该区域；<b>Shift</b> 加选、<b>Alt</b> 减选；在选区内<b>拖动可移动色块</b>。绘制会被限制在选区内。</div>';
  } else if (tool === 'text') {
    html = '<div class="opt-note">单击画面弹出文字编辑框，可设置字体、字号、粗体/斜体与对齐方式，并选择是否放在新图层。</div>';
  } else if (tool === 'move') {
    html = '<div class="opt-note">拖动可整体移动当前图层内容，松开后写入历史。</div>';
  } else if (tool === 'pan') {
    html = '<div class="opt-note">按住 <b>空格</b> 或鼠标中键可在任意工具下临时平移视图。</div>';
  }
  wrap.innerHTML = html;
  this.bindToolOptions();
};
UI.prototype.bindToolOptions = function () {
  var self = this, app = this.app, o = app.settings.opts;
  var el;
  if ((el = $('o-align'))) el.addEventListener('change', function () { o.cloneAligned = this.checked; });
  if ((el = $('o-all'))) el.addEventListener('change', function () { o.cloneAllLayers = this.checked; });
  if ((el = $('o-clone-clear'))) el.addEventListener('click', function () {
    app.cloneSource = null; app.cloneOffset = null;
    self.updateToolOptions(); app.requestRender();
    self.setStatus('已清除仿制取样源');
  });
  if ((el = $('o-smudge'))) el.addEventListener('input', function () {
    o.smudgeStrength = this.value / 100;
    $('o-smudge-val').textContent = this.value + '%';
  });
  if ((el = $('o-tol'))) el.addEventListener('input', function () {
    o.bucketTolerance = parseInt(this.value, 10);
    $('o-tol-val').textContent = this.value;
  });
  if ((el = $('o-contig'))) el.addEventListener('change', function () { o.bucketContiguous = this.checked; });
  if ((el = $('o-ball'))) el.addEventListener('change', function () { o.bucketAllLayers = this.checked; });
  if ((el = $('o-sample'))) el.addEventListener('change', function () { o.sampleSize = parseInt(this.value, 10); });
  if ((el = $('o-sfrom'))) el.addEventListener('change', function () {
    o.sampleFrom = this.value;
    if (app.overlayState.loupe) app.renderer.renderOverlay();
  });
  if ((el = $('o-loupe'))) el.addEventListener('change', function () {
    o.loupe = this.checked;
    if (!o.loupe) { app.overlayState.loupe = null; app.renderer.renderOverlay(); }
  });
  if ((el = $('o-otol'))) el.addEventListener('input', function () {
    o.objectTolerance = parseInt(this.value, 10);
    $('o-otol-val').textContent = this.value;
  });
  if ((el = $('o-oall'))) el.addEventListener('change', function () { o.selectAllLayers = this.checked; });
  if ((el = $('o-lmode'))) el.addEventListener('change', function () { o.liquifyMode = this.value; });
  if ((el = $('o-lpower'))) el.addEventListener('input', function () {
    o.liquifyPower = this.value / 100;
    $('o-lpower-val').textContent = this.value + '%';
  });
  if ((el = $('o-lreset'))) el.addEventListener('click', function () {
    var t = app.tools.liquify;
    if (t.lq) {
      var d = app.doc;
      t.lq.reset(DL.copyCanvas(d.activeLayer().canvas));
      app.beginDirect();
      app.commitDirect('取消液化');
      self.setStatus('已重置本次液化形变');
    } else self.setStatus('液化工具未在使用中');
  });
  if ((el = $('o-gtype'))) el.addEventListener('change', function () { o.gradType = this.value; });
  if ((el = $('o-gcolor'))) el.addEventListener('change', function () { o.gradColor = this.value; });
  if ((el = $('o-gop'))) el.addEventListener('input', function () {
    o.gradOpacity = this.value / 100;
    $('o-gop-val').textContent = this.value + '%';
  });
  if ((el = $('o-grev'))) el.addEventListener('change', function () { o.gradReverse = this.checked; });
  if ((el = $('o-bsize'))) el.addEventListener('input', function () {
    o.blurSize = parseInt(this.value, 10);
    $('o-bsize-val').textContent = this.value;
  });
  if ((el = $('o-bstr'))) el.addEventListener('input', function () {
    o.blurStrength = this.value / 100;
    $('o-bstr-val').textContent = this.value + '%';
  });
  if ((el = $('o-hstr'))) el.addEventListener('input', function () {
    o.healStrength = this.value / 100;
    $('o-hstr-val').textContent = this.value + '%';
  });
  if ((el = $('o-hn'))) el.addEventListener('input', function () {
    o.healSamples = parseInt(this.value, 10);
    $('o-hn-val').textContent = this.value;
  });
  if ((el = $('o-hcore'))) el.addEventListener('input', function () {
    o.healCore = this.value / 100;
    $('o-hcore-val').textContent = this.value + '%';
  });
  if ((el = $('o-cropsel'))) el.addEventListener('click', function () {
    if (!app.selection) { self.setStatus('请先创建选区（对象选择 / 色块选取）'); return; }
    app.overlayState.crop = { x: app.selection.rect.x, y: app.selection.rect.y, w: app.selection.rect.w, h: app.selection.rect.h };
    app.renderer.renderOverlay();
    self.showCropBar(app.overlayState.crop);
  });
  if ((el = $('o-stol'))) el.addEventListener('input', function () {
    o.selectTolerance = parseInt(this.value, 10);
    $('o-stol-val').textContent = this.value;
  });
  if ((el = $('o-sglobal'))) el.addEventListener('change', function () { o.selectGlobal = this.checked; });
  if ((el = $('o-sall'))) el.addEventListener('change', function () { o.selectAllLayers = this.checked; });
};

/* ---------- 图层面板 ---------- */
UI.prototype.buildBlendOptions = function () {
  var modes = [
    ['source-over', '正常'], ['multiply', '正片叠底'], ['screen', '滤色'], ['overlay', '叠加'],
    ['darken', '变暗'], ['lighten', '变亮'], ['color-dodge', '颜色减淡'], ['color-burn', '颜色加深'],
    ['hard-light', '强光'], ['soft-light', '柔光'], ['difference', '差值'], ['exclusion', '排除'],
    ['hue', '色相'], ['saturation', '饱和度'], ['color', '颜色'], ['luminosity', '明度']
  ];
  var sel = $('l-blend');
  modes.forEach(function (m) {
    var o = document.createElement('option');
    o.value = m[0]; o.textContent = m[1];
    sel.appendChild(o);
  });
};
UI.prototype.refreshLayers = function () {
  var self = this, app = this.app, d = app.doc, list = $('layer-list');
  list.innerHTML = '';
  for (var i = d.layers.length - 1; i >= 0; i--) {
    (function (idx) {
      var l = d.layers[idx];
      var item = document.createElement('div');
      item.className = 'layer-item' + (idx === d.active ? ' active' : '');
      item.dataset.idx = idx;

      var eye = document.createElement('button');
      eye.className = 'eye' + (l.visible ? '' : ' off');
      eye.title = l.visible ? '隐藏图层' : '显示图层';
      eye.innerHTML = '<svg viewBox="0 0 24 24">' + (l.visible
        ? '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'
        : '<path d="M4 4l16 16"/><path d="M9.9 5.3A10.6 10.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.4 3.9M6.2 7.5A17 17 0 0 0 2 12s3.6 6 10 6c1.4 0 2.7-.3 3.8-.8"/>') + '</svg>';
      eye.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = l.id;
        app.snapshotOp('图层可见性', function () {
          var t = DL.findLayer(app.doc, id);
          t.visible = !l.visible;
        });
      });

      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      var tc = l.thumb(84, 60);
      tc.style.width = '100%'; tc.style.height = '100%';
      thumb.appendChild(tc);

      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = l.name;
      name.title = '双击重命名';
      name.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        var inp = document.createElement('input');
        inp.className = 'rename-input';
        inp.value = l.name;
        name.replaceWith(inp);
        inp.focus(); inp.select();
        function done(ok) {
          var v = inp.value.trim();
          if (ok && v && v !== l.name) {
            var id = l.id;
            app.snapshotOp('重命名图层', function () { DL.findLayer(app.doc, id).name = v; });
          } else { self.refreshLayers(); }
        }
        inp.addEventListener('blur', function () { done(true); });
        inp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
          ev.stopPropagation();
        });
      });

      item.appendChild(eye);
      item.appendChild(thumb);
      item.appendChild(name);
      if (l.opacity < 1) {
        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = Math.round(l.opacity * 100) + '%';
        item.appendChild(meta);
      }
      item.addEventListener('click', function () {
        app.doc.active = idx;
        self.refreshLayers();
        self.syncLayerControls();
      });
      list.appendChild(item);
      self.bindLayerDrag(item, d.layers.length - 1 - idx);
    })(i);
  }
  this.updateDocInfo();
  this.syncLayerControls();
};
UI.prototype.syncLayerControls = function () {
  var l = this.app.doc.activeLayer();
  if (!l) return;
  $('l-opacity').value = Math.round(l.opacity * 100);
  $('l-opacity-val').textContent = Math.round(l.opacity * 100) + '%';
  $('l-blend').value = l.blend;
};
UI.prototype.bindLayers = function () {
  var self = this, app = this.app;
  $('layer-add').addEventListener('click', function () {
    app.snapshotOp('新建图层', function () { app.doc.addLayer(); });
  });
  $('layer-dup').addEventListener('click', function () {
    app.snapshotOp('复制图层', function () {
      var d = app.doc, src = d.activeLayer();
      var l = d.addLayer(src.name + ' 副本', d.active + 1);
      l.ctx.drawImage(src.canvas, 0, 0);
      l.opacity = src.opacity; l.blend = src.blend;
      l.touch();
    });
  });
  $('layer-up').addEventListener('click', function () {
    if (app.doc.active >= app.doc.layers.length - 1) return;
    app.snapshotOp('上移图层', function () { app.doc.moveLayer(app.doc.active, 1); });
  });
  $('layer-down').addEventListener('click', function () {
    if (app.doc.active <= 0) return;
    app.snapshotOp('下移图层', function () { app.doc.moveLayer(app.doc.active, -1); });
  });
  $('layer-del').addEventListener('click', function () {
    if (app.doc.layers.length <= 1) { self.setStatus('至少保留一个图层'); return; }
    app.snapshotOp('删除图层', function () { app.doc.removeLayer(app.doc.active); });
  });
  $('layer-merge').addEventListener('click', function () {
    if (app.doc.active <= 0) { self.setStatus('最底层无法向下合并'); return; }
    app.snapshotOp('向下合并', function () { app.doc.mergeDown(app.doc.active); });
  });
  var op = $('l-opacity');
  var opStart = 1;
  op.addEventListener('pointerdown', function () { opStart = app.doc.activeLayer().opacity; });
  op.addEventListener('input', function () {
    var l = app.doc.activeLayer();
    l.opacity = this.value / 100;
    $('l-opacity-val').textContent = this.value + '%';
    app.invalidate(); app.requestRender();
  });
  op.addEventListener('change', function () {
    var l = app.doc.activeLayer(), v = this.value / 100;
    if (Math.abs(v - opStart) < 0.001) return;
    var id = l.id;
    app.snapshotOp('图层不透明度', function () { DL.findLayer(app.doc, id).opacity = v; });
  });
  $('l-blend').addEventListener('change', function () {
    var id = app.doc.activeLayer().id, v = this.value;
    app.snapshotOp('混合模式', function () { DL.findLayer(app.doc, id).blend = v; });
  });
  $('btn-split-color').addEventListener('click', function () { self.splitColorDialog(); });
  $('btn-merge-visible').addEventListener('click', function () {
    var vis = app.doc.layers.filter(function (l) { return l.visible; }).length;
    if (vis < 2) { self.setStatus('可见图层不足两个，无需合并'); return; }
    app.snapshotOp('合并可见图层', function () { app.doc.mergeVisible(); });
    self.setStatus('已合并 ' + vis + ' 个可见图层');
  });
};

/* ---------- 顶栏 ---------- */
UI.prototype.bindTopBar = function () {
  var self = this, app = this.app;
  $('btn-new').addEventListener('click', function () { app.newDocument(); });
  $('btn-open').addEventListener('click', function () { $('file-input').click(); });
  $('file-input').addEventListener('change', function () {
    if (this.files && this.files[0]) app.openImageFile(this.files[0]);
    this.value = '';
  });
  $('btn-save').addEventListener('click', function () { app.savePNG(); });
  $('btn-undo').addEventListener('click', function () { self.undo(); });
  $('btn-redo').addEventListener('click', function () { self.redo(); });
  $('btn-zoom-in').addEventListener('click', function () {
    app.renderer.zoomAt(1.25, app.renderer.vw / 2, app.renderer.vh / 2);
  });
  $('btn-zoom-out').addEventListener('click', function () {
    app.renderer.zoomAt(1 / 1.25, app.renderer.vw / 2, app.renderer.vh / 2);
  });
  $('btn-zoom-reset').addEventListener('click', function () { app.renderer.setZoom(1); });
  $('btn-fit').addEventListener('click', function () { app.renderer.fit(); });
  $('chk-grid').addEventListener('change', function () {
    self.gridOn = this.checked;
    app.requestRender();
  });
};
UI.prototype.undo = function () {
  if (this.app.stroke.active) return;
  var e = this.app.history.undo();
  if (!e) { this.setStatus('没有可撤销的操作'); return; }
  this.app.invalidate();
  this.refreshLayers();
  this.app.requestRender();
  this.setStatus('已撤销：' + (e.label || '操作'));
};
UI.prototype.redo = function () {
  if (this.app.stroke.active) return;
  var e = this.app.history.redo();
  if (!e) { this.setStatus('没有可重做的操作'); return; }
  this.app.invalidate();
  this.refreshLayers();
  this.app.requestRender();
  this.setStatus('已重做：' + (e.label || '操作'));
};

/* ---------- 选区操作条 ---------- */
UI.prototype.updateSelectionBar = function () {
  var bar = $('sel-bar');
  if (!bar) return;
  bar.hidden = !this.app.selection;
};
UI.prototype.bindSelectionBar = function () {
  var self = this, app = this.app;
  $('sel-bar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'move': self.setTool('move'); self.setStatus('用「移动」工具在选区内拖动即可移动选区内容'); break;
      case 'fill': app.fillSelection(); break;
      case 'copy': app.selectionToLayer(false); break;
      case 'cut': app.selectionToLayer(true); break;
      case 'crop': app.cropToSelection(); break;
      case 'invert': app.invertSelection(); break;
      case 'delete': app.deleteSelection(); break;
      case 'clear': app.clearSelection(); break;
    }
  });
};

/* ---------- 裁剪确认条 ---------- */
UI.prototype.bindCropBar = function () {
  var self = this, app = this.app;
  var bar = $('crop-bar');
  if (!bar) return;
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var c = app.overlayState.crop;
    if (b.dataset.act === 'cancel') { self.hideCropBar(); return; }
    if (b.dataset.act === 'apply') {
      if (!c || c.w < 2 || c.h < 2) { self.hideCropBar(); return; }
      var rect = { x: c.x, y: c.y, w: c.w, h: c.h };
      self.hideCropBar();
      app.cropTo(rect);
      return;
    }
    if (b.dataset.act === 'sel') {
      self.hideCropBar();
      app.cropToSelection();
      return;
    }
  });
};
UI.prototype.showCropBar = function (c) {
  var bar = $('crop-bar');
  if (!bar || !c) return;
  var n = $('crop-size');
  if (n) n.textContent = Math.round(c.w) + ' × ' + Math.round(c.h);
  bar.hidden = false;
};
UI.prototype.hideCropBar = function () {
  var bar = $('crop-bar');
  if (bar) bar.hidden = true;
};

/* ---------- 文字工具对话框 ---------- */
UI.prototype.openTextDialog = function (pt) {
  var self = this, app = this.app, t = app.settings.text;
  var fontOpts = app.settings.fonts.map(function (f) {
    return '<option value="' + f.id + '"' + (t.font === f.id ? ' selected' : '') + '>' + f.label + '</option>';
  }).join('');
  var r = DL.dialog({
    title: '插入文字',
    html:
      '<div class="field"><label>内容</label></div>' +
      '<textarea id="tx-content" spellcheck="false" placeholder="在此输入文字，可换行…">' + esc(t.content) + '</textarea>' +
      '<div class="field"><label>字体</label><select id="tx-font">' + fontOpts + '</select></div>' +
      '<div class="field"><label>字号</label><input type="number" id="tx-size" min="6" max="800" value="' + t.size + '"><span class="opt-note">px</span></div>' +
      '<div class="seg icons" id="tx-style">' +
        '<button class="btn' + (t.bold ? ' on' : '') + '" data-b="1" title="粗体">B</button>' +
        '<button class="btn' + (t.italic ? ' on' : '') + '" data-i="1" title="斜体">I</button>' +
        '<span class="divider"></span>' +
        '<button class="btn' + (t.align === 'left' ? ' on' : '') + '" data-a="left" title="左对齐">左</button>' +
        '<button class="btn' + (t.align === 'center' ? ' on' : '') + '" data-a="center" title="居中">中</button>' +
        '<button class="btn' + (t.align === 'right' ? ' on' : '') + '" data-a="right" title="右对齐">右</button>' +
      '</div>' +
      '<canvas class="txt-preview" id="tx-preview" width="380" height="104"></canvas>' +
      '<div class="checks"><label><input type="checkbox" id="tx-layer"' + (t.newLayer ? ' checked' : '') + '> 放在新图层（便于二次调整）</label></div>' +
      '<div class="opt-note">文字将插入到点击位置，颜色使用当前前景色。</div>',
    actions: [{ label: '取消', value: null }, { label: '插入', value: 'ok', primary: true }],
    onMount: function (root) { bindTextDialog(root, app, self); }
  });
  r.then(function (res) {
    if (res.action !== 'ok') return;
    var root = res.root;
    t.content = root.querySelector('#tx-content').value;
    t.font = root.querySelector('#tx-font').value;
    t.size = DL.clamp(parseFloat(root.querySelector('#tx-size').value) || 64, 6, 800);
    t.newLayer = root.querySelector('#tx-layer').checked;
    app.insertText(pt, {
      content: t.content, font: t.font, size: t.size, bold: t.bold,
      italic: t.italic, align: t.align, newLayer: t.newLayer, color: app.fg()
    });
  });
};
function bindTextDialog(root, app, self) {
  var t = app.settings.text;
  var ta = root.querySelector('#tx-content');
  var sizeEl = root.querySelector('#tx-size');
  var fontEl = root.querySelector('#tx-font');
  var prev = root.querySelector('#tx-preview');

  function update() {
    t.content = ta.value;
    t.font = fontEl.value;
    t.size = DL.clamp(parseFloat(sizeEl.value) || 64, 6, 800);
    var r = app.renderTextCanvas({ content: t.content, font: t.font, size: t.size, bold: t.bold, italic: t.italic, align: t.align, color: app.fg() });
    var g = prev.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, prev.width, prev.height);
    var s = Math.min(1, prev.width / Math.max(r.w, 1), prev.height / Math.max(r.h, 1));
    var dw = r.w * s, dh = r.h * s;
    g.drawImage(r.canvas, (prev.width - dw) / 2, (prev.height - dh) / 2, dw, dh);
    self._txPreview = r;
  }
  ta.addEventListener('input', update);
  sizeEl.addEventListener('input', update);
  fontEl.addEventListener('change', update);
  root.querySelectorAll('#tx-style .btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.b) t.bold = !t.bold;
      else if (b.dataset.i) t.italic = !t.italic;
      else if (b.dataset.a) t.align = b.dataset.a;
      root.querySelectorAll('#tx-style .btn').forEach(function (x) {
        if (x.dataset.b) x.classList.toggle('on', t.bold);
        else if (x.dataset.i) x.classList.toggle('on', t.italic);
        else if (x.dataset.a) x.classList.toggle('on', t.align === x.dataset.a);
      });
      update();
    });
  });
  update();
  setTimeout(function () { ta.focus(); }, 30);
}

/* ---------- 按颜色分层对话框 ---------- */
UI.prototype.splitColorDialog = function () {
  var self = this, app = this.app;
  DL.dialog({
    title: '按颜色分层',
    html:
      '<div class="opt-note">把画面按颜色自动拆分到多个图层，分别命名（如「深蓝 #1A3C6E」），方便单独调整背景、线稿、上色。原图外观保持不变。</div>' +
      '<div class="field" style="margin-top:8px"><label>颜色数</label><input type="range" id="sp-n" min="2" max="16" value="6"><span class="val" id="sp-n-val">6</span></div>' +
      '<div class="field"><label>取样来源</label><select id="sp-src"><option value="active">当前图层</option><option value="merged">所有可见图层</option></select></div>' +
      '<div class="checks">' +
        '<label><input type="checkbox" id="sp-flat"> 用纯色填充（海报化 / 矢量感）</label>' +
        '<label><input type="checkbox" id="sp-keep" checked> 保留原图层内容</label>' +
        '<label><input type="checkbox" id="sp-tiny" checked> 忽略过小的色块（< 0.15%）</label>' +
      '</div>',
    actions: [{ label: '取消', value: null }, { label: '开始分层', value: 'ok', primary: true }],
    onMount: function (root) {
      var n = root.querySelector('#sp-n');
      n.addEventListener('input', function () { root.querySelector('#sp-n-val').textContent = n.value; });
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var root = r.root;
    var count = parseInt(root.querySelector('#sp-n').value, 10);
    var src = root.querySelector('#sp-src').value;
    var flat = root.querySelector('#sp-flat').checked;
    var keep = root.querySelector('#sp-keep').checked;
    var tiny = root.querySelector('#sp-tiny').checked;
    var d = app.doc;
    var minPixels = tiny ? Math.max(24, Math.round(d.width * d.height * 0.0015)) : 1;
    self.setStatus('正在分析颜色…');
    setTimeout(function () {
      app.splitByColor(src, count, flat, keep, minPixels);
    }, 30);
  });
};

/* ---------- 画面色板提取 ---------- */
UI.prototype.extractPaletteFromImage = function () {
  var app = this.app;
  var pal = DL.extractPalette(app.merged(), 24);
  if (!pal || !pal.length) { this.setStatus('画面中没有可提取的颜色'); return; }
  this.extracted = pal.map(function (p) { return p.hex; });
  this.renderExtracted();
  this.setStatus('已从画面提取 ' + this.extracted.length + ' 种颜色');
};
UI.prototype.renderExtracted = function () {
  var self = this, wrap = $('extracted');
  wrap.innerHTML = '';
  (this.extracted || []).forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'sw';
    b.style.background = c;
    b.title = c.toUpperCase() + '（点击取色，右键移除）';
    b.addEventListener('click', function () { self.app.setColor(c); });
    b.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      self.extracted = self.extracted.filter(function (x) { return x !== c; });
      self.renderExtracted();
    });
    wrap.appendChild(b);
  });
};

/* ---------- 数位板 / 触摸设置 ---------- */
UI.prototype.bindTabletPanel = function () {
  var self = this, app = this.app, o = app.settings.opts;
  function rg(id, get, set, fmt) {
    var el = $(id);
    el.addEventListener('input', function () {
      set(parseFloat(el.value));
      $(id + '-val').textContent = fmt(parseFloat(el.value));
    });
  }
  rg('t-curve', null, function (v) { o.pressureCurve = v / 100; }, function (v) { return (v / 100).toFixed(2); });
  rg('t-min', null, function (v) { o.pressureMin = v / 100; }, function (v) { return v + '%'; });
  rg('t-tilt', null, function (v) { o.tiltAmount = v / 100; }, function (v) { return v + '%'; });
  $('t-tilt-on').addEventListener('change', function () { o.tiltEnabled = this.checked; });
  $('t-pinch').addEventListener('change', function () { o.pinchZoom = this.checked; });
  $('t-three').addEventListener('change', function () { o.threeFingerErase = this.checked; });
};

/* ---------- 图层面板拖拽排序 ---------- */
UI.prototype.bindLayerDrag = function (item, visualIndex) {
  var self = this, app = this.app, list = $('layer-list');
  item.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.eye') || e.target.closest('.rename-input')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    var startY = e.clientY;
    var dragging = false;
    var items = Array.prototype.slice.call(list.children);
    var visualTo = visualIndex;
    item.setPointerCapture(e.pointerId);

    function onMove(ev) {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        item.classList.add('dragging');
        list.classList.add('drop-target');
      }
      var r = list.getBoundingClientRect();
      for (var i = 0; i < items.length; i++) {
        var ir = items[i].getBoundingClientRect();
        if (ev.clientY < ir.top + ir.height / 2) { visualTo = i; break; }
        visualTo = i;
      }
      items.forEach(function (el, i) {
        el.classList.toggle('drop-before', i === visualTo && dragging);
        el.classList.toggle('drop-after', false);
      });
    }
    function onUp() {
      item.removeEventListener('pointermove', onMove);
      item.removeEventListener('pointerup', onUp);
      item.removeEventListener('pointercancel', onUp);
      item.classList.remove('dragging');
      list.classList.remove('drop-target');
      items.forEach(function (el) { el.classList.remove('drop-before', 'drop-after'); });
      if (!dragging) {
        app.doc.active = app.doc.layers.length - 1 - visualIndex;
        self.refreshLayers();
        return;
      }
      var n = app.doc.layers.length;
      var from = n - 1 - visualIndex;
      var to = n - 1 - visualTo;
      if (from === to) { self.refreshLayers(); return; }
      app.snapshotOp('调整层序', function () { app.doc.moveLayerTo(from, to); });
      self.setStatus('已调整图层顺序');
    }
    item.addEventListener('pointermove', onMove);
    item.addEventListener('pointerup', onUp);
    item.addEventListener('pointercancel', onUp);
  });
};


/* ---------- 画布交互（鼠标 / 数位笔 / 多点触摸） ---------- */
UI.prototype.applyCursor = function () {
  var id = this.app.activeToolId();
  var map = {
    pan: 'grab', eyedropper: 'crosshair', select: 'crosshair',
    text: 'text', gradient: 'crosshair', crop: 'crosshair',
    transform: 'move', dodge: 'none'
  };
  this.view.style.cursor = this.spaceDown ? 'grab' : (map[id] || 'none');
};

UI.prototype.bindStage = function () {
  var self = this, app = this.app, view = this.view;

  this.pointers = new Map();
  this.penActive = false;
  this.penEraser = false;
  this.mode = 'idle';
  this.suppressDraw = false;

  function localPos(e) {
    var r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pressureOf(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
    return 1;
  }
  function tiltOf(e) {
    if (e.pointerType !== 'pen') return { x: 0, y: 0 };
    if (e.tiltX != null && (e.tiltX || e.tiltY)) return { x: e.tiltX, y: e.tiltY };
    if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0) {
      var mag = 90 - e.altitudeAngle * 180 / Math.PI;
      var az = e.azimuthAngle || 0;
      return { x: mag * Math.cos(az), y: mag * Math.sin(az) };
    }
    return { x: 0, y: 0 };
  }
  function makePt(e, vp) {
    var d = app.renderer.toDoc(vp.x, vp.y);
    var tl = tiltOf(e);
    return {
      x: d.x, y: d.y, pressure: pressureOf(e),
      tiltX: tl.x, tiltY: tl.y,
      shift: !!e.shiftKey, alt: !!e.altKey, ctrl: !!(e.ctrlKey || e.metaKey)
    };
  }
  function ptFromRec(rec) {
    var d = app.renderer.toDoc(rec.vx, rec.vy);
    return {
      x: d.x, y: d.y, pressure: rec.pressure == null ? 1 : rec.pressure,
      tiltX: rec.tiltX || 0, tiltY: rec.tiltY || 0,
      shift: !!rec.shift, alt: !!rec.alt, ctrl: false
    };
  }
  function touchList() {
    return Array.from(self.pointers.values()).filter(function (p) { return p.type === 'touch'; });
  }
  function centroid(list) {
    var x = 0, y = 0;
    for (var i = 0; i < list.length; i++) { x += list[i].vx; y += list[i].vy; }
    return { x: x / list.length, y: y / list.length };
  }
  function distOf(a, b) { return Math.sqrt(Math.pow(a.vx - b.vx, 2) + Math.pow(a.vy - b.vy, 2)); }

  /* ---- 描边生命周期 ---- */
  function beginDraw(pt, e) {
    var tool = app.tools[app.activeToolId()];
    if (!tool || !tool.onDown) return false;
    self.smooth = { x: pt.x, y: pt.y };
    self.lastPt = pt;
    self.dragTool = tool;
    self.mode = 'draw';
    tool.onDown(pt, e || {});
    app.requestRender();
    return true;
  }
  function moveDraw(pt, e) {
    if (!self.dragTool) return;
    var id = app.activeToolId();
    if (id !== 'move' && id !== 'select' && id !== 'objectSelect' && id !== 'liquify' &&
        id !== 'blur' && id !== 'heal' && id !== 'crop' && id !== 'gradient' && id !== 'eyedropper' &&
        id !== 'transform' && id !== 'dodge') {
      var sm = app.settings.brush.smoothing;
      if (sm > 0.001) {
        var k = 1 - Math.pow(1 - DL.clamp(sm, 0, 0.9), 3);
        self.smooth.x += (pt.x - self.smooth.x) * Math.max(0.06, k);
        self.smooth.y += (pt.y - self.smooth.y) * Math.max(0.06, k);
        pt.x = self.smooth.x;
        pt.y = self.smooth.y;
      }
    }
    self.lastPt = pt;
    if (self.dragTool.onMove) self.dragTool.onMove(pt, e || {});
    app.requestRender();
  }
  function endDraw(e) {
    var tool = self.dragTool;
    self.dragTool = null;
    if (tool && tool.onUp) tool.onUp(self.lastPt || { x: 0, y: 0 }, e || {});
    if (self.mode === 'draw') self.mode = 'idle';
    app._forcedTool = null;
    app.requestRender();
  }

  /* ---- 触摸手势 ---- */
  function startTouchDraw(rec) {
    self.mode = 'draw';
    beginDraw(ptFromRec(rec), {});
  }
  function startPinch(list) {
    if (self.mode === 'draw') { app.cancelStroke(); self.dragTool = null; }
    if (self.mode === 'erase3') finishEraseGesture();
    var R = app.renderer;
    var a = list[0], b = list[1];
    var mx = (a.vx + b.vx) / 2, my = (a.vy + b.vy) / 2;
    self.mode = 'pinch';
    self.pinch = { d0: Math.max(4, distOf(a, b)), scale0: R.scale, docPt: R.toDoc(mx, my) };
  }
  function updatePinch() {
    var list = touchList();
    if (self.mode !== 'pinch' || list.length < 2 || !self.pinch) return;
    var R = app.renderer, p = self.pinch;
    var a = list[0], b = list[1];
    var mx = (a.vx + b.vx) / 2, my = (a.vy + b.vy) / 2;
    var ns = DL.clamp(p.scale0 * (Math.max(4, distOf(a, b)) / p.d0), 0.02, 24);
    R.scale = ns;
    R.ox = mx - p.docPt.x * ns;
    R.oy = my - p.docPt.y * ns;
    self.updateZoom();
    app.requestRender();
  }
  function startEraseGesture(list) {
    if (self.mode === 'erase3') return;
    if (self.mode === 'draw') { app.cancelStroke(); self.dragTool = null; }
    if (self.mode === 'pinch') self.pinch = null;
    self.savedTool = app.settings.tool;
    self.mode = 'erase3';
    self.setTool('eraser');
    var c = centroid(list);
    var pt = ptFromRec({ vx: c.x, vy: c.y, pressure: 1 });
    self.smooth = { x: pt.x, y: pt.y };
    self.dragTool = app.tools.eraser;
    self.dragTool.onDown(pt, {});
    self.setStatus('三指擦除中…');
    app.requestRender();
  }
  function feedErase() {
    var list = touchList();
    if (!list.length || !self.dragTool) return;
    var c = centroid(list);
    moveDraw(ptFromRec({ vx: c.x, vy: c.y, pressure: 1 }), {});
  }
  function finishEraseGesture() {
    if (self.mode === 'erase3' && self.dragTool) endDraw();
    if (self.savedTool) { self.setTool(self.savedTool); self.savedTool = null; }
    if (self.mode === 'erase3') self.mode = 'idle';
  }
  function endGesture() {
    if (self.mode === 'erase3') finishEraseGesture();
    else if (self.mode === 'draw') endDraw();
    if (self.mode === 'pinch') self.pinch = null;
    self.mode = 'idle';
  }
  function syncTouchMode() {
    var ts = touchList(), o = app.settings.opts;
    if (!ts.length) { self.suppressDraw = false; endGesture(); return; }
    if (ts.length >= 3 && o.threeFingerErase) { startEraseGesture(ts); return; }
    if (ts.length === 2 && o.pinchZoom) { startPinch(ts); return; }
    if (ts.length === 1) {
      if (self.mode === 'pinch' || self.mode === 'erase3') {
        endGesture();
        self.suppressDraw = true;
      }
      if (self.suppressDraw) return;
      startTouchDraw(ts[0]);
      return;
    }
    endGesture();
  }

  view.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  view.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch' && self.penActive) return; /* 用笔时忽略手掌 */
    if (e.pointerType === 'touch' && self.pointers.size >= 3) return;
    view.setPointerCapture(e.pointerId);
    var vp = localPos(e);
    self.lastVp = vp;
    self.pointers.set(e.pointerId, {
      id: e.pointerId, type: e.pointerType, vx: vp.x, vy: vp.y,
      pressure: pressureOf(e), tiltX: tiltOf(e).x, tiltY: tiltOf(e).y,
      shift: e.shiftKey, alt: e.altKey
    });
    if (self.pointers.size === 1) self.hint.style.opacity = '0';

    if (e.pointerType === 'pen') {
      self.penActive = true;
      self.penEraser = (e.button === 5 || (e.buttons & 32) !== 0);
    }
    if (e.pointerType === 'touch') { syncTouchMode(); return; }
    if (e.button === 2) return;

    var pt = makePt(e, vp);
    if (e.button === 1 || self.spaceDown || app.settings.tool === 'pan') {
      self.mode = 'pan';
      self.pan = { vx: vp.x, vy: vp.y, ox: app.renderer.ox, oy: app.renderer.oy };
      self.applyCursor();
      return;
    }
    if (self.penEraser) app._forcedTool = 'eraser';
    var toolId = app.activeToolId();
    if (e.altKey && toolId === 'clone') {
      app.cloneSource = { x: pt.x, y: pt.y };
      app.cloneOffset = null;
      self.updateToolOptions();
      app.requestRender();
      self.setStatus('已设置取样源：' + Math.round(pt.x) + ' , ' + Math.round(pt.y));
      return;
    }
    if (e.altKey && toolId !== 'eyedropper' && toolId !== 'select' &&
        toolId !== 'objectSelect' && toolId !== 'blur' && toolId !== 'liquify') {
      app.pickColorAt(pt);
      self.mode = 'pick';
      return;
    }
    beginDraw(pt, e);
  });

  view.addEventListener('pointermove', function (e) {
    var vp = localPos(e);
    var rec = self.pointers.get(e.pointerId);
    if (rec) { rec.vx = vp.x; rec.vy = vp.y; }

    if (e.pointerType === 'touch') {
      if (self.mode === 'pinch') { updatePinch(); return; }
      if (self.mode === 'erase3') { feedErase(); return; }
      if (self.mode === 'draw' && (!rec || rec.id === e.pointerId)) {
        if (rec) { rec.pressure = pressureOf(e); }
        if (rec) moveDraw(ptFromRec(rec), e);
      }
      return;
    }

    self.lastVp = vp;
    var pt = makePt(e, vp);
    self.updateCursor(vp, pt);
    $('status-pos').textContent = Math.round(pt.x) + ' , ' + Math.round(pt.y);

    /* 取色放大镜 */
    var tid = app.activeToolId();
    var wantLoupe = (tid === 'eyedropper' || self.mode === 'pick') && app.settings.opts.loupe;
    if (wantLoupe) {
      app.overlayState.loupe = { vx: vp.x, vy: vp.y };
      app.renderer.renderOverlay();
    } else if (app.overlayState.loupe) {
      app.overlayState.loupe = null;
      app.renderer.renderOverlay();
    }

    if (self.mode === 'pan') {
      app.renderer.ox = self.pan.ox + (vp.x - self.pan.vx);
      app.renderer.oy = self.pan.oy + (vp.y - self.pan.vy);
      app.requestRender();
      return;
    }
    if (self.mode === 'pick') { app.pickColorAt(pt); return; }
    if (self.mode !== 'draw') return;

    /* 数位笔：使用合并事件，笔迹更顺滑 */
    var evs = (e.pointerType === 'pen' && e.getCoalescedEvents) ? e.getCoalescedEvents() : null;
    if (evs && evs.length) {
      for (var i = 0; i < evs.length; i++) {
        var ce = evs[i];
        var cvp = localPos(ce);
        var cp = makePt(ce, cvp);
        if (ce.tiltX == null) { cp.tiltX = pt.tiltX; cp.tiltY = pt.tiltY; }
        moveDraw(cp, ce);
      }
    } else {
      moveDraw(pt, e);
    }
  });

  function onPointerEnd(e) {
    self.pointers.delete(e.pointerId);
    if (e.pointerType === 'pen') { self.penActive = false; self.penEraser = false; }
    if (e.pointerType === 'touch') { syncTouchMode(); return; }
    if (self.mode === 'draw') endDraw(e);
    self.mode = 'idle';
    self.pan = null;
    app._forcedTool = null;
    self.applyCursor();
    app.requestRender();
  }
  view.addEventListener('pointerup', onPointerEnd);
  view.addEventListener('pointercancel', onPointerEnd);
  view.addEventListener('pointerleave', function () {
    self.ring.hidden = true;
    if (app.overlayState.loupe) { app.overlayState.loupe = null; app.renderer.renderOverlay(); }
  });

  view.addEventListener('wheel', function (e) {
    e.preventDefault();
    var vp = localPos(e);
    if (e.shiftKey) {
      app.renderer.ox -= e.deltaY;
      app.requestRender();
      return;
    }
    var factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    if (e.ctrlKey) factor = Math.exp(-e.deltaY * 0.01);
    app.renderer.zoomAt(DL.clamp(factor, 0.4, 2.5), vp.x, vp.y);
  }, { passive: false });
};

UI.prototype.updateCursor = function (vp, pt) {
  var app = this.app;
  var tool = app.activeToolId();
  var show = (tool === 'brush' || tool === 'eraser' || tool === 'clone' || tool === 'smudge' ||
    tool === 'line' || tool === 'blur' || tool === 'heal' || tool === 'liquify' || tool === 'objectSelect' ||
    tool === 'dodge');
  if (!show || this.spaceDown || this.mode === 'pan') { this.ring.hidden = true; return; }
  var size = app.settings.brush.size * app.renderer.scale;
  this.ring.hidden = false;
  this.ring.style.left = vp.x + 'px';
  this.ring.style.top = vp.y + 'px';
  this.ring.style.width = Math.max(5, size) + 'px';
  this.ring.style.height = Math.max(5, size) + 'px';
  if (tool === 'heal' || tool === 'liquify') {
    this.ring.style.opacity = '0.85';
  } else {
    this.ring.style.opacity = '1';
  }
};

/* ---------- 快捷键 ---------- */
UI.prototype.bindKeys = function () {
  var self = this, app = this.app;
  var keyMap = {
    b: 'brush', e: 'eraser', s: 'clone', u: 'smudge', g: 'bucket', i: 'eyedropper',
    l: 'line', v: 'move', h: 'pan', t: 'text', m: 'select', w: 'select',
    o: 'objectSelect', q: 'liquify', f: 'gradient', r: 'blur', j: 'heal', c: 'crop'
  };

  function typing(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  window.addEventListener('keydown', function (e) {
    var modalOpen = !$('modal-backdrop').hidden;
    if (modalOpen) return;
    var mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space' && !typing(e)) {
      self.spaceDown = true;
      self.ring.hidden = true;
      self.applyCursor();
      e.preventDefault();
      return;
    }
    if (typing(e)) return;

    /* 裁剪确认 / 取消 */
    if (e.key === 'Enter' && app.overlayState.crop) {
      e.preventDefault();
      var cr = app.overlayState.crop;
      self.hideCropBar();
      app.cropTo({ x: cr.x, y: cr.y, w: cr.w, h: cr.h });
      return;
    }
    if (e.key === 'Escape') {
      if (app.overlayState.crop) {
        e.preventDefault();
        app.overlayState.crop = null;
        app.renderer.renderOverlay();
        self.hideCropBar();
        self.setStatus('已取消裁剪');
        return;
      }
      if (app.selection) { e.preventDefault(); app.clearSelection(); return; }
    }

    if (mod) {
      var k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) self.redo(); else self.undo();
        return;
      }
      if (k === 'y') { e.preventDefault(); self.redo(); return; }
      if (k === 's') { e.preventDefault(); app.savePNG(); return; }
      if (k === 'o') { e.preventDefault(); $('file-input').click(); return; }
      if (k === 'n') {
        e.preventDefault();
        if (e.shiftKey) app.snapshotOp('新建图层', function () { app.doc.addLayer(); });
        else app.newDocument();
        return;
      }
      if (k === 'e') {
        e.preventDefault();
        if (app.doc.active > 0) app.snapshotOp('向下合并', function () { app.doc.mergeDown(app.doc.active); });
        return;
      }
      if (k === '0') { e.preventDefault(); app.renderer.fit(); return; }
      if (k === 'd') { e.preventDefault(); app.clearSelection(); return; }
      if (k === 'i') { e.preventDefault(); app.invertSelection(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); app.renderer.zoomAt(1.25, app.renderer.vw / 2, app.renderer.vh / 2); return; }
      if (k === '-') { e.preventDefault(); app.renderer.zoomAt(1 / 1.25, app.renderer.vw / 2, app.renderer.vh / 2); return; }
      return;
    }

    if (e.key === '[' || e.key === ']') {
      var b = app.settings.brush;
      var step = b.size < 10 ? 1 : (b.size < 40 ? 2 : (b.size < 120 ? 5 : 12));
      b.size = DL.clamp(b.size + (e.key === ']' ? step : -step), 1, 400);
      self.updateBrushUI();
      e.preventDefault();
      return;
    }
    if (e.key === 'x') {
      var tmp = app.settings.bgColor;
      app.settings.bgColor = app.settings.color;
      app.setColor(tmp, { silent: true });
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      var l = app.doc.activeLayer();
      if (l.locked) { self.setStatus('图层已锁定'); return; }
      var id = l.id;
      app.snapshotOp('清空图层', function () { DL.findLayer(app.doc, id).clear(); });
      self.setStatus('已清空当前图层');
      return;
    }
    var tl = keyMap[e.key.toLowerCase()];
    if (tl && !e.altKey) { self.setTool(tl); e.preventDefault(); }
  });

  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      self.spaceDown = false;
      self.applyCursor();
      e.preventDefault();
    }
  });
};

/* ------------------------------------------------------------
 * 启动
 * ---------------------------------------------------------- */
global.addEventListener('DOMContentLoaded', function () {
  global.drawlib = new App();
});

})(window);

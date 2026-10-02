/* ============================================================
 * DrawLib · menu.js
 * PS 风格菜单栏 + 图像 / 编辑 / 选择 / 视图 操作 + 历史记录面板
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

/* ------------------------------------------------------------
 * 蒙版运算（选区的扩展 / 收缩 / 羽化 / 平滑 / 边界）
 * ---------------------------------------------------------- */
function maskBBox(mask, w, h) {
  var x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function morph(mask, w, h, r, mode) {
  if (r < 1) return mask;
  var out = new Uint8Array(w * h);
  var i, x, y, j, k;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      var hit = mode === 'min';
      for (j = -r; j <= r && (mode === 'min' ? hit : !hit); j++) {
        var sy = y + j;
        if (sy < 0 || sy >= h) { if (mode === 'min') { hit = false; break; } else continue; }
        for (k = -r; k <= r; k++) {
          var sx = x + k;
          if (sx < 0 || sx >= w) { if (mode === 'min') { hit = false; break; } else continue; }
          var v = mask[sy * w + sx];
          if (mode === 'max' && v) { hit = true; break; }
          if (mode === 'min' && !v) { hit = false; break; }
        }
      }
      out[y * w + x] = hit ? 1 : 0;
    }
  }
  return out;
}
function boxMask(mask, w, h, r) {
  if (r < 1) return mask;
  var tmp = new Float32Array(w * h), out = new Uint8Array(w * h);
  var x, y, k, sum, cnt;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      sum = 0; cnt = 0;
      for (k = -r; k <= r; k++) {
        var sx = x + k;
        if (sx < 0 || sx >= w) continue;
        sum += mask[y * w + sx] ? 1 : 0; cnt++;
      }
      tmp[y * w + x] = sum / Math.max(1, cnt);
    }
  }
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      sum = 0; cnt = 0;
      for (k = -r; k <= r; k++) {
        var sy = y + k;
        if (sy < 0 || sy >= h) continue;
        sum += tmp[sy * w + x]; cnt++;
      }
      out[y * w + x] = Math.round(sum / Math.max(1, cnt) * 255);
    }
  }
  return out;
}
function smoothMask(mask, w, h, r) {
  if (r < 1) return mask;
  var blurred = boxMask(mask, w, h, r);
  var out = new Uint8Array(w * h);
  for (var i = 0; i < out.length; i++) out[i] = blurred[i] >= 128 ? 1 : 0;
  return out;
}
function borderMask(mask, w, h, r) {
  var a = morph(mask, w, h, r, 'max'), b = morph(mask, w, h, r, 'min');
  var out = new Uint8Array(w * h);
  for (var i = 0; i < out.length; i++) out[i] = (a[i] && !b[i]) ? 1 : 0;
  return out;
}
function alphaToMask(layer, w, h) {
  var mask = new Uint8Array(w * h);
  var d;
  try { d = layer.ctx.getImageData(0, 0, w, h).data; } catch (e) { return mask; }
  for (var i = 0; i < w * h; i++) if (d[(i << 2) + 3] > 8) mask[i] = 1;
  return mask;
}
var MASK = {
  bbox: maskBBox, morph: morph, box: boxMask, smooth: smoothMask, border: borderMask, fromAlpha: alphaToMask
};
DL.maskOps = MASK;

/* ------------------------------------------------------------
 * 图像操作
 * ---------------------------------------------------------- */
function resizeLayerCanvas(layer, w, h, smooth) {
  var c = DL.createCanvas(w, h);
  var g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = smooth !== 'pixel';
  g.imageSmoothingQuality = 'high';
  g.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, w, h);
  layer.canvas = c;
  layer.ctx = c.getContext('2d');
  layer._thumb = null;
  layer.touch();
}
function canvasOrigin(opts) {
  /* opts: {anchor:0..8, ox, oy, dw, dh} → 目标画布左上角对应旧画布的位置 */
  return opts;
}

DL.imageOps = {
  resize: function (app, w, h, smooth) {
    var d = app.doc;
    if (w === d.width && h === d.height) return;
    app.snapshotOp('图像大小', function () {
      for (var i = 0; i < d.layers.length; i++) resizeLayerCanvas(d.layers[i], w, h, smooth);
      d.width = w; d.height = h;
    });
    app.status('图像已缩放为 ' + w + ' × ' + h);
  },
  canvasSize: function (app, w, h, anchor) {
    var d = app.doc;
    var ax = anchor % 3, ay = Math.floor(anchor / 3); /* 0..2 */
    var ox = Math.round((w - d.width) * (ax / 2));
    var oy = Math.round((h - d.height) * (ay / 2));
    app.snapshotOp('画布大小', function () {
      for (var i = 0; i < d.layers.length; i++) {
        var l = d.layers[i];
        var c = DL.createCanvas(w, h);
        var g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(l.canvas, ox, oy);
        l.canvas = c; l.ctx = c.getContext('2d'); l._thumb = null; l.touch();
      }
      d.width = w; d.height = h;
    });
    app.status('画布尺寸已改为 ' + w + ' × ' + h);
  },
  rotate90: function (app, dir) {
    var d = app.doc;
    var w = d.width, h = d.height;
    app.snapshotOp('旋转 ' + (dir === 1 ? '90° 顺时针' : (dir === -1 ? '90° 逆时针' : '180°')), function () {
      var nw = dir === 0 ? w : h, nh = dir === 0 ? h : w;
      for (var i = 0; i < d.layers.length; i++) {
        var l = d.layers[i];
        var c = DL.createCanvas(nw, nh);
        var g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (dir === 1) { g.translate(nw, 0); g.rotate(Math.PI / 2); }
        else if (dir === -1) { g.translate(0, nh); g.rotate(-Math.PI / 2); }
        else { g.translate(nw, nh); g.rotate(Math.PI); }
        g.drawImage(l.canvas, 0, 0);
        l.canvas = c; l.ctx = c.getContext('2d'); l._thumb = null; l.touch();
      }
      d.width = nw; d.height = nh;
    });
  },
  rotateAngle: function (app, angle, bg, expand) {
    var d = app.doc;
    var rad = angle * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var w0 = d.width, h0 = d.height;
    var w1 = expand ? Math.round(Math.abs(w0 * cos) + Math.abs(h0 * sin)) : w0;
    var h1 = expand ? Math.round(Math.abs(w0 * sin) + Math.abs(h0 * cos)) : h0;
    app.snapshotOp('旋转 ' + (Math.round(angle * 100) / 100) + '°', function () {
      for (var i = 0; i < d.layers.length; i++) {
        var l = d.layers[i];
        var c = DL.createCanvas(w1, h1);
        var g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (bg && bg !== 'transparent') { g.fillStyle = bg; g.fillRect(0, 0, w1, h1); }
        g.translate(w1 / 2, h1 / 2);
        g.rotate(rad);
        g.imageSmoothingEnabled = true;
        g.drawImage(l.canvas, -w0 / 2, -h0 / 2);
        l.canvas = c; l.ctx = c.getContext('2d'); l._thumb = null; l.touch();
      }
      d.width = w1; d.height = h1;
    });
  },
  flip: function (app, axis, layerOnly) {
    var d = app.doc;
    app.snapshotOp((layerOnly ? '图层' : '图像') + (axis === 'h' ? '水平翻转' : '垂直翻转'), function () {
      var list = layerOnly ? [d.activeLayer()] : d.layers;
      for (var i = 0; i < list.length; i++) {
        var l = list[i], w = l.canvas.width, h = l.canvas.height;
        var c = DL.createCanvas(w, h);
        var g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (axis === 'h') { g.translate(w, 0); g.scale(-1, 1); }
        else { g.translate(0, h); g.scale(1, -1); }
        g.drawImage(l.canvas, 0, 0);
        l.canvas = c; l.ctx = c.getContext('2d'); l._thumb = null; l.touch();
      }
    });
  },
  /* 只旋转当前图层内容（画布尺寸不变，绕中心旋转，超出部分裁掉） */
  rotateLayer90: function (app, dir) {
    var d = app.doc, l = d.activeLayer();
    if (!l) return;
    if (l.locked) { app.status('图层已锁定'); return; }
    var w = l.canvas.width, h = l.canvas.height;
    app.snapshotOp('旋转图层 ' + (dir > 0 ? '90° 顺时针' : '90° 逆时针'), function () {
      var c = DL.createCanvas(w, h);
      var g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(w / 2, h / 2);
      g.rotate(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.drawImage(l.canvas, -w / 2, -h / 2);
      var t = DL.findLayer(d, l.id) || l;
      t.canvas = c; t.ctx = c.getContext('2d'); t._thumb = null; t.touch();
    });
    app.status('图层已旋转 90°');
  },
  /* 裁切透明边 */
  trim: function (app) {
    var d = app.doc;
    var merged = app.merged();
    var data;
    try { data = merged.getContext('2d').getImageData(0, 0, d.width, d.height).data; } catch (e) { return; }
    var x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
    for (var y = 0; y < d.height; y++) {
      for (var x = 0; x < d.width; x++) {
        if (data[((y * d.width + x) << 2) + 3] > 4) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { app.status('画面完全透明，无法裁切'); return; }
    if (x0 === 0 && y0 === 0 && x1 === d.width - 1 && y1 === d.height - 1) {
      app.status('边缘没有需要裁掉的透明区域');
      return;
    }
    var w = x1 - x0 + 1, h = y1 - y0 + 1;
    app.snapshotOp('裁切透明边', function () {
      for (var i = 0; i < d.layers.length; i++) {
        var l = d.layers[i];
        var c = DL.createCanvas(w, h);
        var g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(l.canvas, -x0, -y0);
        l.canvas = c; l.ctx = c.getContext('2d'); l._thumb = null; l.touch();
      }
      d.width = w; d.height = h;
    });
    app.status('已裁切为 ' + w + ' × ' + h);
  },
  /* 裁切到选区外框（带预览） */
  cropToRect: function (app, rect) {
    var d = app.doc;
    var r = DL.rectClip(rect, d.width, d.height);
    if (!r || r.w < 2 || r.h < 2) { app.status('裁剪区域无效'); return; }
    app.snapshotOp('裁剪', function () {
      for (var i = 0; i < d.layers.length; i++) {
        var l = d.layers[i];
        var c = DL.createCanvas(r.w, r.h);
        var g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(l.canvas, -r.x, -r.y);
        l.canvas = c; l.ctx = c.getContext('2d'); l._thumb = null; l.touch();
      }
      d.width = r.w; d.height = r.h;
    });
    app.status('已裁剪为 ' + r.w + ' × ' + r.h);
  },
  flatten: function (app) {
    var d = app.doc;
    if (d.layers.length <= 1) { app.status('只有一个图层，无需拼合'); return; }
    app.snapshotOp('拼合图像', function () {
      var merged = app.merged();
      var base = d.layers[0];
      base.clear();
      base.ctx.setTransform(1, 0, 0, 1, 0, 0);
      base.ctx.globalAlpha = 1;
      base.ctx.globalCompositeOperation = 'source-over';
      base.ctx.drawImage(merged, 0, 0);
      base.blend = 'source-over';
      base.opacity = 1;
      base.name = '背景';
      base.touch();
      d.layers = [base];
      d.active = 0;
    });
    app.status('已拼合为单个图层');
  },
  /* 复制当前文档 */
  duplicate: function (app) {
    var d = app.doc;
    var nd = new DL.Doc(d.width, d.height);
    nd.fileName = (d.fileName || '未命名') + ' 副本';
    nd.layers = [];
    for (var i = 0; i < d.layers.length; i++) {
      var l = d.layers[i];
      var nl = new DL.Layer(d.width, d.height, l.name);
      nl.ctx.setTransform(1, 0, 0, 1, 0, 0);
      nl.ctx.drawImage(l.canvas, 0, 0);
      nl.visible = l.visible; nl.opacity = l.opacity; nl.blend = l.blend;
      nl.touch();
      nd.layers.push(nl);
    }
    nd.active = d.active;
    app.loadDocument(nd);
    app.status('已复制为新文档');
  }
};

/* ------------------------------------------------------------
 * 剪贴板
 * ---------------------------------------------------------- */
DL.clipboard = { canvas: null, x: 0, y: 0, w: 0, h: 0, has: false };
function copyRegion(app, cut) {
  var d = app.doc, layer = d.activeLayer();
  if (!layer) return;
  var rect = app.selection ? app.selection.rect : { x: 0, y: 0, w: d.width, h: d.height };
  rect = DL.rectClip(rect, d.width, d.height);
  var c = DL.createCanvas(rect.w, rect.h);
  var g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(layer.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  if (app.selection) {
    var mask = DL.filters.cropMask(app.selection.mask, d.width, rect);
    var mc = DL.createCanvas(rect.w, rect.h);
    var mg = mc.getContext('2d');
    var img = mg.createImageData(rect.w, rect.h);
    for (var i = 0; i < rect.w * rect.h; i++) {
      var a = app.selection.soft ? mask[i] : (mask[i] ? 255 : 0);
      var o = i << 2;
      img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = a;
    }
    mg.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mc, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  DL.clipboard = { canvas: c, x: rect.x, y: rect.y, w: rect.w, h: rect.h, has: true };
  if (cut) app.deleteSelection(true);
  app.status((cut ? '已剪切 ' : '已复制 ') + rect.w + ' × ' + rect.h + ' 像素');
  DL.menu.refreshItems();
}
function pasteClipboard(app, asNewLayer) {
  var cb = DL.clipboard;
  if (!cb.has) {
    /* 尝试从系统剪贴板读取图片 */
    if (global.navigator && navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var types = items[i].types || [];
          for (var j = 0; j < types.length; j++) {
            if (types[j].indexOf('image') === 0) {
              items[i].getType(types[j]).then(function (blob) {
                var url = URL.createObjectURL(blob);
                var img = new Image();
                img.onload = function () {
                  URL.revokeObjectURL(url);
                  DL.clipboard = { canvas: img, x: 0, y: 0, w: img.width, h: img.height, has: true };
                  placeClipboard(app, true);
                };
                img.src = url;
              });
              return;
            }
          }
        }
        app.status('系统剪贴板里没有图片');
      }).catch(function () { app.status('剪贴板为空（浏览器可能不允许读取）'); });
    } else app.status('剪贴板为空');
    return;
  }
  placeClipboard(app, asNewLayer);
}
function placeClipboard(app, forceLayer) {
  var cb = DL.clipboard, d = app.doc;
  var px = cb.x, py = cb.y;
  if (px + cb.w > d.width || py + cb.h > d.height) {
    px = Math.max(0, Math.round((d.width - cb.w) / 2));
    py = Math.max(0, Math.round((d.height - cb.h) / 2));
  }
  app.snapshotOp('粘贴', function () {
    var target;
    if (forceLayer || !app.selection) target = d.activeLayer();
    else target = d.activeLayer();
    var g = target.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(cb.canvas, px, py);
    target.touch();
  });
  app.status('已粘贴 ' + cb.w + ' × ' + cb.h + ' 像素');
}
DL.menuOps = { copy: copyRegion, paste: pasteClipboard };

/* ------------------------------------------------------------
 * 填充 / 描边
 * ---------------------------------------------------------- */
function fillWith(app, opt) {
  var d = app.doc, layer = d.activeLayer();
  if (!layer) return;
  if (layer.locked) { app.status('图层已锁定'); return; }
  app.snapshotOp('填充', function () {
    var g = layer.ctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = opt.opacity / 100;
    g.globalCompositeOperation = opt.mode || 'source-over';
    var color = opt.color;
    var doFill = function () {
      if (color === 'transparent') {
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
      } else g.fillStyle = color;
      g.fillRect(0, 0, d.width, d.height);
    };
    if (app.selection) {
      var mc = DL.maskToAlphaCanvas(app.selection.mask, d.width, d.height, null, !!app.selection.soft);
      var tmp = DL.createCanvas(d.width, d.height);
      var tg = tmp.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.fillStyle = color === 'transparent' ? '#000' : color;
      tg.fillRect(0, 0, d.width, d.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(mc, 0, 0);
      g.globalCompositeOperation = opt.mode || 'source-over';
      g.drawImage(tmp, 0, 0);
    } else {
      if (opt.preserveAlpha) {
        var keep = DL.createCanvas(d.width, d.height);
        var kg = keep.getContext('2d');
        kg.setTransform(1, 0, 0, 1, 0, 0);
        doFillOn(kg, d, color, opt);
        kg.globalCompositeOperation = 'destination-in';
        kg.drawImage(layer.canvas, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.drawImage(keep, 0, 0);
      } else doFill();
    }
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    layer.touch();
  });
  app.status('已填充');
}
function doFillOn(g, d, color, opt) {
  g.globalAlpha = opt.opacity / 100;
  g.globalCompositeOperation = opt.mode || 'source-over';
  g.fillStyle = color === 'transparent' ? '#000' : color;
  g.fillRect(0, 0, d.width, d.height);
}

function strokeLayer(app, opt) {
  var d = app.doc, layer = d.activeLayer();
  if (!layer) return;
  var mask;
  if (app.selection) mask = app.selection.mask;
  else mask = MASK.fromAlpha(layer, d.width, d.height);
  var has = false;
  for (var i = 0; i < mask.length; i++) if (mask[i]) { has = true; break; }
  if (!has) { app.status('没有可描边的内容'); return; }
  var w = Math.max(1, opt.width);
  var segs = DL.buildOutline(mask, d.width, d.height, { x: 0, y: 0, w: d.width, h: d.height });
  var mc = DL.maskToAlphaCanvas(mask, d.width, d.height);
  app.snapshotOp('描边', function () {
    var tmp = DL.createCanvas(d.width, d.height);
    var tg = tmp.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalAlpha = opt.opacity / 100;
    tg.globalCompositeOperation = opt.mode || 'source-over';
    var lw = opt.position === 'center' ? w : w * 2;
    tg.strokeStyle = opt.color;
    tg.lineWidth = lw;
    tg.lineJoin = 'round';
    tg.lineCap = 'round';
    tg.beginPath();
    for (var k = 0; k < segs.length; k += 4) {
      tg.moveTo(segs[k], segs[k + 1]);
      tg.lineTo(segs[k + 2], segs[k + 3]);
    }
    tg.stroke();
    if (opt.position === 'inside') {
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(mc, 0, 0);
    } else if (opt.position === 'outside') {
      tg.globalCompositeOperation = 'destination-out';
      tg.drawImage(mc, 0, 0);
    }
    tg.globalAlpha = 1;
    tg.globalCompositeOperation = 'source-over';
    var g = layer.ctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(tmp, 0, 0);
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    layer.touch();
  });
  app.status('已描边 ' + w + 'px');
}
DL.fillOps = { fill: fillWith, stroke: strokeLayer };

/* ------------------------------------------------------------
 * 选择操作
 * ---------------------------------------------------------- */
DL.selectOps = {
  all: function (app) {
    var d = app.doc;
    var mask = new Uint8Array(d.width * d.height);
    mask.fill(1);
    app.setSelection(mask, { x: 0, y: 0, w: d.width, h: d.height });
    app.status('已全选');
  },
  reselect: function (app) {
    if (!app._lastSelection) { app.status('没有可恢复的选区'); return; }
    app.setSelection(app._lastSelection.mask, app._lastSelection.rect);
    app.status('已恢复上次选区');
  },
  feather: function (app, r) {
    if (!app.selection) { app.status('请先创建选区'); return; }
    var d = app.doc;
    var soft = MASK.box(app.selection.mask, d.width, d.height, Math.max(1, Math.round(r)));
    var rect = DL.rectGrow(app.selection.rect, Math.round(r) * 2);
    app.setSelection(soft, DL.rectClip(rect, d.width, d.height));
    app.selection.soft = true;
    app.status('选区已羽化 ' + r + ' 像素');
  },
  expand: function (app, r) {
    if (!app.selection) { app.status('请先创建选区'); return; }
    var d = app.doc;
    var m = MASK.morph(app.selection.mask, d.width, d.height, Math.max(1, Math.round(r)), 'max');
    app.setSelection(m, DL.rectGrow(app.selection.rect, Math.ceil(r)));
    app.status('选区已扩展 ' + r + ' 像素');
  },
  contract: function (app, r) {
    if (!app.selection) { app.status('请先创建选区'); return; }
    var d = app.doc;
    var m = MASK.morph(app.selection.mask, d.width, d.height, Math.max(1, Math.round(r)), 'min');
    app.setSelection(m, DL.rectGrow(app.selection.rect, 1));
    app.status('选区已收缩 ' + r + ' 像素');
  },
  smooth: function (app, r) {
    if (!app.selection) { app.status('请先创建选区'); return; }
    var d = app.doc;
    var m = MASK.smooth(app.selection.mask, d.width, d.height, Math.max(1, Math.round(r)));
    app.setSelection(m, DL.rectGrow(app.selection.rect, Math.ceil(r) + 1));
    app.status('选区已平滑');
  },
  border: function (app, r) {
    if (!app.selection) { app.status('请先创建选区'); return; }
    var d = app.doc;
    var m = MASK.border(app.selection.mask, d.width, d.height, Math.max(1, Math.round(r)));
    app.setSelection(m, DL.rectGrow(app.selection.rect, Math.ceil(r) + 1));
    app.status('已生成 ' + r + ' 像素边框选区');
  },
  colorRange: function (app, opt) {
    var d = app.doc;
    var src = opt.from === 'merged' ? app.merged() : d.activeLayer().canvas;
    var data;
    try { data = src.getContext('2d').getImageData(0, 0, d.width, d.height).data; } catch (e) { app.status('读取像素失败'); return; }
    var col = DL.hexToRgb(opt.color);
    var tol = opt.tolerance / 100 * 442;
    var mask = new Uint8Array(d.width * d.height);
    var count = 0;
    for (var i = 0; i < mask.length; i++) {
      var o = i << 2;
      if (data[o + 3] < 8) continue;
      var dr = data[o] - col.r, dg = data[o + 1] - col.g, db = data[o + 2] - col.b;
      var dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist <= tol) { mask[i] = 1; count++; }
    }
    if (!count) { app.status('容差范围内没有匹配的像素'); return; }
    var bb = MASK.bbox(mask, d.width, d.height);
    app.setSelection(mask, bb);
    app.status('色彩范围已选中 ' + count.toLocaleString() + ' 像素');
  },
  /* 用当前选区反选 */
  save: function (app) {
    if (app.selection) app._lastSelection = { mask: app.selection.mask, rect: app.selection.rect };
  }
};

/* ------------------------------------------------------------
 * 对话框
 * ---------------------------------------------------------- */
DL.menuDialogs = {};
DL.menuDialogs.imageSize = function (app) {
  var d = app.doc;
  var ratio = d.width / d.height;
  DL.dialog({
    title: '图像大小',
    html:
      '<div class="opt-note">当前：<b>' + d.width + ' × ' + d.height + '</b> 像素</div>' +
      '<div class="field"><label>宽度</label><input type="number" id="rs-w" min="1" max="8000" value="' + d.width + '"><span class="opt-note">px</span></div>' +
      '<div class="field"><label>高度</label><input type="number" id="rs-h" min="1" max="8000" value="' + d.height + '"><span class="opt-note">px</span></div>' +
      '<div class="field"><label>缩放</label><input type="number" id="rs-p" min="1" max="800" value="100"><span class="opt-note">%</span></div>' +
      '<div class="checks"><label><input type="checkbox" id="rs-link" checked> 保持长宽比例</label>' +
      '<label><input type="checkbox" id="rs-smooth" checked> 使用平滑插值（取消则最近邻，保留像素感）</label></div>' +
      '<div class="preset-grid" style="margin-top:6px">' +
      '<button class="btn" data-s="0.5">50%</button><button class="btn" data-s="2">200%</button>' +
      '<button class="btn" data-p="1920,1080">1920×1080</button><button class="btn" data-p="1080,1080">1080×1080</button>' +
      '</div>',
    actions: [{ label: '取消', value: null }, { label: '确定', value: 'ok', primary: true }],
    onMount: function (root) {
      var w = root.querySelector('#rs-w'), h = root.querySelector('#rs-h'), p = root.querySelector('#rs-p');
      var link = root.querySelector('#rs-link');
      var busy = false;
      function fromW() {
        if (busy) return; busy = true;
        if (link.checked) h.value = Math.max(1, Math.round(parseInt(w.value, 10) / ratio));
        p.value = Math.round(parseInt(w.value, 10) / d.width * 100);
        busy = false;
      }
      function fromH() {
        if (busy) return; busy = true;
        if (link.checked) w.value = Math.max(1, Math.round(parseInt(h.value, 10) * ratio));
        p.value = Math.round(parseInt(h.value, 10) / d.height * 100);
        busy = false;
      }
      function fromP() {
        if (busy) return; busy = true;
        w.value = Math.max(1, Math.round(d.width * parseFloat(p.value) / 100));
        h.value = Math.max(1, Math.round(d.height * parseFloat(p.value) / 100));
        busy = false;
      }
      w.addEventListener('input', fromW);
      h.addEventListener('input', fromH);
      p.addEventListener('input', fromP);
      root.querySelectorAll('[data-s]').forEach(function (b) {
        b.addEventListener('click', function () { p.value = Math.round(parseFloat(b.dataset.s) * 100); fromP(); });
      });
      root.querySelectorAll('[data-p]').forEach(function (b) {
        b.addEventListener('click', function () {
          var pr = b.dataset.p.split(',');
          w.value = pr[0]; h.value = pr[1]; fromW();
        });
      });
      fromW();
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var w = DL.clamp(parseInt(r.root.querySelector('#rs-w').value, 10) || d.width, 1, 8000);
    var h = DL.clamp(parseInt(r.root.querySelector('#rs-h').value, 10) || d.height, 1, 8000);
    var smooth = r.root.querySelector('#rs-smooth').checked ? 'high' : 'pixel';
    DL.imageOps.resize(app, w, h, smooth);
  });
};
DL.menuDialogs.canvasSize = function (app) {
  var d = app.doc;
  DL.dialog({
    title: '画布大小',
    html:
      '<div class="opt-note">当前：<b>' + d.width + ' × ' + d.height + '</b> 像素</div>' +
      '<div class="field"><label>宽度</label><input type="number" id="cs-w" min="1" max="8000" value="' + d.width + '"></div>' +
      '<div class="field"><label>高度</label><input type="number" id="cs-h" min="1" max="8000" value="' + d.height + '"></div>' +
      '<div class="sect-title">定位（原图放在新画布的位置）</div>' +
      '<div class="anchor-grid" id="cs-anchor">' +
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
        return '<button class="btn' + (i === 4 ? ' on' : '') + '" data-a="' + i + '"></button>';
      }).join('') + '</div>',
    actions: [{ label: '取消', value: null }, { label: '确定', value: 'ok', primary: true }],
    onMount: function (root) {
      var anchor = 4;
      root.querySelectorAll('#cs-anchor .btn').forEach(function (b) {
        b.addEventListener('click', function () {
          anchor = parseInt(b.dataset.a, 10);
          root.querySelectorAll('#cs-anchor .btn').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        });
      });
      root._anchor = function () { return anchor; };
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var w = DL.clamp(parseInt(r.root.querySelector('#cs-w').value, 10) || d.width, 1, 8000);
    var h = DL.clamp(parseInt(r.root.querySelector('#cs-h').value, 10) || d.height, 1, 8000);
    DL.imageOps.canvasSize(app, w, h, r.root._anchor());
  });
};
DL.menuDialogs.rotateAngle = function (app) {
  DL.dialog({
    title: '旋转画布（任意角度）',
    html:
      '<div class="field"><label>角度</label><input type="range" id="ra-a" min="-180" max="180" value="15"><span class="val" id="ra-v">15°</span></div>' +
      '<div class="field"><label>背景</label><select id="ra-bg">' +
      '<option value="transparent">透明</option><option value="#ffffff">白色</option><option value="#000000">黑色</option>' +
      '<option value="__fg">前景色</option><option value="__bg">背景色</option></select></div>' +
      '<div class="checks"><label><input type="checkbox" id="ra-exp" checked> 自动扩展画布（不裁掉四角）</label></div>' +
      '<div class="opt-note">负值逆时针、正值顺时针。</div>',
    actions: [{ label: '取消', value: null }, { label: '旋转', value: 'ok', primary: true }],
    onMount: function (root) {
      var a = root.querySelector('#ra-a');
      a.addEventListener('input', function () { root.querySelector('#ra-v').textContent = a.value + '°'; });
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var ang = parseFloat(r.root.querySelector('#ra-a').value) || 0;
    var bg = r.root.querySelector('#ra-bg').value;
    if (bg === '__fg') bg = app.fg();
    if (bg === '__bg') bg = app.settings.bgColor;
    var exp = r.root.querySelector('#ra-exp').checked;
    DL.imageOps.rotateAngle(app, ang, bg, exp);
  });
};
DL.menuDialogs.fill = function (app) {
  DL.dialog({
    title: '填充',
    html:
      '<div class="field"><label>内容</label><select id="fl-src">' +
      '<option value="__fg">前景色</option><option value="__bg">背景色</option>' +
      '<option value="custom">指定颜色</option><option value="#ffffff">白色</option>' +
      '<option value="#000000">黑色</option><option value="#808080">50% 灰</option>' +
      '<option value="transparent">透明（擦除）</option></select></div>' +
      '<div class="field"><label>颜色</label><input type="color" id="fl-color" value="#5b8cff"></div>' +
      '<div class="field"><label>混合</label><select id="fl-mode">' +
      '<option value="source-over">正常</option><option value="multiply">正片叠底</option>' +
      '<option value="screen">滤色</option><option value="overlay">叠加</option>' +
      '<option value="soft-light">柔光</option><option value="color">颜色</option></select></div>' +
      '<div class="field"><label>不透明度</label><input type="range" id="fl-op" min="1" max="100" value="100"><span class="val" id="fl-op-v">100%</span></div>' +
      '<div class="checks"><label><input type="checkbox" id="fl-keep"> 保留透明区域</label></div>' +
      (app.selection ? '<div class="opt-note">填充只作用于当前选区。</div>' : '') ,
    actions: [{ label: '取消', value: null }, { label: '填充', value: 'ok', primary: true }],
    onMount: function (root) {
      var op = root.querySelector('#fl-op');
      op.addEventListener('input', function () { root.querySelector('#fl-op-v').textContent = op.value + '%'; });
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var src = r.root.querySelector('#fl-src').value;
    var color = src === '__fg' ? app.fg() : (src === '__bg' ? app.settings.bgColor : (src === 'custom' ? r.root.querySelector('#fl-color').value : src));
    DL.fillOps.fill(app, {
      color: color,
      mode: r.root.querySelector('#fl-mode').value,
      opacity: parseFloat(r.root.querySelector('#fl-op').value),
      preserveAlpha: r.root.querySelector('#fl-keep').checked
    });
  });
};
DL.menuDialogs.stroke = function (app) {
  DL.dialog({
    title: '描边',
    html:
      '<div class="field"><label>宽度</label><input type="range" id="st-w" min="1" max="60" value="3"><span class="val" id="st-w-v">3px</span></div>' +
      '<div class="field"><label>颜色</label><input type="color" id="st-color" value="' + app.fg() + '"></div>' +
      '<div class="field"><label>位置</label><select id="st-pos">' +
      '<option value="center">居中</option><option value="inside">内部</option><option value="outside">外部</option></select></div>' +
      '<div class="field"><label>不透明度</label><input type="range" id="st-op" min="1" max="100" value="100"><span class="val" id="st-op-v">100%</span></div>' +
      '<div class="field"><label>混合</label><select id="st-mode">' +
      '<option value="source-over">正常</option><option value="multiply">正片叠底</option><option value="screen">滤色</option><option value="overlay">叠加</option></select></div>' +
      '<div class="opt-note">' + (app.selection ? '沿选区边缘描边。' : '沿当前图层内容的边缘描边。') + '</div>',
    actions: [{ label: '取消', value: null }, { label: '描边', value: 'ok', primary: true }],
    onMount: function (root) {
      var w = root.querySelector('#st-w'), o = root.querySelector('#st-op');
      w.addEventListener('input', function () { root.querySelector('#st-w-v').textContent = w.value + 'px'; });
      o.addEventListener('input', function () { root.querySelector('#st-op-v').textContent = o.value + '%'; });
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    DL.fillOps.stroke(app, {
      width: parseFloat(r.root.querySelector('#st-w').value),
      color: r.root.querySelector('#st-color').value,
      position: r.root.querySelector('#st-pos').value,
      opacity: parseFloat(r.root.querySelector('#st-op').value),
      mode: r.root.querySelector('#st-mode').value
    });
  });
};
function simpleNumberDialog(app, title, label, def, min, max, hint, fn) {
  DL.dialog({
    title: title,
    html: '<div class="field"><label>' + label + '</label><input type="number" id="nd-v" min="' + min + '" max="' + max + '" value="' + def + '"><span class="opt-note">像素</span></div>' +
      '<div class="opt-note">' + hint + '</div>',
    actions: [{ label: '取消', value: null }, { label: '确定', value: 'ok', primary: true }]
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var v = DL.clamp(parseFloat(r.root.querySelector('#nd-v').value) || def, min, max);
    fn(v);
  });
}
DL.menuDialogs.feather = function (app) {
  simpleNumberDialog(app, '羽化选区', '半径', 2, 1, 250, '边缘会变成柔和过渡，配合填充 / 滤镜可做渐隐效果。', function (v) {
    DL.selectOps.feather(app, v);
  });
};
DL.menuDialogs.expand = function (app) {
  simpleNumberDialog(app, '扩展选区', '像素', 4, 1, 200, '按像素数向外扩张选区边界。', function (v) { DL.selectOps.expand(app, v); });
};
DL.menuDialogs.contract = function (app) {
  simpleNumberDialog(app, '收缩选区', '像素', 4, 1, 200, '按像素数向内收缩选区边界。', function (v) { DL.selectOps.contract(app, v); });
};
DL.menuDialogs.smooth = function (app) {
  simpleNumberDialog(app, '平滑选区', '取样半径', 4, 1, 100, '抹掉选区边缘的锯齿与毛刺。', function (v) { DL.selectOps.smooth(app, v); });
};
DL.menuDialogs.border = function (app) {
  simpleNumberDialog(app, '选区边框', '宽度', 4, 1, 100, '把选区变成一个指定宽度的环形边框。', function (v) { DL.selectOps.border(app, v); });
};
DL.menuDialogs.colorRange = function (app) {
  DL.dialog({
    title: '色彩范围',
    html:
      '<div class="opt-note">选择画面中与指定颜色相近的像素。</div>' +
      '<div class="field"><label>颜色</label><input type="color" id="cr-color" value="' + app.fg() + '"></div>' +
      '<div class="field"><label>容差</label><input type="range" id="cr-tol" min="1" max="200" value="40"><span class="val" id="cr-tol-v">40</span></div>' +
      '<div class="field"><label>取样</label><select id="cr-from"><option value="merged">所有可见图层</option><option value="active">当前图层</option></select></div>' +
      '<div class="checks"><label><input type="checkbox" id="cr-usepick"> 先点画面取色（点确定前先在画布上单击）</label></div>',
    actions: [{ label: '取消', value: null }, { label: '确定', value: 'ok', primary: true }],
    onMount: function (root) {
      var tol = root.querySelector('#cr-tol');
      tol.addEventListener('input', function () { root.querySelector('#cr-tol-v').textContent = tol.value; });
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    DL.selectOps.colorRange(app, {
      color: r.root.querySelector('#cr-color').value,
      tolerance: parseFloat(r.root.querySelector('#cr-tol').value),
      from: r.root.querySelector('#cr-from').value
    });
  });
};
DL.menuDialogs.preferences = function (app) {
  DL.dialog({
    title: '首选项',
    html:
      '<div class="field"><label>撤销步数</label><input type="range" id="pf-h" min="10" max="200" value="' + app.history.limit + '"><span class="val" id="pf-h-v">' + app.history.limit + '</span></div>' +
      '<div class="checks">' +
      '<label><input type="checkbox" id="pf-grid"' + (app.ui.gridOn ? ' checked' : '') + '> 显示网格</label>' +
      '<label><input type="checkbox" id="pf-hint" checked> 显示画布左下角操作提示</label>' +
      '</div>' +
      '<div class="opt-note">插件管理在右侧面板的「滤镜插件」里。</div>',
    actions: [{ label: '取消', value: null }, { label: '保存', value: 'ok', primary: true }],
    onMount: function (root) {
      var h = root.querySelector('#pf-h');
      h.addEventListener('input', function () { root.querySelector('#pf-h-v').textContent = h.value; });
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    app.history.limit = parseInt(r.root.querySelector('#pf-h').value, 10);
    app.ui.gridOn = r.root.querySelector('#pf-grid').checked;
    $('chk-grid').checked = app.ui.gridOn;
    app.ui.hint.style.display = r.root.querySelector('#pf-hint').checked ? '' : 'none';
    app.requestRender();
    app.status('首选项已保存');
  });
};

/* ------------------------------------------------------------
 * 历史记录面板
 * ---------------------------------------------------------- */
DL.menu = DL.menu || {};
DL.menu.refreshHistory = function (app) {
  var box = $('history-list');
  if (!box) return;
  var h = app.history;
  var html = '<div class="hist-item init' + (h.index < 0 ? ' on' : '') + '" data-i="-1">打开 / 新建</div>';
  for (var i = 0; i < h.stack.length; i++) {
    var cls = 'hist-item' + (i > h.index ? ' undone' : '') + (i === h.index ? ' on' : '');
    html += '<div class="' + cls + '" data-i="' + i + '">' + esc(h.stack[i].label || '操作') + '</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('.hist-item').forEach(function (el) {
    el.addEventListener('click', function () {
      var t = parseInt(el.dataset.i, 10);
      if (app.stroke.active) return;
      if (h.jump(t)) {
        app.invalidate();
        app.ui.refreshLayers();
        app.ui.updateUndo();
        app.requestRender();
        DL.menu.refreshHistory(app);
        app.status(t < 0 ? '已回到初始状态' : '已跳转到：' + h.stack[t].label);
      }
    });
  });
  var on = box.querySelector('.hist-item.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
};

/* ------------------------------------------------------------
 * 菜单定义
 * ---------------------------------------------------------- */
function fxSubmenu(kind) {
  var names = DL.filters.groupNames(kind === 'adjust' ? null : 'filter');
  var subs = [];
  names.forEach(function (g) {
    if (kind === 'adjust' && g.indexOf('调整') < 0) return;
    if (kind === 'filter' && g.indexOf('调整') >= 0) return;
    var items = DL.filters.inGroup(null, g).map(function (d) {
      return { label: d.name, run: function (app) { DL.filters.applyDialog(app, d.id); } };
    });
    if (items.length) subs.push({ label: g, sub: items });
  });
  return subs;
}

DL.menu.definitions = function (app) {
  var pluginItems = (DL.plugins.menuItems || []).slice().sort(function (a, b) { return a.order - b.order; });
  var pluginFilterItems = pluginItems.filter(function (i) { return i.menu === 'filter'; });
  var pluginEditItems = pluginItems.filter(function (i) { return i.menu === 'edit'; });
  var pluginViewItems = pluginItems.filter(function (i) { return i.menu === 'view'; });

  return [
    {
      id: 'file', label: '文件', items: [
        { label: '新建…', key: 'Ctrl+N', run: function (a) { a.newDocument(); } },
        { label: '打开图片…', key: 'Ctrl+O', run: function (a) { $('file-input').click(); } },
        { label: '复制当前文档', run: function (a) { DL.imageOps.duplicate(a); } },
        { sep: true },
        { label: '导出 PNG…', key: 'Ctrl+S', run: function (a) { a.savePNG(); } },
        { sep: true },
        { label: '关闭（清空历史并重置视图）', run: function (a) { a.renderer.fit(); a.status('已重置视图'); } }
      ]
    },
    {
      id: 'edit', label: '编辑', items: [
        { label: '上一步', key: 'Ctrl+Z', run: function (a) { a.ui.undo(); } },
        { label: '下一步', key: 'Ctrl+Shift+Z', run: function (a) { a.ui.redo(); } },
        { sep: true },
        { label: '剪切', key: 'Ctrl+X', run: function (a) { copyRegion(a, true); } },
        { label: '复制', key: 'Ctrl+C', run: function (a) { copyRegion(a, false); } },
        { label: '粘贴', key: 'Ctrl+V', run: function (a) { DL.menuOps.paste(a, false); } },
        { label: '粘贴到新图层', key: 'Ctrl+Shift+V', run: function (a) { DL.menuOps.paste(a, true); } },
        { sep: true },
        { label: '填充…', key: 'Shift+F5', run: function (a) { DL.menuDialogs.fill(a); } },
        { label: '描边…', run: function (a) { DL.menuDialogs.stroke(a); } },
        { label: '清空当前图层', key: 'Delete', run: function (a) { a.ui.clearLayer(); } },
        { sep: true },
        { label: '变换', sub: [
          { label: '自由变换（工具）', key: 'Ctrl+T', run: function (a) { a.setTool('transform'); } },
          { sep: true },
          { label: '水平翻转图层', run: function (a) { DL.imageOps.flip(a, 'h', true); } },
          { label: '垂直翻转图层', run: function (a) { DL.imageOps.flip(a, 'v', true); } },
          { label: '顺时针旋转 90°（图层）', run: function (a) { DL.imageOps.rotateLayer90(a, 1); } },
          { label: '逆时针旋转 90°（图层）', run: function (a) { DL.imageOps.rotateLayer90(a, -1); } }
        ] },
        { sep: true },
        { label: '首选项…', key: 'Ctrl+K', run: function (a) { DL.menuDialogs.preferences(a); } }
      ].concat(pluginEditItems.length ? [{ sep: true }].concat(pluginEditItems.map(function (i) {
        return { label: i.label + (i.plugin ? '（插件）' : ''), key: i.key, run: i.run };
      })) : [])
    },
    {
      id: 'image', label: '图像', items: [
        { label: '图像大小…', key: 'Ctrl+Alt+I', run: function (a) { DL.menuDialogs.imageSize(a); } },
        { label: '画布大小…', key: 'Ctrl+Alt+C', run: function (a) { DL.menuDialogs.canvasSize(a); } },
        { sep: true },
        { label: '图像旋转', sub: [
          { label: '顺时针 90°', run: function (a) { DL.imageOps.rotate90(a, 1); } },
          { label: '逆时针 90°', run: function (a) { DL.imageOps.rotate90(a, -1); } },
          { label: '180°', run: function (a) { DL.imageOps.rotate90(a, 0); } },
          { sep: true },
          { label: '任意角度…', run: function (a) { DL.menuDialogs.rotateAngle(a); } },
          { sep: true },
          { label: '水平翻转画布', run: function (a) { DL.imageOps.flip(a, 'h', false); } },
          { label: '垂直翻转画布', run: function (a) { DL.imageOps.flip(a, 'v', false); } }
        ] },
        { label: '裁切透明边', run: function (a) { DL.imageOps.trim(a); } },
        { label: '拼合图像', run: function (a) { DL.imageOps.flatten(a); } },
        { sep: true },
        { label: '自动色调', run: function (a) { DL.filters.applyDialog(a, 'auto-tone'); } },
        { label: '自动对比度', run: function (a) { DL.filters.applyDialog(a, 'auto-contrast'); } },
        { label: '自动颜色', run: function (a) { DL.filters.applyDialog(a, 'auto-color'); } },
        { sep: true },
        { label: '调整', sub: fxSubmenu('adjust') },
        { sep: true },
        { label: '去色', key: 'Ctrl+Shift+U', run: function (a) { DL.filters.applyDialog(a, 'desaturate'); } },
        { label: '反相', key: 'Ctrl+I', run: function (a) { DL.filters.applyDialog(a, 'invert'); } },
        { label: '色调分离…', run: function (a) { DL.filters.applyDialog(a, 'posterize'); } },
        { label: '阈值…', run: function (a) { DL.filters.applyDialog(a, 'threshold'); } }
      ]
    },
    {
      id: 'layer', label: '图层', items: [
        { label: '新建图层', key: 'Ctrl+Shift+N', run: function (a) { a.snapshotOp('新建图层', function () { a.doc.addLayer(); }); } },
        { label: '复制图层', key: 'Ctrl+J', run: function (a) { a.ui.duplicateLayer(); } },
        { label: '删除图层', run: function (a) { a.ui.deleteLayer(); } },
        { sep: true },
        { label: '上移一层', key: 'Ctrl+]', run: function (a) { a.ui.moveLayer(1); } },
        { label: '下移一层', key: 'Ctrl+[', run: function (a) { a.ui.moveLayer(-1); } },
        { label: '置于顶层', run: function (a) { a.ui.moveLayerToEdge(true); } },
        { label: '置于底层', run: function (a) { a.ui.moveLayerToEdge(false); } },
        { sep: true },
        { label: '向下合并', key: 'Ctrl+E', run: function (a) { a.ui.mergeDown(); } },
        { label: '合并可见图层', key: 'Ctrl+Shift+E', run: function (a) { a.ui.mergeVisible(); } },
        { label: '拼合图像', run: function (a) { DL.imageOps.flatten(a); } },
        { sep: true },
        { label: '按颜色分层…', run: function (a) { a.ui.splitColorDialog(); } },
        { sep: true },
        { label: '图层内容转为选区', run: function (a) { a.ui.layerToSelection(); } },
        { label: '选区内容转为图层', key: 'Ctrl+Shift+J', run: function (a) { a.selectionToLayer(false); } }
      ]
    },
    {
      id: 'select', label: '选择', items: [
        { label: '全选', key: 'Ctrl+A', run: function (a) { DL.selectOps.save(a); DL.selectOps.all(a); } },
        { label: '取消选择', key: 'Ctrl+D', run: function (a) { DL.selectOps.save(a); a.clearSelection(); } },
        { label: '重新选择', key: 'Ctrl+Shift+D', run: function (a) { DL.selectOps.reselect(a); } },
        { label: '反选', key: 'Ctrl+Shift+I', run: function (a) { a.invertSelection(); } },
        { sep: true },
        { label: '色彩范围…', run: function (a) { DL.menuDialogs.colorRange(a); } },
        { sep: true },
        { label: '羽化…', key: 'Shift+F6', run: function (a) { DL.menuDialogs.feather(a); } },
        { label: '扩展…', run: function (a) { DL.menuDialogs.expand(a); } },
        { label: '收缩…', run: function (a) { DL.menuDialogs.contract(a); } },
        { label: '平滑…', run: function (a) { DL.menuDialogs.smooth(a); } },
        { label: '边框…', run: function (a) { DL.menuDialogs.border(a); } },
        { sep: true },
        { label: '删除选区内容', run: function (a) { a.deleteSelection(); } },
        { label: '用前景色填充选区', run: function (a) { a.fillSelection(); } },
        { label: '裁剪到选区', run: function (a) { a.cropToSelection(); } }
      ]
    },
    {
      id: 'filter', label: '滤镜', items: [
        { label: '重复上次滤镜', key: 'Ctrl+F', run: function (a) { DL.filters.repeatLast(a); }, disabled: function () { return !DL.filters.last; } },
        { label: '滤镜库…', key: 'Ctrl+Shift+F', run: function (a) { DL.filters.gallery(a, { kind: 'filter' }).then(applyFromGallery(a)); } },
        { sep: true }
      ].concat(fxSubmenu('filter')).concat(pluginFilterItems.length ? [{ sep: true }].concat(pluginFilterItems.map(function (i) {
        return { label: i.label + '（插件）', key: i.key, run: i.run };
      })) : [])
    },
    {
      id: 'adjust', label: '调整', items: fxSubmenu('adjust')
    },
    {
      id: 'view', label: '视图', items: [
        { label: '放大', key: 'Ctrl++', run: function (a) { a.renderer.zoomAt(1.25, a.renderer.vw / 2, a.renderer.vh / 2); } },
        { label: '缩小', key: 'Ctrl+-', run: function (a) { a.renderer.zoomAt(1 / 1.25, a.renderer.vw / 2, a.renderer.vh / 2); } },
        { label: '实际像素（100%）', key: 'Ctrl+1', run: function (a) { a.renderer.setZoom(1); } },
        { label: '适合窗口', key: 'Ctrl+0', run: function (a) { a.renderer.fit(); } },
        { sep: true },
        { label: '显示网格', checked: function (a) { return a.ui.gridOn; }, run: function (a) { a.ui.toggleGrid(); } },
        { label: '彩色棋盘背景', checked: function (a) { return a.ui.checkerColor; }, run: function (a) { a.ui.toggleChecker(); } },
        { sep: true },
        { label: '显示 / 隐藏工具栏', checked: function (a) { return a.ui.toolbarVisible; }, run: function (a) { a.ui.toggleToolbar(); } },
        { label: '显示 / 隐藏右侧面板', checked: function (a) { return a.ui.panelsVisible; }, run: function (a) { a.ui.togglePanels(); } },
        { label: '显示 / 隐藏历史记录', checked: function (a) { return a.ui.historyVisible; }, run: function (a) { a.ui.toggleHistory(); } }
      ].concat(pluginViewItems.length ? [{ sep: true }].concat(pluginViewItems.map(function (i) {
        return { label: i.label + '（插件）', run: i.run };
      })) : [])
    },
    {
      id: 'window', label: '窗口', items: [
        { label: '历史记录', checked: function (a) { return a.ui.historyVisible; }, run: function (a) { a.ui.toggleHistory(); } },
        { label: '滤镜插件', checked: function (a) { return a.ui.pluginVisible; }, run: function (a) { a.ui.togglePluginPanel(); } },
        { sep: true },
        { label: '滤镜库…', run: function (a) { DL.filters.gallery(a).then(applyFromGallery(a)); } },
        { label: '插件管理器…', run: function (a) { a.ui.openPluginManager(); } }
      ]
    },
    {
      id: 'help', label: '帮助', items: [
        { label: '快捷键一览', run: function (a) { a.ui.showShortcuts(); } },
        { label: '插件开发指南', run: function (a) { a.ui.showPluginGuide(); } },
        { sep: true },
        { label: '关于 DrawLib', run: function (a) { a.ui.showAbout(); } }
      ]
    }
  ];
};

function applyFromGallery(app) {
  return function (res) {
    if (!res) return;
    if (DL.filters.run(app, res.def, res.params)) {
      DL.filters.remember(res.def, res.params);
      DL.filters.saveParams(res.def, res.params);
      app.status('已应用：' + res.def.name);
    }
  };
}

/* ------------------------------------------------------------
 * 菜单栏 DOM
 * ---------------------------------------------------------- */
var openMenu = null;
DL.menu._open = function () { return openMenu; };

DL.menu.build = function (app) {
  var bar = $('menubar');
  if (!bar) return;
  var defs = DL.menu.definitions(app);
  bar.innerHTML = defs.map(function (m) {
    return '<div class="menu-root" data-id="' + m.id + '">' +
      '<button class="menu-label">' + esc(m.label) + '</button>' +
      '<div class="menu-drop" hidden></div></div>';
  }).join('');

  function renderDrop(root, m) {
    var drop = root.querySelector('.menu-drop');
    var html = '';
    m.items.forEach(function (it, idx) {
      if (it.sep) { html += '<div class="menu-sep"></div>'; return; }
      var dis = it.disabled && it.disabled(app);
      var chk = it.checked ? it.checked(app) : null;
      html += '<div class="menu-item' + (dis ? ' disabled' : '') + (it.sub ? ' has-sub' : '') + '" data-i="' + idx + '">' +
        '<span class="mi-chk">' + (chk ? '✓' : '') + '</span>' +
        '<span class="mi-label">' + esc(it.label) + '</span>' +
        (it.key ? '<span class="mi-key">' + esc(it.key) + '</span>' : '') +
        (it.sub ? '<span class="mi-arrow">›</span>' : '') + '</div>';
    });
    drop.innerHTML = html;
    drop.querySelectorAll('.menu-item').forEach(function (el) {
      var it = m.items[parseInt(el.dataset.i, 10)];
      if (it.sub) {
        el.addEventListener('mouseenter', function () {
          var sub = drop.querySelector('.menu-sub[data-i="' + el.dataset.i + '"]');
          if (sub) return;
          var s = document.createElement('div');
          s.className = 'menu-sub';
          s.dataset.i = el.dataset.i;
          s.innerHTML = it.sub.map(function (si) {
            if (si.sep) return '<div class="menu-sep"></div>';
            return '<div class="menu-item" data-s="' + esc(si.label) + '"><span class="mi-chk"></span>' +
              '<span class="mi-label">' + esc(si.label) + '</span>' +
              (si.key ? '<span class="mi-key">' + esc(si.key) + '</span>' : '') + '</div>';
          }).join('');
          s.querySelectorAll('.menu-item').forEach(function (se) {
            se.addEventListener('click', function (e) {
              e.stopPropagation();
              var target = null;
              it.sub.forEach(function (si) { if (si.label === se.dataset.s) target = si; });
              closeAll();
              if (target && target.run) target.run(app);
            });
          });
          el.appendChild(s);
        });
        return;
      }
      el.addEventListener('click', function () {
        if (el.classList.contains('disabled')) return;
        closeAll();
        if (it.run) it.run(app);
      });
    });
    /* 切换菜单时清理子菜单 */
    drop.addEventListener('mouseleave', function () {
      drop.querySelectorAll('.menu-sub').forEach(function (s) { s.remove(); });
    });
  }

  defs.forEach(function (m) {
    var root = bar.querySelector('.menu-root[data-id="' + m.id + '"]');
    var label = root.querySelector('.menu-label');
    label.addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu === root) { closeAll(); return; }
      closeAll();
      renderDrop(root, m);
      root.querySelector('.menu-drop').hidden = false;
      label.classList.add('open');
      openMenu = root;
    });
    label.addEventListener('mouseenter', function () {
      if (openMenu && openMenu !== root) {
        closeAll();
        renderDrop(root, m);
        root.querySelector('.menu-drop').hidden = false;
        label.classList.add('open');
        openMenu = root;
      }
    });
  });

  function closeAll() {
    bar.querySelectorAll('.menu-drop').forEach(function (d) { d.hidden = true; });
    bar.querySelectorAll('.menu-label').forEach(function (l) { l.classList.remove('open'); });
    bar.querySelectorAll('.menu-sub').forEach(function (s) { s.remove(); });
    openMenu = null;
  }
  DL.menu.close = closeAll;
  document.addEventListener('click', function () { if (openMenu) closeAll(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMenu) closeAll(); });
};

DL.menu.refreshItems = function () {
  /* 打开状态下刷新勾选/禁用状态 */
  if (openMenu) {
    var id = openMenu.dataset.id;
    if (id === 'edit') { /* 剪贴板变化影响启用状态，重绘即可 */ }
  }
};

/* ------------------------------------------------------------
 * 最近使用的滤镜（首屏欢迎面板用）
 * ---------------------------------------------------------- */
DL.menu.recentFilters = function () {
  var out = [];
  try {
    var s = global.localStorage.getItem('drawlib.fx.last');
    if (s) {
      var j = JSON.parse(s);
      var d = DL.filters.get(j.id);
      if (d) out.push(d);
    }
  } catch (e) { }
  return out;
};
})(window);

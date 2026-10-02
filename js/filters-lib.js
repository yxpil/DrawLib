/* ============================================================
 * DrawLib · filters-lib.js
 * 内置滤镜库（PS 风格分类）
 *   模糊 / 锐化 / 杂色 / 像素化 / 扭曲 / 风格化 / 素描 /
 *   艺术效果 / 画笔描边 / 纹理 / 渲染 / 视频 / 其他
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;
var FX = DL.fx;
var PI2 = Math.PI * 2;

/* ------------------------------------------------------------
 * 参数与注册简写
 * ---------------------------------------------------------- */
function F(def) { DL.filters.register(def); }
function R(key, label, min, max, def, step, unit) {
  return { key: key, label: label, type: 'range', min: min, max: max, def: def, step: step == null ? 1 : step, unit: unit || '' };
}
function S(key, label, options, def) { return { key: key, label: label, type: 'select', options: options, def: def }; }
function C(key, label, def) { return { key: key, label: label, type: 'check', def: !!def }; }
function CO(key, label, def) { return { key: key, label: label, type: 'color', def: def }; }
function AN(key, label, def) { return { key: key, label: label, type: 'angle', def: def }; }
function SEED() { return R('seed', '随机种子', 1, 9999, 7, 1); }

var clamp = FX.clamp, c255 = FX.clamp255, gray = FX.grayOf, mixv = FX.mix;
/* 颜色参数可能是 '#rrggbb' 字符串，统一成 {r,g,b} */
FX.rgb = function (c) {
  if (!c) return { r: 0, g: 0, b: 0 };
  if (typeof c === 'string') return DL.hexToRgb(c) || { r: 0, g: 0, b: 0 };
  return c;
};

/* ------------------------------------------------------------
 * 通用像素助手（挂在 DL.fx 上，插件同样可用）
 * ---------------------------------------------------------- */
FX.toGray = function (d) {
  for (var i = 0; i < d.length; i += 4) {
    var g = gray(d[i], d[i + 1], d[i + 2]);
    d[i] = g; d[i + 1] = g; d[i + 2] = g;
  }
  return d;
};
FX.grayField = function (d, w, h) {
  var n = w * h, G = new Float32Array(n);
  for (var i = 0; i < n; i++) { var o = i << 2; G[i] = gray(d[o], d[o + 1], d[o + 2]); }
  return G;
};
FX.posterize = function (d, levels) {
  levels = Math.max(2, Math.round(levels));
  var step = 255 / (levels - 1);
  for (var i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] / step) * step;
    d[i + 1] = Math.round(d[i + 1] / step) * step;
    d[i + 2] = Math.round(d[i + 2] / step) * step;
  }
  return d;
};
FX.thresholdData = function (d, t, soft) {
  for (var i = 0; i < d.length; i += 4) {
    var v = gray(d[i], d[i + 1], d[i + 2]);
    if (soft > 0) v = clamp((v - t) / soft + 0.5, 0, 1) * 255;
    else v = v > t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return d;
};
FX.contrastData = function (d, amount) {
  for (var i = 0; i < d.length; i += 4) {
    for (var c = 0; c < 3; c++) d[i + c] = c255((d[i + c] - 128) * amount + 128);
  }
  return d;
};
/* 沿任意路径多次采样求平均（alpha 正确），用于动感模糊 / 径向模糊 / 波纹等 */
FX.traceAverage = function (env, count, fn) {
  var src = env.read(), w = env.w, h = env.h;
  var out = new Uint8ClampedArray(src.length);
  var t = [0, 0, 0, 0];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var R = 0, G = 0, B = 0, A = 0, used = 0;
      for (var k = 0; k < count; k++) {
        var xy = fn(x, y, k);
        if (!xy) continue;
        FX.sample(src, w, h, xy[0], xy[1], t);
        var a = t[3] / 255;
        R += t[0] * a; G += t[1] * a; B += t[2] * a; A += a; used++;
      }
      var o = (y * w + x) << 2;
      if (used && A > 0.004) {
        out[o] = R / A; out[o + 1] = G / A; out[o + 2] = B / A; out[o + 3] = A / used * 255;
      }
    }
  }
  env.write(out);
};
/* 用灰度场给画面上色：0 → 背景色，1 → 前景色 */
FX.tintByLuma = function (env, field, fg, bg, gamma) {
  var w = env.w;
  fg = FX.rgb(fg); bg = FX.rgb(bg);
  var d = env.read();
  var fr = fg.r, fgg = fg.g, fb = fg.b, br = bg.r, bgc = bg.g, bb = bg.b;
  for (var i = 0, n = w * env.h; i < n; i++) {
    var v = clamp(field[i] / 255, 0, 1);
    if (gamma && gamma !== 1) v = Math.pow(v, gamma);
    var o = i << 2;
    d[o] = br + (fr - br) * v;
    d[o + 1] = bgc + (fgg - bgc) * v;
    d[o + 2] = bb + (fb - bb) * v;
  }
  return d;
};
/* 灰度场工具：模糊 / 颗粒 / 边缘混合 / 反相 / 对比，素描与艺术效果共用 */
FX.toneField = function (env, o) {
  o = o || {};
  var w = env.w, h = env.h;
  var d = new Uint8ClampedArray(env.read());
  if (o.blur) FX.gaussBlur(d, w, h, o.blur);
  if (o.grain) FX.addNoise(d, w, h, o.grain, true, false, o.seed == null ? 7 : o.seed);
  var f = FX.grayField(d, w, h), i;
  if (o.edge) {
    var e = FX.edges(d, w, h);
    for (i = 0; i < f.length; i++) f[i] = clamp(f[i] * (1 - o.edge) + (255 - e[i]) * o.edge, 0, 255);
  }
  if (o.invert) for (i = 0; i < f.length; i++) f[i] = 255 - f[i];
  if (o.contrast && o.contrast !== 1) for (i = 0; i < f.length; i++) f[i] = clamp((f[i] - 128) * o.contrast + 128, 0, 255);
  if (o.bias) for (i = 0; i < f.length; i++) f[i] = clamp(f[i] + o.bias, 0, 255);
  if (o.texture) {
    var T = FX.textureField(o.texture, w, h, o.texScale || 8, o.texSeed || 5);
    for (i = 0; i < f.length; i++) f[i] = clamp(f[i] * (1 - 0.45) + (T[i] * 255) * 0.45, 0, 255);
  }
  return f;
};
/* 噪点（保持亮度大致不变） */
FX.addNoise = function (d, w, h, amount, mono, gaussian, seed) {
  var rnd = FX.mulberry32(seed || 3);
  var amt = amount * 2.55;
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (mono) {
      var n = (rnd() - 0.5) * 2;
      if (gaussian) n = (n + (rnd() - 0.5) * 2 + (rnd() - 0.5) * 2) / 1.8;
      var v = n * amt;
      d[i] = c255(d[i] + v); d[i + 1] = c255(d[i + 1] + v); d[i + 2] = c255(d[i + 2] + v);
    } else {
      for (var c = 0; c < 3; c++) {
        var n2 = (rnd() - 0.5) * 2;
        if (gaussian) n2 = (n2 + (rnd() - 0.5) * 2 + (rnd() - 0.5) * 2) / 1.8;
        d[i + c] = c255(d[i + c] + n2 * amt);
      }
    }
  }
  return d;
};
/* 程序化纹理场（用于纹理化 / 龟裂 / 纤维） */
FX.textureField = function (type, w, h, scale, seed) {
  var nf = FX.noise2(seed || 5);
  var out = new Float32Array(w * h);
  var s = Math.max(1, scale), i, x, y;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      var v;
      if (type === 'brick') {
        var bw = s * 2, bh = s;
        var row = Math.floor(y / bh);
        var ox = (row % 2) * bw / 2;
        var lx = ((x + ox) % bw) / bw, ly = (y % bh) / bh;
        var edge = Math.min(lx, 1 - lx, ly, 1 - ly) * Math.min(bw, bh) * 0.5;
        v = clamp(edge / 1.6, 0, 1) * 0.7 + nf(x / s * 0.5, y / s * 0.5) * 0.3;
      } else if (type === 'burlap') {
        var a = Math.abs(Math.sin(x / s * Math.PI)), b = Math.abs(Math.sin(y / s * Math.PI));
        v = Math.max(a, b) * 0.6 + nf(x / s, y / s) * 0.4;
      } else if (type === 'canvas') {
        var a2 = Math.abs(Math.sin(x / s * Math.PI));
        var b2 = Math.abs(Math.sin(y / s * Math.PI));
        v = 0.5 + 0.25 * (a2 + b2 - 1) + (nf(x / s * 2, y / s * 2) - 0.5) * 0.35;
      } else if (type === 'sandstone') {
        v = FX.fbm(nf, x / s, y / s, 5, 0.55);
      } else if (type === 'grain') {
        v = nf(x / s * 6, y / s * 6);
      } else {
        v = FX.fbm(nf, x / s, y / s, 4, 0.5);
      }
      out[y * w + x] = clamp(v, 0, 1);
    }
  }
  return out;
};
/* 龟裂纹理场 */
FX.crackField = function (w, h, spacing, depth, seed) {
  var nf = FX.noise2(seed || 11);
  var out = new Float32Array(w * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var v = FX.fbm(nf, x / spacing, y / spacing, 3, 0.55);
      var e = Math.abs(v - 0.5);
      out[y * w + x] = clamp(1 - e * 2 * (0.4 + depth * 2), 0, 1);
    }
  }
  return out;
};
/* Voronoi 单元（晶格化 / 染色玻璃 / 点状化） */
FX.voronoi = function (w, h, cell, seed, withEdge) {
  var rnd = FX.mulberry32(seed || 9);
  var cw = Math.max(2, Math.round(cell)), ch = cw;
  var gw = Math.ceil(w / cw) + 2, gh = Math.ceil(h / ch) + 2;
  var px = new Float32Array(gw * gh), py = new Float32Array(gh * gw);
  var i, j;
  for (j = 0; j < gh; j++) {
    for (i = 0; i < gw; i++) {
      px[j * gw + i] = (i - 0.5) * cw + rnd() * cw;
      py[j * gw + i] = (j - 0.5) * ch + rnd() * ch;
    }
  }
  var idx = new Int32Array(w * h);
  var edge = withEdge ? new Float32Array(w * h) : null;
  var d1 = new Float32Array(w * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var gi = Math.floor(x / cw), gj = Math.floor(y / ch);
      var best = -1, bd = 1e18, bd2 = 1e18;
      for (var jj = gj; jj <= gj + 1; jj++) {
        for (var ii = gi; ii <= gi + 1; ii++) {
          var id = jj * gw + ii;
          var dx = px[id] - x, dy = py[id] - y;
          var dd = dx * dx + dy * dy;
          if (dd < bd) { bd2 = bd; bd = dd; best = id; }
          else if (dd < bd2) bd2 = dd;
        }
      }
      idx[y * w + x] = best;
      d1[y * w + x] = Math.sqrt(bd);
      if (edge) edge[y * w + x] = Math.sqrt(bd2) - Math.sqrt(bd);
    }
  }
  return { idx: idx, dist: d1, edge: edge, px: px, py: py, gw: gw };
};
/* 单元均值色 */
FX.cellAverage = function (d, w, h, idx, count) {
  var n = w * h, r = new Float32Array(count), g = new Float32Array(count), b = new Float32Array(count), c = new Float32Array(count);
  for (var i = 0; i < n; i++) {
    var id = idx[i], a = d[(i << 2) + 3] / 255;
    r[id] += d[i << 2] * a; g[id] += d[(i << 2) + 1] * a; b[id] += d[(i << 2) + 2] * a; c[id] += a;
  }
  for (var k = 0; k < count; k++) if (c[k] > 0.001) { r[k] /= c[k]; g[k] /= c[k]; b[k] /= c[k]; }
  return { r: r, g: g, b: b, a: c };
};

/* ============================================================
 * 模糊
 * ============================================================ */
F({
  id: 'gaussian-blur', name: '高斯模糊', group: '模糊', hint: '整体柔化；配合选区可做局部虚化',
  params: [R('radius', '半径', 0.5, 80, 4, 0.5, 'px')],
  pad: function (p) { return Math.ceil(p.radius * 2.4) + 2; },
  apply: function (env, p) { var d = env.read(); FX.gaussBlur(d, env.w, env.h, p.radius); env.write(d); }
});
F({
  id: 'box-blur', name: '方块模糊', group: '模糊', hint: '用盒式平均制造硬朗的虚化块面',
  params: [R('radius', '半径', 1, 60, 5, 1, 'px'), R('passes', '次数', 1, 4, 1, 1, '')],
  pad: function (p) { return Math.ceil(p.radius * p.passes) + 2; },
  apply: function (env, p) { var d = env.read(); FX.boxBlur(d, env.w, env.h, p.radius, p.passes); env.write(d); }
});
F({
  id: 'motion-blur', name: '动感模糊', group: '模糊', hint: '沿指定角度拖出速度感',
  params: [AN('angle', '角度', 0), R('distance', '距离', 2, 200, 30, 1, 'px')],
  pad: function (p) { return Math.ceil(p.distance / 2) + 2; },
  apply: function (env, p) {
    var a = FX.deg2rad(p.angle), dx = Math.cos(a), dy = Math.sin(a);
    var n = Math.max(3, Math.round(p.distance));
    FX.traceAverage(env, n, function (x, y, k) {
      var t = (k / (n - 1) - 0.5) * p.distance;
      return [x + dx * t, y + dy * t];
    });
  }
});
F({
  id: 'radial-blur', name: '径向模糊', group: '模糊', hint: '由中心向外辐射的速度感',
  params: [S('mode', '类型', [['spin', '旋转'], ['zoom', '缩放']], 'zoom'), R('amount', '数量', 2, 60, 12, 1, ''), R('quality', '品质', 4, 40, 14, 1, '')],
  apply: function (env, p) {
    var w = env.w, h = env.h, cx = w / 2, cy = h / 2;
    var rmax = Math.sqrt(cx * cx + cy * cy), n = Math.round(p.quality);
    var maxR = Math.max(1, rmax * 0.01 * 0 + 999);
    var spinAmt = FX.deg2rad(p.amount * (p.mode === 'spin' ? 1.2 : 0));
    var zoomAmt = p.amount * 0.01;
    FX.traceAverage(env, n, function (x, y, k) {
      var t = k / (n - 1) - 0.5;
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (p.mode === 'spin') {
        var ang = Math.atan2(dy, dx) + spinAmt * t;
        return [cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist];
      }
      var sc = 1 + zoomAmt * t * (dist / rmax + 0.25) * 2;
      return [cx + dx * sc, cy + dy * sc];
    });
  }
});
F({
  id: 'surface-blur', name: '表面模糊', group: '模糊', hint: '只模糊色差小的区域，保留边缘',
  params: [R('radius', '半径', 2, 30, 6, 1, 'px'), R('threshold', '阈值', 2, 80, 18, 1, '')],
  pad: function (p) { return p.radius + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var out = new Uint8ClampedArray(d.length);
    var r = Math.round(p.radius), thr = p.threshold * 2.55;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var cr = src[o], cg = src[o + 1], cb = src[o + 2];
        var R = 0, G = 0, B = 0, W = 0;
        for (var j = -r; j <= r; j += 1) {
          var sy = clamp(y + j, 0, h - 1);
          for (var i = -r; i <= r; i += 1) {
            var so = ((sy * w + clamp(x + i, 0, w - 1)) << 2);
            var dr = src[so] - cr, dg = src[so + 1] - cg, db = src[so + 2] - cb;
            var diff = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
            var wgt = diff >= thr ? 0 : 1 - diff / thr;
            R += src[so] * wgt; G += src[so + 1] * wgt; B += src[so + 2] * wgt; W += wgt;
          }
        }
        if (W > 0) { out[o] = R / W; out[o + 1] = G / W; out[o + 2] = B / W; out[o + 3] = src[o + 3]; }
        else { out[o] = cr; out[o + 1] = cg; out[o + 2] = cb; out[o + 3] = src[o + 3]; }
      }
    }
    env.write(out);
  }
});
F({
  id: 'lens-blur', name: '镜头模糊', group: '模糊', hint: '带高光扩散的景深虚化',
  params: [R('radius', '半径', 1, 60, 8, 1, 'px'), R('highlight', '高光增益', 0, 200, 60, 1, '%'), R('threshold', '高光阈值', 100, 255, 200, 1, '')],
  pad: function (p) { return Math.ceil(p.radius * 2.4) + 2; },
  apply: function (env, p) {
    var d = env.read();
    var glow = new Uint8ClampedArray(d);
    var w = env.w, h = env.h;
    for (var i = 0; i < glow.length; i += 4) {
      var l = gray(glow[i], glow[i + 1], glow[i + 2]);
      if (l < p.threshold) { glow[i] = 0; glow[i + 1] = 0; glow[i + 2] = 0; }
    }
    FX.gaussBlur(glow, w, h, p.radius * 0.9);
    FX.gaussBlur(d, w, h, p.radius);
    var k = p.highlight / 100;
    for (var i2 = 0; i2 < d.length; i2 += 4) {
      for (var c = 0; c < 3; c++) d[i2 + c] = c255(d[i2 + c] + glow[i2 + c] * k * 0.6);
    }
    env.write(d);
  }
});
F({
  id: 'average', name: '平均', group: '模糊', hint: '用区域平均色铺满（配合选区改局部底色）',
  params: [C('respectMask', '仅统计选区内像素', true)],
  apply: function (env, p) {
    var d = env.read(), w = env.w, h = env.h, n = w * h;
    var R = 0, G = 0, B = 0, A = 0;
    for (var i = 0; i < n; i++) {
      if (p.respectMask && env.mask && !env.mask[i]) continue;
      var o = i << 2, a = d[o + 3] / 255;
      R += d[o] * a; G += d[o + 1] * a; B += d[o + 2] * a; A += a;
    }
    if (A < 0.001) return;
    R /= A; G /= A; B /= A;
    for (var i2 = 0; i2 < n; i2++) {
      var o2 = i2 << 2;
      d[o2] = R; d[o2 + 1] = G; d[o2 + 2] = B; d[o2 + 3] = 255;
    }
    env.write(d);
  }
});

/* ============================================================
 * 锐化
 * ============================================================ */
function unsharpCore(d, w, h, amount, radius, threshold) {
  var blurred = new Uint8ClampedArray(d);
  FX.gaussBlur(blurred, w, h, Math.max(0.4, radius));
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (var c = 0; c < 3; c++) {
      var diff = d[i + c] - blurred[i + c];
      if (threshold > 0 && Math.abs(diff) < threshold) continue;
      d[i + c] = c255(d[i + c] + diff * amount);
    }
  }
  return d;
}
F({
  id: 'sharpen', name: '锐化', group: '锐化', hint: '小幅提升边缘对比',
  params: [R('amount', '数量', 0, 300, 60, 1, '%')],
  pad: 3,
  apply: function (env, p) { unsharpCore(env.read(), env.w, env.h, p.amount / 100, 0.8, 0); env.write(env._data.data); }
});
F({
  id: 'sharpen-more', name: '进一步锐化', group: '锐化', hint: '更强的锐化',
  params: [R('amount', '数量', 0, 400, 130, 1, '%')],
  pad: 3,
  apply: function (env, p) { unsharpCore(env.read(), env.w, env.h, p.amount / 100, 1.1, 0); env.write(env._data.data); }
});
F({
  id: 'sharpen-edges', name: '锐化边缘', group: '锐化', hint: '只强调轮廓，不动平滑区域',
  params: [R('amount', '数量', 0, 300, 100, 1, '%')],
  pad: 3,
  apply: function (env, p) { unsharpCore(env.read(), env.w, env.h, p.amount / 100, 1.0, 6); env.write(env._data.data); }
});
F({
  id: 'unsharp-mask', name: 'USM 锐化', group: '锐化', hint: '专业锐化：数量 / 半径 / 阈值三要素',
  params: [R('amount', '数量', 0, 500, 100, 1, '%'), R('radius', '半径', 0.2, 30, 1.6, 0.1, 'px'), R('threshold', '阈值', 0, 60, 0, 1, '')],
  pad: function (p) { return Math.ceil(p.radius * 2.4) + 2; },
  apply: function (env, p) { unsharpCore(env.read(), env.w, env.h, p.amount / 100, p.radius, p.threshold); env.write(env._data.data); }
});
F({
  id: 'smart-sharpen', name: '智能锐化', group: '锐化', hint: '锐化的同时压缩噪点',
  params: [R('amount', '数量', 0, 400, 110, 1, '%'), R('radius', '半径', 0.3, 20, 1.8, 0.1, 'px'), R('denoise', '降噪', 0, 100, 30, 1, '%')],
  pad: function (p) { return Math.ceil(p.radius * 2.4) + 3; },
  apply: function (env, p) {
    var d = env.read(), w = env.w, h = env.h;
    if (p.denoise > 0) FX.gaussBlur(d, w, h, p.denoise / 100 * 1.4);
    env.write(d);
    unsharpCore(d, w, h, p.amount / 100, p.radius, 4);
    env.write(d);
  }
});

/* ============================================================
 * 杂色
 * ============================================================ */
F({
  id: 'add-noise', name: '添加杂色', group: '杂色', hint: '加入随机颗粒，做胶片感或质感',
  params: [R('amount', '数量', 0.1, 100, 12, 0.1, '%'), C('mono', '单色', true), C('gaussian', '高斯分布', false), SEED()],
  apply: function (env, p) { FX.addNoise(env.read(), env.w, env.h, p.amount, p.mono, p.gaussian, p.seed); env.write(env._data.data); }
});
F({
  id: 'median', name: '中间值', group: '杂色', hint: '取邻域中值，去斑点同时保留边缘（半径越大越慢）',
  params: [R('radius', '半径', 1, 10, 2, 1, 'px')],
  pad: function (p) { return p.radius + 1; },
  apply: function (env, p) { FX.rank(env.read(), env.w, env.h, p.radius, 'median'); env.write(env._data.data); }
});
F({
  id: 'reduce-noise', name: '减少杂色', group: '杂色', hint: '压制颗粒，保留明暗层次',
  params: [R('strength', '强度', 0, 100, 45, 1, '%'), R('preserve', '保留细节', 0, 100, 40, 1, '%'), R('sharpen', '锐化细节', 0, 100, 25, 1, '%')],
  pad: function (p) { return 4; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var blur = new Uint8ClampedArray(d);
    FX.gaussBlur(blur, w, h, 1.2);
    var k = p.strength / 100, keep = p.preserve / 100;
    for (var i = 0; i < d.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var diff = src[i + c] - blur[i + c];
        var lim = 90 * (1 - keep) + 6;
        var cut = diff > lim ? lim : (diff < -lim ? -lim : diff);
        d[i + c] = c255(src[i + c] - cut * k);
      }
      d[i + 3] = src[i + 3];
    }
    if (p.sharpen > 0) unsharpCore(d, w, h, p.sharpen / 300, 0.9, 3);
    env.write(d);
  }
});
F({
  id: 'dust-scratches', name: '蒙尘与划痕', group: '杂色', hint: '抹掉细小杂点与划痕',
  params: [R('radius', '半径', 1, 16, 4, 1, 'px'), R('threshold', '阈值', 0, 128, 24, 1, '')],
  pad: function (p) { return p.radius + 1; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var out = new Uint8ClampedArray(d.length);
    var r = Math.round(p.radius), thr = p.threshold;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var cr = src[o], cg = src[o + 1], cb = src[o + 2];
        var bestR = cr, bestG = cg, bestB = cb, bd = 1e18;
        for (var j = -r; j <= r; j += 2) {
          var sy = clamp(y + j, 0, h - 1);
          for (var i = -r; i <= r; i += 2) {
            var so = ((sy * w + clamp(x + i, 0, w - 1)) << 2);
            var diff = Math.abs(src[so] - cr) + Math.abs(src[so + 1] - cg) + Math.abs(src[so + 2] - cb);
            if (diff < bd) { bd = diff; bestR = src[so]; bestG = src[so + 1]; bestB = src[so + 2]; }
          }
        }
        var use = bd > thr * 3;
        out[o] = use ? bestR : cr;
        out[o + 1] = use ? bestG : cg;
        out[o + 2] = use ? bestB : cb;
        out[o + 3] = src[o + 3];
      }
    }
    env.write(out);
  }
});

/* ============================================================
 * 像素化
 * ============================================================ */
F({
  id: 'mosaic', name: '马赛克', group: '像素化', hint: '单元格取平均色，做出像素块',
  params: [R('cell', '单元格', 2, 200, 12, 1, 'px')],
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var cw = Math.max(1, Math.round(w / Math.max(2, p.cell)));
    var ch = Math.max(1, Math.round(h / Math.max(2, p.cell)));
    var small = FX.temp(cw, ch), sg = small.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalAlpha = 1; sg.globalCompositeOperation = 'source-over';
    sg.imageSmoothingEnabled = true;
    sg.clearRect(0, 0, small.width, small.height);
    sg.drawImage(env.canvas, 0, 0, w, h, 0, 0, cw, ch);
    var ctx = env.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cw, ch, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    FX.release(small);
    env._data = null;
  }
});
F({
  id: 'crystallize', name: '晶格化', group: '像素化', hint: '随机晶格单元，颜色更自然',
  params: [R('cell', '单元格', 3, 200, 14, 1, 'px'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var V = FX.voronoi(w, h, p.cell, p.seed, false);
    var out = new Uint8ClampedArray(d.length), t = [0, 0, 0, 0];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, id = V.idx[i];
        FX.sample(d, w, h, V.px[id], V.py[id], t);
        var o = i << 2;
        out[o] = t[0]; out[o + 1] = t[1]; out[o + 2] = t[2]; out[o + 3] = t[3];
      }
    }
    env.write(out);
  }
});
F({
  id: 'pointillize', name: '点状化', group: '像素化', hint: '把画面点成一颗颗色点',
  params: [R('cell', '单元格', 3, 80, 12, 1, 'px'), CO('bg', '背景', '#ffffff'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var V = FX.voronoi(w, h, p.cell, p.seed, false);
    var ctx = env.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);
    var t = [0, 0, 0, 0];
    var seen = {};
    for (var i = 0; i < V.idx.length; i++) {
      var id = V.idx[i];
      if (seen[id]) continue;
      seen[id] = 1;
      var cx = V.px[id], cy = V.py[id];
      FX.sample(d, w, h, cx, cy, t);
      if (t[3] < 6) continue;
      ctx.fillStyle = 'rgb(' + Math.round(t[0]) + ',' + Math.round(t[1]) + ',' + Math.round(t[2]) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, p.cell * 0.45), 0, PI2);
      ctx.fill();
    }
    env._data = null;
  }
});
F({
  id: 'color-halftone', name: '彩色半调', group: '像素化', hint: '印刷网点效果',
  params: [R('size', '最大半径', 2, 40, 8, 1, 'px'), R('angle1', '通道 1 角度', 0, 180, 15, 1), R('angle2', '通道 2 角度', 0, 180, 75, 1), R('angle3', '通道 3 角度', 0, 180, 0, 1)],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var size = p.size, angs = [FX.deg2rad(p.angle1), FX.deg2rad(p.angle2), FX.deg2rad(p.angle3)];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        for (var c = 0; c < 3; c++) {
          var v = src[o + c] / 255;
          var ca = Math.cos(angs[c]), sa = Math.sin(angs[c]);
          var ux = x * ca + y * sa, uy = -x * sa + y * ca;
          var cx = (Math.floor(ux / size) + 0.5) * size;
          var cy = (Math.floor(uy / size) + 0.5) * size;
          var dist = Math.sqrt((ux - cx) * (ux - cx) + (uy - cy) * (uy - cy));
          var rad = (1 - v) * size * 0.72;
          d[o + c] = dist < rad ? 0 : 255;
        }
        d[o + 3] = src[o + 3];
      }
    }
    env.write(d);
  }
});
F({
  id: 'fragment', name: '碎片', group: '像素化', hint: '错位副本叠出重影',
  params: [R('offset', '偏移', 1, 20, 4, 1, 'px')],
  apply: function (env, p) {
    var o = Math.round(p.offset);
    FX.shiftStack(env, [[0, 0], [o, 0], [0, o], [o, o]]);
  }
});
F({
  id: 'mezzotint', name: '铜版雕刻', group: '像素化', hint: '把画面转成雕刻网点',
  params: [S('mode', '类型', [['dot', '细点'], ['grain', '颗粒'], ['line', '短线'], ['longline', '长线']], 'dot'), R('strength', '强度', 10, 200, 70, 1, '%'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var rnd = FX.mulberry32(p.seed);
    var rows = new Float32Array(h), cols = new Float32Array(w);
    for (var i = 0; i < h; i++) rows[i] = rnd();
    for (var j = 0; j < w; j++) cols[j] = rnd();
    var k = p.strength / 100;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        if (d[o + 3] === 0) continue;
        var l = gray(d[o], d[o + 1], d[o + 2]);
        var n;
        if (p.mode === 'dot') n = rnd();
        else if (p.mode === 'grain') n = (rnd() + rnd()) / 2;
        else if (p.mode === 'line') n = (rows[y] + rnd()) / 2;
        else n = (rows[y] * 0.7 + cols[x] * 0.3);
        var v = (l / 255) * 2 - 1 + (n - 0.5) * 2 * k;
        var out = v > 0 ? 255 : 0;
        d[o] = out; d[o + 1] = out; d[o + 2] = out;
      }
    }
    env.write(d);
  }
});

/* ============================================================
 * 扭曲
 * ============================================================ */
F({
  id: 'ripple', name: '波纹', group: '扭曲', hint: '正弦水波位移',
  params: [R('amount', '数量', -60, 60, 12, 1, 'px'), R('size', '大小', 4, 200, 30, 1, 'px'), C('clamp', '重复边缘像素', true)],
  pad: function (p) { return Math.ceil(Math.abs(p.amount)) + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h;
    FX.warp(env, function (x, y) {
      return [x + p.amount * Math.sin(PI2 * y / p.size), y + p.amount * Math.sin(PI2 * x / p.size)];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'wave', name: '波浪', group: '扭曲', hint: '可控波长与波幅的波动',
  params: [R('amp', '波幅', 0, 80, 14, 1, 'px'), R('len', '波长', 4, 240, 48, 1, 'px'),
    S('type', '波形', [['sin', '正弦'], ['tri', '三角形'], ['square', '方形']], 'sin'),
    AN('phase', '相位', 0), R('len2', '垂直波长', 4, 240, 72, 1, 'px'), C('clamp', '重复边缘像素', true)],
  pad: function (p) { return Math.ceil(Math.abs(p.amp)) + 2; },
  apply: function (env, p) {
    var ph = FX.deg2rad(p.phase);
    function wv(t) {
      var u = (t / 1) % 1;
      if (p.type === 'tri') return 4 * Math.abs(u - 0.5) - 1;
      if (p.type === 'square') return u < 0.5 ? 1 : -1;
      return Math.sin(PI2 * u);
    }
    FX.warp(env, function (x, y) {
      return [x + p.amp * wv(y / p.len + ph / PI2), y + p.amp * wv(x / p.len2 + ph / PI2)];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'spherize', name: '球面化', group: '扭曲', hint: '正值凸出、负值凹陷',
  params: [R('amount', '数量', -100, 100, 50, 1, '%'),
    S('mode', '模式', [['normal', '正常'], ['h', '仅水平'], ['v', '仅垂直']], 'normal'), C('clamp', '重复边缘像素', true)],
  apply: function (env, p) {
    var w = env.w, h = env.h, cx = w / 2, cy = h / 2;
    var r = Math.min(w, h) * 0.72;
    var a = p.amount / 100;
    FX.warp(env, function (x, y) {
      var dx = x - cx, dy = y - cy;
      if (p.mode === 'h') dy = 0;
      if (p.mode === 'v') dx = 0;
      var dist = Math.sqrt(dx * dx + dy * dy) / r;
      if (dist >= 1 || dist === 0) return [x, y];
      var ds = a > 0 ? Math.pow(dist, 1 + a * 1.6) : Math.pow(dist, 1 / (1 - a * 1.6));
      var f = ds / dist;
      return [cx + dx * f, cy + dy * f];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'pinch', name: '挤压', group: '扭曲', hint: '向中心挤压或向外推出',
  params: [R('amount', '数量', -100, 100, 50, 1, '%'), C('clamp', '重复边缘像素', true)],
  apply: function (env, p) {
    var w = env.w, h = env.h, cx = w / 2, cy = h / 2;
    var r = Math.min(w, h) * 0.62;
    var a = p.amount / 100;
    FX.warp(env, function (x, y) {
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var nd = dist / r;
      if (nd >= 1 || dist === 0) return [x, y];
      var f = 1 + a * Math.pow(1 - nd, 2) * 0.9;
      return [cx + dx * f, cy + dy * f];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'twirl', name: '旋转扭曲', group: '扭曲', hint: '以中心为轴旋转，越靠中心越强',
  params: [AN('angle', '角度', 50), C('clamp', '重复边缘像素', true)],
  apply: function (env, p) {
    var w = env.w, h = env.h, cx = w / 2, cy = h / 2;
    var r = Math.sqrt(cx * cx + cy * cy);
    var a = FX.deg2rad(p.angle);
    FX.warp(env, function (x, y) {
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var nd = dist / r;
      var ang = Math.atan2(dy, dx) + a * (1 - nd);
      return [cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'polar', name: '极坐标', group: '扭曲', hint: '直角坐标与极坐标互转',
  params: [S('mode', '转换', [['rect2polar', '平面坐标 → 极坐标'], ['polar2rect', '极坐标 → 平面坐标']], 'rect2polar'), C('clamp', '重复边缘像素', true)],
  apply: function (env, p) {
    var w = env.w, h = env.h, cx = w / 2, cy = h / 2;
    var rmax = Math.min(cx, cy) * 1.0;
    FX.warp(env, function (x, y) {
      if (p.mode === 'rect2polar') {
        var ang = (x / w) * PI2;
        var rad = (y / h) * rmax;
        return [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
      }
      var dx = x - cx, dy = y - cy;
      var ang2 = Math.atan2(dy, dx);
      var rad2 = Math.sqrt(dx * dx + dy * dy);
      return [((ang2 + Math.PI) / PI2) * w, (rad2 / rmax) * h];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'glass', name: '玻璃', group: '扭曲', hint: '透过毛玻璃看画面',
  params: [R('cell', '单元格', 4, 80, 10, 1, 'px'), R('distortion', '扭曲度', 1, 60, 12, 1, ''), R('smooth', '平滑度', 1, 10, 3, 1, ''), SEED()],
  pad: function (p) { return Math.ceil(p.distortion * 0.6) + 2; },
  apply: function (env, p) {
    var nf = FX.noise2(p.seed), s = Math.max(1, p.smooth);
    var k = p.distortion / Math.max(1, s);
    FX.warp(env, function (x, y) {
      var u = x / p.cell, v = y / p.cell;
      return [x + (nf(u, v) - 0.5) * 2 * k * 2, y + (nf(u + 37.7, v + 11.3) - 0.5) * 2 * k * 2];
    }, { clamp: true });
  }
});
F({
  id: 'ocean-ripple', name: '海洋波纹', group: '扭曲', hint: '细密的水面起伏',
  params: [R('size', '波纹大小', 2, 40, 9, 1, 'px'), R('amount', '波纹幅度', 1, 30, 5, 1, 'px'), C('clamp', '重复边缘像素', true)],
  pad: 6,
  apply: function (env, p) {
    var nf = FX.noise2(21);
    FX.warp(env, function (x, y) {
      var u = x / p.size, v = y / p.size;
      return [x + (nf(u, v * 0.6) - 0.5) * p.amount * 2, y + (nf(u * 0.6, v) - 0.5) * p.amount * 2];
    }, { clamp: p.clamp });
  }
});
F({
  id: 'displace', name: '位移', group: '扭曲', hint: '用噪声图移动像素（做大理石纹等）',
  params: [R('dx', '水平位移', -100, 100, 20, 1, 'px'), R('dy', '垂直位移', -100, 100, 20, 1, 'px'), R('scale', '噪声比例', 1, 100, 8, 1, ''), S('disp', '置换方式', [['wrap', '折回'], ['clamp', '重复边缘']], 'clamp'), SEED()],
  pad: function (p) { return Math.ceil(Math.max(Math.abs(p.dx), Math.abs(p.dy))) + 2; },
  apply: function (env, p) {
    var nf = FX.noise2(p.seed), s = p.scale;
    FX.warp(env, function (x, y) {
      var u = x / s, v = y / s;
      var a = nf(u, v), b = nf(u + 5.2, v + 1.3);
      return [x + (a - 0.5) * p.dx, y + (b - 0.5) * p.dy];
    }, { clamp: p.disp === 'clamp' });
  }
});
F({
  id: 'zigzag', name: '锯齿', group: '扭曲', hint: '放射性锯齿波动',
  params: [R('amount', '数量', 1, 60, 10, 1, 'px'), R('ridges', '隆起数', 1, 60, 12, 1, ''), S('style', '方式', [['out', '围绕中心'], ['in', '从中心向外']], 'out'), C('clamp', '重复边缘像素', true)],
  pad: function (p) { return Math.ceil(p.amount) + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, cx = w / 2, cy = h / 2;
    FX.warp(env, function (x, y) {
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var t = (dist / Math.min(w, h)) * p.ridges;
      var off = p.amount * (Math.abs((t % 1) - 0.5) * 2 - 0.5);
      if (p.style === 'in') off = -off;
      var f = dist === 0 ? 1 : (dist + off) / dist;
      return [cx + dx * f, cy + dy * f];
    }, { clamp: p.clamp });
  }
});

/* ============================================================
 * 风格化
 * ============================================================ */
F({
  id: 'find-edges', name: '查找边缘', group: '风格化', hint: '提取轮廓线，白底黑边',
  params: [R('strength', '强度', 0, 300, 100, 1, '%'), C('invert', '反相（白线黑底）', false)],
  pad: 2,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var k = p.strength / 100;
    for (var c = 0; c < 3; c++) {
      var ch = new Uint8ClampedArray(w * h);
      for (var i = 0, n = w * h; i < n; i++) ch[i] = src[(i << 2) + c];
      var e = FX.edges(ch, w, h);
      for (var i2 = 0; i2 < n; i2++) {
        var v = p.invert ? clamp(e[i2] * k * 2, 0, 255) : clamp(255 - e[i2] * k * 3.2, 0, 255);
        d[(i2 << 2) + c] = v;
      }
    }
    env.write(d);
  }
});
F({
  id: 'emboss', name: '浮雕效果', group: '风格化', hint: '定向光照压出立体感',
  params: [AN('angle', '角度', 135), R('height', '高度', 1, 20, 3, 1, 'px'), R('amount', '数量', 10, 500, 120, 1, '%'), C('color', '保留颜色', false)],
  pad: function (p) { return p.height + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var a = FX.deg2rad(p.angle), dx = Math.round(Math.cos(a)) || 1, dy = Math.round(-Math.sin(a));
    var k = p.amount / 100, dist = Math.max(1, Math.round(p.height));
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var x2 = clamp(x + dx * dist, 0, w - 1), y2 = clamp(y + dy * dist, 0, h - 1);
        var o2 = (y2 * w + x2) << 2;
        var diff = (gray(src[o], src[o + 1], src[o + 2]) - gray(src[o2], src[o2 + 1], src[o2 + 2]));
        var v = clamp(128 + diff * k, 0, 255);
        if (p.color) {
          for (var c = 0; c < 3; c++) {
            var dc = (src[o + c] - src[o2 + c]) * k;
            d[o + c] = clamp(128 + dc, 0, 255);
          }
        } else {
          d[o] = v; d[o + 1] = v; d[o + 2] = v;
        }
      }
    }
    env.write(d);
  }
});
F({
  id: 'contour', name: '等高线', group: '风格化', hint: '把色阶分界画成线',
  params: [R('level', '色阶', 1, 60, 12, 1, ''), S('edge', '边缘', [['lower', '较低'], ['upper', '较高']], 'lower')],
  pad: 2,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var f = FX.grayField(d, w, h);
    var step = 255 / p.level;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var v = f[i];
        var a = Math.floor(v / step), b = Math.floor(f[y * w + clamp(x + 1, 0, w - 1)] / step);
        var c2 = Math.floor(f[clamp(y + 1, 0, h - 1) * w + x] / step);
        var line = (a !== b || a !== c2);
        var o = i << 2;
        var val = line ? (p.edge === 'lower' ? 0 : 255) : (p.edge === 'lower' ? 255 : 0);
        d[o] = val; d[o + 1] = val; d[o + 2] = val;
      }
    }
    env.write(d);
  }
});
F({
  id: 'glowing-edges', name: '照亮边缘', group: '风格化', hint: '霓虹轮廓发光',
  params: [R('width', '边缘宽度', 1, 14, 3, 1, 'px'), R('brightness', '边缘亮度', 0, 20, 6, 1, ''), R('smooth', '平滑度', 1, 15, 5, 1, '')],
  pad: function (p) { return Math.ceil(p.width) + Math.ceil(p.smooth) * 2 + 3; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    var field = new Float32Array(w * h);
    for (var i = 0; i < field.length; i++) field[i] = clamp(e[i] * p.brightness, 0, 255);
    var tmp = new Uint8ClampedArray(w * h * 4);
    for (var j = 0; j < field.length; j++) {
      var v = field[j];
      tmp[(j << 2)] = v; tmp[(j << 2) + 1] = v; tmp[(j << 2) + 2] = v; tmp[(j << 2) + 3] = 255;
    }
    FX.gaussBlur(tmp, w, h, p.width + p.smooth * 0.8);
    for (var k = 0; k < field.length; k++) {
      var o = k << 2;
      d[o] = tmp[o]; d[o + 1] = tmp[o + 1]; d[o + 2] = tmp[o + 2];
      d[o + 3] = clamp(Math.max(tmp[o], tmp[o + 1], tmp[o + 2]) * 1.6, 0, 255);
    }
    env.write(d);
  }
});
F({
  id: 'diffuse', name: '扩散', group: '风格化', hint: '随机抖动像素，做出油画底噪',
  params: [S('mode', '模式', [['normal', '正常'], ['dark', '变暗优先'], ['light', '变亮优先'], ['aniso', '各向异性']], 'normal'), R('strength', '强度', 1, 30, 8, 1, 'px'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var out = new Uint8ClampedArray(d.length);
    var rnd = FX.mulberry32(p.seed), r = Math.round(p.strength);
    var dirX = 0, dirY = 0;
    if (p.mode === 'aniso') { dirX = 1; dirY = 0.35; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ox = rnd() * 2 - 1, oy = rnd() * 2 - 1;
        var sx = clamp(x + Math.round(ox * r + dirX * oy), 0, w - 1);
        var sy = clamp(y + Math.round(oy * r + dirY * ox), 0, h - 1);
        var so = (sy * w + sx) << 2, o = (y * w + x) << 2;
        var pick = so;
        if (p.mode === 'dark') pick = gray(src[so], src[so + 1], src[so + 2]) < gray(src[o], src[o + 1], src[o + 2]) ? so : o;
        if (p.mode === 'light') pick = gray(src[so], src[so + 1], src[so + 2]) > gray(src[o], src[o + 1], src[o + 2]) ? so : o;
        out[o] = src[pick]; out[o + 1] = src[pick + 1]; out[o + 2] = src[pick + 2]; out[o + 3] = src[pick + 3];
      }
    }
    env.write(out);
  }
});
F({
  id: 'oil-paint', name: '油画', group: '风格化', hint: '按色阶统计的笔触块面',
  params: [R('brush', '画笔大小', 1, 20, 5, 1, 'px'), R('detail', '细节', 1, 20, 6, 1, ''), R('bristle', '褶皱', 0, 12, 3, 1, '')],
  pad: function (p) { return p.brush + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var out = new Uint8ClampedArray(d.length);
    var r = Math.round(p.brush), levels = Math.round(p.detail);
    var cnt = new Int32Array(levels), sr = new Float32Array(levels), sg = new Float32Array(levels), sb = new Float32Array(levels);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i;
        for (i = 0; i < levels; i++) { cnt[i] = 0; sr[i] = 0; sg[i] = 0; sb[i] = 0; }
        for (var j = -r; j <= r; j++) {
          var sy = clamp(y + j, 0, h - 1);
          for (var k = -r; k <= r; k++) {
            var so = ((sy * w + clamp(x + k, 0, w - 1)) << 2);
            var l = gray(src[so], src[so + 1], src[so + 2]) / 255;
            var b = Math.min(levels - 1, Math.floor(l * levels));
            cnt[b]++; sr[b] += src[so]; sg[b] += src[so + 1]; sb[b] += src[so + 2];
          }
        }
        var best = 0;
        for (i = 1; i < levels; i++) if (cnt[i] > cnt[best]) best = i;
        var o = (y * w + x) << 2;
        if (cnt[best] > 0) {
          out[o] = sr[best] / cnt[best]; out[o + 1] = sg[best] / cnt[best]; out[o + 2] = sb[best] / cnt[best];
        } else { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; }
        out[o + 3] = src[o + 3];
      }
    }
    env.write(out);
    if (p.bristle > 0) {
      var tex = FX.textureField('grain', w, h, Math.max(1, 12 - p.bristle), 31);
      var dir = (new Uint8ClampedArray(out));
      for (var q = 0; q < w * h; q++) {
        var oo = q << 2, v = (tex[q] - 0.5) * p.bristle * 6;
        d[oo] = c255(dir[oo] + v); d[oo + 1] = c255(dir[oo + 1] + v); d[oo + 2] = c255(dir[oo + 2] + v);
        d[oo + 3] = dir[oo + 3];
      }
      env.write(d);
    }
  }
});
F({
  id: 'wind', name: '风', group: '风格化', hint: '沿水平方向拉出风痕',
  params: [S('method', '方法', [['wind', '风'], ['blast', '大风'], ['stagger', '阵风']], 'wind'), S('dir', '方向', [['right', '从左'], ['left', '从右']], 'right'), R('strength', '强度', 1, 80, 20, 1, 'px')],
  pad: function (p) { return Math.ceil(p.strength) + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var N = Math.round(p.strength), sign = p.dir === 'right' ? -1 : 1;
    var out = new Uint8ClampedArray(d.length);
    var rnd = FX.mulberry32(5);
    for (var y = 0; y < h; y++) {
      var jitter = p.method === 'stagger' ? Math.round((rnd() - 0.5) * 12) : 0;
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var R = 0, G = 0, B = 0, A = 0, cnt = 0;
        for (var k = 0; k <= N; k++) {
          var step = p.method === 'blast' ? k : k;
          var sx = clamp(x + sign * step + (p.method === 'wind' ? 0 : jitter), 0, w - 1);
          var sy = p.method === 'blast' ? clamp(y + Math.round((rnd() - 0.5) * 1.2), 0, h - 1) : y;
          var so = (sy * w + sx) << 2;
          var a = src[so + 3] / 255;
          R += src[so] * a; G += src[so + 1] * a; B += src[so + 2] * a; A += a; cnt++;
        }
        if (A > 0.004) { out[o] = R / A; out[o + 1] = G / A; out[o + 2] = B / A; out[o + 3] = A / cnt * 255; }
      }
    }
    env.write(out);
  }
});
F({
  id: 'solarize', name: '曝光过度', group: '风格化', hint: '亮部反相，得到奇异负像',
  params: [R('threshold', '阈值', 0, 255, 128, 1, ''), R('amount', '混合', 0, 100, 100, 1, '%')],
  apply: function (env, p) {
    var d = env.read(), k = p.amount / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      for (var c = 0; c < 3; c++) {
        if (d[i + c] > p.threshold) d[i + c] = c255(d[i + c] * (1 - k) + (255 - d[i + c]) * k);
      }
    }
    env.write(d);
  }
});
F({
  id: 'extrude', name: '凸出', group: '风格化', hint: '把画面切成块并随机抬升亮度',
  params: [R('size', '块大小', 2, 60, 10, 1, 'px'), R('depth', '深度', 1, 60, 12, 1, 'px'), C('solid', '纯色正面', true), S('dir', '方向', [['random', '随机'], ['flat', '平面']], 'random'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var cw = Math.max(2, Math.round(p.size)), ch = cw;
    var small = FX.temp(w, h), sg = small.getContext('2d');
    sg.clearRect(0, 0, w, h);
    sg.imageSmoothingEnabled = true;
    sg.drawImage(env.canvas, 0, 0);
    var sdata = sg.getImageData(0, 0, w, h).data;
    var rnd = FX.mulberry32(p.seed);
    var ctx = env.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (var y = 0; y < h; y += ch) {
      for (var x = 0; x < w; x += cw) {
        var cx = Math.min(w - 1, Math.floor(x + cw / 2)), cy = Math.min(h - 1, Math.floor(y + ch / 2));
        var so = (cy * w + cx) << 2;
        var l = gray(sdata[so], sdata[so + 1], sdata[so + 2]);
        var off = p.dir === 'random' ? (rnd() - 0.5) * p.depth : (l / 255 - 0.5) * p.depth;
        if (p.solid) {
          ctx.fillStyle = 'rgb(' + sdata[so] + ',' + sdata[so + 1] + ',' + sdata[so + 2] + ')';
          ctx.fillRect(x, y + off, cw - 1, ch - 1);
        } else {
          ctx.drawImage(small, x, y, cw, ch, x, y + off, cw - 1, ch - 1);
        }
      }
    }
    FX.release(small);
    env._data = null;
  }
});

/* ============================================================
 * 素描（使用前景色 / 背景色）
 * ============================================================ */
var FG = function (env) { return FX.rgb(env.fg); };
var BG = function (env) { return FX.rgb(env.bg); };

F({
  id: 'pencil-sketch', name: '铅笔素描', group: '素描', hint: '用前景色在背景色上画出铅笔线稿',
  params: [R('stroke', '描边长度', 1, 15, 4, 1, ''), R('detail', '细节', 1, 100, 75, 1, '%'), C('grain', '纸纹颗粒', true)],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var f = FX.toneField(env, {
      blur: 1 + p.stroke * 0.6, grain: p.grain ? 9 : 0,
      contrast: 0.6 + p.detail / 60, invert: false, edge: 0.35
    });
    var inv = new Float32Array(f.length);
    for (var i = 0; i < f.length; i++) inv[i] = 255 - f[i];
    FX.tintByLuma(env, inv, FG(env), BG(env), 1.15);
  }
});
F({
  id: 'chalk-charcoal', name: '粉笔和炭笔', group: '素描', hint: '粗糙的粉笔 / 炭笔肌理',
  params: [R('charcoal', '炭笔区域', 0, 100, 55, 1, '%'), R('chalk', '粉笔区域', 0, 100, 45, 1, '%'), R('pressure', '描边压力', 1, 100, 65, 1, '%'), SEED()],
  apply: function (env, p) {
    var f = FX.toneField(env, { grain: 22, edge: 0.4, blur: 1.2, seed: p.seed, contrast: 1.1 });
    var k = 1 + p.pressure / 90;
    for (var i = 0; i < f.length; i++) {
      var v = clamp(f[i] * k * (p.charcoal > 50 ? 0.86 : 1.05), 0, 255);
      f[i] = v;
    }
    FX.tintByLuma(env, f, FG(env), BG(env), 1 + p.chalk / 220);
  }
});
F({
  id: 'photocopy', name: '影印', group: '素描', hint: '高反差黑白复印',
  params: [R('detail', '细节', 1, 24, 8, 1, ''), R('darkness', '暗度', 1, 50, 12, 1, '')],
  apply: function (env, p) {
    var f = FX.toneField(env, { blur: 1.1, contrast: 1.2 });
    var t = 255 - p.darkness * 5;
    for (var i = 0; i < f.length; i++) {
      var v = f[i] < t ? 1 : 0;
      f[i] = v * 255;
    }
    FX.tintByLuma(env, f, BG(env), FG(env), 1);
  }
});
F({
  id: 'graphic-pen', name: '绘图笔', group: '素描', hint: '细密方向线稿',
  params: [R('stroke', '描边长度', 1, 15, 6, 1, ''), R('balance', '明暗平衡', 1, 50, 22, 1, ''), S('dir', '描边方向', [['d', '右下斜'], ['h', '水平'], ['v', '垂直'], ['d2', '左下斜']], 'd')],
  pad: 3,
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var src = new Uint8ClampedArray(env.read());
    var a = p.dir === 'h' ? 0 : (p.dir === 'v' ? 90 : (p.dir === 'd2' ? 45 : 135));
    var rad = FX.deg2rad(a), dx = Math.cos(rad), dy = Math.sin(rad);
    var N = Math.round(p.stroke), f = new Float32Array(w * h);
    var t = [0, 0, 0, 0];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0;
        for (var k = 0; k < N; k++) {
          FX.sample(src, w, h, x*1 + dx * k, y*1 + dy * k, t);
          sum += gray(t[0], t[1], t[2]) * (t[3] / 255);
        }
        f[y * w + x] = 255 - clamp(sum / N, 0, 255);
      }
    }
    var thr = p.balance / 50;
    for (var i = 0; i < f.length; i++) f[i] = clamp((f[i] / 255 / thr) * 255, 0, 255);
    FX.tintByLuma(env, f, FG(env), BG(env), 1);
  }
});
F({
  id: 'stamp', name: '图章', group: '素描', hint: '黑白两色的版画效果',
  params: [R('light', '亮部', 0, 50, 22, 1, ''), R('dark', '暗部', 0, 50, 20, 1, ''), R('smooth', '平滑度', 1, 50, 8, 1, '')],
  pad: function (p) { return Math.ceil(p.smooth / 2) + 2; },
  apply: function (env, p) {
    var f = FX.toneField(env, { blur: 1 });
    var lo = p.dark * 5, hi = 255 - p.light * 5;
    for (var i = 0; i < f.length; i++) f[i] = f[i] < lo ? 0 : (f[i] > hi ? 255 : (f[i] - lo) / Math.max(1, hi - lo) * 255);
    var blur = Math.max(0.6, p.smooth / 6);
    var tmp = new Uint8ClampedArray(f.length * 4);
    for (var k = 0; k < f.length; k++) { var o = k << 2; tmp[o] = f[k]; tmp[o + 1] = f[k]; tmp[o + 2] = f[k]; tmp[o + 3] = 255; }
    FX.gaussBlur(tmp, env.w, env.h, blur);
    for (var q = 0; q < f.length; q++) f[q] = tmp[(q << 2)];
    for (var m = 0; m < f.length; m++) f[m] = f[m] < 128 ? 0 : 255;
    FX.tintByLuma(env, f, FG(env), BG(env), 1);
  }
});
F({
  id: 'bas-relief', name: '基底凸现', group: '素描', hint: '浅浮雕，用前景色勾勒高光',
  params: [R('detail', '细节', 1, 15, 6, 1, ''), R('smooth', '平滑度', 1, 15, 5, 1, ''), AN('light', '光照方向', 315), R('mix', '明色混合', 0, 100, 40, 1, '%')],
  pad: function (p) { return Math.ceil(p.detail + p.smooth) + 3; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    FX.gaussBlur(src, w, h, Math.max(0.4, p.smooth / 3));
    var a = FX.deg2rad(p.light), dx = Math.round(Math.cos(a) * p.detail) || 1, dy = Math.round(-Math.sin(a) * p.detail);
    var fg = FG(env), bg = BG(env);
    var k = p.mix / 100;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var o2 = ((clamp(y + dy, 0, h - 1)) * w + clamp(x + dx, 0, w - 1)) << 2;
        var v = clamp(128 + (gray(src[o], src[o + 1], src[o + 2]) - gray(src[o2], src[o2 + 1], src[o2 + 2])) * 1.6, 0, 255);
        var t = v / 255;
        d[o] = mixv(bg.r, fg.r, t) * (1 - k) + v * k;
        d[o + 1] = mixv(bg.g, fg.g, t) * (1 - k) + v * k;
        d[o + 2] = mixv(bg.b, fg.b, t) * (1 - k) + v * k;
      }
    }
    env.write(d);
  }
});
F({
  id: 'water-paper', name: '水彩画纸', group: '素描', hint: '纤维纸张上的晕染',
  params: [R('fiber', '纤维长度', 3, 50, 15, 1, ''), R('brightness', '亮度', 0, 100, 60, 1, '%'), R('contrast', '对比度', 0, 100, 45, 1, '%'), SEED()],
  apply: function (env, p) {
    var f = FX.toneField(env, { texture: 'canvas', texScale: Math.max(2, p.fiber / 3), texSeed: p.seed, contrast: 1 + p.contrast / 100 });
    var bias = (p.brightness - 50) * 2.2;
    for (var i = 0; i < f.length; i++) f[i] = clamp(f[i] + bias, 0, 255);
    var inv = new Float32Array(f.length);
    for (var j = 0; j < f.length; j++) inv[j] = 255 - f[j];
    FX.tintByLuma(env, inv, FG(env), BG(env), 1.05);
  }
});
F({
  id: 'torn-edges', name: '撕边', group: '素描', hint: '纸张撕裂的粗糙边缘',
  params: [R('balance', '明暗平衡', 1, 50, 22, 1, ''), R('smooth', '平滑度', 1, 15, 7, 1, ''), R('contrast', '对比度', 0, 100, 40, 1, '%'), SEED()],
  pad: function (p) { return Math.ceil(p.smooth) + 2; },
  apply: function (env, p) {
    var f = FX.toneField(env, { grain: 26, blur: p.smooth / 4, seed: p.seed, contrast: 1 + p.contrast / 80 });
    var t = p.balance * 5;
    var inv = new Float32Array(f.length);
    for (var i = 0; i < f.length; i++) inv[i] = f[i] < t ? 0 : 255;
    FX.tintByLuma(env, inv, FG(env), BG(env), 1);
  }
});
F({
  id: 'note-paper', name: '便条纸', group: '素描', hint: '凹凸的浅浮雕纸面',
  params: [R('balance', '明暗平衡', 1, 50, 24, 1, ''), R('grain', '颗粒', 0, 20, 10, 1, ''), R('relief', '凸现', 0, 50, 12, 1, ''), SEED()],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var f = FX.toneField(env, { grain: p.grain, blur: 1.4, seed: p.seed });
    var d = env.read();
    var fg = FG(env), bg = BG(env);
    var t = p.balance * 5, k = p.relief / 25;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, o = i << 2;
        var v = clamp(f[i] + (f[i] - f[clamp(y + 1, 0, h - 1) * w + clamp(x + 1, 0, w - 1)]) * k, 0, 255);
        var col = v < t ? fg : bg;
        d[o] = col.r; d[o + 1] = col.g; d[o + 2] = col.b;
      }
    }
    env.write(d);
  }
});
F({
  id: 'reticulation', name: '网状', group: '素描', hint: '底片状的网点纹理',
  params: [R('density', '密度', 1, 50, 12, 1, ''), R('fgLevel', '前景色阶', 0, 50, 0, 1, ''), R('bgLevel', '背景色阶', 0, 50, 25, 1, ''), SEED()],
  apply: function (env, p) {
    var f = FX.toneField(env, { grain: p.density, seed: p.seed, contrast: 1.4 });
    var inv = new Float32Array(f.length);
    for (var i = 0; i < f.length; i++) inv[i] = 255 - f[i];
    FX.tintByLuma(env, inv, FG(env), BG(env), 1);
  }
});
F({
  id: 'halftone-pattern', name: '半调图案', group: '素描', hint: '网点 / 线条 / 圆环图案',
  params: [R('size', '大小', 2, 40, 8, 1, 'px'), R('contrast', '对比度', 0, 100, 40, 1, '%'), S('pattern', '图案类型', [['dot', '网点'], ['line', '直线'], ['circle', '圆形']], 'dot')],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var fg = FG(env), bg = BG(env);
    var size = p.size, k = 1 + p.contrast / 100;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var l = gray(src[o], src[o + 1], src[o + 2]) / 255;
        l = clamp((l - 0.5) * k + 0.5, 0, 1);
        var inside;
        if (p.pattern === 'line') inside = ((y % size) / size) < (1 - l);
        else if (p.pattern === 'circle') {
          var rr = Math.sqrt((x % size - size / 2) * (x % size - size / 2) + (y % size - size / 2) * (y % size - size / 2)) / (size / 2);
          inside = rr < (1 - l);
        } else {
          var cx = (Math.floor(x / size) + 0.5) * size, cy = (Math.floor(y / size) + 0.5) * size;
          var dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / (size * 0.72);
          inside = dist < (1 - l);
        }
        var col = inside ? fg : bg;
        d[o] = col.r; d[o + 1] = col.g; d[o + 2] = col.b;
      }
    }
    env.write(d);
  }
});
F({
  id: 'plaster', name: '塑料效果', group: '素描', hint: '厚涂塑料般的立体色块',
  params: [R('balance', '明暗平衡', 1, 50, 22, 1, ''), R('smooth', '平滑度', 1, 15, 6, 1, ''), S('light', '光照位置', [['top', '顶'], ['bottom', '底'], ['left', '左'], ['right', '右']], 'top')],
  pad: function (p) { return Math.ceil(p.smooth / 2) + 3; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    FX.gaussBlur(src, w, h, Math.max(0.4, p.smooth / 3));
    var fg = FG(env), bg = BG(env), t = p.balance * 5;
    var dx = p.light === 'left' ? -2 : (p.light === 'right' ? 2 : 0);
    var dy = p.light === 'top' ? -2 : (p.light === 'bottom' ? 2 : 0);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var o2 = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) << 2;
        var v = clamp(128 + (gray(src[o], src[o + 1], src[o + 2]) - gray(src[o2], src[o2 + 1], src[o2 + 2])) * 3.2, 0, 255);
        var vv = v < t * 1.4 ? 0 : 255;
        var sel = ((v + vv) / 2) > 128;
        var col = sel ? fg : bg;
        d[o] = col.r; d[o + 1] = col.g; d[o + 2] = col.b;
      }
    }
    env.write(d);
  }
});
F({
  id: 'charcoal', name: '炭精笔', group: '素描', hint: '浓黑的炭笔绘画',
  params: [R('fgLevel', '前景色阶', 1, 50, 8, 1, ''), R('bgLevel', '背景色阶', 1, 50, 18, 1, ''), R('texture', '纹理', 1, 50, 12, 1, ''), R('scale', '比例', 1, 50, 18, 1, ''), S('light', '光照方向', [['top', '顶'], ['bottom', '底']], 'top'), SEED()],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var tex = FX.textureField('grain', w, h, Math.max(2, p.texture), p.seed);
    var fg = FG(env), bg = BG(env);
    var lo = p.fgLevel * 5, hi = 255 - p.bgLevel * 5;
    var dy = p.light === 'top' ? -2 : 2;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, o = i << 2;
        var o2 = (clamp(y + dy, 0, h - 1) * w + x) << 2;
        var l = gray(src[o], src[o + 1], src[o + 2]) + (gray(src[o], src[o + 1], src[o + 2]) - gray(src[o2], src[o2 + 1], src[o2 + 2])) * 2.4 + (tex[i] - 0.5) * p.scale * 3;
        l = clamp(l, 0, 255);
        var v = l < lo ? 0 : (l > hi ? 255 : (l - lo) / Math.max(1, hi - lo) * 255);
        var col = v < 128 ? fg : bg;
        d[o] = col.r; d[o + 1] = col.g; d[o + 2] = col.b;
      }
    }
    env.write(d);
  }
});

/* ============================================================
 * 艺术效果
 * ============================================================ */
function paperRelief(env, p, strength, scale, seed) {
  var w = env.w, h = env.h, d = env.read();
  var tex = FX.textureField('canvas', w, h, Math.max(2, scale), seed || 5);
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x, o = i << 2;
      var g = (tex[i + 1] - tex[i - 1]) * strength;
      d[o] = c255(d[o] + g); d[o + 1] = c255(d[o + 1] + g); d[o + 2] = c255(d[o + 2] + g);
    }
  }
  env.write(d);
}
F({
  id: 'watercolor', name: '水彩', group: '艺术效果', hint: '透明水色晕染',
  params: [R('brush', '画笔细节', 1, 14, 5, 1, ''), R('shadow', '暗部强度', 0, 10, 2, 1, ''), R('texture', '纹理', 1, 20, 6, 1, '')],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.rank(d, w, h, Math.max(1, Math.round(p.brush / 3)), 'median');
    FX.gaussBlur(d, w, h, 0.9);
    FX.posterize(d, Math.max(3, 12 - Math.round(p.brush / 2)));
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = Math.min(255, e[i] * p.shadow * 1.4);
      var o = i << 2;
      d[o] = c255(d[o] - v); d[o + 1] = c255(d[o + 1] - v); d[o + 2] = c255(d[o + 2] - v);
    }
    env.write(d);
    paperRelief(env, p, p.texture * 0.35, p.texture * 1.5, 13);
  }
});
F({
  id: 'poster-edges', name: '海报边缘', group: '艺术效果', hint: '色块 + 黑边，海报感',
  params: [R('thickness', '边缘厚度', 0, 10, 2, 1, ''), R('intensity', '边缘强度', 0, 10, 4, 1, ''), R('poster', '海报化', 0, 6, 3, 1, '')],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    if (p.poster > 0) FX.posterize(d, 3 + p.poster);
    if (p.thickness > 0) FX.gaussBlur(d, w, h, p.thickness / 3);
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = Math.min(255, e[i] * p.intensity * 3.5);
      var o = i << 2;
      d[o] = c255(d[o] - v); d[o + 1] = c255(d[o + 1] - v); d[o + 2] = c255(d[o + 2] - v);
    }
    env.write(d);
  }
});
F({
  id: 'rough-pastel', name: '粗糙蜡笔', group: '艺术效果', hint: '在纸纹上涂抹的蜡笔',
  params: [R('stroke', '描边长度', 0, 40, 8, 1, ''), R('detail', '描边细节', 0, 20, 6, 1, ''), R('scale', '纹理缩放', 50, 200, 100, 1, '%'), R('relief', '凸现', 0, 50, 20, 1, ''), S('light', '光照', [['top', '顶'], ['bottom', '底'], ['left', '左'], ['right', '右']], 'bottom')],
  pad: 6,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    if (p.stroke > 0) FX.gaussBlur(d, w, h, p.stroke / 8 + 0.5);
    env.write(d);
    paperRelief(env, p, p.relief * 0.5, 14 * p.scale / 100, 7);
    FX.addNoise(env.read(), w, h, Math.max(2, p.detail * 0.9), true, false, 17);
    env.write(env._data.data);
  }
});
F({
  id: 'smudge-stick', name: '涂抹棒', group: '艺术效果', hint: '短促斜向涂抹',
  params: [R('stroke', '描边长度', 0, 20, 5, 1, ''), R('intensity', '强度', 0, 50, 20, 1, ''), R('detail', '细节', 0, 20, 5, 1, '')],
  pad: 8,
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var a = FX.deg2rad(-45), dx = Math.cos(a), dy = Math.sin(a), N = Math.max(1, Math.round(p.stroke));
    FX.traceAverage(env, N + 1, function (x, y, k) {
      var t = k * (p.intensity / 12);
      return [x - dx * t, y - dy * t];
    });
    var dd = env.read();
    var e = FX.edges(new Uint8ClampedArray(dd), w, h);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = e[i] * p.detail * 0.6;
      var o = i << 2;
      dd[o] = c255(dd[o] - v); dd[o + 1] = c255(dd[o + 1] - v); dd[o + 2] = c255(dd[o + 2] - v);
    }
    env.write(dd);
  }
});
F({
  id: 'sponge', name: '海绵', group: '艺术效果', hint: '海绵吸色的斑驳感',
  params: [R('brush', '画笔大小', 1, 20, 6, 1, ''), R('definition', '定义', 0, 25, 12, 1, ''), R('smooth', '平滑度', 1, 15, 5, 1, ''), SEED()],
  pad: 6,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.gaussBlur(d, w, h, 0.6);
    FX.posterize(d, Math.max(3, 10 - Math.round(p.brush / 3)));
    var tex = FX.textureField('grain', w, h, Math.max(2, 16 - p.brush), p.seed);
    for (var i = 0, n = w * h; i < n; i++) {
      var k = (tex[i] - 0.5) * p.definition * 8 + (p.smooth - 5) * 2;
      var o = i << 2;
      d[o] = c255(d[o] + k); d[o + 1] = c255(d[o + 1] + k); d[o + 2] = c255(d[o + 2] + k);
    }
    env.write(d);
  }
});
F({
  id: 'dry-brush', name: '干画笔', group: '艺术效果', hint: '干涩的横向笔触',
  params: [R('brush', '画笔大小', 0, 20, 6, 1, ''), R('detail', '画笔细节', 0, 20, 7, 1, ''), R('texture', '纹理', 1, 10, 3, 1, '')],
  pad: 8,
  apply: function (env, p) {
    var w = env.w, h = env.h;
    var N = Math.max(2, Math.round(p.brush) + 2);
    FX.traceAverage(env, N, function (x, y, k) { return [x - k + p.brush / 2, y + (k % 2) * 0.5]; });
    var dd = env.read();
    FX.posterize(dd, Math.max(3, 10 - Math.round(p.detail / 3)));
    FX.addNoise(dd, w, h, p.texture * 2.5, true, false, 23);
    env.write(dd);
  }
});
F({
  id: 'underpainting', name: '底纹效果', group: '艺术效果', hint: '带纹理底色的油画',
  params: [R('brush', '画笔大小', 1, 30, 8, 1, ''), R('texture', '纹理覆盖', 1, 30, 12, 1, ''), R('scale', '纹理缩放', 50, 200, 100, 1, '%'), R('relief', '凸现', 0, 50, 18, 1, ''), S('light', '光照', [['top', '顶'], ['bottom', '底'], ['left', '左'], ['right', '右']], 'bottom')],
  pad: 8,
  apply: function (env, p) {
    var d = env.read();
    FX.gaussBlur(d, env.w, env.h, p.brush / 6 + 0.6);
    FX.posterize(d, 10);
    env.write(d);
    paperRelief(env, p, p.relief * 0.45, 12 * p.scale / 100, 29);
  }
});
F({
  id: 'palette-knife', name: '调色刀', group: '艺术效果', hint: '刀刮般的色块',
  params: [R('stroke', '描边大小', 1, 30, 8, 1, ''), R('detail', '描边细节', 1, 10, 4, 1, ''), R('softness', '柔化', 0, 20, 4, 1, '')],
  pad: 6,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.rank(d, w, h, Math.max(1, Math.round(p.stroke / 5)), 'median');
    if (p.softness > 0) FX.gaussBlur(d, w, h, p.softness / 6);
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = Math.min(180, e[i] * p.detail * 0.4);
      var o = i << 2;
      d[o] = c255(d[o] - v); d[o + 1] = c255(d[o + 1] - v); d[o + 2] = c255(d[o + 2] - v);
    }
    env.write(d);
  }
});
F({
  id: 'neon-glow', name: '霓虹灯光', group: '艺术效果', hint: '边缘发光，像霓虹灯管',
  params: [R('glow', '发光大小', 1, 40, 10, 1, 'px'), R('brightness', '发光亮度', 1, 40, 14, 1, ''), CO('color', '灯光颜色', '#5b8cff'), R('dark', '底色压暗', 0, 100, 60, 1, '%')],
  pad: function (p) { return Math.ceil(p.glow) + 3; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    var glow = new Uint8ClampedArray(w * h * 4);
    var col = FX.rgb(p.color);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = Math.min(255, e[i] * p.brightness / 6);
      var o = i << 2;
      glow[o] = v * col.r / 255; glow[o + 1] = v * col.g / 255; glow[o + 2] = v * col.b / 255; glow[o + 3] = 255;
    }
    FX.gaussBlur(glow, w, h, p.glow);
    var k = 1 - p.dark / 100;
    for (var j = 0; j < d.length; j += 4) {
      d[j] = c255(d[j] * k + glow[j]);
      d[j + 1] = c255(d[j + 1] * k + glow[j + 1]);
      d[j + 2] = c255(d[j + 2] * k + glow[j + 2]);
    }
    env.write(d);
  }
});
F({
  id: 'film-grain', name: '胶片颗粒', group: '艺术效果', hint: '按亮度分布的胶片颗粒',
  params: [R('grain', '颗粒', 1, 40, 12, 1, ''), R('highlight', '高光区域', 0, 20, 6, 1, ''), R('intensity', '强度', 1, 10, 3, 1, ''), SEED()],
  apply: function (env, p) {
    var d = env.read();
    var rnd = FX.mulberry32(p.seed);
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var l = gray(d[i], d[i + 1], d[i + 2]) / 255;
      var amt = p.grain * (1 - l * (1 - p.highlight / 20)) * p.intensity / 3;
      var n = (rnd() + rnd() - 1) * amt;
      d[i] = c255(d[i] + n); d[i + 1] = c255(d[i + 1] + n); d[i + 2] = c255(d[i + 2] + n);
    }
    env.write(d);
  }
});
F({
  id: 'fresco', name: '壁画', group: '艺术效果', hint: '粗糙墙面上的干壁画',
  params: [R('brush', '画笔细节', 0, 10, 3, 1, ''), R('texture', '纹理', 1, 10, 4, 1, ''), R('size', '纹理大小', 1, 10, 3, 1, '')],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.rank(d, w, h, Math.max(1, Math.round(p.brush / 3)), 'median');
    FX.contrastData(d, 1 + p.size / 12);
    FX.addNoise(d, w, h, p.texture * 2.5, true, false, 41);
    env.write(d);
  }
});
F({
  id: 'plastic-wrap', name: '塑料包装', group: '艺术效果', hint: '褶皱塑料的强反光',
  params: [R('highlight', '高光强度', 1, 20, 8, 1, ''), R('detail', '细节', 1, 15, 9, 1, ''), R('smooth', '平滑度', 1, 15, 7, 1, ''), SEED()],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var nf = FX.noise2(p.seed);
    var s = Math.max(2, 30 - p.detail * 2);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2;
        var a = FX.fbm(nf, x / s, y / s, 3, 0.55);
        var b = FX.fbm(nf, (x + 1) / s, y / s, 3, 0.55);
        var c = FX.fbm(nf, x / s, (y + 1) / s, 3, 0.55);
        var r = ((a - b) + (a - c)) * 4 * p.highlight;
        d[o] = c255(d[o] + r * 255 * 0.35);
        d[o + 1] = c255(d[o + 1] + r * 255 * 0.35);
        d[o + 2] = c255(d[o + 2] + r * 255 * 0.35 - Math.abs(r) * 30);
      }
    }
    env.write(d);
    if (p.smooth > 1) {
      var dd = env.read();
      FX.gaussBlur(dd, w, h, p.smooth / 8);
      env.write(dd);
    }
  }
});
F({
  id: 'cutout', name: '木刻', group: '艺术效果', hint: '高对比色块版画',
  params: [R('levels', '色阶数', 2, 8, 4, 1, ''), R('edge', '边缘逼真度', 0, 5, 2, 1, ''), R('simplify', '简化度', 0, 10, 3, 1, '')],
  pad: 3,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    if (p.simplify > 0) FX.gaussBlur(d, w, h, p.simplify / 6);
    FX.posterize(d, p.levels);
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = Math.min(255, e[i] * p.edge * 0.7);
      var o = i << 2;
      d[o] = c255(d[o] - v); d[o + 1] = c255(d[o + 1] - v); d[o + 2] = c255(d[o + 2] - v);
    }
    env.write(d);
  }
});

/* ============================================================
 * 画笔描边
 * ============================================================ */
F({
  id: 'spatter', name: '喷溅', group: '画笔描边', hint: '随机喷点，像喷枪洒落',
  params: [R('radius', '喷溅半径', 1, 30, 8, 1, 'px'), R('smooth', '平滑度', 1, 15, 5, 1, ''), SEED()],
  pad: 32,
  apply: function (env, p) {
    var rnd = FX.mulberry32(p.seed);
    var R = p.radius, n = Math.max(4, Math.round(p.smooth) + 3);
    FX.traceAverage(env, n, function (x, y) {
      return [x + (rnd() * 2 - 1) * R, y + (rnd() * 2 - 1) * R];
    });
  }
});
F({
  id: 'angled-strokes', name: '成角的线条', group: '画笔描边', hint: '斜向笔触',
  params: [AN('angle', '方向', 45), R('length', '描边长度', 1, 60, 16, 1, 'px'), R('sharp', '锐化', 0, 40, 10, 1, '%')],
  pad: function (p) { return Math.ceil(p.length / 2) + 2; },
  apply: function (env, p) {
    var a = FX.deg2rad(p.angle), dx = Math.cos(a), dy = Math.sin(a);
    var n = Math.max(2, Math.round(p.length));
    FX.traceAverage(env, n, function (x, y, k) {
      var t = (k / (n - 1) - 0.5) * p.length;
      return [x + dx * t, y + dy * t];
    });
    var d = env.read();
    if (p.sharp > 0) { unsharpCore(d, env.w, env.h, p.sharp / 100, 0.8, 0); env.write(d); }
  }
});
F({
  id: 'crosshatch', name: '阴影线', group: '画笔描边', hint: '交叉排线，暗部更密',
  params: [R('stroke', '描边长度', 3, 30, 9, 1, ''), R('sharp', '锐化', 0, 20, 6, 1, ''), R('strength', '强度', 1, 10, 3, 1, '')],
  pad: 6,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.posterize(d, 8);
    var f = FX.grayField(d, w, h);
    var gap = Math.max(3, Math.round(p.stroke)), sw = Math.max(1, Math.round(p.strength));
    var out = new Uint8ClampedArray(d.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, o = i << 2;
        var l = f[i], ink = 0;
        if (((x + y) % gap) < sw) ink += (1 - l / 255) * 0.8;
        if ((((x - y) % gap) + gap) % gap < sw) ink += (1 - l / 255) * 0.55;
        var v = clamp(l - ink * 255, 0, 255);
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = d[o + 3];
      }
    }
    env.write(out);
    if (p.sharp > 0) {
      var dd = env.read();
      unsharpCore(dd, w, h, p.sharp / 100, 0.8, 0);
      env.write(dd);
    }
  }
});
F({
  id: 'ink-outlines', name: '油墨概况', group: '画笔描边', hint: '深色油墨勾边',
  params: [R('length', '描边长度', 1, 50, 14, 1, ''), R('dark', '深色强度', 0, 50, 18, 1, ''), R('light', '浅色强度', 0, 40, 6, 1, '')],
  pad: 30,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.gaussBlur(d, w, h, Math.max(0.5, p.length / 8));
    env.write(d);
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    var dark = p.dark / 100 * 3, light = p.light / 100 * 1.2;
    for (var i = 0, n = w * h; i < n; i++) {
      var v = e[i] / 255, o = i << 2;
      d[o] = c255(d[o] - v * 255 * dark + v * 255 * light * 0.3);
      d[o + 1] = c255(d[o + 1] - v * 255 * dark + v * 255 * light * 0.3);
      d[o + 2] = c255(d[o + 2] - v * 255 * dark + v * 255 * light * 0.3);
    }
    env.write(d);
  }
});
F({
  id: 'dark-strokes', name: '深色线条', group: '画笔描边', hint: '暗部拉出深色笔触',
  params: [R('balance', '明暗平衡', 0, 20, 6, 1, ''), R('black', '黑色强度', 0, 20, 8, 1, ''), R('white', '白色强度', 0, 20, 3, 1, '')],
  pad: 4,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.gaussBlur(d, w, h, 1 + p.balance / 6);
    var f = FX.grayField(d, w, h);
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    for (var i = 0, n = w * h; i < n; i++) {
      var o = i << 2;
      var dk = (f[i] < p.balance * 12 ? 1 : 0) * e[i] / 255 * p.black;
      var lt = (f[i] > 255 - p.balance * 12 ? 1 : 0) * e[i] / 255 * p.white;
      d[o] = c255(d[o] - dk * 12 + lt * 12);
      d[o + 1] = c255(d[o + 1] - dk * 12 + lt * 12);
      d[o + 2] = c255(d[o + 2] - dk * 12 + lt * 12);
    }
    env.write(d);
  }
});
F({
  id: 'accented-edges', name: '强化的边缘', group: '画笔描边', hint: '描出白边与黑边',
  params: [R('width', '边缘宽度', 1, 20, 4, 1, ''), R('brightness', '边缘亮度', 0, 50, 26, 1, ''), R('smooth', '平滑度', 1, 15, 5, 1, '')],
  pad: function (p) { return Math.ceil(p.width + p.smooth) + 3; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var f = FX.grayField(d, w, h);
    var e = FX.edges(new Uint8ClampedArray(d), w, h);
    var tmp = new Uint8ClampedArray(w * h * 4);
    for (var i = 0, n = w * h; i < n; i++) {
      var v = Math.min(255, e[i] * p.brightness / 6);
      var o = i << 2;
      tmp[o] = v; tmp[o + 1] = v; tmp[o + 2] = v; tmp[o + 3] = 255;
    }
    FX.gaussBlur(tmp, w, h, p.width * 0.6 + p.smooth * 0.5);
    var k = p.brightness / 26;
    for (var j = 0; j < n; j++) {
      var o2 = j << 2;
      var gv = f[j], gl = tmp[o2];
      var out = gv > 128 ? c255(gv + gl * (1 - k)) : c255(gv * (1 - gl / 510) - gl * k * 0.15);
      d[o2] = out; d[o2 + 1] = out; d[o2 + 2] = out;
    }
    env.write(d);
  }
});
F({
  id: 'sumi-e', name: '烟灰墨', group: '画笔描边', hint: '浓墨晕染的写意效果',
  params: [R('stroke', '描边宽度', 3, 30, 12, 1, ''), R('pressure', '描边压力', 0, 20, 8, 1, ''), R('contrast', '对比度', 0, 30, 10, 1, '')],
  pad: 20,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    FX.gaussBlur(d, w, h, p.stroke / 4);
    var f = FX.grayField(d, w, h);
    var t = 128 + (p.pressure - 10) * 4;
    for (var i = 0, n = w * h; i < n; i++) {
      var v = clamp((f[i] - t) * (1 + p.contrast / 12) + 128, 0, 255);
      var o = i << 2;
      d[o] = v; d[o + 1] = v; d[o + 2] = v;
    }
    env.write(d);
  }
});

/* ============================================================
 * 纹理
 * ============================================================ */
F({
  id: 'craquelure', name: '龟裂缝', group: '纹理', hint: '釉面龟裂的细纹',
  params: [R('spacing', '裂缝间距', 4, 80, 18, 1, 'px'), R('depth', '裂缝深度', 0, 10, 4, 1, ''), R('brightness', '裂缝亮度', 0, 10, 6, 1, ''), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var C = FX.crackField(w, h, p.spacing, p.depth / 10, p.seed);
    var fill = p.brightness > 6;
    for (var i = 0, n = w * h; i < n; i++) {
      var k = (C[i] - 0.9) * p.depth * 26;
      var o = i << 2;
      if (fill) { d[o] = c255(d[o] + k); d[o + 1] = c255(d[o + 1] + k); d[o + 2] = c255(d[o + 2] + k); }
      else { d[o] = c255(d[o] - k); d[o + 1] = c255(d[o + 1] - k); d[o + 2] = c255(d[o + 2] - k); }
    }
    env.write(d);
  }
});
F({
  id: 'grain', name: '颗粒', group: '纹理', hint: '可控的颗粒质感',
  params: [R('intensity', '强度', 1, 100, 30, 1, ''), R('contrast', '对比度', 0, 100, 30, 1, ''), S('type', '颗粒类型', [['regular', '常规'], ['soft', '软化'], ['sprinkle', '喷洒'], ['clumped', '结块'], ['contrasty', '高对比'], ['enlarged', '大号'], ['stippled', '斑点'], ['horizontal', '水平'], ['vertical', '垂直'], ['speckle', '小斑点']], 'regular'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var rnd = FX.mulberry32(p.seed);
    var type = p.type, amt = p.intensity / 100 * 90, k = 1 + p.contrast / 100;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2, n;
        if (type === 'horizontal' || type === 'vertical') n = (rnd() - 0.5) * 0.7;
        else if (type === 'soft') n = (rnd() + rnd() + rnd() - 1.5) * 0.9;
        else if (type === 'sprinkle' || type === 'speckle') n = rnd() > 0.86 ? (rnd() - 0.5) * 2 : 0;
        else if (type === 'clumped') n = (rnd() > 0.7 ? 1 : 0) * (rnd() - 0.5) * 2;
        else if (type === 'enlarged') n = (rnd() > 0.55 ? 1 : 0) * (rnd() - 0.5) * 2.4;
        else if (type === 'stippled') n = Math.abs(rnd() - 0.5) * 2 - 0.5;
        else if (type === 'contrasty') n = (rnd() > 0.5 ? 1 : -1) * (0.4 + rnd() * 0.6);
        else n = (rnd() - 0.5) * 2;
        var v = n * amt * k * 0.5;
        d[o] = c255(d[o] + v); d[o + 1] = c255(d[o + 1] + v); d[o + 2] = c255(d[o + 2] + v);
      }
    }
    env.write(d);
  }
});
function tileBevel(d, w, h, cell, gap, bevel) {
  var cw = Math.max(2, Math.round(cell));
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var lx = x % cw, ly = y % cw;
      var e = Math.min(lx, cw - lx, ly, cw - ly);
      var v = e <= gap ? 26 : (bevel > 0 && e <= gap + bevel ? -(bevel - (e - gap)) * 12 : 0);
      var o = (y * w + x) << 2;
      d[o] = c255(d[o] - v); d[o + 1] = c255(d[o + 1] - v); d[o + 2] = c255(d[o + 2] - v);
    }
  }
}
function mosaicCore(env, cell) {
  var w = env.w, h = env.h;
  var cw = Math.max(1, Math.round(w / Math.max(2, cell))), ch = Math.max(1, Math.round(h / Math.max(2, cell)));
  var small = FX.temp(cw, ch), sg = small.getContext('2d');
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalAlpha = 1; sg.globalCompositeOperation = 'source-over';
  sg.clearRect(0, 0, small.width, small.height);
  sg.imageSmoothingEnabled = true;
  sg.drawImage(env.canvas, 0, 0, w, h, 0, 0, cw, ch);
  var ctx = env.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, cw, ch, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  FX.release(small);
  env._data = null;
  return Math.floor(w / cw);
}
F({
  id: 'mosaic-tiles', name: '马赛克拼贴', group: '纹理', hint: '瓷砖块面 + 缝隙',
  params: [R('size', '拼贴大小', 2, 60, 12, 1, 'px'), R('gap', '缝隙宽度', 1, 20, 3, 1, 'px'), R('lighten', '加亮缝隙', 0, 20, 6, 1, '')],
  apply: function (env, p) {
    var cell = mosaicCore(env, p.size);
    var d = env.read();
    tileBevel(d, env.w, env.h, cell, Math.round(p.gap), Math.round(p.lighten / 2));
    env.write(d);
  }
});
F({
  id: 'patchwork', name: '拼缀图', group: '纹理', hint: '方形色块拼贴',
  params: [R('size', '方块大小', 2, 40, 8, 1, ''), R('relief', '凸现', 0, 20, 8, 1, '')],
  apply: function (env, p) {
    var cell = mosaicCore(env, p.size);
    var d = env.read();
    tileBevel(d, env.w, env.h, cell, 0, Math.round(p.relief / 3));
    env.write(d);
  }
});
F({
  id: 'stained-glass', name: '染色玻璃', group: '纹理', hint: '彩色玻璃格',
  params: [R('cell', '单元格', 4, 80, 16, 1, 'px'), R('border', '边框宽度', 1, 12, 3, 1, ''), R('light', '光照强度', 0, 10, 4, 1, ''), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var V = FX.voronoi(w, h, p.cell, p.seed, true);
    var cnt = V.px.length;
    var avg = FX.cellAverage(d, w, h, V.idx, cnt);
    var out = new Uint8ClampedArray(d.length);
    var bw = p.border;
    for (var i = 0, n = w * h; i < n; i++) {
      var id = V.idx[i], o = i << 2;
      var ed = V.edge[i];
      var b = ed < bw ? clamp(ed / bw, 0, 1) : 1;
      var shade = 1 + (p.light - 4) * 0.06 * (1 - clamp(V.dist[i] / (p.cell * 0.8), 0, 1));
      out[o] = c255(avg.r[id] * b * shade);
      out[o + 1] = c255(avg.g[id] * b * shade);
      out[o + 2] = c255(avg.b[id] * b * shade);
      out[o + 3] = 255;
    }
    env.write(out);
  }
});
F({
  id: 'texturizer', name: '纹理化', group: '纹理', hint: '砖块 / 画布 / 粗麻布等材质',
  params: [S('texture', '纹理', [['brick', '砖形'], ['burlap', '粗麻布'], ['canvas', '画布'], ['sandstone', '砂岩']], 'canvas'), R('scale', '缩放', 20, 300, 100, 1, '%'), R('relief', '凸现', 0, 50, 12, 1, ''), S('light', '光照方向', [['top', '顶'], ['bottom', '底'], ['left', '左'], ['right', '右']], 'top'), C('invert', '反相', false), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var scale = Math.max(2, 18 * p.scale / 100);
    var T = FX.textureField(p.texture, w, h, scale, p.seed);
    var q;
    if (p.invert) for (q = 0; q < T.length; q++) T[q] = 1 - T[q];
    var dx = p.light === 'left' ? -1 : (p.light === 'right' ? 1 : 0);
    var dy = p.light === 'top' ? -1 : (p.light === 'bottom' ? 1 : 0);
    var k = p.relief * 0.35;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, o = i << 2;
        var x2 = clamp(x + dx, 0, w - 1), y2 = clamp(y + dy, 0, h - 1);
        var g = (T[i] - T[y2 * w + x2]) * k * 26;
        var base = (T[i] - 0.5) * 24;
        d[o] = c255(d[o] + g + base);
        d[o + 1] = c255(d[o + 1] + g + base);
        d[o + 2] = c255(d[o + 2] + g + base);
      }
    }
    env.write(d);
  }
});

/* ============================================================
 * 渲染
 * ============================================================ */
F({
  id: 'clouds', name: '云彩', group: '渲染', hint: '用前景/背景色生成分形云团',
  params: [R('scale', '颗粒大小', 2, 120, 26, 1, 'px'), R('octaves', '层次', 1, 8, 5, 1, ''), R('contrast', '对比度', 0, 200, 100, 1, '%'), R('opacity', '不透明度', 5, 100, 100, 1, '%'), C('useColors', '使用前景 / 背景色', true), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var nf = FX.noise2(p.seed), s = Math.max(2, p.scale);
    var fg = FG(env), bg = BG(env);
    if (!p.useColors) { fg = { r: 255, g: 255, b: 255 }; bg = { r: 0, g: 0, b: 0 }; }
    var k = p.contrast / 100, op = p.opacity / 100;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = FX.fbm(nf, x / s, y / s, p.octaves, 0.55);
        v = clamp((v - 0.5) * k + 0.5, 0, 1);
        var o = (y * w + x) << 2;
        d[o] = c255(d[o] * (1 - op) + mixv(bg.r, fg.r, v) * op);
        d[o + 1] = c255(d[o + 1] * (1 - op) + mixv(bg.g, fg.g, v) * op);
        d[o + 2] = c255(d[o + 2] * (1 - op) + mixv(bg.b, fg.b, v) * op);
        d[o + 3] = c255(d[o + 3] * (1 - op) + 255 * op);
      }
    }
    env.write(d);
  }
});
F({
  id: 'difference-clouds', name: '分层云彩', group: '渲染', hint: '在现有画面上叠加云彩差值',
  params: [R('scale', '颗粒大小', 2, 120, 26, 1, 'px'), R('octaves', '层次', 1, 8, 5, 1, ''), R('strength', '强度', 5, 100, 55, 1, '%'), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var nf = FX.noise2(p.seed), s = Math.max(2, p.scale), k = p.strength / 100;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = FX.fbm(nf, x / s, y / s, p.octaves, 0.55) * 255;
        var o = (y * w + x) << 2;
        d[o] = c255(d[o] + (Math.abs(d[o] - v) - d[o]) * k);
        d[o + 1] = c255(d[o + 1] + (Math.abs(d[o + 1] - v) - d[o + 1]) * k);
        d[o + 2] = c255(d[o + 2] + (Math.abs(d[o + 2] - v) - d[o + 2]) * k);
      }
    }
    env.write(d);
  }
});
F({
  id: 'fibers', name: '纤维', group: '渲染', hint: '纵向纤维纹理',
  params: [R('variance', '差异', 1, 64, 16, 1, ''), R('strength', '强度', 1, 64, 20, 1, ''), R('opacity', '不透明度', 5, 100, 100, 1, '%'), C('useColors', '使用前景 / 背景色', true), SEED()],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var rnd = FX.mulberry32(p.seed);
    var field = new Float32Array(w * h);
    for (var x = 0; x < w; x++) {
      var v = rnd();
      for (var y = 0; y < h; y++) {
        v += (rnd() - 0.5) * (p.variance / 6);
        v = clamp(v, 0, 1);
        field[y * w + x] = v;
      }
    }
    var fg = FG(env), bg = BG(env);
    if (!p.useColors) { fg = { r: 255, g: 255, b: 255 }; bg = { r: 0, g: 0, b: 0 }; }
    var op = p.opacity / 100;
    for (var i = 0, n = w * h; i < n; i++) {
      var t = clamp(field[i] * (1 + (p.strength - 1) / 20), 0, 1);
      var o = i << 2;
      d[o] = c255(d[o] * (1 - op) + mixv(bg.r, fg.r, t) * op);
      d[o + 1] = c255(d[o + 1] * (1 - op) + mixv(bg.g, fg.g, t) * op);
      d[o + 2] = c255(d[o + 2] * (1 - op) + mixv(bg.b, fg.b, t) * op);
      d[o + 3] = c255(d[o + 3] * (1 - op) + 255 * op);
    }
    env.write(d);
  }
});
F({
  id: 'lens-flare', name: '镜头光晕', group: '渲染', hint: '逆光拍摄时的光斑',
  params: [R('x', '光晕中心 X', 0, 100, 50, 1, '%'), R('y', '光晕中心 Y', 0, 100, 45, 1, '%'), R('brightness', '亮度', 10, 300, 120, 1, '%'), R('size', '光晕大小', 10, 150, 60, 1, '%'), S('type', '镜头类型', [['zoom', '50-300mm 变焦'], ['focus', '35mm 聚焦'], ['prime', '105mm 定焦'], ['movie', '电影镜头']], 'zoom')],
  apply: function (env, p) {
    var w = env.w, h = env.h, ctx = env.ctx;
    var cx = w * p.x / 100, cy = h * p.y / 100;
    var R = Math.max(20, Math.min(w, h) * p.size / 100);
    var b = p.brightness / 100;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    /* 主光晕 */
    var g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g1.addColorStop(0, 'rgba(255,250,230,' + Math.min(1, 0.95 * b) + ')');
    g1.addColorStop(0.25, 'rgba(255,235,190,' + Math.min(1, 0.42 * b) + ')');
    g1.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    /* 光斑轨迹 */
    var ghosts = p.type === 'prime' ? 3 : (p.type === 'focus' ? 5 : 7);
    var dcx = w / 2 - cx, dcy = h / 2 - cy;
    var colors = [['90,150,255'], ['255,120,160'], ['120,255,200'], ['255,200,110'], ['190,130,255']];
    for (var i = 1; i <= ghosts; i++) {
      var t = -0.45 * i + 0.25;
      var gx = cx + dcx * t * 2, gy = cy + dcy * t * 2;
      var gr = R * (0.08 + 0.06 * i);
      var col = colors[(i - 1) % colors.length];
      var g2 = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g2.addColorStop(0, 'rgba(' + col + ',' + Math.min(1, 0.3 * b) + ')');
      g2.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, PI2); ctx.fill();
    }
    /* 星芒 */
    if (p.type !== 'focus') {
      var rays = p.type === 'movie' ? 6 : 4;
      ctx.save();
      ctx.translate(cx, cy);
      for (var k = 0; k < rays; k++) {
        ctx.rotate(Math.PI / rays);
        var g3 = ctx.createLinearGradient(0, 0, R * 2.2, 0);
        g3.addColorStop(0, 'rgba(255,250,220,' + Math.min(1, 0.5 * b) + ')');
        g3.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g3;
        ctx.beginPath();
        ctx.moveTo(0, -R * 0.035);
        ctx.lineTo(R * 2.2, 0);
        ctx.lineTo(0, R * 0.035);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    env._data = null;
  }
});
F({
  id: 'lighting', name: '光照效果', group: '渲染', hint: '把明暗当凹凸，重新打光',
  params: [S('life', '光照类型', [['parallel', '平行光'], ['point', '点光'], ['omni', '全光源']], 'parallel'),
    AN('angle', '光照角度', 135), R('intensity', '强度', 1, 100, 42, 1, ''),
    R('bump', '凹凸强度', 1, 100, 30, 1, ''), R('gloss', '光泽', 0, 100, 25, 1, '%'),
    R('material', '材质', -100, 100, 60, 1, ''), R('ambient', '环境', 0, 100, 18, 1, '%')],
  pad: 3,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var L = FX.luma(d, w, h);
    var lx, ly, lz;
    if (p.life === 'parallel') {
      lx = Math.cos(FX.deg2rad(p.angle)); ly = -Math.sin(FX.deg2rad(p.angle)); lz = 0.55;
    } else if (p.life === 'point') {
      lx = 0.6; ly = -0.7; lz = 0.4;
    } else { lx = 0; ly = 0; lz = 1; }
    var ln = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= ln; ly /= ln; lz /= ln;
    var bump = p.bump / 12, I = p.intensity / 42, amb = p.ambient / 100;
    var shin = 4 + p.gloss / 4, spec = p.gloss / 100 * (1 + p.material / 100);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var gx = (L[i - 1] - L[i + 1]) / 255 * bump;
        var gy = (L[i - w] - L[i + w]) / 255 * bump;
        var nz = 1;
        var nn = Math.sqrt(gx * gx + gy * gy + nz * nz);
        var nx = gx / nn, ny = gy / nn; nz = nz / nn;
        var dot = Math.max(0, nx * lx + ny * ly + nz * lz);
        var diff = Math.pow(dot, 1 + (1 - p.gloss / 100));
        var hx = lx, hy = ly, hz = lz + 1;
        var hn = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
        var rdot = Math.max(0, nx * (hx / hn) + ny * (hy / hn) + nz * (hz / hn));
        var sp = Math.pow(rdot, shin) * spec * 255;
        var k = amb + diff * I;
        var o = i << 2;
        d[o] = c255(d[o] * k + sp);
        d[o + 1] = c255(d[o + 1] * k + sp);
        d[o + 2] = c255(d[o + 2] * k + sp);
      }
    }
    env.write(d);
  }
});

/* ============================================================
 * 视频
 * ============================================================ */
F({
  id: 'ntsc', name: 'NTSC 色域', group: '视频', hint: '限制色域到电视广播范围',
  params: [R('chroma', '色度压缩', 0, 100, 60, 1, '%'), R('bleed', '色度扩散', 0, 20, 3, 1, 'px'), R('gamma', '亮度补偿', 50, 150, 100, 1, '%')],
  pad: 22,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var k = p.chroma / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var l = gray(d[i], d[i + 1], d[i + 2]);
      for (var c = 0; c < 3; c++) d[i + c] = c255(l + (d[i + c] - l) * (1 - k * 0.8));
    }
    env.write(d);
    if (p.bleed > 0) {
      var dd = env.read();
      var src = new Uint8ClampedArray(dd);
      var N = Math.max(1, Math.round(p.bleed));
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var o = (y * w + x) << 2;
          var o1 = (y * w + clamp(x - N, 0, w - 1)) << 2;
          dd[o] = c255(src[o] * 0.7 + src[o1] * 0.3);
          dd[o + 1] = c255(src[o + 1] * 0.85 + src[o1 + 1] * 0.15);
          dd[o + 2] = c255(src[o + 2] * 0.55 + src[o1 + 2] * 0.45);
        }
      }
      env.write(dd);
    }
    var g = p.gamma / 100;
    if (g !== 1) {
      var l2 = FX.linLUT(function (v) { return Math.pow(v, g); });
      FX.applyLUT(env.read(), l2);
      env.write(env._data.data);
    }
  }
});
F({
  id: 'deinterlace', name: '逐行', group: '视频', hint: '消除隔行扫描的横纹',
  params: [S('mode', '方法', [['dup', '复制'], ['interp', '插值']], 'interp'), C('odd', '处理奇数行', true)],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    for (var y = 0; y < h; y++) {
      if ((y % 2 === 1) !== p.odd) continue;
      var up = clamp(y - 1, 0, h - 1), dn = clamp(y + 1, 0, h - 1);
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) << 2, a = (up * w + x) << 2, b = (dn * w + x) << 2;
        for (var c = 0; c < 4; c++) d[o + c] = p.mode === 'dup' ? src[a + c] : (src[a + c] + src[b + c]) / 2;
      }
    }
    env.write(d);
  }
});

/* ============================================================
 * 其他
 * ============================================================ */
F({
  id: 'high-pass', name: '高反差保留', group: '其他', hint: '只留细节，配合叠加/柔光做精细锐化',
  params: [R('radius', '半径', 0.1, 40, 6, 0.1, 'px'), R('mix', '灰度基线', 0, 255, 128, 1, '')],
  pad: function (p) { return Math.ceil(p.radius * 2.4) + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var blurred = new Uint8ClampedArray(d);
    FX.gaussBlur(blurred, w, h, p.radius);
    var base = p.mix;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = c255(d[i] - blurred[i] + base);
      d[i + 1] = c255(d[i + 1] - blurred[i + 1] + base);
      d[i + 2] = c255(d[i + 2] - blurred[i + 2] + base);
    }
    env.write(d);
  }
});
F({
  id: 'custom', name: '自定', group: '其他', hint: '自定义 5 × 5 卷积矩阵',
  params: [{ key: 'matrix', label: '矩阵', type: 'matrix5', def: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, R('offset', '偏移', -255, 255, 0, 1, '')],
  pad: 3,
  apply: function (env, p) {
    var m = p.matrix, div = 0;
    for (var i = 0; i < 25; i++) div += m[i];
    if (Math.abs(div) < 0.0001) div = 1;
    FX.conv2d(env.read(), env.w, env.h, m, 5, { divisor: div, bias: p.offset });
    env.write(env._data.data);
  }
});
F({
  id: 'offset', name: '位移', group: '其他', hint: '整体平移并循环接缝',
  params: [R('dx', '水平', -2000, 2000, 0, 1, 'px'), R('dy', '垂直', -2000, 2000, 0, 1, 'px'), S('mode', '未定义区域', [['wrap', '折回'], ['edge', '重复边缘像素']], 'wrap')],
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var src = new Uint8ClampedArray(d);
    var out = new Uint8ClampedArray(d.length);
    var dx = Math.round(p.dx), dy = Math.round(p.dy);
    for (var y = 0; y < h; y++) {
      var sy = y - dy;
      for (var x = 0; x < w; x++) {
        var sx = x - dx;
        if (p.mode === 'wrap') { sy = ((sy % h) + h) % h; sx = ((sx % w) + w) % w; }
        else { sy = clamp(sy, 0, h - 1); sx = clamp(sx, 0, w - 1); }
        var so = (sy * w + sx) << 2, o = (y * w + x) << 2;
        out[o] = src[so]; out[o + 1] = src[so + 1]; out[o + 2] = src[so + 2]; out[o + 3] = src[so + 3];
      }
    }
    env.write(out);
  }
});
F({
  id: 'maximum', name: '最大值', group: '其他', hint: '邻域取最亮，可收细线 / 扩张亮部',
  params: [R('radius', '半径', 1, 12, 2, 1, 'px')],
  pad: function (p) { return p.radius + 1; },
  apply: function (env, p) { FX.rank(env.read(), env.w, env.h, p.radius, 'max'); env.write(env._data.data); }
});
F({
  id: 'minimum', name: '最小值', group: '其他', hint: '邻域取最暗，可加粗线条',
  params: [R('radius', '半径', 1, 12, 2, 1, 'px')],
  pad: function (p) { return p.radius + 1; },
  apply: function (env, p) { FX.rank(env.read(), env.w, env.h, p.radius, 'min'); env.write(env._data.data); }
});
F({
  id: 'sharpen-contrast', name: '色调对比锐化', group: '锐化', hint: '分色调分别锐化，减少噪点放大',
  params: [R('shadows', '阴影', -100, 100, 20, 1, ''), R('mid', '中间调', -100, 100, 40, 1, ''), R('highlights', '高光', -100, 100, 10, 1, '')],
  pad: 3,
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var sharp = new Uint8ClampedArray(d);
    unsharpCore(sharp, w, h, 1.2, 0.8, 0);
    for (var i = 0; i < d.length; i += 4) {
      var l = gray(d[i], d[i + 1], d[i + 2]) / 255;
      var wt = l < 0.33 ? p.shadows / 100 : (l > 0.66 ? p.highlights / 100 : p.mid / 100);
      for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] + (sharp[i + c] - d[i + c]) * wt);
    }
    env.write(d);
  }
});

})(window);

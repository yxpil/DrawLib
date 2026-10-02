/* ============================================================
 * DrawLib · filters.js
 * 滤镜引擎核心
 *   DL.fx       像素内核（模糊 / 卷积 / 中值 / 重映射 / 查表 / 噪声）
 *   DL.filters  滤镜与调整的注册表 + 执行器 + 通用参数对话框
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL = global.DL || {};
var PI2 = Math.PI * 2;

/* ------------------------------------------------------------
 * 0. 通用小工具
 * ---------------------------------------------------------- */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
function deg2rad(d) { return d * PI2 / 360; }
function grayOf(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
function mixv(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function hex2rgb(h) { var c = DL.hexToRgb(h); return c || { r: 0, g: 0, b: 0 }; }

/* 确定性随机（同一 seed 永远得到同一结果） */
function mulberry32(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 二维值噪声 + 分形叠加 */
function noiseField(seed) {
  var rnd = mulberry32(seed == null ? 1 : seed);
  var G = 256, grid = new Float32Array(G * G);
  for (var i = 0; i < G * G; i++) grid[i] = rnd();
  function at(ix, iy) { return grid[((iy & 255) << 8) + (ix & 255)]; }
  return function (x, y) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = smoothstep(x - x0), fy = smoothstep(y - y0);
    var a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return mixv(mixv(a, b, fx), mixv(c, d, fx), fy);
  };
}
function fbm(noise, x, y, oct, gain) {
  var s = 0, amp = 1, tot = 0, f = 1;
  oct = Math.max(1, oct || 4);
  for (var i = 0; i < oct; i++) { s += noise(x * f, y * f) * amp; tot += amp; amp *= (gain == null ? 0.5 : gain); f *= 2; }
  return s / (tot || 1);
}

/* ------------------------------------------------------------
 * 1. 像素内核 DL.fx
 * ---------------------------------------------------------- */
var FX = DL.fx = {};
FX.clamp = clamp;
FX.clamp255 = clamp255;
FX.grayOf = grayOf;
FX.mix = mixv;
FX.smoothstep = smoothstep;
FX.deg2rad = deg2rad;
FX.hex2rgb = hex2rgb;
FX.mulberry32 = mulberry32;
FX.noise2 = noiseField;
FX.fbm = fbm;

/* 临时画布池（避免频繁分配） */
var _pool = [];
FX.temp = function (w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  for (var i = 0; i < _pool.length; i++) {
    var c = _pool[i];
    if (c._free && c.width >= w && c.height >= h) {
      c._free = false;
      c.width = c.width; /* 保持 */
      var g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
      g.clearRect(0, 0, c.width, c.height);
      return c;
    }
  }
  var n = DL.createCanvas(w, h);
  n._free = false;
  _pool.push(n);
  if (_pool.length > 24) _pool = _pool.filter(function (x) { return !x._free; });
  return n;
};
FX.release = function (c) { if (c) c._free = true; };

/* 双线性采样（越界钳制） */
var _s4 = [0, 0, 0, 0];
FX.sample = function (d, w, h, sx, sy, out) {
  out = out || _s4;
  if (sx < 0) sx = 0; else if (sx > w - 1) sx = w - 1;
  if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
  var x0 = sx | 0, y0 = sy | 0;
  var x1 = x0 + 1 < w ? x0 + 1 : w - 1, y1 = y0 + 1 < h ? y0 + 1 : h - 1;
  var fx = sx - x0, fy = sy - y0;
  var i00 = (y0 * w + x0) << 2, i10 = (y0 * w + x1) << 2, i01 = (y1 * w + x0) << 2, i11 = (y1 * w + x1) << 2;
  for (var c = 0; c < 4; c++) {
    var a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
    var b = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
    out[c] = a + (b - a) * fy;
  }
  return out;
};

/* ---------- 滑动窗口盒式模糊（保持 alpha 正确） ---------- */
function boxPass(src, dst, w, h, r, horiz) {
  var win = r * 2 + 1;
  var n = w * h;
  if (horiz) {
    for (var y = 0; y < h; y++) {
      var o = y * w, sum = 0, k;
      for (k = -r; k <= r; k++) sum += src[o + clamp(k, 0, w - 1)];
      for (var x = 0; x < w; x++) {
        dst[o + x] = sum / win;
        sum += src[o + clamp(x + r + 1, 0, w - 1)] - src[o + clamp(x - r, 0, w - 1)];
      }
    }
  } else {
    for (var x2 = 0; x2 < w; x2++) {
      var sum2 = 0, k2;
      for (k2 = -r; k2 <= r; k2++) sum2 += src[clamp(k2, 0, h - 1) * w + x2];
      for (var y2 = 0; y2 < h; y2++) {
        dst[y2 * w + x2] = sum2 / win;
        sum2 += src[clamp(y2 + r + 1, 0, h - 1) * w + x2] - src[clamp(y2 - r, 0, h - 1) * w + x2];
      }
    }
  }
  return dst;
}
FX.boxBlur = function (d, w, h, r, passes) {
  r = Math.max(0, Math.round(r));
  if (r < 1) return d;
  passes = passes || 1;
  var n = w * h, i;
  var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), T = new Float32Array(n);
  for (i = 0; i < n; i++) { var a = d[(i << 2) + 3] / 255; A[i] = a; R[i] = d[i << 2] * a; G[i] = d[(i << 2) + 1] * a; B[i] = d[(i << 2) + 2] * a; }
  for (var p = 0; p < passes; p++) {
    boxPass(R, T, w, h, r, true); boxPass(T, R, w, h, r, false);
    boxPass(G, T, w, h, r, true); boxPass(T, G, w, h, r, false);
    boxPass(B, T, w, h, r, true); boxPass(T, B, w, h, r, false);
    boxPass(A, T, w, h, r, true); boxPass(T, A, w, h, r, false);
  }
  for (i = 0; i < n; i++) {
    var al = A[i], o = i << 2;
    if (al < 0.0025) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; continue; }
    d[o] = R[i] / al; d[o + 1] = G[i] / al; d[o + 2] = B[i] / al; d[o + 3] = al * 255;
  }
  return d;
};

/* 高斯核（奇数尺寸） */
FX.gaussKernel = function (sigma) {
  var r = Math.max(1, Math.ceil(sigma * 3));
  var size = r * 2 + 1, k = new Float32Array(size * size), sum = 0;
  for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++) {
    var v = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
    k[(y + r) * size + (x + r)] = v; sum += v;
  }
  for (var i = 0; i < k.length; i++) k[i] /= sum;
  return { k: k, size: size };
};

/* 卷积：alpha 加权，避免透明边缘发黑 */
FX.conv2d = function (d, w, h, kern, size, opts) {
  opts = opts || {};
  var divisor = opts.divisor || 1, bias = opts.bias || 0;
  var aware = opts.alpha !== false;
  var out = new Uint8ClampedArray(d.length);
  var r = (size - 1) >> 1;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var R = 0, G = 0, B = 0, A = 0, o = (y * w + x) << 2;
      for (var j = 0; j < size; j++) {
        var sy = y + j - r;
        if (sy < 0 || sy >= h) continue;
        for (var i = 0; i < size; i++) {
          var kv = kern[j * size + i];
          if (kv === 0) continue;
          var sx = x + i - r;
          if (sx < 0 || sx >= w) continue;
          var so = (sy * w + sx) << 2;
          var al = d[so + 3] / 255;
          var af = aware ? al : 1;
          R += d[so] * af * kv; G += d[(so) + 1] * af * kv; B += d[so + 2] * af * kv; A += d[so + 3] * kv;
        }
      }
      R = R / divisor + bias; G = G / divisor + bias; B = B / divisor + bias;
      if (aware) {
        var aa = A / 255;
        if (aa > 0.004) { R /= aa; G /= aa; B /= aa; } else { R = G = B = 0; }
      }
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = A;
    }
  }
  d.set(out);
  return d;
};

FX.gaussBlur = function (d, w, h, sigma) {
  if (sigma <= 0.05) return d;
  if (sigma < 1.6) {
    var gk = FX.gaussKernel(sigma);
    return FX.conv2d(d, w, h, gk.k, gk.size);
  }
  var r = Math.max(1, Math.round(sigma * 0.85));
  return FX.boxBlur(d, w, h, r, 3);
};

/* 中值 / 最大值 / 最小值（排序滤波） */
FX.rank = function (d, w, h, radius, mode) {
  radius = Math.max(1, Math.round(radius));
  var out = new Uint8ClampedArray(d.length);
  var win = (radius * 2 + 1) * (radius * 2 + 1);
  var buf = new Uint8Array(win);
  var tmp = [];
  function pick(n) {
    var i;
    if (mode === 'max') { var m = buf[0]; for (i = 1; i < n; i++) if (buf[i] > m) m = buf[i]; return m; }
    if (mode === 'min') { var m2 = buf[0]; for (i = 1; i < n; i++) if (buf[i] < m2) m2 = buf[i]; return m2; }
    tmp.length = 0;
    for (i = 0; i < n; i++) tmp.push(buf[i]);
    tmp.sort(function (p, q) { return p - q; });
    return tmp[tmp.length >> 1];
  }
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var o = (y * w + x) << 2;
      for (var c = 0; c < 4; c++) {
        var n = 0;
        for (var j = -radius; j <= radius; j++) {
          var sy = clamp(y + j, 0, h - 1);
          for (var i = -radius; i <= radius; i++) {
            buf[n++] = d[((sy * w + clamp(x + i, 0, w - 1)) << 2) + c];
          }
        }
        out[o + c] = pick(n);
      }
    }
  }
  d.set(out);
  return d;
};

/* 灰度/亮度场 */
FX.luma = function (d, w, h) {
  var n = w * h, L = new Float32Array(n);
  for (var i = 0; i < n; i++) {
    var o = i << 2, a = d[o + 3] / 255;
    L[i] = grayOf(d[o], d[o + 1], d[o + 2]) * a;
  }
  return L;
};

/* Sobel 梯度幅值（0..255） */
FX.edges = function (d, w, h) {
  var L = FX.luma(d, w, h);
  var out = new Float32Array(w * h);
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * w + x;
      var gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      var gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      out[i] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }
  return out;
};

/* 几何重映射：mapFn(px,py) → [sx,sy]（区域内的坐标，0..w） */
FX.warp = function (env, mapFn, opts) {
  opts = opts || {};
  var w = env.w, h = env.h;
  var src = env.read();
  var out = new Uint8ClampedArray(w * h * 4);
  var tmp = [0, 0, 0, 0];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var p = mapFn(x + 0.5, y + 0.5);
      var sx = p[0] - 0.5, sy = p[1] - 0.5;
      var o = (y * w + x) << 2;
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) {
        if (!opts.clamp) { out[o + 3] = 0; continue; }
      }
      FX.sample(src, w, h, sx, sy, tmp);
      out[o] = tmp[0]; out[o + 1] = tmp[1]; out[o + 2] = tmp[2]; out[o + 3] = tmp[3];
    }
  }
  env.write(out);
};

/* 多份错位副本平均（碎片 / 风 / 涂抹棒等） */
FX.shiftStack = function (env, offsets, mode) {
  var w = env.w, h = env.h;
  var src = env.read();
  var out = new Uint8ClampedArray(w * h * 4);
  var n = offsets.length;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var o = (y * w + x) << 2;
      var R = 0, G = 0, B = 0, A = 0;
      for (var k = 0; k < n; k++) {
        var sx = clamp(x + offsets[k][0], 0, w - 1), sy = clamp(y + offsets[k][1], 0, h - 1);
        var so = ((sy * w + sx) << 2);
        var l = d3(src, so);
        if (mode === 'dark' && k > 0) l = Math.min(l, d3(src, o));
        if (mode === 'light' && k > 0) l = Math.max(l, d3(src, o));
        R += src[so]; G += src[so + 1]; B += src[so + 2]; A += src[so + 3];
      }
      out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n; out[o + 3] = A / n;
    }
  }
  env.write(out);
};
function d3(d, o) { return d[o] + d[o + 1] + d[o + 2]; }

/* 查表 */
FX.applyLUT = function (d, lut) {
  var n = d.length;
  for (var i = 0; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
  }
  return d;
};
FX.applyLUTs = function (d, lr, lg, lb) {
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]];
  }
  return d;
};
FX.linLUT = function (fn) {
  var lut = new Uint8Array(256);
  for (var i = 0; i < 256; i++) lut[i] = clamp255(Math.round(fn(i / 255) * 255));
  return lut;
};
FX.identityLUT = function () { var l = new Uint8Array(256); for (var i = 0; i < 256; i++) l[i] = i; return l; };

/* 单调三次插值曲线 → 256 级查表 */
FX.curveLUT = function (points, levels) {
  var P = (points || []).slice().map(function (p) { return [clamp(p[0], 0, 1), clamp(p[1], 0, 1)]; });
  P.sort(function (a, b) { return a[0] - b[0]; });
  var uniq = [];
  for (var i = 0; i < P.length; i++) {
    if (uniq.length && Math.abs(uniq[uniq.length - 1][0] - P[i][0]) < 1e-4) { uniq[uniq.length - 1] = P[i]; continue; }
    uniq.push(P[i]);
  }
  P = uniq;
  if (!P.length) P = [[0, 0], [1, 1]];
  if (P[0][0] > 0.0001) P.unshift([0, P[0][1]]);
  if (P[P.length - 1][0] < 0.9999) P.push([1, P[P.length - 1][1]]);
  var n = P.length;
  var xs = P.map(function (p) { return p[0]; }), ys = P.map(function (p) { return p[1]; });
  /* Fritsch–Carlson 单调 Hermite */
  var d = [], m = [];
  for (var k = 0; k < n - 1; k++) d[k] = (ys[k + 1] - ys[k]) / Math.max(1e-9, xs[k + 1] - xs[k]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (var j = 1; j < n - 1; j++) {
    if (d[j - 1] * d[j] <= 0) m[j] = 0;
    else m[j] = (d[j - 1] + d[j]) / 2;
  }
  for (var q = 0; q < n - 1; q++) {
    if (d[q] === 0) { m[q] = 0; m[q + 1] = 0; continue; }
    var a = m[q] / d[q], b = m[q + 1] / d[q], s = a * a + b * b;
    if (s > 9) { var t = 3 / Math.sqrt(s); m[q] = t * a * d[q]; m[q + 1] = t * b * d[q]; }
  }
  levels = levels || 256;
  var lut = new Uint8Array(levels);
  for (var v = 0; v < levels; v++) {
    var x = v / (levels - 1), seg = n - 2;
    for (var s2 = 0; s2 < n - 1; s2++) { if (x <= xs[s2 + 1]) { seg = s2; break; } }
    var hx = Math.max(1e-9, xs[seg + 1] - xs[seg]);
    var t2 = clamp((x - xs[seg]) / hx, 0, 1);
    var h00 = (1 + 2 * t2) * (1 - t2) * (1 - t2);
    var h10 = t2 * (1 - t2) * (1 - t2);
    var h01 = t2 * t2 * (3 - 2 * t2);
    var h11 = t2 * t2 * (t2 - 1);
    var y = h00 * ys[seg] + h10 * hx * m[seg] + h01 * ys[seg + 1] + h11 * hx * m[seg + 1];
    lut[v] = clamp255(Math.round(y * 255));
  }
  return lut;
};
/* 展开成 256 级（用于直接索引 0..255 的通道） */
FX.lut256 = function (lut) {
  if (lut.length === 256) return lut;
  var o = new Uint8Array(256);
  for (var i = 0; i < 256; i++) o[i] = lut[clamp(Math.round(i * (lut.length - 1) / 255), 0, lut.length - 1)];
  return o;
};

/* ------------------------------------------------------------
 * 2. 注册表
 * ---------------------------------------------------------- */
var REG = [];
var BY_ID = {};
var GROUPS = {};

/* 分类排序表（PS 风格顺序） */
DL.filters = {
  list: REG,
  groups: GROUPS,
  groupOrder: {
    '模糊': 10, '锐化': 20, '杂色': 30, '像素化': 40, '扭曲': 50, '风格化': 60,
    '素描': 70, '艺术效果': 80, '画笔描边': 90, '纹理': 100, '渲染': 110, '视频': 120, '其他': 130,
    '基础调整': 1000, '色彩调整': 1010, '色调调整': 1020, '高级调整': 1030
  },
  register: function (def) {
    if (!def || !def.id) throw new Error('滤镜必须有 id');
    if (BY_ID[def.id]) throw new Error('滤镜 id 重复：' + def.id);
    def.kind = def.kind || 'filter';
    def.params = def.params || [];
    def.name = def.name || def.id;
    def.group = def.group || '其他';
    if (typeof def.apply !== 'function') throw new Error('滤镜 ' + def.id + ' 缺少 apply');
    if (def.groupOrder == null) {
      var order = DL.filters.groupOrder;
      def.groupOrder = order[def.group] == null ? 500 : order[def.group];
    }
    BY_ID[def.id] = def;
    REG.push(def);
    if (!GROUPS[def.kind]) GROUPS[def.kind] = [];
    if (GROUPS[def.kind].indexOf(def.group) < 0) {
      GROUPS[def.kind].push(def.group);
      GROUPS[def.kind].sort(function (a, b) {
        var oa = 999, ob = 999;
        REG.forEach(function (x) {
          if (x.group === a) oa = Math.min(oa, x.groupOrder);
          if (x.group === b) ob = Math.min(ob, x.groupOrder);
        });
        return oa - ob;
      });
    }
    return def;
  },
  get: function (id) { return BY_ID[id] || null; },
  /* 供插件注销 / 重载后重建索引 */
  _setIndex: function (byId, groups) {
    var k;
    for (k in BY_ID) if (Object.prototype.hasOwnProperty.call(BY_ID, k)) delete BY_ID[k];
    for (k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) BY_ID[k] = byId[k];
    for (k in GROUPS) if (Object.prototype.hasOwnProperty.call(GROUPS, k)) delete GROUPS[k];
    for (k in groups) if (Object.prototype.hasOwnProperty.call(groups, k)) GROUPS[k] = groups[k];
  },
  all: function (kind) {
    return REG.filter(function (d) { return !kind || d.kind === kind; });
  },
  inGroup: function (kind, group) {
    return REG.filter(function (d) { return (!kind || d.kind === kind) && d.group === group; });
  },
  /* 按 kind 返回已排序的分类名 */
  groupNames: function (kind) {
    var names = [];
    DL.filters.all().forEach(function (d) {
      if (kind && d.kind !== kind) return;
      if (names.indexOf(d.group) < 0) names.push(d.group);
    });
    names.sort(function (a, b) {
      var oa = 999, ob = 999;
      REG.forEach(function (x) {
        if (!kind || x.kind === kind) {
          if (x.group === a) oa = Math.min(oa, x.groupOrder);
          if (x.group === b) ob = Math.min(ob, x.groupOrder);
        }
      });
      return oa - ob;
    });
    return names;
  },
  /* 参数默认值 */
  defaults: function (def) {
    var v = {};
    (def.params || []).forEach(function (p) {
      v[p.key] = p.type === 'curve' ? JSON.parse(JSON.stringify(p.def || [[0, 0], [0.5, 0.5], [1, 1]]))
        : p.type === 'matrix5' ? (p.def || []).slice()
          : p.def;
    });
    return v;
  },
  /* 只保留定义中仍存在的参数，并补齐缺失项 */
  mergeParams: function (def, saved) {
    var v = DL.filters.defaults(def);
    if (saved) (def.params || []).forEach(function (p) {
      if (saved[p.key] !== undefined) v[p.key] = saved[p.key];
    });
    return v;
  }
};

/* ------------------------------------------------------------
 * 3. 执行器
 * ---------------------------------------------------------- */
function makeEnv(canvas, region, mask, ctxInfo) {
  var ctx = canvas.getContext('2d');
  var env = {
    x: region.x, y: region.y, w: canvas.width, h: canvas.height,
    canvas: canvas, ctx: ctx, mask: mask || null,
    fg: ctxInfo.fg, bg: ctxInfo.bg, app: ctxInfo.app, def: ctxInfo.def, params: ctxInfo.params,
    _data: null,
    read: function () {
      if (!this._data) this._data = ctx.getImageData(0, 0, this.w, this.h);
      return this._data.data;
    },
    write: function (d) {
      var img = this._data;
      if (!img) { img = ctx.createImageData(this.w, this.h); this._data = img; }
      img.data.set(d);
      ctx.putImageData(img, 0, 0);
    },
    img: function () { return ctx.getImageData(0, 0, this.w, this.h); },
    put: function (imgd) { ctx.putImageData(imgd, 0, 0); this._data = imgd; },
    /* 区域内的选区权重（0..1），无选区时返回 null */
    maskAt: function (x, y) {
      if (!this.mask) return 1;
      x = clamp(x | 0, 0, this.w - 1); y = clamp(y | 0, 0, this.h - 1);
      return this.mask[y * this.w + x] / 255;
    },
    rnd: function (seed) { return mulberry32(seed == null ? 1 : seed); },
    noise: function (seed) { return noiseField(seed == null ? 1 : seed); },
    fbm: fbm
  };
  return env;
}
DL.filters.makeEnv = makeEnv;

function cropMask(mask, docW, region) {
  var out = new Uint8Array(region.w * region.h);
  for (var y = 0; y < region.h; y++) {
    var sy = region.y + y;
    for (var x = 0; x < region.w; x++) {
      var v = mask[sy * docW + region.x + x];
      out[y * region.w + x] = v > 255 ? 255 : (v || 0);
    }
  }
  return out;
}
DL.filters.cropMask = cropMask;

/* 选区蒙版 → 区域内 alpha 画布（支持羽化软边） */
function maskRegionCanvas(mask, docW, region, valueAlpha) {
  var c = DL.createCanvas(region.w, region.h);
  var g = c.getContext('2d');
  var img = g.createImageData(region.w, region.h);
  var d = img.data;
  for (var y = 0; y < region.h; y++) {
    var sy = region.y + y;
    for (var x = 0; x < region.w; x++) {
      var v = mask[sy * docW + region.x + x];
      var a = valueAlpha ? (v > 255 ? 255 : v) : (v ? 255 : 0);
      var o = (y * region.w + x) << 2;
      d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
DL.filters.maskRegionCanvas = maskRegionCanvas;

/* 计算作用区域 */
DL.filters.regionFor = function (app, def, params) {
  var d = app.doc;
  var pad = typeof def.pad === 'function' ? def.pad(params) : (def.pad || 0);
  var r = app.selection ? app.selection.rect : { x: 0, y: 0, w: d.width, h: d.height };
  r = DL.rectGrow(r, pad);
  return DL.rectClip(r, d.width, d.height);
};

/* 在任意「源画布 + 区域」上执行一次（供主流程和预览共用） */
DL.filters.runRegion = function (def, params, srcCanvas, region, mask, cfg) {
  var canvas = DL.createCanvas(region.w, region.h);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(srcCanvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  var env = makeEnv(canvas, region, mask, cfg || {});
  def.apply(env, params, env);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  return env;
};

/* 应用到图层并记录历史 */
DL.filters.run = function (app, def, params, opts) {
  opts = opts || {};
  var d = app.doc, layer = d.activeLayer();
  if (!layer) return false;
  if (layer.locked) { app.status('图层已锁定，无法应用' + def.name); return false; }
  if (d.width < 1 || d.height < 1) return false;
  var region = DL.filters.regionFor(app, def, params);
  if (!region || region.w < 1 || region.h < 1) { app.status('作用区域为空'); return false; }
  var mask = app.selection ? cropMask(app.selection.mask, d.width, region) : null;
  var before = DL.getRect(layer.canvas, region.x, region.y, region.w, region.h);
  var env;
  try {
    env = DL.filters.runRegion(def, params, layer.canvas, region, mask,
      { fg: app.fg(), bg: app.settings.bgColor, app: app, def: def, params: params });
  } catch (err) {
    app.status('滤镜执行失败：' + err.message);
    if (global.console) console.error(err);
    return false;
  }
  /* 合成回图层：out = 原图*(1-a) + 结果*a，支持羽化软边 */
  var lg = layer.ctx;
  lg.save();
  lg.setTransform(1, 0, 0, 1, 0, 0);
  lg.globalAlpha = 1;
  if (mask) {
    var mc = maskRegionCanvas(app.selection.mask, d.width, region, !!app.selection.soft);
    var patch = DL.createCanvas(region.w, region.h);
    var pg = patch.getContext('2d');
    pg.setTransform(1, 0, 0, 1, 0, 0);
    pg.drawImage(env.canvas, 0, 0);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(mc, 0, 0);
    lg.globalCompositeOperation = 'destination-out';
    lg.drawImage(mc, region.x, region.y);
    lg.globalCompositeOperation = 'source-over';
    lg.drawImage(patch, region.x, region.y);
  } else {
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(region.x, region.y, region.w, region.h);
    lg.drawImage(env.canvas, region.x, region.y);
  }
  lg.restore();
  lg.globalAlpha = 1;
  lg.globalCompositeOperation = 'source-over';
  layer.touch();
  var after = DL.getRect(layer.canvas, region.x, region.y, region.w, region.h);
  app.history.record(DL.pixelEntry(d, layer.id, region, before, after, def.name));
  app.invalidate();
  if (app.ui) {
    app.ui.updateUndo();
    app.ui.refreshLayers();
    app.ui.refreshHistory && app.ui.refreshHistory();
  }
  app.requestRender();
  return true;
};

/* 上次使用的滤镜（Ctrl+F 重复） */
var LAST_KEY = 'drawlib.fx.last';
DL.filters.last = null;
DL.filters.remember = function (def, params) {
  DL.filters.last = { id: def.id, params: JSON.parse(JSON.stringify(params)) };
  try { global.localStorage.setItem(LAST_KEY, JSON.stringify(DL.filters.last)); } catch (e) { }
};
DL.filters.loadLast = function () {
  try {
    var s = global.localStorage.getItem(LAST_KEY);
    if (s) DL.filters.last = JSON.parse(s);
  } catch (e) { }
};
DL.filters.perParam = {};
DL.filters.saveParams = function (def, params) {
  try { global.localStorage.setItem('drawlib.fx.p.' + def.id, JSON.stringify(params)); } catch (e) { }
};
DL.filters.savedParams = function (def) {
  try {
    var s = global.localStorage.getItem('drawlib.fx.p.' + def.id);
    if (s) return DL.filters.mergeParams(def, JSON.parse(s));
  } catch (e) { }
  return null;
};
DL.filters.repeatLast = function (app) {
  if (!DL.filters.last) { app.status('还没有使用过滤镜'); return false; }
  var def = DL.filters.get(DL.filters.last.id);
  if (!def) { app.status('上次的滤镜已不存在（可能来自已卸载的插件）'); return false; }
  var params = DL.filters.mergeParams(def, DL.filters.last.params);
  if (DL.filters.run(app, def, params)) app.status('已重复：' + def.name);
  return true;
};

/* ------------------------------------------------------------
 * 4. 参数界面
 * ---------------------------------------------------------- */
function fmtVal(p, v) {
  if (p.fmt) return p.fmt(v);
  if (p.type === 'range') {
    var step = p.step || 1;
    var dec = step < 0.1 ? 2 : (step < 1 ? 1 : 0);
    return (p.unit === '%' ? v.toFixed(dec) + '%' : v.toFixed(dec) + (p.unit || ''));
  }
  if (p.type === 'check') return v ? '开' : '关';
  return String(v);
}

DL.filters.paramsHTML = function (def, v) {
  return (def.params || []).map(function (p) {
    var id = 'fp-' + p.key;
    if (p.type === 'range') {
      return '<div class="fx-row"><label>' + p.label + '</label>' +
        '<input type="range" data-p="' + p.key + '" id="' + id + '" min="' + p.min + '" max="' + p.max +
        '" step="' + (p.step || 1) + '" value="' + v[p.key] + '">' +
        '<span class="val" data-v="' + p.key + '">' + fmtVal(p, v[p.key]) + '</span></div>';
    }
    if (p.type === 'select') {
      return '<div class="fx-row"><label>' + p.label + '</label><select data-p="' + p.key + '">' +
        (p.options || []).map(function (o) {
          return '<option value="' + o[0] + '"' + (String(v[p.key]) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select><span class="val"></span></div>';
    }
    if (p.type === 'check') {
      return '<div class="fx-row fx-row-chk"><label></label><label class="fx-chk"><input type="checkbox" data-p="' + p.key + '"' +
        (v[p.key] ? ' checked' : '') + '> ' + p.label + '</label><span class="val"></span></div>';
    }
    if (p.type === 'color') {
      return '<div class="fx-row"><label>' + p.label + '</label>' +
        '<input type="color" class="fx-color" data-p="' + p.key + '" value="' + v[p.key] + '"><span class="val"></span></div>';
    }
    if (p.type === 'angle') {
      return '<div class="fx-row"><label>' + p.label + '</label>' +
        '<input type="range" data-p="' + p.key + '" min="' + (p.min == null ? -180 : p.min) + '" max="' + (p.max == null ? 180 : p.max) +
        '" step="1" value="' + v[p.key] + '"><span class="val" data-v="' + p.key + '">' + v[p.key] + '°</span></div>';
    }
    if (p.type === 'curve') {
      return '<div class="fx-row fx-curve-row"><label>' + p.label + '</label>' +
        '<div class="fx-curve"><canvas width="196" height="196" data-curve="' + p.key + '"></canvas>' +
        '<div class="fx-curve-tip">点击添加控制点 · 拖动调整 · 右键删除</div></div><span class="val"></span>' +
        '<button class="btn xs" data-curve-reset="' + p.key + '">复位</button></div>';
    }
    if (p.type === 'matrix5') {
      var cells = '';
      for (var i = 0; i < 25; i++) {
        cells += '<input type="number" class="fx-mx" data-mx="' + i + '" step="0.1" value="' + v[p.key][i] + '">';
      }
      return '<div class="fx-matrix">' + cells + '</div>' +
        '<div class="fx-row"><span class="opt-note">矩阵权值之和为 0 以外的值时按 1 归一化；右下角为偏移量。</span></div>';
    }
    return '';
  }).join('');
};

DL.filters.wireParams = function (root, def, v, onChange) {
  var F = DL.filters;
  var debounce = null;
  function fire() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(onChange, 40);
  }
  (def.params || []).forEach(function (p) {
    var el = root.querySelector('[data-p="' + p.key + '"]');
    if (!el) return;
    if (p.type === 'range' || p.type === 'angle') {
      function upd() {
        v[p.key] = parseFloat(el.value);
        var lab = root.querySelector('[data-v="' + p.key + '"]');
        if (lab) lab.textContent = p.type === 'angle' ? Math.round(v[p.key]) + '°' : fmtVal(p, v[p.key]);
        fire();
      }
      el.addEventListener('input', upd);
      el.addEventListener('change', onChange);
      var lab0 = root.querySelector('[data-v="' + p.key + '"]');
      if (lab0) lab0.textContent = p.type === 'angle' ? Math.round(v[p.key]) + '°' : fmtVal(p, v[p.key]);
    } else if (p.type === 'select') {
      el.addEventListener('change', function () { v[p.key] = el.value; onChange(); });
    } else if (p.type === 'check') {
      el.addEventListener('change', function () { v[p.key] = el.checked; fire(); });
    } else if (p.type === 'color') {
      el.addEventListener('input', function () { v[p.key] = el.value; fire(); });
      el.addEventListener('change', function () { v[p.key] = el.value; onChange(); });
    } else if (p.type === 'curve') {
      bindCurve(root, el, p, v, fire, onChange);
    } else if (p.type === 'matrix5') {
      root.querySelectorAll('[data-mx]').forEach(function (mx) {
        mx.addEventListener('input', function () {
          v[p.key][parseInt(mx.dataset.mx, 10)] = parseFloat(mx.value) || 0;
          fire();
        });
        mx.addEventListener('change', onChange);
      });
    }
  });
  /* 复位按钮 */
  root.querySelectorAll('[data-curve-reset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.dataset.curveReset;
      v[key] = F.defaults(def)[key];
      var cv = root.querySelector('[data-curve="' + key + '"]');
      drawCurve(cv, v[key]);
      onChange();
    });
  });
  return v;
};

function drawCurve(cv, pts) {
  if (!cv) return;
  var g = cv.getContext('2d');
  var W = cv.width, H = cv.height, S = W - 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#141821';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2b313b';
  g.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var t = Math.round(i * S / 4) + 0.5;
    g.beginPath(); g.moveTo(t, 0); g.lineTo(t, H); g.stroke();
    g.beginPath(); g.moveTo(0, t); g.lineTo(W, t); g.stroke();
  }
  g.strokeStyle = 'rgba(120,130,150,.5)';
  g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
  var lut = DL.fx.curveLUT(pts, 128);
  g.strokeStyle = '#7aa2ff';
  g.lineWidth = 2;
  g.beginPath();
  for (var x = 0; x < 128; x++) {
    var px = x / 127 * S, py = H - 1 - (lut[x] / 255) * (H - 1);
    if (x === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
  g.fillStyle = '#dfe6f3';
  (pts || []).forEach(function (p) {
    g.beginPath();
    g.arc(p[0] * S, H - 1 - p[1] * (H - 1), 4.5, 0, PI2);
    g.fill();
    g.strokeStyle = '#10141b'; g.lineWidth = 1.5; g.stroke();
  });
}
DL.filters.drawCurve = drawCurve;

function bindCurve(root, cv, p, v, fire, commit) {
  var pts = v[p.key];
  var S = cv.width - 1;
  var drag = -1;
  function toCurve(e) {
    var r = cv.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1)
    };
  }
  function nearest(c) {
    var best = -1, bd = 0.06;
    for (var i = 0; i < pts.length; i++) {
      var dx = Math.abs(pts[i][0] - c.x), dy = Math.abs(pts[i][1] - c.y);
      if (dx < bd && dy < bd) { bd = Math.max(dx, dy); best = i; }
    }
    return best;
  }
  function sortPts() { pts.sort(function (a, b) { return a[0] - b[0]; }); }
  cv.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    var c = toCurve(e), i = nearest(c);
    if (e.button === 2 || e.shiftKey) {
      if (i >= 0 && pts.length > 2 && i !== 0 && i !== pts.length - 1) { pts.splice(i, 1); sortPts(); }
      drawCurve(cv, pts); fire();
      return;
    }
    if (i < 0) { pts.push([c.x, c.y]); sortPts(); i = nearest(c); }
    drag = i;
    drawCurve(cv, pts);
  });
  cv.addEventListener('pointermove', function (e) {
    if (drag < 0) return;
    var c = toCurve(e);
    var isEnd = (drag === 0 || drag === pts.length - 1);
    if (isEnd) { pts[drag][0] = drag === 0 ? 0 : 1; pts[drag][1] = c.y; }
    else {
      var lo = pts[drag - 1][0] + 0.01, hi = pts[drag + 1][0] - 0.01;
      pts[drag][0] = clamp(c.x, lo, hi);
      pts[drag][1] = c.y;
    }
    drawCurve(cv, pts);
    fire();
  });
  cv.addEventListener('pointerup', function () { drag = -1; commit(); });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  drawCurve(cv, pts);
}
DL.filters.bindCurve = bindCurve;

/* ------------------------------------------------------------
 * 5. 对话框（滤镜库 / 单个滤镜）
 * ---------------------------------------------------------- */
var PVW_W = 336, PVW_H = 252;
var CUR = { def: null, params: null, mode: 'single' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function previewRegion(app, def, params) {
  var d = app.doc;
  var pad = typeof def.pad === 'function' ? def.pad(params) : (def.pad || 0);
  var r = app.selection ? app.selection.rect : { x: 0, y: 0, w: d.width, h: d.height };
  r = DL.rectClip(DL.rectGrow(r, pad), d.width, d.height);
  return r;
}

DL.filters.renderPreview = function (app, def, params, cvs) {
  if (!cvs) return;
  var g = cvs.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cvs.width, cvs.height);
  var region = previewRegion(app, def, params);
  if (!region || region.w < 1) return;
  var s = Math.min(PVW_W / region.w, PVW_H / region.h, 1);
  var pw = Math.max(1, Math.round(region.w * s)), ph = Math.max(1, Math.round(region.h * s));
  var src = (def.kind === 'adjust' || def.source === 'merged') ? app.merged() : app.doc.activeLayer().canvas;
  var small = DL.createCanvas(pw, ph);
  var sc = small.getContext('2d');
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = 'high';
  try {
    sc.drawImage(src, region.x, region.y, region.w, region.h, 0, 0, pw, ph);
  } catch (e) { return; }
  /* 缩放后的选区掩码（最近邻） */
  var mask = null;
  if (app.selection) {
    mask = new Uint8Array(pw * ph);
    var m = app.selection.mask, dw = app.doc.width;
    for (var y = 0; y < ph; y++) {
      var sy = region.y + Math.min(region.h - 1, Math.floor(y / s));
      for (var x = 0; x < pw; x++) {
        var sx = region.x + Math.min(region.w - 1, Math.floor(x / s));
        mask[y * pw + x] = m[sy * dw + sx] ? 255 : 0;
      }
    }
  }
  var env = makeEnv(small, { x: 0, y: 0 }, mask,
    { fg: app.fg(), bg: app.settings.bgColor, app: app, def: def, params: params });
  try { def.apply(env, params, env); } catch (e) { }
  /* 画到预览画布中央 */
  var ox = Math.round((cvs.width - pw) / 2), oy = Math.round((cvs.height - ph) / 2);
  g.imageSmoothingEnabled = false;
  g.drawImage(env.canvas, 0, 0, pw, ph, ox, oy, pw, ph);
  g.imageSmoothingEnabled = true;
  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.strokeRect(ox + 0.5, oy + 0.5, pw - 1, ph - 1);
  return { w: pw, h: ph };
};

DL.filters.openDialog = function (app, def, opts) {
  opts = opts || {};
  var gallery = !!opts.gallery;
  var params = (opts.params ? DL.filters.mergeParams(def, opts.params) : null) || DL.filters.savedParams(def) || DL.filters.defaults(def);
  var enabled = true;
  var pvTimer = null;

  function headerHTML() {
    return '<div class="fx-head"><div><div class="fx-title">' + esc(def.name) + '</div>' +
      '<div class="fx-sub">' + esc(def.group) + ' · ' + (def.kind === 'adjust' ? '调整' : '滤镜') +
      (def.author ? ' · by ' + esc(def.author) : '') + (def._plugin ? ' · 插件' : '') + '</div></div>' +
      '<div class="fx-help">' + esc(def.hint || '') + '</div></div>';
  }

  function bodyHTML() {
    var html = headerHTML();
    html += '<div class="fx-wrap' + (gallery ? ' with-list' : '') + '">';
    if (gallery) {
      html += '<div class="fx-groups" id="fx-groups"></div><div class="fx-list" id="fx-list"></div>';
    }
    html += '<div class="fx-main">' +
      '<div class="fx-pvw"><canvas id="fx-preview" width="' + PVW_W + '" height="' + PVW_H + '"></canvas>' +
      '<div class="fx-pvw-bar">' +
      '<label class="fx-chk"><input type="checkbox" id="fx-pv-on" checked> 预览</label>' +
      '<span class="fx-pv-info" id="fx-pv-info">—</span>' +
      '</div></div>' +
      '<div class="fx-params" id="fx-params"></div>' +
      '<div class="fx-foot"><button class="btn xs" id="fx-reset">复位参数</button>' +
      '<span class="opt-note" id="fx-sel-note"></span></div>' +
      '</div></div>';
    return html;
  }

  return DL.dialog({
    title: gallery ? '滤镜库' : def.name,
    wide: true,
    html: bodyHTML(),
    actions: [
      { label: '取消', value: null },
      { label: '应用', value: 'ok', primary: true }
    ],
    onMount: function (root) {
      var pv = root.querySelector('#fx-preview');
      var pvOn = root.querySelector('#fx-pv-on');
      var paramsBox = root.querySelector('#fx-params');
      var info = root.querySelector('#fx-pv-info');
      var noteEl = root.querySelector('#fx-sel-note');
      if (noteEl) noteEl.textContent = app.selection ? '作用范围：当前选区' : '作用范围：整个图层';

      function refreshPreview() {
        if (pvTimer) clearTimeout(pvTimer);
        pvTimer = setTimeout(function () {
          if (!pvOn.checked) {
            var g = pv.getContext('2d');
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, pv.width, pv.height);
            pv.style.opacity = '.35';
            return;
          }
          pv.style.opacity = '1';
          var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
          var r = DL.filters.renderPreview(app, def, params, pv);
          var t1 = (global.performance && performance.now) ? performance.now() : Date.now();
          if (info && r) info.textContent = r.w + ' × ' + r.h + ' · ' + Math.round(t1 - t0) + ' ms';
        }, 50);
      }
      function mountParams(withPreview) {
        paramsBox.innerHTML = DL.filters.paramsHTML(def, params);
        DL.filters.wireParams(paramsBox, def, params, function () {
          if (withPreview !== false) refreshPreview();
        });
        if (withPreview !== false) refreshPreview();
      }
      CUR.def = def; CUR.params = params;
      mountParams(true);

      root.querySelector('#fx-reset').addEventListener('click', function () {
        params = DL.filters.defaults(def);
        CUR.params = params;
        mountParams(true);
      });

      pvOn.addEventListener('change', refreshPreview);

      /* 滤镜库：分类 + 列表 */
      if (gallery) {
        var groupsEl = root.querySelector('#fx-groups');
        var listEl = root.querySelector('#fx-list');
        var kinds = opts.kind ? [opts.kind] : null;
        var groupNames = [];
        if (kinds) {
          kinds.forEach(function (k) {
            DL.filters.groupNames(k).forEach(function (g) { if (groupNames.indexOf(g) < 0) groupNames.push(g); });
          });
        } else {
          groupNames = DL.filters.groupNames(null);
        }
        var currentGroup = (opts.group && groupNames.indexOf(opts.group) >= 0) ? opts.group : (groupNames.indexOf(def.group) >= 0 ? def.group : groupNames[0]);
        function renderGroups() {
          groupsEl.innerHTML = groupNames.map(function (g) {
            return '<button class="fx-g' + (g === currentGroup ? ' on' : '') + '" data-g="' + esc(g) + '">' + esc(g) +
              '<i>' + DL.filters.inGroup(null, g).length + '</i></button>';
          }).join('');
          groupsEl.querySelectorAll('.fx-g').forEach(function (b) {
            b.addEventListener('click', function () {
              currentGroup = b.dataset.g;
              renderGroups(); renderList();
            });
          });
        }
        function renderList() {
          listEl.innerHTML = DL.filters.inGroup(null, currentGroup).map(function (d) {
            return '<button class="fx-item' + (d.id === def.id ? ' on' : '') + '" data-id="' + esc(d.id) + '">' +
              '<span>' + esc(d.name) + '</span>' + (d._plugin ? '<i class="fx-plug">插件</i>' : '') + '</button>';
          }).join('');
          listEl.querySelectorAll('.fx-item').forEach(function (b) {
            b.addEventListener('click', function () {
              var nd = DL.filters.get(b.dataset.id);
              if (!nd) return;
              def = nd;
              params = DL.filters.savedParams(nd) || DL.filters.defaults(nd);
              var t = root.querySelector('.fx-title'), s = root.querySelector('.fx-sub'), h = root.querySelector('.fx-help');
              if (t) t.textContent = nd.name;
              if (s) s.textContent = nd.group + ' · ' + (nd.kind === 'adjust' ? '调整' : '滤镜') + (nd._plugin ? ' · 插件' : '');
              if (h) h.textContent = nd.hint || '';
              var okb = root.querySelector('.btn.primary');
              if (okb) okb.textContent = nd.kind === 'adjust' ? '应用调整' : '应用';
              renderList();
              mountParams(true);
            });
          });
        }
        renderGroups(); renderList();
      }
    }
  }).then(function (r) {
    if (r.action !== 'ok') return null;
    return { def: def, params: params };
  });
};

/* 打开某个滤镜（带对话框），返回 Promise */
DL.filters.open = function (app, id, opts) {
  var def = DL.filters.get(id);
  if (!def) { app.status('找不到滤镜：' + id); return Promise.resolve(null); }
  return DL.filters.openDialog(app, def, opts);
};

/* 打开滤镜库 */
DL.filters.gallery = function (app, opts) {
  var first = DL.filters.all()[0];
  if (!first) { app.status('滤镜库为空'); return Promise.resolve(null); }
  var o = opts || {};
  if (o.id && DL.filters.get(o.id)) first = DL.filters.get(o.id);
  return DL.filters.openDialog(app, first, { gallery: true, group: o.group, kind: o.kind });
};

/* 打开并应用（供菜单直接调用） */
DL.filters.applyDialog = function (app, id, opts) {
  return DL.filters.open(app, id, opts).then(function (res) {
    if (!res) return false;
    var ok = DL.filters.run(app, res.def, res.params);
    if (ok) {
      DL.filters.remember(res.def, res.params);
      DL.filters.saveParams(res.def, res.params);
      app.status('已应用' + (res.def.kind === 'adjust' ? '调整' : '滤镜') + '：' + res.def.name);
    }
    return ok;
  });
};

/* 重复上次滤镜（不带对话框） */
DL.filters.loadLast();

/* 直接应用（不弹对话框），供「重复滤镜 / 最后一次参数」使用 */
DL.filters.applyDirect = function (app, id, params) {
  var def = DL.filters.get(id);
  if (!def) { app.status('滤镜不存在：' + (id || '—')); return false; }
  var p = params ? DL.filters.mergeParams(def, params)
                 : (DL.filters.savedParams(def) || DL.filters.defaults(def));
  var ok = DL.filters.run(app, def, p);
  if (ok) {
    DL.filters.remember(def, p);
    DL.filters.saveParams(def, p);
    app.status('已应用' + (def.kind === 'adjust' ? '调整' : '滤镜') + '：' + def.name);
  }
  return ok;
};

/* 打开上次滤镜的参数对话框（Ctrl+Alt+F） */
DL.filters.dialogLast = function (app) {
  var last = DL.filters.last;
  if (!last) { app.status('还没有使用过滤镜'); return Promise.resolve(false); }
  var def = DL.filters.get(last.id);
  if (!def) { app.status('上次的滤镜已不存在（可能来自已卸载的插件）'); return Promise.resolve(false); }
  return DL.filters.applyDialog(app, def.id, { params: last.params });
};

/* 打开滤镜库（选中并应用，不再二次弹窗） */
DL.filters.openGallery = function (app, opts) {
  return DL.filters.gallery(app, opts).then(function (r) {
    if (!r) return false;
    return DL.filters.applyDirect(app, r.def.id, r.params);
  });
};
})(window);

/* ============================================================
 * DrawLib · adjustments.js
 * 调整菜单（PS 风格「图像 → 调整」）
 *   基础调整 / 色彩调整 / 色调调整
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;
var FX = DL.fx;

function A(def) { def.kind = 'adjust'; DL.filters.register(def); }
function R(key, label, min, max, def, step, unit) {
  return { key: key, label: label, type: 'range', min: min, max: max, def: def, step: step == null ? 1 : step, unit: unit || '' };
}
function S(key, label, options, def) { return { key: key, label: label, type: 'select', options: options, def: def }; }
function C(key, label, def) { return { key: key, label: label, type: 'check', def: !!def }; }

var clamp = FX.clamp, c255 = FX.clamp255, gray = FX.grayOf, mixv = FX.mix;

/* ------------------------------------------------------------
 * 通用工具
 * ---------------------------------------------------------- */
function applyLUTChannel(d, lut, ch) {
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (ch < 0) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    else d[i + ch] = lut[d[i + ch]];
  }
  return d;
}
var CH_OPTS = [['rgb', 'RGB'], ['r', '红'], ['g', '绿'], ['b', '蓝']];
function chIndex(v) { return v === 'r' ? 0 : (v === 'g' ? 1 : (v === 'b' ? 2 : -1)); }

/* RGB ↔ HSL */
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2, d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s, l: l };
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  var r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}
/* 色相权重（用于按色域调整） */
var HUE_RANGES = {
  all: null,
  red: [0, 30], yellow: [30, 90], green: [90, 150], cyan: [150, 210], blue: [210, 270], magenta: [270, 330]
};
function hueWeight(h, range) {
  if (!range || range === 'all' || !HUE_RANGES[range]) return 1;
  var r = HUE_RANGES[range];
  var c = (r[0] + r[1]) / 2, half = (r[1] - r[0]) / 2 + 22;
  var d = Math.abs(((h - c + 540) % 360) - 180);
  return clamp(1 - (d - half * 0.45) / (half * 0.55), 0, 1);
}
/* 直方图 */
function histogram(d) {
  var H = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
  var total = 0;
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    H[0][d[i]]++; H[1][d[i + 1]]++; H[2][d[i + 2]]++; total++;
  }
  return { H: H, total: total };
}
function percentile(H, p) {
  var total = 0, i;
  for (i = 0; i < 256; i++) total += H[i];
  if (!total) return 0;
  var acc = 0;
  for (i = 0; i < 256; i++) { acc += H[i]; if (acc / total >= p) return i; }
  return 255;
}

/* ============================================================
 * 基础调整
 * ============================================================ */
A({
  id: 'brightness-contrast', name: '亮度/对比度', group: '基础调整', hint: '最常用的明暗调整',
  params: [R('brightness', '亮度', -150, 150, 0, 1, ''), R('contrast', '对比度', -100, 100, 0, 1, ''),
    C('brightnessLegacy', '使用旧版（线性）', true)],
  apply: function (env, p) {
    var d = env.read();
    var b = p.brightness, c = p.contrast;
    if (p.brightnessLegacy) {
      var k = (c + 100) / 100;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        for (var ch = 0; ch < 3; ch++) d[i + ch] = c255((d[i + ch] - 128) * k + 128 + b);
      }
    } else {
      var lut = FX.linLUT(function (v) {
        var x = v + b / 200;
        x = (x - 0.5) * (1 + c / 100) + 0.5;
        return clamp(x, 0, 1);
      });
      applyLUTChannel(d, lut, -1);
    }
    env.write(d);
  }
});
A({
  id: 'levels', name: '色阶', group: '基础调整', hint: '控制黑场 / 灰场 / 白场',
  params: [S('channel', '通道', CH_OPTS, 'rgb'),
    R('inBlack', '输入黑场', 0, 254, 0, 1, ''), R('inWhite', '输入白场', 1, 255, 255, 1, ''),
    R('gamma', '中间调', 0.1, 9.99, 1, 0.01, ''), R('outBlack', '输出黑场', 0, 255, 0, 1, ''), R('outWhite', '输出白场', 0, 255, 255, 1, '')],
  apply: function (env, p) {
    var ib = p.inBlack, iw = Math.max(ib + 1, p.inWhite), ob = p.outBlack, ow = p.outWhite;
    var lut = FX.linLUT(function (v) {
      var x = clamp((v * 255 - ib) / (iw - ib), 0, 1);
      x = Math.pow(x, 1 / Math.max(0.01, p.gamma));
      return clamp((ob + x * (ow - ob)) / 255, 0, 1);
    });
    applyLUTChannel(env.read(), lut, chIndex(p.channel));
    env.write(env._data.data);
  }
});
A({
  id: 'curves', name: '曲线', group: '基础调整', hint: '拖拽控制点，精细控制明暗与色彩',
  params: [S('channel', '通道', CH_OPTS, 'rgb'), { key: 'curve', label: '曲线', type: 'curve', def: [[0, 0], [0.5, 0.5], [1, 1]] }],
  apply: function (env, p) {
    var lut = FX.curveLUT(p.curve, 256);
    applyLUTChannel(env.read(), lut, chIndex(p.channel));
    env.write(env._data.data);
  }
});
A({
  id: 'exposure', name: '曝光度', group: '基础调整', hint: '模拟相机曝光补偿',
  params: [R('exposure', '曝光度', -5, 5, 0, 0.01, ''), R('offset', '位移', -0.5, 0.5, 0, 0.001, ''), R('gamma', '灰度系数', 0.1, 10, 1, 0.01, '')],
  apply: function (env, p) {
    var mul = Math.pow(2, p.exposure);
    var lut = FX.linLUT(function (v) {
      var x = clamp(v * mul + p.offset, 0, 1);
      return clamp(Math.pow(x, 1 / Math.max(0.05, p.gamma)), 0, 1);
    });
    applyLUTChannel(env.read(), lut, -1);
    env.write(env._data.data);
  }
});
function stretchChannels(env, loPct, hiPct, perChannel) {
  var d = env.read();
  var hs = histogram(d);
  var lo, hi;
  if (perChannel) {
    for (var c = 0; c < 3; c++) {
      lo = percentile(hs.H[c], loPct); hi = percentile(hs.H[c], hiPct);
      if (hi <= lo) continue;
      var lut = FX.linLUT(function (v) { return clamp((v * 255 - lo) / (hi - lo), 0, 1); });
      applyLUTChannel(d, lut, c);
    }
  } else {
    var minL = 255, maxL = 0;
    for (var k = 0; k < 3; k++) {
      minL = Math.min(minL, percentile(hs.H[k], loPct));
      maxL = Math.max(maxL, percentile(hs.H[k], hiPct));
    }
    if (maxL > minL) {
      var lut2 = FX.linLUT(function (v) { return clamp((v * 255 - minL) / (maxL - minL), 0, 1); });
      applyLUTChannel(d, lut2, -1);
    }
  }
  return d;
}
A({
  id: 'auto-tone', name: '自动色调', group: '基础调整', hint: '按直方图自动分配黑白场',
  params: [{ key: 'clip', label: '修剪', type: 'range', min: 0, max: 2, step: 0.01, def: 0.1, unit: '%' }],
  apply: function (env, p) { env.write(stretchChannels(env, p.clip / 100, 1 - p.clip / 100, true)); }
});
A({
  id: 'auto-contrast', name: '自动对比度', group: '基础调整', hint: '整体拉大明暗对比',
  params: [{ key: 'clip', label: '修剪', type: 'range', min: 0, max: 2, step: 0.01, def: 0.1, unit: '%' }],
  apply: function (env, p) { env.write(stretchChannels(env, p.clip / 100, 1 - p.clip / 100, false)); }
});
A({
  id: 'auto-color', name: '自动颜色', group: '基础调整', hint: '自动校正色偏',
  params: [{ key: 'strength', label: '强度', type: 'range', min: 0, max: 100, step: 1, def: 80, unit: '%' }],
  apply: function (env, p) {
    var d = env.read();
    var hs = histogram(d);
    var means = [];
    for (var c = 0; c < 3; c++) {
      var sum = 0, cnt = 0;
      for (var v = 0; v < 256; v++) { sum += v * hs.H[c][v]; cnt += hs.H[c][v]; }
      means[c] = cnt ? sum / cnt : 128;
    }
    var m = (means[0] + means[1] + means[2]) / 3;
    var k = p.strength / 100;
    var luts = [];
    for (var c2 = 0; c2 < 3; c2++) {
      var t = means[c2] - m;
      luts.push(FX.linLUT((function (tt) {
        return function (v) { return clamp(v - (tt / 255) * k, 0, 1); };
      })(t)));
    }
    FX.applyLUTs(d, luts[0], luts[1], luts[2]);
    env.write(d);
  }
});
A({
  id: 'invert', name: '反相', group: '基础调整', hint: '负片效果（Ctrl+I 同款）',
  params: [C('keepAlpha', '保留透明度', true)],
  apply: function (env, p) {
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    }
    env.write(d);
  }
});
A({
  id: 'posterize', name: '色调分离', group: '基础调整', hint: '减少色阶数，做扁平色块',
  params: [R('levels', '色阶数', 2, 64, 6, 1, '')],
  apply: function (env, p) { env.write(FX.posterize(env.read(), p.levels)); }
});
A({
  id: 'threshold', name: '阈值', group: '基础调整', hint: '转为纯黑白两色',
  params: [R('level', '阈值色阶', 1, 255, 128, 1, ''), R('soft', '柔化过渡', 0, 60, 0, 1, '')],
  apply: function (env, p) { env.write(FX.thresholdData(env.read(), p.level, p.soft)); }
});
A({
  id: 'desaturate', name: '去色', group: '基础调整', hint: '转灰度但保留原色彩模式',
  params: [R('amount', '数量', 0, 100, 100, 1, '%'), C('luminosity', '按亮度加权', true), C('tint', '轻微着色', false)],
  apply: function (env, p) {
    var d = env.read(), k = p.amount / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var g = p.luminosity ? gray(d[i], d[i + 1], d[i + 2]) : (d[i] + d[i + 1] + d[i + 2]) / 3;
      d[i] = c255(d[i] + (g - d[i]) * k);
      d[i + 1] = c255(d[i + 1] + (g - d[i + 1]) * k);
      d[i + 2] = c255(d[i + 2] + (g - d[i + 2]) * k);
    }
    if (p.tint) {
      for (var j = 0; j < d.length; j += 4) {
        if (d[j + 3] === 0) continue;
        d[j] = c255(d[j] + 6); d[j + 2] = c255(d[j + 2] - 6);
      }
    }
    env.write(d);
  }
});
A({
  id: 'equalize', name: '色调均化', group: '基础调整', hint: '直方图均衡，找回细节',
  params: [C('preserveColor', '保持色彩', true)],
  apply: function (env, p) {
    var d = env.read();
    var hs = histogram(d);
    var total = hs.total || 1;
    if (p.preserveColor) {
      var H = new Float64Array(256), i;
      for (i = 0; i < 256; i++) H[i] = (hs.H[0][i] + hs.H[1][i] + hs.H[2][i]) / 3;
      var cdf = new Float64Array(256), acc = 0, minV = 0;
      for (i = 0; i < 256; i++) { acc += H[i]; cdf[i] = acc; if (!minV && acc > 0) minV = acc; }
      var lut = new Uint8Array(256);
      for (i = 0; i < 256; i++) lut[i] = clamp(Math.round((cdf[i] - minV) / Math.max(1, total - minV) * 255), 0, 255);
      /* 保持色彩：对亮度均衡，再按比例缩放通道 */
      var src = new Uint8ClampedArray(d);
      for (var q = 0; q < d.length; q += 4) {
        if (d[q + 3] === 0) continue;
        var l = gray(src[q], src[q + 1], src[q + 2]);
        var nl = lut[clamp(Math.round(l), 0, 255)];
        var f = l > 1 ? nl / l : 1;
        d[q] = c255(src[q] * f); d[q + 1] = c255(src[q + 1] * f); d[q + 2] = c255(src[q + 2] * f);
      }
    } else {
      for (var c2 = 0; c2 < 3; c2++) {
        var cdf2 = new Float64Array(256), acc2 = 0, minV2 = 0;
        for (var v = 0; v < 256; v++) { acc2 += hs.H[c2][v]; cdf2[v] = acc2; if (!minV2 && acc2 > 0) minV2 = acc2; }
        var lut2 = new Uint8Array(256);
        for (var v2 = 0; v2 < 256; v2++) lut2[v2] = clamp(Math.round((cdf2[v2] - minV2) / Math.max(1, total - minV2) * 255), 0, 255);
        applyLUTChannel(d, lut2, c2);
      }
    }
    env.write(d);
  }
});

/* ============================================================
 * 色彩调整
 * ============================================================ */
A({
  id: 'hue-saturation', name: '色相/饱和度', group: '色彩调整', hint: '可只针对某一色域调节',
  params: [S('range', '编辑范围', [['all', '全图'], ['red', '红色'], ['yellow', '黄色'], ['green', '绿色'], ['cyan', '青色'], ['blue', '蓝色'], ['magenta', '洋红']], 'all'),
    R('hue', '色相', -180, 180, 0, 1, ''), R('saturation', '饱和度', -100, 100, 0, 1, ''),
    R('lightness', '明度', -100, 100, 0, 1, ''), C('colorize', '着色（转单色调）', false)],
  apply: function (env, p) {
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (p.colorize) {
        var rgbc = hsl2rgb(p.hue, clamp((p.saturation + 100) / 200, 0, 1), clamp((p.lightness + 100) / 200 + hsl.l * 0.6 - 0.3, 0, 1));
        d[i] = rgbc.r; d[i + 1] = rgbc.g; d[i + 2] = rgbc.b;
        continue;
      }
      var w = hueWeight(hsl.h, p.range);
      if (w <= 0.001) continue;
      var h = hsl.h + p.hue * w;
      var s = clamp(hsl.s + p.saturation / 100 * w, 0, 1);
      var l = clamp(hsl.l + p.lightness / 100 * w * (hsl.l > 0.5 ? 1 - hsl.l : hsl.l), 0, 1);
      if (p.saturation >= 0) s = clamp(hsl.s + (1 - hsl.s) * (p.saturation / 100) * w, 0, 1);
      var rgb = hsl2rgb(h, s, l);
      d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b;
    }
    env.write(d);
  }
});
A({
  id: 'vibrance', name: '自然饱和度', group: '色彩调整', hint: '提升淡色而不溢出鲜艳色',
  params: [R('vibrance', '自然饱和度', -100, 100, 30, 1, ''), R('saturation', '饱和度', -100, 100, 0, 1, '')],
  apply: function (env, p) {
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      var max = Math.max(d[i], d[i + 1], d[i + 2]) / 255;
      var sat = p.saturation / 100;
      var vib = p.vibrance / 100 * (1 - hsl.s) * (1 - Math.abs(max * 2 - 1));
      var s = clamp(hsl.s + hsl.s * sat + vib, 0, 1);
      var rgb = hsl2rgb(hsl.h, s, hsl.l);
      d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b;
    }
    env.write(d);
  }
});
A({
  id: 'color-balance', name: '色彩平衡', group: '色彩调整', hint: '分别微调阴影 / 中间调 / 高光的色偏',
  params: [
    R('sCR', '阴影 青↔红', -100, 100, 0, 1, ''), R('sMG', '阴影 洋红↔绿', -100, 100, 0, 1, ''), R('sYB', '阴影 黄↔蓝', -100, 100, 0, 1, ''),
    R('mCR', '中间调 青↔红', -100, 100, 0, 1, ''), R('mMG', '中间调 洋红↔绿', -100, 100, 0, 1, ''), R('mYB', '中间调 黄↔蓝', -100, 100, 0, 1, ''),
    R('hCR', '高光 青↔红', -100, 100, 0, 1, ''), R('hMG', '高光 洋红↔绿', -100, 100, 0, 1, ''), R('hYB', '高光 黄↔蓝', -100, 100, 0, 1, ''),
    C('preserve', '保持明度', true)],
  apply: function (env, p) {
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var l = gray(d[i], d[i + 1], d[i + 2]) / 255;
      var ws = Math.max(0, 1 - l * 2), wh = Math.max(0, l * 2 - 1), wm = 1 - ws - wh;
      var cr = (p.sCR * ws + p.mCR * wm + p.hCR * wh) / 100;
      var mg = (p.sMG * ws + p.mMG * wm + p.hMG * wh) / 100;
      var yb = (p.sYB * ws + p.mYB * wm + p.hYB * wh) / 100;
      var r = d[i] + cr * 60 - mg * 30 - yb * 20;
      var g = d[i + 1] - cr * 20 + mg * 60 - yb * 20;
      var b = d[i + 2] - cr * 20 - mg * 30 + yb * 60;
      if (p.preserve) {
        var nl = gray(r, g, b);
        var f = nl > 1 ? (l * 255) / nl : 1;
        r *= f; g *= f; b *= f;
      }
      d[i] = c255(r); d[i + 1] = c255(g); d[i + 2] = c255(b);
    }
    env.write(d);
  }
});
A({
  id: 'black-white', name: '黑白', group: '色彩调整', hint: '按色通道配比转灰度',
  params: [R('reds', '红色', -100, 300, 40, 1, '%'), R('yellows', '黄色', -100, 300, 60, 1, '%'), R('greens', '绿色', -100, 300, 40, 1, '%'),
    R('cyans', '青色', -100, 300, 60, 1, '%'), R('blues', '蓝色', -100, 300, 20, 1, '%'), R('magentas', '洋红', -100, 300, 80, 1, '%'),
    R('gamma', '灰度系数', 0.1, 3, 1, 0.01, ''), C('tint', '色调分离', false)],
  apply: function (env, p) {
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      var v = 0, wsum = 0;
      var ranges = [['red', p.reds], ['yellow', p.yellows], ['green', p.greens], ['cyan', p.cyans], ['blue', p.blues], ['magenta', p.magentas]];
      for (var k = 0; k < ranges.length; k++) {
        var w = hueWeight(hsl.h, ranges[k][0]) * hsl.s;
        v += ranges[k][1] * w;
        wsum += w;
      }
      var l = hsl.l * 255;
      var g = wsum > 0.001 ? l * (1 + (v / wsum) / 100 * 0.9) : l;
      g = c255(g);
      if (p.gamma !== 1) g = c255(Math.pow(g / 255, 1 / p.gamma) * 255);
      d[i] = g; d[i + 1] = g; d[i + 2] = g;
    }
    env.write(d);
  }
});
A({
  id: 'photo-filter', name: '照片滤镜', group: '色彩调整', hint: '模拟镜头色温滤镜',
  params: [S('preset', '滤镜', [['custom', '自定颜色'], ['warming85', '加温滤镜 (85)'], ['cooling80', '冷却滤镜 (80)'], ['warming81', '加温滤镜 (81)'], ['cooling82', '冷却滤镜 (82)'], ['sepia', '深褐色'], ['red', '红色'], ['yellow', '黄色'], ['green', '绿色'], ['cyan', '青色'], ['blue', '蓝色'], ['violet', '紫色']], 'warming85'),
    { key: 'color', label: '颜色', type: 'color', def: '#ec8a00' }, R('density', '浓度', 1, 100, 35, 1, '%'), C('preserve', '保留明度', true)],
  apply: function (env, p) {
    var preset = {
      warming85: '#ec8a00', cooling80: '#006dff', warming81: '#eba530', cooling82: '#00b0ff',
      sepia: '#a5652a', red: '#ff0000', yellow: '#ffee00', green: '#00c250', cyan: '#00fff0', blue: '#0037ff', violet: '#9b00ff'
    };
    var hex = p.preset === 'custom' ? p.color : (preset[p.preset] || '#ec8a00');
    var col = FX.rgb(hex);
    var k = p.density / 100;
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var r = d[i] * (1 - k) + col.r * k;
      var g = d[i + 1] * (1 - k) + col.g * k;
      var b = d[i + 2] * (1 - k) + col.b * k;
      if (p.preserve) {
        var l0 = gray(d[i], d[i + 1], d[i + 2]);
        var l1 = gray(r, g, b);
        var f = l1 > 1 ? l0 / l1 : 1;
        r *= f; g *= f; b *= f;
      }
      d[i] = c255(r); d[i + 1] = c255(g); d[i + 2] = c255(b);
    }
    env.write(d);
  }
});
A({
  id: 'channel-mixer', name: '通道混合器', group: '色彩调整', hint: '按比例混合错位通道',
  params: [C('mono', '单色', false),
    R('rr', '红：红', -200, 200, 100, 1, '%'), R('rg', '红：绿', -200, 200, 0, 1, '%'), R('rb', '红：蓝', -200, 200, 0, 1, '%'),
    R('gr', '绿：红', -200, 200, 0, 1, '%'), R('gg', '绿：绿', -200, 200, 100, 1, '%'), R('gb', '绿：蓝', -200, 200, 0, 1, '%'),
    R('br', '蓝：红', -200, 200, 0, 1, '%'), R('bg', '蓝：绿', -200, 200, 0, 1, '%'), R('bb', '蓝：蓝', -200, 200, 100, 1, '%'),
    R('const', '常数', -100, 100, 0, 1, '')],
  apply: function (env, p) {
    var d = env.read();
    var cst = p.const * 2.55;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      var r = (p.rr * r0 + p.rg * g0 + p.rb * b0) / 100 + cst;
      var g = (p.gr * r0 + p.gg * g0 + p.gb * b0) / 100 + cst;
      var b = (p.br * r0 + p.bg * g0 + p.bb * b0) / 100 + cst;
      if (p.mono) { var l = gray(r, g, b); r = g = b = l; }
      d[i] = c255(r); d[i + 1] = c255(g); d[i + 2] = c255(b);
    }
    env.write(d);
  }
});
A({
  id: 'selective-color', name: '可选颜色', group: '色彩调整', hint: '在某一色域里精确调整 CMYK',
  params: [S('range', '颜色', [['red', '红色'], ['yellow', '黄色'], ['green', '绿色'], ['cyan', '青色'], ['blue', '蓝色'], ['magenta', '洋红色'], ['white', '白色'], ['neutral', '中性色'], ['black', '黑色']], 'red'),
    R('cyan', '青色', -100, 100, 0, 1, '%'), R('magenta', '洋红', -100, 100, 0, 1, '%'),
    R('yellow', '黄色', -100, 100, 0, 1, '%'), R('black', '黑色', -100, 100, 0, 1, '%'), S('mode', '方法', [['rel', '相对'], ['abs', '绝对']], 'rel')],
  apply: function (env, p) {
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var hsl = rgb2hsl(r, g, b);
      var l = hsl.l, s = hsl.s;
      var w;
      if (p.range === 'white') w = clamp((l - 0.75) / 0.25, 0, 1) * (1 - s * 0.6);
      else if (p.range === 'black') w = clamp((0.25 - l) / 0.25, 0, 1) * (1 - s * 0.6);
      else if (p.range === 'neutral') w = (1 - clamp(Math.abs(l - 0.5) / 0.5, 0, 1)) * (1 - s * 0.5);
      else w = hueWeight(hsl.h, p.range) * clamp(s * 1.6, 0, 1);
      if (w <= 0.002) continue;
      var scale = p.mode === 'rel' ? 1 : 1;
      var cAdj = p.cyan / 100 * w * scale * (p.mode === 'rel' ? (1 - 0) : 1);
      var mAdj = p.magenta / 100 * w * scale;
      var yAdj = p.yellow / 100 * w * scale;
      var kAdj = p.black / 100 * w * (p.mode === 'rel' ? 0.6 : 0.9);
      var nr = r - cAdj * 55 + mAdj * 25 + yAdj * 25;
      var ng = g + cAdj * 25 - mAdj * 55 + yAdj * 25;
      var nb = b + cAdj * 25 + mAdj * 25 - yAdj * 55;
      var kf = 1 - kAdj;
      d[i] = c255(nr * kf); d[i + 1] = c255(ng * kf); d[i + 2] = c255(nb * kf);
    }
    env.write(d);
  }
});
A({
  id: 'replace-color', name: '替换颜色', group: '色彩调整', hint: '选中某色并换成新颜色',
  params: [R('hue', '目标色相', 0, 360, 0, 1, ''), R('tolerance', '颜色容差', 1, 100, 30, 1, '%'),
    { key: 'color', label: '替换为', type: 'color', def: '#ff5f6d' }, R('strength', '替换强度', 0, 100, 100, 1, '%'), C('preserveLum', '保留明暗', true)],
  apply: function (env, p) {
    var d = env.read();
    var col = FX.rgb(p.color);
    var tol = p.tolerance / 100 * 180;
    var k = p.strength / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      var dh = Math.abs(((hsl.h - p.hue + 540) % 360) - 180);
      if (dh > tol) continue;
      var w = (1 - dh / tol) * k * clamp(hsl.s * 1.8, 0, 1);
      var l = p.preserveLum ? hsl.l : hsl.l;
      var nc = hsl2rgb(rgb2hsl(col.r, col.g, col.b).h, rgb2hsl(col.r, col.g, col.b).s, l);
      d[i] = c255(d[i] * (1 - w) + nc.r * w);
      d[i + 1] = c255(d[i + 1] * (1 - w) + nc.g * w);
      d[i + 2] = c255(d[i + 2] * (1 - w) + nc.b * w);
    }
    env.write(d);
  }
});

/* ============================================================
 * 色调调整
 * ============================================================ */
A({
  id: 'gradient-map', name: '渐变映射', group: '色调调整', hint: '把明暗映射成渐变色',
  params: [S('preset', '渐变', [['fgbg', '前景色 → 背景色'], ['bw', '黑 → 白'], ['custom', '自定两色'], ['duotone', '双色调'], ['sunset', '日落'], ['ocean', '海洋'], ['film', '电影']], 'fgbg'),
    { key: 'colorA', label: '起始色', type: 'color', def: '#1b2a4a' },
    { key: 'colorB', label: '结束色', type: 'color', def: '#ffd36b' },
    R('mid', '中点', 10, 90, 50, 1, '%'), R('mix', '混合', 5, 100, 100, 1, '%')],
  apply: function (env, p) {
    var pairs = {
      bw: ['#000000', '#ffffff'], duotone: ['#0d2b45', '#f0a35e'], sunset: ['#2b1055', '#ffb86c'],
      ocean: ['#04202f', '#7ff0d0'], film: ['#16161d', '#e8d7a0']
    };
    var a, b;
    if (p.preset === 'fgbg') { a = env.fg; b = env.bg; }
    else if (p.preset === 'custom') { a = p.colorA; b = p.colorB; }
    else { a = pairs[p.preset][0]; b = pairs[p.preset][1]; }
    var ca = FX.rgb(a), cb = FX.rgb(b);
    var mid = p.mid / 100, k = p.mix / 100;
    var d = env.read();
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var l = gray(d[i], d[i + 1], d[i + 2]) / 255;
      var t = l < mid ? (l / Math.max(0.001, mid)) * 0.5 : 0.5 + (l - mid) / Math.max(0.001, 1 - mid) * 0.5;
      t = clamp(t, 0, 1);
      d[i] = c255(d[i] * (1 - k) + mixv(ca.r, cb.r, t) * k);
      d[i + 1] = c255(d[i + 1] * (1 - k) + mixv(ca.g, cb.g, t) * k);
      d[i + 2] = c255(d[i + 2] * (1 - k) + mixv(ca.b, cb.b, t) * k);
    }
    env.write(d);
  }
});
A({
  id: 'shadows-highlights', name: '阴影/高光', group: '色调调整', hint: '提亮暗部 / 回收高光，救回细节',
  params: [R('shadowAmount', '阴影数量', 0, 100, 35, 1, '%'), R('shadowTone', '阴影色调宽度', 0, 100, 50, 1, '%'), R('shadowRadius', '阴影半径', 1, 100, 30, 1, 'px'),
    R('highAmount', '高光数量', 0, 100, 15, 1, '%'), R('highTone', '高光色调宽度', 0, 100, 50, 1, '%'), R('highRadius', '高光半径', 1, 100, 30, 1, 'px'),
    R('colorCorrection', '颜色校正', -100, 100, 0, 1, ''), R('midtone', '中间调对比度', -100, 100, 0, 1, '')],
  pad: function (p) { return Math.ceil(Math.max(p.shadowRadius, p.highRadius) * 0.5) + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var base = new Uint8ClampedArray(d);
    FX.gaussBlur(base, w, h, Math.max(1, p.shadowRadius / 4));
    var base2 = new Uint8ClampedArray(d);
    FX.gaussBlur(base2, w, h, Math.max(1, p.highRadius / 4));
    var sa = p.shadowAmount / 100, st = p.shadowTone / 100;
    var ha = p.highAmount / 100, ht = p.highTone / 100;
    var cc = p.colorCorrection / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      for (var c = 0; c < 3; c++) {
        var v = d[i + c] / 255;
        var bv = base[i + c] / 255, bv2 = base2[i + c] / 255;
        var sw = clamp(1 - bv / Math.max(0.05, st + 0.05), 0, 1);
        var hw = clamp((bv2 - (1 - ht - 0.05)) / Math.max(0.05, ht + 0.05), 0, 1);
        var nv = v + (1 - v) * sw * sa * 0.85 - v * hw * ha * 0.7;
        if (cc !== 0) nv += (v - 0.5) * 0.1 * cc;
        d[i + c] = c255(nv * 255);
      }
    }
    if (p.midtone !== 0) {
      var lut = FX.linLUT(function (v) { return clamp((v - 0.5) * (1 + p.midtone / 150) + 0.5, 0, 1); });
      applyLUTChannel(d, lut, -1);
    }
    env.write(d);
  }
});
A({
  id: 'hdr-toning', name: 'HDR 色调', group: '色调调整', hint: '局域压暗提亮，做出 HDR 观感',
  params: [R('radius', '半径', 2, 120, 30, 1, 'px'), R('strength', '强度', 0, 100, 55, 1, '%'), R('gamma', '灰度系数', 0.2, 3, 1, 0.01, ''), R('exposure', '曝光度', -3, 3, 0, 0.01, ''), R('detail', '细节对比', -100, 100, 20, 1, '')],
  pad: function (p) { return Math.ceil(p.radius / 2) + 2; },
  apply: function (env, p) {
    var w = env.w, h = env.h, d = env.read();
    var blur = new Uint8ClampedArray(d);
    FX.gaussBlur(blur, w, h, Math.max(1, p.radius / 4));
    var mul = Math.pow(2, p.exposure), g = 1 / Math.max(0.1, p.gamma), k = p.strength / 100;
    var dc = p.detail / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      for (var c = 0; c < 3; c++) {
        var v = clamp(d[i + c] / 255 * mul, 0, 1);
        var local = clamp(blur[i + c] / 255 * mul, 0, 1);
        var comp = 1 - Math.pow(1 - v, 1 + k * 2);
        var out = mixv(v, comp * (0.35 + local * 0.85), k);
        out = Math.pow(clamp(out, 0, 1), g);
        out = clamp(out + (v - local) * dc * 0.6, 0, 1);
        d[i + c] = out * 255;
      }
    }
    env.write(d);
  }
});
A({
  id: 'color-lookup-tint', name: '色调分离上色', group: '色调调整', hint: '把画面压成有限色阶再上双色',
  params: [R('levels', '色阶数', 2, 16, 5, 1, ''), { key: 'shadow', label: '暗部色', type: 'color', def: '#12203a' }, { key: 'light', label: '亮部色', type: 'color', def: '#ffe9b0' }, R('mix', '混合', 5, 100, 100, 1, '%')],
  apply: function (env, p) {
    var d = env.read();
    FX.posterize(d, p.levels);
    var ca = FX.rgb(p.shadow), cb = FX.rgb(p.light), k = p.mix / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var l = gray(d[i], d[i + 1], d[i + 2]) / 255;
      d[i] = c255(d[i] * (1 - k) + mixv(ca.r, cb.r, l) * k);
      d[i + 1] = c255(d[i + 1] * (1 - k) + mixv(ca.g, cb.g, l) * k);
      d[i + 2] = c255(d[i + 2] * (1 - k) + mixv(ca.b, cb.b, l) * k);
    }
    env.write(d);
  }
});
A({
  id: 'split-tone', name: '分离色调', group: '色调调整', hint: '高光与阴影分别上色（流行调色）',
  params: [R('hueHi', '高光色相', 0, 360, 45, 1, ''), R('satHi', '高光饱和度', 0, 100, 20, 1, '%'),
    R('hueLo', '阴影色相', 0, 360, 220, 1, ''), R('satLo', '阴影饱和度', 0, 100, 22, 1, '%'),
    R('balance', '平衡', -100, 100, 0, 1, ''), C('preserve', '保持明度', true)],
  apply: function (env, p) {
    var d = env.read();
    var hiC = hsl2rgb(p.hueHi, 1, 0.5), loC = hsl2rgb(p.hueLo, 1, 0.5);
    var bal = p.balance / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var l = gray(d[i], d[i + 1], d[i + 2]) / 255;
      var wh = clamp((l - 0.5 - bal * 0.4) / 0.5, 0, 1) * (p.satHi / 100);
      var wl = clamp((0.5 + bal * 0.4 - l) / 0.5, 0, 1) * (p.satLo / 100);
      var r = d[i] * (1 - wh - wl) + hiC.r * wh + loC.r * wl;
      var g = d[i + 1] * (1 - wh - wl) + hiC.g * wh + loC.g * wl;
      var b = d[i + 2] * (1 - wh - wl) + hiC.b * wh + loC.b * wl;
      if (p.preserve) {
        var l0 = gray(d[i], d[i + 1], d[i + 2]), l1 = gray(r, g, b);
        var f = l1 > 1 ? l0 / l1 : 1;
        r *= f; g *= f; b *= f;
      }
      d[i] = c255(r); d[i + 1] = c255(g); d[i + 2] = c255(b);
    }
    env.write(d);
  }
});
A({
  id: 'curve-per-channel', name: '通道曲线', group: '高级调整', hint: '分通道曲线，校正色偏',
  params: [
    { key: 'curveR', label: '红', type: 'curve', def: [[0, 0], [0.5, 0.5], [1, 1]] },
    { key: 'curveG', label: '绿', type: 'curve', def: [[0, 0], [0.5, 0.5], [1, 1]] },
    { key: 'curveB', label: '蓝', type: 'curve', def: [[0, 0], [0.5, 0.5], [1, 1]] }],
  apply: function (env, p) {
    var d = env.read();
    FX.applyLUTs(d, FX.curveLUT(p.curveR, 256), FX.curveLUT(p.curveG, 256), FX.curveLUT(p.curveB, 256));
    env.write(d);
  }
});
A({
  id: 'blend-solid', name: '纯色叠加', group: '高级调整', hint: '用指定颜色按混合模式叠加',
  params: [{ key: 'color', label: '颜色', type: 'color', def: '#5b8cff' },
    S('mode', '混合模式', [['soft', '柔光'], ['overlay', '叠加'], ['multiply', '正片叠底'], ['screen', '滤色'], ['color', '颜色'], ['hue', '色相']], 'soft'),
    R('opacity', '不透明度', 1, 100, 45, 1, '%')],
  apply: function (env, p) {
    var d = env.read();
    var col = FX.rgb(p.color), k = p.opacity / 100;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      var cr = col.r / 255, cg = col.g / 255, cb = col.b / 255;
      var nr, ng, nb;
      if (p.mode === 'soft') {
        nr = (1 - 2 * cr) * r * r + 2 * cr * r;
        ng = (1 - 2 * cg) * g * g + 2 * cg * g;
        nb = (1 - 2 * cb) * b * b + 2 * cb * b;
      } else if (p.mode === 'overlay') {
        nr = r < 0.5 ? 2 * r * cr : 1 - 2 * (1 - r) * (1 - cr);
        ng = g < 0.5 ? 2 * g * cg : 1 - 2 * (1 - g) * (1 - cg);
        nb = b < 0.5 ? 2 * b * cb : 1 - 2 * (1 - b) * (1 - cb);
      } else if (p.mode === 'multiply') { nr = r * cr; ng = g * cg; nb = b * cb; }
      else if (p.mode === 'screen') { nr = 1 - (1 - r) * (1 - cr); ng = 1 - (1 - g) * (1 - cg); nb = 1 - (1 - b) * (1 - cb); }
      else {
        var hslS = rgb2hsl(d[i], d[i + 1], d[i + 2]);
        var hslC = rgb2hsl(col.r, col.g, col.b);
        var o = p.mode === 'color' ? hsl2rgb(hslC.h, hslC.s, hslS.l) : hsl2rgb(hslS.h, hslS.s, hslC.l);
        nr = o.r / 255; ng = o.g / 255; nb = o.b / 255;
      }
      d[i] = c255((r + (nr - r) * k) * 255);
      d[i + 1] = c255((g + (ng - g) * k) * 255);
      d[i + 2] = c255((b + (nb - b) * k) * 255);
    }
    env.write(d);
  }
});

})(window);

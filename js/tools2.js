/* ============================================================
 * DrawLib · tools2.js
 * 追加工具：减淡 / 加深 / 海绵（O）、自由变换（P / Ctrl+T）
 * 通过包装 DL.createTools 注入，不修改原有 tools.js
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;

/* 0..255 取整夹紧（避免依赖 filters.js 内部命名空间） */
function c255(v) { v = Math.round(v); return v < 0 ? 0 : (v > 255 ? 255 : v); }

/* ------------------------------------------------------------
 * 局部遮罩权重（软边圆盘，直接算，省一次 canvas 往返）
 * ---------------------------------------------------------- */
function diskWeight(px, py, cx, cy, r, hardness) {
  var dx = px - cx, dy = py - cy;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d >= r) return 0;
  var inner = r * DL.clamp(hardness, 0, 1) * 0.98;
  if (d <= inner) return 1;
  var t = 1 - (d - inner) / Math.max(0.0001, r - inner);
  return t * t * (3 - 2 * t);            /* smoothstep */
}

/* ------------------------------------------------------------
 * 变换：把盒子的 8 个控制点算出来（文档坐标）
 * mode: nw n ne e se s sw w
 * ---------------------------------------------------------- */
var HANDLE_SIGNS = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0]
};
var HANDLE_ORDER = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function rot(p, ang) {
  var c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function unrot(p, ang) { return rot(p, -ang); }

var origCreate = DL.createTools;

DL.createTools = function (app) {
  var tools = origCreate(app);

  function locked() {
    var l = app.doc.activeLayer();
    if (!l) return true;
    if (l.locked) { app.status('图层已锁定，无法编辑'); return true; }
    return false;
  }

  /* ============================================================
   * 减淡 / 加深 / 海绵
   * ========================================================== */
  var SM_NAME = { dodge: '减淡', burn: '加深', sponge: '海绵' };

  tools.dodge = {
    id: 'dodge', name: '减淡 / 加深 / 海绵', key: 'D',
    hint: '按住 Alt 临时反向（减淡⇄加深/饱和）',
    icon: '<circle cx="9.6" cy="11" r="4.8"/><path d="M14.6 6.4a4.8 4.8 0 0 1 0 9.2"/><path d="M19.4 3.4v4.2M17.3 5.5h4.2"/>',

    onDown: function (pt, e) {
      if (locked()) return;
      app.beginDirect();
      this.lx = pt.x; this.ly = pt.y;
      this.alt = !!(e && e.altKey);
      this.dab(pt.x, pt.y);
      app.status(this.label());
    },
    onMove: function (pt) {
      if (!app.stroke.active) return;
      var dx = pt.x - this.lx, dy = pt.y - this.ly;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(2, app.settings.brush.size * 0.35);
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
      app.commitDirect(this.label());
    },
    label: function () {
      var m = app.settings.opts.dodgeMode || 'dodge';
      if (m === 'sponge') return this.alt ? '海绵·加色' : '海绵·去色';
      if (this.alt) return m === 'dodge' ? '加深' : '减淡';
      return SM_NAME[m] || '减淡';
    },
    dab: function (x, y) {
      var d = app.doc, o = app.settings.opts, b = app.settings.brush;
      var size = Math.max(6, b.size);
      var rad = size / 2;
      var cl = DL.rectClip({ x: x - rad, y: y - rad, w: size, h: size }, d.width, d.height);
      if (!cl) return;
      var img;
      try { img = app.liveCtx.getImageData(cl.x, cl.y, cl.w, cl.h); }
      catch (err) { app.status('该图层无法读取像素'); return; }
      var dd = img.data;

      var mode = o.dodgeMode || 'dodge';
      var exposure = DL.clamp(o.dodgeExposure == null ? 0.5 : o.dodgeExposure, 0.01, 1);
      var range = o.dodgeRange || 'midtones';
      var flow = DL.clamp(b.flow, 0.02, 1);
      var opacity = DL.clamp(b.opacity, 0.02, 1);
      /* Alt = 反向：减淡→加深，加深→减淡，海绵→加色 */
      if (mode === 'dodge' && this.alt) mode = 'burn';
      else if (mode === 'burn' && this.alt) mode = 'dodge';

      var cxp = x - cl.x, cyp = y - cl.y;
      var base = exposure * flow * opacity;

      for (var py = 0; py < cl.h; py++) {
        for (var px = 0; px < cl.w; px++) {
          var w = diskWeight(px + 0.5, py + 0.5, cxp, cyp, rad, b.hardness);
          if (w <= 0) continue;
          var i = (py * cl.w + px) << 2;
          var a = dd[i + 3];
          if (a < 4) continue;
          var r = dd[i], g = dd[i + 1], bl = dd[i + 2];
          var L = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
          var rw;
          if (range === 'shadows') rw = (1 - L) * (1 - L);
          else if (range === 'highlights') rw = L * L;
          else rw = 1 - Math.abs(2 * L - 1);
          rw = 0.22 + 0.78 * rw;

          var amt = base * w * rw * (a / 255);
          if (amt <= 0) continue;

          if (mode === 'sponge') {
            /* 去色：颜色向亮度收敛；Alt 时反向（加色） */
            var k = DL.clamp(amt * (this.alt ? -1 : 1), -1, 1);
            dd[i]     = c255(r + (L * 255 - r) * k);
            dd[i + 1] = c255(g + (L * 255 - g) * k);
            dd[i + 2] = c255(bl + (L * 255 - bl) * k);
          } else if (mode === 'dodge') {
            dd[i]     = c255(r + (255 - r) * amt);
            dd[i + 1] = c255(g + (255 - g) * amt);
            dd[i + 2] = c255(bl + (255 - bl) * amt);
          } else {
            dd[i]     = c255(r * (1 - amt));
            dd[i + 1] = c255(g * (1 - amt));
            dd[i + 2] = c255(bl * (1 - amt));
          }
        }
      }
      app.liveCtx.putImageData(img, cl.x, cl.y);
      app.track(size, x, y);
    }
  };

  /* ============================================================
   * 自由变换
   * ========================================================== */
  var T = {
    id: 'transform', name: '自由变换', key: 'P',
    hint: '拖角缩放 · 框内移动 · 框外旋转 · Shift 等比/吸附 · Enter 应用 · Esc 取消',
    icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1" opacity=".5"/><path d="M3.5 3.5h3M3.5 3.5v3M20.5 20.5h-3M20.5 20.5v-3"/>',

    /* --- 生命周期 --- */
    onDown: function (pt, e) {
      if (locked()) return;
      if (!this.box) { this.begin(); if (!this.box) return; }
      var hit = this.hitTest(pt);
      this.drag = hit;
      if (!hit) { /* 点空白：把整块挪走 */
        this.drag = 'move';
      }
      var b = this.box;
      this.start = {
        x: pt.x, y: pt.y, cx: b.cx, cy: b.cy, w: b.w, h: b.h, ang: b.ang,
        a0: Math.atan2(pt.y - b.cy, pt.x - b.cx)
      };
      app.stroke.active = true;
      app.stroke.mode = 'direct';
      app.status(this.drag === 'move' ? '拖动移动内容' : (this.drag === 'rotate' ? '拖动旋转' : '拖动缩放'));
    },
    onMove: function (pt, e) {
      if (!this.box || !this.start) return;
      var b = this.box, s = this.start;
      var shift = !!(e && e.shiftKey) || !!pt.shift;
      var m = this.drag;

      if (m === 'rotate') {
        /* 旋转：绕中心；Shift 吸附 15° */
        var a1 = Math.atan2(pt.y - s.cy, pt.x - s.cx);
        var na = s.ang + (a1 - s.a0);
        if (shift) na = Math.round(na / (Math.PI / 12)) * (Math.PI / 12);
        b.cx = s.cx; b.cy = s.cy; b.w = s.w; b.h = s.h;
        b.ang = na;
        this.update();
        app.status('旋转 ' + (Math.round(b.ang * 180 / Math.PI * 10) / 10) + '°');
        return;
      }
      if (m === 'move' || !HANDLE_SIGNS[m]) {
        b.cx = s.cx + (pt.x - s.x);
        b.cy = s.cy + (pt.y - s.y);
        b.w = s.w; b.h = s.h; b.ang = s.ang;
        this.update();
        app.status('位置 ' + Math.round(b.cx) + ' , ' + Math.round(b.cy));
        return;
      }

      /* 缩放：锚点 = 对角/对边保持不动 */
      var sx = HANDLE_SIGNS[m][0], sy = HANDLE_SIGNS[m][1];
      var anchorLocal = { x: -sx * s.w / 2, y: -sy * s.h / 2 };
      var anchorWorld = {
        x: s.cx + rot(anchorLocal, s.ang).x,
        y: s.cy + rot(anchorLocal, s.ang).y
      };
      var pLocal = unrot({ x: pt.x - anchorWorld.x, y: pt.y - anchorWorld.y }, s.ang);

      var nw = sx === 0 ? s.w : Math.max(4, sx * pLocal.x);
      var nh = sy === 0 ? s.h : Math.max(4, sy * pLocal.y);
      if (shift && sx !== 0 && sy !== 0) {
        var k = Math.max(nw / s.w, nh / s.h);
        nw = s.w * k; nh = s.h * k;
      }
      /* 新中心 = 锚点 + 旋转后的（中心相对锚点的偏移） */
      var cRel = { x: sx * (nw / 2), y: sy * (nh / 2) };
      var cWorld = {
        x: anchorWorld.x + rot(cRel, s.ang).x,
        y: anchorWorld.y + rot(cRel, s.ang).y
      };
      b.cx = cWorld.x; b.cy = cWorld.y; b.w = nw; b.h = nh; b.ang = s.ang;
      this.update();
      app.status('大小 ' + Math.round(nw) + ' × ' + Math.round(nh) +
        (shift ? ' （等比）' : '') + (sx !== 0 && sy !== 0 && !shift ? '' : ''));
    },
    onUp: function () {
      this.start = null;
      if (this.box) app.status('按 Enter 应用变换，Esc 取消');
    },

    /* --- 开启 / 应用 / 取消 --- */
    begin: function () {
      var d = app.doc, l = d.activeLayer();
      if (!l) return;
      if (l.locked) { app.status('图层已锁定'); return; }
      var bb = this.contentBox(l);
      if (!bb) { app.status('图层是空的，没有可变换的内容'); return; }
      this.src = DL.copyCanvas(l.canvas);
      this.srcBox = bb;
      this.box = {
        cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2,
        w: Math.max(4, bb.w), h: Math.max(4, bb.h), ang: 0
      };
      app.beginDirect();
      app.stroke.active = true;
      app.stroke.mode = 'direct';
      this.update();
      app.status('自由变换：拖动控制点，Enter 应用 / Esc 取消');
    },
    contentBox: function (l) {
      var c = l.canvas, w = c.width, h = c.height;
      var data;
      try { data = c.getContext('2d').getImageData(0, 0, w, h).data; } catch (e) { return null; }
      var x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y++) {
        var row = y * w;
        for (var x = 0; x < w; x++) {
          if (data[((row + x) << 2) + 3] > 2) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return null;
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },
    /* 把变换结果写进 liveCanvas（实时预览） */
    update: function () {
      if (!this.box || !this.src) return;
      var b = this.box, sb = this.srcBox, d = app.doc;
      var g = app.liveCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, app.liveCanvas.width, app.liveCanvas.height);
      g.save();
      g.translate(b.cx, b.cy);
      g.rotate(b.ang);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.src, sb.x, sb.y, sb.w, sb.h, -b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
      /* 脏矩形 = 源框 ∪ 目标框四角 */
      app.stroke.rect = DL.rectUnion(app.stroke.rect, DL.rectClip(sb, d.width, d.height));
      var ext = this.corners();
      var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (var i = 0; i < 4; i++) {
        if (ext[i].x < minx) minx = ext[i].x;
        if (ext[i].y < miny) miny = ext[i].y;
        if (ext[i].x > maxx) maxx = ext[i].x;
        if (ext[i].y > maxy) maxy = ext[i].y;
      }
      app.stroke.rect = DL.rectUnion(app.stroke.rect, DL.rectClip({
        x: Math.floor(minx) - 2, y: Math.floor(miny) - 2,
        w: Math.ceil(maxx - minx) + 4, h: Math.ceil(maxy - miny) + 4
      }, d.width, d.height));
      app.requestRender();
      app.renderer.renderOverlay();
    },
    apply: function () {
      if (!this.box) { app.status('当前没有进行中的变换'); return false; }
      app.commitDirect('自由变换');
      this.box = null; this.src = null; this.start = null;
      app.renderer.renderOverlay();
      app.status('变换已应用');
      return true;
    },
    cancel: function () {
      if (!this.box) { app.status('当前没有进行中的变换'); return false; }
      app._discard = true;
      app.commitDirect('取消变换');
      app._discard = false;
      this.box = null; this.src = null; this.start = null;
      app.renderer.renderOverlay();
      app.status('已取消变换');
      return true;
    },

    /* --- 几何 --- */
    corners: function () {
      var b = this.box;
      var pts = [
        { x: -b.w / 2, y: -b.h / 2 }, { x: b.w / 2, y: -b.h / 2 },
        { x: b.w / 2, y: b.h / 2 }, { x: -b.w / 2, y: b.h / 2 }
      ];
      return pts.map(function (p) {
        var r = rot(p, b.ang);
        return { x: b.cx + r.x, y: b.cy + r.y };
      });
    },
    handlePoint: function (name) {
      var b = this.box, s = HANDLE_SIGNS[name];
      var r = rot({ x: s[0] * b.w / 2, y: s[1] * b.h / 2 }, b.ang);
      return { x: b.cx + r.x, y: b.cy + r.y };
    },
    /* 屏幕像素判定 → 换算成文档尺度 */
    tol: function () {
      var s = app.renderer.scale || 1;
      return 9 / s;
    },
    hitTest: function (pt) {
      if (!this.box) return null;
      var tol = this.tol();
      var i, hp;
      /* 旋转手柄 */
      hp = this.rotateHandle();
      if (Math.abs(pt.x - hp.x) <= tol * 1.4 && Math.abs(pt.y - hp.y) <= tol * 1.4) return 'rotate';
      for (i = 0; i < HANDLE_ORDER.length; i++) {
        hp = this.handlePoint(HANDLE_ORDER[i]);
        if (Math.abs(pt.x - hp.x) <= tol && Math.abs(pt.y - hp.y) <= tol) return HANDLE_ORDER[i];
      }
      /* 框内 → 移动 */
      var b = this.box;
      var p = unrot({ x: pt.x - b.cx, y: pt.y - b.cy }, b.ang);
      if (Math.abs(p.x) <= b.w / 2 && Math.abs(p.y) <= b.h / 2) return 'move';
      return null;
    },
    rotateHandle: function () {
      var b = this.box;
      var d = 26 / (app.renderer.scale || 1);
      var r = rot({ x: 0, y: -b.h / 2 - d }, b.ang);
      return { x: b.cx + r.x, y: b.cy + r.y };
    },

    /* --- 覆盖层绘制（屏幕空间） --- */
    drawOverlay: function (ctx, s, ox, oy) {
      if (!this.box || !ctx) return;
      var b = this.box;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      ctx.lineJoin = 'miter';

      /* 外框 */
      ctx.beginPath();
      var c = this.corners();
      ctx.moveTo(c[0].x, c[0].y);
      for (var i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,170,255,.95)';
      ctx.setLineDash([5 / s, 4 / s]);
      ctx.stroke();
      ctx.setLineDash([]);

      /* 四边中点连线 */
      ctx.beginPath();
      for (var h = 0; h < HANDLE_ORDER.length; h++) {
        if (HANDLE_ORDER[h].length === 2) continue;
        var p0 = this.handlePoint(HANDLE_ORDER[h]);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(b.cx, b.cy);
      }
      ctx.strokeStyle = 'rgba(120,170,255,.30)';
      ctx.stroke();

      /* 手柄 */
      var hs = 8 / s;
      for (var k = 0; k < HANDLE_ORDER.length; k++) {
        var p = this.handlePoint(HANDLE_ORDER[k]);
        ctx.beginPath();
        ctx.rect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.4 / s;
        ctx.strokeStyle = 'rgba(60,110,220,1)';
        ctx.stroke();
      }
      /* 旋转手柄 */
      var rp = this.rotateHandle();
      ctx.beginPath();
      ctx.moveTo(b.cx + rot({ x: 0, y: -b.h / 2 }, b.ang).x, b.cy + rot({ x: 0, y: -b.h / 2 }, b.ang).y);
      ctx.lineTo(rp.x, rp.y);
      ctx.strokeStyle = 'rgba(120,170,255,.9)';
      ctx.lineWidth = 1.4 / s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, hs * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,110,220,1)';
      ctx.stroke();

      /* 中心十字 */
      var k2 = 5 / s;
      ctx.beginPath();
      ctx.moveTo(b.cx - k2, b.cy); ctx.lineTo(b.cx + k2, b.cy);
      ctx.moveTo(b.cx, b.cy - k2); ctx.lineTo(b.cx, b.cy + k2);
      ctx.strokeStyle = 'rgba(120,170,255,.9)';
      ctx.lineWidth = 1 / s;
      ctx.stroke();
      ctx.restore();
    }
  };

  tools.transform = T;

  /* --- 把覆盖层绘制挂到 renderOverlay 上 --- */
  var R = app.renderer;
  if (R && R.renderOverlay) {
    var origOverlay = R.renderOverlay;
    R.renderOverlay = function () {
      origOverlay.call(R);
      if (!R.octx) return;
      if (!(app.settings.tool === 'transform' || app._forcedTool === 'transform')) return;
      var s = R.scale * R.dpr, ox = R.ox * R.dpr, oy = R.oy * R.dpr;
      if (!s) return;
      T.drawOverlay(R.octx, s, ox, oy);
    };
  }

  /* --- 插入工具栏顺序 --- */
  var order = (tools.__order || []).slice();
  function insertAfter(list, after, id) {
    var i = list.indexOf(after);
    if (i < 0) list.push(id);
    else list.splice(i + 1, 0, id);
  }
  insertAfter(order, 'blur', 'dodge');
  insertAfter(order, 'move', 'transform');
  tools.__order = order;

  /* --- 工具栏分组（双列布局，矮窗口也能全部显示） --- */
  DL.toolGroups = [
    { name: '绘画', tools: ['brush', 'eraser', 'line', 'smudge'] },
    { name: '修饰', tools: ['blur', 'dodge', 'heal', 'clone'] },
    { name: '上色', tools: ['bucket', 'gradient', 'eyedropper'] },
    { name: '选择与变换', tools: ['select', 'objectSelect', 'move', 'transform', 'liquify', 'crop'] },
    { name: '其他', tools: ['text', 'pan'] }
  ];

  return tools;
};

/* ------------------------------------------------------------
 * 默认参数
 * ---------------------------------------------------------- */
DL.toolDefaults = DL.toolDefaults || {};
DL.toolDefaults.dodge = { dodgeMode: 'dodge', dodgeExposure: 0.5, dodgeRange: 'midtones' };

})(window);

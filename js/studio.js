/* ============================================================
 * DrawLib · studio.js
 * 界面接线层：菜单栏 / 历史面板 / 插件面板 / 滤镜入口 / 快捷键
 * 通过 DL.studio.install(ui) 由 UI 构造函数回调注入，不改动 ui.js 主体
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL;
var $ = function (id) { return global.document.getElementById(id); };
var esc = DL.esc || function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

DL.studio = {};

/* ------------------------------------------------------------
 * 安装
 * ---------------------------------------------------------- */
DL.studio.install = function (ui) {
  var app = ui.app;
  var S = DL.studio;

  /* ===== 0. 状态位 ===== */
  ui.gridOn = false;
  ui.checkerColor = false;
  ui.toolbarVisible = true;
  ui.panelsVisible = true;
  ui.historyVisible = true;
  ui.pluginVisible = true;

  /* ===== 1. 图层操作 ===== */
  ui.clearLayer = function () {
    var l = app.doc.activeLayer();
    if (!l) return;
    if (l.locked) { ui.setStatus('图层已锁定'); return; }
    var id = l.id;
    app.snapshotOp('清空图层', function () { DL.findLayer(app.doc, id).clear(); });
    ui.setStatus('已清空「' + l.name + '」');
  };
  ui.duplicateLayer = function () {
    var d = app.doc, src = d.activeLayer();
    if (!src) return;
    app.snapshotOp('复制图层', function () {
      var l = d.addLayer(src.name + ' 副本', d.active + 1);
      l.ctx.drawImage(src.canvas, 0, 0);
      l.opacity = src.opacity; l.blend = src.blend;
      l.touch();
    });
    ui.setStatus('已复制图层');
  };
  ui.deleteLayer = function () {
    var d = app.doc;
    if (d.layers.length <= 1) { ui.setStatus('至少保留一个图层'); return; }
    app.snapshotOp('删除图层', function () { d.removeLayer(d.active); });
    ui.setStatus('已删除图层');
  };
  ui.moveLayer = function (dir) {
    var d = app.doc;
    var j = d.active + dir;
    if (j < 0 || j >= d.layers.length) { ui.setStatus(dir > 0 ? '已在顶层' : '已在底层'); return; }
    app.snapshotOp(dir > 0 ? '上移图层' : '下移图层', function () { d.moveLayer(d.active, dir); });
  };
  ui.moveLayerToEdge = function (top) {
    var d = app.doc;
    app.snapshotOp(top ? '置于顶层' : '置于底层', function () {
      d.moveLayerTo(d.active, top ? d.layers.length - 1 : 0);
    });
  };
  ui.mergeDown = function () {
    var d = app.doc;
    if (d.active <= 0) { ui.setStatus('最底层无法向下合并'); return; }
    app.snapshotOp('向下合并', function () { d.mergeDown(d.active); });
    ui.setStatus('已向下合并');
  };
  ui.mergeVisible = function () {
    var d = app.doc;
    var vis = d.layers.filter(function (l) { return l.visible; }).length;
    if (vis < 2) { ui.setStatus('可见图层不足两个，无需合并'); return; }
    app.snapshotOp('合并可见图层', function () { d.mergeVisible(); });
    ui.setStatus('已合并 ' + vis + ' 个可见图层');
  };
  ui.layerToSelection = function () {
    var d = app.doc, l = d.activeLayer();
    if (!l) return;
    var data;
    try { data = l.ctx.getImageData(0, 0, d.width, d.height).data; } catch (e) { ui.setStatus('无法读取图层像素'); return; }
    var mask = new Uint8Array(d.width * d.height);
    var count = 0, x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
    for (var y = 0; y < d.height; y++) {
      for (var x = 0; x < d.width; x++) {
        var i = y * d.width + x;
        if (data[(i << 2) + 3] > 8) {
          mask[i] = 1; count++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (!count) { ui.setStatus('图层是空的，无法生成选区'); return; }
    app.setSelection(mask, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    ui.setStatus('已按图层内容生成选区（' + count.toLocaleString() + ' 像素）');
  };

  /* ===== 2. 视图开关 ===== */
  function afterLayoutChange() {
    app.renderer.resize();
    app.renderer.renderOverlay();
  }
  ui.toggleGrid = function () {
    ui.gridOn = !ui.gridOn;
    var c = $('chk-grid');
    if (c) c.checked = ui.gridOn;
    app.requestRender();
    ui.setStatus(ui.gridOn ? '已显示网格' : '已隐藏网格');
  };
  ui.toggleChecker = function () {
    ui.checkerColor = !ui.checkerColor;
    app.renderer.setCheckerColored(ui.checkerColor);
    ui.setStatus(ui.checkerColor ? '棋盘背景：浅色' : '棋盘背景：深色');
  };
  ui.toggleToolbar = function () {
    ui.toolbarVisible = !ui.toolbarVisible;
    var tb = $('toolbar');
    if (tb) tb.hidden = !ui.toolbarVisible;
    afterLayoutChange();
  };
  ui.togglePanels = function () {
    ui.panelsVisible = !ui.panelsVisible;
    var p = document.querySelector('.panels');
    if (p) p.hidden = !ui.panelsVisible;
    afterLayoutChange();
  };
  ui.toggleHistory = function () {
    ui.historyVisible = !ui.historyVisible;
    if (ui.historyVisible && !ui.panelsVisible) ui.togglePanels();
    var el = $('panel-history');
    if (el) el.hidden = !ui.historyVisible;
    afterLayoutChange();
    if (ui.historyVisible) DL.menu.refreshHistory(app);
  };
  ui.togglePluginPanel = function () {
    ui.pluginVisible = !ui.pluginVisible;
    if (ui.pluginVisible && !ui.panelsVisible) ui.togglePanels();
    var el = $('panel-plugins');
    if (el) el.hidden = !ui.pluginVisible;
    afterLayoutChange();
  };

  /* ===== 2.5 帮助与插件管理对话框 ===== */
  var SHORTCUTS = [
    ['文件', [
      ['Ctrl+N', '新建文件'], ['Ctrl+Shift+N', '新建图层'], ['Ctrl+O', '打开图片'],
      ['Ctrl+S', '导出 PNG'], ['Ctrl+K', '首选项']
    ]],
    ['编辑', [
      ['Ctrl+Z / Ctrl+Shift+Z', '上一步 / 下一步'], ['Ctrl+Y', '下一步'],
      ['Ctrl+C / Ctrl+X / Ctrl+V', '复制 / 剪切 / 粘贴'],
      ['Ctrl+J', '复制图层'], ['Ctrl+T', '自由变换'], ['Ctrl+E', '向下合并'],
      ['Ctrl+Shift+E', '合并可见图层'], ['Delete', '清空当前图层']
    ]],
    ['图像', [
      ['Ctrl+Alt+I', '图像大小'], ['Ctrl+Alt+C', '画布大小'],
      ['Ctrl+0', '适合窗口'], ['Ctrl+ + / Ctrl+ -', '放大 / 缩小']
    ]],
    ['选择', [
      ['Ctrl+A', '全选'], ['Ctrl+D', '取消选区'], ['Ctrl+I', '反选']
    ]],
    ['滤镜', [
      ['Ctrl+F', '重复上次滤镜'], ['Ctrl+Alt+F', '上次滤镜参数…'],
      ['Ctrl+Shift+F', '滤镜库']
    ]],
    ['工具', [
      ['B / E / S / U', '画笔 / 橡皮 / 图章 / 涂抹'],
      ['R / J / D', '模糊 / 污点修复 / 减淡加深海绵'],
      ['G / I / L', '油漆桶 / 吸管 / 直线'],
      ['T / M / W / Q', '文字 / 选框 / 色块选取 / 液化'],
      ['F / C / V / H / P', '渐变 / 剪裁 / 移动 / 抓手 / 自由变换'],
      ['[ / ]', '减小 / 增大笔刷'], ['X', '交换前景背景色'],
      ['空格拖动', '临时平移视图'], ['Alt 单击', '临时取色 / 反向']
    ]]
  ];
  ui.showShortcuts = function () {
    var html = '<div class="shortcut-grid">' + SHORTCUTS.map(function (grp) {
      return '<div class="sc-col"><div class="sect-title">' + esc(grp[0]) + '</div>' +
        grp[1].map(function (r) {
          return '<div class="sc-row"><kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span></div>';
        }).join('') + '</div>';
    }).join('') + '</div>';
    return DL.dialog({
      title: '快捷键一览', wide: true,
      html: html,
      actions: [{ label: '知道了', value: 'ok', primary: true }]
    });
  };

  ui.showPluginGuide = function () {
    var html = [
      '<div class="opt-note">DrawLib 插件就是一段普通 JS，安装后立刻生效，可注册<b>滤镜 / 调整 / 菜单项</b>，也可以直接读写画布像素。</div>',
      '<div class="sect-title">最小示例</div>',
      '<textarea readonly spellcheck="false" style="min-height:190px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px">' +
        esc([
          "DrawLib.registerPlugin({",
          "  id: 'my-plugin', name: '我的插件', version: '1.0.0',",
          "  setup: function (api) {",
          "    // 1) 最快的方式：只写逐像素变换，参数界面自动生成",
          "    api.simpleFilter({",
          "      id: 'pl-invert-red', name: '红色反相', group: '插件滤镜',",
          "      hint: '只把红色通道反过来',",
          "      params: [",
          "        { key: 'amount', label: '强度', type: 'range', min: 0, max: 100, def: 100, unit: '%' }",
          "      ],",
          "      transform: function (d, w, h, p) {",
          "        var k = p.amount / 100;",
          "        for (var i = 0; i < d.length; i += 4) {",
          "          d[i] = d[i] + (255 - d[i] * 2) * k;",
          "        }",
          "      }",
          "    });",
          "",
          "    // 2) 往菜单里加一条命令",
          "    api.registerMenuItem({ menu: 'filter', label: '一键红色反相',",
          "      run: function () { api.applyPixels('pl-invert-red', { amount: 80 }); } });",
          "  }",
          "});"
        ].join('\n')) +
      '</textarea>',
      '<div class="sect-title">API 速查</div>',
      '<div class="api-list">' +
        '<div><code>registerPlugin({id,name,version,author,setup})</code> 插件入口</div>' +
        '<div><code>api.simpleFilter({id,name,group,params,transform})</code> 逐像素滤镜（推荐）</div>' +
        '<div><code>api.registerFilter(def)</code> 完整滤镜：def.apply(env, params)</div>' +
        '<div><code>api.registerAdjust(def)</code> 注册一项「调整」</div>' +
        '<div><code>api.registerMenuItem({menu,label,key,run})</code> menu = filter / edit / view</div>' +
        '<div><code>api.registerTool(def)</code> 注册新工具</div>' +
        '<div><code>api.applyPixels(id, params)</code> 直接对当前图层执行</div>' +
        '<div><code>api.app() / api.doc() / api.activeLayer()</code> 拿到运行时对象</div>' +
        '<div><code>api.dialog({title,html})</code> 弹一个提示框</div>' +
        '<div><code>api.fx</code> 内置像素算法：模糊、卷积、曲线、噪波、fbm…</div>' +
      '</div>',
      '<div class="opt-note">参数类型：<b>range</b> 滑块 / <b>select</b> 下拉 / <b>check</b> 勾选 / <b>color</b> 颜色 / <b>angle</b> 角度 / <b>curve</b> 曲线 / <b>matrix5</b> 自定义矩阵。</div>',
      '<div class="opt-note">插件与脚本权限相同，<b>只安装你信任的代码</b>。示例插件在 plugins/ 目录，也可以用「示例插件库」一键安装。</div>'
    ].join('');
    return DL.dialog({
      title: '插件开发指南', wide: true,
      html: html,
      actions: [{ label: '关闭', value: 'ok', primary: true }]
    });
  };

  ui.showAbout = function () {
    var nf = DL.filters.all('filter').length, na = DL.filters.all('adjust').length;
    var html = [
      '<div class="about-box">',
      '<div class="about-logo"></div>',
      '<div><div class="about-title">DrawLib 绘画工作室</div>',
      '<div class="about-sub">纯前端、零依赖、可直接双击打开的 PNG 绘画软件</div></div>',
      '</div>',
      '<div class="sect-title">规模</div>',
      '<div class="about-stats">' +
        '<div><b>' + app.tools.__order.length + '</b><span>工具</span></div>' +
        '<div><b>' + nf + '</b><span>滤镜</span></div>' +
        '<div><b>' + na + '</b><span>调整</span></div>' +
        '<div><b>' + DL.plugins.list.length + '</b><span>已装插件</span></div>' +
      '</div>',
      '<div class="sect-title">能力</div>',
      '<div class="about-list">' +
        '<div>· 8 种笔刷 + 数位板压感 / 倾斜 / 三指擦除 / 双指缩放</div>' +
        '<div>· 图层、混合模式、按颜色分层、图层内容转选区</div>' +
        '<div>· 选区 / 对象选择 / 液化 / 裁剪 / 移动选区 / 污点修复</div>' +
        '<div>· PS 风格菜单栏 + ' + (nf + na) + ' 项滤镜与调整 + 曲线编辑器</div>' +
        '<div>· 插件系统：一条 JS 就能加滤镜、加菜单、加工具</div>' +
        '<div>· 自由变换、减淡 / 加深 / 海绵、历史记录面板跳转</div>' +
      '</div>',
      '<div class="opt-note">技术栈：原生 JavaScript + Canvas 2D，不含任何第三方库；可离线运行。</div>'
    ].join('');
    return DL.dialog({
      title: '关于 DrawLib', wide: true,
      html: html,
      actions: [{ label: '关闭', value: 'ok', primary: true }]
    });
  };

  ui.openPluginManager = function () {
    function listHTML() {
      if (!DL.plugins.list.length) {
        return '<div class="opt-note">还没有安装插件。可以点「示例插件库…」一键装一个，或从 plugins/ 目录里的三个示例文件安装。</div>';
      }
      return '<div class="plugin-list">' + DL.plugins.list.map(function (r) {
        return '<div class="plugin-item' + (r.enabled ? '' : ' off') + '">' +
          '<div class="pl-main"><div class="pl-name">' + esc(r.name) +
          '<i class="pl-ver">v' + esc(r.version) + '</i>' +
          (r.builtin ? '<i class="pl-ver">内置</i>' : '') + '</div>' +
          '<div class="pl-meta">' + (r.author ? esc(r.author) + ' · ' : '') +
          (r.owned.filters.length + r.owned.menu.length + r.owned.tools.length) + ' 项注册' +
          (r.error ? ' · <span class="pl-err">出错：' + esc(r.error) + '</span>' : '') + '</div></div>' +
          '<button class="pl-btn" data-act="toggle" data-id="' + esc(r.id) + '">' + (r.enabled ? '停用' : '启用') + '</button>' +
          '<button class="pl-btn danger" data-act="del" data-id="' + esc(r.id) + '">卸载</button>' +
          '</div>';
      }).join('') + '</div>';
    }
    var html = '<div class="opt-note">插件等同于脚本，安装前请确认来源可信。停用后其「滤镜 / 调整 / 菜单项」会立刻从界面消失。</div>' +
      '<div id="pm-body">' + listHTML() + '</div>' +
      '<div class="btn-row">' +
      '<button class="btn" id="pm-examples">示例插件库…</button>' +
      '<button class="btn" id="pm-guide">插件开发指南</button>' +
      '</div>';
    return DL.dialog({
      title: '插件管理器', wide: true,
      html: html,
      actions: [{ label: '关闭', value: 'ok', primary: true }],
      onMount: function (root) {
        function refresh() {
          var b = root.querySelector('#pm-body');
          if (b) b.innerHTML = listHTML();
          DL.plugins.renderPanel();
        }
        root.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('button') : null;
          if (!b) return;
          if (b.dataset.act === 'toggle') {
            var rec = DL.plugins.list.filter(function (r) { return r.id === b.dataset.id; })[0];
            if (rec) DL.plugins.setEnabled(b.dataset.id, !rec.enabled);
            refresh();
          } else if (b.dataset.act === 'del') { DL.plugins.uninstall(b.dataset.id); refresh(); }
          else if (b.id === 'pm-examples') { DL.plugins.showExamples(app).then(refresh); }
          else if (b.id === 'pm-guide') { ui.showPluginGuide(); }
        });
      }
    });
  };

  /* ===== 3. 历史面板 ===== */  (function () {
    var prev = app.history.onChange;
    app.history.onChange = function () {
      if (prev) prev();
      DL.menu.refreshHistory(app);
    };
    var prevAfter = app.afterStructural;
    app.afterStructural = function () {
      prevAfter.call(app);
      DL.menu.refreshHistory(app);
    };
    var bu = $('hist-undo'), br = $('hist-redo');
    if (bu) bu.addEventListener('click', function () { ui.undo(); });
    if (br) br.addEventListener('click', function () { ui.redo(); });
    DL.menu.refreshHistory(app);
  })();

  /* ===== 4. 滤镜入口 ===== */
  var bg = $('btn-fx-gallery'), br2 = $('btn-fx-repeat');
  if (bg) bg.addEventListener('click', function () { DL.filters.openGallery(app); });
  if (br2) br2.addEventListener('click', function () { DL.filters.repeatLast(app); });

  /* ===== 5. 插件面板 ===== */
  DL.onPluginToolsChanged = function () {
    var tb = $('toolbar');
    if (!tb) return;
    tb.innerHTML = '';
    ui.buildToolbar();
    ui.setTool(app.settings.tool);
  };
  DL.plugins.onChange = function () { /* 菜单每次打开都会重建，无需额外处理 */ };
  DL.plugins.bindPanel(app);
  DL.plugins.renderPanel();

  /* ===== 6. 菜单栏 ===== */
  DL.menu.build(app);

  /* ===== 7. 工具选项面板扩展（减淡/加深/海绵 · 自由变换） ===== */
  var origUTO = ui.updateToolOptions;
  ui.updateToolOptions = function () {
    origUTO.call(ui);
    var wrap = $('tool-options');
    if (!wrap) return;
    var o = app.settings.opts;
    if (app.settings.tool === 'dodge') {
      var MODES = [['dodge', '减淡'], ['burn', '加深'], ['sponge', '海绵']];
      var RANGES = [['shadows', '阴影'], ['midtones', '中间调'], ['highlights', '高光']];
      wrap.insertAdjacentHTML('beforeend',
        '<div class="opt-row"><label>模式</label><select id="o-dmode">' + MODES.map(function (m) {
          return '<option value="' + m[0] + '"' + (o.dodgeMode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></div>' +
        '<div class="opt-row"><label>强度</label><input type="range" id="o-dexp" min="1" max="100" value="' +
        Math.round((o.dodgeExposure == null ? 0.5 : o.dodgeExposure) * 100) + '"><span class="val" id="o-dexp-val">' +
        Math.round((o.dodgeExposure == null ? 0.5 : o.dodgeExposure) * 100) + '%</span></div>' +
        '<div class="opt-row"><label>范围</label><select id="o-drange">' + RANGES.map(function (m) {
          return '<option value="' + m[0] + '"' + (o.dodgeRange === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select></div>' +
        '<div class="opt-note" style="margin-top:6px">按住 <b>Alt</b> 临时反向；<b>海绵</b>模式下去色，Alt 改为加色。</div>');
      var m1 = $('o-dmode'), e1 = $('o-dexp'), r1 = $('o-drange');
      if (m1) m1.addEventListener('change', function () { o.dodgeMode = this.value; });
      if (r1) r1.addEventListener('change', function () { o.dodgeRange = this.value; });
      if (e1) e1.addEventListener('input', function () {
        o.dodgeExposure = this.value / 100;
        $('o-dexp-val').textContent = this.value + '%';
      });
    } else if (app.settings.tool === 'transform' && app.tools.transform) {
      var T = app.tools.transform;
      var info = T.box
        ? ('当前：' + Math.round(T.box.w) + ' × ' + Math.round(T.box.h) +
           ' · 旋转 ' + (Math.round(T.box.ang * 180 / Math.PI * 10) / 10) + '°')
        : '未开始（点击画布或按 Ctrl+T 开始）';
      wrap.insertAdjacentHTML('beforeend',
        '<div class="opt-note">' + esc(info) + '</div>' +
        '<div class="btn-row" style="margin-top:7px">' +
        '<button class="btn wide primary" id="o-tf-apply">应用变换 (Enter)</button>' +
        '<button class="btn wide" id="o-tf-cancel">取消 (Esc)</button>' +
        '<button class="btn wide" id="o-tf-reset">重设 (R)</button>' +
        '<button class="btn wide" id="o-tf-flip-h">水平翻转</button>' +
        '<button class="btn wide" id="o-tf-flip-v">垂直翻转</button>' +
        '<button class="btn wide" id="o-tf-rot90">旋转 90°</button>' +
        '</div>');
      var ap = $('o-tf-apply'), ca = $('o-tf-cancel'), rs = $('o-tf-reset');
      var fh = $('o-tf-flip-h'), fv = $('o-tf-flip-v'), r9 = $('o-tf-rot90');
      if (ap) ap.addEventListener('click', function () {
        if (app.tools.transform.apply()) ui.updateToolOptions();
      });
      if (ca) ca.addEventListener('click', function () {
        if (app.tools.transform.cancel()) ui.updateToolOptions();
      });
      if (rs) rs.addEventListener('click', function () {
        var b = app.tools.transform.box;
        if (!b) return;
        b.cx = app.tools.transform.srcBox.x + app.tools.transform.srcBox.w / 2;
        b.cy = app.tools.transform.srcBox.y + app.tools.transform.srcBox.h / 2;
        b.w = app.tools.transform.srcBox.w;
        b.h = app.tools.transform.srcBox.h;
        b.ang = 0;
        app.tools.transform.update();
        ui.updateToolOptions();
      });
      if (fh) fh.addEventListener('click', function () { DL.studio.flipTransform('h'); });
      if (fv) fv.addEventListener('click', function () { DL.studio.flipTransform('v'); });
      if (r9) r9.addEventListener('click', function () { DL.studio.rotateTransform(); });
    }
  };

  /* 自由变换：切换工具时自动开始 / 自动提交 */
  var origSetTool = ui.setTool;
  ui.setTool = function (id) {
    var prev = app.settings.tool;
    var T = app.tools.transform;
    if (T && prev === 'transform' && id !== 'transform' && T.box) T.apply();
    origSetTool.call(ui, id);
    if (id === 'transform' && T) {
      if (!T.box) T.begin();
      ui.updateToolOptions();
    }
  };

  /* ===== 8. 选区记忆（供「重新选择」用） ===== */
  var origSetSel = app.setSelection;
  app.setSelection = function (mask, rect) {
    if (this.selection) DL.selectOps.save(this);
    return origSetSel.call(this, mask, rect);
  };

  /* ===== 9. 快捷键 ===== */
  S.bindKeys(app, ui);

  ui.setStatus('就绪 · 菜单栏、滤镜库（' + DL.filters.list.length + ' 项）与插件面板已就绪');
};

/* ------------------------------------------------------------
 * 自由变换的翻转 / 旋转辅助（在已有变换基础上叠加）
 * ---------------------------------------------------------- */
DL.studio.flipTransform = function (axis) {
  var app = global.drawlib;
  if (!app) return;
  var T = app.tools.transform;
  if (!T.box) return;
  var g = app.liveCtx;
  /* 直接对 src 做镜像，最简单可靠 */
  var c = DL.createCanvas(T.src.width, T.src.height);
  var cg = c.getContext('2d');
  cg.setTransform(1, 0, 0, 1, 0, 0);
  if (axis === 'h') { cg.translate(T.src.width, 0); cg.scale(-1, 1); }
  else { cg.translate(0, T.src.height); cg.scale(1, -1); }
  cg.drawImage(T.src, 0, 0);
  T.src = c;
  T.update();
  app.status(axis === 'h' ? '已水平翻转变换内容' : '已垂直翻转变换内容');
  app.ui.updateToolOptions();
};
DL.studio.rotateTransform = function (deg) {
  var app = global.drawlib;
  if (!app) return;
  var T = app.tools.transform;
  if (!T.box) return;
  T.box.ang += (deg == null ? 90 : deg) * Math.PI / 180;
  var b = T.box;
  var tmp = b.w; b.w = b.h; b.h = tmp;
  T.update();
  app.status('变换已旋转 ' + (deg == null ? 90 : deg) + '°');
  app.ui.updateToolOptions();
};

/* ------------------------------------------------------------
 * 快捷键（捕获阶段，避免与原 ui.js 的 Ctrl+E 冲突）
 * ---------------------------------------------------------- */
DL.studio.bindKeys = function (app, ui) {
  function typing(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function modalOpen() {
    var m = $('modal-backdrop');
    return m && !m.hidden;
  }

  global.addEventListener('keydown', function (e) {
    if (modalOpen()) return;
    if (typing(e)) return;
    var mod = e.ctrlKey || e.metaKey;
    var k = (e.key || '').toLowerCase();
    var T = app.tools.transform;

    /* --- 自由变换进行中：Enter 应用 / Esc 取消 --- */
    if (T && T.box && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') T.apply(); else T.cancel();
      ui.updateToolOptions();
      return;
    }

    if (!mod) {
      if (e.key === 'd' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        app.setTool('dodge'); return;
      }
      if (e.key === 'p' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        app.setTool('transform'); return;
      }
      return;
    }

    /* Ctrl + Shift + E 在 ui.js 里被当作向下合并，这里拦截为「合并可见图层」 */
    if (e.shiftKey && k === 'e') {
      e.preventDefault();
      e.stopImmediatePropagation();
      ui.mergeVisible();
      return;
    }

    /* 菜单里已声明、ui.js 未处理的组合 */
    var handled = true;
    switch (k) {
      case 'j': ui.duplicateLayer(); break;
      case 'a': DL.selectOps.all(app); break;
      case 'c': DL.menuOps.copy(app); break;
      case 'x': DL.menuOps.copy(app, true); break;
      case 'v': DL.menuOps.paste(app); break;
      case 'f':
        if (e.altKey) DL.filters.dialogLast(app);
        else if (e.shiftKey) DL.filters.openGallery(app);
        else DL.filters.repeatLast(app);
        break;
      case 'k': DL.menuDialogs.preferences(app); break;
      case 't': app.setTool('transform'); break;
      case 'i': if (e.altKey) DL.menuDialogs.imageSize(app); break;
      case ']': if (e.shiftKey) ui.moveLayerToEdge(true); else ui.moveLayer(1); break;
      case '[': if (e.shiftKey) ui.moveLayerToEdge(false); else ui.moveLayer(-1); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }, true);
};

})(window);

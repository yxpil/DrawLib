/* ============================================================
 * DrawLib · plugins.js
 * 滤镜插件系统
 *   · 插件通过全局 DrawLib.registerPlugin({...}) 注册
 *   · 支持导入 .js 文件 / 粘贴源码 / 内置示例，localStorage 持久化
 *   · 插件可注册：滤镜、调整、菜单项、工具
 * ============================================================ */
(function (global) {
'use strict';

var DL = global.DL = global.DL || {};
var STORE_KEY = 'drawlib.plugins.v1';
var seed = 0;

/* ------------------------------------------------------------
 * 给滤镜内核补上「注销」能力（卸载插件时用）
 * ---------------------------------------------------------- */
DL.filters.unregister = function (id) {
  var def = DL.filters.get(id);
  if (!def) return false;
  var i = DL.filters.list.indexOf(def);
  if (i >= 0) DL.filters.list.splice(i, 1);
  /* BY_ID 与分组需要重建 */
  DL.filters.rebuild();
  return true;
};
DL.filters.rebuild = function () {
  var reg = DL.filters.list;
  var byId = {}, groups = {};
  for (var i = 0; i < reg.length; i++) {
    var d = reg[i];
    byId[d.id] = d;
    if (!groups[d.kind]) groups[d.kind] = [];
    if (groups[d.kind].indexOf(d.group) < 0) groups[d.kind].push(d.group);
  }
  var order = DL.filters.groupOrder;
  for (var k in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, k)) continue;
    groups[k].sort(function (a, b) {
      var oa = 999, ob = 999;
      reg.forEach(function (x) {
        if (x.kind === k) {
          if (x.group === a) oa = Math.min(oa, x.groupOrder);
          if (x.group === b) ob = Math.min(ob, x.groupOrder);
        }
      });
      return oa - ob;
    });
  }
  DL.filters._setIndex(byId, groups);
};

/* ------------------------------------------------------------
 * 插件管理
 * ---------------------------------------------------------- */
var PL = DL.plugins = {
  list: [],
  menuItems: [],
  _ctx: null,
  onChange: null,
  version: '1.0'
};

function makeRec(m) {
  m = m || {};
  return {
    id: m.id || ('plugin-' + (++seed) + '-' + Math.random().toString(36).slice(2, 6)),
    name: m.name || m.id || '未命名插件',
    version: m.version || '1.0.0',
    author: m.author || '',
    description: m.description || '',
    builtin: !!m.builtin,
    enabled: true,
    error: null,
    manifest: m,
    code: null,
    owned: { filters: [], menu: [], tools: [] }
  };
}
function find(id) {
  for (var i = 0; i < PL.list.length; i++) if (PL.list[i].id === id) return PL.list[i];
  return null;
}
PL.find = find;

/* ---------- 提交给插件的 API ---------- */
var api = {
  version: PL.version,
  /* 插件入口 */
  registerPlugin: function (manifest) {
    manifest = manifest || {};
    var rec = PL._ctx;
    if (rec) {
      /* 来自 install()/setup() 的调用：补齐元信息 */
      if (manifest.id && !rec._uidGiven) rec.id = manifest.id;
      rec._uidGiven = true;
      rec.name = manifest.name || rec.name;
      rec.version = manifest.version || rec.version;
      rec.author = manifest.author || rec.author;
      rec.description = manifest.description || rec.description;
      rec.manifest = manifest;
      if (typeof manifest.setup === 'function') {
        PL._ctx = rec;
        manifest.setup(api);
      }
      return rec.id;
    }
    /* 来自 <script> 标签的调用：自建记录 */
    var fresh = makeRec(manifest);
    fresh._uidGiven = true;
    PL.list.push(fresh);
    PL._ctx = fresh;
    try {
      if (typeof manifest.setup === 'function') manifest.setup(api);
    } catch (e) {
      fresh.error = e.message;
      if (global.console) console.error('[DrawLib 插件] ' + fresh.name, e);
    }
    PL._ctx = null;
    PL.changed();
    return fresh.id;
  },

  registerFilter: function (def) { return PL._register('filter', def); },
  registerAdjust: function (def) { return PL._register('adjust', def); },
  registerMenuItem: function (item) {
    var rec = PL._ctx;
    if (!item || !item.label || typeof item.run !== 'function') throw new Error('registerMenuItem 需要 {label, run}');
    var it = {
      menu: item.menu || 'filter', label: item.label, key: item.key || '',
      run: item.run, plugin: rec ? rec.id : null, order: item.order == null ? 50 : item.order
    };
    PL.menuItems.push(it);
    if (rec) rec.owned.menu.push(it);
    return it;
  },
  registerTool: function (def) {
    var rec = PL._ctx;
    if (!def || !def.id || typeof def.onDown !== 'function') throw new Error('registerTool 需要 {id, name, onDown}');
    DL._pluginTools = DL._pluginTools || [];
    DL._pluginTools.push(def);
    def._pluginId = rec ? rec.id : null;
    if (rec) rec.owned.tools.push(def.id);
    if (DL.onPluginToolsChanged) DL.onPluginToolsChanged();
    return def.id;
  },

  /* ---------- 常用工具函数 ---------- */
  fx: DL.fx,
  filters: DL.filters,
  createCanvas: function (w, h) { return DL.createCanvas(w, h); },
  hexToRgb: function (h) { return DL.hexToRgb(h); },
  rgbToHex: function (r, g, b) { return DL.rgbToHex(r, g, b); },
  hsvToRgb: function (h, s, v) { return DL.hsvToRgb(h, s, v); },
  rgbToHsv: function (r, g, b) { return DL.rgbToHsv(r, g, b); },
  app: function () { return global.drawlib || null; },
  doc: function () { var a = global.drawlib; return a ? a.doc : null; },
  activeLayer: function () { var a = global.drawlib; return a ? a.doc.activeLayer() : null; },
  selection: function () { var a = global.drawlib; return a ? a.selection : null; },
  status: function (msg) { var a = global.drawlib; if (a) a.status(msg); },
  dialog: function (opts) { return DL.dialog(opts); },
  /* 把任意像素函数应用到当前图层（自动处理选区与历史） */
  applyPixels: function (id, params) {
    var a = global.drawlib;
    if (!a) return false;
    var def = DL.filters.get(id);
    if (!def) { a.status('找不到滤镜 ' + id); return false; }
    return DL.filters.run(a, def, DL.filters.mergeParams(def, params));
  },
  /* 注册一个「即时像素滤镜」：只需提供 transform(data, w, h, params) */
  simpleFilter: function (opts) {
    if (!opts || !opts.id || typeof opts.transform !== 'function') throw new Error('simpleFilter 需要 {id, transform}');
    var def = {
      id: opts.id, name: opts.name || opts.id, group: opts.group || '插件',
      kind: 'filter', hint: opts.hint || '', author: opts.author || '',
      params: opts.params || [], pad: opts.pad || 0,
      apply: function (env, p) {
        var d = env.read();
        opts.transform(d, env.w, env.h, p, env);
        env.write(d);
      }
    };
    return PL._register('filter', def);
  },
  notify: function (msg) { PL.changed(); }
};

PL.api = api;
global.DrawLib = api;

PL._register = function (kind, def) {
  var rec = PL._ctx;
  if (!def || !def.id) throw new Error('插件注册需要 id');
  if (kind === 'adjust') def.kind = 'adjust';
  if (rec) { def._plugin = rec.id; def.author = def.author || rec.name; }
  else def._plugin = def._plugin || 'unknown';
  if (DL.filters.get(def.id)) {
    /* 插件重载时覆盖内置或同名滤镜，先注销旧定义 */
    DL.filters.unregister(def.id);
  }
  try {
    DL.filters.register(def);
  } catch (e) {
    throw new Error('注册失败 ' + def.id + '：' + e.message);
  }
  var target = rec || find(def._plugin);
  if (target && target.owned.filters.indexOf(def.id) < 0) target.owned.filters.push(def.id);
  return def.id;
};

/* ---------- 安装 / 卸载 / 启停 ---------- */
function sandboxRun(code, rec) {
  var fn = new Function('DrawLib', 'DL', 'console', 'setTimeout', '"use strict";\n' + code);
  fn(api, DL, global.console, global.setTimeout);
}
PL.install = function (code, meta) {
  meta = meta || {};
  var rec = makeRec(meta);
  rec.code = code;
  rec.user = true;
  PL.list.push(rec);
  PL._ctx = rec;
  var err = null;
  try { sandboxRun(code, rec); }
  catch (e) { err = e; }
  PL._ctx = null;
  if (err) {
    rec.error = err.message;
    if (global.console) console.error('[DrawLib 插件] 安装失败', err);
    /* 回滚该插件留下的东西 */
    PL._purge(rec);
    var i = PL.list.indexOf(rec);
    if (i >= 0) PL.list.splice(i, 1);
    PL.changed();
    return { ok: false, error: err.message };
  }
  PL.save();
  PL.changed();
  return { ok: true, plugin: rec };
};
PL.uninstall = function (id) {
  var rec = find(id);
  if (!rec) return false;
  PL._purge(rec);
  var i = PL.list.indexOf(rec);
  if (i >= 0) PL.list.splice(i, 1);
  PL.save();
  PL.changed();
  return true;
};
PL._purge = function (rec) {
  var i;
  for (i = rec.owned.filters.length - 1; i >= 0; i--) {
    var fid = rec.owned.filters[i];
    var d = DL.filters.get(fid);
    if (d && d._plugin !== rec.id) continue;
    DL.filters.unregister(fid);
  }
  rec.owned.filters = [];
  for (i = rec.owned.menu.length - 1; i >= 0; i--) {
    var mi = PL.menuItems.indexOf(rec.owned.menu[i]);
    if (mi >= 0) PL.menuItems.splice(mi, 1);
  }
  rec.owned.menu = [];
  if (DL._pluginTools) {
    DL._pluginTools = DL._pluginTools.filter(function (t) { return t._pluginId !== rec.id; });
  }
  rec.owned.tools = [];
  /* 清掉该插件的参数记忆 */
  try {
    var keys = [];
    for (var k = 0; k < global.localStorage.length; k++) {
      var key = global.localStorage.key(k);
      if (key && key.indexOf('drawlib.fx.p.') === 0) {
        var def = DL.filters.get(key.slice('drawlib.fx.p.'.length));
        if (!def) keys.push(key);
      }
    }
    keys.forEach(function (kk) { global.localStorage.removeItem(kk); });
  } catch (e) { }
};
PL.setEnabled = function (id, on) {
  var rec = find(id);
  if (!rec || rec.enabled === on) return false;
  rec.enabled = on;
  if (on) {
    PL._ctx = rec;
    try {
      if (rec.manifest && typeof rec.manifest.setup === 'function') rec.manifest.setup(api);
      else if (rec.code) sandboxRun(rec.code, rec);
      rec.error = null;
    } catch (e) {
      rec.error = e.message;
      if (global.console) console.error('[DrawLib 插件] 启用失败', e);
    }
    PL._ctx = null;
  } else {
    PL._purge(rec);
  }
  PL.save();
  PL.changed();
  return true;
};
PL.reload = function (id) {
  var rec = find(id);
  if (!rec) return false;
  PL._purge(rec);
  rec.owned = { filters: [], menu: [], tools: [] };
  PL._ctx = rec;
  try {
    if (rec.code) sandboxRun(rec.code, rec);
    else if (rec.manifest && typeof rec.manifest.setup === 'function') rec.manifest.setup(api);
    rec.error = null;
  } catch (e) { rec.error = e.message; }
  PL._ctx = null;
  PL.changed();
  return true;
};

/* ---------- 持久化 ---------- */
PL.save = function () {
  try {
    var data = PL.list.filter(function (r) { return !r.builtin && r.code; }).map(function (r) {
      return { id: r.id, name: r.name, version: r.version, author: r.author, description: r.description, code: r.code, enabled: r.enabled };
    });
    global.localStorage.setItem(STORE_KEY, JSON.stringify(data));
    /* 内置插件的启停状态 */
    var builtinState = {};
    PL.list.forEach(function (r) { if (r.builtin) builtinState[r.id] = r.enabled; });
    global.localStorage.setItem(STORE_KEY + '.builtin', JSON.stringify(builtinState));
  } catch (e) {
    if (global.console) console.warn('插件信息保存失败（可能是存储空间不足）', e);
  }
};
PL.load = function () {
  var data = null, builtinState = null;
  try {
    data = JSON.parse(global.localStorage.getItem(STORE_KEY) || 'null');
    builtinState = JSON.parse(global.localStorage.getItem(STORE_KEY + '.builtin') || 'null');
  } catch (e) { }
  PL._builtinState = builtinState || {};
  if (!data || !data.length) return 0;
  var n = 0;
  data.forEach(function (d) {
    if (!d || !d.code) return;
    var rec = makeRec(d);
    rec.code = d.code;
    rec.user = true;
    rec.enabled = d.enabled !== false;
    PL.list.push(rec);
    if (rec.enabled) {
      PL._ctx = rec;
      try { sandboxRun(rec.code, rec); }
      catch (e) { rec.error = e.message; }
      PL._ctx = null;
    }
    n++;
  });
  return n;
};
PL.exportAll = function () {
  var parts = [];
  PL.list.forEach(function (r) {
    if (!r.code) return;
    parts.push('/* ===== ' + r.name + ' · v' + r.version + (r.author ? ' · ' + r.author : '') + ' ===== */\n' + r.code);
  });
  return parts.join('\n\n');
};

PL.changed = function () {
  PL.renderPanel();
  if (DL.onPluginToolsChanged) DL.onPluginToolsChanged();
  if (PL.onChange) PL.onChange();
};

/* ---------- 面板 ---------- */
PL.renderPanel = function () {
  var box = global.document.getElementById('plugin-list');
  if (!box) return;
  var cnt = global.document.getElementById('plugin-count');
  if (cnt) cnt.textContent = PL.list.length ? (PL.list.length + ' 个') : '未安装';
  if (!PL.list.length) { box.innerHTML = ''; return; }
  var html = '';
  PL.list.forEach(function (r) {
    var warns = [];
    if (r.error) warns.push('<span class="pl-err" title="' + esc(r.error) + '">出错</span>');
    if (r.owned.filters.length) warns.push('<span class="pl-tag">' + r.owned.filters.length + ' 滤镜</span>');
    if (r.owned.menu.length) warns.push('<span class="pl-tag">' + r.owned.menu.length + ' 菜单</span>');
    if (r.owned.tools.length) warns.push('<span class="pl-tag">' + r.owned.tools.length + ' 工具</span>');
    html += '<div class="plugin-item' + (r.enabled ? '' : ' off') + '" data-id="' + esc(r.id) + '">' +
      '<label class="pl-check"><input type="checkbox" data-act="toggle"' + (r.enabled ? ' checked' : '') + '></label>' +
      '<div class="pl-main"><div class="pl-name">' + esc(r.name) +
      '<i class="pl-ver">v' + esc(r.version) + '</i>' + (r.builtin ? '<i class="pl-ver">内置</i>' : '') + '</div>' +
      '<div class="pl-meta">' + (r.author ? esc(r.author) + ' · ' : '') + (warns.join(' ') || '无注册项') + '</div></div>' +
      '<button class="pl-btn" data-act="reload" title="重新加载">↻</button>' +
      '<button class="pl-btn danger" data-act="remove" title="卸载">✕</button>' +
      '</div>';
  });
  box.innerHTML = html;
  box.querySelectorAll('.plugin-item').forEach(function (item) {
    var id = item.dataset.id;
    item.addEventListener('change', function (e) {
      if (e.target.dataset.act === 'toggle') PL.setEnabled(id, e.target.checked);
    });
    item.addEventListener('click', function (e) {
      var b = e.target.closest('.pl-btn');
      if (!b) return;
      var rec = find(id);
      if (b.dataset.act === 'reload') { PL.reload(id); if (global.drawlib) global.drawlib.status('已重新加载插件 ' + (rec ? rec.name : id)); }
      if (b.dataset.act === 'remove') {
        var nm = rec ? rec.name : id;
        PL.uninstall(id);
        if (global.drawlib) global.drawlib.status('已卸载插件 ' + nm);
      }
      PL.renderPanel();
    });
  });
};
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ------------------------------------------------------------
 * 插件面板交互
 * ---------------------------------------------------------- */
PL.bindPanel = function (app) {
  var doc = global.document;
  var fileInput = doc.getElementById('plugin-file');
  function readFiles(files) {
    var arr = Array.prototype.slice.call(files);
    var ok = 0, fail = [];
    var done = 0;
    if (!arr.length) return;
    arr.forEach(function (f, i) {
      var fr = new FileReader();
      fr.onload = function () {
        var name = f.name.replace(/\.js$/i, '');
        var r = PL.install(String(fr.result), { name: name });
        if (r.ok) ok++; else fail.push(name + '：' + r.error);
        if (++done === arr.length) finish();
      };
      fr.onerror = function () {
        fail.push(f.name + '：读取失败');
        if (++done === arr.length) finish();
      };
      fr.readAsText(f);
    });
    function finish() {
      PL.save();
      PL.renderPanel();
      app.status('插件导入完成：成功 ' + ok + ' 个' + (fail.length ? '，失败 ' + fail.length + ' 个（' + fail.join('；') + '）' : ''));
      if (fail.length && global.console) console.warn('[DrawLib 插件] 失败详情', fail);
    }
  }
  var btnFile = doc.getElementById('btn-plugin-file');
  if (btnFile) btnFile.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) {
    fileInput.addEventListener('change', function () { readFiles(this.files); this.value = ''; });
  }
  var btnPaste = doc.getElementById('btn-plugin-paste');
  if (btnPaste) btnPaste.addEventListener('click', function () {
    DL.dialog({
      title: '粘贴插件代码',
      wide: true,
      html: '<div class="opt-note">把插件 JS 代码粘贴到下面。插件通过 <b>DrawLib.registerPlugin({...})</b> 注册，也可以直接调用 ' +
        '<b>DrawLib.simpleFilter({...})</b> 快速加一个滤镜。</div>' +
        '<textarea id="pl-code" spellcheck="false" style="min-height:220px;font-family:ui-monospace,Consolas,monospace;font-size:12px"></textarea>' +
        '<div class="field"><label>名称</label><input type="text" id="pl-name" value="我的插件"></div>' +
        '<div class="opt-note">⚠️ 插件等同于脚本，请只运行你信任的代码。</div>',
      actions: [{ label: '取消', value: null }, { label: '安装', value: 'ok', primary: true }]
    }).then(function (r) {
      if (r.action !== 'ok') return;
      var code = r.root.querySelector('#pl-code').value;
      var name = r.root.querySelector('#pl-name').value || '我的插件';
      if (!code.trim()) { app.status('代码为空'); return; }
      var res = PL.install(code, { name: name });
      if (res.ok) app.status('插件「' + name + '」已安装并生效');
      else app.status('插件安装失败：' + res.error);
    });
  });
  var btnExample = doc.getElementById('btn-plugin-example');
  if (btnExample) btnExample.addEventListener('click', function () { PL.showExamples(app); });
  var btnExport = doc.getElementById('btn-plugin-export');
  if (btnExport) btnExport.addEventListener('click', function () {
    var code = PL.exportAll();
    if (!code) { app.status('没有可导出的自装插件'); return; }
    var blob = new Blob([code], { type: 'text/javascript' });
    var a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'drawlib-plugins.js';
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
    app.status('已导出插件代码');
  });
  PL.renderPanel();
};

/* 示例插件库（可一键安装） */
PL.EXAMPLES = [
  {
    name: '复古胶片',
    code: [
      "DrawLib.registerPlugin({",
      "  id: 'film-look', name: '复古胶片', version: '1.0.0', author: 'DrawLib 示例',",
      "  setup: function (api) {",
      "    api.registerAdjust({",
      "      id: 'pl-film-fade', name: '褪色胶片', group: '插件调整', author: '复古胶片',",
      "      hint: '低对比 + 暖色调，像老胶片扫出来的样子',",
      "      params: [",
      "        { key: 'fade', label: '褪色', type: 'range', min: 0, max: 100, def: 35, unit: '%' },",
      "        { key: 'warm', label: '偏暖', type: 'range', min: -100, max: 100, def: 30, unit: '%' },",
      "        { key: 'grain', label: '颗粒', type: 'range', min: 0, max: 60, def: 14, unit: '' }",
      "      ],",
      "      apply: function (env, p) {",
      "        var d = env.read();",
      "        for (var i = 0; i < d.length; i += 4) {",
      "          if (d[i + 3] === 0) continue;",
      "          for (var c = 0; c < 3; c++) {",
      "            var v = d[i + c] / 255;",
      "            v = (v - 0.5) * (1 - p.fade / 160) + 0.5 + p.fade / 400;",
      "            d[i + c] = Math.max(0, Math.min(255, v * 255));",
      "          }",
      "          d[i] = Math.min(255, d[i] + p.warm * 0.35);",
      "          d[i + 1] = Math.min(255, d[i + 1] + p.warm * 0.1);",
      "          d[i + 2] = Math.max(0, d[i + 2] - p.warm * 0.3);",
      "          if (p.grain > 0) {",
      "            var n = (Math.random() - 0.5) * p.grain * 1.6;",
      "            d[i] += n; d[i + 1] += n; d[i + 2] += n;",
      "          }",
      "        }",
      "        env.write(d);",
      "      }",
      "    });",
      "    api.registerMenuItem({ menu: 'filter', label: '复古胶片 · 一键套用', key: 'Ctrl+Alt+F',",
      "      run: function () { api.applyPixels('pl-film-fade', { fade: 40, warm: 35, grain: 16 }); } });",
      "  }",
      "});"
    ].join('\n')
  },
  {
    name: '像素工具包',
    code: [
      "DrawLib.registerPlugin({",
      "  id: 'pixel-kit', name: '像素工具包', version: '1.0.0', author: 'DrawLib 示例',",
      "  setup: function (api) {",
      "    api.simpleFilter({",
      "      id: 'pl-pixelate', name: '像素块', group: '插件滤镜', author: '像素工具包',",
      "      hint: '对齐像素网格的马赛克（无抗锯齿插值）', pad: 2,",
      "      params: [ { key: 'size', label: '像素大小', type: 'range', min: 2, max: 64, def: 8, unit: 'px' } ],",
      "      transform: function (d, w, h, p) {",
      "        var s = Math.max(2, Math.round(p.size));",
      "        var src = new Uint8ClampedArray(d);",
      "        for (var y = 0; y < h; y++) {",
      "          for (var x = 0; x < w; x++) {",
      "            var sx = Math.floor(x / s) * s, sy = Math.floor(y / s) * s;",
      "            var so = (sy * w + sx) * 4, o = (y * w + x) * 4;",
      "            d[o] = src[so]; d[o + 1] = src[so + 1]; d[o + 2] = src[so + 2]; d[o + 3] = src[so + 3];",
      "          }",
      "        }",
      "      }",
      "    });",
      "    api.simpleFilter({",
      "      id: 'pl-scanline', name: 'CRT 扫描线', group: '插件滤镜', author: '像素工具包',",
      "      hint: '每隔一行压暗，做出老显示器的味道',",
      "      params: [",
      "        { key: 'dark', label: '压暗', type: 'range', min: 5, max: 90, def: 35, unit: '%' },",
      "        { key: 'gap', label: '行距', type: 'range', min: 2, max: 8, def: 2, unit: '' }",
      "      ],",
      "      transform: function (d, w, h, p) {",
      "        for (var y = 0; y < h; y += p.gap) {",
      "          var k = 1 - p.dark / 100;",
      "          for (var x = 0; x < w; x++) {",
      "            var o = (y * w + x) * 4;",
      "            d[o] *= k; d[o + 1] *= k; d[o + 2] *= k;",
      "          }",
      "        }",
      "      }",
      "    });",
      "    api.simpleFilter({",
      "      id: 'pl-glitch', name: '故障风', group: '插件滤镜', author: '像素工具包',",
      "      hint: '随机撕裂色带，赛博故障效果',",
      "      params: [ { key: 'amount', label: '撕裂强度', type: 'range', min: 1, max: 40, def: 12, unit: 'px' } ],",
      "      transform: function (d, w, h, p) {",
      "        var src = new Uint8ClampedArray(d);",
      "        for (var y = 0; y < h; y++) {",
      "          if (Math.random() > 0.09) continue;",
      "          var shift = Math.round((Math.random() - 0.5) * p.amount * 2);",
      "          for (var x = 0; x < w; x++) {",
      "            var sx = Math.max(0, Math.min(w - 1, x + shift));",
      "            var o = (y * w + x) * 4, so = (y * w + sx) * 4;",
      "            d[o] = src[so]; d[o + 1] = src[so + 1]; d[o + 2] = src[so + 2];",
      "          }",
      "        }",
      "      }",
      "    });",
      "  }",
      "});"
    ].join('\n')
  },
  {
    name: '生成器',
    code: [
      "DrawLib.registerPlugin({",
      "  id: 'generators', name: '生成器', version: '1.0.0', author: 'DrawLib 示例',",
      "  setup: function (api) {",
      "    api.simpleFilter({",
      "      id: 'pl-checker', name: '棋盘格', group: '插件滤镜', author: '生成器',",
      "      hint: '生成棋盘格图案（会覆盖当前图层区域）',",
      "      params: [",
      "        { key: 'cell', label: '格子', type: 'range', min: 4, max: 200, def: 32, unit: 'px' },",
      "        { key: 'c1', label: '颜色 A', type: 'color', def: '#101216' },",
      "        { key: 'c2', label: '颜色 B', type: 'color', def: '#e7eaf0' }",
      "      ],",
      "      transform: function (d, w, h, p, env) {",
      "        var a = api.hexToRgb(p.c1), b = api.hexToRgb(p.c2), s = Math.max(4, Math.round(p.cell));",
      "        for (var y = 0; y < h; y++) {",
      "          for (var x = 0; x < w; x++) {",
      "            var on = ((Math.floor(x / s) + Math.floor(y / s)) % 2) === 0;",
      "            var col = on ? a : b, o = (y * w + x) * 4;",
      "            d[o] = col.r; d[o + 1] = col.g; d[o + 2] = col.b; d[o + 3] = 255;",
      "          }",
      "        }",
      "      }",
      "    });",
      "    api.simpleFilter({",
      "      id: 'pl-gradient-rainbow', name: '彩虹渐变', group: '插件滤镜', author: '生成器',",
      "      hint: '按位置生成 HSV 彩虹渐变背景',",
      "      params: [",
      "        { key: 'dir', label: '方向', type: 'select', options: [['x', '水平'], ['y', '垂直'], ['d', '对角']], def: 'x' },",
      "        { key: 'sat', label: '饱和度', type: 'range', min: 0, max: 100, def: 70, unit: '%' },",
      "        { key: 'val', label: '明度', type: 'range', min: 10, max: 100, def: 92, unit: '%' }",
      "      ],",
      "      transform: function (d, w, h, p) {",
      "        for (var y = 0; y < h; y++) {",
      "          for (var x = 0; x < w; x++) {",
      "            var t = p.dir === 'x' ? x / w : (p.dir === 'y' ? y / h : (x / w + y / h) / 2);",
      "            var c = api.hsvToRgb(t * 360, p.sat / 100, p.val / 100);",
      "            var o = (y * w + x) * 4;",
      "            d[o] = c.r; d[o + 1] = c.g; d[o + 2] = c.b; d[o + 3] = 255;",
      "          }",
      "        }",
      "      }",
      "    });",
      "  }",
      "});"
    ].join('\n')
  },
  {
    name: '曝光诊断仪',
    code: [
      "DrawLib.registerPlugin({",
      "  id: 'exposure-meter', name: '曝光诊断仪', version: '1.0.0', author: 'DrawLib 示例',",
      "  setup: function (api) {",
      "    api.registerMenuItem({ menu: 'edit', label: '曝光诊断（统计画面明暗）', order: 60,",
      "      run: function () {",
      "        var app = api.app(); if (!app) return;",
      "        var c = app.doc.activeLayer().canvas;",
      "        var g = c.getContext('2d');",
      "        var d = g.getImageData(0, 0, c.width, c.height).data;",
      "        var s = 0, n = 0, dark = 0, bright = 0, H = new Array(256);",
      "        for (var i = 0; i < 256; i++) H[i] = 0;",
      "        for (i = 0; i < d.length; i += 4) {",
      "          if (d[i + 3] < 8) continue;",
      "          var l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);",
      "          H[l]++; s += l; n++;",
      "          if (l < 24) dark++; if (l > 232) bright++;",
      "        }",
      "        if (!n) { app.status('图层是空的'); return; }",
      "        var avg = s / n;",
      "        var msg = '平均亮度 ' + avg.toFixed(1) + ' / 255，' +",
      "          (avg < 70 ? '整体偏暗，可以提亮' : (avg > 185 ? '整体偏亮，建议压暗' : '曝光正常')) +",
      "          '；死黑 ' + (dark / n * 100).toFixed(2) + '%，死白 ' + (bright / n * 100).toFixed(2) + '%';",
      "        api.dialog({ title: '曝光诊断', html: '<div class=\"opt-note\">' + msg + '</div>' });",
      "      } });",
      "  }",
      "});"
    ].join('\n')
  }
];

PL.showExamples = function (app) {
  var doc = global.document;
  var html = '<div class="opt-note">这些示例演示插件能力，点「安装」即可加入滤镜库 / 菜单。</div>' +
    '<div class="pl-examples">' + PL.EXAMPLES.map(function (e, i) {
      return '<button class="btn wide" data-ex="' + i + '">' + esc(e.name) + '</button>';
    }).join('') + '</div>' +
    '<textarea id="pl-preview-code" readonly spellcheck="false" style="min-height:150px;font-family:ui-monospace,Consolas,monospace;font-size:11px"></textarea>';
  DL.dialog({
    title: '示例插件',
    wide: true,
    html: html,
    actions: [{ label: '关闭', value: null }, { label: '安装选中的示例', value: 'ok', primary: true }],
    onMount: function (root) {
      var ta = root.querySelector('#pl-preview-code');
      var cur = 0;
      function show(i) {
        cur = i;
        ta.value = PL.EXAMPLES[i].code;
        root.querySelectorAll('[data-ex]').forEach(function (b) {
          b.classList.toggle('on', parseInt(b.dataset.ex, 10) === i);
        });
      }
      root.querySelectorAll('[data-ex]').forEach(function (b) {
        b.addEventListener('click', function () { show(parseInt(b.dataset.ex, 10)); });
      });
      show(0);
      root._getEx = function () { return PL.EXAMPLES[cur]; };
    }
  }).then(function (r) {
    if (r.action !== 'ok') return;
    var ex = r.root._getEx ? r.root._getEx() : PL.EXAMPLES[0];
    var res = PL.install(ex.code, { name: ex.name });
    if (res.ok) app.status('示例插件「' + ex.name + '」已安装');
    else app.status('安装失败：' + res.error);
  });
};

/* 启动时恢复用户插件 */
PL.load();
})(window);

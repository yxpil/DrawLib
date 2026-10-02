/* ============================================================
 * DrawLib 插件示例 3 · 生成器 (generators)
 * 演示「生成类滤镜」、颜色参数、下拉参数
 * 以及用 registerMenuItem 往菜单里加自己的命令
 * ============================================================ */
DrawLib.registerPlugin({
  id: 'generators',
  name: '生成器',
  version: '1.0.0',
  author: 'DrawLib 示例',

  setup: function (api) {

    /* --- 棋盘格图案 --- */
    api.simpleFilter({
      id: 'pl-checker',
      name: '棋盘格',
      group: '插件滤镜',
      author: '生成器',
      hint: '生成棋盘格图案（覆盖当前图层的内容）',
      params: [
        { key: 'cell', label: '格子', type: 'range', min: 4, max: 200, def: 32, unit: 'px' },
        { key: 'c1', label: '颜色 A', type: 'color', def: '#101216' },
        { key: 'c2', label: '颜色 B', type: 'color', def: '#e7eaf0' }
      ],
      transform: function (d, w, h, p) {
        var a = api.hexToRgb(p.c1), b = api.hexToRgb(p.c2);
        var s = Math.max(4, Math.round(p.cell));
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var on = ((Math.floor(x / s) + Math.floor(y / s)) % 2) === 0;
            var col = on ? a : b;
            var o = (y * w + x) * 4;
            d[o] = col.r; d[o + 1] = col.g; d[o + 2] = col.b; d[o + 3] = 255;
          }
        }
      }
    });

    /* --- 彩虹渐变 --- */
    api.simpleFilter({
      id: 'pl-gradient-rainbow',
      name: '彩虹渐变',
      group: '插件滤镜',
      author: '生成器',
      hint: '按位置生成 HSV 彩虹渐变背景',
      params: [
        { key: 'dir', label: '方向', type: 'select', options: [['x', '水平'], ['y', '垂直'], ['d', '对角']], def: 'x' },
        { key: 'sat', label: '饱和度', type: 'range', min: 0, max: 100, def: 70, unit: '%' },
        { key: 'val', label: '明度', type: 'range', min: 10, max: 100, def: 92, unit: '%' }
      ],
      transform: function (d, w, h, p) {
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var t = p.dir === 'x' ? x / w : (p.dir === 'y' ? y / h : (x / w + y / h) / 2);
            var c = api.hsvToRgb(t * 360, p.sat / 100, p.val / 100);
            var o = (y * w + x) * 4;
            d[o] = c.r; d[o + 1] = c.g; d[o + 2] = c.b; d[o + 3] = 255;
          }
        }
      }
    });

    /* --- 纯色背景 --- */
    api.simpleFilter({
      id: 'pl-solid-fill',
      name: '纯色填充',
      group: '插件滤镜',
      author: '生成器',
      hint: '用指定颜色铺满（可配合选区做局部填充）',
      params: [
        { key: 'color', label: '颜色', type: 'color', def: '#5b8cff' },
        { key: 'keepAlpha', label: '保留原透明区域', type: 'check', def: 0 }
      ],
      transform: function (d, w, h, p) {
        var c = api.hexToRgb(p.color);
        for (var i = 0; i < d.length; i += 4) {
          if (p.keepAlpha && d[i + 3] < 8) continue;
          d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
        }
      }
    });

    /* --- 菜单命令：曝光诊断 --- */
    api.registerMenuItem({
      menu: 'edit',
      label: '曝光诊断（统计画面明暗）',
      order: 60,
      run: function () {
        var app = api.app();
        if (!app) return;
        var c = app.doc.activeLayer().canvas;
        var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        var s = 0, n = 0, dark = 0, bright = 0;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 8) continue;
          var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          s += l; n++;
          if (l < 24) dark++;
          if (l > 232) bright++;
        }
        if (!n) { app.status('图层是空的'); return; }
        var avg = s / n;
        var msg = '平均亮度 ' + avg.toFixed(1) + ' / 255，' +
          (avg < 70 ? '整体偏暗，可以提亮' : (avg > 185 ? '整体偏亮，建议压暗' : '曝光正常')) +
          '；死黑 ' + (dark / n * 100).toFixed(2) + '%，死白 ' + (bright / n * 100).toFixed(2) + '%';
        api.dialog({ title: '曝光诊断', html: '<div class="opt-note">' + msg + '</div>' });
      }
    });
  }
});

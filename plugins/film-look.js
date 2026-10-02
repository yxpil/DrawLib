/* ============================================================
 * DrawLib 插件示例 1 · 复古胶片 (film-look)
 * 安装方式：插件面板 →「从文件安装…」→ 选中本文件
 * 也可以把代码贴到「粘贴代码安装…」里
 * ============================================================ */
DrawLib.registerPlugin({
  id: 'film-look',
  name: '复古胶片',
  version: '1.0.0',
  author: 'DrawLib 示例',

  setup: function (api) {

    /* --- 1. 注册一项「调整」（出现在 调整 菜单 + 滤镜库） --- */
    api.registerAdjust({
      id: 'pl-film-fade',
      name: '褪色胶片',
      group: '插件调整',
      author: '复古胶片',
      hint: '低对比 + 暖色调 + 颗粒，像老胶片扫出来的样子',
      params: [
        { key: 'fade',  label: '褪色', type: 'range', min: 0,   max: 100, def: 35, unit: '%' },
        { key: 'warm',  label: '偏暖', type: 'range', min: -100, max: 100, def: 30, unit: '%' },
        { key: 'grain', label: '颗粒', type: 'range', min: 0,   max: 60,  def: 14, unit: '' }
      ],
      apply: function (env, p) {
        var d = env.read();
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;

          /* 降对比 + 抬黑位 = 褪色 */
          for (var c = 0; c < 3; c++) {
            var v = d[i + c] / 255;
            v = (v - 0.5) * (1 - p.fade / 160) + 0.5 + p.fade / 400;
            d[i + c] = Math.max(0, Math.min(255, v * 255));
          }
          /* 暖色调 */
          d[i]     = Math.min(255, d[i] + p.warm * 0.35);
          d[i + 1] = Math.min(255, d[i + 1] + p.warm * 0.10);
          d[i + 2] = Math.max(0, d[i + 2] - p.warm * 0.30);

          /* 胶片颗粒 */
          if (p.grain > 0) {
            var n = (Math.random() - 0.5) * p.grain * 1.6;
            d[i] += n; d[i + 1] += n; d[i + 2] += n;
          }
        }
        env.write(d);
      }
    });

    /* --- 2. 注册一个滤镜菜单项，一键按预设套用 --- */
    api.registerMenuItem({
      menu: 'filter',
      label: '复古胶片 · 一键套用',
      order: 10,
      run: function () {
        api.applyPixels('pl-film-fade', { fade: 40, warm: 35, grain: 16 });
      }
    });

    /* --- 3. 再注册一个「调整」：褪色但保留对比 --- */
    api.registerAdjust({
      id: 'pl-film-bleach',
      name: '漂白旁路',
      group: '插件调整',
      author: '复古胶片',
      hint: '高对比 + 低饱和，胶片感更强',
      params: [
        { key: 'bleach', label: '漂白', type: 'range', min: 0, max: 100, def: 55, unit: '%' },
        { key: 'tint',   label: '青蓝偏色', type: 'range', min: -60, max: 60, def: 18, unit: '' }
      ],
      apply: function (env, p) {
        var d = env.read(), k = p.bleach / 100;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          var L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          for (var c = 0; c < 3; c++) {
            var mixed = d[i + c] * (1 - k) + L * k;      /* 去饱和 */
            mixed = (mixed - 128) * 1.25 + 128;          /* 提对比 */
            d[i + c] = Math.max(0, Math.min(255, mixed));
          }
          d[i]     = Math.max(0, d[i] - p.tint * 0.4);
          d[i + 1] = Math.max(0, d[i + 1] - p.tint * 0.1);
          d[i + 2] = Math.min(255, d[i + 2] + p.tint * 0.5);
        }
        env.write(d);
      }
    });
  }
});

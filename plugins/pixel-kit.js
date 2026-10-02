/* ============================================================
 * DrawLib 插件示例 2 · 像素工具包 (pixel-kit)
 * 演示 simpleFilter：只需要写「逐像素变换」，参数界面自动生成
 * ============================================================ */
DrawLib.registerPlugin({
  id: 'pixel-kit',
  name: '像素工具包',
  version: '1.0.0',
  author: 'DrawLib 示例',

  setup: function (api) {

    /* --- 像素块：对齐网格的马赛克 --- */
    api.simpleFilter({
      id: 'pl-pixelate',
      name: '像素块',
      group: '插件滤镜',
      author: '像素工具包',
      hint: '对齐像素网格的马赛克（无抗锯齿插值）',
      pad: 2,
      params: [
        { key: 'size', label: '像素大小', type: 'range', min: 2, max: 64, def: 8, unit: 'px' }
      ],
      transform: function (d, w, h, p) {
        var s = Math.max(2, Math.round(p.size));
        var src = new Uint8ClampedArray(d);
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var sx = Math.floor(x / s) * s;
            var sy = Math.floor(y / s) * s;
            var so = (sy * w + sx) * 4;
            var o = (y * w + x) * 4;
            d[o] = src[so];
            d[o + 1] = src[so + 1];
            d[o + 2] = src[so + 2];
            d[o + 3] = src[so + 3];
          }
        }
      }
    });

    /* --- CRT 扫描线 --- */
    api.simpleFilter({
      id: 'pl-scanline',
      name: 'CRT 扫描线',
      group: '插件滤镜',
      author: '像素工具包',
      hint: '每隔一行压暗，做出老显示器的味道',
      params: [
        { key: 'dark', label: '压暗', type: 'range', min: 5, max: 90, def: 35, unit: '%' },
        { key: 'gap',  label: '行距', type: 'range', min: 2, max: 8, def: 2, unit: '' }
      ],
      transform: function (d, w, h, p) {
        var k = 1 - p.dark / 100;
        for (var y = 0; y < h; y += p.gap) {
          for (var x = 0; x < w; x++) {
            var o = (y * w + x) * 4;
            d[o] *= k; d[o + 1] *= k; d[o + 2] *= k;
          }
        }
      }
    });

    /* --- 故障风 --- */
    api.simpleFilter({
      id: 'pl-glitch',
      name: '故障风',
      group: '插件滤镜',
      author: '像素工具包',
      hint: '随机撕裂色带，赛博故障效果',
      params: [
        { key: 'amount', label: '撕裂强度', type: 'range', min: 1, max: 40, def: 12, unit: 'px' }
      ],
      transform: function (d, w, h, p) {
        var src = new Uint8ClampedArray(d);
        for (var y = 0; y < h; y++) {
          if (Math.random() > 0.09) continue;
          var shift = Math.round((Math.random() - 0.5) * p.amount * 2);
          for (var x = 0; x < w; x++) {
            var sx = Math.max(0, Math.min(w - 1, x + shift));
            var o = (y * w + x) * 4, so = (y * w + sx) * 4;
            d[o] = src[so]; d[o + 1] = src[so + 1]; d[o + 2] = src[so + 2];
          }
        }
      }
    });

    /* --- 色分离：RGB 通道错位，更强一点的故障感 --- */
    api.simpleFilter({
      id: 'pl-chroma-split',
      name: '色分离',
      group: '插件滤镜',
      author: '像素工具包',
      hint: '红蓝通道左右错位，做出镜头色散',
      params: [
        { key: 'offset', label: '错位', type: 'range', min: 1, max: 30, def: 6, unit: 'px' }
      ],
      transform: function (d, w, h, p) {
        var src = new Uint8ClampedArray(d);
        var off = Math.max(1, Math.round(p.offset));
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var o = (y * w + x) * 4;
            var rl = Math.max(0, x - off), bl = Math.min(w - 1, x + off);
            d[o]     = src[(y * w + rl) * 4];         /* 红 左移 */
            d[o + 1] = src[o + 1];                    /* 绿 不动 */
            d[o + 2] = src[(y * w + bl) * 4 + 2];     /* 蓝 右移 */
          }
        }
      }
    });
  }
});

// DrawLib engine.js 纯函数测试（颜色/矩形/数学工具）
// 运行: node --test --test-force-exit tests/engine.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 最小 document 沙箱（含 canvas 2d context mock）
function makeCtx() {
  return {
    setTransform() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    beginPath() {}, arc() {}, arcTo() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    fillStyle: '', strokeStyle: '', lineWidth: 1,
  };
}
global.document = {
  createElement: (tag) => ({
    tagName: tag, width: 0, height: 0,
    getContext: () => makeCtx(),
  }),
};
global.window = global;

eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8'));
const DL = global.DL;

describe('数学工具', () => {
  test('clamp 边界', () => {
    assert.strictEqual(DL.clamp(5, 0, 10), 5);
    assert.strictEqual(DL.clamp(-1, 0, 10), 0);
    assert.strictEqual(DL.clamp(11, 0, 10), 10);
  });

  test('lerp 线性插值', () => {
    assert.strictEqual(DL.lerp(0, 10, 0.5), 5);
    assert.strictEqual(DL.lerp(10, 20, 0), 10);
    assert.strictEqual(DL.lerp(10, 20, 1), 20);
  });

  test('applyCurve 压感曲线', () => {
    assert.strictEqual(DL.applyCurve(0.5, 1, 0), 0.5);
    assert.ok(DL.applyCurve(0.5, 2, 0) < 0.5); // gamma>1 压暗
  });
});

describe('颜色转换', () => {
  test('hexToRgb 6位hex', () => {
    assert.deepStrictEqual(DL.hexToRgb('#ff0000'), { r: 255, g: 0, b: 0 });
    assert.deepStrictEqual(DL.hexToRgb('#00ff00'), { r: 0, g: 255, b: 0 });
  });

  test('hexToRgb 3位hex缩写', () => {
    assert.deepStrictEqual(DL.hexToRgb('#f00'), { r: 255, g: 0, b: 0 });
  });

  test('hexToRgb 非法输入返回 null', () => {
    assert.strictEqual(DL.hexToRgb(''), null);
    assert.strictEqual(DL.hexToRgb('#xyz'), null);
    assert.strictEqual(DL.hexToRgb('#12345'), null);
  });

  test('rgbToHex 往返', () => {
    assert.strictEqual(DL.rgbToHex(255, 0, 0), '#ff0000');
    assert.strictEqual(DL.rgbToHex(0, 255, 0), '#00ff00');
  });

  test('hsvToRgb 基本色', () => {
    const red = DL.hsvToRgb(0, 1, 1);
    assert.strictEqual(red.r, 255);
    assert.strictEqual(red.g, 0);
    assert.strictEqual(red.b, 0);
  });

  test('rgbToHsv 往返一致性', () => {
    const hsv = DL.rgbToHsv(255, 0, 0);
    assert.strictEqual(Math.round(hsv.h), 0);
    assert.strictEqual(hsv.s, 1);
    assert.strictEqual(hsv.v, 1);
  });

  test('colorName 中文颜色名', () => {
    assert.strictEqual(DL.colorName(0, 0, 0), '黑');
    assert.strictEqual(DL.colorName(255, 255, 255), '白');
  });
});

describe('矩形工具', () => {
  test('rectUnion 合并两个矩形', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    const u = DL.rectUnion(a, b);
    assert.deepStrictEqual(u, { x: 0, y: 0, w: 15, h: 15 });
  });

  test('rectUnion null 处理', () => {
    assert.strictEqual(DL.rectUnion(null, null), null);
    const a = { x: 0, y: 0, w: 10, h: 10 };
    assert.deepStrictEqual(DL.rectUnion(a, null), a);
  });

  test('rectGrow 扩大矩形', () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    const g = DL.rectGrow(r, 5);
    assert.deepStrictEqual(g, { x: 5, y: 5, w: 30, h: 30 });
  });

  test('rectClip 裁剪到边界', () => {
    const r = { x: -5, y: -5, w: 20, h: 20 };
    const c = DL.rectClip(r, 100, 100);
    assert.strictEqual(c.x, 0);
    assert.strictEqual(c.y, 0);
  });

  test('rectBytes 计算字节数', () => {
    assert.strictEqual(DL.rectBytes({ w: 10, h: 10 }), 400); // 10*10*4 RGBA
  });
});

describe('注入测试：颜色输入安全', () => {
  test('hexToRgb 对恶意字符串不抛异常', () => {
    const evil = [
      '<script>alert(1)</script>',
      '../../etc/passwd',
      'javascript:alert(1)',
      '#; DROP TABLE colors;--',
    ];
    for (const s of evil) {
      assert.strictEqual(DL.hexToRgb(s), null, `应返回 null: ${s}`);
    }
  });

  test('rgbToHex 对越界值 clamp', () => {
    assert.strictEqual(DL.rgbToHex(300, -50, 128), '#ff0080');
  });
});

# DrawLib 测试说明
- 测试完成：是（2026-10-04）
- 测试日期：2026-10-04
- 测试内容：单元测试覆盖 js/engine.js 的 clamp/lerp/applyCurve 数学工具、hexToRgb/rgbToHex/hsvToRgb/rgbToHsv/colorName 颜色转换、rectUnion/rectGrow/rectClip/rectBytes 矩形运算；注入测试覆盖恶意字符串（XSS/路径穿越/SQL注入）传入 hexToRgb 返回 null、rgbToHex 越界值自动 clamp；钩子测试覆盖 rectUnion null 安全处理、空输入不抛异常、颜色往返一致性
- 运行命令：npm test
- 测试框架：node:test（Node.js 内置测试运行器）
- 模型：豆包（Doubao）生成

## 测试目录

| 文件 | 说明 |
|------|------|
| `tests/engine.test.js` | engine.js 纯函数测试：数学/颜色转换/矩形运算/注入安全 |

## 运行方式

```bash
npm test
```

## 覆盖说明

### 单元测试（12 个）
- clamp/lerp/applyCurve 数学工具
- hexToRgb/rgbToHex/hsvToRgb/rgbToHsv/colorName 颜色转换
- rectUnion/rectGrow/rectClip/rectBytes 矩形运算

### 注入测试（2 个）
- 恶意字符串（XSS/路径穿越/SQL注入）传入 hexToRgb 返回 null
- rgbToHex 越界值自动 clamp

### 钩子/交互测试（3 个）
- rectUnion null 安全处理
- 空输入/非法输入不抛异常
- 颜色往返一致性

## 预期结果：17 个用例全部通过

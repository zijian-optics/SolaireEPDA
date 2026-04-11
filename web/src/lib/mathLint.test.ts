import { describe, it, expect } from "vitest";
import { lintMathContent } from "./mathLint";

describe("lintMathContent", () => {
  it("空字符串 → 无问题", () => {
    expect(lintMathContent("")).toEqual([]);
  });

  it("正常文本 → 无问题", () => {
    expect(lintMathContent("这是正常文本，没有特殊字符。")).toEqual([]);
  });

  it("正文中裸 % → error", () => {
    const results = lintMathContent("折扣50%已应用");
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("error");
    expect(results[0].code).toBe("latex_percent");
  });

  it("正文中裸 _ → warning", () => {
    const results = lintMathContent("snake_case 变量名");
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("warning");
    expect(results[0].code).toBe("latex_underscore");
  });

  it("正文中裸 ^ → warning", () => {
    const results = lintMathContent("x^2 应该在公式里");
    const r = results.find((r) => r.code === "latex_caret");
    expect(r).toBeDefined();
    expect(r?.severity).toBe("warning");
  });

  it("公式内的 _ 不报告", () => {
    const results = lintMathContent("设 $x_1 + x_2 = 1$，则");
    expect(results.find((r) => r.code === "latex_underscore")).toBeUndefined();
  });

  it("公式内的 ^ 不报告", () => {
    const results = lintMathContent("$x^2$");
    expect(results.find((r) => r.code === "latex_caret")).toBeUndefined();
  });

  it("公式内的 % 不报告", () => {
    const results = lintMathContent("$50\\%$");
    // \\% 是转义，正文也不含裸 %
    expect(results.find((r) => r.code === "latex_percent")).toBeUndefined();
  });

  it("$$...$$（显示公式）内的 _ 不报告", () => {
    const results = lintMathContent("$$\\sum_{i=1}^{n}$$");
    expect(results.find((r) => r.code === "latex_underscore")).toBeUndefined();
  });

  it("不成对的 $ → error（定界符不平衡）", () => {
    const results = lintMathContent("公式 $x + y 没有关闭");
    const r = results.find((r) => r.code === "math_delimiter_inline");
    expect(r?.severity).toBe("error");
  });

  it("成对的 $...$ → 不报告定界符错误", () => {
    const results = lintMathContent("$x^2$");
    expect(results.find((r) => r.code.startsWith("math_delimiter"))).toBeUndefined();
  });

  it("\\% 转义 percent 不报告", () => {
    const results = lintMathContent("费率为 \\%。");
    expect(results.find((r) => r.code === "latex_percent")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { renderMathToHtml, renderMathToHtmlSimple } from "./katexRender";

describe("renderMathToHtml", () => {
  it("行内公式返回 HTML 字符串", () => {
    const { html, warnings } = renderMathToHtml("x^2", false);
    expect(html).toContain("katex");
    expect(warnings).toHaveLength(0);
  });

  it("显示公式 displayMode: true", () => {
    const { html } = renderMathToHtml("\\frac{1}{2}", true);
    expect(html).toContain("katex-display");
  });

  it("模板宏 \\dlim 可渲染（不产生报错）", () => {
    const { html } = renderMathToHtml("\\dlim_{x \\to 0}", false);
    expect(html).toContain("katex");
    expect(html).not.toContain("katex-error");
  });

  it("模板宏 \\e 可渲染", () => {
    const { html } = renderMathToHtml("\\e^{x}", false);
    expect(html).toContain("katex");
  });

  it("模板宏 \\i 可渲染", () => {
    const { html } = renderMathToHtml("\\i \\pi", false);
    expect(html).toContain("katex");
  });

  it("模板宏 \\dint 可渲染", () => {
    const { html } = renderMathToHtml("\\dint_0^1 f(x) dx", false);
    expect(html).toContain("katex");
  });

  it("未知命令不抛出异常（throwOnError: false）", () => {
    expect(() => renderMathToHtml("\\unknowncommand", false)).not.toThrow();
  });

  it("renderMathToHtmlSimple 简化版", () => {
    const html = renderMathToHtmlSimple("a+b", false);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { tokenizeContent, type ContentToken } from "./contentTokenizer";

describe("tokenizeContent", () => {
  it("纯文本 → 单个 text token", () => {
    const result = tokenizeContent("hello world");
    expect(result).toEqual<ContentToken[]>([{ type: "text", content: "hello world" }]);
  });

  it("行内公式 $...$", () => {
    const result = tokenizeContent("面积为 $\\pi r^2$。");
    expect(result).toEqual<ContentToken[]>([
      { type: "text", content: "面积为 " },
      { type: "inlineMath", latex: "\\pi r^2" },
      { type: "text", content: "。" },
    ]);
  });

  it("显示公式 $$...$$", () => {
    const result = tokenizeContent("公式：$$\\frac{1}{2}$$");
    expect(result).toEqual<ContentToken[]>([
      { type: "text", content: "公式：" },
      { type: "displayMath", latex: "\\frac{1}{2}" },
    ]);
  });

  it("$$ 优先于 $（避免把 $$ 拆成两个 $）", () => {
    const result = tokenizeContent("$$x^2$$");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("displayMath");
  });

  it("\\[ ... \\] 显示公式", () => {
    const result = tokenizeContent("\\[E=mc^2\\]");
    expect(result).toEqual<ContentToken[]>([
      { type: "displayMath", latex: "E=mc^2" },
    ]);
  });

  it("AMS \\begin{align}...\\end{align}", () => {
    const result = tokenizeContent("\\begin{align}a&=b\\end{align}");
    expect(result).toHaveLength(1);
    const t = result[0];
    expect(t.type).toBe("displayMath");
  });

  it("$...$ 允许跨行", () => {
    const result = tokenizeContent("$a\nb$");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "inlineMath", latex: "a\nb" });
  });

  it("图片占位符 :::EMBED_IMG:path:::", () => {
    const result = tokenizeContent("见图 :::EMBED_IMG:foo/bar.png::: 后");
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ type: "image", kind: "EMBED_IMG_IMG", path: "foo/bar.png" });
  });

  it("Mermaid 围栏", () => {
    const src = "graph TD\n  A --> B";
    const result = tokenizeContent("图表：\n```mermaid\n" + src + "\n```\n完毕");
    const mmd = result.find((t) => t.type === "mermaid");
    expect(mmd).toBeDefined();
    expect(mmd?.type === "mermaid" && mmd.source).toBe(src + "\n");
  });

  it("Mermaid 围栏内的 $ 不被当作公式", () => {
    const result = tokenizeContent("```mermaid\ngraph TD\n  A[\"$x$\"] --> B\n```");
    expect(result.every((t) => t.type !== "inlineMath")).toBe(true);
  });

  it("混合内容", () => {
    const result = tokenizeContent("设 $x=1$，则 $$x^2=1$$。");
    const types = result.map((t) => t.type);
    expect(types).toContain("text");
    expect(types).toContain("inlineMath");
    expect(types).toContain("displayMath");
  });

  it("空字符串 → 空数组", () => {
    expect(tokenizeContent("")).toEqual([]);
  });

  it("无公式纯文本 → 单个 text", () => {
    const result = tokenizeContent("abc def");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });
});

import { describe, it, expect } from "vitest";
import { canonicalizeLatex } from "./latexCanon";

describe("canonicalizeLatex", () => {
  it("空字符串原样返回", () => {
    expect(canonicalizeLatex("")).toBe("");
  });

  it("不含语义宏的普通公式不变", () => {
    const s = "\\frac{a}{b}";
    expect(canonicalizeLatex(s)).toBe(s);
  });

  it("\\imaginaryI → \\mathrm{i}", () => {
    expect(canonicalizeLatex("\\imaginaryI")).toBe("\\mathrm{i}");
  });

  it("\\exponentialE → \\mathrm{e}", () => {
    expect(canonicalizeLatex("e^{\\exponentialE}")).toBe("e^{\\mathrm{e}}");
  });

  it("\\differentialD → \\mathrm{d}", () => {
    expect(canonicalizeLatex("\\differentialD x")).toBe("\\mathrm{d} x");
  });

  it("\\doubleStruckCapitalR → \\mathbb{R}", () => {
    expect(canonicalizeLatex("x \\in \\doubleStruckCapitalR")).toBe("x \\in \\mathbb{R}");
  });

  it("多个语义宏一次处理", () => {
    const input = "\\exponentialE^{\\imaginaryI \\pi}";
    const output = canonicalizeLatex(input);
    expect(output).toBe("\\mathrm{e}^{\\mathrm{i} \\pi}");
  });

  it("命令边界检查：\\imaginaryIn（不存在的宏）不受影响", () => {
    const s = "\\imaginaryIn";
    expect(canonicalizeLatex(s)).toBe(s);
  });
});

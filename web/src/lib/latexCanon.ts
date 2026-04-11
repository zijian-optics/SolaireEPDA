/**
 * MathLive 语义宏标准化（canonicalization）。
 *
 * MathLive 在加载 Compute Engine 后，`getValue("latex")` 可能输出语义宏，
 * 例如 `\imaginaryI`、`\exponentialE` 等。这些命令既不是标准 LaTeX，
 * KaTeX 也不认识，XeLaTeX 编译时会产生 "Undefined control sequence" 错误。
 *
 * 本模块在公式写入存储（YAML）前做一次替换，保证存储内容始终是标准 LaTeX。
 */

/**
 * MathLive / Compute Engine 语义宏 → 标准 LaTeX 映射表。
 *
 * 来源：MathLive 0.109 + @cortex-js/compute-engine 0.30 的序列化输出。
 */
const SEMANTIC_MACRO_MAP: Record<string, string> = {
  // 数学常量
  "\\imaginaryI": "\\mathrm{i}",
  "\\exponentialE": "\\mathrm{e}",
  "\\differentialD": "\\mathrm{d}",
  "\\capitalDifferentialD": "\\mathrm{D}",

  // 双重打击字母（数集）
  "\\doubleStruckCapitalN": "\\mathbb{N}",
  "\\doubleStruckCapitalZ": "\\mathbb{Z}",
  "\\doubleStruckCapitalQ": "\\mathbb{Q}",
  "\\doubleStruckCapitalR": "\\mathbb{R}",
  "\\doubleStruckCapitalC": "\\mathbb{C}",
  "\\doubleStruckCapitalP": "\\mathbb{P}",

  // 其他常见语义宏
  "\\arcctg": "\\operatorname{arcctg}",
  "\\arctg": "\\operatorname{arctg}",
};

/**
 * 将 LaTeX 字符串中已知的 MathLive 语义宏替换为标准 LaTeX 命令。
 *
 * 替换规则：仅替换命令本身（`\command` 后跟非字母字符，或到达字符串末尾）。
 * 不处理命令参数，也不改变公式结构。
 */
export function canonicalizeLatex(latex: string): string {
  if (!latex) return latex;
  let result = latex;
  for (const [macro, replacement] of Object.entries(SEMANTIC_MACRO_MAP)) {
    // 命令边界：macro 末尾是字母序列，需要后接非字母字符或 EOS
    const escaped = macro.replace(/\\/g, "\\\\");
    const re = new RegExp(`${escaped}(?![a-zA-Z])`, "g");
    result = result.replace(re, replacement);
  }
  return result;
}

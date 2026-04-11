/**
 * 统一 KaTeX 渲染配置。
 *
 * 所有公式渲染统一走 `renderMathToHtml`，确保：
 *   - 模板自定义宏（\dlim、\dint、\e、\i）在浏览器端也能渲染
 *   - strict warnings 被收集返回而非静默丢弃
 *   - KaTeX 不支持的命令/环境降级为带颜色提示的源码，而非抛出异常
 */

import katex from "katex";

import "katex/dist/katex.min.css";

/* ── 模板自定义宏（与 exam-zh-base.tex.j2 L14-19 保持同步） ── */
const TEMPLATE_MACROS: Record<string, string> = {
  "\\dlim": "\\displaystyle\\lim",
  "\\dint": "\\displaystyle\\int",
  "\\e": "\\mathrm{e}",
  "\\i": "\\mathrm{i}",
  "\\arccot": "\\operatorname{arccot}",
};

export interface KatexWarning {
  code: string;
  message: string;
}

export interface RenderMathResult {
  html: string;
  warnings: KatexWarning[];
}

/**
 * 将 LaTeX 公式渲染为 HTML 字符串。
 *
 * - `displayMode: true` → 居中大号（对应 `$$...$$`）
 * - `displayMode: false` → 行内（对应 `$...$`）
 * - 收集 KaTeX 的 strict warnings（不再 console.warn）
 * - `throwOnError: false`：不可渲染时降级为红色错误文本，不抛异常
 */
export function renderMathToHtml(latex: string, displayMode: boolean): RenderMathResult {
  const warnings: KatexWarning[] = [];

  const html = katex.renderToString(latex, {
    throwOnError: false,
    displayMode,
    macros: { ...TEMPLATE_MACROS },
    strict: (errorCode: string, errorMsg: string) => {
      warnings.push({ code: errorCode, message: errorMsg });
      return "ignore" as const;
    },
  });

  return { html, warnings };
}

/**
 * 简化版渲染，直接返回 HTML 字符串（不需要 warnings 的场合使用）。
 */
export function renderMathToHtmlSimple(latex: string, displayMode: boolean): string {
  return renderMathToHtml(latex, displayMode).html;
}

import { tokenizeContent } from "../lib/contentTokenizer";
import { fixUnbalancedInlineMathDelimiters, stripVisualEmbeds } from "../lib/stripVisualEmbeds";
import { renderMathToHtmlSimple } from "../lib/katexRender";
import { cn } from "../lib/utils";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 将含 `$...$` / `$$...$$` / AMS 环境的文本渲染为 HTML 字符串。
 *
 * 使用统一状态机分词器（tokenizeContent），支持：
 *   - 行内公式 `$...$` → displayMode: false
 *   - 显示公式 `$$...$$` / `\[...\]` / AMS 环境 → displayMode: true
 *   - 图片占位 / Mermaid 占位：原样输出占位字符串（给 ContentWithPrimeBrush 处理）
 */
export function buildKatexHtml(text: string): string {
  const tokens = tokenizeContent(text);
  const parts: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        parts.push(escapeHtml(token.content).replace(/\n/g, "<br/>"));
        break;
      case "inlineMath":
        parts.push(renderMathToHtmlSimple(token.latex, false));
        break;
      case "displayMath":
        parts.push(renderMathToHtmlSimple(token.latex, true));
        break;
      case "mermaid":
        // buildKatexHtml 仅处理纯文本+公式；围栏块原样保留（ContentWithPrimeBrush 会处理）
        parts.push(escapeHtml(token.raw));
        break;
      case "image":
        // 同上，占位符原样保留
        parts.push(escapeHtml(token.raw));
        break;
    }
  }

  return parts.join("");
}

/** Renders plain text with `$...$` and `$$...$$` math via KaTeX. */
export function KatexText({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: buildKatexHtml(text) }}
    />
  );
}

/** 文字 + 公式摘要预览；去掉图片 / Mermaid / PrimeBrush 占位后再渲染（用于列表摘要等）。 */
export function KatexPlainPreview({ text, className }: { text: string; className?: string }) {
  const cleaned = fixUnbalancedInlineMathDelimiters(stripVisualEmbeds(text));
  const html = buildKatexHtml(cleaned);
  /* 必须用短语级根节点：常见于 <button> 内摘要，<div> 在 button 内无效会导致公式无法渲染 */
  return (
    <span
      className={cn("min-w-0", className)}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

import katex from "katex";
import "katex/dist/katex.min.css";

import { fixUnbalancedInlineMathDelimiters, stripVisualEmbeds } from "../lib/stripVisualEmbeds";
import { cn } from "../lib/utils";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text + `$...$` inline math → HTML string (for composition with PrimeBrush imgs). */
export function buildKatexHtml(text: string): string {
  const parts = text.split("$");
  const html: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      html.push(escapeHtml(parts[i]).replace(/\n/g, "<br/>"));
    } else {
      try {
        html.push(katex.renderToString(parts[i], { throwOnError: false, displayMode: false }));
      } catch {
        html.push(`<span class="katex-error">${escapeHtml("$" + parts[i] + "$")}</span>`);
      }
    }
  }
  return html.join("");
}

/** Renders plain text with `$...$` inline math via KaTeX. */
export function KatexText({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: buildKatexHtml(text) }}
    />
  );
}

/** 文字 + `$...$` 公式；去掉图片 / Mermaid / PrimeBrush 占位后再 KaTeX（用于列表摘要等）。 */
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

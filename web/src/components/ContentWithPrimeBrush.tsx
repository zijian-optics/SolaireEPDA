import { useEffect, useRef, type ReactNode } from "react";
import mermaid from "mermaid";

import { resourceApiUrl } from "../api/client";
import { tokenizeContent } from "../lib/contentTokenizer";
import { initMermaid } from "../lib/mermaidInit";
import { renderMathToHtmlSimple } from "../lib/katexRender";
import { expandSolaireTable, parseSolaireTable, type SolaireTableCell } from "../lib/solaireTable";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function MermaidFencePreview({ body }: { body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    initMermaid();
    const id = `mmd-prev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let cancelled = false;
    void (async () => {
      try {
        const { svg } = await mermaid.render(id, body.trim());
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch {
        if (ref.current) {
          ref.current.textContent = "Mermaid 无法渲染（请检查语法）";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [body]);
  return (
    <div
      ref={ref}
      className="my-2 max-h-72 w-full max-w-full overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"
    />
  );
}

function renderCellHtml(text: string): string {
  return tokenizeContent(text)
    .map((token) => {
      switch (token.type) {
        case "text":
          return escapeHtml(token.content).replace(/\n/g, "<br/>");
        case "inlineMath":
          return renderMathToHtmlSimple(token.latex, false);
        case "displayMath":
          return renderMathToHtmlSimple(token.latex, true);
        case "mermaid":
        case "image":
        case "table":
          return escapeHtml(token.raw);
      }
    })
    .join("");
}

function cellAlignClass(cell: SolaireTableCell): string {
  if (cell.align === "center") return "text-center";
  if (cell.align === "right") return "text-right";
  return "text-left";
}

function SolaireTablePreview({ source }: { source: string }) {
  let expanded;
  try {
    expanded = expandSolaireTable(parseSolaireTable(source));
  } catch (e) {
    return (
      <pre className="my-2 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
        {e instanceof Error ? e.message : String(e)}
      </pre>
    );
  }
  return (
    <div className="my-2 max-w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-sm text-slate-800">
        <tbody>
          {expanded.slots.map((row, r) => (
            <tr key={r}>
              {row.map((slot, c) => {
                if (slot.covered) return null;
                const CellTag = slot.cell.header ? "th" : "td";
                return (
                  <CellTag
                    key={`${r}-${c}`}
                    rowSpan={slot.cell.rowSpan ?? 1}
                    colSpan={slot.cell.colSpan ?? 1}
                    className={`border border-slate-300 px-2 py-1.5 align-top ${cellAlignClass(slot.cell)} ${
                      slot.cell.header ? "bg-slate-100 font-semibold" : "bg-white"
                    }`}
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: renderCellHtml(slot.cell.text) }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * KaTeX + `:::PRIMEBRUSH_IMG` / `:::MERMAID_IMG` / `:::EMBED_IMG` 占位图 + 源码围栏 `` ```mermaid `` 实时渲染。
 *
 * 使用统一分词器 `tokenizeContent`，支持：
 *   - 行内公式 `$...$` → 行内渲染
 *   - 显示公式 `$$...$$` / AMS 环境 → 居中块级渲染
 *   - Mermaid 围栏 → 实时 SVG 渲染
 *   - 图片占位 → `<img>` 元素
 */
export function ContentWithPrimeBrush({ text, className }: { text: string; className?: string }) {
  const tokens = tokenizeContent(text);
  const nodes: ReactNode[] = [];
  let key = 0;

  // 若完全没有非文本内容，直接用单个 dangerouslySetInnerHTML 节点（避免多余 DOM 包装）
  const hasNonText = tokens.some((t) => t.type !== "text");

  if (!hasNonText) {
    const html = tokens
      .map((t) => (t.type === "text" ? escapeHtml(t.content).replace(/\n/g, "<br/>") : ""))
      .join("");
    return (
      <div
        className={className}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const html = escapeHtml(token.content).replace(/\n/g, "<br/>");
        nodes.push(
          <span
            key={key++}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />,
        );
        break;
      }
      case "inlineMath": {
        const html = renderMathToHtmlSimple(token.latex, false);
        nodes.push(
          <span
            key={key++}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />,
        );
        break;
      }
      case "displayMath": {
        const html = renderMathToHtmlSimple(token.latex, true);
        nodes.push(
          <div
            key={key++}
            className="my-1 overflow-x-auto text-center"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />,
        );
        break;
      }
      case "image": {
        const rel = token.path.trim();
        nodes.push(
          <img
            key={key++}
            className="my-2 max-h-72 max-w-full object-contain"
            src={resourceApiUrl(rel)}
            alt=""
          />,
        );
        break;
      }
      case "mermaid":
        nodes.push(<MermaidFencePreview key={key++} body={token.source} />);
        break;
      case "table":
        nodes.push(<SolaireTablePreview key={key++} source={token.source} />);
        break;
    }
  }

  return <div className={className}>{nodes}</div>;
}

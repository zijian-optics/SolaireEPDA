/**
 * 与 `ContentWithPrimeBrush` 一致：图片占位、Mermaid 围栏。
 * 用于仅需「文字 + $…$ 公式」的摘要预览（不加载图、不跑 Mermaid）。
 */
export const VISUAL_EMBED_RE =
  /:::((?:PRIMEBRUSH|MERMAID|EMBED)_IMG):([^:]+):::|```mermaid\s*\n([\s\S]*?)```/g;

export function stripVisualEmbeds(text: string): string {
  VISUAL_EMBED_RE.lastIndex = 0;
  return text.replace(VISUAL_EMBED_RE, "");
}

/** 服务端摘要等可能在 `$…$` 中间截断，导致 `$` 个数为奇数；去掉末尾未闭合段以免整段被当纯文本。 */
export function fixUnbalancedInlineMathDelimiters(text: string): string {
  const n = (text.match(/\$/g) ?? []).length;
  if (n % 2 === 0) {
    return text;
  }
  const last = text.lastIndexOf("$");
  return last >= 0 ? text.slice(0, last) : text;
}

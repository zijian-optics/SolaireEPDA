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

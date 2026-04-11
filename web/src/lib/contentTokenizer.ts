/**
 * 统一内容分词器。
 *
 * 算法来自 KaTeX `splitAtDelimiters`（已内联以避免私有 API 依赖），
 * 核心是状态机式扫描：正确处理 `\` 转义与 `{}` 嵌套，允许 `$` 跨行（与 TeX 一致）。
 *
 * 在此基础上扩展 Mermaid 围栏块和图片占位符的解析：
 *   1. 先将 Mermaid 围栏 / `:::…_IMG:…:::` 占位符替换为 sentinel，防止被数学解析器误处理。
 *   2. 对剩余文本做状态机分词（$$ 优先于 $，AMS 环境作为 displayMath）。
 *   3. 将 sentinel 还原为对应的 mermaid / image token。
 */

export type ContentToken =
  | { type: "text"; content: string }
  | { type: "inlineMath"; latex: string }
  | { type: "displayMath"; latex: string }
  | { type: "mermaid"; source: string; raw: string }
  | { type: "image"; kind: string; path: string; raw: string };

/* ── delimiter 列表（顺序重要：$$ 必须排在 $ 前面） ── */

interface Delimiter {
  left: string;
  right: string;
  display: boolean;
}

const DELIMITERS: Delimiter[] = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{align*}", right: "\\end{align*}", display: true },
  { left: "\\begin{gather}", right: "\\end{gather}", display: true },
  { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
  { left: "\\begin{cases}", right: "\\end{cases}", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

/* ── 内联 splitAtDelimiters（源自 KaTeX contrib/auto-render/splitAtDelimiters） ── */

interface MathPart {
  type: "text" | "math";
  data: string;
  rawData?: string;
  display?: boolean;
}

/** 从 startIndex 开始扫描，找到匹配 delimiter 的结束位置。-1 表示未找到。 */
function findEndOfMath(delimiter: string, text: string, startIndex: number): number {
  let index = startIndex;
  let braceLevel = 0;
  const delimLen = delimiter.length;
  while (index < text.length) {
    const ch = text[index];
    if (braceLevel <= 0 && text.slice(index, index + delimLen) === delimiter) {
      return index;
    } else if (ch === "\\") {
      index++;
    } else if (ch === "{") {
      braceLevel++;
    } else if (ch === "}") {
      braceLevel--;
    }
    index++;
  }
  return -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

const AMS_RE = /^\\begin\{/;

function splitAtDelimiters(text: string, delimiters: Delimiter[]): MathPart[] {
  const data: MathPart[] = [];
  const regexLeft = new RegExp(
    "(" + delimiters.map((d) => escapeRegex(d.left)).join("|") + ")",
  );
  let remaining = text;

  while (true) {
    const idx = remaining.search(regexLeft);
    if (idx === -1) break;

    if (idx > 0) {
      data.push({ type: "text", data: remaining.slice(0, idx) });
      remaining = remaining.slice(idx);
    }

    const delimIdx = delimiters.findIndex((d) => remaining.startsWith(d.left));
    const endIdx = findEndOfMath(delimiters[delimIdx].right, remaining, delimiters[delimIdx].left.length);
    if (endIdx === -1) break;

    const rawData = remaining.slice(0, endIdx + delimiters[delimIdx].right.length);
    const math = AMS_RE.test(rawData)
      ? rawData
      : remaining.slice(delimiters[delimIdx].left.length, endIdx);
    data.push({ type: "math", data: math, rawData, display: delimiters[delimIdx].display });
    remaining = remaining.slice(endIdx + delimiters[delimIdx].right.length);
  }

  if (remaining !== "") {
    data.push({ type: "text", data: remaining });
  }
  return data;
}

/* ── Mermaid / 图片占位符提取 ── */

const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g;
const IMAGE_PLACEHOLDER_RE = /:::((?:PRIMEBRUSH|MERMAID|EMBED)_IMG):([^:]+):::/g;

type SavedBlock =
  | { kind: "mermaid"; source: string; raw: string }
  | { kind: "image"; imgKind: string; path: string; raw: string };

/** sentinel 前缀不含任何 LaTeX 特殊字符，可安全嵌入正文 */
const SENTINEL_PRE = "\x00BLK";
const SENTINEL_SUF = "\x00";

/* ── 主入口 ── */

export function tokenizeContent(value: string): ContentToken[] {
  const saved: SavedBlock[] = [];

  let processed = value;

  // 先提取 Mermaid 围栏（内部可能含 $ 号）
  MERMAID_FENCE_RE.lastIndex = 0;
  processed = processed.replace(MERMAID_FENCE_RE, (_full: string, source: string) => {
    const idx = saved.length;
    saved.push({ kind: "mermaid", source, raw: _full });
    return `${SENTINEL_PRE}${idx}${SENTINEL_SUF}`;
  });

  // 再提取图片占位符
  IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  processed = processed.replace(
    IMAGE_PLACEHOLDER_RE,
    (_full: string, imgKind: string, path: string) => {
      const idx = saved.length;
      saved.push({ kind: "image", imgKind: `${imgKind}_IMG`, path, raw: _full });
      return `${SENTINEL_PRE}${idx}${SENTINEL_SUF}`;
    },
  );

  const parts = splitAtDelimiters(processed, DELIMITERS);

  const tokens: ContentToken[] = [];
  const sentinelRe = new RegExp(
    `${escapeRegex(SENTINEL_PRE)}(\\d+)${escapeRegex(SENTINEL_SUF)}`,
    "g",
  );

  for (const part of parts) {
    if (part.type === "math") {
      if (part.display) {
        tokens.push({ type: "displayMath", latex: part.data });
      } else {
        tokens.push({ type: "inlineMath", latex: part.data });
      }
    } else {
      // text segment — 可能包含 sentinel
      const seg = part.data;
      let last = 0;
      sentinelRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = sentinelRe.exec(seg)) !== null) {
        if (m.index > last) {
          tokens.push({ type: "text", content: seg.slice(last, m.index) });
        }
        const block = saved[Number(m[1])];
        if (block) {
          if (block.kind === "mermaid") {
            tokens.push({ type: "mermaid", source: block.source, raw: block.raw });
          } else {
            tokens.push({ type: "image", kind: block.imgKind, path: block.path, raw: block.raw });
          }
        }
        last = sentinelRe.lastIndex;
      }
      if (last < seg.length) {
        tokens.push({ type: "text", content: seg.slice(last) });
      }
    }
  }

  return tokens;
}

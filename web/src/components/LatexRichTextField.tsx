import {
  type KeyboardEvent,
  type LegacyRef,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { MathfieldElement } from "mathlive";
import "mathlive";
import "mathlive/fonts.css";
import mermaid from "mermaid";

import { resourceApiUrl } from "../api/client";
import { initMermaid } from "../lib/mermaidInit";

/* ═══════════════════ constants ═══════════════════ */

const MATH_WIDGET_CLASS = "lrt-math-widget";
const MERMAID_WIDGET_CLASS = "lrt-mermaid-widget";
const IMAGE_WIDGET_CLASS = "lrt-image-widget";
const ANY_WIDGET_SELECTOR = `.${MATH_WIDGET_CLASS},.${MERMAID_WIDGET_CLASS},.${IMAGE_WIDGET_CLASS}`;

/* ═══════════════════ utility functions ═══════════════════ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMathHtml(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false });
  } catch {
    return `<span class="katex-error">${escapeHtml("$" + latex + "$")}</span>`;
  }
}

async function renderMermaidToElement(source: string, container: HTMLElement) {
  try {
    initMermaid();
    const id = `lrt-mmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { svg } = await mermaid.render(id, source.trim());
    container.innerHTML = svg;
  } catch {
    container.textContent = "图表语法有误";
    container.classList.add("text-amber-600");
  }
}

/* ═══════════════════ Tokenizer ═══════════════════ */

type Token =
  | { type: "text"; content: string }
  | { type: "math"; latex: string }
  | { type: "mermaid"; source: string; raw: string }
  | { type: "image"; kind: string; path: string; raw: string };

const TOKEN_RE =
  /```mermaid\s*\n([\s\S]*?)```|:::((?:PRIMEBRUSH|MERMAID|EMBED)_IMG):([^:]+):::|\$([^$\n]+?)\$/g;

function tokenize(value: string): Token[] {
  TOKEN_RE.lastIndex = 0;
  const tokens: Token[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(value)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: "text", content: value.slice(lastIdx, match.index) });
    }
    if (match[1] != null) {
      tokens.push({ type: "mermaid", source: match[1], raw: match[0] });
    } else if (match[2] != null) {
      tokens.push({ type: "image", kind: `${match[2]}_IMG`, path: match[3] ?? "", raw: match[0] });
    } else if (match[4] != null) {
      tokens.push({ type: "math", latex: match[4] });
    }
    lastIdx = TOKEN_RE.lastIndex;
  }
  if (lastIdx < value.length) {
    tokens.push({ type: "text", content: value.slice(lastIdx) });
  }
  return tokens;
}

/* ═══════════════════ DOM builders ═══════════════════ */

function createMathWidget(latex: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `${MATH_WIDGET_CLASS} mx-0.5 inline-flex max-w-full cursor-pointer items-baseline align-baseline rounded border border-transparent bg-blue-50/80 px-1 py-px transition-colors hover:border-blue-300 hover:bg-blue-100`;
  span.contentEditable = "false";
  span.tabIndex = -1;
  span.dataset.latex = latex;
  span.setAttribute("role", "button");
  span.title = "点击编辑公式";
  span.innerHTML = renderMathHtml(latex);
  return span;
}

function createMermaidWidget(source: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `${MERMAID_WIDGET_CLASS} my-1.5 block w-full cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 transition-colors hover:border-emerald-300 hover:bg-emerald-50`;
  div.contentEditable = "false";
  div.tabIndex = -1;
  div.dataset.mermaidSource = source;
  div.setAttribute("role", "button");
  div.title = "点击编辑图表";

  const header = document.createElement("div");
  header.className = "flex items-center gap-1.5 text-[11px] text-emerald-700";
  header.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span class="font-medium">Mermaid 图表</span><span class="text-emerald-500 text-[10px]">点击编辑</span>`;
  div.appendChild(header);

  const preview = document.createElement("div");
  preview.className = "mt-1.5 max-h-48 overflow-auto rounded bg-white/80 p-1 text-[10px] text-slate-400";
  preview.textContent = "渲染中…";
  div.appendChild(preview);
  void renderMermaidToElement(source, preview);

  return div;
}

function createImageWidget(kind: string, path: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `${IMAGE_WIDGET_CLASS} my-1 inline-block max-w-full cursor-pointer rounded-lg border border-violet-200 bg-violet-50/50 p-1.5 align-top transition-colors hover:border-violet-300 hover:bg-violet-50`;
  span.contentEditable = "false";
  span.tabIndex = -1;
  span.dataset.imageKind = kind;
  span.dataset.imagePath = path;
  span.setAttribute("role", "button");
  span.title = "点击查看图片";

  const img = document.createElement("img");
  img.src = resourceApiUrl(path.trim());
  img.alt = "";
  img.className = "max-h-40 max-w-full rounded object-contain";
  img.onerror = () => {
    img.style.display = "none";
    const fallback = document.createElement("span");
    fallback.className = "text-xs text-violet-500";
    fallback.textContent = `图片: ${path.trim()}`;
    span.appendChild(fallback);
  };
  span.appendChild(img);

  const label = document.createElement("div");
  label.className = "mt-1 text-[10px] text-violet-500 truncate";
  label.textContent = path.trim().split("/").pop() ?? "图片";
  span.appendChild(label);

  return span;
}

/* ═══════════════════ buildEditorDom ═══════════════════ */

function buildEditorDom(root: HTMLElement, value: string): void {
  root.innerHTML = "";
  const tokens = tokenize(value);
  for (const token of tokens) {
    if (token.type === "text") {
      const lines = token.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) root.appendChild(document.createElement("br"));
        if (lines[i]) root.appendChild(document.createTextNode(lines[i]));
      }
    } else if (token.type === "math") {
      root.appendChild(createMathWidget(token.latex));
    } else if (token.type === "mermaid") {
      root.appendChild(createMermaidWidget(token.source));
    } else if (token.type === "image") {
      root.appendChild(createImageWidget(token.kind, token.path));
    }
  }
  if (root.childNodes.length === 0) {
    root.appendChild(document.createTextNode(""));
  }
}

/* ═══════════════════ Serializer ═══════════════════ */

function serializeEditor(root: HTMLElement): string {
  let out = "";
  function walk(n: Node): void {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? "";
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (el.classList.contains(MATH_WIDGET_CLASS)) {
      out += `$${el.dataset.latex ?? ""}$`;
      return;
    }
    if (el.classList.contains(MERMAID_WIDGET_CLASS)) {
      const src = el.dataset.mermaidSource ?? "";
      out += "```mermaid\n" + src + "\n```";
      return;
    }
    if (el.classList.contains(IMAGE_WIDGET_CLASS)) {
      const kind = el.dataset.imageKind ?? "EMBED_IMG";
      const path = el.dataset.imagePath ?? "";
      out += `:::${kind}:${path}:::`;
      return;
    }
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    for (const c of el.childNodes) walk(c);
  }
  for (const c of root.childNodes) walk(c);
  return out;
}

/* ═══════════════════ Caret utilities ═══════════════════ */

function widgetSerializedLength(el: HTMLElement): number {
  if (el.classList.contains(MATH_WIDGET_CLASS)) {
    return `$${el.dataset.latex ?? ""}$`.length;
  }
  if (el.classList.contains(MERMAID_WIDGET_CLASS)) {
    const src = el.dataset.mermaidSource ?? "";
    return ("```mermaid\n" + src + "\n```").length;
  }
  if (el.classList.contains(IMAGE_WIDGET_CLASS)) {
    const kind = el.dataset.imageKind ?? "EMBED_IMG";
    const path = el.dataset.imagePath ?? "";
    return `:::${kind}:${path}:::`.length;
  }
  return 0;
}

function isWidget(el: HTMLElement): boolean {
  return (
    el.classList.contains(MATH_WIDGET_CLASS) ||
    el.classList.contains(MERMAID_WIDGET_CLASS) ||
    el.classList.contains(IMAGE_WIDGET_CLASS)
  );
}

function serializedLengthOfNode(n: Node | undefined | null): number {
  if (!n) return 0;
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").length;
  if (n.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = n as HTMLElement;
  if (isWidget(el)) return widgetSerializedLength(el);
  if (el.tagName === "BR") return 1;
  let len = 0;
  for (const c of el.childNodes) len += serializedLengthOfNode(c);
  return len;
}

function getSerializedCaretOffset(root: HTMLElement, range: Range): number {
  if (range.startContainer === root) {
    let total = 0;
    for (let i = 0; i < range.startOffset; i++) {
      total += serializedLengthOfNode(root.childNodes[i] ?? undefined);
    }
    return total;
  }
  let total = 0;
  let done = false;
  function walk(n: Node): boolean {
    if (done) return true;
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? "";
      if (range.startContainer === n) {
        total += Math.min(range.startOffset, text.length);
        done = true;
        return true;
      }
      total += text.length;
      return false;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = n as HTMLElement;
    if (isWidget(el)) {
      const wLen = widgetSerializedLength(el);
      if (range.startContainer === el || el.contains(range.startContainer)) {
        if (range.startContainer === el && range.startOffset === 0) {
          /* before widget */
        } else {
          total += wLen;
        }
        done = true;
        return true;
      }
      total += wLen;
      return false;
    }
    if (el.tagName === "BR") {
      if (range.startContainer === el) {
        done = true;
        return true;
      }
      total += 1;
      return false;
    }
    for (const c of el.childNodes) if (walk(c)) return true;
    return false;
  }
  for (const c of root.childNodes) if (walk(c)) break;
  return total;
}

function setCaretFromSerializedOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = Math.max(0, offset);
  let placed = false;
  function walk(n: Node): boolean {
    if (placed) return true;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? "").length;
      if (remaining <= len) {
        const r = document.createRange();
        r.setStart(n, remaining);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        placed = true;
        return true;
      }
      remaining -= len;
      return false;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = n as HTMLElement;
    if (isWidget(el)) {
      const tokenLen = widgetSerializedLength(el);
      if (remaining <= 0) {
        const r = document.createRange();
        r.setStartBefore(el);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        placed = true;
        return true;
      }
      if (remaining < tokenLen) {
        const r = document.createRange();
        r.setStartAfter(el);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        placed = true;
        return true;
      }
      remaining -= tokenLen;
      return false;
    }
    if (el.tagName === "BR") {
      if (remaining <= 0) {
        const r = document.createRange();
        r.setStartBefore(el);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        placed = true;
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const c of el.childNodes) if (walk(c)) return true;
    return false;
  }
  for (const c of root.childNodes) if (walk(c)) return;
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ═══════════════════ Toolbar data ═══════════════════ */

const SYMBOL_GROUPS: { label: string; symbols: { label: string; latex: string }[] }[] = [
  {
    label: "希腊字母",
    symbols: [
      { label: "α", latex: "\\alpha" },
      { label: "β", latex: "\\beta" },
      { label: "γ", latex: "\\gamma" },
      { label: "δ", latex: "\\delta" },
      { label: "θ", latex: "\\theta" },
      { label: "λ", latex: "\\lambda" },
      { label: "μ", latex: "\\mu" },
      { label: "π", latex: "\\pi" },
      { label: "σ", latex: "\\sigma" },
      { label: "ω", latex: "\\omega" },
    ],
  },
  {
    label: "运算符",
    symbols: [
      { label: "±", latex: "\\pm" },
      { label: "×", latex: "\\times" },
      { label: "÷", latex: "\\div" },
      { label: "≤", latex: "\\leq" },
      { label: "≥", latex: "\\geq" },
      { label: "≠", latex: "\\neq" },
      { label: "≈", latex: "\\approx" },
      { label: "∞", latex: "\\infty" },
    ],
  },
  {
    label: "常用",
    symbols: [
      { label: "∑", latex: "\\sum" },
      { label: "∏", latex: "\\prod" },
      { label: "∫", latex: "\\int" },
      { label: "∂", latex: "\\partial" },
      { label: "→", latex: "\\rightarrow" },
      { label: "⇒", latex: "\\Rightarrow" },
      { label: "∈", latex: "\\in" },
      { label: "∀", latex: "\\forall" },
    ],
  },
];

/* ═══════════════════ Component ═══════════════════ */

export type LatexRichTextFieldProps = {
  value: string;
  onChange: (next: string) => void;
  textAreaRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
  minRows?: number;
  placeholder?: string;
  onRequestMermaid?: (sel: { start: number; end: number } | null) => void;
  onRequestImage?: (sel: { start: number; end: number } | null) => void;
  busy?: boolean;
};

type MathPopupState = {
  widget: HTMLElement;
  latex: string;
  isNew: boolean;
} | null;

type MermaidPopupState = {
  widget: HTMLElement;
  source: string;
} | null;

type ImagePopupState = {
  widget: HTMLElement;
  kind: string;
  path: string;
} | null;

export function LatexRichTextField({
  value,
  onChange,
  textAreaRef,
  className = "",
  minRows = 4,
  placeholder,
  onRequestMermaid,
  onRequestImage,
  busy = false,
}: LatexRichTextFieldProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [mode, setMode] = useState<"visual" | "source">("visual");
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const symbolsBtnRef = useRef<HTMLButtonElement>(null);

  /* popup state */
  const [mathPopup, setMathPopup] = useState<MathPopupState>(null);
  const [mathPopupPos, setMathPopupPos] = useState({ top: 0, left: 0 });
  const mathPopupHostRef = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const mathPopupStateRef = useRef<MathPopupState>(null);
  mathPopupStateRef.current = mathPopup;

  const [mermaidPopup, setMermaidPopup] = useState<MermaidPopupState>(null);
  const [mermaidPopupPos, setMermaidPopupPos] = useState({ top: 0, left: 0 });
  const [mermaidDraft, setMermaidDraft] = useState("");
  const mermaidPreviewRef = useRef<HTMLDivElement>(null);
  const mermaidPopupStateRef = useRef<MermaidPopupState>(null);
  mermaidPopupStateRef.current = mermaidPopup;

  const [imagePopup, setImagePopup] = useState<ImagePopupState>(null);
  const [imagePopupPos, setImagePopupPos] = useState({ top: 0, left: 0 });
  const imagePopupStateRef = useRef<ImagePopupState>(null);
  imagePopupStateRef.current = imagePopup;

  const anyPopupOpen = !!(mathPopup || mermaidPopup || imagePopup);

  const minH = `${Math.max(6, minRows * 1.45)}rem`;

  /* ─── Hidden textarea sync ─── */

  const syncHiddenSelection = useCallback(() => {
    const root = editorRef.current;
    const ta = textAreaRef.current;
    if (!root || !ta) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;
    const rs = document.createRange();
    rs.setStart(r.startContainer, r.startOffset);
    rs.collapse(true);
    const start = getSerializedCaretOffset(root, rs);
    const re = document.createRange();
    re.setStart(r.endContainer, r.endOffset);
    re.collapse(true);
    const end = r.collapsed ? start : getSerializedCaretOffset(root, re);
    ta.setSelectionRange(Math.min(start, end), Math.max(start, end));
  }, [textAreaRef]);

  /* ─── Emit changes ─── */

  const emitFromEditor = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const next = serializeEditor(root);
    lastEmittedRef.current = next;
    onChangeRef.current(next);
  }, []);

  /* ─── Rebuild editor from prop ─── */

  useLayoutEffect(() => {
    if (mode !== "visual") return;
    const root = editorRef.current;
    if (!root) return;
    if (composingRef.current) return;
    if (document.activeElement === root && value === lastEmittedRef.current) return;
    buildEditorDom(root, value);
    lastEmittedRef.current = value;
  }, [value, mode]);

  /* ─── Selection tracking ─── */

  useEffect(() => {
    const onSel = () => {
      const root = editorRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      syncHiddenSelection();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [syncHiddenSelection]);

  /* ═══════════════════ MATH POPUP ═══════════════════ */

  const openMathPopup = useCallback((widget: HTMLElement, latex: string, isNew: boolean) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    setMathPopupPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, vw - 340)) });
    setMathPopup({ widget, latex, isNew });
  }, []);

  const closeMathPopup = useCallback((confirm: boolean) => {
    const popup = mathPopupStateRef.current;
    if (!popup) return;
    if (confirm && mfRef.current) {
      const latex = mfRef.current.getValue("latex").trim();
      if (latex) {
        popup.widget.dataset.latex = latex;
        popup.widget.innerHTML = renderMathHtml(latex);
      } else if (popup.isNew) {
        popup.widget.remove();
      }
    } else if (!confirm && popup.isNew) {
      popup.widget.remove();
    }
    setMathPopup(null);
    mfRef.current = null;
    const root = editorRef.current;
    if (root) {
      const next = serializeEditor(root);
      lastEmittedRef.current = next;
      onChangeRef.current(next);
      root.focus();
    }
  }, []);

  useEffect(() => {
    if (!mathPopup || !mathPopupHostRef.current) return;
    const host = mathPopupHostRef.current;
    const mf = new MathfieldElement();
    mf.className =
      "w-full min-h-[40px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-base text-slate-900 outline-none focus:ring-2 focus:ring-blue-400";
    host.innerHTML = "";
    host.appendChild(mf);
    mfRef.current = mf;
    requestAnimationFrame(() => {
      if (mathPopup.latex) mf.setValue(mathPopup.latex);
      mf.focus();
    });
    const handleMfKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); closeMathPopup(true); }
      if (e.key === "Escape") { e.preventDefault(); closeMathPopup(false); }
    };
    mf.addEventListener("keydown", handleMfKey);
    return () => {
      mf.removeEventListener("keydown", handleMfKey);
      mfRef.current = null;
      host.innerHTML = "";
    };
  }, [mathPopup, closeMathPopup]);

  /* ═══════════════════ MERMAID POPUP ═══════════════════ */

  const openMermaidPopup = useCallback((widget: HTMLElement, source: string) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, vw - 500));
    const top = rect.bottom + 6 + 420 > vh ? Math.max(8, rect.top - 426) : rect.bottom + 6;
    setMermaidPopupPos({ top, left });
    setMermaidDraft(source);
    setMermaidPopup({ widget, source });
  }, []);

  const closeMermaidPopup = useCallback((confirm: boolean) => {
    const popup = mermaidPopupStateRef.current;
    if (!popup) return;
    if (confirm) {
      const src = mermaidDraft.trim();
      popup.widget.dataset.mermaidSource = src;
      const preview = popup.widget.querySelector(".mt-1\\.5") as HTMLElement | null;
      if (preview) {
        preview.textContent = "渲染中…";
        preview.classList.remove("text-amber-600");
        void renderMermaidToElement(src, preview);
      }
    }
    setMermaidPopup(null);
    const root = editorRef.current;
    if (root) {
      const next = serializeEditor(root);
      lastEmittedRef.current = next;
      onChangeRef.current(next);
      root.focus();
    }
  }, [mermaidDraft]);

  useEffect(() => {
    if (!mermaidPopup || !mermaidPreviewRef.current) return;
    const el = mermaidPreviewRef.current;
    el.textContent = "渲染中…";
    el.classList.remove("text-amber-600");
    const timer = setTimeout(() => void renderMermaidToElement(mermaidDraft, el), 400);
    return () => clearTimeout(timer);
  }, [mermaidDraft, mermaidPopup]);

  /* ═══════════════════ IMAGE POPUP ═══════════════════ */

  const openImagePopup = useCallback((widget: HTMLElement, kind: string, path: string) => {
    const rect = widget.getBoundingClientRect();
    const vw = window.innerWidth;
    setImagePopupPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, vw - 340)) });
    setImagePopup({ widget, kind, path });
  }, []);

  const closeImagePopup = useCallback(() => {
    setImagePopup(null);
    editorRef.current?.focus();
  }, []);

  const removeImageWidget = useCallback(() => {
    const popup = imagePopupStateRef.current;
    if (!popup) return;
    popup.widget.remove();
    setImagePopup(null);
    const root = editorRef.current;
    if (root) {
      const next = serializeEditor(root);
      lastEmittedRef.current = next;
      onChangeRef.current(next);
      root.focus();
    }
  }, []);

  /* ═══════════════════ Outside-click dismiss ═══════════════════ */

  useEffect(() => {
    if (!anyPopupOpen) return;
    const handler = (e: MouseEvent) => {
      const mathEl = document.getElementById("lrt-math-popup");
      const mermaidEl = document.getElementById("lrt-mermaid-popup");
      const imageEl = document.getElementById("lrt-image-popup");
      if (mathEl && !mathEl.contains(e.target as Node)) closeMathPopup(true);
      if (mermaidEl && !mermaidEl.contains(e.target as Node)) closeMermaidPopup(true);
      if (imageEl && !imageEl.contains(e.target as Node)) closeImagePopup();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [anyPopupOpen, closeMathPopup, closeMermaidPopup, closeImagePopup]);

  /* ═══════════════════ Insert helpers ═══════════════════ */

  const insertMathAtCursor = useCallback(() => {
    if (mode !== "visual") return;
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const widget = createMathWidget("");
    range.deleteContents();
    range.insertNode(widget);
    const after = document.createTextNode("\u200B");
    widget.after(after);
    const nr = document.createRange();
    nr.setStartAfter(after);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    openMathPopup(widget, "", true);
  }, [mode, openMathPopup]);

  const insertMathTemplate = useCallback(
    (template: string) => {
      if (mode !== "visual") return;
      const root = editorRef.current;
      if (!root) return;
      root.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const widget = createMathWidget(template);
      range.deleteContents();
      range.insertNode(widget);
      const after = document.createTextNode("\u200B");
      widget.after(after);
      const nr = document.createRange();
      nr.setStartAfter(after);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      openMathPopup(widget, template, true);
    },
    [mode, openMathPopup],
  );

  const handleRequestMermaid = useCallback(() => {
    const ta = textAreaRef.current;
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    onRequestMermaid?.(sel);
  }, [textAreaRef, onRequestMermaid]);

  const handleRequestImage = useCallback(() => {
    const ta = textAreaRef.current;
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    onRequestImage?.(sel);
  }, [textAreaRef, onRequestImage]);

  /* ═══════════════════ Event handlers ═══════════════════ */

  const handleInput = () => {
    if (composingRef.current) return;
    emitFromEditor();
    syncHiddenSelection();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (anyPopupOpen) return;
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    if (e.key === "$") {
      e.preventDefault();
      const widget = createMathWidget("");
      range.deleteContents();
      range.insertNode(widget);
      const after = document.createTextNode("\u200B");
      widget.after(after);
      const nr = document.createRange();
      nr.setStartAfter(after);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      openMathPopup(widget, "", true);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "m") {
      e.preventDefault();
      insertMathAtCursor();
      return;
    }

    if (!range.collapsed) return;

    if (e.key === "Backspace") {
      const { startContainer, startOffset } = range;
      if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
        const prev = startContainer.previousSibling;
        if (prev instanceof HTMLElement && isWidget(prev)) {
          e.preventDefault();
          prev.remove();
          emitFromEditor();
          syncHiddenSelection();
          return;
        }
      }
      if (startContainer === root && startOffset > 0) {
        const prev = root.childNodes[startOffset - 1];
        if (prev instanceof HTMLElement && isWidget(prev)) {
          e.preventDefault();
          prev.remove();
          emitFromEditor();
          syncHiddenSelection();
        }
      }
      return;
    }

    if (e.key === "Delete") {
      const { startContainer, startOffset } = range;
      if (startContainer === root) {
        const next = root.childNodes[startOffset];
        if (next instanceof HTMLElement && isWidget(next)) {
          e.preventDefault();
          next.remove();
          emitFromEditor();
          syncHiddenSelection();
        }
        return;
      }
      if (startContainer.nodeType === Node.TEXT_NODE) {
        const text = startContainer.textContent ?? "";
        if (startOffset === text.length) {
          const next = startContainer.nextSibling;
          if (next instanceof HTMLElement && isWidget(next)) {
            e.preventDefault();
            next.remove();
            emitFromEditor();
            syncHiddenSelection();
          }
        }
      }
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const mathW = t.closest?.(`.${MATH_WIDGET_CLASS}`) as HTMLElement | null;
    if (mathW && editorRef.current?.contains(mathW)) {
      e.preventDefault();
      openMathPopup(mathW, mathW.dataset.latex ?? "", false);
      return;
    }
    const mmdW = t.closest?.(`.${MERMAID_WIDGET_CLASS}`) as HTMLElement | null;
    if (mmdW && editorRef.current?.contains(mmdW)) {
      e.preventDefault();
      openMermaidPopup(mmdW, mmdW.dataset.mermaidSource ?? "");
      return;
    }
    const imgW = t.closest?.(`.${IMAGE_WIDGET_CLASS}`) as HTMLElement | null;
    if (imgW && editorRef.current?.contains(imgW)) {
      e.preventDefault();
      openImagePopup(imgW, imgW.dataset.imageKind ?? "EMBED_IMG", imgW.dataset.imagePath ?? "");
      return;
    }
    if (editorRef.current?.contains(t)) syncHiddenSelection();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  /* ─── Mode switching ─── */

  const switchToVisual = useCallback(() => {
    lastEmittedRef.current = null;
    setMode("visual");
  }, []);
  const switchToSource = useCallback(() => setMode("source"), []);

  /* ─── Close symbols dropdown on outside click ─── */

  useEffect(() => {
    if (!symbolsOpen) return;
    const handler = (e: MouseEvent) => {
      if (symbolsBtnRef.current && !symbolsBtnRef.current.contains(e.target as Node)) {
        const dropdown = document.getElementById("lrt-symbols-dropdown");
        if (dropdown && !dropdown.contains(e.target as Node)) setSymbolsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [symbolsOpen]);

  /* ═══════════════════ Render ═══════════════════ */

  return (
    <div className={`relative ${className}`}>
      {/* hidden textarea for external selection sync */}
      <textarea
        ref={textAreaRef as LegacyRef<HTMLTextAreaElement>}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        value={value}
        readOnly
        onChange={() => {}}
      />

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100/80 px-1.5 py-1">
        {/* mode toggle */}
        <span className="mr-0.5 inline-flex overflow-hidden rounded border border-slate-200 bg-white text-[11px]">
          <button
            type="button"
            className={`px-2 py-0.5 font-medium transition-colors ${mode === "visual" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            onClick={switchToVisual}
          >
            可视化
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 font-medium transition-colors ${mode === "source" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            onClick={switchToSource}
          >
            源码
          </button>
        </span>

        <div className="mx-1 h-4 w-px bg-slate-300" />

        {/* insert math */}
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-blue-700 hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={insertMathAtCursor}
          title="插入行内公式（快捷键：$ 或 Ctrl+M）"
        >
          <span className="font-serif italic">Σ</span>
          <span className="ml-0.5 text-[10px]">公式</span>
        </button>

        {/* quick math templates */}
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("\\frac{}{}")}
          title="分数"
        >
          <sup>a</sup>/<sub>b</sub>
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("\\sqrt{}")}
          title="平方根"
        >
          √
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("x^{}")}
          title="上标"
        >
          x<sup>n</sup>
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
          disabled={mode !== "visual"}
          onClick={() => insertMathTemplate("x_{}")}
          title="下标"
        >
          x<sub>n</sub>
        </button>

        {/* symbols dropdown */}
        <div className="relative">
          <button
            ref={symbolsBtnRef}
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white hover:shadow-sm disabled:opacity-40"
            disabled={mode !== "visual"}
            onClick={() => setSymbolsOpen((o) => !o)}
            title="常用符号"
          >
            α β π ▾
          </button>
          {symbolsOpen && (
            <div
              id="lrt-symbols-dropdown"
              className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
            >
              {SYMBOL_GROUPS.map((group) => (
                <div key={group.label} className="mb-1.5 last:mb-0">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-0.5">
                    {group.symbols.map((sym) => (
                      <button
                        key={sym.latex}
                        type="button"
                        className="rounded px-1.5 py-0.5 text-sm hover:bg-blue-50 hover:text-blue-700"
                        title={sym.latex}
                        onClick={() => {
                          insertMathTemplate(sym.latex);
                          setSymbolsOpen(false);
                        }}
                      >
                        {sym.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-slate-300" />

        {/* insert mermaid */}
        {onRequestMermaid && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-emerald-700 hover:shadow-sm disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestMermaid}
            title="插入流程图 / Mermaid 图表"
          >
            <span className="mr-0.5">📊</span>图表
          </button>
        )}

        {/* insert image */}
        {onRequestImage && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white hover:text-violet-700 hover:shadow-sm disabled:opacity-40"
            disabled={mode !== "visual" || busy}
            onClick={handleRequestImage}
            title="插入图片"
          >
            <span className="mr-0.5">🖼️</span>图片
          </button>
        )}

        <div className="ml-auto text-[10px] text-slate-400">
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1">$</kbd> 公式
        </div>
      </div>

      {/* ── Editor area ── */}
      {mode === "visual" ? (
        <div
          ref={editorRef}
          className="w-full rounded-b-md border border-t-0 border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-0"
          style={{ minHeight: minH }}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          spellCheck={false}
          data-placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          onPaste={handlePaste}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            emitFromEditor();
            syncHiddenSelection();
          }}
          onKeyUp={syncHiddenSelection}
          onMouseUp={syncHiddenSelection}
        />
      ) : (
        <textarea
          className="w-full rounded-b-md border border-t-0 border-slate-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
          style={{ minHeight: minH }}
          value={value}
          onChange={(e) => {
            lastEmittedRef.current = e.target.value;
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          spellCheck={false}
        />
      )}

      {/* ═══ Math editing popup ═══ */}
      {mathPopup && (
        <div id="lrt-math-popup" className="fixed z-50" style={{ top: mathPopupPos.top, left: mathPopupPos.left }}>
          <div className="w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                {mathPopup.isNew ? "插入公式" : "编辑公式"}
              </span>
              <span className="text-[10px] text-slate-400">Enter 确认 · Esc 取消</span>
            </div>
            <div ref={mathPopupHostRef} className="min-h-[40px]" />
            <div className="mt-2.5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                onClick={() => closeMathPopup(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                onClick={() => closeMathPopup(true)}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Mermaid editing popup ═══ */}
      {mermaidPopup && (
        <div
          id="lrt-mermaid-popup"
          className="fixed z-50"
          style={{ top: mermaidPopupPos.top, left: mermaidPopupPos.left }}
        >
          <div className="w-[480px] max-w-[95vw] rounded-lg border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700">编辑 Mermaid 图表</span>
              <span className="text-[10px] text-slate-400">编辑源码，实时预览</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[10px] font-medium text-slate-500">源码</p>
                <textarea
                  className="h-48 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"
                  value={mermaidDraft}
                  onChange={(e) => setMermaidDraft(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium text-slate-500">预览</p>
                <div
                  ref={mermaidPreviewRef}
                  className="flex h-48 items-center justify-center overflow-auto rounded-md border border-slate-200 bg-white p-1 text-xs text-slate-400"
                />
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={() => {
                  mermaidPopupStateRef.current?.widget.remove();
                  setMermaidPopup(null);
                  const root = editorRef.current;
                  if (root) {
                    const next = serializeEditor(root);
                    lastEmittedRef.current = next;
                    onChangeRef.current(next);
                    root.focus();
                  }
                }}
              >
                删除图表
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  onClick={() => closeMermaidPopup(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  onClick={() => closeMermaidPopup(true)}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Image popup ═══ */}
      {imagePopup && (
        <div
          id="lrt-image-popup"
          className="fixed z-50"
          style={{ top: imagePopupPos.top, left: imagePopupPos.left }}
        >
          <div className="w-80 max-w-[95vw] rounded-lg border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-violet-700">图片</span>
              <span className="truncate text-[10px] text-slate-400">
                {imagePopup.path.trim().split("/").pop()}
              </span>
            </div>
            <img
              src={resourceApiUrl(imagePopup.path.trim())}
              alt=""
              className="max-h-64 w-full rounded-md border border-slate-200 object-contain"
            />
            <div className="mt-2.5 flex items-center justify-between">
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={removeImageWidget}
              >
                删除图片
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                onClick={closeImagePopup}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

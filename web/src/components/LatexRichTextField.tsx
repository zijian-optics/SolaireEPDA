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

/* ═══════════════════ constants ═══════════════════ */

const MATH_WIDGET_CLASS = "lrt-math-widget";

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

/* ── Regex-based tokenizer (robust against unmatched $) ── */

type Token = { type: "text"; content: string } | { type: "math"; latex: string };

function tokenize(value: string): Token[] {
  const regex = /\$([^$\n]+?)\$/g;
  const tokens: Token[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: "text", content: value.slice(lastIdx, match.index) });
    }
    tokens.push({ type: "math", latex: match[1] });
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < value.length) {
    tokens.push({ type: "text", content: value.slice(lastIdx) });
  }
  return tokens;
}

/* ── DOM builder ── */

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
    } else {
      root.appendChild(createMathWidget(token.latex));
    }
  }
  if (root.childNodes.length === 0) {
    root.appendChild(document.createTextNode(""));
  }
}

/* ── Serializer ── */

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
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    for (const c of el.childNodes) walk(c);
  }
  for (const c of root.childNodes) walk(c);
  return out;
}

/* ── Caret utilities ── */

function serializedLengthOfNode(n: Node | undefined | null): number {
  if (!n) return 0;
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").length;
  if (n.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = n as HTMLElement;
  if (el.classList.contains(MATH_WIDGET_CLASS)) {
    return `$${el.dataset.latex ?? ""}$`.length;
  }
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
    if (el.classList.contains(MATH_WIDGET_CLASS)) {
      const token = `$${el.dataset.latex ?? ""}$`;
      if (range.startContainer === el || el.contains(range.startContainer)) {
        if (range.startContainer === el && range.startOffset === 0) {
          /* before widget */
        } else {
          total += token.length;
        }
        done = true;
        return true;
      }
      total += token.length;
      return false;
    }
    if (el.tagName === "BR") {
      if (range.startContainer === el) { done = true; return true; }
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
    if (el.classList.contains(MATH_WIDGET_CLASS)) {
      const tokenLen = `$${el.dataset.latex ?? ""}$`.length;
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

/* ═══════════════════ Toolbar helpers ═══════════════════ */

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
};

type MathPopupState = {
  widget: HTMLElement;
  latex: string;
  isNew: boolean;
} | null;

export function LatexRichTextField({
  value,
  onChange,
  textAreaRef,
  className = "",
  minRows = 4,
  placeholder,
}: LatexRichTextFieldProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [mode, setMode] = useState<"visual" | "source">("visual");
  const [mathPopup, setMathPopup] = useState<MathPopupState>(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const symbolsBtnRef = useRef<HTMLButtonElement>(null);
  const mathPopupHostRef = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const mathPopupStateRef = useRef<MathPopupState>(null);
  mathPopupStateRef.current = mathPopup;

  const minH = `${Math.max(6, minRows * 1.45)}rem`;

  /* ── Hidden textarea sync ── */

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

  /* ── Emit changes ── */

  const emitFromEditor = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const next = serializeEditor(root);
    lastEmittedRef.current = next;
    onChangeRef.current(next);
  }, []);

  /* ── Rebuild editor from prop ── */

  useLayoutEffect(() => {
    if (mode !== "visual") return;
    const root = editorRef.current;
    if (!root) return;
    if (composingRef.current) return;
    if (document.activeElement === root && value === lastEmittedRef.current) return;
    buildEditorDom(root, value);
    lastEmittedRef.current = value;
  }, [value, mode]);

  /* ── Selection tracking ── */

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

  /* ── Math popup ── */

  const openMathPopup = useCallback(
    (widget: HTMLElement, latex: string, isNew: boolean) => {
      const rect = widget.getBoundingClientRect();
      const vw = window.innerWidth;
      const left = Math.min(rect.left, vw - 340);
      setPopupPos({ top: rect.bottom + 6, left: Math.max(8, left) });
      setMathPopup({ widget, latex, isNew });
    },
    [],
  );

  const closeMathPopup = useCallback(
    (confirm: boolean) => {
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
    },
    [],
  );

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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        closeMathPopup(true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMathPopup(false);
      }
    };
    mf.addEventListener("keydown", handleMfKey);

    return () => {
      mf.removeEventListener("keydown", handleMfKey);
      mfRef.current = null;
      host.innerHTML = "";
    };
  }, [mathPopup, closeMathPopup]);

  useEffect(() => {
    if (!mathPopup) return;
    const handler = (e: MouseEvent) => {
      const popup = document.getElementById("lrt-math-popup");
      if (popup && !popup.contains(e.target as Node)) {
        closeMathPopup(true);
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [mathPopup, closeMathPopup]);

  /* ── Insert math at cursor ── */

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

  /* ── Event handlers ── */

  const handleInput = () => {
    if (composingRef.current) return;
    emitFromEditor();
    syncHiddenSelection();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mathPopup) return;
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
        if (prev instanceof HTMLElement && prev.classList.contains(MATH_WIDGET_CLASS)) {
          e.preventDefault();
          prev.remove();
          emitFromEditor();
          syncHiddenSelection();
          return;
        }
      }
      if (startContainer === root && startOffset > 0) {
        const prev = root.childNodes[startOffset - 1];
        if (prev instanceof HTMLElement && prev.classList.contains(MATH_WIDGET_CLASS)) {
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
        if (next instanceof HTMLElement && next.classList.contains(MATH_WIDGET_CLASS)) {
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
          if (next instanceof HTMLElement && next.classList.contains(MATH_WIDGET_CLASS)) {
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
    const widget = t?.closest?.(`.${MATH_WIDGET_CLASS}`) as HTMLElement | null;
    if (widget && editorRef.current?.contains(widget)) {
      e.preventDefault();
      openMathPopup(widget, widget.dataset.latex ?? "", false);
      return;
    }
    if (editorRef.current?.contains(e.target as Node)) syncHiddenSelection();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  /* ── Mode switching ── */

  const switchToVisual = useCallback(() => {
    lastEmittedRef.current = null;
    setMode("visual");
  }, []);

  const switchToSource = useCallback(() => {
    setMode("source");
  }, []);

  /* ── Close symbols dropdown on outside click ── */

  useEffect(() => {
    if (!symbolsOpen) return;
    const handler = (e: MouseEvent) => {
      if (symbolsBtnRef.current && !symbolsBtnRef.current.contains(e.target as Node)) {
        const dropdown = document.getElementById("lrt-symbols-dropdown");
        if (dropdown && !dropdown.contains(e.target as Node)) {
          setSymbolsOpen(false);
        }
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

        <div className="mx-1 h-4 w-px bg-slate-300" />

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

        <div className="mx-1 h-4 w-px bg-slate-300" />

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

        <div className="ml-auto text-[10px] text-slate-400">
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1">$</kbd> 插入公式
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

      {/* ── Math editing popup ── */}
      {mathPopup && (
        <div
          id="lrt-math-popup"
          className="fixed z-50"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
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
                className="rounded-md px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                onClick={() => closeMathPopup(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                onClick={() => closeMathPopup(true)}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

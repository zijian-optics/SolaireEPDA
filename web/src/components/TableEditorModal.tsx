import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Columns3,
  Merge,
  Plus,
  Rows3,
  Split,
  Trash2,
} from "lucide-react";

import {
  anchorsToSolaireTable,
  defaultSolaireTable,
  expandSolaireTable,
  parseSolaireTable,
  serializeSolaireTableBody,
  type SolaireTableCell,
  type SolaireTableDoc,
} from "../lib/solaireTable";

type Selection = { r1: number; c1: number; r2: number; c2: number };
type EditingCell = { row: number; col: number; value: string } | null;

type TableEditorModalProps = {
  open: boolean;
  initialSource?: string;
  onClose: () => void;
  onConfirm: (source: string) => void;
};

function rect(sel: Selection) {
  return {
    top: Math.min(sel.r1, sel.r2),
    bottom: Math.max(sel.r1, sel.r2),
    left: Math.min(sel.c1, sel.c2),
    right: Math.max(sel.c1, sel.c2),
  };
}

function spans(cell: SolaireTableCell) {
  return { rowSpan: cell.rowSpan ?? 1, colSpan: cell.colSpan ?? 1 };
}

function intersects(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number },
) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function cellRect(anchor: { row: number; col: number; cell: SolaireTableCell }) {
  const s = spans(anchor.cell);
  return {
    top: anchor.row,
    bottom: anchor.row + s.rowSpan - 1,
    left: anchor.col,
    right: anchor.col + s.colSpan - 1,
  };
}

function containsRect(
  outer: { top: number; bottom: number; left: number; right: number },
  inner: { top: number; bottom: number; left: number; right: number },
) {
  return (
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom &&
    outer.left <= inner.left &&
    outer.right >= inner.right
  );
}

function patchCell(
  doc: SolaireTableDoc,
  row: number,
  col: number,
  updater: (cell: SolaireTableCell) => SolaireTableCell,
): SolaireTableDoc {
  const expanded = expandSolaireTable(doc);
  const anchors = expanded.anchors.map((a) => {
    if (a.row === row && a.col === col) {
      return { row: a.row, col: a.col, cell: updater({ ...a.cell }) };
    }
    return { row: a.row, col: a.col, cell: { ...a.cell } };
  });
  return anchorsToSolaireTable(anchors, expanded.height);
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function TableEditorModal({ open, initialSource, onClose, onConfirm }: TableEditorModalProps) {
  const [doc, setDoc] = useState<SolaireTableDoc>(() => defaultSolaireTable());
  const [selection, setSelection] = useState<Selection>({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    try {
      setDoc(initialSource?.trim() ? parseSolaireTable(initialSource) : defaultSolaireTable());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDoc(defaultSolaireTable());
    }
    setSelection({ r1: 0, c1: 0, r2: 0, c2: 0 });
    setEditingCell(null);
  }, [open, initialSource]);

  const expanded = useMemo(() => expandSolaireTable(doc), [doc]);
  const activeSlot = expanded.slots[selection.r1]?.[selection.c1];
  const activeAnchor = activeSlot
    ? expanded.anchors.find((a) => a.row === activeSlot.anchorRow && a.col === activeSlot.anchorCol)
    : null;
  const activeCell = activeAnchor?.cell ?? null;
  const selectedRect = rect(selection);

  if (!open) return null;

  function applyAnchors(
    updater: (
      anchors: Array<{ row: number; col: number; cell: SolaireTableCell }>,
      expandedHeight: number,
      expandedWidth: number,
    ) => {
      anchors: Array<{ row: number; col: number; cell: SolaireTableCell }>;
      height?: number;
      selection?: Selection;
    },
  ) {
    try {
      const current = expandSolaireTable(doc);
      const result = updater(
        current.anchors.map((a) => ({ row: a.row, col: a.col, cell: { ...a.cell } })),
        current.height,
        current.width,
      );
      setDoc(anchorsToSolaireTable(result.anchors, result.height ?? current.height));
      if (result.selection) setSelection(result.selection);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function mergeSelection() {
    const target = selectedRect;
    const selectedAnchors = expanded.anchors.filter((a) => intersects(cellRect(a), target));
    if (selectedAnchors.length < 2) return;
    if (!selectedAnchors.every((a) => containsRect(target, cellRect(a)))) {
      setError("选区不能切开已有合并单元格。");
      return;
    }
    const mergedText = selectedAnchors
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((a) => a.cell.text.trim())
      .filter(Boolean)
      .join("\n");
    applyAnchors((anchors, height) => ({
      height,
      anchors: [
        ...anchors.filter((a) => !intersects(cellRect(a), target)),
        {
          row: target.top,
          col: target.left,
          cell: {
            text: mergedText,
            header: selectedAnchors.every((a) => a.cell.header === true) || undefined,
            align: selectedAnchors[0]?.cell.align,
            rowSpan: target.bottom - target.top + 1,
            colSpan: target.right - target.left + 1,
          },
        },
      ],
      selection: { r1: target.top, c1: target.left, r2: target.top, c2: target.left },
    }));
  }

  function splitActiveCell() {
    if (!activeAnchor) return;
    const s = spans(activeAnchor.cell);
    if (s.rowSpan === 1 && s.colSpan === 1) return;
    applyAnchors((anchors, height) => {
      const next = anchors.filter((a) => !(a.row === activeAnchor.row && a.col === activeAnchor.col));
      for (let r = activeAnchor.row; r < activeAnchor.row + s.rowSpan; r += 1) {
        for (let c = activeAnchor.col; c < activeAnchor.col + s.colSpan; c += 1) {
          next.push({
            row: r,
            col: c,
            cell: {
              text: r === activeAnchor.row && c === activeAnchor.col ? activeAnchor.cell.text : "",
              header: activeAnchor.cell.header,
              align: activeAnchor.cell.align,
            },
          });
        }
      }
      return { anchors: next, height };
    });
  }

  function updateActiveCell(updater: (cell: SolaireTableCell) => SolaireTableCell) {
    if (!activeAnchor) return;
    try {
      setDoc(patchCell(doc, activeAnchor.row, activeAnchor.col, updater));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function docWithCommittedEditing(): SolaireTableDoc {
    if (!editingCell) return doc;
    return patchCell(doc, editingCell.row, editingCell.col, (cell) => ({
      ...cell,
      text: editingCell.value,
    }));
  }

  function commitEditing() {
    if (!editingCell) return;
    try {
      setDoc(docWithCommittedEditing());
      setEditingCell(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function cancelEditing() {
    setEditingCell(null);
  }

  function beginEditing(row: number, col: number, value: string) {
    setDragging(false);
    setSelection({ r1: row, c1: col, r2: row, c2: col });
    setEditingCell({ row, col, value });
  }

  function addRow() {
    applyAnchors((anchors, height, width) => ({
      anchors: [
        ...anchors,
        ...Array.from({ length: width }, (_x, c) => ({ row: height, col: c, cell: { text: "" } })),
      ],
      height: height + 1,
      selection: { r1: height, c1: 0, r2: height, c2: 0 },
    }));
  }

  function addColumn() {
    applyAnchors((anchors, height, width) => ({
      anchors: [
        ...anchors,
        ...Array.from({ length: height }, (_x, r) => ({ row: r, col: width, cell: { text: "" } })),
      ],
      height,
      selection: { r1: 0, c1: width, r2: 0, c2: width },
    }));
  }

  function deleteLastRow() {
    if (expanded.height <= 1) return;
    const last = expanded.height - 1;
    applyAnchors((anchors, height) => ({
      height: height - 1,
      anchors: anchors
        .filter((a) => a.row !== last)
        .map((a) => {
          const s = spans(a.cell);
          if (a.row < last && a.row + s.rowSpan - 1 >= last) {
            return { ...a, cell: { ...a.cell, rowSpan: s.rowSpan - 1 || undefined } };
          }
          return a;
        }),
      selection: { r1: Math.min(selection.r1, last - 1), c1: 0, r2: Math.min(selection.r1, last - 1), c2: 0 },
    }));
  }

  function deleteLastColumn() {
    if (expanded.width <= 1) return;
    const last = expanded.width - 1;
    applyAnchors((anchors, height) => ({
      height,
      anchors: anchors
        .filter((a) => a.col !== last)
        .map((a) => {
          const s = spans(a.cell);
          if (a.col < last && a.col + s.colSpan - 1 >= last) {
            return { ...a, cell: { ...a.cell, colSpan: s.colSpan - 1 || undefined } };
          }
          return a;
        }),
      selection: { r1: 0, c1: Math.min(selection.c1, last - 1), r2: 0, c2: Math.min(selection.c1, last - 1) },
    }));
  }

  function selectCell(r: number, c: number, extend = false) {
    if (extend) {
      setSelection((s) => ({ ...s, r2: r, c2: c }));
    } else {
      setSelection({ r1: r, c1: c, r2: r, c2: c });
    }
  }

  const activeAlign = activeCell?.align ?? "left";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4">
      <div className="flex max-h-[92vh] w-[920px] max-w-[96vw] flex-col rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">编辑表格</h3>
            <p className="mt-0.5 text-xs text-slate-500">拖选单元格后可合并；双击单元格编辑，Enter 确认。</p>
          </div>
          <button type="button" className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <IconButton title="增加行" onClick={addRow}>
            <Rows3 className="h-4 w-4" />
            <Plus className="-ml-1 h-3 w-3" />
          </IconButton>
          <IconButton title="增加列" onClick={addColumn}>
            <Columns3 className="h-4 w-4" />
            <Plus className="-ml-1 h-3 w-3" />
          </IconButton>
          <IconButton title="删除最后一行" onClick={deleteLastRow} disabled={expanded.height <= 1}>
            <Rows3 className="h-4 w-4" />
            <Trash2 className="-ml-1 h-3 w-3" />
          </IconButton>
          <IconButton title="删除最后一列" onClick={deleteLastColumn} disabled={expanded.width <= 1}>
            <Columns3 className="h-4 w-4" />
            <Trash2 className="-ml-1 h-3 w-3" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <IconButton title="合并选区" onClick={mergeSelection}>
            <Merge className="h-4 w-4" />
          </IconButton>
          <IconButton title="拆分单元格" onClick={splitActiveCell} disabled={!activeCell || ((activeCell.rowSpan ?? 1) === 1 && (activeCell.colSpan ?? 1) === 1)}>
            <Split className="h-4 w-4" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <IconButton title="左对齐" onClick={() => updateActiveCell((cell) => ({ ...cell, align: "left" }))}>
            <AlignLeft className={activeAlign === "left" ? "h-4 w-4 text-blue-600" : "h-4 w-4"} />
          </IconButton>
          <IconButton title="居中" onClick={() => updateActiveCell((cell) => ({ ...cell, align: "center" }))}>
            <AlignCenter className={activeAlign === "center" ? "h-4 w-4 text-blue-600" : "h-4 w-4"} />
          </IconButton>
          <IconButton title="右对齐" onClick={() => updateActiveCell((cell) => ({ ...cell, align: "right" }))}>
            <AlignRight className={activeAlign === "right" ? "h-4 w-4 text-blue-600" : "h-4 w-4"} />
          </IconButton>
          <button
            type="button"
            className={`h-8 rounded border px-3 text-xs font-medium ${
              activeCell?.header ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"
            }`}
            onClick={() => updateActiveCell((cell) => ({ ...cell, header: !cell.header || undefined }))}
          >
            表头
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <div className="h-full min-h-0 overflow-auto rounded border border-slate-200 bg-slate-50 p-2">
            <table className="min-w-full border-collapse bg-white text-sm" onMouseUp={() => setDragging(false)}>
              <tbody>
                {expanded.slots.map((row, r) => (
                  <tr key={r}>
                    {row.map((slot, c) => {
                      if (slot.covered) return null;
                      const CellTag = slot.cell.header ? "th" : "td";
                      const s = spans(slot.cell);
                      const cr = cellRect({ row: r, col: c, cell: slot.cell });
                      const selected = intersects(cr, selectedRect);
                      const editing = editingCell?.row === r && editingCell?.col === c;
                      return (
                        <CellTag
                          key={`${r}-${c}`}
                          rowSpan={s.rowSpan}
                          colSpan={s.colSpan}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setDragging(true);
                            selectCell(r, c, e.shiftKey);
                          }}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            beginEditing(r, c, slot.cell.text);
                          }}
                          onMouseEnter={() => {
                            if (dragging) selectCell(r, c, true);
                          }}
                          className={`min-w-24 cursor-cell border px-2 py-2 align-top ${
                            selected ? "border-blue-500 bg-blue-50 ring-1 ring-inset ring-blue-400" : "border-slate-300"
                          } ${slot.cell.header ? "font-semibold text-slate-900" : "text-slate-700"}`}
                          style={{ textAlign: slot.cell.align ?? "left" }}
                        >
                          {editing ? (
                            <textarea
                              autoFocus
                              className="block min-h-16 w-full resize-none rounded border border-blue-300 bg-white px-2 py-1 text-sm font-normal leading-relaxed text-slate-900 outline-none ring-2 ring-blue-200"
                              value={editingCell.value}
                              onMouseDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setEditingCell((cur) =>
                                  cur && cur.row === r && cur.col === c ? { ...cur, value: e.target.value } : cur,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  commitEditing();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEditing();
                                }
                              }}
                              onBlur={commitEditing}
                              spellCheck={false}
                            />
                          ) : (
                            <span className="whitespace-pre-wrap break-words">{slot.cell.text || "\u00a0"}</span>
                          )}
                        </CellTag>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{expanded.height} 行 x {expanded.width} 列 · 双击单元格编辑，Enter 确认，Shift+Enter 换行</span>
            {error && <span className="rounded bg-red-50 px-2 py-1 text-red-700">{error}</span>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => {
              const next = docWithCommittedEditing();
              setDoc(next);
              setEditingCell(null);
              onConfirm(serializeSolaireTableBody(next));
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

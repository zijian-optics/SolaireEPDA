import yaml from "js-yaml";

export type SolaireTableAlign = "left" | "center" | "right";

export type SolaireTableCell = {
  text: string;
  header?: boolean;
  align?: SolaireTableAlign;
  rowSpan?: number;
  colSpan?: number;
};

export type SolaireTableDoc = {
  version: 1;
  rows: SolaireTableCell[][];
};

export type SolaireTableAnchor = {
  row: number;
  col: number;
  sourceIndex: number;
  cell: SolaireTableCell;
};

export type SolaireTableSlot = {
  anchorRow: number;
  anchorCol: number;
  cell: SolaireTableCell;
  covered: boolean;
};

export type ExpandedSolaireTable = {
  width: number;
  height: number;
  slots: SolaireTableSlot[][];
  anchors: SolaireTableAnchor[];
};

const ALIGN_VALUES = new Set<SolaireTableAlign>(["left", "center", "right"]);

function asPositiveSpan(value: unknown, label: string): number {
  if (value == null) return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

function normalizeCell(raw: unknown): SolaireTableCell {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return { text: String(raw) };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("table cell must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const align = rec.align == null ? undefined : String(rec.align);
  if (align != null && !ALIGN_VALUES.has(align as SolaireTableAlign)) {
    throw new Error("table cell align must be left, center, or right");
  }
  const rowSpan = asPositiveSpan(rec.rowSpan ?? rec.rowspan, "rowSpan");
  const colSpan = asPositiveSpan(rec.colSpan ?? rec.colspan, "colSpan");
  const cell: SolaireTableCell = {
    text: rec.text == null ? "" : String(rec.text),
  };
  if (rec.header === true) cell.header = true;
  if (align != null) cell.align = align as SolaireTableAlign;
  if (rowSpan > 1) cell.rowSpan = rowSpan;
  if (colSpan > 1) cell.colSpan = colSpan;
  return cell;
}

export function normalizeSolaireTableDoc(raw: unknown): SolaireTableDoc {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("table document must be an object");
  }
  const rec = raw as Record<string, unknown>;
  if (rec.version !== 1) {
    throw new Error("unsupported solaire-table version");
  }
  if (!Array.isArray(rec.rows) || rec.rows.length === 0) {
    throw new Error("table rows must be a non-empty array");
  }
  const rows = rec.rows.map((row) => {
    if (!Array.isArray(row)) {
      throw new Error("each table row must be an array");
    }
    return row.map(normalizeCell);
  });
  const doc: SolaireTableDoc = { version: 1, rows };
  expandSolaireTable(doc);
  return doc;
}

export function parseSolaireTable(source: string): SolaireTableDoc {
  return normalizeSolaireTableDoc(yaml.load(source));
}

export function tryParseSolaireTable(source: string): SolaireTableDoc | null {
  try {
    return parseSolaireTable(source);
  } catch {
    return null;
  }
}

function serializeCell(cell: SolaireTableCell): SolaireTableCell {
  const out: SolaireTableCell = { text: cell.text ?? "" };
  if (cell.header) out.header = true;
  if (cell.align) out.align = cell.align;
  if ((cell.rowSpan ?? 1) > 1) out.rowSpan = cell.rowSpan;
  if ((cell.colSpan ?? 1) > 1) out.colSpan = cell.colSpan;
  return out;
}

export function serializeSolaireTableBody(doc: SolaireTableDoc): string {
  const normalized = normalizeSolaireTableDoc(doc);
  return yaml.dump(
    {
      version: 1,
      rows: normalized.rows.map((row) => row.map(serializeCell)),
    },
    {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    },
  ).trimEnd();
}

export function serializeSolaireTableBlock(doc: SolaireTableDoc): string {
  return "```solaire-table\n" + serializeSolaireTableBody(doc) + "\n```";
}

export function defaultSolaireTable(rows = 3, cols = 3): SolaireTableDoc {
  return {
    version: 1,
    rows: Array.from({ length: rows }, (_row, r) =>
      Array.from({ length: cols }, (_col, c) => ({
        text: r === 0 ? `列 ${c + 1}` : "",
        header: r === 0,
      })),
    ),
  };
}

export function expandSolaireTable(doc: SolaireTableDoc): ExpandedSolaireTable {
  const slots: SolaireTableSlot[][] = Array.from({ length: doc.rows.length }, () => []);
  const anchors: SolaireTableAnchor[] = [];

  doc.rows.forEach((row, r) => {
    let c = 0;
    row.forEach((cell, sourceIndex) => {
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      if (r + rowSpan > doc.rows.length) {
        throw new Error("rowSpan exceeds table height");
      }
      while (slots[r][c]) c += 1;
      for (let rr = r; rr < r + rowSpan; rr += 1) {
        for (let cc = c; cc < c + colSpan; cc += 1) {
          if (slots[rr][cc]) {
            throw new Error("table cells overlap");
          }
        }
      }
      const normalizedCell = serializeCell(cell);
      anchors.push({ row: r, col: c, sourceIndex, cell: normalizedCell });
      for (let rr = r; rr < r + rowSpan; rr += 1) {
        for (let cc = c; cc < c + colSpan; cc += 1) {
          slots[rr][cc] = {
            anchorRow: r,
            anchorCol: c,
            cell: normalizedCell,
            covered: rr !== r || cc !== c,
          };
        }
      }
      c += colSpan;
    });
  });

  const width = Math.max(...slots.map((row) => row.length));
  for (let r = 0; r < slots.length; r += 1) {
    for (let c = 0; c < width; c += 1) {
      if (!slots[r][c]) {
        throw new Error("table must be rectangular");
      }
    }
  }

  return { width, height: doc.rows.length, slots, anchors };
}

export function anchorsToSolaireTable(
  anchors: Array<{ row: number; col: number; cell: SolaireTableCell }>,
  height: number,
): SolaireTableDoc {
  const rows: SolaireTableCell[][] = Array.from({ length: height }, () => []);
  [...anchors]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .forEach((anchor) => {
      rows[anchor.row].push(serializeCell(anchor.cell));
    });
  return normalizeSolaireTableDoc({ version: 1, rows });
}

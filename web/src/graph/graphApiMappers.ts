/**
 * Map knowledge graph REST payloads to UI row types.
 */
import type { GraphNodeNoteRow, GraphNodeRow, GraphRelationRow } from "./useGraphStore";

export function apiNodeToGraphRow(
  n: Record<string, unknown> | undefined,
  fallbackId: string,
): GraphNodeRow {
  if (!n || typeof n !== "object") {
    return { id: fallbackId, canonical_name: "", node_kind: "concept" };
  }
  return {
    id: String(n.id ?? fallbackId),
    canonical_name: String(n.canonical_name ?? ""),
    node_kind: (typeof n.node_kind === "string" ? n.node_kind : "concept") as GraphNodeRow["node_kind"],
    subject: (n.subject as string | null | undefined) ?? null,
    level: (n.level as string | null | undefined) ?? null,
    description: (n.description as string | null | undefined) ?? null,
    aliases: Array.isArray(n.aliases) ? (n.aliases as string[]) : [],
    tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
    layout_x: typeof n.layout_x === "number" ? n.layout_x : (n.layout_x as number | null | undefined) ?? null,
    layout_y: typeof n.layout_y === "number" ? n.layout_y : (n.layout_y as number | null | undefined) ?? null,
    file_link_count: typeof n.file_link_count === "number" ? n.file_link_count : undefined,
    primary_parent_id: (n.primary_parent_id as string | null | undefined) ?? null,
    notes: Array.isArray(n.notes) ? (n.notes as GraphNodeNoteRow[]) : undefined,
  };
}

export function apiRelationToGraphRow(
  r: Record<string, unknown> | null | undefined,
): GraphRelationRow | null {
  if (!r || typeof r !== "object" || !r.id) return null;
  return {
    id: String(r.id),
    from_node_id: String(r.from_node_id ?? ""),
    to_node_id: String(r.to_node_id ?? ""),
    relation_type: String(r.relation_type ?? "related"),
  };
}

/** 节点创建/恢复请求体（与后端 GraphNodeCreateBody 对齐） */
export function graphNodeRowToCreateBody(n: GraphNodeRow): Record<string, unknown> {
  const parent = n.primary_parent_id?.trim() ? n.primary_parent_id : null;
  return {
    id: n.id,
    canonical_name: n.canonical_name,
    aliases: n.aliases ?? [],
    node_kind: n.node_kind ?? "concept",
    subject: n.subject ?? null,
    level: n.level ?? null,
    description: n.description ?? null,
    tags: n.tags ?? [],
    source: null,
    primary_parent_id: parent,
    ...(parent ? { parent_node_id: parent } : {}),
    layout_x: n.layout_x ?? null,
    layout_y: n.layout_y ?? null,
  };
}

/**
 * Zustand store for knowledge graph state.
 * Manages multi-graph (per-subject) data, active graph selection, view mode, and selection state.
 */
import { create } from "zustand";
import type { GraphInfo } from "../api/client";

export type GraphNodeNoteRow = {
  id: string;
  body: string;
  created_at?: string;
};

export type GraphNodeRow = {
  id: string;
  canonical_name: string;
  node_kind?: string;
  subject?: string | null;
  level?: string | null;
  description?: string | null;
  aliases?: string[];
  tags?: string[];
  layout_x?: number | null;
  layout_y?: number | null;
  file_link_count?: number;
  primary_parent_id?: string | null;
  notes?: GraphNodeNoteRow[];
};

export type GraphRelationRow = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: string;
};

export type BoundQuestion = {
  qualified_id: string;
  type: string;
  content_preview: string;
};

export type NodeFileLink = {
  id: string;
  node_id: string;
  relative_path: string;
};

/** Canvas view mode */
export type ViewMode = "mindmap" | "graph";

/** Right-panel tab */
export type PanelTab = "edit" | "questions" | "files" | "notes";

interface GraphStore {
  // Multi-graph management
  graphs: GraphInfo[];
  activeSlug: string | null;
  setGraphs: (graphs: GraphInfo[]) => void;
  setActiveSlug: (slug: string | null) => void;

  // Graph data for active graph
  graphNodes: GraphNodeRow[];
  relations: GraphRelationRow[];
  kindCounts: Record<string, number>;
  subjects: string[];
  levels: string[];
  setGraphNodes: (nodes: GraphNodeRow[]) => void;
  /** 追加节点（乐观更新） */
  addGraphNode: (node: GraphNodeRow) => void;
  /** 移除节点及与其关联的边显示 */
  removeGraphNode: (id: string) => void;
  /** 替换节点（如临时 id → 服务端 id） */
  replaceGraphNode: (oldId: string, node: GraphNodeRow) => void;
  /** 就地合并字段 */
  patchGraphNode: (id: string, patch: Partial<GraphNodeRow>) => void;
  setRelations: (relations: GraphRelationRow[]) => void;
  /** 追加关系（乐观更新） */
  addGraphRelation: (rel: GraphRelationRow) => void;
  /** 按 id 移除关系 */
  removeGraphRelations: (predicate: (r: GraphRelationRow) => boolean) => void;
  setKindCounts: (counts: Record<string, number>) => void;
  setSubjects: (subjects: string[]) => void;
  setLevels: (levels: string[]) => void;

  // Selection
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;

  // View mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Right panel
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  panelExpanded: boolean;
  setPanelExpanded: (expanded: boolean) => void;

  // Layout nonce (trigger re-layout)
  layoutNonce: number;
  triggerRelayout: () => void;

  // Connecting mode (for adding relations interactively)
  connectingFromId: string | null;
  setConnectingFromId: (id: string | null) => void;

  // New node pending (orphan created, awaiting edit)
  pendingNewNodeId: string | null;
  setPendingNewNodeId: (id: string | null) => void;

  // Busy flag
  busy: boolean;
  setBusy: (busy: boolean) => void;

  // Error
  error: string | null;
  setError: (error: string | null) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  graphs: [],
  activeSlug: null,
  setGraphs: (graphs) => set({ graphs }),
  setActiveSlug: (slug) => set({ activeSlug: slug, selectedNodeId: null, selectedEdgeId: null }),

  graphNodes: [],
  relations: [],
  kindCounts: {},
  subjects: [],
  levels: [],
  setGraphNodes: (nodes) => set({ graphNodes: nodes }),
  addGraphNode: (node) =>
    set((s) => {
      const nk = (node.node_kind ?? "concept") as string;
      return {
        graphNodes: [...s.graphNodes, node],
        kindCounts: {
          ...s.kindCounts,
          [nk]: (s.kindCounts[nk] ?? 0) + 1,
        },
      };
    }),
  removeGraphNode: (id) =>
    set((s) => {
      const node = s.graphNodes.find((n) => n.id === id);
      const nk = (node?.node_kind ?? "concept") as string;
      return {
        graphNodes: s.graphNodes.filter((n) => n.id !== id),
        relations: s.relations.filter((r) => r.from_node_id !== id && r.to_node_id !== id),
        kindCounts: {
          ...s.kindCounts,
          [nk]: Math.max(0, (s.kindCounts[nk] ?? 1) - 1),
        },
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      };
    }),
  replaceGraphNode: (oldId, node) =>
    set((s) => ({
      graphNodes: s.graphNodes.map((n) => (n.id === oldId ? node : n)),
      selectedNodeId: s.selectedNodeId === oldId ? node.id : s.selectedNodeId,
    })),
  patchGraphNode: (id, patch) =>
    set((s) => ({
      graphNodes: s.graphNodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),
  setRelations: (relations) => set({ relations }),
  addGraphRelation: (rel) =>
    set((s) => ({ relations: [...s.relations, rel] })),
  removeGraphRelations: (predicate) =>
    set((s) => ({ relations: s.relations.filter((r) => !predicate(r)) })),
  setKindCounts: (counts) => set({ kindCounts: counts }),
  setSubjects: (subjects) => set({ subjects }),
  setLevels: (levels) => set({ levels }),

  selectedNodeId: null,
  selectedEdgeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),

  viewMode: "mindmap",
  setViewMode: (mode) => set({ viewMode: mode }),

  panelTab: "edit",
  setPanelTab: (tab) => set({ panelTab: tab }),
  panelExpanded: false,
  setPanelExpanded: (expanded) => set({ panelExpanded: expanded }),

  layoutNonce: 0,
  triggerRelayout: () => set((s) => ({ layoutNonce: s.layoutNonce + 1 })),

  connectingFromId: null,
  setConnectingFromId: (id) => set({ connectingFromId: id }),

  pendingNewNodeId: null,
  setPendingNewNodeId: (id) => set({ pendingNewNodeId: id }),

  busy: false,
  setBusy: (busy) => set({ busy }),

  error: null,
  setError: (error) => set({ error }),
}));

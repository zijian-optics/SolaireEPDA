/**
 * MindMapCanvas: Tree-based mind map view using ReactFlow with LR tree layout.
 * - Uses primary_parent_id for tree structure
 * - Nodes without primary_parent_id are direct children of the virtual root
 * - Cross-references (non-primary part_of, prerequisite, related, causal) shown as dashed curves
 * - Supports keyboard shortcuts: Tab (child), Enter (sibling), Delete (delete)
 * - Supports inline rename on double-click
 * - Supports collapse/expand
 */
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import type { GraphNodeRow, GraphRelationRow } from "./useGraphStore";
import i18n from "../i18n/i18n";

// Virtual root sentinel
const VIRTUAL_ROOT_ID = "__virtual_root__";

const REL_COLOR: Record<string, string> = {
  prerequisite: "#2563eb",
  part_of: "#64748b",
  related: "#059669",
  causal: "#c2410c",
};

// ---------------------------------------------------------------------------
// Tree layout (LR, horizontal)
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string;
  children: TreeNode[];
  y: number;
  x: number;
  subtreeHeight: number;
}

const NODE_W = 160;
const NODE_H = 44;
const H_GAP = 80;
const V_GAP = 16;

function buildTree(
  nodes: GraphNodeRow[],
  rootId: string,
  childrenByParent: Map<string, string[]>,
  collapsed: Set<string>,
): TreeNode {
  const children = collapsed.has(rootId)
    ? []
    : (childrenByParent.get(rootId) ?? []).map((cid) =>
        buildTree(nodes, cid, childrenByParent, collapsed),
      );

  const subtreeHeight =
    children.length === 0
      ? NODE_H
      : children.reduce((acc, c) => acc + c.subtreeHeight + V_GAP, -V_GAP);

  return { id: rootId, children, y: 0, x: 0, subtreeHeight };
}

function assignPositions(
  node: TreeNode,
  x: number,
  y: number,
  isVirtualRoot = false,
): void {
  node.x = x;
  node.y = y + node.subtreeHeight / 2 - NODE_H / 2;

  if (isVirtualRoot) {
    // Virtual root: distribute children vertically
    let curY = y;
    for (const child of node.children) {
      assignPositions(child, x + NODE_W + H_GAP, curY);
      curY += child.subtreeHeight + V_GAP;
    }
  } else {
    let curY = y;
    for (const child of node.children) {
      assignPositions(child, x + NODE_W + H_GAP, curY);
      curY += child.subtreeHeight + V_GAP;
    }
  }
}

function flattenTree(node: TreeNode): { id: string; x: number; y: number }[] {
  const result: { id: string; x: number; y: number }[] = [];
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    result.push({ id: n.id, x: n.x, y: n.y });
    for (const c of n.children) stack.push(c);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Node component
// ---------------------------------------------------------------------------

function MindMapNodeInner({ data, selected }: NodeProps) {
  const kind = String(data.nodeKind ?? "concept");
  const isVirtualRoot = Boolean((data as { isVirtualRoot?: boolean }).isVirtualRoot);
  const isCollapsed = Boolean((data as { isCollapsed?: boolean }).isCollapsed);
  const hasChildren = Boolean((data as { hasChildren?: boolean }).hasChildren);
  const isInlineEditing = Boolean((data as { isInlineEditing?: boolean }).isInlineEditing);
  const inlineValue = String((data as { inlineValue?: string }).inlineValue ?? data.label ?? "");
  const onInlineChange = (data as { onInlineChange?: (v: string) => void }).onInlineChange;
  const onInlineCommit = (data as { onInlineCommit?: () => void }).onInlineCommit;
  const onToggleCollapse = (data as { onToggleCollapse?: () => void }).onToggleCollapse;

  if (isVirtualRoot) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full border-2 border-slate-700 bg-slate-700 px-4 py-2 text-sm font-bold text-white shadow-md",
          selected ? "ring-2 ring-blue-400 ring-offset-1" : "",
        )}
        style={{ minWidth: NODE_W, minHeight: NODE_H }}
      >
        <Handle type="source" id="s" position={Position.Right} isConnectable={true} className="!border-0 !bg-slate-500" />
        <span className="line-clamp-2 text-center">{String(data.label ?? "")}</span>
      </div>
    );
  }

  const kindBorder =
    kind === "skill"
      ? "border-violet-400 bg-violet-50"
      : kind === "causal"
        ? "border-amber-400 bg-amber-50"
        : "border-slate-300 bg-white";

  return (
    <div
      className={cn(
        "group flex items-center rounded-md border shadow-sm transition-all",
        kindBorder,
        selected ? "ring-2 ring-slate-900 ring-offset-1" : "hover:shadow-md",
      )}
      style={{ minWidth: NODE_W, minHeight: NODE_H, width: NODE_W, height: NODE_H }}
    >
      <Handle
        type="target"
        id="t"
        position={Position.Left}
        isConnectable={true}
        className="!h-2.5 !w-2.5 !border-2 !border-slate-300 !bg-white"
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1">
        <span
          className={cn(
            "rounded-sm px-1 py-0.5 text-[9px] font-medium leading-none",
            kind === "skill"
              ? "bg-violet-200 text-violet-800"
              : kind === "causal"
                ? "bg-amber-200 text-amber-800"
                : "bg-slate-100 text-slate-600",
          )}
          style={{ display: "inline-block", width: "fit-content", marginBottom: 2 }}
        >
          {i18n.t(`nodeKind.${kind}`, { ns: "graph", defaultValue: kind })}
        </span>
        {isInlineEditing ? (
          <input
            className="w-full rounded border border-blue-400 px-1 py-0 text-xs font-medium outline-none"
            autoFocus
            value={inlineValue}
            onChange={(e) => onInlineChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                onInlineCommit?.();
              }
            }}
            onBlur={() => onInlineCommit?.()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="line-clamp-2 text-xs font-medium text-slate-800">
            {String(data.label ?? "")}
          </span>
        )}
      </div>

      <Handle
        type="source"
        id="s"
        position={Position.Right}
        isConnectable={true}
        className="!h-2.5 !w-2.5 !border-2 !border-slate-300 !bg-white"
      />

      {hasChildren ? (
        <button
          type="button"
          className="absolute -right-4 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] text-slate-600 shadow-sm hover:bg-slate-100"
          onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
        >
          {isCollapsed ? "+" : "−"}
        </button>
      ) : null}
    </div>
  );
}

const nodeTypes = { mindmap: MindMapNodeInner };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  graphNodes: GraphNodeRow[];
  relations: GraphRelationRow[];
  selectedNodeId: string | null;
  layoutNonce: number;
  connectingFromId: string | null;
  activeGraphName: string;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
  onNodeDragStop: (nodeId: string, x: number, y: number) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onAddNode: () => void;
  onAddChildNode: (parentId: string) => void;
  onAddSiblingNode: (siblingId: string) => void;
  onStartConnect: () => void;
  onRelayout: () => void;
  onCancelConnect: () => void;
  onRenameNode: (nodeId: string, newName: string) => Promise<void>;
}

export function MindMapCanvas({
  graphNodes,
  relations,
  selectedNodeId,
  layoutNonce,
  connectingFromId,
  activeGraphName,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onAddNode,
  onAddChildNode,
  onAddSiblingNode,
  onStartConnect,
  onRelayout,
  onCancelConnect,
  onRenameNode,
}: Props) {
  const { t } = useTranslation("graph");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const rfRef = useRef<{ fitView: (opts?: any) => void } | null>(null);

  // Build children map by primary_parent_id
  const childrenByParent = useMemo(() => {
    const m = new Map<string, string[]>();
    // Virtual root children = nodes without primary_parent_id
    m.set(VIRTUAL_ROOT_ID, []);
    for (const n of graphNodes) {
      if (!n.primary_parent_id) {
        m.get(VIRTUAL_ROOT_ID)!.push(n.id);
      } else {
        if (!m.has(n.primary_parent_id)) m.set(n.primary_parent_id, []);
        m.get(n.primary_parent_id)!.push(n.id);
      }
    }
    return m;
  }, [graphNodes]);


  // Layout
  useEffect(() => {
    if (!graphNodes.length) { setNodes([]); setEdges([]); return; }

    const nodeById = new Map(graphNodes.map((n) => [n.id, n]));

    // Build tree
    const tree = buildTree(graphNodes, VIRTUAL_ROOT_ID, childrenByParent, collapsed);
    assignPositions(tree, 0, 0, true);
    const positions = flattenTree(tree);

    // Build RF nodes
    const rfNodes: Node[] = [
      {
        id: VIRTUAL_ROOT_ID,
        type: "mindmap",
        position: { x: 0, y: positions.find((p) => p.id === VIRTUAL_ROOT_ID)?.y ?? 0 },
        data: {
          label: activeGraphName,
          isVirtualRoot: true,
          hasChildren: (childrenByParent.get(VIRTUAL_ROOT_ID) ?? []).length > 0,
          isCollapsed: collapsed.has(VIRTUAL_ROOT_ID),
          onToggleCollapse: () => setCollapsed((prev) => {
            const n = new Set(prev);
            if (n.has(VIRTUAL_ROOT_ID)) n.delete(VIRTUAL_ROOT_ID);
            else n.add(VIRTUAL_ROOT_ID);
            return n;
          }),
        },
        width: NODE_W,
        height: NODE_H,
        zIndex: 1,
        style: { width: NODE_W, height: NODE_H, zIndex: 1 },
      },
    ];

    for (const n of graphNodes) {
      const pos = positions.find((p) => p.id === n.id);
      if (!pos) continue;
      const hasChildren = (childrenByParent.get(n.id) ?? []).length > 0;
      const isCollapsedNode = collapsed.has(n.id);
      const isEditing = inlineEditId === n.id;
      rfNodes.push({
        id: n.id,
        type: "mindmap",
        position: { x: pos.x, y: pos.y },
        data: {
          label: n.canonical_name,
          nodeKind: n.node_kind ?? "concept",
          hasChildren,
          isCollapsed: isCollapsedNode,
          isInlineEditing: isEditing,
          inlineValue: isEditing ? inlineEditValue : n.canonical_name,
          onInlineChange: (v: string) => setInlineEditValue(v),
          onInlineCommit: async () => {
            if (inlineEditValue.trim() && inlineEditValue.trim() !== n.canonical_name) {
              await onRenameNode(n.id, inlineEditValue.trim());
            }
            setInlineEditId(null);
          },
          onToggleCollapse: () => setCollapsed((prev) => {
            const ns = new Set(prev);
            if (ns.has(n.id)) ns.delete(n.id);
            else ns.add(n.id);
            return ns;
          }),
        },
        width: NODE_W,
        height: NODE_H,
        zIndex: 1,
        style: { width: NODE_W, height: NODE_H, zIndex: 1 },
      });
    }

    // Tree edges
    const rfEdges: Edge[] = [];
    for (const n of graphNodes) {
      const parentId = n.primary_parent_id ?? VIRTUAL_ROOT_ID;
      rfEdges.push({
        id: `tree-${parentId}-${n.id}`,
        source: parentId,
        target: n.id,
        sourceHandle: "s",
        targetHandle: "t",
        type: "default",
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      });
    }

    // Cross-reference edges (non-primary relations)
    for (const r of relations) {
      const isPrimaryEdge = (() => {
        const targetNode = nodeById.get(r.to_node_id);
        if (!targetNode) return false;
        return (
          r.relation_type === "part_of" &&
          targetNode.primary_parent_id === r.from_node_id
        );
      })();

      if (isPrimaryEdge) continue;

      rfEdges.push({
        id: `cross-${r.id}`,
        source: r.from_node_id,
        target: r.to_node_id,
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: {
          stroke: REL_COLOR[r.relation_type] ?? "#64748b",
          strokeWidth: 1,
          strokeDasharray: "5,4",
          opacity: 0.6,
        },
        label: t(`edgeKind.${r.relation_type}`, { defaultValue: r.relation_type }),
        labelStyle: { fontSize: 9, fill: REL_COLOR[r.relation_type] ?? "#64748b" },
        labelShowBg: true,
        labelBgStyle: { fill: "white", opacity: 0.8 },
      });
    }

    setNodes(rfNodes);
    setEdges(rfEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, relations, childrenByParent, collapsed, inlineEditId, inlineEditValue, activeGraphName, layoutNonce]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (inlineEditId) return; // editing mode, ignore
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (!selectedNodeId || selectedNodeId === VIRTUAL_ROOT_ID) return;

      if (e.key === "Tab") {
        e.preventDefault();
        onAddChildNode(selectedNodeId);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onAddSiblingNode(selectedNodeId);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        // handled upstream via onNodeClick + delete
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId, inlineEditId, onAddChildNode, onAddSiblingNode]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === VIRTUAL_ROOT_ID) { onPaneClick(); return; }
    if (connectingFromId && connectingFromId !== node.id) {
      onConnect(connectingFromId, node.id);
    } else {
      onNodeClick(node.id);
    }
  }, [connectingFromId, onConnect, onNodeClick, onPaneClick]);

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === VIRTUAL_ROOT_ID) return;
    setInlineEditId(node.id);
    const gn = graphNodes.find((n) => n.id === node.id);
    setInlineEditValue(gn?.canonical_name ?? "");
  }, [graphNodes]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    if (edge.id.startsWith("cross-")) {
      onEdgeClick(edge.id.slice(6));
    }
  }, [onEdgeClick]);

  const handlePaneClick = useCallback(() => {
    setInlineEditId(null);
    if (connectingFromId) {
      onCancelConnect();
    } else {
      onPaneClick();
    }
  }, [connectingFromId, onCancelConnect, onPaneClick]);

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id !== VIRTUAL_ROOT_ID) {
      onNodeDragStop(node.id, node.position.x, node.position.y);
    }
  }, [onNodeDragStop]);

  return (
    <div className="flex h-full flex-col">
      {/* Canvas toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50" onClick={onAddNode}>
          + {t("addNode")}
        </button>

        {connectingFromId ? (
          <button type="button" className="rounded border border-amber-400 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900" onClick={onCancelConnect}>
            {t("cancelConnect")} ✕
          </button>
        ) : (
          <button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40" onClick={onStartConnect} disabled={!selectedNodeId}>
            {t("addRelation")}
          </button>
        )}

        <button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50" onClick={onRelayout}>
          {t("relayout")}
        </button>

        <span className="hidden text-[11px] text-slate-400 sm:inline">
          {t("mindmapHint")}
        </span>
      </div>

      {connectingFromId ? (
        <div className="bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 border-b border-amber-200">
          {t("connectModeHint")} {graphNodes.find((n) => n.id === connectingFromId)?.canonical_name ?? connectingFromId}
        </div>
      ) : null}

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={(inst) => { rfRef.current = inst; }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.Straight}
          fitView
          minZoom={0.15}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>
    </div>
  );
}

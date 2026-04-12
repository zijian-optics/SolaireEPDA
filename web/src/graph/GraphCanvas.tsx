/**
 * GraphCanvas: The ReactFlow-based knowledge graph view.
 * Includes a top toolbar for actions and layout switching.
 */
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ConnectionLineType,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
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
import { CircleChordEdge } from "./CircleChordEdge";
import {
  assignStraightEdges,
  layoutWithDagre,
  layoutWithForceDirected,
  mergeSavedLayout,
  nodeBoxSizeFromMaterialCount,
  removeNodeOverlaps,
} from "./layoutGraph";
import { OVERLAP_DEFAULT } from "./layoutParams";
import { cn } from "../lib/utils";
import type { GraphNodeRow, GraphRelationRow } from "./useGraphStore";
import i18n from "../i18n/i18n";

const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;
const REL_COLOR: Record<string, string> = {
  prerequisite: "#2563eb",
  part_of: "#64748b",
  related: "#059669",
  causal: "#c2410c",
};

function KnowledgeNode({ data, selected }: NodeProps) {
  const kind = String(data.nodeKind ?? "concept");
  const dim = Boolean((data as { focusDimmed?: boolean }).focusDimmed);
  const sizePx =
    typeof (data as { sizePx?: number }).sizePx === "number"
      ? (data as { sizePx: number }).sizePx
      : 140;
  const pad = Math.max(8, Math.round(sizePx * 0.06));
  const kindCls =
    kind === "skill"
      ? "border-violet-300 bg-violet-50"
      : kind === "causal"
        ? "border-amber-300 bg-amber-50"
        : "border-slate-200 bg-white";
  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center gap-1 rounded-full border text-center shadow-sm transition-opacity",
        kindCls,
        selected ? "ring-2 ring-slate-900 ring-offset-1" : "",
        dim ? "opacity-[0.2]" : "opacity-100",
      )}
      style={{ width: sizePx, height: sizePx, minWidth: sizePx, minHeight: sizePx, maxWidth: sizePx, maxHeight: sizePx, padding: `${pad}px` }}
    >
      <Handle type="target" id="t" position={Position.Top} isConnectable={true} className="!h-3 !w-3 !border-2 !border-slate-400 !bg-white" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }} />
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
          kind === "skill" ? "bg-violet-200 text-violet-900" : kind === "causal" ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-800",
        )}
      >
        {i18n.t(`nodeKind.${kind}`, { ns: "graph", defaultValue: kind })}
      </span>
      <div className="line-clamp-3 w-full max-w-[min(92%,11rem)] text-xs font-semibold leading-snug text-slate-900">
        {String(data.label ?? "")}
      </div>
      <Handle type="source" id="s" position={Position.Bottom} isConnectable={true} className="!h-3 !w-3 !border-2 !border-slate-400 !bg-white" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }} />
    </div>
  );
}

const nodeTypes = { knowledge: KnowledgeNode };
const edgeTypes = { circleChord: CircleChordEdge };

interface Props {
  graphNodes: GraphNodeRow[];
  relations: GraphRelationRow[];
  selectedNodeId: string | null;
  layoutNonce: number;
  connectingFromId: string | null;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
  onNodeDragStop: (nodeId: string, x: number, y: number) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onAddNode: () => void;
  onStartConnect: () => void;
  onRelayout: () => void;
  onCancelConnect: () => void;
}

function computeKHopNodes(
  centerId: string | null,
  hops: 0 | 1 | 2,
  edgePairs: { from_node_id: string; to_node_id: string }[],
): Set<string> | null {
  if (!centerId || hops === 0) return null;
  const adj = new Map<string, string[]>();
  for (const e of edgePairs) {
    if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, []);
    if (!adj.has(e.to_node_id)) adj.set(e.to_node_id, []);
    adj.get(e.from_node_id)!.push(e.to_node_id);
    adj.get(e.to_node_id)!.push(e.from_node_id);
  }
  const dist = new Map<string, number>();
  const q: string[] = [centerId];
  dist.set(centerId, 0);
  while (q.length) {
    const u = q.shift()!;
    const d = dist.get(u)!;
    if (d >= hops) continue;
    for (const v of adj.get(u) ?? []) {
      if (!dist.has(v)) { dist.set(v, d + 1); q.push(v); }
    }
  }
  return new Set(dist.keys());
}

export function GraphCanvas({
  graphNodes,
  relations,
  selectedNodeId,
  layoutNonce,
  connectingFromId,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onAddNode,
  onStartConnect,
  onRelayout,
  onCancelConnect,
}: Props) {
  const { t } = useTranslation("graph");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusHops, setFocusHops] = useState<0 | 1 | 2>(0);
  const [focusCenterId, setFocusCenterId] = useState<string | null>(null);
  const [relTypeFilter, setRelTypeFilter] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const k of REL_KEYS) o[k] = true;
    return o;
  });
  const [nodeKindFilter] = useState<Record<string, boolean>>({
    concept: true, skill: true, causal: true,
  });
  const nonFocusForceBootstrappedRef = useRef(false);
  const rfRef = useRef<{ fitView: (opts?: { nodes?: { id: string }[]; duration?: number; padding?: number }) => void } | null>(null);

  const filteredRelations = useMemo(() => {
    const nodeIds = new Set(graphNodes.filter((n) => nodeKindFilter[n.node_kind ?? "concept"] !== false).map((n) => n.id));
    return relations.filter((r) => {
      if (relTypeFilter[r.relation_type] === false) return false;
      return nodeIds.has(r.from_node_id) && nodeIds.has(r.to_node_id);
    });
  }, [graphNodes, relations, relTypeFilter, nodeKindFilter]);

  const filteredGraphNodes = useMemo(
    () => graphNodes.filter((n) => nodeKindFilter[n.node_kind ?? "concept"] !== false),
    [graphNodes, nodeKindFilter],
  );

  const nodeSizes = useMemo(() => {
    const m = new Map<string, { w: number; h: number }>();
    for (const n of filteredGraphNodes) {
      m.set(n.id, nodeBoxSizeFromMaterialCount(n.file_link_count ?? 0));
    }
    return m;
  }, [filteredGraphNodes]);

  const savedPositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of graphNodes) {
      if (n.layout_x != null && n.layout_y != null) {
        m.set(n.id, { x: n.layout_x, y: n.layout_y });
      }
    }
    return m;
  }, [graphNodes]);

  const focusForceLayout = focusHops > 0 && focusCenterId != null;
  const focusSet = useMemo(
    () => computeKHopNodes(focusCenterId, focusHops, filteredRelations),
    [focusCenterId, focusHops, filteredRelations],
  );

  useEffect(() => {
    const gn = filteredGraphNodes;
    const rel = filteredRelations;
    if (!gn.length) { setNodes([]); setEdges([]); return; }

    const baseEdges: Edge[] = rel.map((r) => ({
      id: r.id,
      source: r.from_node_id,
      target: r.to_node_id,
      data: { relationType: r.relation_type },
      zIndex: 0,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: REL_COLOR[r.relation_type] ?? "#64748b",
        strokeWidth: r.relation_type === "prerequisite" ? 1.75 : 1.25,
        opacity: 0.5,
      },
    }));

    const rfNodes: Node[] = gn.map((n) => {
      const box = nodeSizes.get(n.id) ?? nodeBoxSizeFromMaterialCount(0);
      return {
        id: n.id,
        type: "knowledge",
        position: { x: 0, y: 0 },
        width: box.w,
        height: box.h,
        zIndex: 1,
        style: { width: box.w, height: box.h, zIndex: 1 },
        data: { label: n.canonical_name, nodeKind: n.node_kind ?? "concept", sizePx: box.w },
      };
    });

    const rfEdges = assignStraightEdges(baseEdges);
    let laid: Node[];
    if (!focusForceLayout) {
      laid = layoutWithDagre(rfNodes, rfEdges, nodeSizes);
      if (savedPositions.size > 0) laid = mergeSavedLayout(laid, savedPositions);
      const runNonFocusForce = !nonFocusForceBootstrappedRef.current || layoutNonce > 0;
      if (runNonFocusForce) {
        const seedMap = new Map<string, { x: number; y: number }>();
        for (const n of laid) seedMap.set(n.id, n.position);
        laid = layoutWithForceDirected(laid, rfEdges, { seed: seedMap, sizes: nodeSizes });
        laid = removeNodeOverlaps(laid, undefined, undefined, OVERLAP_DEFAULT.canvasPadding, OVERLAP_DEFAULT.maxPasses, nodeSizes);
        nonFocusForceBootstrappedRef.current = true;
      } else {
        laid = removeNodeOverlaps(laid, undefined, undefined, OVERLAP_DEFAULT.canvasPadding, OVERLAP_DEFAULT.maxPasses, nodeSizes);
      }
    } else {
      let seed = layoutWithDagre(rfNodes, rfEdges, nodeSizes);
      if (savedPositions.size > 0) seed = mergeSavedLayout(seed, savedPositions);
      const seedMap = new Map<string, { x: number; y: number }>();
      for (const n of seed) seedMap.set(n.id, n.position);
      laid = layoutWithForceDirected(seed, rfEdges, { seed: seedMap, sizes: nodeSizes });
      laid = removeNodeOverlaps(laid, undefined, undefined, OVERLAP_DEFAULT.canvasPadding, OVERLAP_DEFAULT.maxPasses, nodeSizes);
    }

    setNodes(laid);
    setEdges(rfEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGraphNodes, filteredRelations, savedPositions, focusForceLayout, layoutNonce, nodeSizes]);

  // Reset focus bootstrap when graph changes
  useEffect(() => {
    nonFocusForceBootstrappedRef.current = false;
  }, [graphNodes]);

  const nodesForRender = useMemo(
    () => nodes.map((n) => ({
      ...n,
      zIndex: 1,
      style: { ...n.style, zIndex: 1 },
      data: { ...n.data, focusDimmed: focusSet !== null && !focusSet.has(n.id) },
    })),
    [nodes, focusSet],
  );

  const edgesForRender = useMemo(
    () => edges.map((e) => {
      const dim = focusSet !== null && !(focusSet.has(e.source) && focusSet.has(e.target));
      const rt = (e.data as { relationType?: string } | undefined)?.relationType;
      const inFocusEdge = focusSet !== null && focusSet.has(e.source) && focusSet.has(e.target);
      const showRelationLabel = Boolean(focusSet && inFocusEdge && rt);
      const baseOp = focusSet === null ? 0.5 : dim ? 0.12 : 1;
      return {
        ...e,
        zIndex: 0,
        label: showRelationLabel ? i18n.t(`edgeKind.${rt}`, { ns: "graph", defaultValue: rt }) : undefined,
        labelShowBg: showRelationLabel,
        style: { ...e.style, opacity: baseOp },
      };
    }),
    [edges, focusSet],
  );

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (connectingFromId && connectingFromId !== node.id) {
      onConnect(connectingFromId, node.id);
    } else {
      onNodeClick(node.id);
    }
  }, [connectingFromId, onConnect, onNodeClick]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    onEdgeClick(edge.id);
  }, [onEdgeClick]);

  const handlePaneClick = useCallback(() => {
    if (connectingFromId) {
      onCancelConnect();
    } else {
      onPaneClick();
    }
  }, [connectingFromId, onCancelConnect, onPaneClick]);

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeDragStop(node.id, node.position.x, node.position.y);
  }, [onNodeDragStop]);

  return (
    <div className="flex h-full flex-col">
      {/* Canvas toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        {/* Action buttons */}
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
          onClick={onAddNode}
        >
          + {t("addNode")}
        </button>

        {connectingFromId ? (
          <button
            type="button"
            className="rounded border border-amber-400 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900"
            onClick={onCancelConnect}
          >
            {t("cancelConnect")} ✕
          </button>
        ) : (
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
            onClick={onStartConnect}
            disabled={!selectedNodeId}
          >
            {t("addRelation")}
          </button>
        )}

        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
          onClick={onRelayout}
        >
          {t("relayout")}
        </button>

        <span className="hidden h-4 w-px bg-slate-200 sm:inline" aria-hidden />

        {/* Relation type filters */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="text-slate-500">{t("relTypeCanvas")}</span>
          {REL_KEYS.map((k) => (
            <label key={k} className="inline-flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={relTypeFilter[k] !== false}
                onChange={(e) => setRelTypeFilter((prev) => ({ ...prev, [k]: e.target.checked }))}
              />
              <span style={{ color: REL_COLOR[k] ?? "#64748b" }}>{t(`edgeKind.${k}`)}</span>
            </label>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-slate-200 sm:inline" aria-hidden />

        {/* Neighborhood focus */}
        <label className="inline-flex items-center gap-1 text-[11px]">
          <span className="text-slate-500">{t("focusNeighborhood")}</span>
          <select
            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]"
            value={focusHops}
            onChange={(e) => {
              const v = Number(e.target.value) as 0 | 1 | 2;
              setFocusHops(v);
              if (v === 0) setFocusCenterId(null);
              else if (selectedNodeId) setFocusCenterId(selectedNodeId);
            }}
          >
            <option value={0}>{t("focusOff")}</option>
            <option value={1}>{t("focus1")}</option>
            <option value={2}>{t("focus2")}</option>
          </select>
        </label>
      </div>

      {/* Connection mode banner */}
      {connectingFromId ? (
        <div className="bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 border-b border-amber-200">
          {t("connectModeHint")} {graphNodes.find((n) => n.id === connectingFromId)?.canonical_name ?? connectingFromId}
        </div>
      ) : null}

      {/* ReactFlow canvas */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodesForRender}
          edges={edgesForRender}
          onInit={(inst) => { rfRef.current = inst; }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.Straight}
          elevateEdgesOnSelect={false}
          fitView
          minZoom={0.2}
          maxZoom={1.4}
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

/**
 * GraphWorkspace – Main knowledge graph page.
 *
 * Layout:
 *   [Left: SubjectSidebar] [Center: Canvas (mindmap|graph)] [Right: NodePanel]
 *
 * All shared state is managed via useGraphStore (Zustand).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiGraphCreateGraph,
  apiGraphCreateNode,
  apiGraphCreateRelation,
  apiGraphDeleteGraph,
  apiGraphGetTaxonomy,
  apiGraphListGraphs,
  apiGraphListNodes,
  apiGraphListRelations,
  apiGraphRenameGraph,
  apiGraphUpdateNode,
} from "../api/client";
import { useAgentContext } from "../contexts/AgentContext";
import { GraphSubjectSidebar } from "../graph/GraphSubjectSidebar";
import { GraphCanvas } from "../graph/GraphCanvas";
import { MindMapCanvas } from "../graph/MindMapCanvas";
import { GraphNodePanel } from "../graph/GraphNodePanel";
import { useGraphStore } from "../graph/useGraphStore";
import i18n from "../i18n/i18n";
import { SOLAIRE_SAVE_EVENT } from "../lib/saveEvents";

export function GraphWorkspace({
  onError,
  focusNodeId = null,
  onFocusConsumed,
}: {
  onError: (s: string | null) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { t } = useTranslation(["graph", "common"]);
  const { setPageContext } = useAgentContext();

  const {
    graphs, activeSlug, setGraphs, setActiveSlug,
    graphNodes, relations, subjects, levels,
    setGraphNodes, setRelations, setSubjects, setLevels, setKindCounts,
    selectedNodeId, selectedEdgeId, setSelectedNodeId, setSelectedEdgeId,
    viewMode, setViewMode,
    panelTab, setPanelTab, panelExpanded, setPanelExpanded,
    layoutNonce, triggerRelayout,
    connectingFromId, setConnectingFromId,
    busy, setBusy,
  } = useGraphStore();

  // Connect relation type pending selection
  const [pendingConnectSource, setPendingConnectSource] = useState<string | null>(null);
  const [pendingConnectTarget, setPendingConnectTarget] = useState<string | null>(null);
  const [connectRelType, setConnectRelType] = useState("related");
  const [showConnectDialog, setShowConnectDialog] = useState(false);

  const selectedNode = useMemo(
    () => (selectedNodeId ? graphNodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [graphNodes, selectedNodeId],
  );

  // Page context for agent
  useEffect(() => {
    if (selectedNodeId && selectedNode) {
      setPageContext({
        current_page: "graph",
        selected_resource_type: "graph_node",
        selected_resource_id: selectedNodeId,
        summary: t("pageSummaryWithNode", { name: selectedNode.canonical_name }),
      });
    } else {
      setPageContext({ current_page: "graph", summary: t("pageSummaryDefault") });
    }
    return () => setPageContext(null);
  }, [selectedNodeId, selectedNode, setPageContext, t]);

  // Focus node from external (e.g. agent)
  useEffect(() => {
    if (!focusNodeId) return;
    setSelectedNodeId(focusNodeId);
    setPanelExpanded(true);
    queueMicrotask(() => onFocusConsumed?.());
  }, [focusNodeId, onFocusConsumed, setSelectedNodeId, setPanelExpanded]);

  // Load graph list on mount
  const loadGraphList = useCallback(async () => {
    try {
      const r = await apiGraphListGraphs();
      setGraphs(r.graphs);
      return r.graphs;
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, [setGraphs, onError]);

  // Load graph data for active slug
  const loadGraphData = useCallback(async (slug: string | null) => {
    if (!slug) { setGraphNodes([]); setRelations([]); return; }
    onError(null);
    try {
      setBusy(true);
      const [n, r, tx] = await Promise.all([
        apiGraphListNodes(undefined, slug),
        apiGraphListRelations(slug),
        apiGraphGetTaxonomy(),
      ]);
      setGraphNodes(n.nodes);
      setKindCounts(n.kind_counts ?? {});
      setRelations(r.relations);
      setSubjects(tx.subjects?.length ? tx.subjects : [i18n.t("defaultSubject", { ns: "graph" })]);
      setLevels(tx.levels?.length ? tx.levels : [i18n.t("defaultLevel1", { ns: "graph" }), i18n.t("defaultLevel2", { ns: "graph" })]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [onError, setBusy, setGraphNodes, setKindCounts, setRelations, setSubjects, setLevels]);

  // Initial load
  useEffect(() => {
    void (async () => {
      const gs = await loadGraphList();
      if (gs.length > 0 && !activeSlug) {
        setActiveSlug(gs[0].slug);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when active slug changes
  useEffect(() => {
    void loadGraphData(activeSlug);
  }, [activeSlug, loadGraphData]);

  // Reload after data changes
  const refreshAll = useCallback(async () => {
    await Promise.all([loadGraphList(), loadGraphData(activeSlug)]);
  }, [loadGraphList, loadGraphData, activeSlug]);

  // Keyboard save shortcut
  useEffect(() => {
    const onSave = () => { /* panel handles its own save */ };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, []);

  // Create new graph
  const handleCreateGraph = useCallback(async (displayName: string) => {
    setBusy(true);
    onError(null);
    try {
      const r = await apiGraphCreateGraph({ display_name: displayName });
      await loadGraphList();
      setActiveSlug(r.slug);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [setBusy, onError, loadGraphList, setActiveSlug]);

  const handleDeleteGraph = useCallback(async (slug: string) => {
    setBusy(true);
    onError(null);
    try {
      await apiGraphDeleteGraph(slug);
      const gs = await loadGraphList();
      if (activeSlug === slug) {
        setActiveSlug(gs[0]?.slug ?? null);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [setBusy, onError, loadGraphList, activeSlug, setActiveSlug]);

  const handleRenameGraph = useCallback(async (slug: string, newName: string) => {
    setBusy(true);
    onError(null);
    try {
      await apiGraphRenameGraph(slug, newName);
      await loadGraphList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [setBusy, onError, loadGraphList]);

  // Add orphan node
  const handleAddNode = useCallback(async () => {
    if (!activeSlug) return;
    const name = t("newNodeDefaultName");
    setBusy(true);
    onError(null);
    try {
      const r = await apiGraphCreateNode({
        canonical_name: name,
        aliases: [],
        node_kind: "concept",
        subject: null,
        level: null,
        description: null,
        tags: [],
        source: null,
        id: `${activeSlug}/node-${Date.now()}`,
      }, activeSlug);
      await refreshAll();
      setSelectedNodeId(r.node_id);
      setPanelExpanded(true);
      setPanelTab("edit");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeSlug, t, setBusy, onError, refreshAll, setSelectedNodeId, setPanelExpanded, setPanelTab]);

  // Add child node (mindmap Tab shortcut)
  const handleAddChildNode = useCallback(async (parentId: string) => {
    if (!activeSlug) return;
    const parent = graphNodes.find((n) => n.id === parentId);
    if (!parent) return;
    const name = t("newNodeDefaultName");
    setBusy(true);
    onError(null);
    try {
      const r = await apiGraphCreateNode({
        canonical_name: name,
        aliases: [],
        node_kind: "concept",
        subject: parent.subject ?? null,
        level: parent.level ?? null,
        description: null,
        tags: [],
        source: null,
        parent_node_id: parentId,
        primary_parent_id: parentId,
      }, activeSlug);
      await refreshAll();
      setSelectedNodeId(r.node_id);
      setPanelExpanded(true);
      setPanelTab("edit");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [activeSlug, graphNodes, t, setBusy, onError, refreshAll, setSelectedNodeId, setPanelExpanded, setPanelTab]);

  // Add sibling node (mindmap Enter shortcut)
  const handleAddSiblingNode = useCallback(async (siblingId: string) => {
    const sibling = graphNodes.find((n) => n.id === siblingId);
    if (!sibling) return;
    if (sibling.primary_parent_id) {
      await handleAddChildNode(sibling.primary_parent_id);
    } else {
      await handleAddNode();
    }
  }, [graphNodes, handleAddChildNode, handleAddNode]);

  // Persist layout drag
  const handleNodeDragStop = useCallback(async (nodeId: string, x: number, y: number) => {
    const n = graphNodes.find((g) => g.id === nodeId);
    if (!n) return;
    try {
      await apiGraphUpdateNode(nodeId, {
        id: nodeId,
        node_kind: n.node_kind ?? "concept",
        canonical_name: n.canonical_name,
        aliases: n.aliases ?? [],
        subject: n.subject ?? null,
        level: n.level ?? null,
        description: n.description ?? null,
        tags: n.tags ?? [],
        source: null,
        layout_x: x,
        layout_y: y,
        primary_parent_id: n.primary_parent_id ?? null,
      }, activeSlug);
      setGraphNodes(graphNodes.map((p) => p.id === nodeId ? { ...p, layout_x: x, layout_y: y } : p));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [graphNodes, activeSlug, onError, setGraphNodes]);

  // Rename node inline
  const handleRenameNode = useCallback(async (nodeId: string, newName: string) => {
    const n = graphNodes.find((g) => g.id === nodeId);
    if (!n) return;
    try {
      await apiGraphUpdateNode(nodeId, {
        ...n,
        id: nodeId,
        canonical_name: newName,
      }, activeSlug);
      await refreshAll();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [graphNodes, activeSlug, onError, refreshAll]);

  // Connect
  const handleStartConnect = useCallback(() => {
    if (!selectedNodeId) return;
    setConnectingFromId(selectedNodeId);
  }, [selectedNodeId, setConnectingFromId]);

  const handleCancelConnect = useCallback(() => {
    setConnectingFromId(null);
    setShowConnectDialog(false);
    setPendingConnectSource(null);
    setPendingConnectTarget(null);
  }, [setConnectingFromId]);

  const handleConnect = useCallback((sourceId: string, targetId: string) => {
    setPendingConnectSource(sourceId);
    setPendingConnectTarget(targetId);
    setShowConnectDialog(true);
    setConnectingFromId(null);
  }, [setConnectingFromId]);

  const commitConnect = useCallback(async () => {
    if (!pendingConnectSource || !pendingConnectTarget) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphCreateRelation({
        from_node_id: pendingConnectSource,
        to_node_id: pendingConnectTarget,
        relation_type: connectRelType,
      }, activeSlug);
      await refreshAll();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setShowConnectDialog(false);
      setPendingConnectSource(null);
      setPendingConnectTarget(null);
    }
  }, [pendingConnectSource, pendingConnectTarget, connectRelType, activeSlug, setBusy, onError, refreshAll]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setPanelExpanded(true);
    setPanelTab("edit");
  }, [setSelectedNodeId, setPanelExpanded, setPanelTab]);

  const handleEdgeClick = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    // Find nodes connected to this edge to open panel
    const rel = relations.find((r) => r.id === edgeId);
    if (rel) {
      setSelectedNodeId(rel.from_node_id);
      setPanelExpanded(true);
      setPanelTab("edit");
    }
  }, [setSelectedEdgeId, setSelectedNodeId, relations, setPanelExpanded, setPanelTab]);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const activeGraphInfo = useMemo(
    () => graphs.find((g) => g.slug === activeSlug),
    [graphs, activeSlug],
  );

  const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;

  return (
    <div className="flex h-full min-h-[70vh] flex-col gap-2 p-2">
      <div className="flex min-h-0 flex-1 flex-row gap-2">
        {/* Left: Subject selector */}
        <GraphSubjectSidebar
          graphs={graphs}
          activeSlug={activeSlug}
          onSelect={(slug) => {
            setActiveSlug(slug);
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          onCreateGraph={handleCreateGraph}
          onDeleteGraph={handleDeleteGraph}
          onRenameGraph={handleRenameGraph}
          busy={busy}
        />

        {/* Center: Canvas */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {busy && graphNodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              {t("loading")}
            </div>
          ) : activeSlug === null ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
              <p>{t("noGraphsHint")}</p>
              <p className="text-xs text-slate-400">{t("createFirstGraph")}</p>
            </div>
          ) : viewMode === "mindmap" ? (
            <MindMapCanvas
              graphNodes={graphNodes}
              relations={relations}
              selectedNodeId={selectedNodeId}
              viewMode={viewMode}
              layoutNonce={layoutNonce}
              connectingFromId={connectingFromId}
              activeGraphName={activeGraphInfo?.display_name ?? activeSlug ?? ""}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onAddNode={handleAddNode}
              onAddChildNode={handleAddChildNode}
              onAddSiblingNode={handleAddSiblingNode}
              onStartConnect={handleStartConnect}
              onRelayout={triggerRelayout}
              onViewModeChange={setViewMode}
              onCancelConnect={handleCancelConnect}
              onRenameNode={handleRenameNode}
            />
          ) : (
            <GraphCanvas
              graphNodes={graphNodes}
              relations={relations}
              selectedNodeId={selectedNodeId}
              viewMode={viewMode}
              layoutNonce={layoutNonce}
              connectingFromId={connectingFromId}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onAddNode={handleAddNode}
              onStartConnect={handleStartConnect}
              onRelayout={triggerRelayout}
              onViewModeChange={setViewMode}
              onCancelConnect={handleCancelConnect}
            />
          )}
        </div>

        {/* Right: Detail panel */}
        {panelExpanded ? (
          <GraphNodePanel
            selectedNode={selectedNode}
            relations={relations}
            graphNodes={graphNodes}
            subjects={subjects}
            levels={levels}
            activeSlug={activeSlug}
            tab={panelTab}
            onTabChange={setPanelTab}
            onSaved={refreshAll}
            onDeleted={() => { setSelectedNodeId(null); void refreshAll(); }}
            onError={onError}
            onClose={() => setPanelExpanded(false)}
            highlightEdgeId={selectedEdgeId}
          />
        ) : selectedNode ? (
          <button
            type="button"
            className="flex w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-4 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => setPanelExpanded(true)}
          >
            <span className="[writing-mode:vertical-rl]">{t("expandMaintain")}</span>
          </button>
        ) : null}
      </div>

      {/* Connect relation type dialog */}
      {showConnectDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900">{t("chooseRelationType")}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {graphNodes.find((n) => n.id === pendingConnectSource)?.canonical_name ?? pendingConnectSource}
              {" → "}
              {graphNodes.find((n) => n.id === pendingConnectTarget)?.canonical_name ?? pendingConnectTarget}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {REL_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${connectRelType === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                  onClick={() => setConnectRelType(k)}
                >
                  {t(`edgeKind.${k}`)}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={handleCancelConnect}>
                {t("cancel")}
              </button>
              <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy} onClick={() => void commitConnect()}>
                {t("createRelation")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

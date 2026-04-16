import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiGraphAttachFile,
  apiGraphBindBatch,
  apiGraphCreateRelation,
  apiGraphDeleteNode,
  apiGraphDeleteRelation,
  apiGraphDetachFile,
  apiGraphListNodeFiles,
  apiGraphListQuestionsForNode,
  apiGraphListResourceFiles,
  apiGraphUnbindBatch,
  apiGraphUnbindBinding,
  apiGraphUpdateNode,
  apiGraphUpdateRelation,
  apiGraphUploadMaterial,
  apiBankItems,
  resourceApiUrl,
} from "../api/client";
import { ContentWithPrimeBrush } from "../components/ContentWithPrimeBrush";
import { LatexRichTextField } from "../components/LatexRichTextField";
import { KatexPlainPreview } from "../components/KatexText";
import { cn } from "../lib/utils";
import { QUESTION_TYPE_OPTIONS } from "../lib/questionTypes";
import { localeCompareStrings } from "../lib/locale";
import type { GraphNodeNoteRow, GraphNodeRow, GraphRelationRow, BoundQuestion, NodeFileLink, PanelTab } from "./useGraphStore";

const REL_KEYS = ["prerequisite", "part_of", "related", "causal"] as const;
const REL_COLOR: Record<string, string> = {
  prerequisite: "#2563eb",
  part_of: "#64748b",
  related: "#059669",
  causal: "#c2410c",
};

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

interface Props {
  selectedNode: GraphNodeRow | null;
  relations: GraphRelationRow[];
  graphNodes: GraphNodeRow[];
  activeSlug: string | null;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onSaved: () => void;
  /** 侧栏确认删除后调用（工作区负责乐观更新与 API） */
  onDeleteNode?: () => Promise<void>;
  onDeleted: () => void;
  onError: (e: string | null) => void;
  onClose: () => void;
  /** ID of the edge to highlight in the relations list */
  highlightEdgeId?: string | null;
}

export function GraphNodePanel({
  selectedNode,
  relations,
  graphNodes,
  activeSlug,
  tab,
  onTabChange,
  onSaved,
  onDeleteNode,
  onDeleted,
  onError,
  onClose,
  highlightEdgeId,
}: Props) {
  const { t } = useTranslation("graph");
  const [busy, setBusy] = useState(false);

  // Edit state
  const [draftName, setDraftName] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftAliases, setDraftAliases] = useState("");
  const [draftKind, setDraftKind] = useState<"concept" | "skill" | "causal">("concept");
  const [draftPrimaryParent, setDraftPrimaryParent] = useState("");

  // Relations
  const [relTo, setRelTo] = useState("");
  const [relType, setRelType] = useState("related");

  // Questions
  const [boundQuestions, setBoundQuestions] = useState<BoundQuestion[]>([]);
  const [boundSel, setBoundSel] = useState<Set<string>>(() => new Set());
  const [bankOpen, setBankOpen] = useState(false);
  const [bankItems, setBankItems] = useState<any[]>([]);
  const [bankNs, setBankNs] = useState("");
  const [bankQ, setBankQ] = useState("");
  const [bankSubject, setBankSubject] = useState("");
  const [bankType, setBankType] = useState("");
  const [bankSel, setBankSel] = useState<Set<string>>(() => new Set());

  // Files
  const [nodeFiles, setNodeFiles] = useState<NodeFileLink[]>([]);
  const [fileOpen, setFileOpen] = useState(false);
  const [fileQ, setFileQ] = useState("");
  const [fileList, setFileList] = useState<{ path: string; size: number }[]>([]);
  const [fileSel, setFileSel] = useState<Set<string>>(() => new Set());

  // Notes (separate from legacy description; persisted as `notes` on node)
  const [notesList, setNotesList] = useState<GraphNodeNoteRow[]>([]);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraftBody, setNoteDraftBody] = useState("");
  const noteTextAreaRef = useRef<HTMLTextAreaElement>(null);

  // Highlight ref for edge
  const edgeItemRef = useRef<HTMLLIElement | null>(null);

  // Populate edit state from selected node
  useEffect(() => {
    if (!selectedNode) {
      setBoundQuestions([]);
      setNodeFiles([]);
      setBoundSel(new Set());
      return;
    }
    setDraftName(selectedNode.canonical_name ?? "");
    setDraftSubject(selectedNode.subject ?? "");
    setDraftTags((selectedNode.tags ?? []).join(", "));
    setDraftAliases((selectedNode.aliases ?? []).join(", "));
    setDraftKind((selectedNode.node_kind as "concept" | "skill" | "causal") ?? "concept");
    setDraftPrimaryParent(selectedNode.primary_parent_id ?? "");
    setNotesList(
      (selectedNode.notes ?? []).map((n) => ({
        id: n.id,
        body: n.body ?? "",
        created_at: n.created_at,
      })),
    );
    setNoteComposerOpen(false);
    setNoteEditingId(null);
    setNoteDraftBody("");
  }, [selectedNode]);

  // Load questions & files when node selected
  useEffect(() => {
    if (!selectedNode) return;
    void (async () => {
      try {
        const [q, f] = await Promise.all([
          apiGraphListQuestionsForNode(selectedNode.id, activeSlug),
          apiGraphListNodeFiles(selectedNode.id, activeSlug),
        ]);
        setBoundQuestions(q.questions as BoundQuestion[]);
        setNodeFiles(f.links as NodeFileLink[]);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [selectedNode, activeSlug, onError]);

  // Scroll to highlighted edge
  useEffect(() => {
    if (highlightEdgeId && edgeItemRef.current) {
      edgeItemRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightEdgeId]);

  // File search
  useEffect(() => {
    if (!fileOpen) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await apiGraphListResourceFiles(fileQ, 600);
          setFileList(r.files ?? []);
        } catch { /* ignore */ }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fileOpen, fileQ]);

  const persistNotes = useCallback(async (next: GraphNodeNoteRow[]): Promise<boolean> => {
    if (!selectedNode) return false;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateNode(
        selectedNode.id,
        {
          id: selectedNode.id,
          canonical_name: (selectedNode.canonical_name ?? "").trim() || selectedNode.id,
          notes: next.map((n) => ({
            id: n.id,
            body: n.body,
            ...(n.created_at ? { created_at: n.created_at } : {}),
          })),
        },
        activeSlug,
      );
      setNotesList(next);
      onSaved();
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [selectedNode, activeSlug, onSaved, onError]);

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-xs text-slate-400">
        {t("pickNodeFirst")}
      </div>
    );
  }

  const relForSelected = relations.filter(
    (r) => r.from_node_id === selectedNode.id || r.to_node_id === selectedNode.id,
  );

  const relationTargetCandidates = graphNodes.filter((n) => {
    if (n.id === selectedNode.id) return false;
    const sk = selectedNode.node_kind ?? "concept";
    const nk = n.node_kind ?? "concept";
    return sk === "concept" || nk === "concept";
  });

  const saveEdits = async () => {
    if (!selectedNode) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateNode(
        selectedNode.id,
        {
          id: selectedNode.id,
          node_kind: draftKind,
          canonical_name: draftName.trim(),
          aliases: splitCsv(draftAliases),
          subject: draftSubject.trim() || null,
          level: (selectedNode.level ?? "").trim() || null,
          tags: splitCsv(draftTags),
          source: null,
          layout_x: selectedNode.layout_x ?? null,
          layout_y: selectedNode.layout_y ?? null,
          primary_parent_id: draftPrimaryParent.trim() || null,
          notes: notesList.map((n) => ({
            id: n.id,
            body: n.body,
            ...(n.created_at ? { created_at: n.created_at } : {}),
          })),
        },
        activeSlug,
      );
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteNode = async () => {
    if (!selectedNode) return;
    if (!window.confirm(t("confirmDeleteNode"))) return;
    setBusy(true);
    onError(null);
    try {
      if (onDeleteNode) {
        await onDeleteNode();
      } else {
        await apiGraphDeleteNode(selectedNode.id, activeSlug);
      }
      onDeleted();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addRelation = async () => {
    if (!relTo) {
      onError(t("errPickNodeRel"));
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiGraphCreateRelation(
        { from_node_id: selectedNode.id, to_node_id: relTo, relation_type: relType },
        activeSlug,
      );
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeRelation = async (rid: string) => {
    setBusy(true);
    onError(null);
    try {
      await apiGraphDeleteRelation(rid, activeSlug);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reverseRelation = async (rid: string) => {
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateRelation(rid, { reverse: true }, activeSlug);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeRelationType = async (rid: string, newType: string) => {
    setBusy(true);
    onError(null);
    try {
      await apiGraphUpdateRelation(rid, { relation_type: newType }, activeSlug);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openBank = async () => {
    setBankOpen(true);
    setBankSel(new Set());
    setBankSubject("");
    setBankType("");
    try {
      const r = await apiBankItems();
      setBankItems(r.items ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredBank = (() => {
    let xs = bankItems;
    if (bankNs.trim()) {
      const s = bankNs.trim().toLowerCase();
      xs = xs.filter((it) => String(it.namespace ?? "").toLowerCase().includes(s));
    }
    if (bankSubject.trim()) {
      const s = bankSubject.trim();
      xs = xs.filter((it) => String(it.subject ?? "") === s);
    }
    if (bankType.trim()) {
      const s = bankType.trim();
      xs = xs.filter((it) => String(it.type ?? "") === s);
    }
    if (bankQ.trim()) {
      const s = bankQ.trim().toLowerCase();
      xs = xs.filter(
        (it) =>
          String(it.qualified_id ?? "").toLowerCase().includes(s) ||
          String(it.content_preview ?? "").toLowerCase().includes(s),
      );
    }
    return xs;
  })();

  const bindSelectedQuestions = async () => {
    if (!selectedNode || bankSel.size === 0) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphBindBatch(selectedNode.id, Array.from(bankSel), activeSlug);
      setBankOpen(false);
      setBankSel(new Set());
      const q = await apiGraphListQuestionsForNode(selectedNode.id, activeSlug);
      setBoundQuestions(q.questions as BoundQuestion[]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unbindQ = async (qid: string) => {
    if (!selectedNode) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUnbindBinding({ question_qualified_id: qid, node_id: selectedNode.id }, activeSlug);
      const q = await apiGraphListQuestionsForNode(selectedNode.id, activeSlug);
      setBoundQuestions(q.questions as BoundQuestion[]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unbindSelectedBound = async () => {
    if (!selectedNode || boundSel.size === 0) return;
    setBusy(true);
    onError(null);
    try {
      await apiGraphUnbindBatch(selectedNode.id, Array.from(boundSel), activeSlug);
      setBoundSel(new Set());
      const q = await apiGraphListQuestionsForNode(selectedNode.id, activeSlug);
      setBoundQuestions(q.questions as BoundQuestion[]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const attachSelectedFiles = async () => {
    if (!selectedNode || fileSel.size === 0) return;
    setBusy(true);
    onError(null);
    try {
      for (const p of fileSel) {
        await apiGraphAttachFile({ node_id: selectedNode.id, relative_path: p }, activeSlug);
      }
      setFileOpen(false);
      const f = await apiGraphListNodeFiles(selectedNode.id, activeSlug);
      setNodeFiles(f.links as NodeFileLink[]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadAndAttach = async (file: File | null) => {
    if (!file || !selectedNode) return;
    setBusy(true);
    onError(null);
    try {
      const up = await apiGraphUploadMaterial(file);
      await apiGraphAttachFile({ node_id: selectedNode.id, relative_path: up.relative_path }, activeSlug);
      const f = await apiGraphListNodeFiles(selectedNode.id, activeSlug);
      setNodeFiles(f.links as NodeFileLink[]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const detachFile = async (linkId: string) => {
    setBusy(true);
    onError(null);
    try {
      await apiGraphDetachFile(linkId, activeSlug);
      if (selectedNode) {
        const f = await apiGraphListNodeFiles(selectedNode.id, activeSlug);
        setNodeFiles(f.links as NodeFileLink[]);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const TABS: { id: PanelTab; label: string }[] = [
    { id: "edit", label: t("panelTabEdit") },
    { id: "questions", label: t("panelTabQuestions") },
    { id: "files", label: t("panelTabFiles") },
    { id: "notes", label: t("panelTabNotes") },
  ];

  return (
    <aside className="flex h-full w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:w-[380px] lg:max-w-[380px] xl:w-[420px] xl:max-w-[420px]">
      {/* Panel header with tab switcher */}
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex gap-0.5">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                tab === tb.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => onTabChange(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={onClose}
        >
          {t("collapse")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* Tab 1: Node edit + Relations */}
        {tab === "edit" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0 text-[11px] font-medium text-slate-600">
                {t("canonicalName")}
                <input
                  className="mt-1 w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <label className="block min-w-0 text-[11px] font-medium text-slate-600">
                {t("nodeType")}
                <select
                  className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  value={draftKind}
                  onChange={(e) => setDraftKind(e.target.value as "concept" | "skill" | "causal")}
                >
                  <option value="concept">{t("nodeKind.concept")}</option>
                  <option value="skill">{t("nodeKind.skill")}</option>
                  <option value="causal">{t("nodeKind.causal")}</option>
                </select>
              </label>
            </div>

            <label className="block text-[11px] font-medium text-slate-600">
              {t("tags")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
              />
            </label>

            <label className="block text-[11px] font-medium text-slate-600">
              {t("aliases")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                value={draftAliases}
                onChange={(e) => setDraftAliases(e.target.value)}
              />
            </label>

            <label className="block text-[11px] font-medium text-slate-600">
              {t("primaryParent")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={draftPrimaryParent}
                onChange={(e) => setDraftPrimaryParent(e.target.value)}
              >
                <option value="">{t("notSelected")}</option>
                {graphNodes
                  .filter((n) => n.id !== selectedNode.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>{n.canonical_name}</option>
                  ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void saveEdits()}
              >
                {t("saveChanges")}
              </button>
              <button
                type="button"
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                disabled={busy}
                onClick={() => void deleteNode()}
              >
                {t("delete")}
              </button>
            </div>

            {/* Relations section */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <h3 className="text-xs font-semibold text-slate-700">{t("relations")}</h3>
              <div className="mt-2 grid gap-2">
                <label className="text-[11px] font-medium text-slate-600">
                  {t("targetNode")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    value={relTo}
                    onChange={(e) => setRelTo(e.target.value)}
                  >
                    <option value="">{t("selectEllipsis")}</option>
                    {relationTargetCandidates.map((n) => (
                      <option key={n.id} value={n.id}>{n.canonical_name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-medium text-slate-600">
                  {t("relationType")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    value={relType}
                    onChange={(e) => setRelType(e.target.value)}
                  >
                    {REL_KEYS.map((k) => (
                      <option key={k} value={k}>{t(`edgeKind.${k}`)}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="rounded-md bg-slate-900 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void addRelation()}
                >
                  {t("createRelation")}
                </button>
              </div>

              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
                {relForSelected.length === 0 ? (
                  <li className="text-slate-500">{t("noRelations")}</li>
                ) : (
                  relForSelected.map((r) => {
                    const isHighlighted = r.id === highlightEdgeId;
                    return (
                      <li
                        key={r.id}
                        ref={isHighlighted ? edgeItemRef : null}
                        className={cn(
                          "flex items-start justify-between gap-2 rounded border p-1.5",
                          isHighlighted
                            ? "border-blue-400 bg-blue-50"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <span
                            className="font-medium"
                            style={{ color: REL_COLOR[r.relation_type] ?? "#64748b" }}
                          >
                            {t(`edgeKind.${r.relation_type}`, { defaultValue: r.relation_type })}
                          </span>
                          <span className="mx-1 text-slate-400">·</span>
                          <span className="text-slate-700">
                            {r.from_node_id === selectedNode.id ? "→" : "←"}{" "}
                            {graphNodes.find((n) => n.id === (r.from_node_id === selectedNode.id ? r.to_node_id : r.from_node_id))?.canonical_name ?? (r.from_node_id === selectedNode.id ? r.to_node_id : r.from_node_id)}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <select
                            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                            value={r.relation_type}
                            disabled={busy}
                            onChange={(e) => void changeRelationType(r.id, e.target.value)}
                          >
                            {REL_KEYS.map((k) => (
                              <option key={k} value={k}>{t(`edgeKind.${k}`)}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                            title={t("reverseRelation")}
                            disabled={busy}
                            onClick={() => void reverseRelation(r.id)}
                          >
                            ⇄
                          </button>
                          <button
                            type="button"
                            className="text-[10px] text-red-600"
                            disabled={busy}
                            onClick={() => void removeRelation(r.id)}
                          >
                            {t("remove")}
                          </button>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Tab 2: Bound questions */}
        {tab === "questions" && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-700">{t("boundQuestions")}</h3>
            <button
              type="button"
              className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white"
              onClick={() => void openBank()}
            >
              {t("pickFromBank")}
            </button>
            {boundQuestions.length > 0 ? (
              <button
                type="button"
                className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50"
                disabled={busy || boundSel.size === 0}
                onClick={() => void unbindSelectedBound()}
              >
                {t("batchUnbind", { n: boundSel.size })}
              </button>
            ) : null}
            <ul className="space-y-1 text-xs">
              {boundQuestions.map((q) => (
                <li key={q.qualified_id} className="flex items-start gap-2 rounded border border-slate-200 bg-white p-1.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={boundSel.has(q.qualified_id)}
                    onChange={() => {
                      setBoundSel((prev) => {
                        const n = new Set(prev);
                        if (n.has(q.qualified_id)) n.delete(q.qualified_id);
                        else n.add(q.qualified_id);
                        return n;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px]">{q.qualified_id}</div>
                    {q.content_preview ? (
                      <div className="mt-0.5 block w-full min-w-0">
                        <KatexPlainPreview
                          text={q.content_preview}
                          className="line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                        />
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className="shrink-0 text-red-600" onClick={() => void unbindQ(q.qualified_id)}>
                    {t("unbind")}
                  </button>
                </li>
              ))}
              {boundQuestions.length === 0 ? <li className="text-slate-400">{t("noBoundQuestions")}</li> : null}
            </ul>

            {/* Bank picker modal */}
            {bankOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("pickQuestionTitle")}</h3>
                    <button type="button" className="text-sm text-slate-600" onClick={() => setBankOpen(false)}>{t("close")}</button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-[11px] font-medium text-slate-600">
                      {t("collectionFilter")}
                      <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={bankNs} onChange={(e) => setBankNs(e.target.value)} placeholder={t("collectionPh")} />
                    </label>
                    <label className="text-[11px] font-medium text-slate-600">
                      {t("subject")}
                      <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" value={bankSubject} onChange={(e) => setBankSubject(e.target.value)}>
                        <option value="">{t("all")}</option>
                        {[...new Set(bankItems.map((it) => String(it.subject ?? "").trim()).filter(Boolean))].sort((a, b) => localeCompareStrings(a, b)).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] font-medium text-slate-600">
                      {t("questionType")}
                      <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" value={bankType} onChange={(e) => setBankType(e.target.value)}>
                        <option value="">{t("all")}</option>
                        {QUESTION_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] font-medium text-slate-600">
                      {t("keyword")}
                      <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={bankQ} onChange={(e) => setBankQ(e.target.value)} placeholder={t("keywordPh")} />
                    </label>
                  </div>
                  <div className="mt-3 max-h-[40vh] overflow-auto rounded border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr>
                          <th className="p-2">{t("thPick")}</th>
                          <th className="p-2">{t("thQid")}</th>
                          <th className="p-2">{t("thType")}</th>
                          <th className="p-2">{t("thPreview")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBank.map((it) => (
                          <tr key={it.qualified_id} className="border-t border-slate-100">
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={bankSel.has(it.qualified_id)}
                                onChange={() => {
                                  setBankSel((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(it.qualified_id)) n.delete(it.qualified_id);
                                    else n.add(it.qualified_id);
                                    return n;
                                  });
                                }}
                              />
                            </td>
                            <td className="p-2 font-mono">{it.qualified_id}</td>
                            <td className="p-2">{it.type}</td>
                            <td className="max-w-xs p-2 align-top text-slate-600">
                              <KatexPlainPreview
                                text={String(it.content_preview ?? "")}
                                className="line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={() => setBankOpen(false)}>{t("cancel")}</button>
                    <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => void bindSelectedQuestions()}>{t("bindToNode")}</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 3: Bound files */}
        {tab === "files" && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-700">{t("boundFiles")}</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="flex-1 rounded-md bg-slate-900 py-2 text-sm font-medium text-white"
                onClick={() => setFileOpen(true)}
              >
                {t("pickProjectFile")}
              </button>
              <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900">
                {t("uploadAndLink")}
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => void uploadAndAttach(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <ul className="space-y-1 text-xs">
              {nodeFiles.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white p-1.5">
                  <a className="break-all text-blue-700 underline" href={resourceApiUrl(l.relative_path)} target="_blank" rel="noreferrer">
                    {l.relative_path}
                  </a>
                  <button type="button" className="shrink-0 text-red-600" onClick={() => void detachFile(l.id)}>
                    {t("remove")}
                  </button>
                </li>
              ))}
              {nodeFiles.length === 0 ? <li className="text-slate-400">{t("noFiles")}</li> : null}
            </ul>

            {/* File picker modal */}
            {fileOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("pickFileTitle")}</h3>
                    <button type="button" className="text-sm text-slate-600" onClick={() => setFileOpen(false)}>{t("close")}</button>
                  </div>
                  <label className="mt-3 block text-[11px] font-medium text-slate-600">
                    {t("searchPath")}
                    <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={fileQ} onChange={(e) => setFileQ(e.target.value)} placeholder={t("filterPh")} />
                  </label>
                  <ul className="mt-2 max-h-[45vh] space-y-0.5 overflow-auto text-xs">
                    {fileList.map((f) => (
                      <li key={f.path}>
                        <label className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-slate-50">
                          <input type="checkbox" checked={fileSel.has(f.path)} onChange={() => {
                            setFileSel((prev) => {
                              const n = new Set(prev);
                              if (n.has(f.path)) n.delete(f.path);
                              else n.add(f.path);
                              return n;
                            });
                          }} />
                          <span className="flex-1 break-all font-mono">{f.path}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={() => setFileOpen(false)}>{t("cancel")}</button>
                    <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => void attachSelectedFiles()}>{t("linkToNode")}</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 4: Notes */}
        {tab === "notes" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">{t("noteHint")}</p>
            {!noteComposerOpen ? (
              <button
                type="button"
                className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  setNoteEditingId(null);
                  setNoteDraftBody("");
                  setNoteComposerOpen(true);
                }}
              >
                {t("addNote")}
              </button>
            ) : (
              <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                {noteEditingId ? (
                  <p className="text-[11px] font-medium text-slate-600">{t("editNoteBanner")}</p>
                ) : null}
                <LatexRichTextField
                  textAreaRef={noteTextAreaRef}
                  syncTextAreaId={`graph-node-note-${selectedNode.id}-${noteEditingId ?? "new"}`}
                  minRows={4}
                  value={noteDraftBody}
                  onChange={setNoteDraftBody}
                  busy={busy}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void (async () => {
                      const next =
                        noteEditingId != null
                          ? notesList.map((n) =>
                              n.id === noteEditingId ? { ...n, body: noteDraftBody } : n,
                            )
                          : [...notesList, { id: crypto.randomUUID(), body: noteDraftBody }];
                      const ok = await persistNotes(next);
                      if (ok) {
                        setNoteComposerOpen(false);
                        setNoteEditingId(null);
                        setNoteDraftBody("");
                      }
                    })()}
                  >
                    {t("saveNote")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800"
                    disabled={busy}
                    onClick={() => {
                      setNoteComposerOpen(false);
                      setNoteEditingId(null);
                      setNoteDraftBody("");
                    }}
                  >
                    {t("cancelNote")}
                  </button>
                </div>
              </div>
            )}
            <ul className="space-y-2">
              {notesList.map((note) => (
                <li
                  key={note.id}
                  className="relative rounded-md border border-slate-200 bg-white p-2 pr-[4.25rem] text-sm"
                >
                  <div className="absolute right-1 top-1 flex items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      title={t("editNoteTitle")}
                      disabled={busy}
                      onClick={() => {
                        setNoteEditingId(note.id);
                        setNoteDraftBody(note.body);
                        setNoteComposerOpen(true);
                      }}
                      aria-label={t("editNoteTitle")}
                    >
                      {t("editNote")}
                    </button>
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] leading-none text-slate-500 hover:bg-slate-100 hover:text-red-600"
                      title={t("removeNoteTitle")}
                      disabled={busy}
                      onClick={() => void persistNotes(notesList.filter((n) => n.id !== note.id))}
                      aria-label={t("removeNoteTitle")}
                    >
                      ×
                    </button>
                  </div>
                  <ContentWithPrimeBrush text={note.body} className="text-slate-900" />
                </li>
              ))}
              {notesList.length === 0 && !noteComposerOpen ? (
                <li className="text-xs text-slate-400">{t("noNotesYet")}</li>
              ) : null}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

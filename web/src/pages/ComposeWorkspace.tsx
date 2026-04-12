import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../api/client";
import { KatexPlainPreview } from "../components/KatexText";
import { PdfPreview } from "../components/PdfPreview";
import { TexSetupNotice } from "../components/TexSetupNotice";
import { useAgentContext } from "../contexts/AgentContext";
import { useToolBar } from "../contexts/ToolBarContext";
import i18n from "../i18n/i18n";
import {
  collapseGroupRowsForList,
  clusterAdjacentGroupSlots,
  type SectionSlot,
} from "../lib/groupQuestions";
import { dispatchExamsChanged, SOLAIRE_EXAMS_CHANGED_EVENT, type ExamsChangedDetail } from "../lib/examEvents";
import { QUESTION_TYPE_OPTIONS } from "../lib/questionTypes";
import { cn } from "../lib/utils";
import { isTauriShell } from "../lib/tauriEnv";
import type { ExamDoc, ExamWorkspaceSummary, QuestionRow, RightSelection, TemplateRow } from "../types/compose";

type GraphBindingNode = { id: string; canonical_name: string; node_kind?: string };

/** 与后端 `_norm_template_path_rel` 一致：去掉 ``../``，与 ``/api/templates`` 列表匹配 */
function normTemplatePath(p: string): string {
  let s = p.replace(/\\/g, "/").trim();
  while (s.startsWith("../")) {
    s = s.slice(3);
  }
  return s.replace(/^\/+/, "");
}

export function ComposeWorkspace({ onError }: { onError: (s: string | null) => void }) {
  const { t } = useTranslation(["compose", "common", "lib"]);
  const { setPageContext } = useAgentContext();
  const { setToolBar, clearToolBar } = useToolBar();
  /** 用于右侧 PDF 的考试目录标识（``标签段/学科段``），与 ``GET /api/exams/{path}/pdf-file`` 一致 */
  const [pdfExamId, setPdfExamId] = useState<string | null>(null);
  const [pdfVariant, setPdfVariant] = useState<"student" | "teacher">("student");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [exportLabel, setExportLabel] = useState(() => i18n.t("defaultExamLabel", { ns: "compose" }));
  const [subject, setSubject] = useState(() => i18n.t("defaultSubject", { ns: "compose" }));
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [templatePath, setTemplatePath] = useState("");
  const [templateRef, setTemplateRef] = useState("");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [namespaceFilter, setNamespaceFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [composeFilterExpanded, setComposeFilterExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [bySection, setBySection] = useState<Record<string, string[]>>({});
  /** 左侧题库多选（qualified_id），顺序与列表一致；配合 Ctrl/⌘、Shift 桌面习惯 */
  const [selectedLeftIds, setSelectedLeftIds] = useState<string[]>([]);
  /** 用于 Shift+点击 范围选择的锚点（filteredQuestions 下标） */
  const [leftListAnchorIndex, setLeftListAnchorIndex] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<RightSelection | null>(null);
  /** 试卷栏 Shift 区间锚点（仅与 `section_id` 组合有效，不跨题型） */
  const [rightListAnchor, setRightListAnchor] = useState<{ sectionId: string; slotIndex: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [scoreBySection, setScoreBySection] = useState<Record<string, number | undefined>>({});
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, Record<string, number>>>({});
  const [perQuestionMode, setPerQuestionMode] = useState<Record<string, boolean>>({});
  const [currentExamId, setCurrentExamId] = useState<string | null>(null);
  /** 导出失败后服务端自动保存的考试工作区 id；下次导出成功时一并删除 */
  const [exportFailureExamIds, setExportFailureExamIds] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [examSummaries, setExamSummaries] = useState<ExamWorkspaceSummary[]>([]);
  const [conflictTargetId, setConflictTargetId] = useState<string | null>(null);
  /** 最近一次导出成功后的考试目录标识（用于在未打开侧栏项时仍可从右侧打开 PDF） */
  const [lastExportedExamId, setLastExportedExamId] = useState<string | null>(null);
  const [viewPdfBusy, setViewPdfBusy] = useState(false);
  /** 校验生成的临时预览会话 id（不入历史试卷） */
  const [previewPdfId, setPreviewPdfId] = useState<string | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [questionBindingsIndex, setQuestionBindingsIndex] = useState<Record<string, GraphBindingNode[]>>({});
  const [newPaperDialogOpen, setNewPaperDialogOpen] = useState(false);
  const [dlgExportLabel, setDlgExportLabel] = useState("");
  const [dlgSubject, setDlgSubject] = useState("");
  const [dlgTemplatePath, setDlgTemplatePath] = useState("");
  const [dlgMode, setDlgMode] = useState<"scratch" | "history">("scratch");
  /** 从历史复制时的源考试目录标识（须为已导出试卷的 ``exam_id``） */
  const [dlgHistorySourceExamId, setDlgHistorySourceExamId] = useState("");
  /** 从历史复制时的新考试标签（学科沿用源导出） */
  const [dlgHistoryExportLabel, setDlgHistoryExportLabel] = useState("");

  const currentExamIdRef = useRef<string | null>(null);
  currentExamIdRef.current = currentExamId;

  const openViewPdfExternally = useCallback(async () => {
    const id = pdfExamId ?? lastExportedExamId;
    if (!id) {
      return;
    }
    if (isTauriShell()) {
      setViewPdfBusy(true);
      try {
        await apiPost<{ ok?: boolean }>(`/api/exams/${encodeURIComponent(id)}/open-pdf`, {
          variant: pdfVariant,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        window.alert(errMsg);
      } finally {
        setViewPdfBusy(false);
      }
    } else {
      const url = `${window.location.origin}/api/exams/${encodeURIComponent(id)}/pdf-file?variant=${pdfVariant}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [pdfExamId, lastExportedExamId, pdfVariant]);

  const selectedTpl = useMemo(() => {
    const tp = normTemplatePath(templatePath);
    if (!tp) {
      return undefined;
    }
    return templates.find((t) => normTemplatePath(t.path) === tp);
  }, [templates, templatePath]);

  useEffect(() => {
    const parts: string[] = [];
    parts.push(t("compose:pageContext.subject", { v: subject.trim() || "—" }));
    if (templatePath) {
      const leaf = templatePath.includes("/") ? templatePath.split("/").pop() : templatePath;
      if (leaf) parts.push(t("compose:pageContext.template", { v: leaf }));
    }
    if (exportLabel.trim()) parts.push(t("compose:pageContext.exportLabel", { v: exportLabel.trim() }));
    setPageContext({
      current_page: "compose",
      summary: parts.length ? parts.join("；") : t("compose:pageContext.default"),
    });
    return () => setPageContext(null);
  }, [subject, templatePath, exportLabel, setPageContext, t]);

  const questionsForSubject = useMemo(() => {
    const s = subject.trim();
    return questions.filter((q) => (q.subject ?? "") === s);
  }, [questions, subject]);

  /** 题库目录导出的 subjects 可能不含当前试卷学科；必须把 exam 中的学科并入选项，否则 select 无匹配项、界面表现为未切到该学科 */
  const subjectOptionsForSelect = useMemo(() => {
    const base = subjectOptions.length > 0 ? subjectOptions : [];
    const merged = new Set<string>(base);
    const cur = subject.trim();
    if (cur) {
      merged.add(cur);
    }
    const dlg = dlgSubject.trim();
    if (dlg) {
      merged.add(dlg);
    }
    const arr = [...merged];
    arr.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    if (arr.length > 0) {
      return arr;
    }
    return cur ? [cur] : dlg ? [dlg] : [];
  }, [subjectOptions, subject, dlgSubject]);

  const namespaces = useMemo(() => {
    const s = new Set<string>();
    for (const q of questionsForSubject) {
      s.add(q.collection ?? q.namespace);
    }
    return [...s].sort();
  }, [questionsForSubject]);

  const filteredQuestions = useMemo(() => {
    const ns = namespaceFilter === "__all__" ? null : namespaceFilter;
    const qlow = search.trim().toLowerCase();
    const collapsed = collapseGroupRowsForList(questionsForSubject);
    return collapsed.filter((q) => {
      const coll = q.collection ?? q.namespace;
      if (ns && coll !== ns) {
        return false;
      }
      if (typeFilter !== "__all__" && q.type !== typeFilter) {
        return false;
      }
      if (!qlow) {
        return true;
      }
      const gid = (q.group_id ?? "").toLowerCase();
      const gmat = (q.group_material ?? "").toLowerCase();
      return (
        q.id.toLowerCase().includes(qlow) ||
        q.qualified_id.toLowerCase().includes(qlow) ||
        q.content_preview.toLowerCase().includes(qlow) ||
        q.type.toLowerCase().includes(qlow) ||
        (gid && gid.includes(qlow)) ||
        (gmat && gmat.includes(qlow))
      );
    });
  }, [questionsForSubject, namespaceFilter, typeFilter, search]);

  const selectedLeftIdsSet = useMemo(() => new Set(selectedLeftIds), [selectedLeftIds]);

  useEffect(() => {
    const allowed = new Set(filteredQuestions.map((q) => q.qualified_id));
    setSelectedLeftIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [filteredQuestions]);

  useEffect(() => {
    let cancelled = false;
    onError(null);
    void Promise.all([
      apiGet<{ templates: TemplateRow[] }>("/api/templates"),
      apiGet<{ questions: QuestionRow[] }>("/api/questions"),
      apiGet<{ subjects: string[] }>("/api/bank/subjects"),
    ])
      .then(([t, q, subs]) => {
        if (cancelled) {
          return;
        }
        setTemplates(t.templates);
        setQuestions(q.questions);
        const list = subs.subjects.length ? subs.subjects : [...new Set(q.questions.map((x) => x.subject).filter(Boolean) as string[])];
        setSubjectOptions(list);
        /** 若用户已先打开某套考试工作区，勿覆盖学科与模板（避免慢请求晚于侧栏加载而冲掉 exam.yaml） */
        if (!currentExamIdRef.current) {
          setSubject((prev) => {
            const p = prev.trim();
            if (list.length && !list.includes(p)) {
              return list[0] ?? prev;
            }
            return prev;
          });
        }
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  /** 首屏默认模板：仅在尚未关联考试且未选模板时写入，避免与 loadExamById / applyExamDocument 竞态 */
  useEffect(() => {
    if (templates.length === 0) {
      return;
    }
    if (currentExamId) {
      return;
    }
    if (templatePath.trim()) {
      return;
    }
    const first = templates[0];
    if (!first) {
      return;
    }
    setTemplatePath(first.path);
    setTemplateRef(first.id);
    const init: Record<string, string[]> = {};
    for (const s of first.sections) {
      init[s.section_id] = [];
    }
    setBySection(init);
    setActiveSection(first.sections[0]?.section_id ?? null);
  }, [templates, currentExamId, templatePath]);

  useEffect(() => {
    setNamespaceFilter("__all__");
    setTypeFilter("__all__");
  }, [subject]);

  useEffect(() => {
    const t = selectedTpl;
    if (!t) {
      return;
    }
    setTemplateRef(t.id);
    setBySection((prev) => {
      const next: Record<string, string[]> = {};
      for (const s of t.sections) {
        next[s.section_id] = prev[s.section_id] ?? [];
      }
      return next;
    });
    const sectionIds = new Set(t.sections.map((s) => s.section_id));
    setActiveSection((prev) => {
      if (prev && sectionIds.has(prev)) {
        return prev;
      }
      return t.sections[0]?.section_id ?? null;
    });
  }, [templatePath, selectedTpl]);

  useEffect(() => {
    const t = selectedTpl;
    if (!t) {
      return;
    }
    setScoreBySection((prev) => {
      const next: Record<string, number | undefined> = {};
      for (const s of t.sections) {
        next[s.section_id] = prev[s.section_id];
      }
      return next;
    });
    setScoreOverrides((prev) => {
      const next: Record<string, Record<string, number>> = {};
      for (const s of t.sections) {
        if (prev[s.section_id]) {
          next[s.section_id] = { ...prev[s.section_id] };
        }
      }
      return next;
    });
    setPerQuestionMode((prev) => {
      const next: Record<string, boolean> = {};
      for (const s of t.sections) {
        if (prev[s.section_id]) {
          next[s.section_id] = prev[s.section_id]!;
        }
      }
      return next;
    });
  }, [selectedTpl]);

  const refreshExamSummaries = useCallback(async () => {
    try {
      const r = await apiGet<{ exams: ExamWorkspaceSummary[] }>("/api/exams");
      setExamSummaries(r.exams ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshExamSummaries();
  }, [refreshExamSummaries]);

  useEffect(() => {
    const onExamsChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<ExamsChangedDetail>).detail ?? {};
      void refreshExamSummaries();
      const examId = detail.examId;
      if (!examId) {
        return;
      }
      if (currentExamIdRef.current === examId) {
        setCurrentExamId(null);
        setDraftName("");
        setPdfExamId(null);
        setPreviewPdfId(null);
      }
      setLastExportedExamId((prev) => (prev === examId ? null : prev));
      setPdfExamId((prev) => (prev === examId ? null : prev));
      setDlgHistorySourceExamId((prev) => (prev === examId ? "" : prev));
      setExportFailureExamIds((prev) => prev.filter((x) => x !== examId));
      setConflictTargetId((prev) => (prev === examId ? null : prev));
      onError(null);
    };
    window.addEventListener(SOLAIRE_EXAMS_CHANGED_EVENT, onExamsChanged);
    return () => window.removeEventListener(SOLAIRE_EXAMS_CHANGED_EVENT, onExamsChanged);
  }, [refreshExamSummaries, onError]);

  useEffect(() => {
    void apiGet<{ index: Record<string, GraphBindingNode[]> }>("/api/graph/question-bindings-index")
      .then((r) => setQuestionBindingsIndex(r.index ?? {}))
      .catch(() => setQuestionBindingsIndex({}));
  }, []);

  const knowledgeDistributionRows = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const ids of Object.values(bySection)) {
      for (const qid of ids) {
        const nodes = questionBindingsIndex[qid] ?? [];
        if (nodes.length === 0) {
          unassigned += 1;
        } else {
          for (const n of nodes) {
            const name = (n.canonical_name || n.id).trim() || n.id;
            counts.set(name, (counts.get(name) ?? 0) + 1);
          }
        }
      }
    }
    const rows: [string, number][] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (unassigned > 0) {
      rows.push(["__unassigned__", unassigned]);
    }
    return rows.slice(0, 14);
  }, [bySection, questionBindingsIndex]);

  const countsOk = useMemo(() => {
    if (!selectedTpl) {
      return false;
    }
    return selectedTpl.sections.every((s) => {
      if (s.type === "text") {
        return true;
      }
      return (bySection[s.section_id]?.length ?? 0) === s.required_count;
    });
  }, [selectedTpl, bySection]);

  const totalScore = useMemo(() => {
    if (!selectedTpl) {
      return 0;
    }
    let t = 0;
    for (const s of selectedTpl.sections) {
      if (s.type === "text") {
        continue;
      }
      const ids = bySection[s.section_id] ?? [];
      const base = scoreBySection[s.section_id] ?? s.score_per_item;
      const ov = scoreOverrides[s.section_id] ?? {};
      for (const qid of ids) {
        t += ov[qid] !== undefined ? ov[qid]! : base;
      }
    }
    return Math.round(t * 1000) / 1000;
  }, [selectedTpl, bySection, scoreBySection, scoreOverrides]);

  const questionMap = useMemo(() => {
    const m = new Map<string, QuestionRow>();
    for (const q of questions) {
      m.set(q.qualified_id, q);
    }
    return m;
  }, [questions]);

  const handleLeftBankClick = useCallback(
    (q: QuestionRow, index: number, e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (e.shiftKey) {
        const anchor = leftListAnchorIndex ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const range = filteredQuestions.slice(start, end + 1).map((x) => x.qualified_id);
        setSelectedLeftIds(range);
        setLeftListAnchorIndex(index);
        setSelectedRight(null);
        setRightListAnchor(null);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        setSelectedLeftIds((prev) => {
          if (prev.includes(q.qualified_id)) {
            return prev.filter((id) => id !== q.qualified_id);
          }
          return [...prev, q.qualified_id];
        });
        setLeftListAnchorIndex(index);
        setSelectedRight(null);
        setRightListAnchor(null);
        return;
      }
      setSelectedLeftIds([q.qualified_id]);
      setLeftListAnchorIndex(index);
      setSelectedRight(null);
      setRightListAnchor(null);
    },
    [filteredQuestions, leftListAnchorIndex],
  );

  const handleRightPaperSlotClick = useCallback(
    (
      sectionId: string,
      slots: SectionSlot<QuestionRow>[],
      slotIndex: number,
      slot: SectionSlot<QuestionRow>,
      e: MouseEvent<HTMLButtonElement>,
    ) => {
      e.preventDefault();
      const slotIds = slot.kind === "single" ? [slot.qid] : [...slot.qids];
      const sectionQids = bySection[sectionId] ?? [];
      const mergeOrder = (ids: Set<string>) => sectionQids.filter((id) => ids.has(id));

      if (e.shiftKey) {
        if (rightListAnchor && rightListAnchor.sectionId !== sectionId) {
          setSelectedRight({ sectionId, qids: slotIds });
          setRightListAnchor({ sectionId, slotIndex });
          setSelectedLeftIds(slotIds);
          return;
        }
        const anchorSlot =
          rightListAnchor && rightListAnchor.sectionId === sectionId ? rightListAnchor.slotIndex : slotIndex;
        const start = Math.min(anchorSlot, slotIndex);
        const end = Math.max(anchorSlot, slotIndex);
        const ordered: string[] = [];
        for (let i = start; i <= end; i++) {
          const sl = slots[i];
          if (!sl) {
            continue;
          }
          if (sl.kind === "single") {
            ordered.push(sl.qid);
          } else {
            ordered.push(...sl.qids);
          }
        }
        setSelectedRight({ sectionId, qids: ordered });
        setRightListAnchor({ sectionId, slotIndex });
        setSelectedLeftIds(ordered);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if (selectedRight?.sectionId !== sectionId) {
          setSelectedRight({ sectionId, qids: slotIds });
          setRightListAnchor({ sectionId, slotIndex });
          setSelectedLeftIds(slotIds);
          return;
        }
        const cur = new Set(selectedRight.qids);
        const allIn = slotIds.every((id) => cur.has(id));
        if (allIn) {
          slotIds.forEach((id) => cur.delete(id));
        } else {
          slotIds.forEach((id) => cur.add(id));
        }
        const nextOrdered = mergeOrder(cur);
        setSelectedRight(nextOrdered.length ? { sectionId, qids: nextOrdered } : null);
        setRightListAnchor({ sectionId, slotIndex });
        setSelectedLeftIds(nextOrdered);
        return;
      }
      setSelectedRight({ sectionId, qids: slotIds });
      setRightListAnchor({ sectionId, slotIndex });
      setSelectedLeftIds(slotIds);
    },
    [bySection, rightListAnchor, selectedRight],
  );

  const dlgSelectedPastExam = useMemo(
    () => examSummaries.find((ex) => ex.exam_id === dlgHistorySourceExamId),
    [examSummaries, dlgHistorySourceExamId],
  );

  const draftExamRows = useMemo(
    () => examSummaries.filter((e) => (e.status ?? "draft") !== "exported"),
    [examSummaries],
  );
  const exportedExamRows = useMemo(
    () => examSummaries.filter((e) => e.status === "exported"),
    [examSummaries],
  );

  const buildSelectedItemsForApi = useCallback(() => {
    if (!selectedTpl) {
      return [];
    }
    return selectedTpl.sections.map((s) => {
      const def = s.score_per_item;
      const spi = scoreBySection[s.section_id];
      const score_per_item = spi !== undefined && spi !== def ? spi : null;
      const rawOv = scoreOverrides[s.section_id];
      const score_overrides =
        rawOv && Object.keys(rawOv).length > 0 ? { ...rawOv } : null;
      return {
        section_id: s.section_id,
        question_ids: bySection[s.section_id] ?? [],
        score_per_item,
        score_overrides,
      };
    });
  }, [selectedTpl, bySection, scoreBySection, scoreOverrides]);

  const applyExamDocument = useCallback((doc: ExamDoc) => {
    setPreviewPdfId(null);
    setPreviewWarnings([]);
    setExportLabel(String(doc.export_label ?? ""));
    setSubject(String(doc.subject ?? ""));
    const tp = normTemplatePath(String(doc.template_path ?? ""));
    if (tp) {
      setTemplatePath(tp);
    }
    setTemplateRef(String(doc.template_ref ?? ""));
    const eid = String(doc.exam_id ?? "").trim();
    /** 同步 ref，避免首屏 subjects 请求的 `.then` 在 React 提交前读到陈旧 ref 而覆盖学科 */
    currentExamIdRef.current = eid || null;
    setCurrentExamId(eid || null);
    setDraftName(String(doc.name ?? ""));
    const items = doc.selected_items ?? [];
    const by: Record<string, string[]> = {};
    const sc: Record<string, number | undefined> = {};
    const ov: Record<string, Record<string, number>> = {};
    const perQ: Record<string, boolean> = {};
    for (const it of items) {
      by[it.section_id] = [...(it.question_ids ?? [])];
      if (it.score_per_item !== undefined && it.score_per_item !== null) {
        sc[it.section_id] = Number(it.score_per_item);
      }
      if (it.score_overrides && Object.keys(it.score_overrides).length > 0) {
        ov[it.section_id] = { ...it.score_overrides };
        perQ[it.section_id] = true;
      }
    }
    setBySection(by);
    setScoreBySection(sc);
    setScoreOverrides(ov);
    setPerQuestionMode(perQ);
    setSelectedLeftIds([]);
    setLeftListAnchorIndex(null);
    setSelectedRight(null);
    setRightListAnchor(null);
  }, []);

  function addFromLeft() {
    if (!selectedTpl || !activeSection || selectedLeftIds.length === 0) {
      onError(t("compose:errors.selectQuestionFirst"));
      return;
    }
    const sec = selectedTpl.sections.find((s) => s.section_id === activeSection);
    if (!sec) {
      onError(t("compose:errors.sectionNotFound"));
      return;
    }
    if (sec.type === "text") {
      onError(t("compose:errors.textSectionNoPick"));
      return;
    }
    const compatible = selectedLeftIds.filter((qid) => {
      const row = questionMap.get(qid);
      return row && row.type === sec.type;
    });
    const skippedType = selectedLeftIds.length - compatible.length;
    if (compatible.length === 0) {
      const first = questionMap.get(selectedLeftIds[0]);
      onError(t("compose:errors.typeMismatch", { need: sec.type, got: first?.type ?? "?" }));
      return;
    }
    const cur = bySection[activeSection] ?? [];
    const newIds = compatible.filter((id) => !cur.includes(id));
    if (newIds.length === 0) {
      return;
    }
    if (cur.length + newIds.length > sec.required_count) {
      onError(t("compose:errors.sectionFull"));
      return;
    }
    onError(null);
    setBySection((prev) => ({
      ...prev,
      [activeSection]: [...(prev[activeSection] ?? []), ...newIds],
    }));
    if (skippedType > 0) {
      setMsg(t("compose:messages.multiAddSkipped", { n: skippedType }));
    }
  }

  function removeFromRight() {
    if (!selectedRight || selectedRight.qids.length === 0) {
      onError(t("compose:errors.selectPaperItemFirst"));
      return;
    }
    const removeIds = selectedRight.qids;
    const secId = selectedRight.sectionId;
    onError(null);
    setBySection((prev) => ({
      ...prev,
      [secId]: (prev[secId] ?? []).filter((x) => !removeIds.includes(x)),
    }));
    setScoreOverrides((prev) => {
      const so = prev[secId];
      if (!so) {
        return prev;
      }
      const next = { ...so };
      for (const id of removeIds) {
        delete next[id];
      }
      const out = { ...prev };
      if (Object.keys(next).length === 0) {
        delete out[secId];
      } else {
        out[secId] = next;
      }
      return out;
    });
    setSelectedRight(null);
    setRightListAnchor(null);
  }

  async function validate() {
    if (!selectedTpl) {
      return;
    }
    onError(null);
    setBusy(true);
    setPreviewWarnings([]);
    try {
      const selected_items = buildSelectedItemsForApi();
      const res = await apiPost<{
        ok: boolean;
        preview_id: string;
        warnings?: string[];
      }>("/api/exam/preview-pdf", {
        export_label: exportLabel.trim() || t("compose:previewDefaultLabel"),
        subject: subject.trim() || t("compose:previewDefaultSubject"),
        metadata_title: exportLabel.trim() || t("compose:previewDefaultLabel"),
        template_ref: templateRef,
        template_path: templatePath,
        selected_items,
      });
      setPreviewPdfId(res.preview_id);
      const w = res.warnings ?? [];
      setPreviewWarnings(w);
      setMsg(
        w.length > 0
          ? t("compose:messages.previewPdfReadyWithWarnings", { n: w.length })
          : t("compose:messages.previewPdfReady"),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmNewPaperDialog() {
    onError(null);
    if (dlgMode === "history") {
      if (!dlgHistorySourceExamId.trim()) {
        onError(t("compose:errors.pickHistoryExam"));
        return;
      }
      if (!dlgHistoryExportLabel.trim()) {
        onError(t("compose:errors.historyExamLabelRequired"));
        return;
      }
      setBusy(true);
      try {
        const r = await apiPost<{ exam: ExamDoc }>(
          `/api/exams/from-exam/${encodeURIComponent(dlgHistorySourceExamId.trim())}`,
          { export_label: dlgHistoryExportLabel.trim() },
        );
        applyExamDocument(r.exam);
        setPdfExamId(null);
        setNewPaperDialogOpen(false);
        const eid = String(r.exam.exam_id ?? "").trim();
        setMsg(
          eid
            ? t("compose:messages.draftLoadedWithPath", { path: `exams/${eid.replace(/\\/g, "/")}` })
            : t("compose:messages.draftLoaded"),
        );
        void refreshExamSummaries();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    const tpl = templates.find((x) => normTemplatePath(x.path) === normTemplatePath(dlgTemplatePath));
    if (!tpl) {
      onError(t("compose:errors.selectTemplateForDraft"));
      return;
    }
    if (!dlgExportLabel.trim() || !dlgSubject.trim()) {
      onError(t("compose:errors.examLabelAndSubjectRequired"));
      return;
    }
    setBusy(true);
    try {
      const selected_items = tpl.sections.map((s) => ({
        section_id: s.section_id,
        question_ids: [] as string[],
        score_per_item: null as number | null,
        score_overrides: null as Record<string, number> | null,
      }));
      const r = await apiPost<{ exam: ExamDoc }>("/api/exams", {
        name: undefined,
        export_label: dlgExportLabel.trim(),
        subject: dlgSubject.trim(),
        template_ref: tpl.id,
        template_path: tpl.path,
        selected_items,
      });
      applyExamDocument(r.exam);
      setPdfExamId(null);
      setNewPaperDialogOpen(false);
      const eid = String(r.exam.exam_id ?? "").trim();
      setMsg(
        eid
          ? t("compose:messages.draftSavedWithPath", { path: `exams/${eid.replace(/\\/g, "/")}` })
          : t("compose:messages.draftSaved"),
      );
      void refreshExamSummaries();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runExport(
    overwriteExisting: string | null,
    examIdToDeleteAfterSuccess: string | null,
    failureExamIdsToDeleteAfterSuccess: string[],
    examWorkspaceIdForExport: string | null,
  ) {
    if (!selectedTpl) {
      return;
    }
    const selected_items = buildSelectedItemsForApi();
    const idsToDelete = [
      ...new Set(
        [
          ...(examIdToDeleteAfterSuccess ? [examIdToDeleteAfterSuccess] : []),
          ...failureExamIdsToDeleteAfterSuccess,
        ].filter(Boolean),
      ),
    ];
    const res = await apiPost<{
      ok: boolean;
      exam_dir: string;
      student_pdf: string;
      teacher_pdf: string;
    }>("/api/exam/export", {
      export_label: exportLabel.trim(),
      subject: subject.trim(),
      metadata_title: exportLabel.trim(),
      template_ref: templateRef,
      template_path: templatePath,
      selected_items,
      overwrite_existing: overwriteExisting ?? undefined,
      ...(examWorkspaceIdForExport ? { exam_workspace_id: examWorkspaceIdForExport } : {}),
      ...(idsToDelete.length ? { exam_ids_to_delete_on_success: idsToDelete } : {}),
    });
    const dirNorm = res.exam_dir.replace(/\\/g, "/").replace(/^\/+/, "");
    const m = /^exams\/(.+)$/.exec(dirNorm);
    const examPathId = m ? m[1]! : null;
    setLastExportedExamId(examPathId);
    if (examPathId) {
      setPdfExamId(examPathId);
      setPdfVariant("student");
    }
    let successText = t("compose:messages.exportOk", {
      student: res.student_pdf,
      teacher: res.teacher_pdf,
      dir: res.exam_dir,
    });
    if (idsToDelete.length) {
      setCurrentExamId((cur) => (cur && idsToDelete.includes(cur) ? null : cur));
      setExportFailureExamIds([]);
      successText += t("compose:messages.draftRemovedAfterExport");
    }
    setMsg(successText);
    void refreshExamSummaries();
  }

  async function exportExam() {
    if (!selectedTpl) {
      return;
    }
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      const check = await apiPost<{
        conflict: boolean;
        existing_exam_id: string | null;
      }>("/api/exam/export/check-conflict", {
        export_label: exportLabel.trim(),
        subject: subject.trim(),
      });
      if (check.conflict && check.existing_exam_id) {
        setConflictTargetId(check.existing_exam_id);
        setBusy(false);
        return;
      }
      const examIdSnapshot = currentExamId;
      const hasWorkspace = Boolean(examIdSnapshot);
      await runExport(
        null,
        hasWorkspace ? null : examIdSnapshot,
        exportFailureExamIds,
        hasWorkspace ? examIdSnapshot : null,
      );
    } catch (e) {
      if (e instanceof ApiError && e.examSaved) {
        setExportFailureExamIds((prev) => [...new Set([...prev, e.examSaved!.exam_id])]);
        void refreshExamSummaries();
        onError(
          t("compose:errors.exportWithDraftSaved", { name: e.examSaved.name, detail: e.message }),
        );
      } else {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmOverwriteExport() {
    if (!selectedTpl || !conflictTargetId) {
      return;
    }
    const overwriteId = conflictTargetId;
    const examIdSnapshot = currentExamId;
    setConflictTargetId(null);
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      const hasWorkspace = Boolean(examIdSnapshot);
      await runExport(
        overwriteId,
        hasWorkspace ? null : examIdSnapshot,
        exportFailureExamIds,
        hasWorkspace ? examIdSnapshot : null,
      );
    } catch (e) {
      if (e instanceof ApiError && e.examSaved) {
        setExportFailureExamIds((prev) => [...new Set([...prev, e.examSaved!.exam_id])]);
        void refreshExamSummaries();
        onError(
          t("compose:errors.exportWithDraftSaved", { name: e.examSaved.name, detail: e.message }),
        );
      } else {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const saveDraftToServer = useCallback(async () => {
    if (!selectedTpl || !templatePath.trim()) {
      onError(t("compose:errors.selectTemplateForDraft"));
      return;
    }
    onError(null);
    setBusy(true);
    try {
      const selected_items = buildSelectedItemsForApi();
      const body = {
        name: draftName.trim() || undefined,
        subject: subject.trim(),
        export_label: exportLabel.trim(),
        template_ref: templateRef,
        template_path: templatePath,
        selected_items,
      };
      if (currentExamId) {
        const r = await apiPut<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(currentExamId)}`, {
          ...body,
        });
        applyExamDocument(r.exam);
        setMsg(t("compose:messages.draftUpdated"));
      } else {
        const r = await apiPost<{ exam: ExamDoc }>("/api/exams", body);
        applyExamDocument(r.exam);
        const eid = String(r.exam.exam_id ?? "").trim();
        setMsg(
          eid
            ? t("compose:messages.draftSavedWithPath", { path: `exams/${eid.replace(/\\/g, "/")}` })
            : t("compose:messages.draftSaved"),
        );
      }
      void refreshExamSummaries();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    applyExamDocument,
    buildSelectedItemsForApi,
    currentExamId,
    draftName,
    exportLabel,
    onError,
    refreshExamSummaries,
    selectedTpl,
    subject,
    t,
    templatePath,
    templateRef,
  ]);

  async function deleteExamById(examId: string, opts?: { exported?: boolean }) {
    const ok = opts?.exported
      ? window.confirm(t("compose:messages.confirmDeleteExportedExam"))
      : window.confirm(t("compose:messages.confirmDeleteDraft"));
    if (!ok) {
      return;
    }
    onError(null);
    setBusy(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/exams/${encodeURIComponent(examId)}`);
      if (currentExamId === examId) {
        setCurrentExamId(null);
        setDraftName("");
        setPdfExamId(null);
        setPreviewPdfId(null);
      }
      setLastExportedExamId((prev) => (prev === examId ? null : prev));
      setPdfExamId((prev) => (prev === examId ? null : prev));
      setMsg(opts?.exported ? t("compose:messages.exportedExamDeleted") : t("compose:messages.draftDeleted"));
      void refreshExamSummaries();
      dispatchExamsChanged({ examId });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadExamById(examId: string, pdfForViewer: string | null) {
    onError(null);
    setBusy(true);
    try {
      const r = await apiGet<{ exam: ExamDoc }>(`/api/exams/${encodeURIComponent(examId)}`);
      applyExamDocument(r.exam);
      setNamespaceFilter("__all__");
      setTypeFilter("__all__");
      setSearch("");
      setComposeFilterExpanded(false);
      const items = r.exam.selected_items ?? [];
      const firstSec = items[0]?.section_id;
      if (firstSec) {
        setActiveSection(firstSec);
      }
      setPreviewPdfId(null);
      setPdfExamId(pdfForViewer);
      setPdfVariant("student");
      setMsg(t("compose:messages.draftLoaded"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const left: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setDlgExportLabel(exportLabel.trim() || i18n.t("defaultExamLabel", { ns: "compose" }));
            setDlgSubject(subject.trim());
            setDlgTemplatePath(templatePath || templates[0]?.path || "");
            setDlgMode("scratch");
            setDlgHistorySourceExamId(exportedExamRows[0]?.exam_id ?? "");
            setDlgHistoryExportLabel("");
            setNewPaperDialogOpen(true);
          }}
        >
          {t("compose:newPaper")}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          disabled={busy || !selectedTpl || !templatePath.trim()}
          onClick={() => void saveDraftToServer()}
        >
          {t("compose:saveChanges")}
        </button>
      </div>
    );
    const right: ReactNode = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
          disabled={busy || !selectedTpl}
          onClick={() => void validate()}
        >
          {t("compose:validatePreview")}
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          disabled={busy || !countsOk}
          onClick={() => void exportExam()}
        >
          {t("compose:exportPdf")}
        </button>
      </div>
    );
    setToolBar({ left, right });
    return () => clearToolBar();
  }, [
    t,
    busy,
    selectedTpl,
    countsOk,
    templatePath,
    saveDraftToServer,
    setToolBar,
    clearToolBar,
    exportLabel,
    subject,
    templates,
    exportedExamRows,
  ]);

  const pdfApiPath =
    pdfExamId != null
      ? `/api/exams/${encodeURIComponent(pdfExamId)}/pdf-file?variant=${pdfVariant}`
      : null;

  const previewSessionPdfPath =
    previewPdfId != null
      ? `/api/exam/preview-pdf/${encodeURIComponent(previewPdfId)}/file?variant=${pdfVariant}`
      : null;

  /** 右侧 PDF：优先显示校验预览；否则显示所选历史导出试卷 */
  const composeRightPdfPath = previewSessionPdfPath ?? pdfApiPath;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {newPaperDialogOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-paper-dialog-title"
        >
          <div className="max-w-lg w-full rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="new-paper-dialog-title" className="text-base font-semibold text-slate-900">
              {t("compose:newPaperDialogTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t("compose:newPaperDialogHint")}</p>
            <div className="mt-4 flex gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="np-mode"
                  checked={dlgMode === "scratch"}
                  onChange={() => setDlgMode("scratch")}
                />
                {t("compose:newPaperModeScratch")}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="np-mode"
                  checked={dlgMode === "history"}
                  onChange={() => setDlgMode("history")}
                />
                {t("compose:newPaperModeHistory")}
              </label>
            </div>
            {dlgMode === "history" ? (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:newPaperPickHistory")}
                  <select
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgHistorySourceExamId}
                    onChange={(e) => setDlgHistorySourceExamId(e.target.value)}
                  >
                    <option value="">{t("compose:newPaperPickHistoryPlaceholder")}</option>
                    {exportedExamRows.map((ex) => (
                        <option key={ex.exam_id} value={ex.exam_id}>
                          {ex.export_label || ex.name || ex.exam_id}
                          {ex.subject ? ` · ${ex.subject}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:examLabel")}
                  <input
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgHistoryExportLabel}
                    onChange={(e) => setDlgHistoryExportLabel(e.target.value)}
                    placeholder={t("compose:newPaperHistoryExamLabelPlaceholder")}
                    autoComplete="off"
                  />
                </label>
                <div className="mt-4">
                  <div className="text-xs font-medium text-slate-600">
                    {t("compose:subjectFromHistoryReadonly")}
                  </div>
                  <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-800">
                    {dlgSelectedPastExam?.subject?.trim() || "—"}
                  </div>
                </div>
              </>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:examLabel")}
                  <input
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgExportLabel}
                    onChange={(e) => setDlgExportLabel(e.target.value)}
                  />
                </label>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:subjectPdf")}
                  <select
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgSubject}
                    onChange={(e) => setDlgSubject(e.target.value)}
                  >
                    {subjectOptionsForSelect.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-4 block text-xs font-medium text-slate-600">
                  {t("compose:template")}
                  <select
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={dlgTemplatePath}
                    onChange={(e) => setDlgTemplatePath(e.target.value)}
                  >
                    {templates.map((tp) => (
                      <option key={tp.path} value={tp.path}>
                        {tp.id}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                disabled={busy}
                onClick={() => setNewPaperDialogOpen(false)}
              >
                {t("common:cancel")}
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={busy}
                onClick={() => void confirmNewPaperDialog()}
              >
                {t("compose:newPaperDialogConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <TexSetupNotice onError={onError} />
      {msg ? (
        <div
          className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800"
          role="status"
        >
          {msg}
        </div>
      ) : null}
      {previewWarnings.length > 0 ? (
        <div
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          role="status"
        >
          <p className="font-medium">{t("compose:previewWarningsTitle")}</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {previewWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {busy ? (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600" aria-live="polite">
          {t("common:processing")}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-row">
        <aside className="flex w-[min(100%,140px)] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
          <div className="shrink-0 border-b border-slate-200 bg-white px-2 py-2">
            <h2 className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
              {t("compose:historySidebarTitle")}
            </h2>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
            <div>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("compose:draftsGroup")}
              </p>
              {draftExamRows.length === 0 ? (
                <p className="px-1 text-xs text-slate-500">{t("compose:historyDraftEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {draftExamRows.map((d) => (
                    <li key={d.exam_id} className="flex min-w-0 items-stretch gap-0.5">
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs",
                          currentExamId === d.exam_id
                            ? "border-slate-900 bg-slate-100"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                        disabled={busy}
                        onClick={() => {
                          void loadExamById(d.exam_id, null);
                        }}
                      >
                        <span className="font-medium text-slate-900">{d.name || d.exam_id}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {t("compose:examStatusEditing")}
                        </span>
                        {d.export_label ? (
                          <span className="mt-0.5 block text-[10px] text-slate-500">{d.export_label}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="flex w-5 shrink-0 items-center justify-center self-stretch rounded text-[14px] leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                        disabled={busy}
                        title={t("compose:deleteDraft")}
                        aria-label={t("compose:deleteDraft")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteExamById(d.exam_id);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("compose:historyGroup")}
              </p>
              {exportedExamRows.length === 0 ? (
                <p className="px-1 text-xs text-slate-500">{t("compose:historyExamEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {exportedExamRows.map((ex) => (
                    <li key={ex.exam_id} className="flex min-w-0 items-stretch gap-0.5">
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs",
                          currentExamId === ex.exam_id
                            ? "border-slate-900 bg-slate-100"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                        disabled={busy}
                        onClick={() =>
                          void loadExamById(ex.exam_id, ex.exam_id)
                        }
                      >
                        <span className="font-medium text-slate-900">
                          {ex.export_label || ex.name || ex.exam_id}
                        </span>
                        {ex.subject ? (
                          <span className="mt-0.5 block text-[10px] text-slate-500">{ex.subject}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="flex w-5 shrink-0 items-center justify-center self-stretch rounded text-[14px] leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                        disabled={busy}
                        title={t("compose:deleteExportedExam")}
                        aria-label={t("compose:deleteExportedExam")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteExamById(ex.exam_id, { exported: true });
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 lg:flex-row">
        <section className="hidden w-full min-w-0 shrink-0 flex flex-col border-slate-200 bg-white lg:flex lg:w-[min(100%,187px)] lg:border-r">
          <div className="border-b border-slate-100 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("compose:bankSearchTitle")}</h2>
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-100"
              onClick={() => setComposeFilterExpanded((v) => !v)}
            >
              <span>{t("compose:filter")}</span>
              <span className="truncate pl-2 text-[10px] font-normal text-slate-500">
                {composeFilterExpanded
                  ? t("common:collapseHint")
                  : t("compose:filterSummary", {
                      subject,
                      collection: namespaceFilter === "__all__" ? t("compose:allCollections") : namespaceFilter,
                      type:
                        typeFilter === "__all__"
                          ? t("compose:allTypes")
                          : typeFilter === "group"
                            ? t("compose:groupOption")
                            : t(`lib:questionTypes.${typeFilter}`, { defaultValue: typeFilter }),
                      search: search.trim() ? t("common:searchingSuffix") : "",
                    })}
              </span>
            </button>
            {composeFilterExpanded && (
              <div className="mt-2 space-y-2">
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:subjectForExport")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  >
                    {subjectOptionsForSelect.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:collection")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={namespaceFilter}
                    onChange={(e) => setNamespaceFilter(e.target.value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    {namespaces.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:questionType")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="__all__">{t("common:all")}</option>
                    <option value="group">{t("compose:groupOption")}</option>
                    {QUESTION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`lib:questionTypes.${o.value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-slate-600">
                  {t("compose:search")}
                  <input
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400"
                    placeholder={t("compose:searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
            )}
            <p className="mt-2 text-[10px] leading-snug text-slate-500">{t("compose:bankListMultiSelectHint")}</p>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto p-2">
            {questions.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                <p className="font-medium text-slate-800">{t("compose:emptyBank")}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{t("compose:emptyBankHint")}</p>
              </li>
            ) : filteredQuestions.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                <p className="font-medium text-slate-800">{t("compose:emptyFilter")}</p>
                <p className="mt-2 text-xs text-slate-500">{t("compose:emptyFilterHint")}</p>
              </li>
            ) : (
              filteredQuestions.map((q, index) => {
                const isBundle = q.type === "group";
                return (
                  <li key={q.qualified_id}>
                    <button
                      type="button"
                      onClick={(e) => handleLeftBankClick(q, index, e)}
                      className={cn(
                        "mb-1 w-full rounded-lg border px-2 py-2 text-left text-sm transition-colors",
                        selectedLeftIdsSet.has(q.qualified_id)
                          ? "border-slate-900 bg-slate-100"
                          : "border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white",
                      )}
                    >
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        {t(`lib:questionTypes.${q.type}`, { defaultValue: q.type })}
                      </span>
                      {isBundle ? (
                        <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                          {t("compose:bundleBadge")}
                        </span>
                      ) : null}
                      <span className="ml-1 font-mono text-[11px] text-slate-800">{q.qualified_id}</span>
                      <KatexPlainPreview
                        text={q.content_preview}
                        className="mt-1 line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                      />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <div className="flex w-11 shrink-0 flex-col items-center justify-center gap-3 border-y border-slate-200 bg-slate-100/90 py-4 lg:border-x lg:border-y-0">
          <button
            type="button"
            title={t("compose:addToSection")}
            onClick={addFromLeft}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            title={t("compose:removeFromPaper")}
            onClick={removeFromRight}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>

        <section className="min-h-0 min-w-0 flex-1 basis-0 overflow-auto bg-slate-50 p-4 lg:min-w-0">
          {conflictTargetId ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="overwrite-dialog-title"
            >
              <div className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
                <h2 id="overwrite-dialog-title" className="text-base font-semibold text-slate-900">
                  {t("compose:overwriteTitle")}
                </h2>
                <p className="mt-2 text-sm text-slate-600">{t("compose:overwriteBody")}</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                    onClick={() => setConflictTargetId(null)}
                  >
                    {t("common:cancel")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
                    disabled={busy}
                    onClick={() => void confirmOverwriteExport()}
                  >
                    {t("compose:overwriteExport")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:examLabel")}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{exportLabel.trim() || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:subjectPdf")}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{subject.trim() || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:template")}</p>
                <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{selectedTpl?.id ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("compose:totalScoreLabel")}</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">{totalScore}</p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-700">{t("compose:knowledgeDistributionTitle")}</p>
              {knowledgeDistributionRows.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">{t("compose:knowledgeDistributionEmpty")}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {knowledgeDistributionRows.map(([name, n]) => (
                    <li
                      key={name}
                      className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-800"
                    >
                      {name === "__unassigned__" ? t("compose:knowledgeUnassigned") : name}
                      <span className="text-slate-500"> · {n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {templates.length === 0 && (
            <p className="text-sm text-red-600">{t("compose:templatesMissing")}</p>
          )}

          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {t("compose:activeSection")}
              <select
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                value={activeSection ?? ""}
                onChange={(e) => setActiveSection(e.target.value || null)}
              >
                {selectedTpl?.sections.map((s) => (
                  <option key={s.section_id} value={s.section_id}>
                    {s.section_id}
                    {s.type === "text"
                      ? t("compose:sectionOptionText")
                      : t("compose:sectionOptionNeed", { n: s.required_count })}
                  </option>
                ))}
              </select>
            </p>
            <p className="text-[10px] leading-snug text-slate-500">{t("compose:paperListMultiSelectHint")}</p>

            {selectedTpl?.sections.map((s) => {
              const n = bySection[s.section_id]?.length ?? 0;
              const isText = s.type === "text";
              const ok = isText || n === s.required_count;
              const sectionBaseScore = scoreBySection[s.section_id] ?? s.score_per_item;
              const slots = clusterAdjacentGroupSlots(bySection[s.section_id] ?? [], questionMap);
              return (
                <div
                  key={s.section_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveSection(s.section_id);
                    setSubject(subject);
                    if (s.type === "text") {
                      setTypeFilter("__all__");
                    } else {
                      setTypeFilter(s.type);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setActiveSection(s.section_id);
                      setSubject(subject);
                      if (s.type === "text") {
                        setTypeFilter("__all__");
                      } else {
                        setTypeFilter(s.type);
                      }
                    }
                  }}
                  className={cn(
                    "rounded-xl border bg-white shadow-sm transition-shadow",
                    activeSection === s.section_id ? "border-slate-900 ring-1 ring-slate-900/10" : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <div className="border-b border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900">{s.section_id}</h3>
                      <p className="text-[11px] text-slate-500">
                        {isText ? (
                          <>
                            {t("compose:textSectionLine")}
                            {ok && <span className="ml-2 text-emerald-600">{t("compose:configured")}</span>}
                          </>
                        ) : (
                          <>
                            {t("compose:pickedCount", { n, need: s.required_count })}
                            {ok && <span className="ml-2 text-emerald-600">{t("compose:satisfied")}</span>}
                          </>
                        )}
                      </p>
                      {s.describe ? (
                        <p className="mt-1 line-clamp-3 text-[11px] text-slate-600">{s.describe}</p>
                      ) : null}
                      {!isText ? (
                        <div
                          className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-50 pt-2"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                            {t("compose:scorePerItem")}
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              className="w-20 rounded-md border border-slate-300 px-1.5 py-1 text-sm"
                              value={scoreBySection[s.section_id] ?? s.score_per_item}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                setScoreBySection((prev) => ({
                                  ...prev,
                                  [s.section_id]: Number.isFinite(v) ? v : undefined,
                                }));
                              }}
                            />
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={perQuestionMode[s.section_id] ?? false}
                              onChange={(e) =>
                                setPerQuestionMode((p) => ({
                                  ...p,
                                  [s.section_id]: e.target.checked,
                                }))
                              }
                            />
                            {t("compose:perQuestionScores")}
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <ul className="space-y-1 p-3">
                    {isText ? (
                      <li className="text-center text-xs text-slate-500">{t("compose:textSectionNoPickHere")}</li>
                    ) : (
                      <>
                        {slots.map((slot, si) => {
                          if (slot.kind === "single") {
                            const qid = slot.qid;
                            const selectedHere =
                              selectedRight?.sectionId === s.section_id && selectedRight.qids.includes(qid);
                            return (
                              <li key={qid}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRightPaperSlotClick(s.section_id, slots, si, slot, e);
                                    setLeftListAnchorIndex(null);
                                  }}
                                  className={cn(
                                    "w-full rounded-md border px-2 py-2 text-left text-sm",
                                    selectedHere ? "border-slate-900 bg-slate-100" : "border-slate-100 bg-slate-50 hover:bg-white",
                                  )}
                                >
                                  <span className="font-mono text-xs text-slate-800">{qid}</span>
                                  <KatexPlainPreview
                                    text={questionMap.get(qid)?.content_preview ?? ""}
                                    className="line-clamp-2 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                                  />
                                  {perQuestionMode[s.section_id] ? (
                                    <div
                                      className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span className="text-[10px] text-slate-500">{t("compose:scoreThisQuestion")}</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.5}
                                        className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                        value={
                                          scoreOverrides[s.section_id]?.[qid] !== undefined
                                            ? scoreOverrides[s.section_id]![qid]
                                            : ""
                                        }
                                        placeholder={String(sectionBaseScore)}
                                        onChange={(e) => {
                                          const raw = e.target.value.trim();
                                          setScoreOverrides((prev) => {
                                            const cur = { ...(prev[s.section_id] ?? {}) };
                                            if (raw === "") {
                                              delete cur[qid];
                                            } else {
                                              const v = parseFloat(raw);
                                              if (Number.isFinite(v)) {
                                                cur[qid] = v;
                                              }
                                            }
                                            const next = { ...prev };
                                            if (Object.keys(cur).length === 0) {
                                              delete next[s.section_id];
                                            } else {
                                              next[s.section_id] = cur;
                                            }
                                            return next;
                                          });
                                        }}
                                      />
                                    </div>
                                  ) : null}
                                </button>
                              </li>
                            );
                          }
                          const headQid = slot.qids[0];
                          const mat = slot.rep.group_material?.trim();
                          const prevText = mat
                            ? mat.replace(/\s+/g, " ").slice(0, 120) + (mat.length > 120 ? "…" : "")
                            : questionMap.get(headQid)?.content_preview;
                          const selectedHere =
                            selectedRight?.sectionId === s.section_id &&
                            slot.qids.every((q) => selectedRight.qids.includes(q));
                          return (
                            <li key={`grp-${slot.rep.group_id}-${si}`}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRightPaperSlotClick(s.section_id, slots, si, slot, e);
                                  setLeftListAnchorIndex(null);
                                }}
                                className={cn(
                                  "w-full rounded-md border px-2 py-2 text-left text-sm",
                                  selectedHere ? "border-slate-900 bg-slate-100" : "border-slate-100 bg-slate-50 hover:bg-white",
                                )}
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                                    {t("compose:groupBadge", { count: slot.qids.length })}
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-800">{slot.rep.group_id}</span>
                                </div>
                                <p className="mt-0.5 font-mono text-[10px] leading-tight text-slate-500">{slot.qids.join(" · ")}</p>
                                <KatexPlainPreview
                                  text={prevText ?? ""}
                                  className="line-clamp-2 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"
                                />
                                {perQuestionMode[s.section_id] ? (
                                  <div
                                    className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="text-[10px] text-slate-500">{t("compose:groupScore")}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                      value={
                                        scoreOverrides[s.section_id]?.[headQid] !== undefined
                                          ? scoreOverrides[s.section_id]![headQid]
                                          : ""
                                      }
                                      placeholder={String(sectionBaseScore)}
                                      onChange={(e) => {
                                        const raw = e.target.value.trim();
                                        setScoreOverrides((prev) => {
                                          const cur = { ...(prev[s.section_id] ?? {}) };
                                          if (raw === "") {
                                            delete cur[headQid];
                                          } else {
                                            const v = parseFloat(raw);
                                            if (Number.isFinite(v)) {
                                              cur[headQid] = v;
                                            }
                                          }
                                          const next = { ...prev };
                                          if (Object.keys(cur).length === 0) {
                                            delete next[s.section_id];
                                          } else {
                                            next[s.section_id] = cur;
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                        {(bySection[s.section_id] ?? []).length === 0 && (
                          <li className="text-center text-xs text-slate-400">{t("compose:emptySlotHint")}</li>
                        )}
                      </>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>

          {!countsOk && selectedTpl && (
            <p className="mt-2 text-xs text-slate-500">{t("compose:exportWhenReady")}</p>
          )}
        </section>
        <aside className="flex min-h-0 w-full flex-col border-slate-200 bg-white shadow-xl lg:relative lg:z-auto lg:translate-x-0 lg:shadow-none lg:static lg:h-auto lg:w-auto lg:min-w-0 lg:flex-1 lg:basis-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-600">{t("compose:pdfVariantLabel")}</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              value={pdfVariant}
              onChange={(e) => setPdfVariant(e.target.value === "teacher" ? "teacher" : "student")}
            >
              <option value="student">{t("compose:pdfVariantStudent")}</option>
              <option value="teacher">{t("compose:pdfVariantTeacher")}</option>
            </select>
            {pdfExamId && !previewPdfId ? (
              <button
                type="button"
                className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 disabled:opacity-50"
                disabled={busy || viewPdfBusy}
                onClick={() => void openViewPdfExternally()}
              >
                {t("compose:openPdfExternal")}
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {composeRightPdfPath ? (
              <PdfPreview apiPath={composeRightPdfPath} className="min-h-[min(70vh,560px)]" />
            ) : (
              <p className="text-xs text-slate-500">{t("compose:previewPdfEmptyHint")}</p>
            )}
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}

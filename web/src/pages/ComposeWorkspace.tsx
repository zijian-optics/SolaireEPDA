import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../api/client";
import { ContentWithPrimeBrush } from "../components/ContentWithPrimeBrush";
import { KatexPlainPreview } from "../components/KatexText";
import { TexSetupNotice } from "../components/TexSetupNotice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAgentContext } from "../contexts/AgentContext";
import { useIsLargeScreen } from "../hooks/useIsLargeScreen";
import i18n from "../i18n/i18n";
import {
  collapseGroupRowsForList,
  clusterAdjacentGroupSlots,
  sectionSlotContainsQid,
} from "../lib/groupQuestions";
import { QUESTION_TYPE_OPTIONS } from "../lib/questionTypes";
import { cn } from "../lib/utils";
import { isTauriShell } from "../lib/tauriEnv";
import type {
  DraftDoc,
  DraftSummary,
  PastExamSummary,
  QuestionRow,
  RightSelection,
  TemplateRow,
} from "../types/compose";

export function ComposeWorkspace({ onError }: { onError: (s: string | null) => void }) {
  const { t } = useTranslation(["compose", "common", "lib"]);
  const { setPageContext } = useAgentContext();
  const isLg = useIsLargeScreen();
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    setRightOpen(isLg);
  }, [isLg]);

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
  const [selectedLeft, setSelectedLeft] = useState<QuestionRow | null>(null);
  const [selectedRight, setSelectedRight] = useState<RightSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [scoreBySection, setScoreBySection] = useState<Record<string, number | undefined>>({});
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, Record<string, number>>>({});
  const [perQuestionMode, setPerQuestionMode] = useState<Record<string, boolean>>({});
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  /** 导出失败后服务端自动保存的草稿 id；下次导出成功时一并删除 */
  const [exportFailureDraftIds, setExportFailureDraftIds] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftSummaries, setDraftSummaries] = useState<DraftSummary[]>([]);
  const [pastExams, setPastExams] = useState<PastExamSummary[]>([]);
  const [conflictTargetId, setConflictTargetId] = useState<string | null>(null);
  /** `result/` 下目录名，与 `/api/results` 的 exam_id 一致，用于内联打开学生版 PDF */
  const [lastExportedExamId, setLastExportedExamId] = useState<string | null>(null);
  const [viewPdfBusy, setViewPdfBusy] = useState(false);

  const openViewPdf = useCallback(async () => {
    if (!lastExportedExamId) {
      return;
    }
    if (isTauriShell()) {
      setViewPdfBusy(true);
      try {
        await apiPost<{ ok?: boolean }>(
          `/api/results/${encodeURIComponent(lastExportedExamId)}/open-pdf`,
          { variant: "student" },
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        window.alert(errMsg);
      } finally {
        setViewPdfBusy(false);
      }
    } else {
      const url = `${window.location.origin}/api/results/${encodeURIComponent(lastExportedExamId)}/pdf-file?variant=student`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [lastExportedExamId]);

  const selectedTpl = useMemo(() => templates.find((t) => t.path === templatePath), [templates, templatePath]);

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

  useEffect(() => {
    onError(null);
    void Promise.all([
      apiGet<{ templates: TemplateRow[] }>("/api/templates"),
      apiGet<{ questions: QuestionRow[] }>("/api/questions"),
      apiGet<{ subjects: string[] }>("/api/bank/subjects"),
    ])
      .then(([t, q, subs]) => {
        setTemplates(t.templates);
        setQuestions(q.questions);
        const list = subs.subjects.length ? subs.subjects : [...new Set(q.questions.map((x) => x.subject).filter(Boolean) as string[])];
        setSubjectOptions(list);
        setSubject((prev) => {
          const p = prev.trim();
          if (list.length && !list.includes(p)) {
            return list[0] ?? prev;
          }
          return prev;
        });
        const first = t.templates[0];
        if (first) {
          setTemplatePath(first.path);
          setTemplateRef(first.id);
          const init: Record<string, string[]> = {};
          for (const s of first.sections) {
            init[s.section_id] = [];
          }
          setBySection(init);
          setActiveSection(first.sections[0]?.section_id ?? null);
        }
      })
      .catch((e: Error) => onError(e.message));
  }, [onError]);

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
    setActiveSection(t.sections[0]?.section_id ?? null);
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

  const refreshDraftsExams = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([
        apiGet<{ drafts: DraftSummary[] }>("/api/exam/drafts"),
        apiGet<{ exams: PastExamSummary[] }>("/api/results"),
      ]);
      setDraftSummaries(d.drafts ?? []);
      setPastExams(e.exams ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshDraftsExams();
  }, [refreshDraftsExams]);

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

  const applyDraftDocument = useCallback((doc: DraftDoc) => {
    setExportLabel(String(doc.export_label ?? ""));
    setSubject(String(doc.subject ?? ""));
    const tp = String(doc.template_path ?? "");
    if (tp) {
      setTemplatePath(tp);
    }
    setTemplateRef(String(doc.template_ref ?? ""));
    const did = String(doc.draft_id ?? "");
    setCurrentDraftId(did || null);
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
  }, []);

  function addFromLeft() {
    if (!selectedTpl || !activeSection || !selectedLeft) {
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
    if (sec.type !== selectedLeft.type) {
      onError(t("compose:errors.typeMismatch", { need: sec.type, got: selectedLeft.type }));
      return;
    }
    const idsToAdd = [selectedLeft.qualified_id];
    for (const qid of idsToAdd) {
      const row = questionMap.get(qid);
      if (!row || row.type !== sec.type) {
        onError(t("compose:errors.questionTypeMismatch", { qid }));
        return;
      }
    }
    const cur = bySection[activeSection] ?? [];
    const newIds = idsToAdd.filter((id) => !cur.includes(id));
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
  }

  function removeFromRight() {
    if (!selectedRight) {
      onError(t("compose:errors.selectPaperItemFirst"));
      return;
    }
    const removeIds = [selectedRight.qid];
    onError(null);
    setBySection((prev) => ({
      ...prev,
      [selectedRight.sectionId]: (prev[selectedRight.sectionId] ?? []).filter((x) => !removeIds.includes(x)),
    }));
    setSelectedRight(null);
  }

  async function validate() {
    if (!selectedTpl) {
      return;
    }
    onError(null);
    setBusy(true);
    try {
      const selected_items = buildSelectedItemsForApi();
      await apiPost("/api/exam/validate", {
        template_ref: templateRef,
        template_path: templatePath,
        selected_items,
      });
      setMsg(t("compose:messages.validateOk"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runExport(
    overwriteExisting: string | null,
    draftIdToDeleteAfterSuccess: string | null,
    failureDraftIdsToDeleteAfterSuccess: string[],
  ) {
    if (!selectedTpl) {
      return;
    }
    const selected_items = buildSelectedItemsForApi();
    const idsToDelete = [
      ...new Set(
        [
          ...(draftIdToDeleteAfterSuccess ? [draftIdToDeleteAfterSuccess] : []),
          ...failureDraftIdsToDeleteAfterSuccess,
        ].filter(Boolean),
      ),
    ];
    const res = await apiPost<{
      ok: boolean;
      result_dir: string;
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
      ...(idsToDelete.length ? { draft_ids_to_delete_on_success: idsToDelete } : {}),
    });
    const dirNorm = res.result_dir.replace(/\\/g, "/").replace(/^\/+/, "");
    const segments = dirNorm.split("/").filter(Boolean);
    const examFolderId = segments.length ? segments[segments.length - 1]! : null;
    setLastExportedExamId(examFolderId);
    let successText = t("compose:messages.exportOk", {
      student: res.student_pdf,
      teacher: res.teacher_pdf,
      dir: res.result_dir,
    });
    if (idsToDelete.length) {
      setCurrentDraftId((cur) => (cur && idsToDelete.includes(cur) ? null : cur));
      setExportFailureDraftIds([]);
      successText += t("compose:messages.draftRemovedAfterExport");
    }
    setMsg(successText);
    void refreshDraftsExams();
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
      const draftIdSnapshot = currentDraftId;
      await runExport(null, draftIdSnapshot, exportFailureDraftIds);
    } catch (e) {
      if (e instanceof ApiError && e.draftSaved) {
        setExportFailureDraftIds((prev) => [...new Set([...prev, e.draftSaved!.draft_id])]);
        void refreshDraftsExams();
        onError(
          t("compose:errors.exportWithDraftSaved", { name: e.draftSaved.name, detail: e.message }),
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
    const draftIdSnapshot = currentDraftId;
    setConflictTargetId(null);
    onError(null);
    setBusy(true);
    setMsg(null);
    try {
      await runExport(overwriteId, draftIdSnapshot, exportFailureDraftIds);
    } catch (e) {
      if (e instanceof ApiError && e.draftSaved) {
        setExportFailureDraftIds((prev) => [...new Set([...prev, e.draftSaved!.draft_id])]);
        void refreshDraftsExams();
        onError(
          t("compose:errors.exportWithDraftSaved", { name: e.draftSaved.name, detail: e.message }),
        );
      } else {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveDraftToServer() {
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
      if (currentDraftId) {
        const r = await apiPut<{ draft: DraftDoc }>(`/api/exam/drafts/${encodeURIComponent(currentDraftId)}`, {
          ...body,
        });
        applyDraftDocument(r.draft);
        setMsg(t("compose:messages.draftUpdated"));
      } else {
        const r = await apiPost<{ draft: DraftDoc }>("/api/exam/drafts", body);
        applyDraftDocument(r.draft);
        setMsg(t("compose:messages.draftSaved"));
      }
      void refreshDraftsExams();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentDraft() {
    if (!currentDraftId) {
      return;
    }
    if (!window.confirm(t("compose:messages.confirmDeleteDraft"))) {
      return;
    }
    onError(null);
    setBusy(true);
    try {
      const id = currentDraftId;
      await apiDelete<{ ok: boolean }>(`/api/exam/drafts/${encodeURIComponent(id)}`);
      setCurrentDraftId(null);
      setDraftName("");
      setMsg(t("compose:messages.draftDeleted"));
      void refreshDraftsExams();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadDraftById(id: string) {
    onError(null);
    setBusy(true);
    try {
      const r = await apiGet<{ draft: DraftDoc }>(`/api/exam/drafts/${encodeURIComponent(id)}`);
      applyDraftDocument(r.draft);
      setMsg(t("compose:messages.draftLoaded"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFromPastExam(examId: string) {
    onError(null);
    setBusy(true);
    try {
      const r = await apiPost<{ draft: DraftDoc; persisted?: boolean }>(
        `/api/exam/drafts/from-result/${encodeURIComponent(examId)}`,
        { persist: false },
      );
      applyDraftDocument(r.draft);
      setCurrentDraftId(null);
      setMsg(t("compose:messages.importedFromHistory"));
      void refreshDraftsExams();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startNewComposition() {
    setCurrentDraftId(null);
    setDraftName("");
    setMsg(null);
    setLastExportedExamId(null);
    onError(null);
    if (selectedTpl) {
      const init: Record<string, string[]> = {};
      for (const s of selectedTpl.sections) {
        init[s.section_id] = [];
      }
      setBySection(init);
    }
    setScoreBySection({});
    setScoreOverrides({});
    setPerQuestionMode({});
    setSelectedLeft(null);
    setSelectedRight(null);
  }

  function onLoadCompositionSelect(value: string) {
    if (!value) {
      return;
    }
    if (value.startsWith("draft:")) {
      void loadDraftById(value.slice(6));
    } else if (value.startsWith("result:")) {
      void importFromPastExam(value.slice(7));
    }
  }

  const previewQuestion = selectedLeft ?? (selectedRight ? questionMap.get(selectedRight.qid) ?? null : null);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <TexSetupNotice onError={onError} />
      {!isLg && !rightOpen && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-1 ring-slate-700 lg:hidden"
          onClick={() => setRightOpen(true)}
          aria-label={t("compose:openPropsPanel")}
        >
          <PanelRightOpen className="h-5 w-5" />
        </button>
      )}
      {!isLg && rightOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/20 lg:hidden"
          aria-label={t("compose:closeSidebar")}
          onClick={() => setRightOpen(false)}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row">
        {/* 左：题库检索 */}
        <section className="flex w-full min-w-0 shrink-0 flex-col border-slate-200 bg-white lg:w-[min(100%,280px)] lg:border-r">
          <div className="border-b border-slate-100 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("compose:bankSearchTitle")}</h2>
            <p
              className="mt-1 text-[10px] leading-snug text-slate-500"
              dangerouslySetInnerHTML={{
                __html: t("compose:bankSearchHint", { subject: subject.trim() || "…" }),
              }}
            />
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
                    {(subjectOptions.length ? subjectOptions : [subject]).map((s) => (
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
              filteredQuestions.map((q) => {
                const isBundle = q.type === "group";
                return (
                  <li key={q.qualified_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLeft(q);
                        setSelectedRight(null);
                      }}
                      className={cn(
                        "mb-1 w-full rounded-lg border px-2 py-2 text-left text-sm transition-colors",
                        selectedLeft?.qualified_id === q.qualified_id
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

        {/* 箭头列 */}
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

        {/* 中：Canvas */}
        <section className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
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
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-slate-600">
                {t("compose:examLabel")}
                <input
                  className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={exportLabel}
                  onChange={(e) => setExportLabel(e.target.value)}
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                {t("compose:subjectPdf")}
                <select
                  className="mt-1 block min-w-[120px] rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {(subjectOptions.length ? subjectOptions : [subject]).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                {t("compose:template")}
                <select
                  className="mt-1 block min-w-[200px] rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={templatePath}
                  onChange={(e) => setTemplatePath(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.path} value={t.path}>
                      {t.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex min-w-[120px] flex-col justify-end rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {t("compose:totalScoreLabel")}
                </span>
                <span className="text-lg font-semibold text-slate-900">{totalScore}</span>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-50"
                  disabled={busy || !selectedTpl}
                  onClick={() => void validate()}
                >
                  {t("compose:validate")}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || !countsOk}
                  onClick={() => void exportExam()}
                >
                  {t("compose:exportPdf")}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label className="text-xs font-medium text-slate-600">
                {t("compose:draftName")}
                <input
                  className="mt-1 block min-w-[160px] rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={t("compose:draftNamePlaceholder")}
                />
              </label>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-50"
                disabled={busy || !selectedTpl}
                onClick={() => void saveDraftToServer()}
              >
                {currentDraftId ? t("compose:updateDraft") : t("compose:saveDraft")}
              </button>
              <button
                type="button"
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                disabled={busy || !currentDraftId}
                onClick={() => void deleteCurrentDraft()}
              >
                {t("compose:deleteDraft")}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                disabled={busy}
                onClick={startNewComposition}
              >
                {t("compose:newPaper")}
              </button>
              <label className="text-xs font-medium text-slate-600">
                {t("compose:loadLabel")}
                <select
                  className="mt-1 block min-w-[220px] rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      onLoadCompositionSelect(v);
                    }
                    e.target.value = "";
                  }}
                >
                  <option value="">{t("compose:loadPlaceholder")}</option>
                  {draftSummaries.length > 0 ? (
                    <optgroup label={t("compose:draftsGroup")}>
                      {draftSummaries.map((d) => (
                        <option key={d.draft_id} value={`draft:${d.draft_id}`}>
                          {d.name || d.draft_id}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {pastExams.length > 0 ? (
                    <optgroup label={t("compose:historyGroup")}>
                      {pastExams.map((ex) => (
                        <option key={ex.exam_id} value={`result:${ex.exam_id}`}>
                          {ex.export_label || ex.exam_title || ex.exam_id}
                          {ex.subject ? ` · ${ex.subject}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              {currentDraftId ? (
                <span className="self-center text-[11px] text-slate-500">
                  {t("compose:currentDraft", { id: currentDraftId })}
                </span>
              ) : null}
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

            {selectedTpl?.sections.map((s) => {
              const n = bySection[s.section_id]?.length ?? 0;
              const isText = s.type === "text";
              const ok = isText || n === s.required_count;
              const sectionBaseScore = scoreBySection[s.section_id] ?? s.score_per_item;
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
                        {clusterAdjacentGroupSlots(bySection[s.section_id] ?? [], questionMap).map((slot, si) => {
                          if (slot.kind === "single") {
                            const qid = slot.qid;
                            return (
                              <li key={qid}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRight({ sectionId: s.section_id, qid });
                                    setSelectedLeft(questionMap.get(qid) ?? null);
                                  }}
                                  className={cn(
                                    "w-full rounded-md border px-2 py-2 text-left text-sm",
                                    selectedRight?.sectionId === s.section_id && selectedRight?.qid === qid
                                      ? "border-slate-900 bg-slate-100"
                                      : "border-slate-100 bg-slate-50 hover:bg-white",
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
                            selectedRight?.sectionId === s.section_id && sectionSlotContainsQid(slot, selectedRight.qid);
                          return (
                            <li key={`grp-${slot.rep.group_id}-${si}`}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRight({ sectionId: s.section_id, qid: headQid });
                                  setSelectedLeft(questionMap.get(headQid) ?? null);
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

        {/* 右：属性 + 预览 */}
        <aside
          className={cn(
            "flex w-full flex-col border-slate-200 bg-white shadow-xl transition-transform lg:relative lg:z-auto lg:w-80 lg:max-w-[20rem] lg:translate-x-0 lg:shadow-none",
            "fixed inset-y-0 right-0 z-50 max-w-[min(100vw,20rem)] lg:static lg:h-auto lg:max-w-none",
            !isLg && !rightOpen && "translate-x-full pointer-events-none",
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 lg:hidden">
            <span className="text-sm font-medium text-slate-800">{t("compose:propsPreview")}</span>
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
              onClick={() => setRightOpen(false)}
              aria-label={t("compose:close")}
            >
              <PanelRightClose className="h-5 w-5" />
            </button>
          </div>
          <Tabs defaultValue="props" className="flex min-h-0 flex-1 flex-col p-3">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="props">{t("compose:tabProps")}</TabsTrigger>
              <TabsTrigger value="preview">{t("compose:tabPreview")}</TabsTrigger>
            </TabsList>
            <TabsContent value="props" className="min-h-0 flex-1 overflow-auto text-sm text-slate-700">
              <p className="text-xs text-slate-500">{t("compose:propsIntro")}</p>
              <label className="mt-3 block text-xs font-medium">
                {t("compose:examLabelShort")}
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={exportLabel}
                  onChange={(e) => setExportLabel(e.target.value)}
                />
              </label>
              <label className="mt-3 block text-xs font-medium">
                {t("compose:subjectShort")}
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <label className="mt-3 block text-xs font-medium">
                {t("compose:templateFile")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={templatePath}
                  onChange={(e) => setTemplatePath(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.path} value={t.path}>
                      {t.path}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 py-2 text-sm font-medium disabled:opacity-50"
                  disabled={busy || !selectedTpl}
                  onClick={() => void validate()}
                >
                  {t("compose:validate")}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || !countsOk}
                  onClick={() => void exportExam()}
                >
                  {t("compose:exportPdf")}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                  disabled={busy || !lastExportedExamId || viewPdfBusy}
                  onClick={() => void openViewPdf()}
                >
                  {t("compose:viewPdf")}
                </button>
              </div>
              {busy ? (
                <p className="mt-2 text-xs text-slate-500" aria-live="polite">
                  {t("common:processing")}
                </p>
              ) : null}
              {msg ? (
                <p className="mt-2 text-sm text-emerald-700" role="status">
                  {msg}
                </p>
              ) : null}
            </TabsContent>
            <TabsContent value="preview" className="min-h-0 flex-1 overflow-auto border-t border-slate-100 pt-2">
              {previewQuestion ? (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                  <p className="mb-2 font-mono text-[11px] text-slate-500">{previewQuestion.qualified_id}</p>
                  <ContentWithPrimeBrush text={previewQuestion.content} className="text-slate-900" />
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-slate-600">{t("compose:answer")}</summary>
                    <ContentWithPrimeBrush text={previewQuestion.answer} className="mt-1" />
                  </details>
                </div>
              ) : (
                <p className="text-xs text-slate-500">{t("compose:previewHint")}</p>
              )}
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

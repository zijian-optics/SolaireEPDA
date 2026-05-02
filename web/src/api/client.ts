import i18n from "../i18n/i18n";
import { logApiCall } from "../lib/appLog";
import { isTauriShell, waitForTauriShell } from "../lib/tauriEnv";

let apiBaseResolved: string | null = null;
let apiBasePromise: Promise<string> | null = null;

/** 生产构建首次打开时，Tauri 注入可能晚于首帧脚本，需短暂等待再判定是否在壳内。 */
const TAURI_INJECT_WAIT_MS = 5000;

/** 桌面壳内等待本地服务就绪（事件 + 非阻塞 invoke 竞态 + 超时）。 */
const SHELL_BACKEND_WAIT_MS = 120_000;

async function waitForShellBackendPort(): Promise<number> {
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let unlistenReady: (() => void) | undefined;
    let unlistenFail: (() => void) | undefined;

    const cleanup = () => {
      for (const t of timeouts) clearTimeout(t);
      try {
        unlistenReady?.();
      } catch {
        /* ignore */
      }
      try {
        unlistenFail?.();
      } catch {
        /* ignore */
      }
    };

    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };

    const ok = (port: number) => {
      if (settled) return;
      if (!Number.isFinite(port) || port <= 0) {
        fail(i18n.t("localServiceFailed", { ns: "common" }));
        return;
      }
      settled = true;
      cleanup();
      resolve(port);
    };

    void (async () => {
      try {
        unlistenReady = await listen<unknown>("backend-ready", (event) => {
          const p = event.payload;
          let port = 0;
          if (typeof p === "object" && p !== null && "port" in p) {
            port = Number((p as { port: number }).port);
          } else if (typeof p === "number") {
            port = p;
          }
          if (port > 0) ok(port);
        });

        unlistenFail = await listen<{ message: string }>("backend-failed", (event) => {
          const m = event.payload?.message;
          if (typeof m === "string" && m.trim()) {
            fail(m);
          } else {
            fail(i18n.t("localServiceFailed", { ns: "common" }));
          }
        });

        try {
          const port = await invoke<number>("get_backend_port");
          if (port > 0) ok(port);
        } catch {
          /* 尚未就绪，依赖事件 */
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    })();

    timeouts.push(
      setTimeout(() => {
        fail(
          i18n.t("localServiceStartTimeout", {
            ns: "common",
          }),
        );
      }, SHELL_BACKEND_WAIT_MS),
    );
  });
}

async function resolveApiBase(): Promise<string> {
  if (apiBaseResolved !== null) return apiBaseResolved;

  let inShell = isTauriShell();
  if (!import.meta.env.DEV && !inShell) {
    inShell = await waitForTauriShell(TAURI_INJECT_WAIT_MS);
  }

  if (inShell) {
    try {
      const port = await waitForShellBackendPort();
      apiBaseResolved = `http://127.0.0.1:${port}`;
      return apiBaseResolved;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      throw new Error(msg);
    }
  }
  apiBaseResolved = "";
  return apiBaseResolved;
}

/** 桌面壳（Tauri）下解析后端端口；浏览器开发环境为空字符串（走 Vite 代理）。 */
export async function ensureApiBase(): Promise<void> {
  if (!apiBasePromise) {
    apiBasePromise = resolveApiBase();
  }
  await apiBasePromise;
}

function joinApi(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = apiBaseResolved ?? "";
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 用于少数直接 `fetch` 的场景（如下载流）。 */
export async function resolveApiUrl(path: string): Promise<string> {
  await ensureApiBase();
  return joinApi(path);
}

/**
 * `resource/` 下文件的 HTTP 路径（桌面壳下需带后端 origin，见 main.tsx 中 `ensureApiBase` 已先完成）。
 */
export function resourceApiUrl(resourceRel: string): string {
  const rel = resourceRel
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return joinApi(`/api/resource/${rel}`);
}

/**
 * 手册 Markdown、富文本里以 `/api/...` 开头的绝对路径（如 `/api/help/asset/...`），
 * 在 Tauri 壳下需拼上后端 origin，否则图片会请求到 WebView 自身页面而显示损坏。
 */
export function apiAbsoluteUrl(path: string): string {
  const p = path.trim();
  if (!p) return p;
  if (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("data:") ||
    p.startsWith("blob:")
  ) {
    return p;
  }
  if (p.startsWith("//")) return p;
  const normalized = p.startsWith("/") ? p : `/${p}`;
  return joinApi(normalized);
}

/** Prefer RFC 5987 filename* (UTF-8) so non-ASCII names from the backend are preserved. */
function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) {
    return null;
  }
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const m = /filename="([^"]+)"/.exec(cd);
  return m?.[1] ?? null;
}

export type ExamSavedPayload = { exam_id: string; name: string };

/** @deprecated 使用 ExamSavedPayload */
export type DraftSavedPayload = ExamSavedPayload;

export class ApiError extends Error {
  readonly status: number;
  readonly examSaved?: ExamSavedPayload;

  constructor(message: string, status: number, opts?: { examSaved?: ExamSavedPayload }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.examSaved = opts?.examSaved;
  }
}

async function parseDetailFromResponse(r: Response): Promise<{
  message: string;
  examSaved?: ExamSavedPayload;
}> {
  try {
    const j = (await r.json()) as { detail?: unknown };
    if (typeof j.detail === "string") {
      return { message: j.detail };
    }
    if (Array.isArray(j.detail)) {
      return {
        message: j.detail
          .map((x: { msg?: string }) => x?.msg)
          .filter(Boolean)
          .join("; "),
      };
    }
    if (j.detail && typeof j.detail === "object" && !Array.isArray(j.detail)) {
      const d = j.detail as Record<string, unknown>;
      const msg =
        typeof d.message === "string" && d.message.trim()
          ? d.message
          : r.statusText || "Request failed";
      const raw = d.exam_saved ?? d.draft_saved;
      let examSaved: ExamSavedPayload | undefined;
      if (raw && typeof raw === "object" && raw !== null) {
        const o = raw as Record<string, unknown>;
        const eid = typeof o.exam_id === "string" ? o.exam_id : typeof o.draft_id === "string" ? o.draft_id : "";
        if (eid) {
          examSaved = { exam_id: eid, name: typeof o.name === "string" ? o.name : "" };
        }
      }
      return { message: msg, examSaved };
    }
  } catch {
    /* ignore */
  }
  return { message: r.statusText || "Request failed" };
}

function isHeavyApiPath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return (
    p === "/api/exam/export" ||
    p === "/api/exam/validate" ||
    p === "/api/bank/import-bundle" ||
    p === "/api/bank/import" ||
    p === "/api/bank/export-bundle"
  );
}

async function fetchWithLog(path: string, init?: RequestInit): Promise<Response> {
  await ensureApiBase();
  const url = joinApi(path);
  const t0 = performance.now();
  const method = init?.method ?? "GET";
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    logApiCall({
      path,
      method,
      ok: false,
      status: 0,
      ms,
      detail: i18n.t("networkError", { ns: "common", detail: msg }),
    });
    throw e instanceof Error ? e : new Error(msg);
  }
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) {
    const parsed = await parseDetailFromResponse(r);
    logApiCall({ path, method, ok: false, status: r.status, ms, detail: parsed.message });
    throw new ApiError(parsed.message, r.status, { examSaved: parsed.examSaved });
  }
  if (method !== "GET" || isHeavyApiPath(path)) {
    logApiCall({ path, method, ok: true, status: r.status, ms });
  }
  return r;
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetchWithLog(path);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithLog(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

/** multipart/form-data POST — do not set Content-Type (browser sets boundary). */
export async function apiPostFormData<T>(path: string, formData: FormData): Promise<T> {
  const r = await fetchWithLog(path, { method: "POST", body: formData });
  return r.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithLog(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const r = await fetchWithLog(path, { method: "DELETE" });
  return r.json() as Promise<T>;
}

/** Download strict bank exchange ZIP (POST /api/bank/export-bundle — 避免 GET 查询串中 namespace 含 / 时的编码问题). */
export async function downloadBankExportBundle(namespace: string): Promise<void> {
  const path = `/api/bank/export-bundle`;
  await ensureApiBase();
  const requestUrl = joinApi(path);
  const t0 = performance.now();
  let r: Response;
  try {
    r = await fetch(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace }),
    });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    logApiCall({
      path,
      method: "POST",
      ok: false,
      status: 0,
      ms,
      detail: i18n.t("networkError", { ns: "common", detail: msg }),
    });
    throw e instanceof Error ? e : new Error(msg);
  }
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) {
    const parsed = await parseDetailFromResponse(r);
    logApiCall({ path, method: "POST", ok: false, status: r.status, ms, detail: parsed.message });
    throw new ApiError(parsed.message, r.status, { examSaved: parsed.examSaved });
  }
  logApiCall({ path, method: "POST", ok: true, status: r.status, ms });
  const cd = r.headers.get("Content-Disposition");
  const filename = filenameFromContentDisposition(cd) ?? "bank-export.bank.zip";
  const blob = await r.blob();
  const { saveBlobToDisk } = await import("../lib/saveBlobToDisk");
  await saveBlobToDisk(blob, {
    defaultFileName: filename,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
}

/** 知识点 id 中可含 `/`，需按段编码后再拼到路径。 */
export function encodeGraphNodePathSegment(nodeId: string): string {
  return nodeId.split("/").map(encodeURIComponent).join("/");
}

function graphQs(graph?: string | null): string {
  return graph ? `?graph=${encodeURIComponent(graph)}` : "";
}

// --- Graph management (multi-graph) ---

export type GraphInfo = {
  slug: string;
  display_name: string;
  node_count: number;
};

export async function apiGraphListGraphs(): Promise<{ graphs: GraphInfo[] }> {
  return apiGet<{ graphs: GraphInfo[] }>("/api/graph/graphs");
}

export async function apiGraphCreateGraph(body: {
  display_name: string;
  slug?: string | null;
}): Promise<{ ok: boolean; slug: string }> {
  return apiPost<{ ok: boolean; slug: string }>("/api/graph/graphs", body);
}

export async function apiGraphRenameGraph(
  slug: string,
  displayName: string,
): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>(`/api/graph/graphs/${encodeURIComponent(slug)}`, {
    display_name: displayName,
  });
}

export async function apiGraphDeleteGraph(slug: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/graph/graphs/${encodeURIComponent(slug)}`);
}

// --- Nodes ---

export async function apiGraphListNodes(
  nodeKind?: string,
  graph?: string | null,
): Promise<{ nodes: any[]; kind_counts?: Record<string, number> }> {
  const p = new URLSearchParams();
  if (nodeKind) p.set("node_kind", nodeKind);
  if (graph) p.set("graph", graph);
  const qs = p.toString();
  return apiGet<{ nodes: any[]; kind_counts?: Record<string, number> }>(`/api/graph/nodes${qs ? `?${qs}` : ""}`);
}

export type GraphNodeApiPayload = Record<string, unknown>;

export async function apiGraphCreateNode(
  body: unknown,
  graph?: string | null,
): Promise<{
  ok: boolean;
  node_id: string;
  node?: GraphNodeApiPayload;
  relation?: GraphNodeApiPayload | null;
}> {
  return apiPost<{
    ok: boolean;
    node_id: string;
    node?: GraphNodeApiPayload;
    relation?: GraphNodeApiPayload | null;
  }>(`/api/graph/nodes${graphQs(graph)}`, body);
}

export async function apiGraphUpdateNode(
  nodeId: string,
  body: unknown,
  graph?: string | null,
): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>(
    `/api/graph/nodes/${encodeGraphNodePathSegment(nodeId)}${graphQs(graph)}`,
    body,
  );
}

export async function apiGraphDeleteNode(nodeId: string, graph?: string | null): Promise<{
  ok: boolean;
  deleted_node?: GraphNodeApiPayload | null;
  deleted_relations?: unknown[];
}> {
  return apiDelete<{
    ok: boolean;
    deleted_node?: GraphNodeApiPayload | null;
    deleted_relations?: unknown[];
  }>(`/api/graph/nodes/${encodeGraphNodePathSegment(nodeId)}${graphQs(graph)}`);
}

// --- Relations ---

export async function apiGraphCreateRelation(
  body: unknown,
  graph?: string | null,
): Promise<{ ok: boolean; relation_id: string }> {
  return apiPost<{ ok: boolean; relation_id: string }>(`/api/graph/relations${graphQs(graph)}`, body);
}

export async function apiGraphUpdateRelation(
  relationId: string,
  body: { relation_type?: string; reverse?: boolean },
  graph?: string | null,
): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>(
    `/api/graph/relations/${encodeURIComponent(relationId)}${graphQs(graph)}`,
    body,
  );
}

export async function apiGraphCreateBinding(body: unknown, graph?: string | null): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/api/graph/bindings${graphQs(graph)}`, body);
}

export async function apiGraphUnbindBinding(body: unknown, graph?: string | null): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/api/graph/bindings/unbind${graphQs(graph)}`, body);
}

export async function apiGraphListQuestionsForNode(
  nodeId: string,
  graph?: string | null,
): Promise<{ questions: any[] }> {
  return apiGet<{ questions: any[] }>(
    `/api/graph/nodes/${encodeGraphNodePathSegment(nodeId)}/questions${graphQs(graph)}`,
  );
}

export async function apiGraphQuestionNodes(
  qualifiedId: string,
): Promise<{ nodes: { id: string; canonical_name: string; node_kind: string; subject: string | null }[] }> {
  return apiGet(`/api/graph/question-nodes?qualified_id=${encodeURIComponent(qualifiedId)}`);
}

export async function apiGraphQuestionBindingsIndex(graph?: string | null): Promise<{
  index: Record<string, { id: string; canonical_name: string; node_kind: string }[]>;
}> {
  return apiGet(`/api/graph/question-bindings-index${graphQs(graph)}`);
}

export async function apiGraphBindBatch(
  nodeId: string,
  qualifiedIds: string[],
  graph?: string | null,
): Promise<{ added: number; skipped: number }> {
  return apiPost(
    `/api/graph/nodes/${encodeGraphNodePathSegment(nodeId)}/bind-batch${graphQs(graph)}`,
    { qualified_ids: qualifiedIds },
  );
}

export async function apiGraphUnbindBatch(
  nodeId: string,
  qualifiedIds: string[],
  graph?: string | null,
): Promise<{ removed: number }> {
  const path = `/api/graph/nodes/${encodeGraphNodePathSegment(nodeId)}/unbind-batch${graphQs(graph)}`;
  const r = await fetchWithLog(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qualified_ids: qualifiedIds }),
  });
  return r.json() as Promise<{ removed: number }>;
}

export async function apiGraphListRelations(graph?: string | null): Promise<{ relations: any[] }> {
  return apiGet<{ relations: any[] }>(`/api/graph/relations${graphQs(graph)}`);
}

export async function apiGraphDeleteRelation(
  relationId: string,
  graph?: string | null,
): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(
    `/api/graph/relations/${encodeURIComponent(relationId)}${graphQs(graph)}`,
  );
}

export async function apiGraphGetTaxonomy(): Promise<{ subjects: string[]; levels: string[] }> {
  return apiGet<{ subjects: string[]; levels: string[] }>("/api/graph/taxonomy");
}

export async function apiGraphPutTaxonomy(body: { subjects: string[]; levels: string[] }): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>("/api/graph/taxonomy", body);
}

export async function apiGraphListResourceFiles(q: string, limit?: number): Promise<{ files: { path: string; size: number }[] }> {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (limit != null) p.set("limit", String(limit));
  const qs = p.toString();
  return apiGet<{ files: { path: string; size: number }[] }>(`/api/graph/resource-files${qs ? `?${qs}` : ""}`);
}

export async function apiGraphListNodeFiles(
  nodeId: string,
  graph?: string | null,
): Promise<{ links: { id: string; node_id: string; relative_path: string }[] }> {
  return apiGet(`/api/graph/nodes/${encodeGraphNodePathSegment(nodeId)}/files${graphQs(graph)}`);
}

export async function apiGraphAttachFile(
  body: { node_id: string; relative_path: string },
  graph?: string | null,
): Promise<{ ok: boolean; link_id: string }> {
  return apiPost<{ ok: boolean; link_id: string }>(`/api/graph/file-links${graphQs(graph)}`, body);
}

export async function apiGraphDetachFile(linkId: string, graph?: string | null): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(
    `/api/graph/file-links/${encodeURIComponent(linkId)}${graphQs(graph)}`,
  );
}

export async function apiGraphUploadMaterial(file: File): Promise<{ ok: boolean; relative_path: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetchWithLog("/api/graph/upload", { method: "POST", body: fd });
  return r.json() as Promise<{ ok: boolean; relative_path: string }>;
}

export type AnalysisScript = {
  script_id: string;
  name: string;
  language: string;
  code: string;
  created_at?: string;
  updated_at?: string;
};

export type AnalysisFolderScript = {
  path: string;
  name: string;
  updated_at: number;
};

export type AnalysisJob = {
  job_id: string;
  kind: string;
  status: string;
  error?: string | null;
  output_ref?: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function apiAnalysisListTools(): Promise<{ tools: any[] }> {
  return apiGet<{ tools: any[] }>("/api/analysis/tools");
}

export async function apiAnalysisDiagnosisKnowledge(examId: string, batchId: string): Promise<any> {
  const q = new URLSearchParams({ exam_id: examId, batch_id: batchId });
  return apiGet(`/api/analysis/diagnosis/knowledge?${q}`);
}

export async function apiAnalysisDiagnosisStudent(
  examId: string,
  batchId: string,
  studentId?: string,
): Promise<any> {
  const q = new URLSearchParams({ exam_id: examId, batch_id: batchId });
  if (studentId) q.set("student_id", studentId);
  return apiGet(`/api/analysis/diagnosis/student?${q}`);
}

export async function apiAnalysisDiagnosisHeatmap(examId: string, batchId: string): Promise<any> {
  const q = new URLSearchParams({ exam_id: examId, batch_id: batchId });
  return apiGet(`/api/analysis/diagnosis/class-heatmap?${q}`);
}

export async function apiAnalysisDiagnosisSuggestions(examId: string, batchId: string): Promise<any> {
  const q = new URLSearchParams({ exam_id: examId, batch_id: batchId });
  return apiGet(`/api/analysis/diagnosis/suggestions?${q}`);
}

export async function apiAnalysisInvokeTool(toolName: string, argumentsBody: Record<string, unknown>): Promise<any> {
  return apiPost(`/api/analysis/tools/${encodeURIComponent(toolName)}`, { arguments: argumentsBody });
}

export async function apiAnalysisListScripts(): Promise<{ scripts: AnalysisScript[] }> {
  return apiGet<{ scripts: AnalysisScript[] }>("/api/analysis/scripts");
}

export async function apiAnalysisSaveScript(payload: {
  script_id?: string;
  name: string;
  language?: string;
  code: string;
}): Promise<{ script: AnalysisScript }> {
  return apiPost<{ script: AnalysisScript }>("/api/analysis/scripts", payload);
}

export async function apiAnalysisDeleteScript(scriptId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/analysis/scripts/${encodeURIComponent(scriptId)}`);
}

export async function apiAnalysisRunBuiltin(payload: {
  builtin_id: string;
  exam_id: string;
  batch_id: string;
  recompute?: boolean;
  request_id?: string;
}): Promise<{ job_id: string; status: string; output?: any }> {
  return apiPost<{ job_id: string; status: string; output?: any }>("/api/analysis/jobs/builtin", payload);
}

export async function apiAnalysisRunScript(payload: {
  script_id: string;
  exam_id: string;
  batch_id: string;
  request_id?: string;
}): Promise<{ job_id: string; status: string; output?: any }> {
  return apiPost<{ job_id: string; status: string; output?: any }>("/api/analysis/jobs/script", payload);
}

export async function apiAnalysisListFolderScripts(): Promise<{ scripts: AnalysisFolderScript[] }> {
  return apiGet<{ scripts: AnalysisFolderScript[] }>("/api/analysis/folder-scripts");
}

export async function apiAnalysisRunFolderScript(payload: {
  script_path: string;
  exam_id: string;
  batch_id: string;
  request_id?: string;
}): Promise<{ job_id: string; status: string; output?: any; error?: string; error_code?: string }> {
  return apiPost("/api/analysis/jobs/script-from-folder", payload);
}

export async function apiAnalysisListJobs(limit = 50): Promise<{ jobs: AnalysisJob[] }> {
  return apiGet<{ jobs: AnalysisJob[] }>(`/api/analysis/jobs?limit=${encodeURIComponent(String(limit))}`);
}

export async function apiAnalysisGetJob(jobId: string, includeOutput = true): Promise<{ job: AnalysisJob; output?: any }> {
  const p = includeOutput ? "true" : "false";
  return apiGet<{ job: AnalysisJob; output?: any }>(
    `/api/analysis/jobs/${encodeURIComponent(jobId)}?include_output=${p}`,
  );
}

export async function apiBankSubjects(): Promise<{ subjects: string[] }> {
  return apiGet<{ subjects: string[] }>("/api/bank/subjects");
}

export async function apiBankCollections(): Promise<{ collections: any[] }> {
  return apiGet<{ collections: any[] }>("/api/bank/collections");
}

export async function apiBankItems(): Promise<{ items: any[] }> {
  return apiGet<{ items: any[] }>("/api/bank/items");
}

// --- System extensions (optional host tools) ---
export type SystemExtensionExecutable = {
  name: string;
  on_path: boolean;
  path: string | null;
  version: string | null;
  /** 本页指定路径优先于自动检测 */
  resolved_from?: "manual" | "system";
};

export type SystemExtensionStatus = {
  id: string;
  name: string;
  description: string;
  download_url: string;
  install_hint: string | null;
  executables: SystemExtensionExecutable[];
  ready: boolean;
  can_auto_install: boolean;
  platform: string;
  winget_on_path: boolean | null;
  python_ocr_ready?: boolean;
  ocr_ready?: boolean;
  /** 是否在设置中保存过手动路径 */
  has_manual_paths?: boolean;
  /** 已保存的手动路径摘要（展示用） */
  manual_paths?: Record<string, string | null | undefined>;
};

export type SystemExtensionsResponse = {
  extensions: SystemExtensionStatus[];
};

export async function apiSystemExtensions(): Promise<SystemExtensionsResponse> {
  return apiGet<SystemExtensionsResponse>("/api/system/extensions");
}

export async function apiSystemExtensionInstall(
  extId: string,
): Promise<{ ok: boolean; message: string }> {
  return apiPost<{ ok: boolean; message: string }>(
    `/api/system/extensions/${encodeURIComponent(extId)}/install`,
    {},
  );
}

export async function apiSystemExtensionManualPathPut(
  extId: string,
  body: { path: string; location_kind: "dir" | "file" },
): Promise<{ ok: boolean; extensions: SystemExtensionStatus[] }> {
  return apiPut<{ ok: boolean; extensions: SystemExtensionStatus[] }>(
    `/api/system/extensions/${encodeURIComponent(extId)}/manual-path`,
    body,
  );
}

export async function apiSystemExtensionManualPathDelete(
  extId: string,
): Promise<{ ok: boolean; extensions: SystemExtensionStatus[] }> {
  return apiDelete<{ ok: boolean; extensions: SystemExtensionStatus[] }>(
    `/api/system/extensions/${encodeURIComponent(extId)}/manual-path`,
  );
}

// --- Agent (M3) ---
export type AgentLlmProvider = "openai" | "anthropic" | "openai_compat" | "deepseek";

export type AgentConfigProviderOption = { id: AgentLlmProvider };

export type AgentLlmReasoningEffort = "high" | "max";

export type AgentConfig = {
  llm_configured: boolean;
  provider: AgentLlmProvider;
  main_model: string;
  fast_model: string;
  base_url_set: boolean;
  safety_mode?: string;
  reasoning_effort?: AgentLlmReasoningEffort;
};

export async function apiAgentConfig(): Promise<AgentConfig> {
  return apiGet<AgentConfig>("/api/agent/config");
}

export type AgentLlmSettingsResponse = {
  persist_available: boolean;
  /** `global`：未打开项目，写入本机用户目录；`project`：已打开项目，写入项目内文件 */
  persist_scope?: "global" | "project";
  provider: AgentLlmProvider;
  provider_options: AgentConfigProviderOption[];
  main_model: string;
  fast_model: string;
  base_url: string;
  llm_configured: boolean;
  api_key_masked: string | null;
  has_user_api_key_override?: boolean;
  has_project_api_key_override: boolean;
  max_tokens?: number;
  reasoning_effort?: AgentLlmReasoningEffort;
};

export async function apiAgentLlmSettingsGet(): Promise<AgentLlmSettingsResponse> {
  return apiGet<AgentLlmSettingsResponse>("/api/agent/llm-settings");
}

export async function apiAgentLlmSettingsPut(body: {
  provider?: AgentLlmProvider | null;
  main_model?: string | null;
  fast_model?: string | null;
  base_url?: string | null;
  api_key?: string | null;
  clear_api_key_override?: boolean;
  max_tokens?: number | null;
  reasoning_effort?: AgentLlmReasoningEffort | null;
}): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>("/api/agent/llm-settings", body);
}

export type AgentSafetyModeOption = {
  id: string;
  label: string;
  description: string;
};

export type AgentSafetyModeResponse = {
  persist_available: boolean;
  persist_scope?: "global" | "project";
  mode: string;
  options: AgentSafetyModeOption[];
};

export async function apiAgentSafetyModeGet(): Promise<AgentSafetyModeResponse> {
  return apiGet<AgentSafetyModeResponse>("/api/agent/safety-mode");
}

export async function apiAgentSafetyModePut(mode: string): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>("/api/agent/safety-mode", { mode });
}

export async function apiAgentCreateSession(): Promise<{ session_id: string }> {
  return apiPost<{ session_id: string }>("/api/agent/sessions", {});
}

export type AgentSessionListItem = {
  session_id: string;
  updated_at: string;
  message_count: number;
  title: string;
};

export async function apiAgentSessionsList(): Promise<{ sessions: AgentSessionListItem[] }> {
  return apiGet<{ sessions: AgentSessionListItem[] }>("/api/agent/sessions");
}

export type AgentSessionSnapshot = {
  session: {
    session_id: string;
    messages: Array<{
      role: string;
      content?: string | null;
      tool_calls?: unknown;
      tool_call_id?: string | null;
      name?: string | null;
    }>;
  };
};

export async function apiAgentSessionGet(sessionId: string): Promise<AgentSessionSnapshot> {
  return apiGet<AgentSessionSnapshot>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
}

export async function apiAgentSessionCancel(sessionId: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
}

export async function apiAgentSessionDelete(sessionId: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
}

export type AgentSkillInfo = {
  id: string;
  label: string;
  description: string;
  suggested_user_input: string;
};

export async function apiAgentSkillsList(): Promise<{ skills: AgentSkillInfo[] }> {
  return apiGet<{ skills: AgentSkillInfo[] }>("/api/agent/skills");
}

export async function apiAgentMemoryIndexGet(): Promise<{ content: string }> {
  return apiGet<{ content: string }>("/api/agent/memory");
}

export async function apiAgentMemoryIndexPut(content: string): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>("/api/agent/memory", { content });
}

export async function apiAgentMemoryTopicList(): Promise<{ topics: string[] }> {
  return apiGet<{ topics: string[] }>("/api/agent/memory/topics");
}

export async function apiAgentMemoryTopicGet(topic: string): Promise<{ topic: string; content: string }> {
  const t = topic.endsWith(".md") ? topic : `${topic}.md`;
  return apiGet<{ topic: string; content: string }>(`/api/agent/memory/${encodeURIComponent(t)}`);
}

export async function apiAgentMemoryTopicPut(topic: string, content: string): Promise<{ ok: boolean }> {
  const t = topic.endsWith(".md") ? topic : `${topic}.md`;
  return apiPut<{ ok: boolean }>(`/api/agent/memory/${encodeURIComponent(t)}`, { content });
}

export type AgentPageContextForApi = {
  current_page: string;
  selected_resource_type?: string | null;
  selected_resource_id?: string | null;
  summary?: string | null;
};

export type AgentFileAttachment = {
  path: string;
  mime_type: string | null;
  original_name: string;
};

export type AgentChatStreamBody = {
  session_id?: string | null;
  message?: string | null;
  mode?: string;
  confirm_action_id?: string | null;
  confirm_accepted?: boolean | null;
  /** 教师当前界面与选中资源，供助手理解上下文 */
  page_context?: AgentPageContextForApi | null;
  /** 内置技能，收窄助手能力范围 */
  skill_id?: string | null;
  /** 附件文件列表 */
  file_attachments?: AgentFileAttachment[] | null;
  /** 教师批准执行的计划文件项目内相对路径 */
  execution_plan_path?: string | null;
  /** 取消界面待执行计划时，与计划路径一致则清除服务端状态 */
  clear_pending_plan_path?: string | null;
  /** 本轮结束后不写入会话记忆 */
  skip_memory_write?: boolean | null;
};

/** Parse SSE lines; invokes onEvent(eventName, dataObj) for each complete event. */
export async function apiAgentChatStream(
  body: AgentChatStreamBody,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  await ensureApiBase();
  const r = await fetch(joinApi("/api/agent/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!r.ok) {
    const parsed = await parseDetailFromResponse(r);
    throw new ApiError(parsed.message, r.status, { examSaved: parsed.examSaved });
  }
  const reader = r.body?.getReader();
  if (!reader) throw new Error(i18n.t("noResponseStream", { ns: "common" }));
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        try {
          const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
          onEvent(ev, data);
        } catch {
          onEvent(ev, { raw: dataLines.join("\n") });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

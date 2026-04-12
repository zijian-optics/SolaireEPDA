import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { apiPost } from "../api/client";

function isPickCanceledMessage(msg: string) {
  return (
    msg.includes("取消") ||
    msg.includes("未选择") ||
    /cancel(ed)?/i.test(msg) ||
    /user cancel/i.test(msg) ||
    /not select/i.test(msg)
  );
}

export function ProjectPanel({
  onDone,
  onError,
}: {
  onDone: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const [root, setRoot] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("my_exam_project");
  const [busy, setBusy] = useState(false);

  async function openProject() {
    onError(null);
    setBusy(true);
    try {
      await apiPost("/api/project/open", { root: root.trim() });
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickOpenFolder() {
    onError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; root: string }>("/api/project/pick-open", {});
      setRoot(res.root);
      await onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPickCanceledMessage(msg)) {
        onError(null);
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickParentFolder() {
    onError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; path: string }>("/api/project/pick-parent", {});
      setParent(res.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPickCanceledMessage(msg)) {
        onError(null);
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    onError(null);
    setBusy(true);
    try {
      await apiPost("/api/project/create", { parent: parent.trim(), name: name.trim() });
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mt-0 font-semibold text-slate-900">{t("app:project.openTitle")}</h2>
      <p className="text-sm text-slate-600">
        {t("app:project.openIntroBefore")}
        <strong>{t("app:project.openIntroStrong")}</strong>
        {t("app:project.openIntroMid")}
        <code className="rounded bg-slate-100 px-1">SOLAIRE_PROJECT_ROOT</code>
        {t("app:project.openIntroAnd")}
        <code className="rounded bg-slate-100 px-1">SOLAIRE_BIND_PROJECT_FROM_ENV=1</code>
        {t("app:project.openIntroAfter")}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => void pickOpenFolder()}
        >
          <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t("app:project.pickFolder")}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          {t("app:project.rootLabel")}
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder={t("app:project.rootPlaceholder")}
          />
        </label>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-800 disabled:opacity-50"
          disabled={busy || !root.trim()}
          onClick={() => void openProject()}
        >
          {t("app:project.openButton")}
        </button>
      </div>

      <h2 className="mt-10 font-semibold text-slate-900">{t("app:project.newTitle")}</h2>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => void pickParentFolder()}
        >
          <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t("app:project.pickParent")}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          {t("app:project.parentLabel")}
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            placeholder={t("app:project.parentPlaceholder")}
          />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-slate-600">
          {t("app:project.folderName")}
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={busy || !parent.trim() || !name.trim()}
          onClick={() => void createProject()}
        >
          {t("app:project.createButton")}
        </button>
      </div>
    </div>
  );
}

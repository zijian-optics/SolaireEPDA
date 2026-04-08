import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  X,
} from "lucide-react";
import {
  apiSystemExtensionInstall,
  apiSystemExtensions,
  ensureApiBase,
  type SystemExtensionStatus,
} from "../api/client";
import { cn } from "../lib/utils";

function extensionDisplayReady(ext: SystemExtensionStatus): boolean {
  if (ext.id === "tesseract") {
    return ext.ocr_ready === true;
  }
  return ext.ready;
}

function ExtensionCard({
  ext,
  onInstallClick,
  installBusyId,
  recheckBusy,
}: {
  ext: SystemExtensionStatus;
  onInstallClick: (id: string) => void;
  installBusyId: string | null;
  recheckBusy: boolean;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const ready = extensionDisplayReady(ext);
  const busy = installBusyId === ext.id;

  const showOcrPartial =
    ext.id === "tesseract" && ext.ready === true && ext.ocr_ready === false;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 shadow-sm",
        ready ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            ready ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
          )}
        >
          <Package className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-900">{ext.name}</h3>
            {ready ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("ext.ready")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                <AlertCircle className="h-3.5 w-3.5" />
                {t("ext.notInstalled")}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{ext.description}</p>
          {showOcrPartial ? (
            <p className="mt-2 text-xs text-amber-900">{t("ext.ocrPartial")}</p>
          ) : null}
          {ext.install_hint && !ready && ext.id === "mmdr" ? (
            <p className="mt-2 text-xs text-slate-600">{ext.install_hint}</p>
          ) : null}
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {ext.executables.map((e) => (
              <li key={e.name} className="break-all">
                <span className="font-medium text-slate-700">{e.name}</span>
                {e.on_path ? (
                  <>
                    {" · "}
                    {t("ext.version")}: {e.version ?? "—"}
                    {e.path ? (
                      <>
                        {" · "}
                        {t("ext.path")}: {e.path}
                      </>
                    ) : null}
                  </>
                ) : (
                  <> — {t("ext.missingExe")}</>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 pl-[52px]">
        <a
          href={ext.download_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("ext.manualDownload")}
        </a>
        {ext.can_auto_install ? (
          <button
            type="button"
            disabled={busy || recheckBusy}
            onClick={() => onInstallClick(ext.id)}
            className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy ? t("ext.installing") : t("ext.autoInstall")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type Props = {
  onError: (msg: string | null) => void;
};

export function ExtensionsPanel({ onError }: Props) {
  const { t } = useTranslation(["settings", "common"]);
  const [extensions, setExtensions] = useState<SystemExtensionStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [recheckBusy, setRecheckBusy] = useState(false);
  const [installBusyId, setInstallBusyId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installPhase, setInstallPhase] = useState<"loading" | "done">("loading");
  const [installTitle, setInstallTitle] = useState("");
  const [installDetail, setInstallDetail] = useState("");
  const [installOk, setInstallOk] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      await ensureApiBase();
      const data = await apiSystemExtensions();
      setExtensions(data.extensions);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setExtensions(null);
    }
  }, [onError]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const handleRecheck = async () => {
    setRecheckBusy(true);
    onError(null);
    try {
      await ensureApiBase();
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecheckBusy(false);
    }
  };

  const runInstall = async (extId: string) => {
    setInstallOpen(true);
    setInstallPhase("loading");
    setInstallTitle(t("ext.installDialogTitle"));
    setInstallDetail(t("ext.installDialogProgress"));
    setInstallOk(false);
    setInstallBusyId(extId);
    onError(null);
    try {
      await ensureApiBase();
      const r = await apiSystemExtensionInstall(extId);
      setInstallPhase("done");
      setInstallOk(r.ok);
      setInstallDetail(r.message);
      if (!r.ok) {
        onError(r.message);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setInstallPhase("done");
      setInstallOk(false);
      setInstallDetail(t("ext.installFailed", { message: m }));
      onError(m);
    } finally {
      setInstallBusyId(null);
    }
  };

  const handleInstallClick = (extId: string) => {
    void runInstall(extId);
  };

  if (loading && !extensions) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t("ext.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={recheckBusy}
          onClick={() => void handleRecheck()}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {recheckBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("ext.recheck")}
        </button>
      </div>

      <div className="space-y-3">
        {(extensions ?? []).map((ext) => (
          <ExtensionCard
            key={ext.id}
            ext={ext}
            onInstallClick={handleInstallClick}
            installBusyId={installBusyId}
            recheckBusy={recheckBusy}
          />
        ))}
      </div>

      <Dialog.Root
        open={installOpen}
        onOpenChange={(open) => {
          setInstallOpen(open);
          if (!open && installOk) {
            void handleRecheck();
          }
          if (!open) {
            setInstallPhase("loading");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <Dialog.Title className="text-base font-semibold text-slate-900">{installTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label={t("close", { ns: "common" })}
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-3 text-sm text-slate-600">
              {installPhase === "loading" ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-violet-600" />
                  {installDetail}
                </span>
              ) : (
                <span className={installOk ? "text-emerald-800" : "text-amber-900"}>{installDetail}</span>
              )}
            </Dialog.Description>
            {installPhase === "done" ? (
              <div className="mt-4 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
                  >
                    {t("ext.installDialogClose")}
                  </button>
                </Dialog.Close>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

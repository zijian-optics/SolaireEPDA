import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderInput, Loader2 } from "lucide-react";
import {
  apiAgentLlmSettingsGet,
  apiAgentSafetyModeGet,
  apiAgentSafetyModePut,
  apiPost,
  type AgentLlmSettingsResponse,
  type AgentSafetyModeOption,
} from "../api/client";
import {
  AgentModelSettingsForm,
  type AgentModelSettingsFormHandle,
} from "../components/settings/AgentModelSettingsForm";
import { ExtensionsPanel } from "../components/ExtensionsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAgentContext } from "../contexts/AgentContext";
import { changeAppLanguage } from "../i18n/changeLanguage";
import type { AppLang } from "../i18n/tauriLocale";
import { SOLAIRE_SAVE_EVENT } from "../lib/saveEvents";

export function SettingsWorkspace({
  onError,
  onSwitchProject,
}: {
  onError: (msg: string | null) => void;
  /** 已打开项目时可选：切换项目并回到欢迎页 */
  onSwitchProject?: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { setPageContext } = useAgentContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AgentLlmSettingsResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [safetyMode, setSafetyMode] = useState("allegro");
  const [safetyOptions, setSafetyOptions] = useState<AgentSafetyModeOption[]>([]);
  const [settingsTab, setSettingsTab] = useState("model");
  const modelFormRef = useRef<AgentModelSettingsFormHandle>(null);

  useEffect(() => {
    setPageContext({
      current_page: "settings",
      summary: settingsTab === "extensions" ? t("ext.pageSummary") : t("pageSummary"),
    });
    return () => setPageContext(null);
  }, [setPageContext, t, settingsTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    onError(null);
    try {
      const [r, safety] = await Promise.all([apiAgentLlmSettingsGet(), apiAgentSafetyModeGet()]);
      setData(r);
      setSafetyMode(safety.mode);
      setSafetyOptions(safety.options ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onSave = () => {
      if (settingsTab !== "model" || !data || loading) return;
      void modelFormRef.current?.save();
    };
    window.addEventListener(SOLAIRE_SAVE_EVENT, onSave);
    return () => window.removeEventListener(SOLAIRE_SAVE_EVENT, onSave);
  }, [settingsTab, data, loading]);

  const handleSwitchProject = async () => {
    if (!onSwitchProject) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      await apiPost("/api/project/close", {});
      await onSwitchProject();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSafetyMode = async () => {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      await apiAgentSafetyModePut(safetyMode);
      setMsg(t("settings:updatedSafety"));
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const uiLang: AppLang = i18n.language.startsWith("en") ? "en" : "zh";

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("intro")}</p>
        </div>
        {onSwitchProject && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSwitchProject()}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <FolderInput className="h-4 w-4" />
            {t("settings:switchProject")}
          </button>
        )}
      </div>

      <Tabs value={settingsTab} onValueChange={setSettingsTab} className="mt-6">
        <TabsList className="mb-1 w-full max-w-lg sm:w-auto">
          <TabsTrigger value="model" className="flex-1 sm:flex-none">
            {t("settings:tabModel")}
          </TabsTrigger>
          <TabsTrigger value="extensions" className="flex-1 sm:flex-none">
            {t("settings:tabExtensions")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extensions" className="mx-auto max-w-2xl">
          <h2 className="sr-only">{t("ext.title")}</h2>
          <ExtensionsPanel onError={onError} />
        </TabsContent>

        <TabsContent value="model" className="mx-auto max-w-lg">
          {loading ? (
            <div className="mt-4 flex items-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("settings:loading")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <label className="block text-sm font-medium text-slate-700">{t("settings:uiLanguage")}</label>
                <select
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={uiLang}
                  onChange={(e) => void changeAppLanguage(e.target.value as AppLang)}
                >
                  <option value="zh">{t("settings:langZh")}</option>
                  <option value="en">{t("settings:langEn")}</option>
                </select>
              </div>

              {data ? (
                data.persist_scope === "global" ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {t("settings:saveScopeGlobalHint")}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {t("settings:saveScopeProjectHint")}
                  </div>
                )
              ) : null}

              <AgentModelSettingsForm
                ref={modelFormRef}
                variant="settings"
                data={data}
                loading={false}
                saving={saving}
                onError={onError}
                onReload={load}
              />

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <label className="block text-sm font-medium text-slate-700">{t("settings:safetyTitle")}</label>
                <p className="mt-0.5 text-xs text-slate-500">{t("settings:safetyHint")}</p>
                <div className="mt-2 space-y-2">
                  {safetyOptions.map((op) => (
                    <label
                      key={op.id}
                      className={`block cursor-pointer rounded-md border px-3 py-2 text-sm ${
                        safetyMode === op.id ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-white"
                      } ${loading || !data || saving ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="agent-safety-mode"
                          value={op.id}
                          checked={safetyMode === op.id}
                          disabled={loading || !data || saving}
                          onChange={(e) => setSafetyMode(e.target.value)}
                        />
                        <span className="font-medium text-slate-800">
                          {t(`safetyOption.${op.id}.label`, { defaultValue: op.label })}
                        </span>
                      </div>
                      <div className="mt-1 pl-6 text-xs text-slate-600">
                        {t(`safetyOption.${op.id}.desc`, { defaultValue: op.description })}
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={loading || !data || saving}
                    onClick={() => void handleSaveSafetyMode()}
                    className="inline-flex items-center gap-2 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  >
                    {t("settings:saveSafety")}
                  </button>
                </div>
              </div>

              {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

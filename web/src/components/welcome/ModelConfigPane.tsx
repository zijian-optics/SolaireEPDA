import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, Trash2 } from "lucide-react";
import {
  apiAgentLlmSettingsGet,
  apiAgentLlmSettingsPut,
  apiAgentSafetyModeGet,
  apiAgentSafetyModePut,
  type AgentLlmSettingsResponse,
  type AgentSafetyModeOption,
} from "../../api/client";
import { changeAppLanguage } from "../../i18n/changeLanguage";
import i18n from "../../i18n/i18n";
import type { AppLang } from "../../i18n/tauriLocale";

/** 全局模型与安全策略配置（与设置页模型分区一致） */
export function ModelConfigPane({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useTranslation(["settings", "common"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AgentLlmSettingsResponse | null>(null);
  const [mainModel, setMainModel] = useState("");
  const [fastModel, setFastModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [safetyMode, setSafetyMode] = useState("allegro");
  const [safetyOptions, setSafetyOptions] = useState<AgentSafetyModeOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    onError(null);
    try {
      const [r, safety] = await Promise.all([apiAgentLlmSettingsGet(), apiAgentSafetyModeGet()]);
      setData(r);
      setMainModel(r.main_model);
      setFastModel(r.fast_model);
      setBaseUrl(r.base_url);
      setAccessSecret("");
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

  const keySourceNote = useMemo(() => {
    if (!data) return "";
    if (data.has_project_api_key_override && data.has_user_api_key_override) {
      return t("settings:accessKeySourceBoth");
    }
    if (data.has_project_api_key_override) return t("settings:accessKeySourceProject");
    if (data.has_user_api_key_override) return t("settings:accessKeySourceUser");
    return "";
  }, [data, t]);

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      const body: Parameters<typeof apiAgentLlmSettingsPut>[0] = {
        main_model: mainModel,
        fast_model: fastModel,
        base_url: baseUrl,
      };
      if (accessSecret.trim()) {
        body.api_key = accessSecret.trim();
      }
      await apiAgentLlmSettingsPut(body);
      setAccessSecret("");
      setMsg(data.persist_scope === "project" ? t("settings:savedProject") : t("settings:savedGlobal"));
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClearSecret = async () => {
    if (!data) return;
    const confirmKey =
      data.persist_scope === "project" ? "settings:confirmClearKey" : "settings:confirmClearKeyUser";
    if (!confirm(t(confirmKey))) return;
    setSaving(true);
    setMsg(null);
    onError(null);
    try {
      await apiAgentLlmSettingsPut({ clear_api_key_override: true });
      setAccessSecret("");
      setMsg(data.persist_scope === "project" ? t("settings:clearedKey") : t("settings:clearedKeyUser"));
      await load();
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
    <div className="max-h-full overflow-auto pr-1">
      {loading ? (
        <div className="flex items-center gap-2 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("settings:loading")}
        </div>
      ) : (
        <div className="space-y-4 text-slate-100">
          <div className="rounded-lg border border-slate-600/80 bg-slate-900/40 p-4">
            <label className="block text-sm font-medium text-slate-200">{t("settings:uiLanguage")}</label>
            <select
              className="mt-2 w-full rounded-md border border-slate-500 bg-slate-950/50 px-3 py-2 text-sm text-slate-100"
              value={uiLang}
              onChange={(e) => void changeAppLanguage(e.target.value as AppLang)}
            >
              <option value="zh">{t("settings:langZh")}</option>
              <option value="en">{t("settings:langEn")}</option>
            </select>
          </div>

          {data ? (
            data.persist_scope === "global" ? (
              <div className="rounded-lg border border-slate-500/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                {t("settings:saveScopeGlobalHint")}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-500/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                {t("settings:saveScopeProjectHint")}
              </div>
            )
          ) : null}

          <div className="rounded-lg border border-slate-600/80 bg-slate-900/40 p-4">
            <label className="block text-sm font-medium text-slate-200">{t("settings:modelBaseUrl")}</label>
            <p className="mt-0.5 text-xs text-slate-400">{t("settings:modelBaseUrlHint")}</p>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={loading || !data || saving}
              placeholder="https://…"
              className="mt-2 w-full rounded-md border border-slate-500 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            />
          </div>

          <div className="rounded-lg border border-slate-600/80 bg-slate-900/40 p-4">
            <label className="block text-sm font-medium text-slate-200">{t("settings:mainModel")}</label>
            <input
              type="text"
              value={mainModel}
              onChange={(e) => setMainModel(e.target.value)}
              disabled={loading || !data || saving}
              className="mt-2 w-full rounded-md border border-slate-500 bg-slate-950/50 px-3 py-2 font-mono text-sm text-slate-100 disabled:opacity-50"
            />
          </div>

          <div className="rounded-lg border border-slate-600/80 bg-slate-900/40 p-4">
            <label className="block text-sm font-medium text-slate-200">{t("settings:fastModel")}</label>
            <p className="mt-0.5 text-xs text-slate-400">{t("settings:fastModelHint")}</p>
            <input
              type="text"
              value={fastModel}
              onChange={(e) => setFastModel(e.target.value)}
              disabled={loading || !data || saving}
              className="mt-2 w-full rounded-md border border-slate-500 bg-slate-950/50 px-3 py-2 font-mono text-sm text-slate-100 disabled:opacity-50"
            />
          </div>

          <div className="rounded-lg border border-slate-600/80 bg-slate-900/40 p-4">
            <label className="block text-sm font-medium text-slate-200">{t("settings:accessKey")}</label>
            <p className="mt-0.5 text-xs text-slate-400">
              {t("settings:accessKeyHint", {
                masked: data?.api_key_masked ?? t("settings:notConfigured"),
              })}
              {keySourceNote ? ` ${keySourceNote}` : ""}
            </p>
            <input
              type="password"
              value={accessSecret}
              onChange={(e) => setAccessSecret(e.target.value)}
              disabled={loading || !data || saving}
              placeholder={data ? t("settings:accessKeyPlaceholder") : ""}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-slate-500 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            />
          </div>

          <div className="rounded-lg border border-slate-600/80 bg-slate-900/40 p-4">
            <label className="block text-sm font-medium text-slate-200">{t("settings:safetyTitle")}</label>
            <p className="mt-0.5 text-xs text-slate-400">{t("settings:safetyHint")}</p>
            <div className="mt-2 space-y-2">
              {safetyOptions.map((op) => (
                <label
                  key={op.id}
                  className={`block cursor-pointer rounded-md border px-3 py-2 text-sm ${
                    safetyMode === op.id ? "border-violet-400/60 bg-violet-950/50" : "border-slate-600 bg-slate-950/30"
                  } ${loading || !data || saving ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="welcome-agent-safety-mode"
                      value={op.id}
                      checked={safetyMode === op.id}
                      disabled={loading || !data || saving}
                      onChange={(e) => setSafetyMode(e.target.value)}
                    />
                    <span className="font-medium text-slate-100">
                      {t(`safetyOption.${op.id}.label`, { defaultValue: op.label })}
                    </span>
                  </div>
                  <div className="mt-1 pl-6 text-xs text-slate-400">
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
                className="inline-flex items-center gap-2 rounded-md border border-violet-500/50 bg-violet-950/40 px-3 py-1.5 text-sm text-violet-100 hover:bg-violet-950/60 disabled:opacity-50"
              >
                {t("settings:saveSafety")}
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500">{t("settings:footerNote")}</p>

          {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading || !data || saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {data?.persist_scope === "project" ? t("settings:saveToProject") : t("settings:saveToProfile")}
            </button>
            {data?.persist_scope === "project" && data.has_project_api_key_override && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleClearSecret()}
                className="inline-flex items-center gap-2 rounded-md border border-slate-500 bg-slate-900/50 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {t("settings:clearProjectKey")}
              </button>
            )}
            {data?.persist_scope === "global" && data.has_user_api_key_override && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleClearSecret()}
                className="inline-flex items-center gap-2 rounded-md border border-slate-500 bg-slate-900/50 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {t("settings:clearUserKey")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

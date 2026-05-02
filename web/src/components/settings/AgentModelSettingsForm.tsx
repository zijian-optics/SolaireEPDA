import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, Trash2 } from "lucide-react";
import {
  apiAgentLlmSettingsPut,
  type AgentLlmProvider,
  type AgentLlmReasoningEffort,
  type AgentLlmSettingsResponse,
} from "../../api/client";

const PRESETS: Record<AgentLlmProvider, { baseUrl: string; main: string; fast: string }> = {
  openai: { baseUrl: "", main: "gpt-4o-mini", fast: "gpt-4o-mini" },
  anthropic: {
    baseUrl: "",
    main: "claude-sonnet-4-20250514",
    fast: "claude-3-5-haiku-20241022",
  },
  openai_compat: { baseUrl: "", main: "gpt-4o-mini", fast: "gpt-4o-mini" },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    main: "deepseek-v4-pro",
    fast: "deepseek-v4-flash",
  },
};

const PROVIDER_DISPLAY_ORDER: AgentLlmProvider[] = ["deepseek", "openai", "anthropic", "openai_compat"];

function sortProviderIds(ids: AgentLlmProvider[]): AgentLlmProvider[] {
  const rank = new Map(PROVIDER_DISPLAY_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

function providerLabelKey(id: AgentLlmProvider): string {
  switch (id) {
    case "openai":
      return "settings:providerOpenai";
    case "anthropic":
      return "settings:providerAnthropic";
    case "openai_compat":
      return "settings:providerOpenaiCompat";
    case "deepseek":
      return "settings:providerDeepseek";
    default:
      return "settings:providerOpenaiCompat";
  }
}

function providerDescKey(id: AgentLlmProvider): string {
  switch (id) {
    case "openai":
      return "settings:providerOpenaiDesc";
    case "anthropic":
      return "settings:providerAnthropicDesc";
    case "openai_compat":
      return "settings:providerOpenaiCompatDesc";
    case "deepseek":
      return "settings:providerDeepseekDesc";
    default:
      return "settings:providerOpenaiCompatDesc";
  }
}

type Variant = "welcome" | "settings";

export type AgentModelSettingsFormHandle = {
  save: () => Promise<void>;
};

export const AgentModelSettingsForm = forwardRef(function AgentModelSettingsForm(
  {
    variant,
    data,
    loading,
    saving,
    onError,
    onReload,
  }: {
    variant: Variant;
    data: AgentLlmSettingsResponse | null;
    loading: boolean;
    saving: boolean;
    onError: (msg: string | null) => void;
    onReload: () => Promise<void>;
  },
  ref: Ref<AgentModelSettingsFormHandle>,
) {
  const { t } = useTranslation(["settings", "common"]);
  const [provider, setProvider] = useState<AgentLlmProvider>("openai_compat");
  const [mainModel, setMainModel] = useState("");
  const [fastModel, setFastModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<AgentLlmReasoningEffort>("high");
  const [msg, setMsg] = useState<string | null>(null);
  const [savingLocal, setSavingLocal] = useState(false);

  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setMainModel(data.main_model);
    setFastModel(data.fast_model);
    setBaseUrl(data.base_url);
    setAccessSecret("");
    setReasoningEffort(data.reasoning_effort === "max" ? "max" : "high");
  }, [data?.provider, data?.main_model, data?.fast_model, data?.base_url, data?.reasoning_effort]);

  const keySourceNote = useMemo(() => {
    if (!data) return "";
    if (data.has_project_api_key_override && data.has_user_api_key_override) {
      return t("settings:accessKeySourceBoth");
    }
    if (data.has_project_api_key_override) return t("settings:accessKeySourceProject");
    if (data.has_user_api_key_override) return t("settings:accessKeySourceUser");
    return "";
  }, [data, t]);

  const selectProvider = useCallback((p: AgentLlmProvider) => {
    setProvider(p);
    const pr = PRESETS[p];
    setBaseUrl(pr.baseUrl);
    setMainModel(pr.main);
    setFastModel(pr.fast);
  }, []);

  const applyRecommended = useCallback(() => {
    const pr = PRESETS[provider];
    setBaseUrl(pr.baseUrl);
    setMainModel(pr.main);
    setFastModel(pr.fast);
  }, [provider]);

  const busy = saving || savingLocal;

  const card =
    variant === "welcome"
      ? "rounded-lg border border-slate-600/80 bg-slate-900/40 p-4"
      : "rounded-lg border border-slate-200 bg-white p-4 shadow-sm";
  const labelCls =
    variant === "welcome" ? "block text-sm font-medium text-slate-200" : "block text-sm font-medium text-slate-700";
  const hintCls = variant === "welcome" ? "mt-0.5 text-xs text-slate-400" : "mt-0.5 text-xs text-slate-500";
  const inputCls =
    variant === "welcome"
      ? "mt-2 w-full rounded-md border border-slate-500 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
      : "mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50";
  const monoInput = `${inputCls} font-mono`;
  const radioBorder = (active: boolean) =>
    variant === "welcome"
      ? active
        ? "border-violet-400/60 bg-violet-950/50"
        : "border-slate-600 bg-slate-950/30"
      : active
        ? "border-violet-300 bg-violet-50"
        : "border-slate-200 bg-white";

  const ids = useMemo(() => {
    const raw =
      data?.provider_options?.length && data.provider_options.length > 0
        ? data.provider_options.map((o) => o.id as AgentLlmProvider)
        : PROVIDER_DISPLAY_ORDER;
    return sortProviderIds(raw);
  }, [data?.provider_options]);

  const handleSave = useCallback(async () => {
    if (!data) return;
    setSavingLocal(true);
    setMsg(null);
    onError(null);
    try {
      const body: Parameters<typeof apiAgentLlmSettingsPut>[0] = {
        provider,
        main_model: mainModel,
        fast_model: fastModel,
        base_url: baseUrl,
      };
      if (provider === "deepseek") {
        body.reasoning_effort = reasoningEffort;
      }
      if (accessSecret.trim()) {
        body.api_key = accessSecret.trim();
      }
      await apiAgentLlmSettingsPut(body);
      setAccessSecret("");
      setMsg(data.persist_scope === "project" ? t("settings:savedProject") : t("settings:savedGlobal"));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLocal(false);
    }
  }, [
    data,
    provider,
    mainModel,
    fastModel,
    baseUrl,
    accessSecret,
    reasoningEffort,
    onError,
    onReload,
    t,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
    }),
    [handleSave],
  );

  const handleClearSecret = async () => {
    if (!data) return;
    const confirmKey =
      data.persist_scope === "project" ? "settings:confirmClearKey" : "settings:confirmClearKeyUser";
    if (!confirm(t(confirmKey))) return;
    setSavingLocal(true);
    setMsg(null);
    onError(null);
    try {
      await apiAgentLlmSettingsPut({ clear_api_key_override: true });
      setAccessSecret("");
      setMsg(data.persist_scope === "project" ? t("settings:clearedKey") : t("settings:clearedKeyUser"));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLocal(false);
    }
  };

  if (loading || !data) {
    return (
      <div
        className={
          variant === "welcome"
            ? "flex items-center gap-2 text-slate-300"
            : "mt-4 flex items-center gap-2 text-slate-500"
        }
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("settings:loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <label className={labelCls}>{t("settings:providerTitle")}</label>
        <p className={hintCls}>{t("settings:providerHint")}</p>
        <div className="mt-2 space-y-2">
          {ids.map((id) => (
            <label
              key={id}
              className={`block cursor-pointer rounded-md border px-3 py-2 text-sm ${
                provider === id ? radioBorder(true) : radioBorder(false)
              } ${busy ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`model-provider-${variant}`}
                  value={id}
                  checked={provider === id}
                  disabled={busy}
                  onChange={() => selectProvider(id as AgentLlmProvider)}
                />
                <span className={variant === "welcome" ? "font-medium text-slate-100" : "font-medium text-slate-800"}>
                  {t(providerLabelKey(id as AgentLlmProvider))}
                </span>
              </div>
              <div className={`mt-1 pl-6 text-xs ${variant === "welcome" ? "text-slate-400" : "text-slate-600"}`}>
                {t(providerDescKey(id as AgentLlmProvider))}
              </div>
            </label>
          ))}
        </div>
        {provider === "deepseek" ? (
          <div className="mt-3">
            <span className={labelCls}>{t("settings:thinkingEffortTitle")}</span>
            <p className={hintCls}>{t("settings:thinkingEffortHint")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                aria-pressed={reasoningEffort === "high"}
                data-testid="thinking-effort-high"
                onClick={() => setReasoningEffort("high")}
                className={
                  variant === "welcome"
                    ? reasoningEffort === "high"
                      ? "rounded-md border border-violet-400/70 bg-violet-950/40 px-3 py-1.5 text-sm text-violet-100"
                      : "rounded-md border border-slate-600 bg-slate-950/30 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900/50"
                    : reasoningEffort === "high"
                      ? "rounded-md border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm text-violet-900"
                      : "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                }
              >
                {t("settings:thinkingEffortHigh")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={reasoningEffort === "max"}
                data-testid="thinking-effort-max"
                onClick={() => setReasoningEffort("max")}
                className={
                  variant === "welcome"
                    ? reasoningEffort === "max"
                      ? "rounded-md border border-violet-400/70 bg-violet-950/40 px-3 py-1.5 text-sm text-violet-100"
                      : "rounded-md border border-slate-600 bg-slate-950/30 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900/50"
                    : reasoningEffort === "max"
                      ? "rounded-md border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm text-violet-900"
                      : "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                }
              >
                {t("settings:thinkingEffortMax")}
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void applyRecommended()}
            className={
              variant === "welcome"
                ? "text-sm text-violet-300 underline-offset-2 hover:underline disabled:opacity-50"
                : "text-sm text-violet-700 underline-offset-2 hover:underline disabled:opacity-50"
            }
          >
            {t("settings:applyRecommended")}
          </button>
        </div>
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:modelBaseUrl")}</label>
        <p className={hintCls}>{t("settings:modelBaseUrlHint")}</p>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={busy}
          placeholder="https://…"
          className={inputCls}
        />
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:mainModel")}</label>
        <input type="text" value={mainModel} onChange={(e) => setMainModel(e.target.value)} disabled={busy} className={monoInput} />
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:fastModel")}</label>
        <p className={hintCls}>{t("settings:fastModelHint")}</p>
        <input type="text" value={fastModel} onChange={(e) => setFastModel(e.target.value)} disabled={busy} className={monoInput} />
      </div>

      <div className={card}>
        <label className={labelCls}>{t("settings:accessKey")}</label>
        <p className={hintCls}>
          {t("settings:accessKeyHint", {
            masked: data?.api_key_masked ?? t("settings:notConfigured"),
          })}
          {keySourceNote ? ` ${keySourceNote}` : ""}
        </p>
        <input
          type="password"
          value={accessSecret}
          onChange={(e) => setAccessSecret(e.target.value)}
          disabled={busy}
          placeholder={data ? t("settings:accessKeyPlaceholder") : ""}
          autoComplete="off"
          className={inputCls}
        />
      </div>

      <p className={variant === "welcome" ? "text-xs text-slate-500" : "text-xs text-slate-500"}>{t("settings:footerNote")}</p>

      {msg ? (
        <p className={variant === "welcome" ? "text-sm text-emerald-300" : "text-sm text-emerald-700"}>{msg}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSave()}
          className={
            variant === "welcome"
              ? "inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              : "inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          }
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {data?.persist_scope === "project" ? t("settings:saveToProject") : t("settings:saveToProfile")}
        </button>
        {data?.persist_scope === "project" && data.has_project_api_key_override && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClearSecret()}
            className={
              variant === "welcome"
                ? "inline-flex items-center gap-2 rounded-md border border-slate-500 bg-slate-900/50 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                : "inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            }
          >
            <Trash2 className="h-4 w-4" />
            {t("settings:clearProjectKey")}
          </button>
        )}
        {data?.persist_scope === "global" && data.has_user_api_key_override && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClearSecret()}
            className={
              variant === "welcome"
                ? "inline-flex items-center gap-2 rounded-md border border-slate-500 bg-slate-900/50 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                : "inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            }
          >
            <Trash2 className="h-4 w-4" />
            {t("settings:clearUserKey")}
          </button>
        )}
      </div>
    </div>
  );
});

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAgentContext } from "../contexts/AgentContext";
import { BankWorkspace } from "../pages/BankWorkspace";
import { ComposeWorkspace } from "../pages/ComposeWorkspace";
import { GraphWorkspace } from "../pages/GraphWorkspace";
import { HelpWorkspace } from "../pages/HelpWorkspace";
import { LogWorkspace } from "../pages/LogWorkspace";
import { SettingsWorkspace } from "../pages/SettingsWorkspace";
import { TemplateWorkspace } from "../pages/TemplateWorkspace";
import { ProjectPanel } from "../components/ProjectPanel";
import type { ProjectInfo } from "../types/project";

export function ComposeRoute({
  info,
  onRefreshInfo,
  onError,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "compose",
      summary: t("route.composeSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return <ComposeWorkspace onError={onError} />;
}

export function BankRoute({
  info,
  onRefreshInfo,
  onError,
  onOpenGraphNode,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
  onOpenGraphNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "bank",
      summary: t("route.bankSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return <BankWorkspace onError={onError} onOpenGraphNode={onOpenGraphNode} />;
}

export function TemplateRoute({
  info,
  onRefreshInfo,
  onError,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "template",
      summary: t("route.templateSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return <TemplateWorkspace onError={onError} />;
}

export function GraphRoute({
  info,
  onRefreshInfo,
  onError,
  focusNodeId,
  onFocusConsumed,
}: {
  info: ProjectInfo | null;
  onRefreshInfo: () => Promise<void>;
  onError: (s: string | null) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { t } = useTranslation("app");
  const { setPageContext } = useAgentContext();
  useEffect(() => {
    if (info?.bound) return;
    setPageContext({
      current_page: "graph",
      summary: t("route.graphSummary"),
    });
    return () => setPageContext(null);
  }, [info?.bound, setPageContext, t]);
  if (!info?.bound) {
    return (
      <div className="h-full overflow-auto p-6">
        <ProjectPanel onDone={onRefreshInfo} onError={onError} />
      </div>
    );
  }
  return (
    <GraphWorkspace
      onError={onError}
      focusNodeId={focusNodeId ?? null}
      onFocusConsumed={onFocusConsumed}
    />
  );
}

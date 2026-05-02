import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

import { apiAgentLlmSettingsPut, type AgentLlmSettingsResponse } from "../../api/client";
import { AgentModelSettingsForm, type AgentModelSettingsFormHandle } from "./AgentModelSettingsForm";
import { setupTestI18n, TestI18nProvider } from "../../test/i18nTestUtils";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    apiAgentLlmSettingsPut: vi.fn(),
  };
});

const baseResponse = (): AgentLlmSettingsResponse => ({
  persist_available: true,
  persist_scope: "global",
  provider: "openai_compat",
  provider_options: [
    { id: "openai" },
    { id: "anthropic" },
    { id: "openai_compat" },
    { id: "deepseek" },
  ],
  main_model: "gpt-4o-mini",
  fast_model: "gpt-4o-mini",
  base_url: "",
  llm_configured: false,
  api_key_masked: null,
  has_user_api_key_override: false,
  has_project_api_key_override: false,
  max_tokens: 4096,
  reasoning_effort: "high",
});

function Wrapper({
  initial,
  onReload = vi.fn().mockResolvedValue(undefined),
}: {
  initial: AgentLlmSettingsResponse;
  onReload?: () => Promise<void>;
}) {
  const [data, setData] = useState(initial);
  const ref = createRef<AgentModelSettingsFormHandle>();
  return (
    <TestI18nProvider>
      <AgentModelSettingsForm
        ref={ref}
        variant="settings"
        data={data}
        loading={false}
        saving={false}
        onError={() => {}}
        onReload={async () => {
          await onReload();
          setData((d) => ({ ...d }));
        }}
      />
      <button type="button" data-testid="trigger-save" onClick={() => void ref.current?.save()}>
        save
      </button>
    </TestI18nProvider>
  );
}

describe("AgentModelSettingsForm", () => {
  beforeAll(async () => {
    await setupTestI18n("zh");
  });

  beforeEach(() => {
    vi.mocked(apiAgentLlmSettingsPut).mockClear();
  });

  it("switching provider updates preset model names and save sends provider", async () => {
    const user = userEvent.setup();
    const put = vi.mocked(apiAgentLlmSettingsPut);
    put.mockResolvedValue({ ok: true });

    const initial = baseResponse();
    render(<Wrapper initial={initial} />);

    const deepseek = screen.getByRole("radio", { name: /DeepSeek/i });
    await user.click(deepseek);

    const mainInput = screen.getByDisplayValue("deepseek-v4-pro");
    expect(mainInput).toBeTruthy();
    expect(screen.getByDisplayValue("deepseek-v4-flash")).toBeTruthy();
    expect((screen.getByPlaceholderText(/https/i) as HTMLInputElement).value).toContain("deepseek.com");

    await user.click(screen.getByTestId("trigger-save"));

    await waitFor(() => {
      expect(put).toHaveBeenCalled();
    });
    const body = put.mock.calls[0][0];
    expect(body.provider).toBe("deepseek");
    expect(body.main_model).toBe("deepseek-v4-pro");
    expect(body.fast_model).toBe("deepseek-v4-flash");
    expect(body.reasoning_effort).toBe("high");
  });

  it("deepseek shows thinking depth and save sends reasoning_effort", async () => {
    const user = userEvent.setup();
    const put = vi.mocked(apiAgentLlmSettingsPut);
    put.mockResolvedValue({ ok: true });

    render(<Wrapper initial={baseResponse()} />);
    await user.click(screen.getByRole("radio", { name: /DeepSeek/i }));
    await user.click(screen.getByTestId("thinking-effort-max"));
    await user.click(screen.getByTestId("trigger-save"));
    await waitFor(() => {
      expect(put).toHaveBeenCalled();
    });
    expect(put.mock.calls[0][0].reasoning_effort).toBe("max");
  });
});

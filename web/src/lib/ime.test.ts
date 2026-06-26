import { describe, expect, it } from "vitest";

import {
  installImeCompositionTracker,
  isImeComposingKeyboardEvent,
  isImeCompositionActive,
} from "./ime";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

describe("IME helpers", () => {
  it("detects composing keyboard events from browser and WebView signals", () => {
    expect(isImeComposingKeyboardEvent({ isComposing: true })).toBe(true);
    expect(isImeComposingKeyboardEvent({ keyCode: 229 })).toBe(true);
    expect(isImeComposingKeyboardEvent({ key: "Process" })).toBe(true);
    expect(isImeComposingKeyboardEvent({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposingKeyboardEvent({ key: "Enter" })).toBe(false);
  });

  it("tracks active composition until the browser has a frame to commit final text", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const uninstall = installImeCompositionTracker();

    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(isImeCompositionActive()).toBe(true);

    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(isImeCompositionActive()).toBe(true);

    await nextFrame();
    expect(isImeCompositionActive()).toBe(false);

    uninstall();
    input.remove();
  });
});

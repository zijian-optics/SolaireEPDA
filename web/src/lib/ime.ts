type MaybeKeyboardEvent = {
  key?: string;
  keyCode?: number;
  which?: number;
  isComposing?: boolean;
  nativeEvent?: {
    key?: string;
    keyCode?: number;
    which?: number;
    isComposing?: boolean;
  };
};

const IME_COMPOSING_ATTR = "data-solaire-ime-composing";

let composingElement: Element | null = null;
let clearTimer: number | null = null;

function setElementComposing(target: EventTarget | null, composing: boolean): void {
  if (!(target instanceof HTMLElement)) return;
  if (composing) {
    target.setAttribute(IME_COMPOSING_ATTR, "true");
  } else {
    target.removeAttribute(IME_COMPOSING_ATTR);
  }
}

export function isImeComposingKeyboardEvent(event: MaybeKeyboardEvent): boolean {
  const nativeEvent = event.nativeEvent;
  return Boolean(
    event.isComposing ||
      nativeEvent?.isComposing ||
      event.keyCode === 229 ||
      event.which === 229 ||
      nativeEvent?.keyCode === 229 ||
      nativeEvent?.which === 229 ||
      event.key === "Process" ||
      nativeEvent?.key === "Process",
  );
}

export function isImeCompositionActive(doc: Document = document): boolean {
  if (composingElement && doc.contains(composingElement)) {
    return true;
  }
  const active = doc.activeElement;
  return active instanceof HTMLElement && active.closest(`[${IME_COMPOSING_ATTR}="true"]`) != null;
}

export function installImeCompositionTracker(doc: Document = document): () => void {
  const handleStart = (event: CompositionEvent) => {
    if (clearTimer != null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
    composingElement = event.target instanceof Element ? event.target : null;
    setElementComposing(event.target, true);
  };

  const handleEnd = (event: CompositionEvent) => {
    const endedElement = event.target instanceof Element ? event.target : null;
    window.requestAnimationFrame(() => {
      setElementComposing(endedElement, false);
      clearTimer = window.setTimeout(() => {
        if (composingElement === endedElement) {
          composingElement = null;
        }
        clearTimer = null;
      }, 0);
    });
  };

  doc.addEventListener("compositionstart", handleStart, true);
  doc.addEventListener("compositionend", handleEnd, true);

  return () => {
    doc.removeEventListener("compositionstart", handleStart, true);
    doc.removeEventListener("compositionend", handleEnd, true);
    if (clearTimer != null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
    if (composingElement) {
      setElementComposing(composingElement, false);
      composingElement = null;
    }
  };
}

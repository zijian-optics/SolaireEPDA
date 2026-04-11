import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmbedKind } from "../lib/bankEditorEmbedKinds";
import { LatexRichTextField } from "./LatexRichTextField";

const DEFAULT_KEYS = ["A", "B", "C", "D"] as const;

/** 合并默认键与已有键，保证 A–D 优先 */
function orderedKeys(opts: Record<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of DEFAULT_KEYS) {
    out.push(k);
    seen.add(k);
  }
  for (const k of Object.keys(opts).sort()) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

export type ChoiceOptionsFieldsProps = {
  options: Record<string, string>;
  onCommit: (opts: Record<string, string>) => void;
  idPrefix: string;
  busy?: boolean;
  makeEmbedKind: (optionKey: string) => EmbedKind;
  beginMermaidEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
  beginImageEmbed: (kind: EmbedKind, sel: { start: number; end: number } | null) => void;
};

function ChoiceOptionRow({
  optionKey,
  value,
  idPrefix,
  busy,
  makeEmbedKind,
  beginMermaidEmbed,
  beginImageEmbed,
  onChange,
  onRemove,
  removable,
}: {
  optionKey: string;
  value: string;
  idPrefix: string;
  busy: boolean;
  makeEmbedKind: (optionKey: string) => EmbedKind;
  beginMermaidEmbed: ChoiceOptionsFieldsProps["beginMermaidEmbed"];
  beginImageEmbed: ChoiceOptionsFieldsProps["beginImageEmbed"];
  onChange: (next: string) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const { t } = useTranslation("components");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const syncId = `${idPrefix}-${optionKey}`;
  return (
    <div className="block">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">
          <span className="font-mono">{optionKey}</span>
        </span>
        {removable && (
          <button
            type="button"
            className="shrink-0 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
            onClick={onRemove}
          >
            {t("choiceFields.remove")}
          </button>
        )}
      </div>
      <LatexRichTextField
        textAreaRef={textAreaRef}
        syncTextAreaId={syncId}
        minRows={2}
        value={value}
        onChange={onChange}
        onRequestMermaid={(sel) => beginMermaidEmbed(makeEmbedKind(optionKey), sel)}
        onRequestImage={(sel) => beginImageEmbed(makeEmbedKind(optionKey), sel)}
        busy={busy}
      />
    </div>
  );
}

export function ChoiceOptionsFields({
  options,
  onCommit,
  idPrefix,
  busy = false,
  makeEmbedKind,
  beginMermaidEmbed,
  beginImageEmbed,
}: ChoiceOptionsFieldsProps) {
  const { t } = useTranslation("components");
  const keys = useMemo(() => orderedKeys(options), [options]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [rawDraft, setRawDraft] = useState<string | null>(null);

  const jsonPretty = useMemo(() => JSON.stringify(options, null, 2), [options]);

  function updateKey(key: string, value: string) {
    onCommit({ ...options, [key]: value });
  }

  function addOptionKey() {
    let n = 5;
    let label = "E";
    while (label in options || keys.includes(label)) {
      label = String.fromCharCode(64 + n);
      n += 1;
      if (n > 26) {
        label = `_${Date.now()}`;
        break;
      }
    }
    onCommit({ ...options, [label]: "" });
  }

  function removeKey(key: string) {
    if (DEFAULT_KEYS.includes(key as (typeof DEFAULT_KEYS)[number])) {
      return;
    }
    const next = { ...options };
    delete next[key];
    onCommit(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600">{t("choiceFields.optionsLatex")}</p>
      <div className="space-y-3">
        {keys.map((key) => (
          <ChoiceOptionRow
            key={key}
            optionKey={key}
            value={options[key] ?? ""}
            idPrefix={idPrefix}
            busy={busy}
            makeEmbedKind={makeEmbedKind}
            beginMermaidEmbed={beginMermaidEmbed}
            beginImageEmbed={beginImageEmbed}
            onChange={(next) => updateKey(key, next)}
            onRemove={() => removeKey(key)}
            removable={!DEFAULT_KEYS.includes(key as (typeof DEFAULT_KEYS)[number])}
          />
        ))}
      </div>
      <button
        type="button"
        className="text-[11px] font-medium text-slate-600 underline decoration-slate-300 hover:text-slate-900"
        onClick={addOptionKey}
      >
        {t("choiceFields.addKey")}
      </button>
      <details open={jsonOpen} onToggle={(e) => setJsonOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-[11px] font-medium text-slate-500">{t("choiceFields.jsonAdvanced")}</summary>
        <p className="mt-1 text-[10px] text-slate-500">{t("choiceFields.jsonHint")}</p>
        <textarea
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
          rows={5}
          value={rawDraft ?? jsonPretty}
          spellCheck={false}
          onChange={(e) => {
            const s = e.target.value;
            setRawDraft(s);
            try {
              const o = JSON.parse(s || "{}") as unknown;
              if (o && typeof o === "object" && !Array.isArray(o)) {
                const out: Record<string, string> = {};
                for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
                  out[k] = typeof v === "string" ? v : String(v ?? "");
                }
                onCommit(out);
                setRawDraft(null);
              }
            } catch {
              /* 保持 rawDraft */
            }
          }}
          onBlur={() => setRawDraft(null)}
        />
      </details>
    </div>
  );
}

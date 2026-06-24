import { memo, useEffect, useMemo, useState } from "react";
import type { MetadataFilterDefinition, MetadataFilterState, MetadataFilters } from "../lib/metadataFilters";

const LABEL_TITLE = "\u6807\u7b7e\u7b5b\u9009";
const LABEL_CLEAR = "\u6e05\u7a7a";
const LABEL_ADD = "\u589e\u52a0\u6807\u7b7e\u6761\u4ef6";
const LABEL_FIELD = "\u6807\u7b7e";
const LABEL_SELECT_FIELD = "\u9009\u62e9\u6807\u7b7e";
const LABEL_ALL = "\u5168\u90e8";
const LABEL_MISSING = "\u65e0";
const LABEL_REMOVE = "\u79fb\u9664";

const MISSING_VALUE = "__solaire_missing_metadata__";

type MetadataFilterControlsProps = {
  definitions: MetadataFilterDefinition[];
  filters: MetadataFilters;
  onChange: (filters: MetadataFilters) => void;
};

function defaultFilterFor(definition: MetadataFilterDefinition): MetadataFilterState {
  if (definition.kind === "enum") {
    return { kind: "enum", selected: [] };
  }
  return { kind: "number", min: "", max: "" };
}

function sameFilterKeys(a: MetadataFilters, b: MetadataFilters) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key));
}

function MetadataFilterControlsInner({ definitions, filters, onChange }: MetadataFilterControlsProps) {
  const [localFilters, setLocalFilters] = useState(filters);
  const [pendingRows, setPendingRows] = useState(0);
  const definitionByKey = useMemo(() => new Map(definitions.map((definition) => [definition.key, definition])), [definitions]);
  const activeDefinitions = useMemo(
    () => definitions.filter((definition) => localFilters[definition.key]),
    [definitions, localFilters],
  );
  const availableDefinitions = useMemo(
    () => definitions.filter((definition) => !localFilters[definition.key]),
    [definitions, localFilters],
  );
  const rowCount = activeDefinitions.length + pendingRows;

  useEffect(() => {
    setLocalFilters((current) => (sameFilterKeys(current, filters) ? current : filters));
  }, [filters]);

  useEffect(() => {
    const allowedKeys = new Set(definitions.map((definition) => definition.key));
    const next = Object.fromEntries(Object.entries(localFilters).filter(([key]) => allowedKeys.has(key)));
    if (Object.keys(next).length !== Object.keys(localFilters).length) {
      setLocalFilters(next);
      onChange(next);
    }
  }, [definitions, localFilters, onChange]);

  useEffect(() => {
    setPendingRows((count) => Math.min(count, availableDefinitions.length));
  }, [availableDefinitions.length]);

  if (definitions.length === 0) {
    return null;
  }

  const commitFilters = (next: MetadataFilters) => {
    setLocalFilters(next);
    onChange(next);
  };

  const addCondition = () => {
    setPendingRows((count) => Math.min(count + 1, availableDefinitions.length));
  };

  const choosePendingCondition = (newKey: string) => {
    const definition = definitionByKey.get(newKey);
    if (!definition || localFilters[newKey]) {
      return;
    }
    setPendingRows((count) => Math.max(0, count - 1));
    commitFilters({ ...localFilters, [definition.key]: defaultFilterFor(definition) });
  };

  const removePendingCondition = () => {
    setPendingRows((count) => Math.max(0, count - 1));
  };

  const changeConditionKey = (oldKey: string, newKey: string) => {
    const definition = definitionByKey.get(newKey);
    if (!definition || oldKey === newKey) {
      return;
    }
    const next = { ...localFilters };
    delete next[oldKey];
    next[newKey] = defaultFilterFor(definition);
    commitFilters(next);
  };

  const removeCondition = (key: string) => {
    const next = { ...localFilters };
    delete next[key];
    commitFilters(next);
  };

  const setEnumFilter = (key: string, value: string) => {
    commitFilters({
      ...localFilters,
      [key]: value === MISSING_VALUE ? { kind: "enum", selected: [], includeMissing: true } : { kind: "enum", selected: value ? [value] : [] },
    });
  };

  const setNumberFilter = (key: string, bound: "min" | "max", value: string) => {
    const current = localFilters[key];
    const nextFilter = current?.kind === "number" ? { ...current, includeMissing: false } : { kind: "number" as const, min: "", max: "" };
    nextFilter[bound] = value;
    commitFilters({ ...localFilters, [key]: nextFilter });
  };

  const setNumberMissing = (key: string, includeMissing: boolean) => {
    const current = localFilters[key];
    const nextFilter = current?.kind === "number" ? { ...current } : { kind: "number" as const, min: "", max: "" };
    nextFilter.includeMissing = includeMissing;
    if (includeMissing) {
      nextFilter.min = "";
      nextFilter.max = "";
    }
    commitFilters({ ...localFilters, [key]: nextFilter });
  };

  const clearAll = () => {
    setPendingRows(0);
    commitFilters({});
  };

  return (
    <div className="border-t border-slate-200 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-700">{LABEL_TITLE}</p>
        {rowCount > 0 ? (
          <button type="button" className="text-[10px] font-medium text-slate-500 hover:text-slate-900" onClick={clearAll}>
            {LABEL_CLEAR}
          </button>
        ) : null}
      </div>
      <div className="space-y-2">
        {activeDefinitions.map((definition) => {
          const current = localFilters[definition.key];
          return (
            <div key={definition.key} className="rounded-md border border-slate-200 bg-white p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                <label className="block min-w-0 text-[11px] font-medium text-slate-600">
                  {LABEL_FIELD}
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                    value={definition.key}
                    onChange={(event) => changeConditionKey(definition.key, event.target.value)}
                  >
                    {definitions.map((option) => (
                      <option key={option.key} value={option.key} disabled={option.key !== definition.key && Boolean(localFilters[option.key])}>
                        {option.key}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="mt-4 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  onClick={() => removeCondition(definition.key)}
                >
                  {LABEL_REMOVE}
                </button>
              </div>
              {definition.kind === "enum" ? (
                <select
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                  value={current?.kind === "enum" ? (current.includeMissing ? MISSING_VALUE : current.selected[0] ?? "") : ""}
                  onChange={(event) => setEnumFilter(definition.key, event.target.value)}
                >
                  <option value="">{LABEL_ALL}</option>
                  {definition.values.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={MISSING_VALUE}>{LABEL_MISSING}</option>
                </select>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      className="min-w-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60"
                      value={current?.kind === "number" ? current.min ?? "" : ""}
                      placeholder={">= " + definition.min}
                      disabled={current?.kind === "number" && current.includeMissing === true}
                      onChange={(event) => setNumberFilter(definition.key, "min", event.target.value)}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      className="min-w-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60"
                      value={current?.kind === "number" ? current.max ?? "" : ""}
                      placeholder={"<= " + definition.max}
                      disabled={current?.kind === "number" && current.includeMissing === true}
                      onChange={(event) => setNumberFilter(definition.key, "max", event.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300"
                      checked={current?.kind === "number" && current.includeMissing === true}
                      onChange={(event) => setNumberMissing(definition.key, event.target.checked)}
                    />
                    {LABEL_MISSING}
                  </label>
                </div>
              )}
            </div>
          );
        })}
        {Array.from({ length: pendingRows }).map((_, index) => (
          <div key={"pending-" + index} className="rounded-md border border-slate-200 bg-white p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
              <label className="block min-w-0 text-[11px] font-medium text-slate-600">
                {LABEL_FIELD}
                <select
                  className="mt-0.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
                  value=""
                  onChange={(event) => choosePendingCondition(event.target.value)}
                >
                  <option value="">{LABEL_SELECT_FIELD}</option>
                  {availableDefinitions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.key}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="mt-4 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={removePendingCondition}
              >
                {LABEL_REMOVE}
              </button>
            </div>
          </div>
        ))}
        {availableDefinitions.length > pendingRows ? (
          <button
            type="button"
            className="w-full rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            onClick={addCondition}
          >
            {LABEL_ADD}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export const MetadataFilterControls = memo(MetadataFilterControlsInner);

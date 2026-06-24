export type MetadataRecord = Record<string, unknown>;

export type MetadataFilterDefinition =
  | {
      key: string;
      kind: "enum";
      values: string[];
    }
  | {
      key: string;
      kind: "number";
      min: number;
      max: number;
    };

export type MetadataFilterState =
  | {
      kind: "enum";
      selected: string[];
      includeMissing?: boolean;
    }
  | {
      kind: "number";
      min?: string;
      max?: string;
      includeMissing?: boolean;
    };

export type MetadataFilters = Record<string, MetadataFilterState>;

type PrimitiveMetadataValue = string | number | boolean;

type MetadataCarrier = {
  metadata?: MetadataRecord | null;
};

function primitiveValues(value: unknown): PrimitiveMetadataValue[] {
  if (typeof value === "string" || typeof value === "boolean") {
    return [value];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(primitiveValues);
  }
  return [];
}

function enumLabel(value: PrimitiveMetadataValue) {
  return String(value);
}

function compareLabels(a: string, b: string) {
  return a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function buildMetadataFilterDefinitions(items: MetadataCarrier[]): MetadataFilterDefinition[] {
  const byKey = new Map<string, PrimitiveMetadataValue[]>();
  for (const item of items) {
    for (const [key, raw] of Object.entries(item.metadata ?? {})) {
      const values = primitiveValues(raw);
      if (values.length === 0) {
        continue;
      }
      const bucket = byKey.get(key) ?? [];
      bucket.push(...values);
      byKey.set(key, bucket);
    }
  }

  return [...byKey.entries()]
    .map(([key, values]): MetadataFilterDefinition | null => {
      const numericValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      if (numericValues.length === values.length && numericValues.length > 0) {
        return {
          key,
          kind: "number",
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
        };
      }
      const enumValues = [...new Set(values.map(enumLabel))].sort(compareLabels);
      if (enumValues.length === 0) {
        return null;
      }
      return { key, kind: "enum", values: enumValues };
    })
    .filter((definition): definition is MetadataFilterDefinition => definition !== null)
    .sort((a, b) => compareLabels(a.key, b.key));
}

export function hasActiveMetadataFilters(filters: MetadataFilters) {
  return Object.values(filters).some((filter) => {
    if (filter.kind === "enum") {
      return filter.selected.length > 0 || filter.includeMissing === true;
    }
    return Boolean(filter.min?.trim() || filter.max?.trim() || filter.includeMissing === true);
  });
}

function parseBound(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function matchesMetadataFilters(metadata: MetadataRecord | null | undefined, filters: MetadataFilters) {
  for (const [key, filter] of Object.entries(filters)) {
    const values = primitiveValues(metadata?.[key]);
    const hasValue = values.length > 0;

    if (filter.kind === "enum") {
      if (filter.selected.length === 0 && filter.includeMissing !== true) {
        continue;
      }
      if (filter.includeMissing === true) {
        if (!hasValue) {
          continue;
        }
        return false;
      }
      const labels = new Set(values.map(enumLabel));
      if (!filter.selected.some((value) => labels.has(value))) {
        return false;
      }
      continue;
    }

    const min = parseBound(filter.min);
    const max = parseBound(filter.max);
    if (min === null && max === null && filter.includeMissing !== true) {
      continue;
    }
    if (filter.includeMissing === true) {
      if (!hasValue) {
        continue;
      }
      return false;
    }
    const numericValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!numericValues.some((value) => (min === null || value >= min) && (max === null || value <= max))) {
      return false;
    }
  }
  return true;
}
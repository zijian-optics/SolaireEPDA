import { describe, expect, it } from "vitest";
import {
  buildMetadataFilterDefinitions,
  hasActiveMetadataFilters,
  matchesMetadataFilters,
  type MetadataFilters,
} from "./metadataFilters";

describe("metadataFilters", () => {
  it("builds enum and numeric filter definitions from metadata", () => {
    const definitions = buildMetadataFilterDefinitions([
      { metadata: { difficulty: "high", source: "mock", novelty: 0.7 } },
      { metadata: { difficulty: "low", source: "mock", novelty: 0.2 } },
      { metadata: { difficulty: "high", ignored: { nested: true } } },
    ]);

    expect(definitions).toEqual([
      { key: "difficulty", kind: "enum", values: ["high", "low"] },
      { key: "novelty", kind: "number", min: 0.2, max: 0.7 },
      { key: "source", kind: "enum", values: ["mock"] },
    ]);
  });

  it("matches enum and numeric filters as an intersection", () => {
    const filters: MetadataFilters = {
      difficulty: { kind: "enum", selected: ["high"] },
      novelty: { kind: "number", min: "0.3", max: "0.8" },
    };

    expect(matchesMetadataFilters({ difficulty: "high", novelty: 0.5 }, filters)).toBe(true);
    expect(matchesMetadataFilters({ difficulty: "low", novelty: 0.5 }, filters)).toBe(false);
    expect(matchesMetadataFilters({ difficulty: "high", novelty: 0.9 }, filters)).toBe(false);
    expect(matchesMetadataFilters({ difficulty: "high" }, filters)).toBe(false);
  });

  it("ignores inactive and invalid numeric filters", () => {
    expect(hasActiveMetadataFilters({ novelty: { kind: "number", min: "", max: "" } })).toBe(false);
    expect(matchesMetadataFilters({ novelty: 0.5 }, { novelty: { kind: "number", min: "abc" } })).toBe(true);
  });

  it("matches explicit missing metadata filters", () => {
    expect(matchesMetadataFilters({}, { difficulty: { kind: "enum", selected: [], includeMissing: true } })).toBe(true);
    expect(matchesMetadataFilters({ difficulty: "high" }, { difficulty: { kind: "enum", selected: [], includeMissing: true } })).toBe(false);
    expect(matchesMetadataFilters({}, { novelty: { kind: "number", includeMissing: true } })).toBe(true);
    expect(matchesMetadataFilters({ novelty: 0.5 }, { novelty: { kind: "number", includeMissing: true } })).toBe(false);
  });

});
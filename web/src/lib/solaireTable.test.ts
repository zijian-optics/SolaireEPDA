import { describe, expect, it } from "vitest";

import {
  expandSolaireTable,
  parseSolaireTable,
  serializeSolaireTableBody,
} from "./solaireTable";

describe("solaire table model", () => {
  it("round-trips merged cells", () => {
    const source = [
      "version: 1",
      "rows:",
      "  - - text: 项目",
      "      header: true",
      "      rowSpan: 2",
      "    - text: 数值",
      "      header: true",
      "      colSpan: 2",
      "  - - text: $x$",
      "    - text: 说明",
    ].join("\n");

    const doc = parseSolaireTable(source);
    const expanded = expandSolaireTable(doc);
    expect(expanded.width).toBe(3);
    expect(expanded.height).toBe(2);
    expect(expanded.slots[1][0].covered).toBe(true);
    expect(serializeSolaireTableBody(doc)).toContain("rowSpan: 2");
  });

  it("rejects non-rectangular tables", () => {
    expect(() =>
      parseSolaireTable("version: 1\nrows:\n  - - text: A\n      colSpan: 2\n  - - text: B\n"),
    ).toThrow(/rectangular/);
  });

  it("rejects row spans beyond the table", () => {
    expect(() => parseSolaireTable("version: 1\nrows:\n  - - text: A\n      rowSpan: 2\n")).toThrow(/height/);
  });
});

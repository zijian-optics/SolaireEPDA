import { describe, expect, it } from "vitest";
import { inferChoiceTypeFromAnswer, normalizeQuestionTypeForFilter } from "./questionTypes";

describe("choice type filtering", () => {
  it("infers legacy choice rows from answer letters", () => {
    expect(inferChoiceTypeFromAnswer("A")).toBe("single_choice");
    expect(inferChoiceTypeFromAnswer("AC")).toBe("multiple_choice");
    expect(inferChoiceTypeFromAnswer("A,C")).toBe("multiple_choice");
    expect(inferChoiceTypeFromAnswer("A C")).toBe("multiple_choice");
  });

  it("normalizes legacy choice before compose filters compare types", () => {
    expect(normalizeQuestionTypeForFilter("choice", "B")).toBe("single_choice");
    expect(normalizeQuestionTypeForFilter("choice", "BD")).toBe("multiple_choice");
    expect(normalizeQuestionTypeForFilter("fill", "BD")).toBe("fill");
  });
});

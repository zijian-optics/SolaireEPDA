/** 与后端 `QuestionType` 一致（`text` 仅用于模板节，不在此列表） */
export const QUESTION_TYPE_OPTIONS = [
  { value: "single_choice" },
  { value: "multiple_choice" },
  { value: "fill" },
  { value: "judge" },
  { value: "short_answer" },
  { value: "reasoning" },
  { value: "essay" },
] as const;

/** 题组内小题类型，与后端 `GroupInnerType` 一致 */
export const GROUP_INNER_TYPE_OPTIONS = [
  { value: "single_choice" },
  { value: "multiple_choice" },
  { value: "fill" },
  { value: "judge" },
] as const;

export const CHOICE_QUESTION_TYPES = ["single_choice", "multiple_choice", "choice"] as const;

export function isChoiceQuestionType(type: string | null | undefined): boolean {
  return type === "single_choice" || type === "multiple_choice" || type === "choice";
}

const ANSWER_OPTION_RE = /[A-Z]/g;

export function inferChoiceTypeFromAnswer(answer: string | null | undefined): "single_choice" | "multiple_choice" {
  const letters = new Set((answer ?? "").toUpperCase().match(ANSWER_OPTION_RE) ?? []);
  return letters.size >= 2 ? "multiple_choice" : "single_choice";
}

export function normalizeQuestionTypeForFilter(
  type: string | null | undefined,
  answer?: string | null,
): string {
  if (type === "choice") {
    return inferChoiceTypeFromAnswer(answer);
  }
  return type ?? "";
}

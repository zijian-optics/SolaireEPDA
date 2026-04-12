/** 考试目录增删或变更后广播，供组卷等仍挂载的视图刷新列表并清理对已删考试的引用。 */

export const SOLAIRE_EXAMS_CHANGED_EVENT = "solaire-exams-changed";

export type ExamsChangedDetail = { examId?: string };

export function dispatchExamsChanged(detail?: ExamsChangedDetail): void {
  window.dispatchEvent(new CustomEvent(SOLAIRE_EXAMS_CHANGED_EVENT, { detail: detail ?? {} }));
}

export type QuestionRow = {
  id: string;
  qualified_id: string;
  namespace: string;
  collection?: string;
  /** resource/<科目>/ 下的科目名；namespace `main` 时可为 main */
  subject?: string;
  collection_name?: string;
  type: string;
  content: string;
  content_preview: string;
  answer: string;
  analysis: string;
  group_id?: string | null;
  group_member_qualified_ids?: string[];
  group_material?: string | null;
};

export type TemplateSection = {
  section_id: string;
  type: string;
  required_count: number;
  score_per_item: number;
  describe?: string | null;
};

export type TemplateRow = {
  id: string;
  path: string;
  layout: string;
  sections: TemplateSection[];
};

export type ExamWorkspaceStatus = "draft" | "exported";

/** 考试工作区列表项（与旧版草稿列表合并返回时兼容） */
export type ExamWorkspaceSummary = {
  exam_id: string;
  name?: string | null;
  subject?: string | null;
  export_label?: string | null;
  template_ref?: string | null;
  template_path?: string | null;
  updated_at?: string | null;
  status?: ExamWorkspaceStatus | null;
  last_export_result_id?: string | null;
};

export type DraftSummary = {
  draft_id: string;
  /** 与 ``draft_id`` 相同（考试工作区）或指向同一标识 */
  exam_id?: string | null;
  name?: string | null;
  subject?: string | null;
  export_label?: string | null;
  template_ref?: string | null;
  template_path?: string | null;
  updated_at?: string | null;
  status?: ExamWorkspaceStatus | null;
  /** 数据是否位于 ``exams/<id>/`` */
  workspace?: boolean;
  last_export_result_id?: string | null;
};

export type PastExamSummary = {
  exam_id: string;
  exam_title?: string | null;
  subject?: string | null;
  export_label?: string | null;
};

export type DraftDoc = {
  draft_id: string;
  /** 考试工作区 id；存在时表示数据在 ``exams/<exam_id>/`` */
  exam_id?: string;
  name?: string;
  subject?: string;
  export_label?: string;
  template_ref?: string;
  template_path?: string;
  selected_items?: Array<{
    section_id: string;
    question_ids: string[];
    score_per_item?: number | null;
    score_overrides?: Record<string, number> | null;
  }>;
};

export type RightSelection = { sectionId: string; qid: string };

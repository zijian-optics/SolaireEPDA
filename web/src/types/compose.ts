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

/** 考试工作区列表项（``GET /api/exams``） */
export type ExamWorkspaceSummary = {
  exam_id: string;
  name?: string | null;
  subject?: string | null;
  export_label?: string | null;
  template_ref?: string | null;
  template_path?: string | null;
  updated_at?: string | null;
  status?: ExamWorkspaceStatus | null;
};

/** 组卷文档（``exams/<exam_id>/exam.yaml``） */
export type ExamDoc = {
  exam_id: string;
  /** 复制来源考试目录标识（``标签段/学科段``） */
  source_exam_id?: string;
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

/** @deprecated 使用 ExamDoc */
export type DraftDoc = ExamDoc;

export type RightSelection = { sectionId: string; qid: string };

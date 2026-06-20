"""Agent tools for question bank (题库) — thin wrappers over web bank_service."""

from __future__ import annotations

import json
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.exam_compiler.facade import QuestionItem
from solaire.exam_compiler.pipeline.math_fragment_check import analyze_math_static_for_record
from solaire.web.bank_service import get_question_detail, list_bank_entries, save_question


def _root(ctx: InvocationContext) -> Any:
    return ctx.project_root


def _format_check_payload(qualified_id: str, item: QuestionItem) -> dict[str, Any]:
    warnings = analyze_math_static_for_record(qualified_id, item)
    return {
        "format_ok": not warnings,
        "format_warning_count": len(warnings),
        "format_warnings": warnings,
        "next_action": (
            "\u8bf7\u6839\u636e format_warnings \u4fee\u6b63\u9898\u5e72/\u7b54\u6848/\u89e3\u6790/\u9009\u9879\u540e\u518d\u6b21\u8c03\u7528 bank.update_item\uff1b"
            "\u4e0d\u8981\u5728\u4ecd\u6709\u683c\u5f0f\u8b66\u544a\u65f6\u5411\u7528\u6237\u62a5\u544a\u9898\u76ee\u5df2\u5b8c\u5168\u53ef\u5bfc\u51fa\u3002"
            if warnings
            else None
        ),
    }


def _format_warning_summary(qualified_id: str, warnings: list[dict[str, str]]) -> str | None:
    if not warnings:
        return None
    bits = []
    for w in warnings[:5]:
        field = w.get("field") or "?"
        code = w.get("code") or "format_warning"
        msg = w.get("message") or ""
        bits.append(f"{field}:{code} {msg}")
    more = f"\uFF1B\u53E6\u6709 {len(warnings) - 5} \u6761" if len(warnings) > 5 else ""
    return f"\u9898\u76ee {qualified_id} \u4fdd\u5b58\u540e\u4ecd\u6709\u683c\u5f0f\u8b66\u544a\uff1a" + "\uFF1B".join(bits) + more


def tool_bank_search_items(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    query = str(args.get("query") or "").strip().lower()
    qtype = str(args.get("question_type") or "").strip().lower()
    try:
        max_hits = int(args.get("max_hits") or 30)
    except (TypeError, ValueError):
        max_hits = 30
    max_hits = max(1, min(max_hits, 80))

    try:
        entries = list_bank_entries(_root(ctx))
    except Exception as e:
        return ToolResult(status="failed", error_code="bank_list", error_message=str(e))

    out: list[dict[str, Any]] = []
    for e in entries:
        if qtype and str(e.get("type") or "").lower() != qtype:
            continue
        preview = str(e.get("content_preview") or "")
        qid = str(e.get("qualified_id") or "")
        if query and query not in preview.lower() and query not in qid.lower():
            continue
        out.append(
            {
                "qualified_id": qid,
                "type": e.get("type"),
                "content_preview": preview[:240],
                "collection": e.get("collection"),
            }
        )
        if len(out) >= max_hits:
            break

    return ToolResult(
        status="succeeded",
        data={"hits": out, "count": len(out), "truncated": len(out) >= max_hits},
    )


def tool_bank_get_item(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    qid = str(args.get("qualified_id") or "").strip()
    if not qid:
        return ToolResult(status="failed", error_code="invalid_args", error_message="缺少 qualified_id")
    try:
        detail = get_question_detail(_root(ctx), qid)
    except FileNotFoundError:
        return ToolResult(status="failed", error_code="not_found", error_message=f"未找到题目: {qid}")
    except Exception as e:
        return ToolResult(status="failed", error_code="bank_get", error_message=str(e))

    q = detail.get("question")
    if q is None:
        return ToolResult(
            status="failed",
            error_code="group_not_supported",
            error_message="该条目为题组或其它复合结构，请在本软件题库界面手动编辑。",
        )
    return ToolResult(
        status="succeeded",
        data={
            "qualified_id": detail.get("qualified_id"),
            "question": q,
            "storage_path": detail.get("storage_path"),
        },
    )


def tool_bank_update_item(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    qid = str(args.get("qualified_id") or "").strip()
    if not qid:
        return ToolResult(status="failed", error_code="invalid_args", error_message="缺少 qualified_id")
    try:
        detail = get_question_detail(_root(ctx), qid)
    except FileNotFoundError:
        return ToolResult(status="failed", error_code="not_found", error_message=f"未找到题目: {qid}")
    except Exception as e:
        return ToolResult(status="failed", error_code="bank_get", error_message=str(e))

    raw_q = detail.get("question")
    if raw_q is None:
        return ToolResult(
            status="failed",
            error_code="group_not_supported",
            error_message="该条目不支持通过助手直接修改，请在题库界面编辑。",
        )

    try:
        item = QuestionItem.model_validate(raw_q)
    except Exception as e:
        return ToolResult(status="failed", error_code="parse", error_message=str(e))

    patch: dict[str, Any] = {}
    for key in ("content", "answer", "analysis"):
        if key in args and args[key] is not None:
            patch[key] = args[key]
    if "options" in args and args["options"] is not None:
        opts = args["options"]
        if isinstance(opts, str):
            try:
                patch["options"] = json.loads(opts) if opts.strip() else None
            except json.JSONDecodeError as e:
                return ToolResult(status="failed", error_code="json", error_message=str(e))
        elif isinstance(opts, dict):
            patch["options"] = opts
    if "metadata" in args and args["metadata"] is not None:
        meta = args["metadata"]
        if isinstance(meta, str):
            try:
                patch["metadata"] = json.loads(meta) if meta.strip() else {}
            except json.JSONDecodeError as e:
                return ToolResult(status="failed", error_code="json", error_message=str(e))
        elif isinstance(meta, dict):
            patch["metadata"] = meta

    if not patch:
        return ToolResult(status="failed", error_code="invalid_args", error_message="未提供任何可更新字段")

    try:
        updated = item.model_copy(update=patch)
    except Exception as e:
        return ToolResult(status="failed", error_code="validate", error_message=str(e))

    try:
        save_question(_root(ctx), qid, updated)
    except Exception as e:
        return ToolResult(status="failed", error_code="save", error_message=str(e))

    try:
        detail = get_question_detail(_root(ctx), qid)
        raw_q = detail.get("question")
        if raw_q is None:
            return ToolResult(
                status="failed",
                error_code="post_validate",
                error_message="\u56de\u8bfb\u6821\u9a8c\u5931\u8d25\uff1a\u9898\u76ee\u4fdd\u5b58\u540e\u89e3\u6790\u7ed3\u679c\u4e3a\u7a7a\uff0c\u8bf7\u6309\u6a21\u677f\u4fee\u6b63\u540e\u91cd\u8bd5\u3002",
            )
        saved_item = QuestionItem.model_validate(raw_q)
    except Exception as e:
        return ToolResult(
            status="failed",
            error_code="post_validate",
            error_message=f"\u56de\u8bfb\u6821\u9a8c\u5931\u8d25\uff1a{e}",
        )

    format_payload = _format_check_payload(qid, saved_item)
    data = {"qualified_id": qid, "updated_fields": list(patch.keys()), **format_payload}
    return ToolResult(
        status="succeeded",
        data=data,
        summary_for_llm=_format_warning_summary(qid, data["format_warnings"]),
    )


def tool_bank_create_item(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    ns = str(args.get("collection_namespace") or "").strip()
    qid = str(args.get("question_id") or "").strip()
    qtype = str(args.get("question_type") or "").strip()
    content = str(args.get("content") or "")
    answer = str(args.get("answer") or "")
    analysis = str(args.get("analysis") or "")
    if not ns or not qid or not qtype:
        return ToolResult(
            status="failed",
            error_code="invalid_args",
            error_message="collection_namespace、question_id、question_type 均为必填",
        )
    allowed_types = ("single_choice", "multiple_choice", "choice", "fill", "judge", "short_answer", "reasoning", "essay")
    if qtype not in allowed_types:
        return ToolResult(
            status="failed",
            error_code="invalid_args",
            error_message=f"question_type 须为之一：{', '.join(allowed_types)}",
        )
    if "/" not in ns:
        return ToolResult(
            status="failed",
            error_code="invalid_ns",
            error_message="题集须为「科目/题集」形式，例如 math/unit1",
        )

    options = None
    if "options" in args and args["options"] is not None:
        opts = args["options"]
        if isinstance(opts, str):
            options = json.loads(opts) if opts.strip() else None
        elif isinstance(opts, dict):
            options = opts

    meta: dict[str, Any] = {}
    if "metadata" in args and args["metadata"] is not None:
        m = args["metadata"]
        if isinstance(m, str):
            meta = json.loads(m) if m.strip() else {}
        elif isinstance(m, dict):
            meta = m

    try:
        item = QuestionItem(
            id=qid,
            type=qtype,
            content=content,
            options=options,
            answer=answer,
            analysis=analysis,
            metadata=meta,
        )
    except Exception as e:
        return ToolResult(
            status="failed",
            error_code="validate",
            error_message=f"题目结构校验失败：{e}",
        )

    qualified_id = f"{ns}/{qid}"
    try:
        save_question(_root(ctx), qualified_id, item)
    except FileExistsError:
        return ToolResult(
            status="failed",
            error_code="exists",
            error_message="同标识题目已存在，请换用其它题目编号或先编辑原题。",
        )
    except Exception as e:
        return ToolResult(status="failed", error_code="save", error_message=str(e))

    # 写入后再次按 question.py 模型回读校验，确保落盘内容也满足格式约束。
    try:
        detail = get_question_detail(_root(ctx), qualified_id)
        raw_q = detail.get("question")
        if raw_q is None:
            return ToolResult(
                status="failed",
                error_code="post_validate",
                error_message="回读校验失败：题目保存后解析结果为空，请按模板修正后重试。",
            )
        QuestionItem.model_validate(raw_q)
    except Exception as e:
        return ToolResult(
            status="failed",
            error_code="post_validate",
            error_message=f"回读校验失败：{e}",
        )

    format_payload = _format_check_payload(qualified_id, QuestionItem.model_validate(raw_q))
    data = {"qualified_id": qualified_id, **format_payload}
    return ToolResult(
        status="succeeded",
        data=data,
        summary_for_llm=_format_warning_summary(qualified_id, data["format_warnings"]),
    )

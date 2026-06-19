"""Bridge to edu_analysis.invoke_tool."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.edu_analysis.core import invoke_tool
from solaire.web.remediation_service import create_remediation_draft


def run_analysis_tool(ctx: InvocationContext, tool_name: str, args: dict[str, Any]) -> ToolResult:
    try:
        out = invoke_tool(ctx.project_root, tool_name, args)
        return ToolResult(status="succeeded", data=out, summary_for_llm=None)
    except Exception as e:
        return ToolResult(
            status="failed",
            data={},
            error_code="runtime_error",
            error_message=str(e),
            summary_for_llm=str(e),
        )


def tool_create_remediation_draft(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def opt_str(key: str) -> str | None:
        val = args.get(key)
        if val is None:
            return None
        text = str(val).strip()
        return text or None

    try:
        out = create_remediation_draft(
            ctx.project_root,
            exam_id=str(args.get("exam_id") or ""),
            batch_id=str(args.get("batch_id") or ""),
            weak_limit=int(args.get("weak_limit") or 5),
            practice_per_node=int(args.get("practice_per_node") or 4),
            exclude_source_exam_questions=bool(args.get("exclude_source_exam_questions", True)),
            template_ref=opt_str("template_ref"),
            template_path=opt_str("template_path"),
            export_label=opt_str("export_label"),
        )
        return ToolResult(status="succeeded", data=out, summary_for_llm=None)
    except Exception as e:
        return ToolResult(
            status="failed",
            data={},
            error_code="runtime_error",
            error_message=str(e),
            summary_for_llm=str(e),
        )


def post_check_python_script(code: str) -> tuple[bool, str]:
    return validate_python_syntax(code)


def validate_python_syntax(code: str) -> tuple[bool, str]:
    import ast

    try:
        ast.parse(code)
        return True, ""
    except SyntaxError as e:
        return False, f"语法错误: {e}"

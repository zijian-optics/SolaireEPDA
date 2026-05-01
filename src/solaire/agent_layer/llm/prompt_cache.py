"""Prompt cache friendliness helpers (placeholder metrics)."""


def stable_prefix_hint() -> str:
    """提示：稳定前缀应包含角色/任务范围/工具表/约束等，见 prompts.build_stable_system_prompt。"""
    return "stable_prefix:build_stable_system_prompt"

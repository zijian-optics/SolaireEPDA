"""一次性迁移：将 ``.solaire/drafts/*.yaml`` 导入为 ``exams/<exam_id>/`` 考试工作区。

若「试卷说明 + 学科」冲突，会自动调整试卷说明并继续；迁移成功后删除原草稿文件。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="Migrate legacy compose drafts to exam workspaces.")
    p.add_argument("project_root", type=Path, help="项目根目录")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="仅列出将要迁移的文件，不写入、不删除",
    )
    args = p.parse_args()
    root = args.project_root.resolve()
    drafts_root = root / ".solaire" / "drafts"
    if not drafts_root.is_dir():
        print("未发现 .solaire/drafts，跳过。")
        return 0

    from solaire.web.exam_workspace_service import import_legacy_draft_yaml

    yamls = sorted(drafts_root.glob("*.yaml"))
    if not yamls:
        print("草稿目录下没有 yaml 文件。")
        return 0

    migrated: list[str] = []
    for yp in yamls:
        if args.dry_run:
            print(f"[dry-run] 将迁移 {yp.name}")
            continue
        try:
            info = import_legacy_draft_yaml(root, yp)
            migrated.append(f"{yp.name} -> exams/{info['exam_id']}/")
            yp.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001
            print(f"错误 {yp.name}: {e}", file=sys.stderr)
            return 1

    for line in migrated:
        print(line)
    if args.dry_run:
        print(f"共 {len(yamls)} 个文件（未实际执行）")
    else:
        print(f"完成：已迁移 {len(migrated)} 个草稿。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

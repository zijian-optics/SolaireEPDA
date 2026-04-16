"""KnowledgeForge 领域服务：文件持久化 + 基础校验。

M2 重构：支持按科目分图存储。
- 每个科目对应独立 YAML: resource/graph/{slug}.yaml
- 全局元信息: resource/graph/_meta.yaml（科目列表 + levels）
- 向后兼容：检测到旧 state.yaml 时自动迁移

注意：此模块不依赖 solaire.web.*，路径安全通过 solaire.common.security 处理。
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from solaire.common.security import assert_within_project

_GRAPH_DIR_NAME = "graph"
_STATE_FILENAME = "state.yaml"
_META_FILENAME = "_meta.yaml"

_ALLOWED_NODE_KINDS = frozenset({"concept", "skill", "causal"})

# 进程内缓存：按文件 mtime 失效，减少重复 YAML 读盘与解析
_meta_cache: dict[str, tuple[float, GraphMeta]] = {}
_state_cache: dict[tuple[str, str], tuple[float, GraphState]] = {}


def _graph_root_key(project_root: Path) -> str:
    return str(project_root.resolve())


def _invalidate_graph_cache(project_root: Path) -> None:
    """迁移或多文件变更后清空该工程下的缓存。"""
    rk = _graph_root_key(project_root)
    _meta_cache.pop(rk, None)
    for k in list(_state_cache.keys()):
        if k[0] == rk:
            del _state_cache[k]


_ALLOWED_RELATION_TYPES = frozenset(
    {
        # 先修
        "prerequisite",
        # 组成
        "part_of",
        # 弱关联（含原「技能依赖」边迁移后的概念↔技能弱连接）
        "related",
        # 因果
        "causal",
    }
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class GraphNodeNote(BaseModel):
    """图谱节点上的多条维护笔记（富文本与题目题干同源序列化）。"""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    body: str = Field(default="", description="HTML/占位串，前端用 ContentWithPrimeBrush 预览")
    created_at: datetime = Field(default_factory=_now_utc)


class ConceptNode(BaseModel):
    """图谱节点；需求书中的 Concept / Skill / Causal 以 node_kind 区分（同表存储）。"""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    canonical_name: str = Field(min_length=1)
    node_kind: Literal["concept", "skill", "causal"] = Field(
        default="concept",
        description="节点类型：知识点 / 技能 / 因果",
    )
    aliases: list[str] = Field(default_factory=list)
    subject: str | None = None
    level: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    source: str | None = None
    layout_x: float | None = None
    layout_y: float | None = None
    primary_parent_id: str | None = None
    """思维导图视角的主父节点 ID，用于构建严格树结构。"""
    notes: list[GraphNodeNote] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now_utc)
    updated_at: datetime = Field(default_factory=_now_utc)

    @field_validator("node_kind", mode="before")
    @classmethod
    def _coerce_node_kind(cls, v: Any) -> str:
        if v is None or v == "":
            return "concept"
        s = str(v).strip()
        if s not in _ALLOWED_NODE_KINDS:
            raise ValueError(f"Invalid node_kind: {v}")
        return s


class GraphTaxonomy(BaseModel):
    """学科、层级等下拉选项（可由前端追加）。"""

    subjects: list[str] = Field(default_factory=lambda: ["数学"])
    levels: list[str] = Field(default_factory=lambda: ["高中", "高考"])


class NodeFileLink(BaseModel):
    id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    relative_path: str = Field(min_length=1, description="相对 resource/ 的路径")
    created_at: datetime = Field(default_factory=_now_utc)


class NodeRelation(BaseModel):
    id: str = Field(min_length=1)
    from_node_id: str = Field(min_length=1)
    to_node_id: str = Field(min_length=1)
    relation_type: str


class QuestionBinding(BaseModel):
    question_qualified_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)


class GraphState(BaseModel):
    version: int = 1
    taxonomy: GraphTaxonomy = Field(default_factory=GraphTaxonomy)
    nodes: list[ConceptNode] = Field(default_factory=list)
    relations: list[NodeRelation] = Field(default_factory=list)
    bindings: list[QuestionBinding] = Field(default_factory=list)
    file_links: list[NodeFileLink] = Field(default_factory=list)


class SubjectMeta(BaseModel):
    """单个科目图谱的元信息。"""

    slug: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    node_count: int = 0


class GraphMeta(BaseModel):
    """全局图谱元信息，存储在 _meta.yaml。"""

    version: int = 1
    subjects: list[SubjectMeta] = Field(default_factory=list)
    levels: list[str] = Field(default_factory=lambda: ["高中", "高考"])


# ---------------------------------------------------------------------------
# 路径辅助
# ---------------------------------------------------------------------------


def _graph_dir(project_root: Path) -> Path:
    return (project_root / "resource" / _GRAPH_DIR_NAME).resolve()


def _legacy_state_path(project_root: Path) -> Path:
    return (_graph_dir(project_root) / _STATE_FILENAME).resolve()


def _meta_path(project_root: Path) -> Path:
    return (_graph_dir(project_root) / _META_FILENAME).resolve()


def _subject_state_path(project_root: Path, slug: str) -> Path:
    safe = _safe_slug(slug)
    return (_graph_dir(project_root) / f"{safe}.yaml").resolve()


# ---------------------------------------------------------------------------
# slug 处理
# ---------------------------------------------------------------------------


def _safe_slug(s: str) -> str:
    """将任意字符串转换为文件名安全的 slug（保留中文、字母、数字、连字符）。"""
    s = s.strip()
    buf: list[str] = []
    for ch in s:
        cat = unicodedata.category(ch)
        if ch.isascii() and ch.isalnum():
            buf.append(ch.lower())
        elif "\u4e00" <= ch <= "\u9fff":
            buf.append(ch)
        elif ch in " \t-_/":
            buf.append("-")
        elif cat.startswith("L") or cat.startswith("N"):
            buf.append(ch)
    result = "".join(buf).strip("-")
    result = re.sub(r"-+", "-", result)
    return (result[:48] if result else "graph") or "graph"


def _slugify_name(name: str) -> str:
    buf: list[str] = []
    for ch in (name or "").strip():
        if ch.isascii() and ch.isalnum():
            buf.append(ch.lower())
        elif ch in " \t-_/":
            buf.append("-")
        elif "\u4e00" <= ch <= "\u9fff":
            buf.append(ch)
    s = "".join(buf).strip("-")
    s = re.sub(r"-+", "-", s)
    return (s[:48] if s else "node") or "node"


# ---------------------------------------------------------------------------
# 目录初始化
# ---------------------------------------------------------------------------


def ensure_graph_layout(project_root: Path) -> None:
    """Ensure resource/graph/ exists. Migrate legacy state.yaml if needed."""
    graph_dir = _graph_dir(project_root)
    graph_dir.mkdir(parents=True, exist_ok=True)
    assert_within_project(project_root, graph_dir)

    legacy = _legacy_state_path(project_root)
    meta_p = _meta_path(project_root)

    if legacy.is_file() and not meta_p.is_file():
        _migrate_legacy_to_multi(project_root)


# ---------------------------------------------------------------------------
# _meta.yaml 读写
# ---------------------------------------------------------------------------


def _load_meta(project_root: Path) -> GraphMeta:
    mp = _meta_path(project_root)
    assert_within_project(project_root, mp)
    rk = _graph_root_key(project_root)
    if not mp.is_file():
        return GraphMeta().model_copy(deep=True)
    mtime = mp.stat().st_mtime
    hit = _meta_cache.get(rk)
    if hit is not None and hit[0] == mtime:
        return hit[1].model_copy(deep=True)
    raw = mp.read_text(encoding="utf-8")
    if not raw.strip():
        empty = GraphMeta()
        _meta_cache[rk] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        empty = GraphMeta()
        _meta_cache[rk] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    gm = GraphMeta.model_validate(data)
    _meta_cache[rk] = (mtime, gm.model_copy(deep=True))
    return gm.model_copy(deep=True)


def _save_meta(project_root: Path, meta: GraphMeta) -> None:
    ensure_graph_layout.__wrapped__(project_root)  # just mkdir, no migration loop
    mp = _meta_path(project_root)
    assert_within_project(project_root, mp)
    mp.write_text(
        yaml.safe_dump(meta.model_dump(mode="json"), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    mtime = mp.stat().st_mtime
    _meta_cache[_graph_root_key(project_root)] = (mtime, meta.model_copy(deep=True))


def _ensure_graph_dir_only(project_root: Path) -> None:
    """仅创建目录，不触发迁移逻辑（避免迁移函数内循环调用）。"""
    graph_dir = _graph_dir(project_root)
    graph_dir.mkdir(parents=True, exist_ok=True)
    assert_within_project(project_root, graph_dir)


# 给 _save_meta 用的不触发迁移的版本
ensure_graph_layout.__wrapped__ = _ensure_graph_dir_only  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# 科目图谱读写
# ---------------------------------------------------------------------------


def _migrate_legacy_graph_state(state: GraphState) -> bool:
    """将旧版 uses_skill 关系迁移为 related。"""
    changed = False
    new_rels: list[NodeRelation] = []
    for r in state.relations:
        if r.relation_type == "uses_skill":
            new_rels.append(
                NodeRelation(
                    id=r.id,
                    from_node_id=r.from_node_id,
                    to_node_id=r.to_node_id,
                    relation_type="related",
                )
            )
            changed = True
        else:
            new_rels.append(r)
    state.relations = new_rels
    return changed


def _load_subject_state(project_root: Path, slug: str) -> GraphState:
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    rk = _graph_root_key(project_root)
    cache_key = (rk, slug)
    if not sp.is_file():
        return GraphState().model_copy(deep=True)
    mtime = sp.stat().st_mtime
    hit = _state_cache.get(cache_key)
    if hit is not None and hit[0] == mtime:
        return hit[1].model_copy(deep=True)
    raw = sp.read_text(encoding="utf-8")
    if not raw.strip():
        empty = GraphState()
        _state_cache[cache_key] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    data = yaml.safe_load(raw)
    if data is None:
        empty = GraphState()
        _state_cache[cache_key] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    if not isinstance(data, dict):
        raise ValueError(f"Invalid graph state file for subject {slug!r}")
    state = GraphState.model_validate(data)
    if _migrate_legacy_graph_state(state):
        _save_subject_state(project_root, slug, state)
        return _load_subject_state(project_root, slug)
    _state_cache[cache_key] = (mtime, state.model_copy(deep=True))
    return state.model_copy(deep=True)


def _save_subject_state(project_root: Path, slug: str, state: GraphState) -> None:
    _ensure_graph_dir_only(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    payload = state.model_dump(mode="json")
    sp.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    mtime = sp.stat().st_mtime
    _state_cache[(_graph_root_key(project_root), slug)] = (mtime, state.model_copy(deep=True))


# ---------------------------------------------------------------------------
# 旧版单文件 state.yaml 迁移
# ---------------------------------------------------------------------------


def _migrate_legacy_to_multi(project_root: Path) -> None:
    """将旧 state.yaml 按 node.subject 字段拆分为多科目文件。"""
    legacy = _legacy_state_path(project_root)
    if not legacy.is_file():
        return

    raw = legacy.read_text(encoding="utf-8")
    if not raw.strip():
        legacy.rename(legacy.with_suffix(".yaml.bak"))
        return

    data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        legacy.rename(legacy.with_suffix(".yaml.bak"))
        return

    old_state = GraphState.model_validate(data)
    _migrate_legacy_graph_state(old_state)

    # 推断每个节点的 primary_parent_id（取第一个 part_of 父节点）
    parent_map: dict[str, str] = {}
    for r in old_state.relations:
        if r.relation_type == "part_of" and r.from_node_id not in parent_map:
            parent_map[r.from_node_id] = r.to_node_id

    for n in old_state.nodes:
        if n.primary_parent_id is None and n.id in parent_map:
            n.primary_parent_id = parent_map[n.id]

    # 按科目分组
    groups: dict[str, list[str]] = {}
    no_subject_slug = "_default"
    for n in old_state.nodes:
        subj = (n.subject or "").strip() or no_subject_slug
        slug = _safe_slug(subj)
        groups.setdefault(slug, [])
        if n.id not in groups[slug]:
            groups[slug].append(n.id)

    meta = GraphMeta(
        subjects=[],
        levels=list(old_state.taxonomy.levels) if old_state.taxonomy.levels else ["高中", "高考"],
    )

    for slug, node_ids in groups.items():
        id_set = set(node_ids)
        nodes = [n for n in old_state.nodes if n.id in id_set]
        relations = [
            r for r in old_state.relations if r.from_node_id in id_set or r.to_node_id in id_set
        ]
        bindings = [b for b in old_state.bindings if b.node_id in id_set]
        file_links = [l for l in old_state.file_links if l.node_id in id_set]

        new_state = GraphState(
            nodes=nodes,
            relations=relations,
            bindings=bindings,
            file_links=file_links,
        )
        _ensure_graph_dir_only(project_root)
        _save_subject_state(project_root, slug, new_state)

        display_name = slug
        if nodes:
            first_subject = nodes[0].subject
            if first_subject and first_subject.strip():
                display_name = first_subject.strip()
        meta.subjects.append(SubjectMeta(slug=slug, display_name=display_name, node_count=len(nodes)))

    _ensure_graph_dir_only(project_root)
    _save_meta(project_root, meta)

    bak = legacy.with_name("state.yaml.bak")
    legacy.rename(bak)


# ---------------------------------------------------------------------------
# 兼容旧式 _load_state（使用第一个科目，或 legacy）
# ---------------------------------------------------------------------------


def _get_default_slug(project_root: Path) -> str | None:
    """返回元数据中第一个科目的 slug，若无则返回 None。"""
    meta = _load_meta(project_root)
    if meta.subjects:
        return meta.subjects[0].slug
    return None


def _load_state(project_root: Path) -> GraphState:
    """兼容接口：从第一个科目或 legacy 文件读取。"""
    ensure_graph_layout(project_root)
    slug = _get_default_slug(project_root)
    if slug:
        return _load_subject_state(project_root, slug)
    # 没有任何科目图谱：返回空状态
    return GraphState()


def load_graph(project_root: Path) -> GraphState:
    """Load persisted graph state from the first subject (public API, legacy compat)."""
    return _load_state(project_root)


# ---------------------------------------------------------------------------
# 多图谱管理
# ---------------------------------------------------------------------------


def list_graphs(project_root: Path) -> list[dict[str, Any]]:
    """列出所有科目图谱，含节点数统计。"""
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    result = []
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        result.append(
            {
                "slug": sm.slug,
                "display_name": sm.display_name,
                "node_count": len(state.nodes),
            }
        )
    return result


def create_graph(project_root: Path, display_name: str, slug: str | None = None) -> str:
    """创建新科目图谱，返回 slug。"""
    ensure_graph_layout(project_root)
    if not display_name.strip():
        raise ValueError("display_name 不能为空")
    computed_slug = slug.strip() if slug and slug.strip() else _safe_slug(display_name)
    if not computed_slug:
        computed_slug = "graph"

    meta = _load_meta(project_root)
    existing_slugs = {sm.slug for sm in meta.subjects}
    final_slug = computed_slug
    if final_slug in existing_slugs:
        # 追加随机后缀避免冲突
        for _ in range(12):
            cand = f"{computed_slug}-{uuid.uuid4().hex[:4]}"
            if cand not in existing_slugs:
                final_slug = cand
                break
        else:
            raise ValueError(f"无法生成唯一科目 slug: {computed_slug}")

    sp = _subject_state_path(project_root, final_slug)
    assert_within_project(project_root, sp)
    empty = GraphState()
    _save_subject_state(project_root, final_slug, empty)

    meta.subjects.append(SubjectMeta(slug=final_slug, display_name=display_name.strip(), node_count=0))
    _save_meta(project_root, meta)
    return final_slug


def delete_graph(project_root: Path, slug: str) -> None:
    """删除科目图谱及其数据文件。"""
    ensure_graph_layout(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    if sp.is_file():
        sp.unlink()
    _state_cache.pop((_graph_root_key(project_root), slug), None)

    meta = _load_meta(project_root)
    meta.subjects = [sm for sm in meta.subjects if sm.slug != slug]
    _save_meta(project_root, meta)


def rename_graph(project_root: Path, slug: str, new_display_name: str) -> None:
    """修改科目图谱的显示名称。"""
    ensure_graph_layout(project_root)
    if not new_display_name.strip():
        raise ValueError("display_name 不能为空")
    meta = _load_meta(project_root)
    found = False
    for sm in meta.subjects:
        if sm.slug == slug:
            sm.display_name = new_display_name.strip()
            found = True
            break
    if not found:
        raise FileNotFoundError(f"科目图谱不存在: {slug!r}")
    _save_meta(project_root, meta)


def get_taxonomy(project_root: Path) -> dict[str, Any]:
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    # 兼容：从第一个科目 state 读 taxonomy（旧字段）
    slug = _get_default_slug(project_root)
    subjects_list = [sm.display_name for sm in meta.subjects]
    levels = meta.levels
    if slug:
        state = _load_subject_state(project_root, slug)
        if state.taxonomy.subjects:
            subjects_list = state.taxonomy.subjects
        if state.taxonomy.levels:
            levels = state.taxonomy.levels
    return {"subjects": subjects_list, "levels": levels}


def set_taxonomy(project_root: Path, *, subjects: list[str] | None, levels: list[str] | None) -> None:
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    if levels is not None:
        meta.levels = [s.strip() for s in levels if s.strip()]
    if subjects is not None:
        cleaned = [s.strip() for s in subjects if s.strip()]
        existing_slugs = {sm.slug for sm in meta.subjects}
        existing_names = {sm.display_name for sm in meta.subjects}
        for name in cleaned:
            if name not in existing_names:
                slug = _safe_slug(name)
                if slug in existing_slugs:
                    for _ in range(12):
                        cand = f"{slug}-{uuid.uuid4().hex[:4]}"
                        if cand not in existing_slugs:
                            slug = cand
                            break
                meta.subjects.append(SubjectMeta(slug=slug, display_name=name, node_count=0))
                existing_slugs.add(slug)
                existing_names.add(name)
                sp = _subject_state_path(project_root, slug)
                assert_within_project(project_root, sp)
                if not sp.is_file():
                    _save_subject_state(project_root, slug, GraphState())
    _save_meta(project_root, meta)


# ---------------------------------------------------------------------------
# 节点校验
# ---------------------------------------------------------------------------


def _node_kind_of(state: GraphState, node_id: str) -> str:
    for n in state.nodes:
        if n.id == node_id:
            return n.node_kind
    return "concept"


def _validate_relation_endpoints(state: GraphState, from_node_id: str, to_node_id: str) -> None:
    """技能节点与因果节点之间不可连边；至少一端须为知识点。"""
    kf = _node_kind_of(state, from_node_id)
    kt = _node_kind_of(state, to_node_id)
    if kf != "concept" and kt != "concept":
        raise ValueError("关系仅允许至少一端为知识点节点（技能与因果节点之间不可互连）")


# ---------------------------------------------------------------------------
# 节点 ID 生成
# ---------------------------------------------------------------------------


def _collect_node_ids_and_kinds(project_root: Path) -> tuple[set[str], dict[str, str]]:
    """单次遍历所有科目：全局节点 id 集合 + id -> node_kind（跨科目）。"""
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    all_ids: set[str] = set()
    kinds: dict[str, str] = {}
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        for n in state.nodes:
            all_ids.add(n.id)
            kinds[n.id] = n.node_kind
    return all_ids, kinds


def generate_unique_node_id(project_root: Path, parent_node_id: str, canonical_name: str) -> str:
    parent = parent_node_id.strip().rstrip("/")
    if not parent:
        raise ValueError("parent_node_id required")
    base = f"{parent}/{_slugify_name(canonical_name)}"
    all_ids, _ = _collect_node_ids_and_kinds(project_root)
    if base not in all_ids:
        return base
    for _ in range(24):
        cand = f"{base}-{uuid.uuid4().hex[:6]}"
        if cand not in all_ids:
            return cand
    raise ValueError("Could not generate unique node id")


# ---------------------------------------------------------------------------
# 节点 CRUD（按科目）
# ---------------------------------------------------------------------------


def list_concept_nodes(
    project_root: Path,
    *,
    node_kind: str | None = None,
    graph: str | None = None,
) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    if graph:
        slugs = [graph]
    else:
        meta = _load_meta(project_root)
        slugs = [sm.slug for sm in meta.subjects]
        if not slugs:
            # 兼容旧 state.yaml
            legacy = _legacy_state_path(project_root)
            if legacy.is_file():
                raw = legacy.read_text(encoding="utf-8")
                if raw.strip():
                    data = yaml.safe_load(raw)
                    if isinstance(data, dict):
                        state = GraphState.model_validate(data)
                        _migrate_legacy_graph_state(state)
                        rows = [n.model_dump(mode="json") for n in state.nodes]
                        if node_kind:
                            rows = [r for r in rows if r.get("node_kind") == node_kind]
                        return rows
            return []

    all_nodes: list[ConceptNode] = []
    all_file_counts: dict[str, int] = {}
    for slug in slugs:
        state = _load_subject_state(project_root, slug)
        all_nodes.extend(state.nodes)
        for l in state.file_links:
            all_file_counts[l.node_id] = all_file_counts.get(l.node_id, 0) + 1

    rows = [n.model_dump(mode="json") for n in all_nodes]
    if node_kind is not None:
        nk = node_kind.strip()
        if nk not in _ALLOWED_NODE_KINDS:
            raise ValueError(f"Invalid node_kind filter: {node_kind}")
        rows = [r for r in rows if r.get("node_kind") == nk]

    for r in rows:
        r["file_link_count"] = all_file_counts.get(r["id"], 0)
    return rows


def count_nodes_by_kind(project_root: Path, *, graph: str | None = None) -> dict[str, int]:
    ensure_graph_layout(project_root)
    out: dict[str, int] = {k: 0 for k in sorted(_ALLOWED_NODE_KINDS)}
    if graph:
        state = _load_subject_state(project_root, graph)
        for n in state.nodes:
            out[n.node_kind] = out.get(n.node_kind, 0) + 1
    else:
        meta = _load_meta(project_root)
        for sm in meta.subjects:
            state = _load_subject_state(project_root, sm.slug)
            for n in state.nodes:
                out[n.node_kind] = out.get(n.node_kind, 0) + 1
    return out


def _find_node_slug(project_root: Path, node_id: str) -> str | None:
    """找到节点所在的科目 slug。"""
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(n.id == node_id for n in state.nodes):
            return sm.slug
    return None


def get_concept_node(project_root: Path, node_id: str, *, graph: str | None = None) -> dict[str, Any]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state(project_root, graph)
        for n in state.nodes:
            if n.id == node_id:
                return n.model_dump(mode="json")
        raise FileNotFoundError(f"Node not found: {node_id}")
    slug = _find_node_slug(project_root, node_id)
    if slug is None:
        raise FileNotFoundError(f"Node not found: {node_id}")
    state = _load_subject_state(project_root, slug)
    for n in state.nodes:
        if n.id == node_id:
            return n.model_dump(mode="json")
    raise FileNotFoundError(f"Node not found: {node_id}")


def create_concept_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    node = ConceptNode.model_validate(payload)

    # 确定目标科目 slug
    target_slug: str
    if graph:
        target_slug = graph
    else:
        subj = (node.subject or "").strip()
        if subj:
            meta = _load_meta(project_root)
            matched = next((sm.slug for sm in meta.subjects if sm.display_name == subj), None)
            if matched:
                target_slug = matched
            else:
                target_slug = create_graph(project_root, subj)
        else:
            meta = _load_meta(project_root)
            if meta.subjects:
                target_slug = meta.subjects[0].slug
            else:
                target_slug = create_graph(project_root, "默认")

    state = _load_subject_state(project_root, target_slug)
    # 全局唯一性检查（节点 id 跨科目唯一）
    all_ids, _ = _collect_node_ids_and_kinds(project_root)
    if node.id in all_ids:
        raise ValueError(f"Node already exists: {node.id}")

    state.nodes.append(node)
    _save_subject_state(project_root, target_slug, state)
    return node.id


def update_concept_node(
    project_root: Path,
    node_id: str,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        raise FileNotFoundError(f"Node not found: {node_id}")

    state = _load_subject_state(project_root, slug)
    if not any(n.id == node_id for n in state.nodes):
        raise FileNotFoundError(f"Node not found: {node_id}")

    data = dict(payload)
    data["id"] = node_id
    updated = ConceptNode.model_validate(data)

    for i, n in enumerate(state.nodes):
        if n.id == node_id:
            updated.created_at = n.created_at
            updated.updated_at = _now_utc()
            state.nodes[i] = updated
            break

    _save_subject_state(project_root, slug, state)


def delete_concept_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> dict[str, Any]:
    """删除节点；返回被删节点与涉及的关系（供撤销/前端增量同步）。"""
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return {"deleted_node": None, "deleted_relations": []}

    state = _load_subject_state(project_root, slug)
    removed_node: dict[str, Any] | None = None
    for n in state.nodes:
        if n.id == node_id:
            removed_node = n.model_dump(mode="json")
            break
    removed_rels = [
        r.model_dump(mode="json")
        for r in state.relations
        if r.from_node_id == node_id or r.to_node_id == node_id
    ]
    state.nodes = [n for n in state.nodes if n.id != node_id]
    state.relations = [
        r for r in state.relations if r.from_node_id != node_id and r.to_node_id != node_id
    ]
    state.bindings = [b for b in state.bindings if b.node_id != node_id]
    state.file_links = [l for l in state.file_links if l.node_id != node_id]
    _save_subject_state(project_root, slug, state)
    return {"deleted_node": removed_node, "deleted_relations": removed_rels}


# ---------------------------------------------------------------------------
# 关系 CRUD
# ---------------------------------------------------------------------------


def _find_relation_slug(project_root: Path, relation_id: str) -> str | None:
    """找到关系所在的科目 slug。"""
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(r.id == relation_id for r in state.relations):
            return sm.slug
    return None


def list_node_relations(project_root: Path, *, graph: str | None = None) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state(project_root, graph)
        return [r.model_dump(mode="json") for r in state.relations]
    meta = _load_meta(project_root)
    all_rels: list[dict[str, Any]] = []
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        all_rels.extend(r.model_dump(mode="json") for r in state.relations)
    return all_rels


def create_node_relation(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    from_node_id = str(payload.get("from_node_id") or "").strip()
    to_node_id = str(payload.get("to_node_id") or "").strip()
    relation_type = str(payload.get("relation_type") or "").strip()

    if not from_node_id or not to_node_id or not relation_type:
        raise ValueError("relation requires from_node_id, to_node_id, relation_type")
    if relation_type not in _ALLOWED_RELATION_TYPES:
        raise ValueError(f"Invalid relation_type: {relation_type}")

    # 确定目标科目
    if graph:
        target_slug = graph
    else:
        slug_from = _find_node_slug(project_root, from_node_id)
        slug_to = _find_node_slug(project_root, to_node_id)
        if slug_from is None and slug_to is None:
            raise ValueError("Both from/to nodes must exist before creating relation")
        target_slug = slug_from or slug_to  # type: ignore[assignment]

    state = _load_subject_state(project_root, target_slug)
    all_node_ids, kinds = _collect_node_ids_and_kinds(project_root)

    if from_node_id not in all_node_ids or to_node_id not in all_node_ids:
        raise ValueError("Both from/to nodes must exist before creating relation")

    kf = kinds.get(from_node_id, "concept")
    kt = kinds.get(to_node_id, "concept")
    if kf != "concept" and kt != "concept":
        raise ValueError("关系仅允许至少一端为知识点节点（技能与因果节点之间不可互连）")

    # 幂等
    for r in state.relations:
        if (
            r.from_node_id == from_node_id
            and r.to_node_id == to_node_id
            and r.relation_type == relation_type
        ):
            return r.id

    rel_id = uuid.uuid4().hex
    rel = NodeRelation(
        id=rel_id,
        from_node_id=from_node_id,
        to_node_id=to_node_id,
        relation_type=relation_type,
    )
    state.relations.append(rel)
    _save_subject_state(project_root, target_slug, state)
    return rel_id


def delete_node_relation(
    project_root: Path,
    relation_id: str,
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    slug = graph or _find_relation_slug(project_root, relation_id)
    if slug is None:
        return  # 幂等
    state = _load_subject_state(project_root, slug)
    state.relations = [r for r in state.relations if r.id != relation_id]
    _save_subject_state(project_root, slug, state)


def update_node_relation(
    project_root: Path,
    relation_id: str,
    *,
    relation_type: str | None = None,
    reverse: bool = False,
    graph: str | None = None,
) -> None:
    """更新关系：可修改类型或颠倒方向。"""
    ensure_graph_layout(project_root)
    slug = graph or _find_relation_slug(project_root, relation_id)
    if slug is None:
        raise FileNotFoundError(f"Relation not found: {relation_id}")
    state = _load_subject_state(project_root, slug)
    for i, r in enumerate(state.relations):
        if r.id == relation_id:
            new_from = r.to_node_id if reverse else r.from_node_id
            new_to = r.from_node_id if reverse else r.to_node_id
            new_type = (relation_type or r.relation_type).strip()
            if new_type not in _ALLOWED_RELATION_TYPES:
                raise ValueError(f"Invalid relation_type: {new_type}")
            state.relations[i] = NodeRelation(
                id=r.id,
                from_node_id=new_from,
                to_node_id=new_to,
                relation_type=new_type,
            )
            break
    _save_subject_state(project_root, slug, state)


# ---------------------------------------------------------------------------
# 绑定
# ---------------------------------------------------------------------------


def bind_question_to_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    qid = str(payload.get("question_qualified_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    if not qid or not node_id:
        raise ValueError("binding requires question_qualified_id and node_id")

    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        raise ValueError(f"Node not found: {node_id}")
    state = _load_subject_state(project_root, slug)
    if not any(n.id == node_id for n in state.nodes):
        raise ValueError(f"Node not found: {node_id}")

    pair = (qid, node_id)
    if any((b.question_qualified_id, b.node_id) == pair for b in state.bindings):
        return
    state.bindings.append(QuestionBinding(question_qualified_id=qid, node_id=node_id))
    _save_subject_state(project_root, slug, state)


def unbind_question_from_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    qid = str(payload.get("question_qualified_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return
    state = _load_subject_state(project_root, slug)
    state.bindings = [
        b for b in state.bindings if not (b.question_qualified_id == qid and b.node_id == node_id)
    ]
    _save_subject_state(project_root, slug, state)


def list_questions_for_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> list[str]:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return []
    state = _load_subject_state(project_root, slug)
    qids = [b.question_qualified_id for b in state.bindings if b.node_id == node_id]
    seen: set[str] = set()
    out: list[str] = []
    for q in qids:
        if q in seen:
            continue
        seen.add(q)
        out.append(q)
    return out


def list_nodes_for_question(project_root: Path, question_qualified_id: str) -> list[ConceptNode]:
    """Return concept nodes that have a binding to the given question qualified id."""
    ensure_graph_layout(project_root)
    qid = (question_qualified_id or "").strip()
    if not qid:
        return []
    meta = _load_meta(project_root)
    out: list[ConceptNode] = []
    seen: set[str] = set()
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        node_ids = {b.node_id for b in state.bindings if b.question_qualified_id == qid}
        by_id = {n.id: n for n in state.nodes}
        for nid in sorted(node_ids):
            if nid in seen:
                continue
            n = by_id.get(nid)
            if n is not None:
                seen.add(nid)
                out.append(n)
    return out


def bind_questions_batch(
    project_root: Path,
    *,
    node_id: str,
    qualified_ids: list[str],
    graph: str | None = None,
) -> dict[str, Any]:
    """Bind multiple questions to one node; idempotent for existing pairs."""
    ensure_graph_layout(project_root)
    nid = (node_id or "").strip()
    if not nid:
        raise ValueError("node_id required")

    slug = graph or _find_node_slug(project_root, nid)
    if slug is None:
        raise ValueError(f"Node not found: {nid}")
    state = _load_subject_state(project_root, slug)
    if not any(n.id == nid for n in state.nodes):
        raise ValueError(f"Node not found: {nid}")

    added = 0
    skipped = 0
    existing_pairs = {(b.question_qualified_id, b.node_id) for b in state.bindings}
    for raw in qualified_ids:
        qid = (raw or "").strip()
        if not qid:
            skipped += 1
            continue
        pair = (qid, nid)
        if pair in existing_pairs:
            skipped += 1
            continue
        state.bindings.append(QuestionBinding(question_qualified_id=qid, node_id=nid))
        existing_pairs.add(pair)
        added += 1
    if added:
        _save_subject_state(project_root, slug, state)
    return {"added": added, "skipped": skipped}


def unbind_questions_batch(
    project_root: Path,
    *,
    node_id: str,
    qualified_ids: list[str],
    graph: str | None = None,
) -> dict[str, Any]:
    """Remove bindings for multiple questions from one node."""
    ensure_graph_layout(project_root)
    nid = (node_id or "").strip()
    if not nid:
        raise ValueError("node_id required")
    slug = graph or _find_node_slug(project_root, nid)
    if slug is None:
        return {"removed": 0}
    state = _load_subject_state(project_root, slug)
    target = {(q or "").strip() for q in qualified_ids if (q or "").strip()}
    if not target:
        return {"removed": 0}
    before = len(state.bindings)
    state.bindings = [
        b for b in state.bindings if not (b.node_id == nid and b.question_qualified_id in target)
    ]
    removed = before - len(state.bindings)
    if removed:
        _save_subject_state(project_root, slug, state)
    return {"removed": removed}


# ---------------------------------------------------------------------------
# 资料链接
# ---------------------------------------------------------------------------


def _resolve_resource_path(project_root: Path, relative_under_resource: str) -> Path:
    rel = relative_under_resource.strip().replace("\\", "/").lstrip("/")
    resource = (project_root / "resource").resolve()
    target = (resource / rel).resolve()
    try:
        target.relative_to(resource)
    except ValueError as e:
        raise ValueError("Path must stay under resource/") from e
    assert_within_project(project_root, target)
    return target


def list_resource_files(project_root: Path, query: str = "", *, limit: int = 800) -> list[dict[str, Any]]:
    """列出 resource/ 下文件（相对路径），供资料关联选择。"""
    resource = (project_root / "resource").resolve()
    assert_within_project(project_root, resource)
    q = (query or "").strip().lower()
    out: list[dict[str, Any]] = []
    if not resource.is_dir():
        return out
    for p in resource.rglob("*"):
        if not p.is_file():
            continue
        try:
            rel = p.relative_to(resource).as_posix()
        except ValueError:
            continue
        if any(part.startswith(".") for part in Path(rel).parts):
            continue
        if q and q not in rel.lower():
            continue
        try:
            st = p.stat()
            sz = int(st.st_size)
        except OSError:
            sz = 0
        out.append({"path": rel, "size": sz})
        if len(out) >= limit * 4:
            break
    out.sort(key=lambda x: x["path"])
    return out[:limit]


def list_file_links_for_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return []
    state = _load_subject_state(project_root, slug)
    return [l.model_dump(mode="json") for l in state.file_links if l.node_id == node_id]


def attach_file_to_node(
    project_root: Path,
    node_id: str,
    relative_path: str,
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        raise ValueError(f"Node not found: {node_id}")
    state = _load_subject_state(project_root, slug)
    if not any(n.id == node_id for n in state.nodes):
        raise ValueError(f"Node not found: {node_id}")
    rel = relative_path.strip().replace("\\", "/").lstrip("/")
    target = _resolve_resource_path(project_root, rel)
    if not target.is_file():
        raise ValueError("File does not exist")
    for l in state.file_links:
        if l.node_id == node_id and l.relative_path == rel:
            return l.id
    link_id = uuid.uuid4().hex
    state.file_links.append(NodeFileLink(id=link_id, node_id=node_id, relative_path=rel))
    _save_subject_state(project_root, slug, state)
    return link_id


def _find_file_link_slug(project_root: Path, link_id: str) -> str | None:
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(l.id == link_id for l in state.file_links):
            return sm.slug
    return None


def detach_file_link(
    project_root: Path,
    link_id: str,
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    slug = graph or _find_file_link_slug(project_root, link_id)
    if slug is None:
        return
    state = _load_subject_state(project_root, slug)
    state.file_links = [l for l in state.file_links if l.id != link_id]
    _save_subject_state(project_root, slug, state)

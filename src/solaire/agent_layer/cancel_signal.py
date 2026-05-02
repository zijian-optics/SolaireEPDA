"""进程内取消标记：与磁盘上的会话 JSON 解耦，供流式编排与 HTTP 停止按钮共用。"""

from __future__ import annotations

import time

_MAX_CANCELS = 1000
_CANCEL_TTL = 300  # 秒

_cancels: dict[str, float] = {}


def _evict_stale() -> None:
    now = time.time()
    stale = [sid for sid, ts in _cancels.items() if now - ts > _CANCEL_TTL]
    for sid in stale:
        del _cancels[sid]


def request_cancel(session_id: str) -> None:
    if len(_cancels) >= _MAX_CANCELS:
        _evict_stale()
    _cancels[session_id] = time.time()


def is_cancelled(session_id: str) -> bool:
    ts = _cancels.get(session_id)
    if ts is None:
        return False
    if time.time() - ts > _CANCEL_TTL:
        del _cancels[session_id]
        return False
    return True


def clear_cancel(session_id: str) -> None:
    _cancels.pop(session_id, None)

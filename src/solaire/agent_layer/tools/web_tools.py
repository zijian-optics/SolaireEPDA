"""Web tools: search (Tavily) + fetch + text extraction."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult


def tool_web_search(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    q = str(args.get("query") or "").strip()
    if not q:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="query 必填")
    try:
        max_results = int(args.get("max_results") or 5)
    except (TypeError, ValueError):
        max_results = 5
    max_results = max(1, min(max_results, 10))

    api_key = (
        os.environ.get("SOLAIRE_TAVILY_API_KEY")
        or os.environ.get("TAVILY_API_KEY")
        or os.environ.get("SOLAIRE_SEARCH_API_KEY")
        or ""
    ).strip()
    if not api_key:
        return ToolResult(
            status="failed",
            error_code="not_configured",
            error_message="未配置联网检索：请在环境中设置 SOLAIRE_TAVILY_API_KEY（或 TAVILY_API_KEY）。",
        )

    body = json.dumps(
        {
            "api_key": api_key,
            "query": q,
            "max_results": max_results,
            "search_depth": "basic",
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return ToolResult(
            status="failed",
            error_code="http_error",
            error_message=f"检索服务返回错误：{e.code}",
        )
    except (OSError, json.JSONDecodeError) as e:
        return ToolResult(status="failed", error_code="network_error", error_message=str(e))

    results: list[dict[str, Any]] = []
    for item in raw.get("results") or []:
        if not isinstance(item, dict):
            continue
        results.append(
            {
                "title": item.get("title") or "",
                "url": item.get("url") or "",
                "snippet": item.get("content") or item.get("snippet") or "",
            }
        )
    return ToolResult(
        status="succeeded",
        data={"query": q, "results": results, "answer": raw.get("answer")},
    )


def tool_web_fetch(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    url = str(args.get("url") or "").strip()
    if not url:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="url 必填")

    # 延迟导入 trafilatura，避免模块级依赖污染
    try:
        import trafilatura
    except ImportError:
        return ToolResult(
            status="failed",
            error_code="not_configured",
            error_message="网页提取功能未安装依赖（trafilatura）。请在环境中 pip install trafilatura。",
        )

    # 下载 + 正文提取
    try:
        downloaded = trafilatura.fetch_url(url)
    except Exception as e:
        return ToolResult(status="failed", error_code="fetch_error", error_message=f"抓取失败：{e}")

    if downloaded is None:
        # 回退：尝试用 urllib 下载 HTML，再交给 trafilatura 提取
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SolaireEdu/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read()
            downloaded = trafilatura.extract(html, output_format="txt", url=url)
        except Exception as e:
            return ToolResult(
                status="failed",
                error_code="no_content",
                error_message=f"未能从该页面提取文本内容：{e}",
            )
        if downloaded is None:
            return ToolResult(
                status="failed",
                error_code="no_content",
                error_message="未能从该页面提取到文本内容（可能是纯图片/视频页面，或被反爬机制拦截）。",
            )

    # 提取元数据
    metadata: dict[str, Any] = {}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SolaireEdu/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html_bytes = resp.read()
        meta = trafilatura.extract_metadata(html_bytes, default_url=url)
        if meta:
            metadata = {
                "title": meta.title or "",
                "author": meta.author or "",
                "date": meta.date or "",
            }
    except Exception:
        pass

    text_length = len(downloaded)
    return ToolResult(
        status="succeeded",
        data={
            "url": url,
            "text": downloaded[:50000],
            "text_length": text_length,
            "truncated": text_length > 50000,
            **metadata,
        },
    )

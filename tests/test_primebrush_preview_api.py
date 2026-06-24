from __future__ import annotations

from fastapi.testclient import TestClient


def test_primebrush_render_endpoint_returns_svg(web_client: TestClient) -> None:
    raw = """
primebrush:
  type: plot_2D
  seed: 42
  canvas: { width: 240, height: 180, unit: px }
  axes:
    x: { label: "x", range: [-3, 3], ticks: 1 }
    y: { label: "y", range: [-1, 1], ticks: 0.5 }
    grid: true
  elements:
    - f: "sin(x)"
      color: "#1a5fb4"
      width: 2
"""
    r = web_client.post("/api/primebrush/render", json={"source": raw, "seed": 42})

    assert r.status_code == 200
    svg = r.json()["svg"]
    assert "<svg" in svg.lower()
    assert "</svg>" in svg.lower()


def test_primebrush_render_endpoint_reports_planned_types(web_client: TestClient) -> None:
    raw = """
primebrush:
  type: geography_contour
  canvas: { width: 320, height: 220, unit: px }
"""
    r = web_client.post("/api/primebrush/render", json={"source": raw})

    assert r.status_code == 400
    assert "planned but not yet implemented" in r.json()["detail"]
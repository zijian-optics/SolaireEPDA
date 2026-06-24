import { useEffect, useMemo, useRef, useState } from "react";
import { Atom, BarChart3, Check, LineChart, Shapes, X, type LucideIcon } from "lucide-react";

import { apiPost } from "../api/client";
import { cn } from "../lib/utils";

type PrimeBrushEditorModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (fencedBlock: string) => void;
};

type Preset = {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  source: string;
};

const PRESETS: Preset[] = [
  {
    id: "geometry-median",
    label: "三角形中线",
    group: "数学几何",
    icon: Shapes,
    source: `primebrush:
  type: geometry_2d
  seed: 42
  canvas: { width: 400, height: 300, unit: px }
  style:
    stroke_width: 1.2
    font_family: sans-serif

  constructions:
    - op: triangle
      id: T1
      nodes: [A, B, C]
      attr: { type: random, min_angle: 30 }
      label:
        A: top
        B: bottom_left
        C: bottom_right

    - op: in_line
      id: M
      source: [A, B]
      params: 0.5
      label: "M"

    - op: line
      id: L1
      source: [C, M]
      style: dashed
      label: { text: "中线", pos: 0.5 }`,
  },
  {
    id: "plot-function",
    label: "函数图像",
    group: "数学函数",
    icon: LineChart,
    source: `primebrush:
  type: plot_2D
  seed: 42
  canvas: { width: 480, height: 360, unit: px }
  style:
    font_size: 11

  axes:
    x: { label: "x", range: [-5, 5], ticks: 1 }
    y: { label: "y", range: [-2, 2], ticks: 0.5, arrows: true }
    grid: true

  elements:
    - f: "sin(x)"
      domain: [-3.14, 3.14]
      color: "#1a5fb4"
      width: 2
      label: "sin"

    - f: "x**2 - 1"
      color: "#c01c28"
      style: dotted

    - op: point_on_f
      f_id: 0
      x: 1.57
      label: "P"
      show_projection: true`,
  },
  {
    id: "chart-bars",
    label: "统计柱状图",
    group: "数据图表",
    icon: BarChart3,
    source: `primebrush:
  type: chart
  seed: 42
  canvas: { width: 420, height: 280, unit: px }
  style:
    font_family: sans-serif

  kind: bar
  theme: academic
  data:
    - { label: "一班", value: 85, error: 5 }
    - { label: "二班", value: 92, error: 3 }
    - { label: "三班", value: 78, error: 8 }
  options:
    x_label: "班级"
    y_label: "平均分"
    bar_width: 0.6
    show_value: true
    show_error: true
    y_range: [0, 100]`,
  },
  {
    id: "chem-molecule",
    label: "化学结构式",
    group: "化学",
    icon: Atom,
    source: `primebrush:
  type: chemistry_molecule
  canvas: { width: 320, height: 240, unit: px }
  notation: SMILES
  value: "C(C1C(C(C(C(O1)O)O)O)O)O"`,
  },
];

const PLANNED_LABELS = ["地理等高线", "受力分析", "电路图", "射线光学", "晶格图"];

type RenderResponse = { svg: string };

function fencedPrimeBrush(source: string): string {
  return "```primebrush\n" + source.trim() + "\n```\n";
}

export function PrimeBrushEditorModal({ open, onClose, onConfirm }: PrimeBrushEditorModalProps) {
  const [selectedPresetId, setSelectedPresetId] = useState(PRESETS[0].id);
  const [source, setSource] = useState(PRESETS[0].source);
  const [svg, setSvg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const selectedPreset = useMemo(
    () => PRESETS.find((preset) => preset.id === selectedPresetId) ?? PRESETS[0],
    [selectedPresetId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedPresetId(PRESETS[0].id);
    setSource(PRESETS[0].source);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const trimmed = source.trim();
    const requestId = ++requestRef.current;
    if (!trimmed) {
      setSvg("");
      setError("请输入 PrimeBrush YAML");
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      void apiPost<RenderResponse>("/api/primebrush/render", { source: trimmed })
        .then((res) => {
          if (requestRef.current !== requestId) {
            return;
          }
          setSvg(res.svg);
          setError(null);
        })
        .catch((err: unknown) => {
          if (requestRef.current !== requestId) {
            return;
          }
          setSvg("");
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (requestRef.current === requestId) {
            setBusy(false);
          }
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, source]);

  useEffect(() => {
    if (!svg) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [svg]);

  if (!open) {
    return null;
  }

  function choosePreset(preset: Preset) {
    setSelectedPresetId(preset.id);
    setSource(preset.source);
  }

  function handleInsert() {
    onConfirm(fencedPrimeBrush(source));
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="primebrush-editor-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
    >
      <div
        className="grid max-h-[95vh] w-full max-w-6xl grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 id="primebrush-editor-title" className="text-sm font-semibold text-slate-900">
              教育绘图
            </h3>
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
              onClick={onClose}
              title="关闭"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-3 space-y-1">
            {PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = selectedPreset.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                    active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white hover:text-slate-950",
                  )}
                  onClick={() => choosePreset(preset)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{preset.label}</span>
                    <span className={cn("block truncate text-[10px]", active ? "text-slate-300" : "text-slate-400")}>
                      {preset.group}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="text-[11px] font-semibold text-slate-500">下一批</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {PLANNED_LABELS.map((label) => (
                <span key={label} className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </aside>

        <div className="grid min-h-0 grid-cols-2 gap-0">
          <section className="flex min-h-0 flex-col border-r border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">源 YAML</p>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {selectedPreset.group}
              </span>
            </div>
            <textarea
              className="mt-2 min-h-0 flex-1 resize-none rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-900 outline-none focus:border-slate-500 focus:bg-white focus:ring-2 focus:ring-slate-200"
              spellCheck={false}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </section>

          <section className="flex min-h-0 flex-col p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">预览</p>
              {busy ? <span className="text-[10px] text-slate-400">渲染中</span> : null}
            </div>
            <div className="mt-2 flex min-h-[22rem] flex-1 items-center justify-center overflow-auto rounded-md border border-slate-200 bg-white p-3">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <p className="text-xs text-amber-600">{error ?? "暂无预览"}</p>
              )}
            </div>
            {error ? <p className="mt-2 text-xs text-amber-700">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                disabled={!source.trim() || !!error}
                onClick={handleInsert}
              >
                <Check className="h-4 w-4" aria-hidden />
                插入到题目
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
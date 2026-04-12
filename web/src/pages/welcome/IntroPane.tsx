import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, GitBranch, Layers, LineChart } from "lucide-react";

export function IntroPane() {
  const { t } = useTranslation("welcome");
  const steps = [
    { icon: GitBranch, title: t("intro.step1Title"), desc: t("intro.step1Desc") },
    { icon: BookOpen, title: t("intro.step2Title"), desc: t("intro.step2Desc") },
    { icon: Layers, title: t("intro.step3Title"), desc: t("intro.step3Desc") },
    { icon: LineChart, title: t("intro.step4Title"), desc: t("intro.step4Desc") },
  ];
  return (
    <div className="max-w-2xl space-y-6 text-slate-100">
      <p className="text-sm leading-relaxed text-slate-300">{t("intro.lead")}</p>
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg border border-slate-700/80 bg-slate-900/40 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600/30 text-indigo-200">
              <s.icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t("intro.stepLabel", { n: i + 1 })}
              </p>
              <h3 className="mt-0.5 font-semibold text-white">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{s.desc}</p>
            </div>
            {i < steps.length - 1 ? (
              <ArrowRight className="ml-auto hidden h-5 w-5 shrink-0 text-slate-600 md:block" aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">{t("intro.footer")}</p>
    </div>
  );
}

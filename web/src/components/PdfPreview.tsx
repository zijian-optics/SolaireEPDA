import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ensureApiBase, resolveApiUrl } from "../api/client";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Props = {
  /** 以 `/api/...` 开头的相对路径 */
  apiPath: string;
  className?: string;
};

export function PdfPreview({ apiPath, className }: Props) {
  const { t } = useTranslation(["compose", "common"]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoadError(null);
      setFileUrl(null);
      setNumPages(0);
      try {
        await ensureApiBase();
        const u = await resolveApiUrl(apiPath);
        if (!cancelled) {
          setFileUrl(u);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  if (loadError) {
    return (
      <div className={className}>
        <p className="text-sm text-red-600" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  if (!fileUrl) {
    return (
      <div className={className}>
        <p className="text-sm text-slate-500">{t("common:processing")}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Document
        file={fileUrl}
        loading={<p className="text-sm text-slate-500">{t("common:processing")}</p>}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => setLoadError(err.message)}
      >
        <div className="flex flex-col items-center gap-4 pb-4">
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i + 1}
              pageNumber={i + 1}
              className="shadow-md"
              width={Math.min(900, typeof window !== "undefined" ? window.innerWidth - 80 : 800)}
              renderTextLayer
              renderAnnotationLayer
            />
          ))}
        </div>
      </Document>
    </div>
  );
}

import type { ReactNode } from "react";

import { apiAbsoluteUrl } from "../api/client";

/**
 * Tauri 壳下页面与后端不同源，Markdown 里以 `/api/...` 写的图片与链接需经 `apiAbsoluteUrl` 再渲染。
 * 手册与助手气泡等处的 ReactMarkdown 共用此组件。
 */

/** 手册页：大图 + 可选图注 */
export function MarkdownHelpFigureImg({ src, alt }: { src?: string; alt?: string }) {
  return (
    <figure className="my-5">
      <img
        src={src ? apiAbsoluteUrl(src) : undefined}
        alt={alt ?? ""}
        className="max-h-[min(420px,70vh)] max-w-full rounded-md border border-slate-200 bg-white p-2 shadow-sm"
        loading="lazy"
      />
      {alt ? <figcaption className="mt-2 text-center text-sm text-slate-600">{alt}</figcaption> : null}
    </figure>
  );
}

export function MarkdownHelpLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href && href.startsWith("/api/") ? apiAbsoluteUrl(href) : href}
      className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900"
      target={href?.startsWith("/") ? undefined : "_blank"}
      rel={href?.startsWith("/") ? undefined : "noreferrer noopener"}
    >
      {children}
    </a>
  );
}

/** 助手气泡等 prose 内 */
export function MarkdownProseImg({ src, alt }: { src?: string; alt?: string }) {
  return (
    <img
      src={src ? apiAbsoluteUrl(src) : undefined}
      alt={alt ?? ""}
      className="my-2 max-h-[min(360px,60vh)] max-w-full rounded border border-slate-200"
      loading="lazy"
    />
  );
}

export function MarkdownProseLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href && href.startsWith("/api/") ? apiAbsoluteUrl(href) : href}
      className="text-sky-700 underline decoration-sky-200"
      target={href?.startsWith("/") ? undefined : "_blank"}
      rel={href?.startsWith("/") ? undefined : "noreferrer noopener"}
    >
      {children}
    </a>
  );
}

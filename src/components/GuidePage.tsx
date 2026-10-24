import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft } from "lucide-react";
import markdown from "@/content/part-of-speech.md?raw";
import { Button } from "@/components/ui/button";

/** 词性对照（§3 #/guide）：现有 Markdown 页 */
export function GuidePage({ onBack }: { onBack: () => void }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-4">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        返回词表
      </Button>
      <div className="prose-measure">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="word-serif text-[24px] font-semibold leading-tight text-ink">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mt-8 border-b border-line pb-1.5 text-[17px] font-semibold text-ink">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-6 text-[15px] font-semibold text-ink">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mt-2.5 text-[14px] leading-[1.65] text-ink-soft">{children}</p>
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-3 rounded-r-btn border-l-[3px] border-brand bg-brand-wash px-3 py-2 text-[13px] leading-6 text-brand-deep">
                {children}
              </blockquote>
            ),
            ul: ({ children }) => (
              <ul className="mt-2 space-y-1 pl-5 text-[14px] leading-[1.65] text-ink-soft list-disc">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="mt-2 space-y-1 pl-5 text-[14px] leading-[1.65] text-ink-soft list-decimal">
                {children}
              </ol>
            ),
            code: ({ children, className }) =>
              className ? (
                <code className="text-[13px]">{children}</code>
              ) : (
                <code className="rounded bg-brand-wash px-1 py-0.5 text-[0.9em] text-brand-deep">
                  {children}
                </code>
              ),
            table: ({ children }) => (
              <div className="mt-3 overflow-x-auto rounded-card border border-line">
                <table className="min-w-full border-collapse text-left text-[13px] tnum">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-brand-wash text-brand-deep">{children}</thead>,
            th: ({ children }) => (
              <th className="whitespace-nowrap border-b border-line px-3 py-2 font-semibold">{children}</th>
            ),
            td: ({ children }) => (
              <td className="whitespace-nowrap border-b border-line/70 px-3 py-2 text-ink-soft last:border-b-0">
                {children}
              </td>
            ),
            hr: () => <hr className="my-6 border-line" />,
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-brand-ink underline underline-offset-4 hover:text-brand"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}

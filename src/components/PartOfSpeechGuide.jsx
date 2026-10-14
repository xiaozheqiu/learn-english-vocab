import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import markdown from "@/content/part-of-speech.md?raw";

export default function PartOfSpeechGuide({ onBack }) {
  return (
    <article className="mx-auto max-w-4xl px-1 py-2 sm:px-2 sm:py-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-10 border-b border-border pb-2 text-xl font-semibold text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-7 text-lg font-semibold text-foreground">{children}</h3>,
          p: ({ children }) => <p className="mt-3 text-sm leading-7 text-foreground sm:text-base">{children}</p>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-4 border-primary/35 bg-muted/45 px-4 py-2 text-sm leading-7 text-foreground">{children}</blockquote>,
          code: ({ children, className }) => className ? <code className="text-sm">{children}</code> : <code className="rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-primary">{children}</code>,
          ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-7 text-foreground sm:text-base">{children}</ul>,
          ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-7 text-foreground sm:text-base">{children}</ol>,
          table: ({ children }) => <div className="mt-4 overflow-x-auto rounded-lg border border-border"><table className="min-w-full border-collapse text-left text-sm">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/60 text-foreground">{children}</thead>,
          th: ({ children }) => <th className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="whitespace-nowrap border-b border-border/70 px-3 py-2 text-foreground last:border-b-0">{children}</td>,
          hr: () => <hr className="my-7 border-border" />,
          a: ({ href, children, ...props }) => {
            if (href === "./README.md") {
              return <a href="#" onClick={(event) => { event.preventDefault(); onBack(); }} {...props}>{children}</a>;
            }
            return <a href={href} className="text-primary underline underline-offset-4 hover:text-primary/80" {...props}>{children}</a>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}

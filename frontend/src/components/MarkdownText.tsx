import ReactMarkdown from 'react-markdown';

/** Safe Markdown renderer for event flavor text (no raw HTML). */
export function MarkdownText({ children, className = '' }: { children?: string | null; className?: string }) {
  const source = (children || '').trim();
  if (!source) return null;

  return (
    <div className={`markdown-text space-y-2 text-stone-300 ${className}`.trim()}>
      <ReactMarkdown
        components={{
          p: ({ children: c }) => <p className="leading-relaxed">{c}</p>,
          strong: ({ children: c }) => <strong className="font-semibold text-stone-100">{c}</strong>,
          em: ({ children: c }) => <em className="italic text-stone-200">{c}</em>,
          ul: ({ children: c }) => <ul className="list-disc space-y-1 pl-5">{c}</ul>,
          ol: ({ children: c }) => <ol className="list-decimal space-y-1 pl-5">{c}</ol>,
          li: ({ children: c }) => <li className="leading-relaxed">{c}</li>,
          h1: ({ children: c }) => <h3 className="text-lg font-semibold text-dungeon-300">{c}</h3>,
          h2: ({ children: c }) => <h3 className="text-base font-semibold text-dungeon-300">{c}</h3>,
          h3: ({ children: c }) => <h4 className="text-sm font-semibold text-dungeon-300">{c}</h4>,
          a: ({ href, children: c }) => (
            <a href={href} className="text-dungeon-300 underline hover:text-dungeon-200" target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          ),
          blockquote: ({ children: c }) => (
            <blockquote className="border-l-2 border-dungeon-500 pl-3 text-stone-400 italic">{c}</blockquote>
          ),
          code: ({ children: c }) => (
            <code className="rounded bg-dungeon-800 px-1 py-0.5 font-mono text-sm text-stone-200">{c}</code>
          ),
          hr: () => <hr className="border-dungeon-600" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

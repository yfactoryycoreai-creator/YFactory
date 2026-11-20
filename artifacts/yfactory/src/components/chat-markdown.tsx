import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

type ChatMarkdownProps = {
  content: string;
  copyLabel?: string;
  copiedLabel?: string;
  streaming?: boolean;
};

type MarkdownBlock =
  | { type: "code"; language: string; code: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "paragraph"; lines: string[] };

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  const cleaned = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = cleaned.split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseBlocks(raw: string): MarkdownBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = /^```([A-Za-z0-9_+#.-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const language = fenceMatch[1] ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (/^```\s*$/.test(current.trim())) {
          index += 1;
          break;
        }
        codeLines.push(current);
        index += 1;
      }
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1]?.length ?? 2) as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: headingMatch[2] ?? "" });
      index += 1;
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1] ?? "")
    ) {
      const headers = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const rowLine = lines[index] ?? "";
        if (!rowLine.trim() || !rowLine.includes("|")) break;
        rows.push(splitTableRow(rowLine));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? "").trim())) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (/^(?:[-*•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^(?:[-*•])\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^(?:[-*•])\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const currentTrimmed = current.trim();
      if (
        !currentTrimmed ||
        /^```/.test(currentTrimmed) ||
        /^(#{1,4})\s+/.test(currentTrimmed) ||
        /^(?:---+|\*\*\*+|___+)$/.test(currentTrimmed) ||
        /^>\s?/.test(currentTrimmed) ||
        /^(?:[-*•])\s+/.test(currentTrimmed) ||
        /^\d+[.)]\s+/.test(currentTrimmed) ||
        (current.includes("|") &&
          index + 1 < lines.length &&
          isTableSeparator(lines[index + 1] ?? ""))
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
    } else {
      index += 1;
    }
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex =
    /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${tokenIndex++}`;
    if (match[1] !== undefined) {
      nodes.push(
        <code className="chat-md-inline-code" dir="ltr" key={key}>
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined && match[3] !== undefined) {
      nodes.push(
        <a
          className="chat-md-link"
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          key={key}
        >
          {match[2]}
        </a>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(match[4], key)}</strong>);
    } else if (match[5] !== undefined) {
      nodes.push(<del key={key}>{renderInline(match[5], key)}</del>);
    } else if (match[6] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[6], key)}</em>);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function CodeBlock({
  language,
  code,
  copyLabel,
  copiedLabel,
}: {
  language: string;
  code: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const codeLines = code.split("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  };

  return (
    <div className="chat-md-codeblock" dir="ltr">
      <div className="chat-md-code-header">
        <span className="chat-md-code-lang">{language || "code"}</span>
        <button
          type="button"
          className="chat-md-code-copy"
          onClick={() => void handleCopy()}
          aria-label={copied ? copiedLabel : copyLabel}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <div className="chat-md-code-body">
        <pre>
          <code>
            {codeLines.map((line, lineIndex) => (
              <span className="chat-md-code-line" key={lineIndex}>
                <span className="chat-md-line-num" aria-hidden="true">
                  {lineIndex + 1}
                </span>
                <span className="chat-md-line-text">{line || " "}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

export default function ChatMarkdown({
  content,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  streaming = false,
}: ChatMarkdownProps) {
  const blocks = parseBlocks(content);

  return (
    <div className={`chat-markdown ${streaming ? "chat-markdown-streaming" : ""}`}>
      {blocks.map((block, index) => {
        const key = `md-${index}`;
        switch (block.type) {
          case "code":
            return (
              <CodeBlock
                key={key}
                language={block.language}
                code={block.code}
                copyLabel={copyLabel}
                copiedLabel={copiedLabel}
              />
            );
          case "heading": {
            const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
            return (
              <Tag className={`chat-md-h${block.level}`} dir="auto" key={key}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "ul":
            return (
              <ul className="chat-md-list chat-md-ul" dir="auto" key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol className="chat-md-list chat-md-ol" dir="auto" key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            );
          case "blockquote":
            return (
              <blockquote className="chat-md-quote" dir="auto" key={key}>
                {block.lines.map((line, lineIndex) => (
                  <p key={`${key}-${lineIndex}`}>
                    {renderInline(line, `${key}-${lineIndex}`)}
                  </p>
                ))}
              </blockquote>
            );
          case "table":
            return (
              <div className="chat-md-table-wrap" key={key}>
                <table className="chat-md-table" dir="auto">
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => (
                        <th key={`${key}-h-${headerIndex}`}>
                          {renderInline(header, `${key}-h-${headerIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-r-${rowIndex}`}>
                        {block.headers.map((_, colIndex) => (
                          <td key={`${key}-c-${rowIndex}-${colIndex}`}>
                            {renderInline(row[colIndex] ?? "", `${key}-c-${rowIndex}-${colIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr className="chat-md-hr" key={key} />;
          case "paragraph":
            return (
              <p className="chat-md-p" dir="auto" key={key}>
                {block.lines.map((line, lineIndex) => (
                  <Fragment key={`${key}-${lineIndex}`}>
                    {lineIndex > 0 && <br />}
                    {renderInline(line, `${key}-${lineIndex}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
      {streaming && <span className="chat-stream-cursor" aria-hidden="true" />}
    </div>
  );
}

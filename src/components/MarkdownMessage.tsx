import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
}

export type BlockNode =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'paragraph'; lines: string[] };

const INLINE_CODE_SPLIT_RE = /(`[^`\n]+`)/g;
const EMPHASIS_TOKEN_SOURCE =
  /\*\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*\*|\*\*([^\s*](?:(?:[^*\n]|\*(?!\*))*?[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*?[^\s*])?)\*/
    .source;
const FENCE_OPEN_RE = /^(`{3,})([^\n]*)$/;

function renderEmphasis(text: string, keyPrefix: string, depth = 0): React.ReactNode[] {
  if (depth >= 6) {
    return [text];
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIdx = 0;
  const re = new RegExp(EMPHASIS_TOKEN_SOURCE, 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-e-${tokenIdx++}`;
    if (match[1] !== undefined) {
      nodes.push(
        <strong key={key}>
          <em>{match[1]}</em>
        </strong>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={key}>{renderEmphasis(match[2], key, depth + 1)}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={key}>{match[3]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

export function renderInline(text: string, keyPrefix = 'inline'): React.ReactNode[] {
  const parts = text.split(INLINE_CODE_SPLIT_RE);
  const nodes: React.ReactNode[] = [];

  parts.forEach((part, idx) => {
    if (!part) return;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      nodes.push(
        <code key={`${keyPrefix}-c-${idx}`} className="md-inline-code">
          {part.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(...renderEmphasis(part, `${keyPrefix}-t-${idx}`));
    }
  });

  return nodes;
}

export function parseMarkdownBlocks(content: string): BlockNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block (supports 3+ backticks, info strings, and unclosed trailing fence during streaming)
    const fenceMatch = FENCE_OPEN_RE.exec(line.trim());
    if (fenceMatch) {
      const fenceLen = fenceMatch[1].length;
      const info = fenceMatch[2].trim();
      const lang = info ? info.split(/\s+/)[0] : '';
      const fenceCloseRe = new RegExp('^`{' + fenceLen + ',}\\s*$');
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !fenceCloseRe.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && fenceCloseRe.test(lines[i].trim())) {
        i += 1;
      }
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // Heading (# to ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // Unordered list (- or * or •)
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list (1. 2. ...)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph until blank line or next block construct
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE_OPEN_RE.test(lines[i].trim()) &&
      !/^#{1,4}\s+/.test(lines[i].trim()) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paraLines });
    } else {
      // Unconditional forward-progress fallback so no input can stall the parser
      blocks.push({ type: 'paragraph', lines: [lines[i]] });
      i += 1;
    }
  }

  return blocks;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyCode = async (idx: number, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeIdx(idx);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedCodeIdx((prev) => (prev === idx ? null : prev));
        copyTimerRef.current = null;
      }, 1500);
    } catch {
      // Ignore clipboard write errors
    }
  };

  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="md-root">
      {blocks.map((block, bIdx) => {
        if (block.type === 'code') {
          const isCopied = copiedCodeIdx === bIdx;
          return (
            <div key={`b-${bIdx}`} className="md-code-block">
              <div className="md-code-header">
                <span className="md-code-lang">{block.lang || 'code'}</span>
                <button
                  type="button"
                  className="mini-link-btn md-copy-btn"
                  onClick={() => void handleCopyCode(bIdx, block.code)}
                  aria-label="Copy code block"
                >
                  {isCopied ? <Check size={11} /> : <Copy size={11} />}
                  {isCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="md-pre">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === 'heading') {
          const inline = renderInline(block.text, `b-${bIdx}`);
          if (block.level === 1) {
            return (
              <h1 key={`b-${bIdx}`} className="md-heading md-h1">
                {inline}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2 key={`b-${bIdx}`} className="md-heading md-h2">
                {inline}
              </h2>
            );
          }
          if (block.level === 3) {
            return (
              <h3 key={`b-${bIdx}`} className="md-heading md-h3">
                {inline}
              </h3>
            );
          }
          return (
            <h4 key={`b-${bIdx}`} className="md-heading md-h4">
              {inline}
            </h4>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={`b-${bIdx}`} className="md-list">
              {block.items.map((item, idx) => (
                <li key={`b-${bIdx}-li-${idx}`}>{renderInline(item, `b-${bIdx}-li-${idx}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={`b-${bIdx}`} className="md-list">
              {block.items.map((item, idx) => (
                <li key={`b-${bIdx}-li-${idx}`}>{renderInline(item, `b-${bIdx}-li-${idx}`)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={`b-${bIdx}`} className="md-p">
            {block.lines.map((line, lIdx) => (
              <React.Fragment key={`b-${bIdx}-l-${lIdx}`}>
                {lIdx > 0 && <br />}
                {renderInline(line, `b-${bIdx}-l-${lIdx}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};

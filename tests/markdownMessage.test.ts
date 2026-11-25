import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

type BlockNode =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'paragraph'; lines: string[] };

interface MarkdownMessageModule {
  MarkdownMessage: React.FC<{ content: string }>;
  parseMarkdownBlocks: (content: string) => BlockNode[];
  renderInline: (text: string, keyPrefix?: string) => React.ReactNode[];
}

const { MarkdownMessage, parseMarkdownBlocks, renderInline } =
  await vi.importActual<MarkdownMessageModule>('../src/components/MarkdownMessage');

function renderInlineHtml(text: string): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, ...renderInline(text, 't')));
}

function renderMessageHtml(content: string): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, { content }));
}

describe('MarkdownMessage emphasis rendering', () => {
  it('renders **bold**, *italic*, and ***bold italic*** without hanging', () => {
    expect(renderInlineHtml('**bold**')).toBe('<strong>bold</strong>');
    expect(renderInlineHtml('*italic*')).toBe('<em>italic</em>');
    expect(renderInlineHtml('***bold italic***')).toBe('<strong><em>bold italic</em></strong>');
  });

  it('renders multiple bold tokens on one line', () => {
    expect(renderInlineHtml('**first** and **second** and **third**')).toBe(
      '<strong>first</strong> and <strong>second</strong> and <strong>third</strong>',
    );
  });

  it('renders nested **bold *italic* bold** cleanly', () => {
    const nodes = renderInline('**bold *italic* bold**', 'nested');
    expect(nodes).toHaveLength(1);
    const strongEl = nodes[0] as React.ReactElement<{ children: React.ReactNode[] }>;
    expect(strongEl.type).toBe('strong');
    expect(renderInlineHtml('**bold *italic* bold**')).toBe(
      '<strong>bold <em>italic</em> bold</strong>',
    );
  });

  it('renders full MarkdownMessage with bold, italic, and inline code immediately', () => {
    const html = renderMessageHtml('Hello **world**, *cat*, ***both***, and `code`!');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<em>cat</em>');
    expect(html).toContain('<strong><em>both</em></strong>');
    expect(html).toContain('<code class="md-inline-code">code</code>');
  });
});

describe('parseMarkdownBlocks fenced code blocks', () => {
  it('parses fences with metadata info strings like ```ts title="foo.ts"', () => {
    const blocks = parseMarkdownBlocks('```ts title="foo.ts"\nconst x = 1;\n```');
    expect(blocks).toEqual([
      {
        type: 'code',
        lang: 'ts',
        code: 'const x = 1;',
      },
    ]);
  });

  it('parses fences with special language characters like ```c# and ```c++', () => {
    const blocks = parseMarkdownBlocks('```c#\nConsole.WriteLine("hi");\n```\n\n```c++\nint x = 0;\n```');
    expect(blocks).toEqual([
      {
        type: 'code',
        lang: 'c#',
        code: 'Console.WriteLine("hi");',
      },
      {
        type: 'code',
        lang: 'c++',
        code: 'int x = 0;',
      },
    ]);
  });

  it('parses 4-backtick ````markdown fences containing inner ``` fences', () => {
    const md = [
      '````markdown',
      '# Example',
      '```ts',
      'const y = 2;',
      '```',
      '````',
    ].join('\n');

    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toEqual([
      {
        type: 'code',
        lang: 'markdown',
        code: '# Example\n```ts\nconst y = 2;\n```',
      },
    ]);
  });

  it('handles unclosed trailing fence during streaming', () => {
    const blocks = parseMarkdownBlocks('Before\n```python\nprint("streaming")');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: ['Before'] },
      { type: 'code', lang: 'python', code: 'print("streaming")' },
    ]);
  });

  it('completes immediately on pathological backtick lines', () => {
    const md = [
      '```foo bar',
      'line 1',
      '````',
      'after fence',
      '``````',
      'after empty 6-backtick fence',
    ].join('\n');

    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toEqual([
      { type: 'code', lang: 'foo', code: 'line 1' },
      { type: 'paragraph', lines: ['after fence'] },
      { type: 'code', lang: '', code: 'after empty 6-backtick fence' },
    ]);

    const html = renderMessageHtml(md);
    expect(html).toContain('md-code-block');
    expect(html).toContain('after fence');
  });
});

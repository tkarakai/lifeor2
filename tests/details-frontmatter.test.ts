// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDetails, renderDetails } from "../lib/details/frontmatter";
import { MarkdownDetails } from "../components/markdown-details";

describe("front matter and safe rendering", () => {
  it("parses descriptive scalar metadata without changing the source or line endings", () => {
    const source = '\uFEFF---\r\n# descriptive\r\nrooms: 3\r\nactive: true\r\nempty: null\r\nname: "Oak Street"\r\nowner: \'O\'\'Brien\'\r\n---\r\n\r\n# Notes\r\n';
    const parsed = parseDetails(source);
    expect(parsed.metadata).toEqual({ rooms: 3, active: true, empty: null, name: "Oak Street", owner: "O'Brien" });
    expect(parsed.diagnostic).toBeNull();
    expect(renderDetails(parsed)).toBe(source);
    expect(renderDetails(parsed, "New body")).toBe(source.slice(0, source.indexOf("\r\n# Notes")) + "New body");
  });
  it.each([
    "---\nno closing delimiter", "---\nkey: one\nkey: two\n---\nbody", "---\nnested:\n  value: 1\n---\nbody",
    "---\nexecute: !!js/function hello\n---\nbody", "---\nvalue: [1, 2]\n---\nbody", "---\n__proto__: polluted\n---\nbody",
    '---\nname: "unterminated\n---\nbody', "---\nnumber: 99999999999999999999\n---\nbody",
  ])("preserves malformed or unsupported front matter verbatim: %s", source => {
    const parsed = parseDetails(source);
    expect(parsed.diagnostic).toBeTruthy();
    expect(parsed.source).toBe(source);
    expect(parsed.body).toBe(source);
    expect(parsed.metadata).toEqual({});
    expect(renderDetails(parsed, "replacement")).toBe(source);
  });
  it("renders HTML and unsafe Markdown links as inert text", () => {
    const html = renderToStaticMarkup(createElement(MarkdownDetails, { source: '# Safe\n\n<script>alert(1)</script>\n\n[bad](javascript:alert) [safe](https://example.com)\n\n```js\n<img src=x onerror=alert(1)>\n```' }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<h1");
    expect(html).toContain("<pre");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { capturePage } from "../src/browser/capture-page";
import { importCapturedPage } from "../src/browser/import-page";

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "Example";
  window.getSelection()?.removeAllRanges();
});

describe("read-only browser page capture", () => {
  it("takes main content without changing the source or copying hidden controls", () => {
    document.body.innerHTML = `
      <nav>Menu secret</nav><main><h1>Visible heading</h1>
      <p>Visible paragraph</p><input type="password" value="private-password">
      <p hidden>hidden-secret</p><p style="display:none">css-secret</p>
      <div contenteditable="true">draft-secret</div><script>script-secret</script>
      <a href="/next">Next</a></main>`;
    const before = document.body.innerHTML;
    const capture = capturePage("page");
    expect(document.body.innerHTML).toBe(before);
    expect(capture.html).toContain("Visible heading");
    expect(capture.html).not.toMatch(
      /secret|password|contenteditable|<script|<input/iu,
    );
    expect(capture.html).toContain('href="/next"');
    expect(capture.truncated).toBe(false);
  });

  it("can run from its serialized function body without module helpers", () => {
    document.body.innerHTML = "<main><p>Serializable capture</p></main>";
    const injected = Function(
      `return (${capturePage.toString()})`,
    )() as typeof capturePage;
    expect(injected("page").html).toContain("Serializable capture");
  });

  it("preserves a supported long URL rather than truncating page identity", () => {
    const original = location.href;
    try {
      history.replaceState(null, "", `?query=${"x".repeat(3000)}`);
      document.body.innerHTML = "<main><p>Long URL</p></main>";
      expect(capturePage("page").url).toBe(location.href);
      expect(capturePage("page").url.length).toBeGreaterThan(2048);
    } finally {
      history.replaceState(null, "", original);
    }
  });

  it("does not choose a main element under a hidden ancestor", () => {
    document.body.innerHTML = `<div style="display:none"><main>private-main</main></div>
      <article><p>Visible article</p></article>`;
    const capture = capturePage("page");
    expect(capture.html).toContain("Visible article");
    expect(capture.html).not.toContain("private-main");
  });

  it("chooses a readable article when a separate main contains only page chrome", () => {
    document.body.innerHTML = `<main><nav>${"Navigation item ".repeat(20)}</nav>
      <div hidden>${"Hidden draft ".repeat(20)}</div><button>Open menu</button></main>
      <article><h1>Project guide</h1><p>Read this page content.</p></article>`;
    const capture = capturePage("page");
    expect(capture.html).toContain("Project guide");
    expect(capture.html).toContain("Read this page content.");
    expect(capture.html).not.toMatch(/Navigation item|Hidden draft|Open menu/u);
  });

  it("excludes transparent content and closed-details bodies while retaining their summary", () => {
    document.body.innerHTML = `<section style="opacity:0"><main>transparent-secret</main></section>
      <details><summary>Visible label</summary><main>closed-secret</main></details>
      <article><p>Visible article</p><details><summary>Visible summary</summary>hidden-details-body</details>
      <details open><summary>Open summary</summary><p>Expanded text</p></details></article>`;
    const capture = capturePage("page");
    expect(capture.html).not.toMatch(/secret|hidden-details-body/);
    expect(capture.html).toContain("Visible summary");
    expect(capture.html).toContain("Expanded text");
  });

  it("uses exact selection boundaries and never falls back to the whole page", () => {
    document.body.innerHTML =
      "<main><p>Before selected after</p><p>Other paragraph</p></main>";
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 15);
    window.getSelection()!.addRange(range);
    expect(capturePage("selection").html).toContain("selected");
    expect(capturePage("selection").html).not.toMatch(/Before|after|Other/iu);
    window.getSelection()!.removeAllRanges();
    expect(() => capturePage("selection")).toThrow(/Select visible/iu);
  });

  it("automatically prefers readable selected content", () => {
    document.body.innerHTML =
      "<main><p>Before selected after</p><p>Other paragraph</p></main>";
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 15);
    window.getSelection()!.addRange(range);
    const capture = capturePage("auto");
    expect(capture.html).toContain("selected");
    expect(capture.html).not.toMatch(/Before|after|Other/iu);
  });

  it("automatically falls back to the readable page without a selection", () => {
    document.body.innerHTML =
      "<main><h1>Page heading</h1><p>Readable fallback</p></main>";
    expect(capturePage("auto").html).toMatch(
      /Page heading.*Readable fallback/su,
    );
  });

  it("never captures selected form data when automatically falling back", () => {
    document.body.innerHTML = `<main><p>Safe page content</p><form>
      <label>Account secret <span>selected-private-value</span></label>
      <input value="input-private-value"></form></main>`;
    const selected = document.querySelector("form span")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()!.addRange(range);
    const capture = capturePage("auto");
    expect(capture.html).toContain("Safe page content");
    expect(capture.html).not.toMatch(
      /private-value|Account secret|<form|<input/iu,
    );
  });

  it("does not mask capture failures as an automatic page fallback", () => {
    document.body.innerHTML = "<main><p>Selected text</p></main>";
    const selected = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()!.addRange(range);
    const original = window.getComputedStyle;
    window.getComputedStyle = () => {
      throw new Error("synthetic style failure");
    };
    try {
      expect(() => capturePage("auto")).toThrow(/synthetic style failure/iu);
    } finally {
      window.getComputedStyle = original;
    }
  });

  it("honors selected structure across table cells", () => {
    document.body.innerHTML =
      "<table><tr><td>Alpha</td><td>Beta</td></tr></table>";
    const first = document.querySelector("td")!.firstChild!;
    const last = document.querySelectorAll("td")[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(first, 2);
    range.setEnd(last, 2);
    window.getSelection()!.addRange(range);
    const capture = capturePage("selection");
    expect(capture.html).toContain("<table>");
    expect(capture.html).toContain("pha");
    expect(capture.html).toContain("Be");
    expect(capture.html).not.toContain("Alpha");
  });

  it("bounds large source text without returning malformed HTML", () => {
    document.body.innerHTML = `<main><p>${"&".repeat(400_000)}</p></main>`;
    const capture = capturePage("page");
    expect(capture.truncated).toBe(true);
    expect(capture.html.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(capture.html).toMatch(/<\/p><\/main>$/u);
  });
});

describe("detached HTML to Markdown import", () => {
  const source = (html: string) => ({
    html,
    title: "Example",
    url: "https://example.test/base/page",
    truncated: false,
  });

  it("preserves headings, nested lists, tables, code, links, and quotes", () => {
    const result = importCapturedPage(
      source(`
      <h2>Guide</h2><p>Start <a href="../next">here</a>.</p>
      <ul><li>First<ul><li>Nested</li></ul></li><li>Second</li></ul>
      <table><tr><th>Key</th><th>Value</th></tr><tr><td>A</td><td>B | C</td></tr></table>
      <pre><code class="language-js">const x = 1;\n</code></pre>
      <blockquote><p>A quoted thought</p></blockquote>`),
    );
    expect(result.markdown).toContain("## Guide");
    expect(result.markdown).toContain("[here](https://example.test/next)");
    expect(result.markdown).toContain("- First\n  - Nested\n- Second");
    expect(result.markdown).toContain(
      "| Key | Value |\n| --- | --- |\n| A | B \\| C |",
    );
    expect(result.markdown).toContain("```js\nconst x = 1;\n```");
    expect(result.markdown).toContain("> A quoted thought");
  });

  it("keeps inline text together inside layout wrappers", () => {
    const result = importCapturedPage(
      source(
        `<main><section><div>Read <strong>the guide</strong> now.</div>
        <p>Then continue.</p><div>Visit <a href="/next">the next page</a>!</div></section></main>`,
      ),
    );
    expect(result.markdown).toBe(
      "Read **the guide** now\\.\n\nThen continue\\.\n\nVisit [the next page](https://example.test/next)\\!",
    );
  });

  it("counts each source node once within the documented import limit", () => {
    const result = importCapturedPage(source("<p>x</p>".repeat(11_000)));
    expect(result.markdown.split("\n\n")).toHaveLength(11_000);
    expect(result.warnings).not.toContain(
      "Page content exceeded the import node limit and was truncated.",
    );
  });

  it("escapes source text and excludes scripts, hidden data, images, and unsafe URLs", () => {
    const result = importCapturedPage(
      source(
        `
      <p>### fake heading \\` +
          "```aic-security" +
          ` ---</p>
      <a href="javascript:alert(1)">unsafe</a>
      <a href="data:text/plain,secret">data</a>
      <a href="https://user:synthetic-password@example.test/">credentials</a>
      <script>evil-script</script><p hidden>private-hidden</p>
      <img src="https://example.test/tracker" alt="tracker">`,
      ),
    );
    expect(result.markdown).toContain("\\#\\#\\# fake heading");
    expect(result.markdown).toContain("\\`\\`\\`aic\\-security");
    expect(result.markdown).not.toMatch(
      /\]\(javascript:|\]\(data:|synthetic-password|evil-script|private-hidden|tracker|!\[/iu,
    );
    expect(result.markdown).toContain("unsafe");
  });

  it("does not read hidden table sections or code descendants", () => {
    const result = importCapturedPage(
      source(`
      <table><tbody hidden><tr><td>secret-cell</td></tr></tbody>
      <tr><th>Visible</th></tr><tr><td>Public</td></tr></table>
      <pre><code hidden class="language-secret-code">concealed</code><code>safe <span hidden>secret-code</span> text</code></pre>`),
    );
    expect(result.markdown).toContain("Public");
    expect(result.markdown).toContain("safe  text");
    expect(result.markdown).not.toMatch(/secret-cell|secret-code/iu);
  });

  it("keeps literal Markdown syntax in page text from becoming a link", () => {
    const result = importCapturedPage(
      source("<p>[click](javascript:alert(1))</p>"),
    );
    expect(result.markdown).toContain(
      "\\[click\\]\\(javascript:alert\\(1\\)\\)",
    );
    expect(result.markdown).not.toContain("[click](javascript:");
  });

  it("rejects oversized captures and reports unavailable or truncated content", () => {
    expect(() =>
      importCapturedPage(source("x".repeat(2 * 1024 * 1024 + 1))),
    ).toThrow(/invalid or too large/iu);
    const empty = importCapturedPage({
      html: "",
      title: "",
      url: "file:///local",
      truncated: true,
    });
    expect(empty.markdown).toBe("");
    expect(empty.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/truncated/iu),
        expect.stringMatching(/unavailable/iu),
      ]),
    );
    expect(empty.url).toBe("");
  });
});

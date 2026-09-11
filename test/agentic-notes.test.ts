import { describe, expect, it } from "vitest";
import {
  AGENTIC_NOTES_START as START,
  AGENTIC_NOTES_END as END,
  agenticNotePathFor,
  agenticNoteVisibility,
  inspectAgenticNotes,
  patchAgenticNotes,
  resolveAgenticContext,
  type AgenticTarget,
} from "../src/core/agentic-notes.js";

function section(body: string, eol = "\n") {
  return [START, "## Agentic Notes", "", body, END].join(eol);
}

function inspect(source: string) {
  const result = inspectAgenticNotes(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.section;
}

describe("Agentic Notes section ownership", () => {
  it.each(["\n", "\r\n"])(
    "changes only managed body with %j newlines",
    (eol) => {
      const ownerBefore = [
        "---",
        "title: 'Owner: document'",
        "---",
        "",
        "# Owner",
        "",
        "Original prose.",
        "",
        "",
      ].join(eol);
      const ownerAfter =
        eol + eol + "## Owner follow-up" + eol + "Do not rewrite this.  " + eol;
      const source = ownerBefore + section("Old finding", eol) + ownerAfter;
      const result = patchAgenticNotes({
        source,
        expectedSource: source,
        body: "Evidence.\n\nNext check.",
      });
      expect(result).toEqual({
        ok: true,
        changed: true,
        source:
          ownerBefore +
          section(["Evidence.", "", "Next check."].join(eol), eol) +
          ownerAfter,
      });
    },
  );

  it.each(["", "Owner", "Owner\n", "Owner\r\n", "Owner\n\n"])(
    "appends without altering owner prefix %j",
    (source) => {
      const result = patchAgenticNotes({
        source,
        expectedSource: source,
        body: "Check uncertain assumption.",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source.startsWith(source)).toBe(true);
      expect(inspect(result.source)?.body).toBe("Check uncertain assumption.");
      expect(
        patchAgenticNotes({
          source: result.source,
          expectedSource: result.source,
          body: "Check uncertain assumption.",
        }),
      ).toEqual({ ...result, changed: false });
    },
  );

  it("preserves body whitespace, including blank trailing lines", () => {
    const body = "  Evidence  \n\n";
    const result = patchAgenticNotes({
      source: "Owner",
      expectedSource: "Owner",
      body,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(inspect(result.source)?.body).toBe(body);
  });

  it("compares entire source, including owner prose, before patching", () => {
    const source = "Owner has changed\n\n" + section("Old");
    expect(
      patchAgenticNotes({
        source,
        expectedSource: section("Old"),
        body: "New",
      }),
    ).toEqual({ ok: false, code: "source_changed" });
    expect(patchAgenticNotes({ source, body: "New" } as any)).toEqual({
      ok: false,
      code: "source_changed",
    });
  });

  it.each([
    START,
    END,
    section("a") + "\n\n" + section("b"),
    END + "\n" + START,
    START.replace("start", "unknown"),
    START + "\n## Wrong heading\n\ntext\n" + END,
    START + "\n## Agentic Notes\ntext\n" + END,
    section("a") + "\n\n## Agentic Notes\nOwner",
  ])("rejects duplicate or malformed delimiters: %j", (source) => {
    expect(inspectAgenticNotes(source)).toEqual({
      ok: false,
      code: "malformed_section",
    });
    expect(
      patchAgenticNotes({ source, expectedSource: source, body: "New" }).ok,
    ).toBe(false);
  });

  it("does not take over an owner's unmarked Agentic Notes section", () => {
    expect(inspectAgenticNotes("## Agentic Notes\nOwner memory")).toEqual({
      ok: false,
      code: "unmanaged_section",
    });
  });

  it.each(["Agentic Notes\n---", "Agentic Notes\n==="])(
    "does not duplicate an owner's Setext section %j",
    (source) => {
      expect(inspectAgenticNotes(source)).toEqual({
        ok: false,
        code: "unmanaged_section",
      });
      expect(
        patchAgenticNotes({ source, expectedSource: source, body: "New" }),
      ).toEqual({ ok: false, code: "unmanaged_section" });
    },
  );

  it.each([
    "```md\n" + section("Example") + "\n```",
    "~~~~md\n" + section("Example") + "\n~~~~",
    section("Example")
      .split("\n")
      .map((line) => "    " + line)
      .join("\n"),
    section("Example")
      .split("\n")
      .map((line) => "> " + line)
      .join("\n"),
    "- Example\n\n" +
      section("Example")
        .split("\n")
        .map((line) => "  " + line)
        .join("\n"),
  ])(
    "ignores delimiter examples in Markdown code or nested contexts",
    (example) => {
      expect(inspectAgenticNotes(example)).toEqual({ ok: true, section: null });
      expect(inspect(example + "\n\n" + section("Actual"))?.body).toBe(
        "Actual",
      );
    },
  );

  it("allows fenced marker examples inside its own managed body", () => {
    const body = "Example:\n\n```md\n" + section("Not active") + "\n```";
    const source = section("Old");
    const result = patchAgenticNotes({ source, expectedSource: source, body });
    expect(result.ok).toBe(true);
    if (result.ok) expect(inspect(result.source)?.body).toBe(body);
  });

  it.each([
    START,
    END,
    "```md",
    "<!-- never closed",
    "## Agentic Notes\nOther section",
  ])("rejects body injection or unclosed Markdown: %j", (body) => {
    const source = section("Old");
    expect(patchAgenticNotes({ source, expectedSource: source, body })).toEqual(
      { ok: false, code: "invalid_section_body" },
    );
  });

  it("will not append an invisible section inside an owner's unclosed fence", () => {
    const source = "# Owner\n\n```md\nUnclosed code";
    expect(
      patchAgenticNotes({ source, expectedSource: source, body: "New" }),
    ).toEqual({ ok: false, code: "invalid_section_body" });
  });
});

describe("Agentic Notes full YAML visibility", () => {
  it.each([
    "agent: false",
    '"agent": false # quoted key',
    "private: true",
    "visibility: private",
    "{ agent: false, title: 'Owner' }",
    "{ private: true }",
    "agent: false\nnested:\n  private: false",
    "title: |\n  many lines\nprivate: true",
    "padding: '" + "x".repeat(2000) + "'\nagent: false",
  ])("withholds private note without exposing its body: %j", (yaml) => {
    const source = "---\n" + yaml + "\n---\n" + section("Private evidence");
    expect(agenticNoteVisibility(source)).toEqual({ ok: true, visible: false });
    expect(inspectAgenticNotes(source)).toEqual({
      ok: false,
      code: "private_note",
    });
    expect(
      patchAgenticNotes({ source, expectedSource: source, body: "New" }),
    ).toEqual({ ok: false, code: "private_note" });
  });

  it.each([
    "title: owner\nnested:\n  private: true\n  agent: false",
    "title: |\n  private: true\n  agent: false\nagent: true",
    "# comment\nagent: true\nprivate: false",
    "created: 2026-09-11\nagent: true",
    "",
  ])(
    "does not mistake nested properties or block values for policy: %j",
    (yaml) => {
      expect(agenticNoteVisibility("---\n" + yaml + "\n---\nOwner")).toEqual({
        ok: true,
        visible: true,
      });
    },
  );

  it.each([
    "agent: true\nagent: false",
    "private: true\nprivate: false",
    "agent: [true]",
    'private: "false"',
    '"agent": "false"',
    "visibility: [public]",
    "title: [invalid",
    "agent: !custom true",
    "a: &rules {private: true}\n<<: *rules",
    "private: &p true\nother: *p",
    "- agent: false",
    "Owner scalar",
  ])("fails closed for malformed, aliased or nonboolean policy: %j", (yaml) => {
    expect(agenticNoteVisibility("---\n" + yaml + "\n---\nOwner").ok).toBe(
      false,
    );
  });

  it("fails closed for an unclosed frontmatter block", () => {
    expect(agenticNoteVisibility("---\nagent: false\nOwner")).toEqual({
      ok: false,
      code: "invalid_frontmatter",
    });
  });

  it("ignores marker-like YAML literal strings and preserves BOM/CRLF", () => {
    const source =
      "\uFEFF---\r\ntitle: |\r\n  " + START + "\r\n---\r\nOwner\r\n";
    expect(inspectAgenticNotes(source)).toEqual({ ok: true, section: null });
    const result = patchAgenticNotes({
      source,
      expectedSource: source,
      body: "Evidence",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.startsWith(source)).toBe(true);
  });
});

describe("Agentic scoped inheritance", () => {
  const target: AgenticTarget = { path: "src/lib/example.ts", kind: "file" };
  const notes = [
    "Project.note.md",
    "src.note.md",
    "src/lib.note.md",
    "src/lib/example.note.md",
    "src/lib/sibling.note.md",
    "src/other.note.md",
    "unrelated.note.md",
  ].map((path) => ({ path, source: "Owner: " + path }));
  const targets: AgenticTarget[] = [
    target,
    { path: "src/lib/sibling.ts", kind: "file" },
    { path: "src/other/file.ts", kind: "file" },
    { path: "unrelated.js", kind: "file" },
  ];
  const base = { target, notes, targets, projectNotePath: "Project.note.md" };

  it("returns existing project, ancestors, current in order, never siblings", () => {
    const result = resolveAgenticContext(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map(({ path, role }) => [path, role])).toEqual([
      ["Project.note.md", "project"],
      ["src.note.md", "ancestor"],
      ["src/lib.note.md", "ancestor"],
      ["src/lib/example.note.md", "current"],
    ]);
    expect(result.excluded).toEqual([]);
    expect(result.notes.every((note) => note.agenticBody === null)).toBe(true);
  });

  it("includes neither placeholders nor unrelated files when notes are missing", () => {
    const result = resolveAgenticContext({
      ...base,
      notes: notes.filter((note) => note.path === "src.note.md"),
    });
    expect(result.ok && result.notes.map((note) => note.path)).toEqual([
      "src.note.md",
    ]);
  });

  it("inherits shared context by moving to a common ancestor, not reading siblings", () => {
    const result = resolveAgenticContext({
      ...base,
      target: { path: "src/lib", kind: "folder" },
      targets: [...targets, { path: "src/lib", kind: "folder" }],
    });
    expect(
      result.ok && result.notes.map(({ path, role }) => [path, role]),
    ).toEqual([
      ["Project.note.md", "project"],
      ["src.note.md", "ancestor"],
      ["src/lib.note.md", "current"],
    ]);
  });

  it("resolves root itself to project note once", () => {
    const result = resolveAgenticContext({
      ...base,
      target: { path: "", kind: "folder" },
      targets: [{ path: "", kind: "folder" }],
    });
    expect(
      result.ok && result.notes.map(({ path, role }) => [path, role]),
    ).toEqual([["Project.note.md", "current"]]);
  });

  it("excludes private and malformed notes with no source in diagnostics", () => {
    const result = resolveAgenticContext({
      ...base,
      notes: notes.map((note) => ({
        ...note,
        source:
          note.path === "src.note.md"
            ? "---\nprivate: true\n---\nSECRET"
            : note.path === "src/lib.note.md"
              ? "---\nagent: [false]\n---\nSECRET"
              : note.source,
      })),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((note) => note.path)).toEqual([
      "Project.note.md",
      "src/lib/example.note.md",
    ]);
    expect(result.excluded).toEqual([
      { path: "src.note.md", code: "private_note" },
      { path: "src/lib.note.md", code: "invalid_visibility" },
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it.each([
    "../file.ts",
    "/tmp/file.ts",
    "C:/file.ts",
    "C:\\file.ts",
    "a/../file.ts",
    "a//file.ts",
    "./file.ts",
    "file:///tmp/file.ts",
    "a/file.ts/",
    "a. /file.ts",
    "NUL",
    "src/COM1.ts",
    "src/aux.note.md",
    "src/bad?.ts",
    "src/control\u0000.ts",
  ])("rejects non-normalized or ambiguous target %j", (path) => {
    expect(
      resolveAgenticContext({ ...base, target: { path, kind: "file" } }),
    ).toEqual({ ok: false, code: "invalid_target" });
  });

  it("requires a catalog that includes the target", () => {
    expect(
      resolveAgenticContext({ ...base, targets: undefined } as any),
    ).toEqual({ ok: false, code: "catalog_required" });
    expect(resolveAgenticContext({ ...base, targets: [] })).toEqual({
      ok: false,
      code: "target_not_in_catalog",
      path: target.path,
    });
  });

  it.each([
    { path: "src/lib/example.js", kind: "file" },
    { path: "src/lib/example", kind: "folder" },
  ] as AgenticTarget[])(
    "refuses ambiguous current owners unless canonically bound",
    (collision) => {
      const input = { ...base, targets: [...targets, collision] };
      expect(resolveAgenticContext(input)).toEqual({
        ok: false,
        code: "ambiguous_binding",
        path: "src/lib/example.note.md",
      });
      const resolved = resolveAgenticContext({
        ...input,
        currentNotePath: "src/lib/example.note.md",
      });
      expect(resolved.ok && resolved.notes.at(-1)?.path).toBe(
        "src/lib/example.note.md",
      );
    },
  );

  it("refuses an ambiguous ancestor instead of importing a sibling file's note", () => {
    expect(
      resolveAgenticContext({
        ...base,
        targets: [...targets, { path: "src.js", kind: "file" }],
      }),
    ).toEqual({ ok: false, code: "ambiguous_binding", path: "src.note.md" });
  });

  it("cannot use an explicit binding to pull in unrelated notes", () => {
    expect(
      resolveAgenticContext({ ...base, currentNotePath: "unrelated.note.md" }),
    ).toEqual({ ok: false, code: "invalid_current_binding" });
  });

  it("rejects duplicate case aliases by default, with explicit Linux case policy", () => {
    const input = {
      ...base,
      notes: [
        ...notes,
        {
          path: "SRC.NOTE.MD".replace(".NOTE.MD", ".note.md"),
          source: "Other",
        },
      ],
    };
    expect(resolveAgenticContext(input)).toEqual({
      ok: false,
      code: "ambiguous_note",
      path: "SRC.note.md",
    });
    expect(resolveAgenticContext({ ...input, caseSensitive: true }).ok).toBe(
      true,
    );
  });

  it("does not infer a note-of-note without an explicit binding", () => {
    const input = {
      ...base,
      target: {
        path: "src/lib/example.note.md",
        kind: "file",
      } as AgenticTarget,
      targets: [
        ...targets,
        { path: "src/lib/example.note.md", kind: "file" } as AgenticTarget,
      ],
    };
    expect(resolveAgenticContext(input)).toEqual({
      ok: false,
      code: "current_binding_required",
    });
    const result = resolveAgenticContext({
      ...input,
      currentNotePath: "src/lib/example.note.md",
    });
    expect(result.ok && result.notes.at(-1)?.path).toBe(
      "src/lib/example.note.md",
    );
  });

  it.each([
    ["src/a.js", "file", "src/a.note.md"],
    ["src/a.test.ts", "file", "src/a.test.note.md"],
    [".env", "file", ".env.note.md"],
    ["Makefile", "file", "Makefile.note.md"],
    ["src/app.v2", "folder", "src/app.v2.note.md"],
    ["", "folder", null],
    ["src/a.note.md", "file", null],
  ] as const)("uses canonical %s %s association", (path, kind, expected) => {
    expect(agenticNotePathFor({ path, kind })).toBe(expected);
  });
});

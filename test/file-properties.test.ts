import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  isManagedNoteName,
  isMarkdownDocumentName,
  stampFileProperties,
} from "../src/core/file-properties.js";

describe("shared file properties core", () => {
  it("never treats a legacy-looking scope map as empty or deletes its secret", () => {
    const source =
      "---\ncreated: old\nupdated: old\ntitle: title\nlevel: file-note\nscope:\n  Password*: synthetic-important\nstatus: live\nagent: true\n---\nBody";
    const saved = stampFileProperties(source, {
      fileName: "x.note.md",
      updatedAt: "now",
    });
    expect(saved).toContain("scope:\n  Password*: synthetic-important");
    const header = parse(saved.split("---\n")[1]!);
    expect(header.scope).toEqual({ "Password*": "synthetic-important" });
    expect(header.title).toBe("title");
  });

  it("keeps unsupported managed maps intact rather than overwriting authored values", () => {
    for (const key of ["file", "created", "updated"]) {
      const source = `---\n${key}:\n  Password*: synthetic-important\n---\nBody`;
      expect(
        stampFileProperties(source, {
          fileName: "x.note.md",
          updatedAt: "now",
        }),
      ).toBe(source);
    }
  });

  it("preserves scalar lexemes, created type, nested comments and flow layout byte-for-byte", () => {
    const custom =
      'count: 9007199254740993 # exact\nprecise: 1.0000000000000000001\ncredentials: {Password*: "  synthetic  ", count: 0x0010} # keep';
    const source = `---\ncreated: 42\n${custom}\n---\nBody`;
    const saved = stampFileProperties(source, {
      fileName: "x.note.md",
      updatedAt: "now",
    });
    expect(saved).toContain(custom);
    expect(parse(saved.split("---\n")[1]!).created).toBe(42);
  });

  it("retains every trailing newline in authored keep-chomp secret values", () => {
    for (const eol of ["\n", "\r\n"]) {
      const original = [
        "created: old",
        "updated: old",
        "Password*: |+",
        "  synthetic",
        "",
        "",
        "",
      ].join(eol);
      const source = ["---", original, "---", "Body"].join(eol);
      const saved = stampFileProperties(source, {
        fileName: "x.note.md",
        updatedAt: "now",
      });
      const savedHeader = saved.split(`---${eol}`)[1]!;
      expect(parse(savedHeader)["Password*"]).toBe(
        parse(source.split(`---${eol}`)[1]!)["Password*"],
      );
      expect(saved).toContain(
        ["Password*: |+", "  synthetic", "", "", ""].join(eol),
      );
    }
  });
  it("saves quoted and multiline managed keys without corrupting nested secrets", () => {
    const yaml =
      '"file": |\n  old.note.md\n"created": 2026-07-10\n"updated": old\n# credentials\ncredentials:\n  Password*: |+\n    first line\n    second line\n\n  count: 2\n  enabled: true\n';
    const source = `---\n${yaml}---\n\nBody\n`;
    const saved = stampFileProperties(source, {
      fileName: "new.note.md",
      updatedAt: "2026-09-12T00:00:00.000Z",
    });
    const header = saved.split("---\n")[1]!;
    const data = parse(header);
    expect(data.file).toBe("new.note.md");
    expect(data.created).toBe("2026-07-10");
    expect(data.updated).toBe("2026-09-12T00:00:00.000Z");
    expect(data.credentials).toEqual(parse(yaml).credentials);
    expect(header).toContain("# credentials");
    expect(saved).toMatch(/---\n\nBody\n$/u);
  });

  it("preserves flow-map fields and scalar types while updating metadata", () => {
    const saved = stampFileProperties(
      '---\n{"created": 2026-01-01, enabled: true, count: 42, "Password*": "0000"}\n---\n',
      {
        fileName: "x.note.md",
        updatedAt: "2026-09-12",
      },
    );
    expect(parse(saved.split("---\n")[1]!)).toEqual({
      file: "x.note.md",
      created: "2026-01-01",
      updated: "2026-09-12",
      enabled: true,
      count: 42,
      "Password*": "0000",
    });
  });

  it("does not rewrite malformed, duplicate, alias-bound or unfinished YAML", () => {
    for (const header of [
      "file: a\nfile: b\n",
      "file: [\n",
      "file: &name a\nPassword*: *name\n",
      "[a, b]\n",
    ]) {
      const source = `---\n${header}---\n\nBody`;
      expect(
        stampFileProperties(source, {
          fileName: "x.note.md",
          updatedAt: "now",
        }),
      ).toBe(source);
    }
    const unfinished = "---\nPassword*: example";
    expect(
      stampFileProperties(unfinished, {
        fileName: "x.note.md",
        updatedAt: "now",
      }),
    ).toBe(unfinished);
  });
  it("targets note sidecars but not ordinary Markdown documents", () => {
    expect(isManagedNoteName("docs/map.md")).toBe(false);
    expect(isManagedNoteName("docs/map.note.md")).toBe(true);
    expect(isMarkdownDocumentName("docs/map.note.md")).toBe(true);
    expect(isMarkdownDocumentName("docs/map.txt")).toBe(false);
  });

  it("writes only filename, creation, and explicit-save update properties", () => {
    expect(
      stampFileProperties("# Map\n", {
        fileName: "docs/00-documentation-map.note.md",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-09-01T18:00:00.000Z",
      }),
    ).toBe(
      "---\n" +
        "file: 00-documentation-map.note.md\n" +
        "created: 2026-08-20T10:00:00.000Z\n" +
        "updated: 2026-09-01T18:00:00.000Z\n" +
        "---\n\n" +
        "# Map\n",
    );
  });

  it("preserves authored note properties, creation, and body", () => {
    const source =
      "---\r\n" +
      "title: old\r\n" +
      "status: live\r\n" +
      "created: 2026-07-10\r\n" +
      "updated: 2026-07-11\r\n" +
      "---\r\n\r\n" +
      "Body  \r\n";
    expect(
      stampFileProperties(source, {
        fileName: "renamed.note.md",
        createdAt: "ignored",
        updatedAt: "2026-09-01T18:05:00.000Z",
      }),
    ).toBe(
      "---\r\n" +
        "file: renamed.note.md\r\n" +
        "title: old\r\n" +
        "status: live\r\n" +
        "created: 2026-07-10\r\n" +
        'updated: "2026-09-01T18:05:00.000Z"\r\n' +
        "---\r\n\r\n" +
        "Body  \r\n",
    );
  });

  it("removes the complete legacy generated note signature", () => {
    const source =
      "---\n" +
      "file: app.note.md\n" +
      "created: 2026-07-10\n" +
      "updated: 2026-07-11\n" +
      "title: app.js\n" +
      "level: file-note\n" +
      "scope: \n" +
      "status: live\n" +
      "agent: true\n" +
      "owner: team-a\n" +
      "---\n\n" +
      "Body\n";
    const saved = stampFileProperties(source, {
      fileName: "app.note.md",
      updatedAt: "2026-09-02T08:00:00.000Z",
    });
    expect(parse(saved.split("---\n")[1]!)).toEqual({
      file: "app.note.md",
      created: "2026-07-10",
      updated: "2026-09-02T08:00:00.000Z",
      owner: "team-a",
    });
    expect(saved).toContain("owner: team-a\n");
    expect(saved).toMatch(/---\n\nBody\n$/u);
  });

  it("keeps ordinary Markdown documents byte-identical", () => {
    const source = "---\nstatus: document\n---\n\n# Document\n";
    expect(
      stampFileProperties(source, {
        fileName: "file.md",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-09-01T18:00:00.000Z",
      }),
    ).toBe(source);
  });

  it("preserves ambiguous legacy-looking properties in ordinary Markdown", () => {
    const source =
      "---\nfile: map.md\ncreated: 2026-08-20\nupdated: 2026-09-01\nstatus: draft\n---\n\n# Map\n";
    expect(
      stampFileProperties(source, {
        fileName: "map.md",
        updatedAt: "2026-09-02T08:00:00.000Z",
      }),
    ).toBe(source);
  });
});

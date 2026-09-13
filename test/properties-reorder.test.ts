import { describe, expect, it } from "vitest";
import { parsePropertiesBody } from "../src/core/properties-model.js";
import {
  canReorderPropertiesField,
  canReorderPropertiesSection,
  createPropertiesReorderCapabilities,
  reorderPropertiesField,
  reorderPropertiesSection,
} from "../src/core/properties-reorder.js";

const bad = new TypeError("Invalid properties reorder");

function sections(body: string) {
  const parsed = parsePropertiesBody(body);
  expect(parsed.ok).toBe(true);
  return parsed.ok ? parsed.model.sections : [];
}

describe("Properties exact-byte reordering", () => {
  it("pins the version directive while reordering first root groups with CRLF", () => {
    const body =
      "# aic-fields: v2\r\nfirst:\r\n  Password*: 'x | desc'\r\nsecond:\r\n  Label: value\r\n";
    expect(canReorderPropertiesSection(body, 2, 3)).toBe(true);
    const moved = reorderPropertiesSection(body, 2, 3);
    expect(moved).toBe(
      "# aic-fields: v2\r\nsecond:\r\n  Label: value\r\nfirst:\r\n  Password*: 'x | desc'\r\n",
    );
    expect(sections(moved)[3]!.fields[0]!.description).toBe("desc");
  });
  it("moves root scalar fields with leading and inline comments, quotes, stars, and multiline bytes", () => {
    const body = [
      "file: example.note.md",
      "created: 2026-09-13T00:00:00Z",
      'alpha*: "A" # alpha inline',
      "# beta belongs with beta",
      "beta: |-",
      "  one",
      "  two",
      "count: 9007199254740993",
      "",
    ].join("\n");
    expect(sections(body)[1]!.fields.map((field) => field.label)).toEqual([
      "alpha",
      "beta",
      "count",
    ]);
    expect(canReorderPropertiesField(body, 1, 1, 0)).toBe(true);
    const moved = reorderPropertiesField(body, 1, 1, 0);
    expect(moved).toBe(
      [
        "file: example.note.md",
        "created: 2026-09-13T00:00:00Z",
        "# beta belongs with beta",
        "beta: |-",
        "  one",
        "  two",
        'alpha*: "A" # alpha inline',
        "count: 9007199254740993",
        "",
      ].join("\n"),
    );
    expect(
      sections(moved)[1]!.fields.map((field) => [
        field.label,
        field.value,
        field.hide,
      ]),
    ).toEqual([
      ["beta", "one\ntwo", false],
      ["alpha", "A", true],
      ["count", "9007199254740993", false],
    ]);
  });

  it("moves nested scalar fields without normalizing CRLF or a null last value", () => {
    const body =
      "group:\r\n  first: 1\r\n  # second's comment\r\n  second*: 'two'\r\n  empty:\r\nnext: true\r\n";
    expect(sections(body).map((section) => section.label)).toEqual([
      "Properties",
      "Fields",
      "/group",
    ]);
    const moved = reorderPropertiesField(body, 2, 2, 0);
    expect(moved).toBe(
      "group:\r\n  empty:\r\n  first: 1\r\n  # second's comment\r\n  second*: 'two'\r\nnext: true\r\n",
    );
    expect(sections(moved)[2]!.fields.map((field) => field.label)).toEqual([
      "empty",
      "first",
      "second",
    ]);
  });

  it("carries a first nested field's leading comment with the field", () => {
    const body = "group:\n  # first comment\n  first: 1\n  second: 2\n";
    expect(reorderPropertiesField(body, 2, 0, 1)).toBe(
      "group:\n  second: 2\n  # first comment\n  first: 1\n",
    );
  });

  it("moves a complete same-parent nested group with its leading comment and descendants", () => {
    const body = [
      "alpha:",
      "  value: one",
      "# beta belongs with subtree",
      "beta*:",
      "  nested:",
      "    token: synthetic-only-secret",
      "gamma:",
      "  list:",
      "    - first",
      "    - second",
      "",
    ].join("\n");
    expect(sections(body).map((section) => section.label)).toEqual([
      "Properties",
      "Fields",
      "/alpha",
      "/beta*",
      "/beta*/nested",
      "/gamma",
      "/gamma/list",
    ]);
    expect(canReorderPropertiesSection(body, 3, 2)).toBe(true);
    const moved = reorderPropertiesSection(body, 3, 2);
    expect(moved).toBe(
      [
        "# beta belongs with subtree",
        "beta*:",
        "  nested:",
        "    token: synthetic-only-secret",
        "alpha:",
        "  value: one",
        "gamma:",
        "  list:",
        "    - first",
        "    - second",
        "",
      ].join("\n"),
    );
    expect(sections(moved).map((section) => section.label)).toEqual([
      "Properties",
      "Fields",
      "/beta*",
      "/beta*/nested",
      "/alpha",
      "/gamma",
      "/gamma/list",
    ]);
  });

  it("moves a flow-valued group as an opaque block when its parent is a block map", () => {
    const body = "one: {x: 1}\ntwo:\n  a: b\n";
    expect(reorderPropertiesSection(body, 2, 3)).toBe(
      "two:\n  a: b\none: {x: 1}\n",
    );
    expect(reorderPropertiesField(body, 2, 0, 0)).toBe(body);
    expect(canReorderPropertiesField(body, 2, 0, 0)).toBe(false);
    expect(canReorderPropertiesField(body, 2, 0, 1)).toBe(false);
  });

  it("permits same-parent child groups inside a sequence map, but not sequence items", () => {
    const body =
      "list:\n  -\n    first:\n      value: a\n    second:\n      value: b\n  - other:\n      value: c\n";
    const labels = sections(body).map((section) => section.label);
    expect(labels).toEqual([
      "Properties",
      "Fields",
      "/list",
      "/list/0",
      "/list/0/first",
      "/list/0/second",
      "/list/1",
      "/list/1/other",
    ]);
    expect(canReorderPropertiesSection(body, 4, 5)).toBe(true);
    const moved = reorderPropertiesSection(body, 4, 5);
    expect(sections(moved)[4]!.label).toBe("/list/0/second");
    expect(canReorderPropertiesSection(body, 3, 6)).toBe(false);
    expect(() => reorderPropertiesSection(body, 3, 6)).toThrowError(bad);
  });

  it("returns original bytes for valid no-ops", () => {
    const body = "a: 1\nb: 2\ngroup:\n  x: y\n";
    expect(reorderPropertiesField(body, 1, 0, 0)).toBe(body);
    expect(reorderPropertiesSection(body, 2, 2)).toBe(body);
  });

  it("refuses an ambiguous document preamble instead of reattaching its comment", () => {
    const body = "# document-level comment\na: 1\nb: 2\n";
    expect(canReorderPropertiesField(body, 1, 0, 1)).toBe(false);
    expect(() => reorderPropertiesField(body, 1, 0, 1)).toThrowError(bad);
  });

  it("fails closed on metadata, unrelated parents, arrays, flow maps and bad indices", () => {
    const body =
      "file: x.note.md\na: 1\nb: 2\ngroup:\n  x: 1\nother:\n  y: 2\n";
    const cases: Array<() => unknown> = [
      () => reorderPropertiesField(body, 0, 0, 0),
      () => reorderPropertiesField(body, 1, -1, 0),
      () => reorderPropertiesField(body, 1, 0, 5),
      () => reorderPropertiesField(body, 2, 0, 1),
      () => reorderPropertiesSection(body, 0, 2),
      () => reorderPropertiesSection(body, 1, 2),
      () =>
        reorderPropertiesSection(
          "a:\n  nested:\n    value: 1\nb:\n  value: 2\n",
          2,
          3,
        ),
      () =>
        reorderPropertiesSection(
          "list:\n  - left:\n      x: 1\n  - right:\n      x: 2\n",
          3,
          5,
        ),
      () => reorderPropertiesField("flow: {a: 1, b: 2}\n", 2, 0, 1),
      () => reorderPropertiesField("a: &ref x\nb: *ref\n", 1, 0, 1),
      () => reorderPropertiesField("not: [valid\n", 1, 0, 1),
    ];
    for (const operation of cases) expect(operation).toThrowError(bad);
    expect(canReorderPropertiesField(body, 0, 0, 0)).toBe(false);
    expect(canReorderPropertiesField("flow: {a: 1, b: 2}\n", 2, 0, 1)).toBe(
      false,
    );
    expect(
      canReorderPropertiesSection(
        "a:\n  nested:\n    value: 1\nb:\n  value: 2\n",
        2,
        3,
      ),
    ).toBe(false);
  });

  it("does not cross authored managed metadata or leak malformed secret values in errors", () => {
    const body = "a: 1\nfile: pinned.note.md\nb: 2\n";
    expect(canReorderPropertiesField(body, 1, 0, 1)).toBe(false);
    expect(() => reorderPropertiesField(body, 1, 0, 1)).toThrowError(bad);
    const malformed = "secret*: synthetic-only-secret\ninvalid: [";
    try {
      reorderPropertiesField(malformed, 1, 0, 1);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-only-secret");
    }
  });

  it("reuses one parsed snapshot for structural field and section checks", () => {
    const body =
      "file: pinned.note.md\nalpha: 1\nbeta: 2\none:\n  x: 1\ntwo:\n  y: 2\n";
    const capabilities = createPropertiesReorderCapabilities(body);
    expect(capabilities.field(1, 0, 1)).toBe(true);
    expect(capabilities.section(2, 3)).toBe(true);
    expect(capabilities.field(0, 0, 1)).toBe(false);
    expect(capabilities.section(1, 2)).toBe(false);
    expect(capabilities.field(1, 0, 0)).toBe(false);
    expect(capabilities.section(2, 2)).toBe(false);
    expect(
      createPropertiesReorderCapabilities("broken: [").field(1, 0, 1),
    ).toBe(false);
  });

  it("checks a near-limit 64-group, 256-field document without reparsing each peer", () => {
    const lines = ["file: pinned.note.md"];
    for (let field = 0; field < 69; field += 1)
      lines.push(`field_${field}: '${field < 4 ? "x".repeat(12_000) : field}'`);
    for (let group = 0; group < 62; group += 1) {
      lines.push(`group_${group}:`);
      for (let field = 0; field < 3; field += 1)
        lines.push(`  field_${field}: ${field}`);
    }
    const body = `${lines.join("\n")}\n`;
    expect(body.length).toBeLessThan(64 * 1024);
    expect(sections(body)).toHaveLength(64);
    const started = performance.now();
    const capabilities = createPropertiesReorderCapabilities(body);
    for (let check = 0; check < 2_048; check += 1) {
      expect(capabilities.field(1, check % 69, (check + 1) % 69)).toBe(true);
      expect(capabilities.section(2 + (check % 61), 3 + (check % 61))).toBe(
        true,
      );
    }
    expect(performance.now() - started).toBeLessThan(8_000);
  }, 15_000);
});

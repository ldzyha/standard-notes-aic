import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  parsePropertiesBody,
  serializePropertiesBody,
} from "../src/core/properties-model.js";

function model(body: string) {
  const result = parsePropertiesBody(body);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic properties did not parse");
  return structuredClone(result.model) as {
    sections: {
      label: string;
      fields: {
        label: string;
        value: string;
        hide: boolean;
        readOnly?: true;
      }[];
      readOnly?: true;
      allowAdd: boolean;
    }[];
  };
}
const invalid = { ok: false, code: "invalid_properties_block" };
const data = (body: string) => parseDocument(body).toJS();

describe("Properties YAML adapter", () => {
  it("copies unsafe-size integers exactly and rejects decimal values that would round", () => {
    const body =
      "big: 9007199254740993\nnegative: -9007199254740993\nprecise: 2.50\nexponent: 1e16\nempty:\n";
    const value = model(body);
    expect(value.sections[1]!.fields.map((field) => field.value)).toEqual([
      "9007199254740993",
      "-9007199254740993",
      "2.5",
      "10000000000000000",
      "",
    ]);
    expect(serializePropertiesBody(value, body)).toBe(body);
    value.sections[1]!.fields[4]!.value = "synthetic";
    const updated = serializePropertiesBody(value, body);
    expect(updated).toContain("big: 9007199254740993\n");
    expect(updated).toContain("precise: 2.50\n");
    for (const source of [
      "number: 1.0000000000000000001",
      "number: 9007199254740993.0",
      "number: 0.10000000000000001",
    ]) {
      expect(parsePropertiesBody(source)).toEqual(invalid);
    }
  });
  it("handles fill, deletion and simultaneous nested/root append boundaries without changing unrelated YAML", () => {
    const fixtures = [
      "{a:, b: 1}",
      "group:\n  a: #x\n#outer\nb: 1",
      "a: null",
      "a: null\n#last",
      "group:\n  a:\n",
      "group:\n  a:\n  #after\nnext: 1",
      "list:\n  - a:\n    b: 2\nnext: 1",
      "{a: null, # a\n b: null, # b\n c: 1}",
      "group:\r\n  a: #x\r\nnext: false\r\n",
    ];
    for (const body of fixtures) {
      for (const operation of ["fill", "remove", "add"]) {
        const value = model(body);
        for (const section of value.sections.slice(1)) {
          if (operation === "fill")
            for (const field of section.fields) {
              if (field.value === "" && !field.readOnly)
                field.value = "  synthetic\nvalue  ";
            }
          if (operation === "remove")
            section.fields = section.fields.filter(
              (field) => field.value !== "" || field.readOnly,
            );
          if (operation === "add" && section.allowAdd)
            section.fields.push({ label: "New", value: "", hide: false });
        }
        const updated = serializePropertiesBody(value, body);
        expect(parsePropertiesBody(updated).ok).toBe(true);
        for (const comment of body.match(/#[^\r\n]*/gu) ?? [])
          expect(updated).toContain(comment);
      }
    }
  });

  it("rejects bounded-size model expansion and accepts exact scalar-size limits", () => {
    const body = 'x: "' + "s".repeat(16 * 1024) + '"';
    expect(serializePropertiesBody(model(body), body)).toBe(body);
    const oversized = model("");
    oversized.sections[1]!.fields = Array.from({ length: 257 }, (_, index) => ({
      label: `field${index}`,
      value: "",
      hide: false,
    }));
    expect(() => serializePropertiesBody(oversized, "")).toThrowError(
      new TypeError("Invalid properties block"),
    );
    expect(
      parsePropertiesBody(
        Array.from({ length: 257 }, (_, index) => `field${index}:`).join("\n"),
      ),
    ).toEqual(invalid);
  });
  it("round-trips managed, authored scalar types, multiline values and comments byte-for-byte", () => {
    const body =
      '# authored\r\nfile: "sample.note.md" # managed\r\ncreated: 2026-09-12T00:00:00Z\r\nupdated: 2026-09-13\r\ncount: 0x10\r\nenabled: true\r\nPassword*: "  synthetic pass  "\r\nnotes: |-\r\n  one\r\n  two\r\n';
    const value = model(body);
    expect(value.sections[0]).toMatchObject({
      label: "Properties",
      readOnly: true,
      allowAdd: false,
    });
    expect(
      value.sections[0]!.fields.map((field) => [field.label, field.readOnly]),
    ).toEqual([
      ["file", true],
      ["created", true],
      ["updated", true],
    ]);
    expect(
      value.sections[1]!.fields.map((field) => [field.value, field.hide]),
    ).toEqual([
      ["16", false],
      ["true", false],
      ["  synthetic pass  ", true],
      ["one\ntwo", false],
    ]);
    expect(serializePropertiesBody(value, body)).toBe(body);
  });

  it.each([
    "",
    "# only comment",
    "# only comment\n",
    "{}",
    "file: sample.note.md",
  ])("always has an expandable Fields section: %s", (body) => {
    const value = model(body);
    expect(value.sections[1]).toEqual({
      label: "Fields",
      fields: [],
      allowAdd: true,
    });
    expect(serializePropertiesBody(value, body)).toBe(body);
    value.sections[1]!.fields.push({
      label: "Password",
      value: "",
      hide: true,
    });
    const updated = serializePropertiesBody(value, body);
    expect(data(updated)["Password*"]).toBe("");
    if (body.startsWith("#")) expect(updated).toContain("# only comment");
  });

  it("shows nested scalar leaves without exposing maps, with inherited hide and collision-free paths", () => {
    const body =
      'credentials*:\n  username: synthetic\n  token: ""\n"a/b":\n  value: 1\na:\n  b:\n    value: 2\nlist:\n- one\n- null\n- password*:\n    value: synthetic-nested\n';
    const value = model(body);
    expect(value.sections.map((section) => section.label)).toEqual([
      "Properties",
      "Fields",
      "/credentials*",
      "/a~1b",
      "/a",
      "/a/b",
      "/list",
      "/list/2",
      "/list/2/password*",
    ]);
    expect(value.sections[2]!.fields.every((field) => field.hide)).toBe(true);
    expect(value.sections[6]).toMatchObject({
      allowAdd: false,
      fields: [
        { label: "[1]", value: "one", readOnly: true },
        { label: "[2]", value: "", readOnly: true },
      ],
    });
    expect(value.sections[8]!.fields[0]!.hide).toBe(true);
    value.sections[2]!.fields[1]!.value = "  literal\nsecret  ";
    const updated = serializePropertiesBody(value, body);
    expect(data(updated)["credentials*"].token).toBe("  literal\nsecret  ");
  });

  it.each([
    "empty:\nnext: 0x10\n",
    "empty: # keep\nnext: false\n",
    "empty: null # keep\nnext: 1\n",
    'empty: "" # keep\nnext: 1\n',
    "{empty: null, next: 1} # keep",
    "empty: |- # keep\nnext: 1\n",
  ])(
    "fills only the empty scalar token and preserves neighbours: %s",
    (body) => {
      const value = model(body);
      value.sections[1]!.fields[0]!.value =
        '  synthetic "secret"\nsecond line  ';
      const updated = serializePropertiesBody(value, body);
      expect(data(updated).empty).toBe(value.sections[1]!.fields[0]!.value);
      expect(data(updated).next).toBe(data(body).next);
      if (body.includes("# keep")) expect(updated).toContain("# keep");
      if (body.includes("0x10")) expect(updated).toContain("0x10");
    },
  );

  it.each([
    "empty: # keep\nnext: 0x10\n",
    "group:\n  empty: null # keep\nnext: 1\n",
    'group: {empty: "", next: 1} # keep',
    '{a: "", b: null, c: 1} # keep',
    'group: {a: null, b: "",} # keep',
    "group:\n  empty: |- # keep\nnext: 1\n",
  ])(
    "deletes empty rows without deleting comments or changing groups: %s",
    (body) => {
      const value = model(body);
      for (const section of value.sections.slice(1))
        section.fields = section.fields.filter((field) => field.value !== "");
      const updated = serializePropertiesBody(value, body);
      expect(updated).toContain("# keep");
      const before = data(body);
      const after = data(updated);
      if (before.group)
        expect(after.group).toEqual(before.group.next ? { next: 1 } : {});
      if (before.next !== undefined) expect(after.next).toBe(before.next);
      if (before.c !== undefined) expect(after).toEqual({ c: 1 });
    },
  );

  it.each([
    "group:\n  existing: 0x10\nnext: true\n",
    "group: {existing: 0x10,} # keep\nnext: true",
    "group: {}\nnext: true",
    "group*:\n  existing: true\nnext: 1",
  ])("appends safe empty fields in-place: %s", (body) => {
    const value = model(body);
    value.sections[2]!.fields.push({
      label: "Password 2",
      value: "",
      hide: true,
    });
    const updated = serializePropertiesBody(value, body);
    const key = body.startsWith("group*") ? "group*" : "group";
    expect(
      data(updated)[key][key.endsWith("*") ? "Password 2" : "Password 2*"],
    ).toBe("");
    expect(data(updated).next).toBe(data(body).next);
    if (body.includes("0x10")) expect(updated).toContain("0x10");
    if (body.includes("# keep")) expect(updated).toContain("# keep");
  });

  it("supports reversible Recovery codes used flags but never value replacement", () => {
    const body =
      '"Recovery codes*": |- # keep\n  - [ ] synthetic-one\n  - [x] synthetic-one\nnext: true\n';
    const value = model(body);
    value.sections[1]!.fields[0]!.value =
      "- [x] synthetic-one\n- [ ] synthetic-one";
    const updated = serializePropertiesBody(value, body);
    expect(data(updated)["Recovery codes*"]).toBe(
      value.sections[1]!.fields[0]!.value,
    );
    expect(updated).toContain("# keep");
    value.sections[1]!.fields[0]!.value = "- [x] different";
    expect(() => serializePropertiesBody(value, body)).toThrowError(
      new TypeError("Invalid properties block"),
    );
  });

  it("rejects managed changes/deletion, overwrite, identity changes, nonempty additions and array mutations", () => {
    const body =
      "file: sample.note.md\nPassword*: synthetic\nempty:\nlist: [null, value]\n";
    const attempts = [
      (value: ReturnType<typeof model>) => {
        value.sections[0]!.fields[0]!.value = "wrong";
      },
      (value: ReturnType<typeof model>) => {
        value.sections[0]!.fields = [];
      },
      (value: ReturnType<typeof model>) => {
        value.sections[1]!.fields[0]!.value = "wrong";
      },
      (value: ReturnType<typeof model>) => {
        value.sections[1]!.fields[0]!.hide = false;
      },
      (value: ReturnType<typeof model>) => {
        value.sections[1]!.fields.push({
          label: "new",
          value: "nonempty",
          hide: false,
        });
      },
      (value: ReturnType<typeof model>) => {
        value.sections[1]!.fields.push({
          label: "constructor",
          value: "",
          hide: false,
        });
      },
      (value: ReturnType<typeof model>) => {
        value.sections[1]!.fields.push({
          label: "file",
          value: "",
          hide: false,
        });
      },
      (value: ReturnType<typeof model>) => {
        value.sections[2]!.fields[0]!.value = "array change";
      },
      (value: ReturnType<typeof model>) => {
        value.sections[2]!.fields.shift();
      },
    ];
    for (const mutate of attempts) {
      const value = model(body);
      mutate(value);
      expect(() => serializePropertiesBody(value, body)).toThrowError(
        new TypeError("Invalid properties block"),
      );
    }
  });

  it.each([
    "a: 1\na: 2",
    "a: &secret synthetic\nb: *secret",
    "? [a, b]\n: secret",
    "__proto__: synthetic",
    "group:\n  constructor: synthetic",
    "a: !unknown synthetic",
    "[a, b]",
    "file: {nested: synthetic}",
    "a: .inf",
    "---\na: secret",
    "a: secret\n...",
    "a: [broken",
    'x: "' + "s".repeat(16 * 1024 + 1) + '"',
    "x: " + "s".repeat(64 * 1024),
    "a:\n" +
      Array.from(
        { length: 18 },
        (_, index) => " ".repeat(index + 2) + "a:",
      ).join("\n"),
  ])("fails closed with no source in errors: %s", (body) => {
    expect(parsePropertiesBody(body)).toEqual(invalid);
    expect(() => serializePropertiesBody({ sections: [] }, body)).toThrowError(
      new TypeError("Invalid properties block"),
    );
  });
});

import { describe, expect, it } from "vitest";
import { SECURITY_FIELD_OPTIONS } from "../src/core/field-syntax.js";
import {
  isSecretField,
  parseSecurityBlock,
  redactSecurityBlocks,
  safeSecurityUrl,
  securityTemplate,
  serializeSecurityBlock,
  type SecurityModel,
} from "../src/core/security-model.js";

const model: SecurityModel = {
  sections: [
    {
      label: "Main",
      fields: [
        { label: "Service", value: "Example", hide: false },
        { label: "Email", value: "first@example.test", hide: false },
        { label: "Email", value: "second@example.test", hide: false },
        { label: "Password", value: "visible by choice", hide: false },
        { label: "Password", value: "hidden by choice", hide: true },
      ],
    },
    {
      label: "PSP",
      fields: [
        { label: "URL", value: "https://example.test/a:b", hide: false },
        { label: "TOTP", value: "KEY123", hide: true },
      ],
    },
  ],
};
const invalid = { ok: false, code: "invalid_security_block" };

describe("security block model", () => {
  it("uses one pipe grammar with or without canonical options", () => {
    const body = "## Main\nPassword*: syn\\|thetic | note\nTOTP#: KEY123\n";
    const parsed = parseSecurityBlock(body);
    expect(parsed).toEqual(parseSecurityBlock(body, SECURITY_FIELD_OPTIONS));
    if (!parsed.ok) return;
    const canonical =
      '## Main\nPassword*: "syn|thetic" | note\nTOTP#: KEY123\n';
    expect(serializeSecurityBlock(parsed.model)).toBe(canonical);
    expect(serializeSecurityBlock(parsed.model, SECURITY_FIELD_OPTIONS)).toBe(
      canonical,
    );
  });

  it("round-trips markers, escaped pipes, and independent value parts", () => {
    const options = { fieldSyntax: "pipes" } as const;
    const body =
      "## Main\nPassword*: syn\\|thetic | WebDAV\nTOTP#: KEY123 | phone\nCard_: 4111111111111111 | 09/28 | 123\nNote: left\\|right |  | extra\\|part\n";
    const parsed = parseSecurityBlock(body, options);
    expect(parsed).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "Main",
            fields: [
              {
                label: "Password",
                value: "syn|thetic",
                description: "WebDAV",
                hide: true,
              },
              {
                label: "TOTP",
                value: "KEY123",
                description: "phone",
                hide: true,
                kind: "totp",
              },
              {
                label: "Card",
                value: "4111111111111111",
                description: "09/28",
                additionalSecret: "123",
                hide: false,
                kind: "card",
              },
              {
                label: "Note",
                value: "left|right",
                description: "",
                additionalSecret: "extra|part",
                hide: false,
              },
            ],
          },
        ],
      },
    });
    if (!parsed.ok) return;
    const canonical =
      '## Main\nPassword*: "syn|thetic" | WebDAV\nTOTP#: KEY123 | phone\nCard_: 4111111111111111 | 09/28 | 123\nNote: "left|right" |  | "extra|part"\n';
    expect(serializeSecurityBlock(parsed.model, options)).toBe(canonical);
    expect(parseSecurityBlock(canonical)).toEqual(parsed);
    expect(parseSecurityBlock(body)).toEqual(parsed);
  });

  it("rejects malformed markers and parts without returning secret values", () => {
    const options = { fieldSyntax: "pipes" } as const;
    for (const body of [
      "## Main\n__proto__: synthetic-secret",
      "## Main\nPassword*#: synthetic-secret",
      "## Main\nCard_: synthetic-secret | 09/28 | 123",
      "## Main\nToken: one | two | three | four",
      "## Main\nToken: bad\\@escape",
    ])
      expect(parseSecurityBlock(body, options)).toEqual(invalid);
    expect(() =>
      serializeSecurityBlock(
        {
          sections: [
            {
              label: "Main",
              fields: [
                {
                  label: "Password",
                  description: "synthetic-secret",
                  value: "synthetic-secret",
                  hide: false,
                },
              ],
            },
          ],
        },
        options,
      ),
    ).not.toThrow();
  });

  it("round-trips a card title independent of every section label", () => {
    const titled: SecurityModel = { title: "Accounts", ...model };
    const serialized = serializeSecurityBlock(titled);
    expect(serialized).toBe("# Accounts\n" + serializeSecurityBlock(model));
    expect(parseSecurityBlock(serialized)).toEqual({ ok: true, model: titled });
    const reordered = { ...titled, sections: [...titled.sections].reverse() };
    expect(parseSecurityBlock(serializeSecurityBlock(reordered))).toEqual({
      ok: true,
      model: reordered,
    });
    expect(serializeSecurityBlock(reordered)).toMatch(/^# Accounts\n## PSP/u);
    expect(titled.sections).toBe(model.sections);
  });

  it("distinguishes an explicit blank title from an omitted title", () => {
    const untitled: SecurityModel = { sections: [{ label: "", fields: [] }] };
    expect(serializeSecurityBlock(untitled)).toBe("\n");
    expect(parseSecurityBlock("##\n")).toEqual({ ok: true, model: untitled });
    expect(serializeSecurityBlock({ ...untitled, title: "" })).toBe("#\n");
    expect(parseSecurityBlock("\n#\r\n\r\n##\r\n")).toEqual({
      ok: true,
      model: { title: "", ...untitled },
    });
  });

  it("escapes title backslashes while preserving printable punctuation and field secrets", () => {
    const title = "Synthetic: C:\\folder\\next * #tag <b>😀</b>";
    const titled = { title, ...model };
    const serialized = serializeSecurityBlock(titled);
    expect(serialized).toContain(
      "# Synthetic: C:\\\\folder\\\\next * #tag <b>😀</b>\n",
    );
    expect(parseSecurityBlock(serialized)).toEqual({ ok: true, model: titled });
    expect(
      parseSecurityBlock(
        "# Synthetic\\u003a title\n## Main\nPassword*: same\\nsecret",
      ),
    ).toEqual({
      ok: true,
      model: {
        title: "Synthetic: title",
        sections: [
          {
            label: "Main",
            fields: [{ label: "Password", value: "same\nsecret", hide: true }],
          },
        ],
      },
    });
  });

  it("rejects invalid, repeated, misplaced or sectionless title headings with fixed errors", () => {
    for (const body of [
      "# \n## Main",
      "#  Title\n## Main",
      "# Title \n## Main",
      "# First\n# Second\n## Main",
      "#\n#\n## Main",
      "## Main\n# Misplaced",
      "# First\n## Main\n# Misplaced",
      "#Title\n## Main",
      " # Title\n## Main",
      "### Title\n## Main",
      "# Bad\\escape\n## Main",
      "# Bad\\nline\n## Main",
      "# Bad\\u0000title\n## Main",
      "# Bad\\uD800title\n## Main",
      "# literal\tcontrol\n## Main",
      "# Bad\u2028title\n## Main",
    ]) {
      expect(parseSecurityBlock(body)).toEqual(invalid);
    }
    for (const title of [
      " padded",
      "padded ",
      "line\nbreak",
      "\u0000",
      "\uD800",
    ]) {
      expect(() => serializeSecurityBlock({ title, ...model })).toThrowError(
        new TypeError("invalid security block"),
      );
    }
  });

  it("does not migrate legacy YAML and keeps label text explicit", () => {
    const yaml =
      'service: Synthetic\nlogin: account\nannotation: ""\nfields:\n  - label: Password\n    type: secret\n    value: synthetic';
    expect(parseSecurityBlock(yaml)).toEqual(invalid);
    const plain = "Password: synthetic\n# account: visible\n";
    expect(parseSecurityBlock(plain)).toMatchObject({ ok: true });
    const parsed = parseSecurityBlock("Password: synthetic\n");
    expect(parsed.ok && parsed.model.sections[0]?.fields[0]?.hide).toBe(false);
  });

  it("round-trips optional and arbitrary labels without serializing display fallbacks", () => {
    const body =
      ": visible-value\n*: hidden-value\n#: JBSWY3DPEHPK3PXP\n_: 4111111111111111 | 09/28 | 123\nalice@example.test: username\n";
    const parsed = parseSecurityBlock(body);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(
      parsed.model.sections[0]?.fields.map((field) => field.label),
    ).toEqual(["", "", "", "", "alice@example.test"]);
    expect(serializeSecurityBlock(parsed.model)).toBe(body);
  });

  it("enforces title, section and total encoded-body limits", () => {
    const title = "😀".repeat(128);
    const titled = { title, ...model };
    expect(parseSecurityBlock(serializeSecurityBlock(titled))).toEqual({
      ok: true,
      model: titled,
    });
    expect(parseSecurityBlock("# " + title + "x\n## Main")).toEqual(invalid);
    expect(() =>
      serializeSecurityBlock({ title: title + "x", ...model }),
    ).toThrowError(new TypeError("invalid security block"));
    const sections = Array.from({ length: 16 }, () => ({
      label: "",
      fields: [],
    }));
    expect(
      parseSecurityBlock(serializeSecurityBlock({ title: "Card", sections }))
        .ok,
    ).toBe(true);
    expect(() =>
      serializeSecurityBlock({
        title: "Card",
        sections: [...sections, sections[0]!],
      }),
    ).toThrowError(new TypeError("invalid security block"));
    const nearLimit: SecurityModel = {
      sections: [
        {
          label: "",
          fields: Array.from({ length: 4 }, () => ({
            label: "F",
            value: "s".repeat(16379),
            hide: false,
          })),
        },
      ],
    };
    expect(serializeSecurityBlock(nearLimit).length).toBe(65532);
    expect(() =>
      serializeSecurityBlock({ title: "XX", ...nearLimit }),
    ).toThrowError(new TypeError("invalid security block"));
  });

  it("creates a fenced base template with explicit visibility", () => {
    const template = securityTemplate();
    expect(template).toBe(
      [
        "```aic",
        "Service:",
        "Account:",
        "Email:",
        "URL:",
        "TOTP#:",
        "Password*:",
        "```",
      ].join("\n"),
    );
    expect(
      parseSecurityBlock(
        template.slice("```aic\n".length, -3),
        SECURITY_FIELD_OPTIONS,
      ),
    ).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "",
            fields: [
              { label: "Service", value: "", hide: false },
              { label: "Account", value: "", hide: false },
              { label: "Email", value: "", hide: false },
              { label: "URL", value: "", hide: false },
              { label: "TOTP", value: "", hide: true, kind: "totp" },
              { label: "Password", value: "", hide: true },
            ],
          },
        ],
      },
    });
    expect(parseSecurityBlock("TOTP#:\n")).toMatchObject({ ok: true });
  });

  it("round-trips an unnamed section with an implicit first section", () => {
    const unnamed: SecurityModel = {
      sections: [
        {
          label: "",
          fields: [{ label: "Password", value: "synthetic", hide: true }],
        },
      ],
    };
    expect(serializeSecurityBlock(unnamed)).toBe("Password*: synthetic\n");
    expect(parseSecurityBlock(serializeSecurityBlock(unnamed))).toEqual({
      ok: true,
      model: unnamed,
    });
    expect(parseSecurityBlock("Password*: synthetic")).toMatchObject({
      ok: true,
    });
    expect(parseSecurityBlock("## \nPassword*: synthetic")).toEqual(invalid);
  });

  it("round-trips independent sections, duplicates, and mixed hidden/visible fields", () => {
    const body = serializeSecurityBlock(model);
    expect(body).toContain(
      "Password: visible by choice\nPassword*: hidden by choice",
    );
    expect(body).toContain("URL: https://example.test/a:b");
    expect(parseSecurityBlock(body)).toEqual({ ok: true, model });
    expect(serializeSecurityBlock(model)).toBe(body);
    expect(isSecretField(model.sections[0]!.fields[3]!)).toBe(false);
    expect(isSecretField(model.sections[0]!.fields[4]!)).toBe(true);
    expect(isSecretField({ hide: false })).toBe(false);
    expect(parseSecurityBlock("\n## Main\n\nPassword*: value\n\n")).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "Main",
            fields: [{ label: "Password", value: "value", hide: true }],
          },
        ],
      },
    });
  });

  it("escapes backslash, multiline values, controls, and fences while preserving spaces", () => {
    const value = "  a:b \\folder\n```\r\t😀\u2028end  ";
    const special: SecurityModel = {
      sections: [
        { label: "Main", fields: [{ label: "Secret", value, hide: true }] },
      ],
    };
    const body = serializeSecurityBlock(special);
    expect(body).not.toMatch(/^\s*```\s*$/mu);
    expect(body).toContain("Secret*:   a:b \\\\folder\\n");
    expect(parseSecurityBlock(body)).toEqual({ ok: true, model: special });
    expect(parseSecurityBlock("## Main\r\nSecret*:  leading  \r\n")).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "Main",
            fields: [{ label: "Secret", value: " leading  ", hide: true }],
          },
        ],
      },
    });
  });

  it("rejects malformed, ambiguous, unsupported, and oversized input without leaking it", () => {
    const bad = [
      "## Main\nPassword:value",
      "## Main\nPassword**: value",
      "## Main\nField: bad\\escape",
      "## Main\nField: bad\\u00xx",
      "## Main\nField: literal\tcontrol",
      "## Main\nField: ok\nextra",
      "## Main\n## ",
      "## Main\nA: one\n```",
      "x".repeat(64 * 1024 + 1),
    ];
    for (const source of bad) {
      const result = parseSecurityBlock(source);
      expect(result).toEqual(invalid);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
    expect(() =>
      serializeSecurityBlock({
        sections: [{ label: "Bad: name", fields: [] }],
      }),
    ).toThrow("invalid security block");
    expect(() =>
      serializeSecurityBlock({
        sections: [
          {
            label: "Main",
            fields: [{ label: "Bad*", value: "x", hide: true }],
          },
        ],
      }),
    ).toThrow("invalid security block");
    expect(() =>
      serializeSecurityBlock({
        sections: [
          {
            label: "Main",
            fields: Array(65).fill(model.sections[0]!.fields[0]!),
          },
        ],
      }),
    ).toThrow("invalid security block");
  });

  it("rejects YAML-only Security structures without inferring secret fields", () => {
    const yaml = [
      "sections:",
      "  - label: Main",
      "    fields:",
      "      - label: Password",
      "        type: secret",
      "        value: synthetic-secret",
    ].join("\n");
    expect(parseSecurityBlock(yaml)).toEqual(invalid);
    expect(parseSecurityBlock("Password: synthetic-secret\n")).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "",
            fields: [
              { label: "Password", value: "synthetic-secret", hide: false },
            ],
          },
        ],
      },
    });
  });

  it("accepts only HTTP(S) URLs without embedded credentials or controls", () => {
    expect(safeSecurityUrl(" https://example.test/a:b ")).toBe(
      "https://example.test/a:b",
    );
    for (const value of [
      "javascript:alert(1)",
      "file:///tmp/x",
      "https://user:pass@example.test/",
      "https://example.test/\nmalicious",
      "https://",
      5,
    ])
      expect(safeSecurityUrl(value)).toBe("");
  });

  it("redacts closed, malformed, and unclosed security fences", () => {
    const source = [
      "Before",
      "```aic",
      "current-secret",
      "```",
      "```aic-security",
      "not valid yaml: test-secret-one",
      "```",
      "Between",
      "~~~aic-security extra-info",
      "test-secret-two",
      "~~~~",
      "After",
      "```js",
      "const label = 'aic-security';",
      "```",
    ].join("\r\n");
    expect(redactSecurityBlocks(source)).toBe(
      [
        "Before",
        "Between",
        "After",
        "```js",
        "const label = 'aic-security';",
        "```",
      ].join("\r\n"),
    );
    expect(
      redactSecurityBlocks(
        "Visible\n```aic-security\nnever-closed-test-secret\nnext",
      ),
    ).toBe("Visible\n");
    expect(
      redactSecurityBlocks("```aic v3\nunsupported-secret\n```\nEnd"),
    ).toBe("End");
    expect(
      redactSecurityBlocks("```markdown\n```aic-security\nexample only\n```\n"),
    ).toBe("```markdown\n```aic-security\nexample only\n```\n");
  });

  it("redacts fences in Markdown containers without mistaking nested quotes for their close", () => {
    for (const [open, prefix, close] of [
      ["> ```aic-security", "> ", "> ```"],
      ["- ```aic-security", "  ", "  ```"],
      ["> 1. > ~~~aic-security", ">    > ", ">    > ~~~"],
    ]) {
      const source = [
        "Before",
        open,
        prefix + "## Main",
        prefix + "Password*: secret-value",
        close,
        "After",
      ].join("\n");
      expect(redactSecurityBlocks(source)).toBe("Before\nAfter");
    }
    expect(
      redactSecurityBlocks(
        "```aic-security\n> ```\nPassword*: secret-value\n```\nAfter",
      ),
    ).toBe("After");
    expect(
      redactSecurityBlocks(
        "```aic-security\n- ```\nPassword*: secret-value\n```\nAfter",
      ),
    ).toBe("After");
    expect(
      redactSecurityBlocks(
        "```aic-security\n    ```\nPassword*: secret-value\n```\nAfter",
      ),
    ).toBe("After");
  });

  it("does not let ended containers or invalid code-fence info suppress redaction", () => {
    for (const prefix of [
      "> ```text\n> example\n",
      "- ```text\n  example\n",
      "```not`a-fence\n",
    ]) {
      const result = redactSecurityBlocks(
        prefix +
          "```aic-security\n## Main\nPassword*: secret-value\n```\nAfter",
      );
      expect(result).not.toContain("secret-value");
      expect(result).toContain("After");
    }
  });
});

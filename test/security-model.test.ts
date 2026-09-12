import { describe, expect, it } from "vitest";
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
  it("creates a fenced base template with explicit visibility", () => {
    const template = securityTemplate();
    expect(template).toBe(
      [
        "```aic-security",
        "##",
        "Service:",
        "Account:",
        "Email:",
        "URL:",
        "TOTP*:",
        "Password*:",
        "```",
      ].join("\n"),
    );
    expect(
      parseSecurityBlock(template.slice("```aic-security\n".length, -3)),
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
              { label: "TOTP", value: "", hide: true },
              { label: "Password", value: "", hide: true },
            ],
          },
        ],
      },
    });
  });

  it("round-trips an optional title without permissive fallback to legacy YAML", () => {
    const unnamed: SecurityModel = {
      sections: [
        {
          label: "",
          fields: [{ label: "Password", value: "synthetic", hide: true }],
        },
      ],
    };
    expect(serializeSecurityBlock(unnamed)).toBe("##\nPassword*: synthetic\n");
    expect(parseSecurityBlock(serializeSecurityBlock(unnamed))).toEqual({
      ok: true,
      model: unnamed,
    });
    expect(parseSecurityBlock("Password*: synthetic")).toEqual(invalid);
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

  it("escapes backslash, multiline legacy values, controls, and fences while preserving spaces", () => {
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
      "",
      "## Main\nPassword:value",
      "## Main\nPassword**: value",
      "## Main\n: value",
      "## Main\nField: bad\\escape",
      "## Main\nField: bad\\u00xx",
      "## Main\nField: literal\tcontrol",
      "## Main\nField: ok\nextra",
      "## Main\n## ",
      "## Main\nA: one\n```",
      "x".repeat(64 * 1024 + 1),
      "service: secret\nservice: duplicate\nlogin: x\nannotation: x\nfields: []",
      "service: &shared secret\nlogin: *shared\nannotation: x\nfields: []",
      "service: !custom secret\nlogin: x\nannotation: x\nfields: []",
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

  it("migrates oldest and interim YAML, inferring hiding only there", () => {
    const oldest = [
      "service: Example",
      "login: alice",
      "annotation: two lines",
      "fields:",
      "  - label: Password",
      "    type: text",
      "    value: visible-in-yaml",
      "  - label: Custom",
      "    type: secret",
      "    value: hidden-in-yaml",
      "  - label: Recovery hint",
      "    type: text",
      "    value: hint",
    ].join("\n");
    const parsed = parseSecurityBlock(oldest);
    expect(parsed).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "Main",
            fields: [
              { label: "Service", value: "Example", hide: false },
              { label: "Account", value: "alice", hide: false },
              { label: "Annotation", value: "two lines", hide: false },
              { label: "Password", value: "visible-in-yaml", hide: true },
              { label: "Custom", value: "hidden-in-yaml", hide: true },
              { label: "Recovery hint", value: "hint", hide: false },
            ],
          },
        ],
      },
    });
    const interim = [
      "sections:",
      "  - label: PSP",
      "    service: Example",
      "    account: alice",
      "    email: alice@example.test",
      "    url: https://example.test",
      "    annotation: ''",
      "    fields:",
      "      - label: TOTP",
      "        type: totp",
      "        value: TESTKEY",
    ].join("\n");
    expect(parseSecurityBlock(interim)).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "PSP",
            fields: [
              { label: "Service", value: "Example", hide: false },
              { label: "Account", value: "alice", hide: false },
              { label: "Email", value: "alice@example.test", hide: false },
              { label: "URL", value: "https://example.test", hide: false },
              { label: "TOTP", value: "TESTKEY", hide: true },
            ],
          },
        ],
      },
    });
    if (parsed.ok)
      expect(parseSecurityBlock(serializeSecurityBlock(parsed.model))).toEqual(
        parsed,
      );
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

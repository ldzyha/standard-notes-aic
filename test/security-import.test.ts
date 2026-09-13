import { describe, expect, it } from "vitest";
import { convertAuthenticatorJson } from "../src/core/security-import.js";
import { parseSecurityBlock } from "../src/core/security-model.js";
import {
  SECURITY_FIELD_OPTIONS,
  SECURITY_FENCE_INFO,
} from "../src/core/field-syntax.js";

type Entry = Record<string, unknown>;

function convert(entries: Entry[]) {
  return convertAuthenticatorJson(JSON.stringify(entries));
}

function models(markdown: string) {
  return markdown.split("\n\n").map((block) => {
    expect(block.startsWith(`\`\`\`${SECURITY_FENCE_INFO}\n`)).toBe(true);
    expect(block.endsWith("\n```")).toBe(true);
    const body = block.slice(`\`\`\`${SECURITY_FENCE_INFO}\n`.length, -3);
    const parsed = parseSecurityBlock(body, SECURITY_FIELD_OPTIONS);
    expect(parsed.ok).toBe(true);
    return parsed.ok ? parsed.model : null;
  });
}

describe("Authenticator JSON import", () => {
  it("packs separate accounts as ordered, untitled v3 sections without combining duplicates", () => {
    const entries = [
      { service: "Example", account: "alice", secret: "JBSWY3DP" },
      { service: "Example", account: "alice", secret: "MZXW6YTB" },
    ];
    const result = convert(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(1);
    expect(result.blockCount).toBe(1);
    expect(result.accountCount).toBe(2);
    expect(result.markdown.match(/^---$/gmu)).toHaveLength(1);
    expect(models(result.markdown)).toEqual([
      {
        sections: entries.map((entry) => ({
          label: "",
          fields: [
            { label: "Service", value: entry.service, hide: false },
            { label: "Account", value: entry.account, hide: false },
            { label: "TOTP", value: entry.secret, hide: true, kind: "totp" },
          ],
        })),
      },
    ]);
  });

  it("starts a second block after sixteen account sections", () => {
    const entries = Array.from({ length: 17 }, (_, index) => ({
      service: `Service ${index}`,
      account: `account-${index}`,
      secret: `KEY${index}`,
    }));
    const result = convert(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.accountCount, result.blockCount, result.count]).toEqual([
      17, 2, 2,
    ]);
    const parsed = models(result.markdown);
    expect(parsed.map((model) => model!.sections.length)).toEqual([16, 1]);
    expect(
      parsed
        .flatMap((model) => model!.sections)
        .map((section) => section.fields[0]!.value),
    ).toEqual(entries.map((entry) => entry.service));
  });

  it("splits by encoded body size and keeps every value losslessly", () => {
    const secret = "\u0001".repeat(1500);
    const entries = Array.from({ length: 8 }, (_, index) => ({
      service: `S${index}`,
      account: `A${index}`,
      secret,
    }));
    const result = convert(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blockCount).toBeGreaterThan(1);
    expect(
      models(result.markdown)
        .flatMap((model) => model!.sections)
        .map((section) => section.fields[2]!.value),
    ).toEqual(entries.map((entry) => entry.secret));
    const failure = convert([
      { service: "S", account: "A", secret: "PRIVATE".repeat(3000) },
    ]);
    expect(failure).toEqual({ ok: false, code: "too_large" });
    expect(JSON.stringify(failure)).not.toContain("PRIVATE");
  });

  it("keeps Service intact and adds an Open-compatible URL for direct and Markdown links", () => {
    const services = [
      "https://example.test/login",
      "[Example](https://example.test/login)",
      "[Bad](javascript:alert(1))",
      "https://user:pass@example.test/login",
    ];
    const result = convert(
      services.map((service) => ({ service, account: "a", secret: "s" })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = models(result.markdown);
    for (const [index, service] of services.entries()) {
      const fields = parsed[0]!.sections[index]!.fields;
      expect(fields[0]).toEqual({
        label: "Service",
        value: service,
        hide: false,
      });
      expect(fields.filter((field) => field.label === "URL")).toEqual(
        index < 2
          ? [{ label: "URL", value: "https://example.test/login", hide: false }]
          : [],
      );
    }
  });

  it("preserves optional blanks and unknown string fields as hidden", () => {
    const entry = {
      service: "S",
      account: "",
      secret: "not-normalized-\\@~",
      password: "",
      notes: "user note",
      issuer: "original issuer",
      "API Token": " private ",
    };
    const result = convert([entry]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(models(result.markdown)[0]!.sections[0]!.fields).toEqual([
      { label: "Service", value: "S", hide: false },
      { label: "Account", value: "", hide: false },
      { label: "TOTP", value: entry.secret, hide: true, kind: "totp" },
      { label: "Password", value: "", hide: true },
      { label: "Notes", value: "user note", hide: false },
      { label: "issuer", value: "original issuer", hide: true },
      { label: "API Token", value: " private ", hide: true },
    ]);
  });

  it("round-trips user pipes and backslashes without creating value parts", () => {
    const entry = {
      service: "Sample | C:\\apps",
      account: "name\\part|other",
      secret: "SYN|TH\\ETIC",
      password: "word | C:\\vault",
      notes: "left\\|right",
      custom: "one | two\\three",
    };
    const result = convert([entry]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fields = models(result.markdown)[0]!.sections[0]!.fields;
    expect(fields.map((field) => field.value)).toEqual(Object.values(entry));
    expect(fields.every((field) => !Object.hasOwn(field, "description"))).toBe(
      true,
    );
    expect(fields[2]!.kind).toBe("totp");
  });

  it("sanitizes typed marker suffixes without changing field kinds", () => {
    const result = convert([
      {
        service: "S",
        account: "A",
        secret: "K",
        "backup#": "first",
        ending_: "second",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(models(result.markdown)[0]!.sections[0]!.fields.slice(3)).toEqual([
      { label: "backup# (imported)", value: "first", hide: true },
      { label: "ending_ (imported)", value: "second", hide: true },
    ]);
  });

  it("accepts only a bare array or one complete JSON fence, without repairing JSON escapes", () => {
    const entry = [{ service: "S", account: "A", secret: "K" }];
    const bare = JSON.stringify(entry);
    expect(convertAuthenticatorJson(`\uFEFF \n${bare}\n`).ok).toBe(true);
    expect(
      convertAuthenticatorJson(`\uFEFF\n\`\`\`json\n${bare}\n\`\`\`\n`).ok,
    ).toBe(true);
    expect(convertAuthenticatorJson(`~~~JSON\r\n${bare}\r\n~~~`).ok).toBe(true);
    for (const source of [
      `prefix\n${bare}`,
      `\`\`\`json\n${bare}\n\`\`\`\ntrailing`,
      `\`\`\`json\n${bare}\n~~~`,
      '[{"service":"S","account":"A","secret":"\\@"}]',
      '[{"service":"S","account":"A","secret":"\\~"}]',
    ])
      expect(convertAuthenticatorJson(source)).toEqual({
        ok: false,
        code: "invalid_json",
      });
  });

  it("rejects an invalid middle entry without returning partial Markdown or secrets", () => {
    const source = JSON.stringify([
      { service: "S", account: "A", secret: "sensitive-one" },
      { service: "S", account: "A", secret: 123 },
      { service: "S", account: "A", secret: "sensitive-three" },
    ]);
    const result = convertAuthenticatorJson(source);
    expect(result).toEqual({ ok: false, code: "unsupported_authenticator" });
    expect(JSON.stringify(result)).not.toMatch(/sensitive/u);
  });

  it("rejects duplicate JSON keys including escaped-equivalent keys", () => {
    for (const source of [
      '[{"service":"S","service":"T","account":"A","secret":"K"}]',
      '[{"service":"S","\\u0073ervice":"T","account":"A","secret":"K"}]',
    ])
      expect(convertAuthenticatorJson(source)).toEqual({
        ok: false,
        code: "invalid_json",
      });
  });

  it("enforces array, entry, field, and source limits", () => {
    expect(convertAuthenticatorJson("[]")).toEqual({
      ok: false,
      code: "unsupported_authenticator",
    });
    expect(convertAuthenticatorJson("{}")).toEqual({
      ok: false,
      code: "unsupported_authenticator",
    });
    expect(convertAuthenticatorJson("x".repeat(1024 * 1024 + 1))).toEqual({
      ok: false,
      code: "too_large",
    });
    expect(convertAuthenticatorJson("é".repeat(600_000))).toEqual({
      ok: false,
      code: "too_large",
    });
    expect(
      convert(
        Array.from({ length: 257 }, () => ({
          service: "S",
          account: "A",
          secret: "K",
        })),
      ),
    ).toEqual({ ok: false, code: "too_large" });
    expect(
      convert([
        {
          service: "S",
          account: "A",
          secret: "K",
          x: "z".repeat(16 * 1024 + 1),
        },
      ]),
    ).toEqual({ ok: false, code: "too_large" });
    const manyFields = convert([
      {
        service: "S",
        account: "A",
        secret: "K",
        ...Object.fromEntries(
          Array.from({ length: 62 }, (_, i) => [`key${i}`, "v"]),
        ),
      },
    ]);
    expect(manyFields.ok).toBe(true);
    if (manyFields.ok) {
      const packed = models(manyFields.markdown);
      expect(
        packed
          .flatMap((model) => model!.sections)
          .map((section) => section.fields.length),
      ).toEqual([64, 1]);
      expect(
        packed
          .flatMap((model) => model!.sections)
          .flatMap((section) => section.fields),
      ).toHaveLength(65);
    }
    expect(
      convert([
        { service: "S", account: "A", secret: "K", x: "\u0001".repeat(11000) },
      ]),
    ).toEqual({ ok: false, code: "too_large" });
  });

  it("rejects unsupported values, keys, and prototype names", () => {
    for (const entry of [
      { service: "S", account: "A" },
      { service: "S", account: "A", secret: "K", notes: null },
      { service: "S", account: "A", secret: "K", count: 1 },
      { service: "S", account: "A", secret: "K", "bad:key": "v" },
      { service: "S", account: "A", secret: "K", " bad": "v" },
      { service: "S", account: "A", secret: "K", "## backup": "v" },
    ])
      expect(convert([entry])).toEqual({
        ok: false,
        code: "unsupported_authenticator",
      });
    expect(
      convertAuthenticatorJson(
        '[{"service":"S","account":"A","secret":"K","__proto__":"v"}]',
      ),
    ).toEqual({ ok: false, code: "unsupported_authenticator" });
  });

  it("escapes controls and fence-shaped values, and rejects serializer-lossy scalars", () => {
    const secret = " start\\@~\n```\r\t\u0000\u2028end ";
    const result = convert([{ service: "S", account: "A", secret }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.match(/^```$/gmu)).toHaveLength(1);
    expect(models(result.markdown)[0]!.sections[0]!.fields[2]!.value).toBe(
      secret,
    );
    expect(
      convert([{ service: "S", account: "A", secret: "K\u{E0001}" }]),
    ).toEqual({ ok: false, code: "unsupported_authenticator" });
  });
});

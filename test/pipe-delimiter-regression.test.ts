import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makePropertiesBlockExtension,
  makeSecurityBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";
import { convertAuthenticatorJson } from "../src/core/security-import.js";
import {
  parseSecurityBlock,
  serializeSecurityBlock,
} from "../src/core/security-model.js";

const views: EditorView[] = [];

function securityField(body: string) {
  const result = parseSecurityBlock(body);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic aic fixture did not parse");
  return result.model.sections[0]!.fields[0]!;
}

function fixture(doc: string, clipboard = "synthetic | pasted") {
  const host = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn(() => true);
  const onReadClipboard = vi.fn(async () => clipboard);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        aicMarkdownLanguage(),
        makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
        makePropertiesBlockExtension({ document, onCopy, onReadClipboard }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy };
}

function button(host: ParentNode, label: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(found, label).not.toBeNull();
  return found!;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("typed pipe boundaries and quoted values", () => {
  it.each([
    ['"a|b"', "a|b"],
    ['"a |b"', "a |b"],
    ['"a| b"', "a| b"],
    ['"a | b"', "a | b"],
    ['"a\\"b\\\\c"', 'a"b\\c'],
    ['"line\\nnext"', "line\nnext"],
  ])("keeps a quoted pipe-bearing value for %s", (source, value) => {
    const parsed = parseSecurityBlock(`Password *| ${source}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.sections[0]!.fields[0]).toEqual({
      label: "Password",
      parts: [{ value, kind: "secret" }],
    });
    expect(parseSecurityBlock(serializeSecurityBlock(parsed.model))).toEqual(
      parsed,
    );
  });

  it("treats unquoted pipes as explicit independent text parts", () => {
    expect(securityField("Password *| a|b").parts).toEqual([
      { value: "a", kind: "secret" },
      { value: "b", kind: "text" },
    ]);
  });

  it("round-trips every typed marker, empty cells and significant spaces", () => {
    const body =
      'Mixed | " public " *| "secret | value" #| JBSWY3DPEHPK3PXP _| 4111111111111111 1| once 0| used';
    const field = securityField(body);
    expect(field.parts).toEqual([
      { value: " public ", kind: "text" },
      { value: "secret | value", kind: "secret" },
      { value: "JBSWY3DPEHPK3PXP", kind: "totp" },
      { value: "4111111111111111", kind: "card" },
      { value: "once", kind: "one-time" },
      { value: "used", kind: "used" },
    ]);
    expect(
      parseSecurityBlock(
        serializeSecurityBlock({ sections: [{ label: "", fields: [field] }] }),
      ),
    ).toEqual(
      parseSecurityBlock(
        serializeSecurityBlock({ sections: [{ label: "", fields: [field] }] }),
      ),
    );
  });

  it("locates malformed quotes without returning authored values", () => {
    for (const [body, needle] of [
      ['Password *| "synthetic-private', '"synthetic-private'],
      ['Password *| "synthetic-private"junk', "junk"],
    ] as const) {
      const parsed = parseSecurityBlock(body, { diagnostics: true });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.diagnostic.from).toBe(body.indexOf(needle));
      expect(JSON.stringify(parsed.diagnostic)).not.toContain(
        "synthetic-private",
      );
    }
  });

  it("imports pipe-bearing passwords as one secret part", () => {
    const passwords = ["a|b", "a |b", "a| b", "a | b", 'a"b\\c'];
    const result = convertAuthenticatorJson(
      JSON.stringify(
        passwords.map((password, index) => ({
          service: `Fixture ${index}`,
          account: `account-${index}`,
          secret: `KEY${index}`,
          password,
        })),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.markdown.slice("```aic\n".length, -"\n```".length);
    const parsed = parseSecurityBlock(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.model.sections.map(
        (section) =>
          section.fields.find((field) => field.label === "Password")?.parts[0]
            ?.value,
      ),
    ).toEqual(passwords);
  });

  it("keeps retired YAML quoted values opaque and unchanged", () => {
    const doc =
      "---\n# aic-fields: v2\nPassword*: 'synthetic | public | hidden'\n---\nBody";
    const { host, view } = fixture(doc);
    expect(host.textContent).toContain("no longer supported");
    expect(host.innerHTML).not.toContain("synthetic");
    expect(host.querySelector('[aria-label^="Paste Password"]')).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("copies dequoted peer parts, pastes a pipe-bearing secret, and reopens masked", async () => {
    const doc =
      '```aic\nPassword *| "synthetic | value" | "public | hint" *|\n```\n\nEnd';
    const { host, view, onCopy } = fixture(doc);
    expect(host.innerHTML).not.toContain("synthetic | value");
    button(host, "Copy Password secret 1").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "synthetic | value",
      "Password secret 1",
    );
    button(host, "Copy Password text 2").click();
    expect(onCopy).toHaveBeenLastCalledWith("public | hint", "Password text 2");
    button(host, "Paste Password secret 3").click();
    await vi.waitFor(() => {
      const block = securityBlocks(view.state)[0]!;
      expect(securityField(block.body).parts[2]!.value).toBe(
        "synthetic | pasted",
      );
    });
    const reopened = fixture(view.state.doc.toString());
    expect(reopened.host.innerHTML).not.toContain("synthetic | pasted");
    button(reopened.host, "Copy Password secret 3").click();
    expect(reopened.onCopy).toHaveBeenLastCalledWith(
      "synthetic | pasted",
      "Password secret 3",
    );
  });
});

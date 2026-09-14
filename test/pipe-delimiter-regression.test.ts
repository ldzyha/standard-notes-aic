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
import {
  parsePropertiesBody,
  serializePropertiesBody,
} from "../src/core/properties-model.js";

const views: EditorView[] = [];
const propertiesOptions = { fieldSyntax: "pipes" } as const;

function securityField(body: string) {
  const result = parseSecurityBlock(body);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic Security fixture did not parse");
  return result.model.sections[0]!.fields[0]!;
}

function propertiesField(body: string) {
  const result = parsePropertiesBody(body, propertiesOptions);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic Properties fixture did not parse");
  return result.model.sections[1]!.fields[0]!;
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
  return { host, view, onCopy, onReadClipboard };
}

function button(host: ParentNode, label: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(found, label).not.toBeNull();
  return found!;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("pipe boundaries and quoted value slots", () => {
  it.each([
    ["a|b", "a|b"],
    ["a |b", "a |b"],
    ["a| b", "a| b"],
    [String.raw`a\|b`, "a|b"],
    ['"a | b"', "a | b"],
    [String.raw`"a\"b\\c"`, 'a"b\\c'],
    [String.raw`"line\nnext"`, "line\nnext"],
  ])("keeps a single Security value for %s", (source, value) => {
    const parsed = parseSecurityBlock(`Password*: ${source}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.sections[0]!.fields[0]).toEqual({
      label: "Password",
      value,
      hide: true,
    });
    const serialized = serializeSecurityBlock(parsed.model);
    expect(parseSecurityBlock(serialized)).toEqual(parsed);
  });

  it("round-trips three quoted slots, empty slots and extra delimiter-adjacent spaces", () => {
    const bodies = [
      'Password*: "  synthetic | value  " | "public | hint" | "private | part"',
      'Password*: "synthetic | value" | "" | ""',
      "Password*: synthetic  |  public | private",
    ];
    const expected = [
      {
        value: "  synthetic | value  ",
        description: "public | hint",
        additionalSecret: "private | part",
      },
      { value: "synthetic | value", description: "", additionalSecret: "" },
      {
        value: "synthetic ",
        description: " public",
        additionalSecret: "private",
      },
    ];
    for (const [index, body] of bodies.entries()) {
      const parsed = parseSecurityBlock(body);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.model.sections[0]!.fields[0]).toMatchObject(
        expected[index]!,
      );
      expect(parseSecurityBlock(serializeSecurityBlock(parsed.model))).toEqual(
        parsed,
      );
    }
  });

  it("locates unclosed quotes and junk after a quote without returning authored values", () => {
    for (const [body, needle] of [
      ['Password*: a|b | "synthetic-private', '"synthetic-private'],
      ['Password*: "synthetic-private"junk', "junk"],
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

  it("imports passwords containing bare, one-sided, and delimiter-shaped pipes intact", () => {
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
    const block = result.markdown;
    expect(block.startsWith("```aic\n")).toBe(true);
    const body = block.slice("```aic\n".length, -"\n```".length);
    const parsed = parseSecurityBlock(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.model.sections.map(
        (section) =>
          section.fields.find((field) => field.label === "Password")?.value,
      ),
    ).toEqual(passwords);
  });

  it("parses quoted slots inside activated Properties YAML and fills an empty slot", () => {
    const body =
      '# aic-fields: v2\nPassword*: \'"a | b" | "public | hint" | ""\'\n';
    const parsed = parsePropertiesBody(body);
    expect(parsed.ok).toBe(true);
    expect(propertiesField(body)).toMatchObject({
      value: "a | b",
      description: "public | hint",
      additionalSecret: "",
      hide: true,
    });
    if (!parsed.ok) return;
    const updated = {
      ...parsed.model,
      sections: parsed.model.sections.map((section, sectionIndex) => ({
        ...section,
        fields: section.fields.map((field, fieldIndex) =>
          sectionIndex === 1 && fieldIndex === 0
            ? { ...field, additionalSecret: "synthetic | filled" }
            : field,
        ),
      })),
    };
    const saved = serializePropertiesBody(updated, body, propertiesOptions);
    expect(propertiesField(saved)).toMatchObject({
      value: "a | b",
      description: "public | hint",
      additionalSecret: "synthetic | filled",
    });
    expect(saved).toContain("# aic-fields: v2");
  });

  it("copies dequoted Security values, pastes a pipe-bearing secret and reopens it hidden", async () => {
    const doc =
      '```aic\nPassword*: "synthetic | value" | "public | hint" | ""\n```\n\nEnd';
    const { host, view, onCopy } = fixture(doc);
    expect(host.innerHTML).not.toContain("synthetic | value");
    button(host, "Copy Password value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "synthetic | value",
      "Password Value",
    );
    button(host, "Copy Password description value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "public | hint",
      "Password Description",
    );
    button(host, "Paste Password additional secret").click();
    await vi.waitFor(() => {
      const block = securityBlocks(view.state)[0]!;
      expect(securityField(block.body).additionalSecret).toBe(
        "synthetic | pasted",
      );
    });
    const saved = view.state.doc.toString();
    const reopened = fixture(saved);
    expect(reopened.host.innerHTML).not.toContain("synthetic | pasted");
    button(reopened.host, "Copy Password additional secret value").click();
    expect(reopened.onCopy).toHaveBeenLastCalledWith(
      "synthetic | pasted",
      "Password Additional secret",
    );
  });
});

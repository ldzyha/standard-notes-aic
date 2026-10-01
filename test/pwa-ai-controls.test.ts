import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history, undo } from "@codemirror/commands";
import { Compartment, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { AicEditor } from "../src/editor";
import { attachLocalAI, type LocalAIControls } from "../src/pwa/ai-controls";

let view: EditorView;
let controls: LocalAIControls;
let identity: string;
let readonly: boolean;
let notices: string[];
let transactions: Transaction[];
let destroy: ReturnType<typeof vi.fn>;
const readonlyCompartment = new Compartment();

function button(label: string): HTMLButtonElement {
  const result = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!result) throw new Error(`Missing AI action ${label}`);
  return result;
}
function installModel(reply = (text: string) => text.replace("I is", "I am")) {
  destroy = vi.fn();
  const prompt = vi.fn(async (input: string) =>
    JSON.stringify({ text: reply(JSON.parse(input).text), notes: [] }),
  );
  const create = vi.fn(async () => ({ destroy, prompt }));
  vi.stubGlobal("LanguageModel", {
    availability: async () => "available",
    create,
  });
  return { create, prompt };
}
async function suggestion(action = "Fix grammar locally") {
  button(action).click();
  await vi.waitFor(() =>
    expect(document.querySelector("dialog")).not.toBeNull(),
  );
}

beforeEach(() => {
  document.body.innerHTML =
    '<main id="controls"></main><div id="editor"></div>';
  identity = "synthetic-entity/note";
  readonly = false;
  notices = [];
  transactions = [];
  view = new EditorView({
    parent: document.querySelector("#editor")!,
    state: EditorState.create({
      doc: "I is writing a note. And this stays.",
      extensions: [
        history(),
        readonlyCompartment.of(EditorState.readOnly.of(false)),
      ],
    }),
    dispatch(transaction) {
      transactions.push(transaction);
      view.update([transaction]);
    },
  });
  installModel();
  controls = attachLocalAI(document.querySelector("#controls")!, {
    editor: { view } as unknown as AicEditor,
    identity: () => identity,
    isReadonly: () => readonly,
    onNotice: (message) => notices.push(message),
  });
});
afterEach(() => {
  controls.dispose();
  view.destroy();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("local AI controls and existing editor authority", () => {
  it("only checks readiness initially; model setup waits for an explicit AI action", async () => {
    const api = installModel();
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
        "Local AI ready",
      ),
    );
    expect(api.create).not.toHaveBeenCalled();
    await suggestion();
    expect(api.create).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("previews safely, applies one isolated user transaction and restores it with editor Undo", async () => {
    const original = view.state.doc.toString();
    await suggestion();
    expect(view.state.doc.toString()).toBe(original);
    expect(document.querySelector("pre")?.textContent).toBe(
      original.replace("I is", "I am"),
    );
    button("Apply local AI suggestion").click();
    expect(view.state.doc.toString()).toBe(original.replace("I is", "I am"));
    expect(document.querySelector("dialog")).toBeNull();
    expect(
      transactions.filter((transaction) => transaction.docChanged),
    ).toHaveLength(1);
    expect(transactions[0]?.isUserEvent("input.aic-local-ai")).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("targets one selected passage and preserves surrounding text", async () => {
    view.dispatch({ selection: { anchor: 0, head: 20 } });
    await suggestion("Improve prose locally");
    expect(document.querySelector("pre")?.textContent).toBe(
      "I am writing a note.",
    );
    button("Apply local AI suggestion").click();
    expect(view.state.doc.toString()).toBe(
      "I am writing a note. And this stays.",
    );
  });

  it.each(["text", "identity", "selection", "readonly"])(
    "rejects a stale preview after %s changes",
    async (changed) => {
      await suggestion();
      if (changed === "text")
        view.dispatch({ changes: { from: 0, to: 1, insert: "Manual" } });
      if (changed === "identity") identity = "different-entity/note";
      if (changed === "selection") view.dispatch({ selection: { anchor: 2 } });
      if (changed === "readonly") readonly = true;
      const original = view.state.doc.toString();
      button("Apply local AI suggestion").click();
      expect(view.state.doc.toString()).toBe(original);
      expect(document.querySelector("dialog")).toBeNull();
      expect(notices.at(-1)).toContain("changed");
    },
  );

  it("refuses an action while the host or editor is readonly", () => {
    const api = installModel();
    readonly = true;
    button("Improve prose locally").click();
    readonly = false;
    view.dispatch({
      effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(true)),
    });
    button("Fix grammar locally").click();
    expect(api.create).not.toHaveBeenCalled();
    expect(notices).toEqual([
      "Unlock an editable note to use local AI.",
      "Unlock an editable note to use local AI.",
    ]);
  });

  it("rejects selecting part of an AIC secret fence", () => {
    const api = installModel();
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert:
          "Prose\n\n```aic\nSecret | password: synthetic confidential value\n```",
      },
      selection: { anchor: 34, head: 44 },
    });
    button("Improve prose locally").click();
    expect(api.create).not.toHaveBeenCalled();
    expect(notices.at(-1)).toContain("outside protected");
  });

  it.each([
    "https://example.test/private",
    "www.example.test/private",
    "synthetic.person@example.test",
    "<synthetic.person@example.test>",
  ])("rejects a partial selection inside GFM destination %s", (destination) => {
    const api = installModel();
    const original = `Prose around ${destination} stays.`;
    const start = original.indexOf(destination) + 3;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: original },
      selection: { anchor: start, head: start + 5 },
    });
    button("Improve prose locally").click();
    expect(api.create).not.toHaveBeenCalled();
    expect(notices.at(-1)).toContain("outside protected");
    expect(view.state.doc.toString()).toBe(original);
  });

  it("rejects selecting a secret in BOM-prefixed legacy Properties", () => {
    const api = installModel();
    const original = "\uFEFF---\nsecret: synthetic-password\n---\n\nProse.";
    const start = original.indexOf("synthetic-password");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: original },
      selection: { anchor: start, head: start + 5 },
    });
    button("Improve prose locally").click();
    expect(api.create).not.toHaveBeenCalled();
    expect(notices.at(-1)).toContain("outside protected");
    expect(view.state.doc.toString()).toBe(original);
  });

  it("discards a preview and scrubs its decrypted DOM", async () => {
    await suggestion();
    button("Discard local AI suggestion").click();
    expect(document.querySelector("dialog")).toBeNull();
    await suggestion();
    controls.dispose();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.querySelector(".aic-local-ai")).toBeNull();
    expect(document.querySelector("#controls")?.textContent).toBe("");
  });

  it("disposes on pagehide and prevents a late cancelled result from recreating DOM", async () => {
    let release: (result: string) => void = () => {};
    const create = vi.fn(async () => ({
      destroy,
      prompt: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    }));
    vi.stubGlobal("LanguageModel", {
      availability: async () => "available",
      create,
    });
    button("Fix grammar locally").click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("pagehide"));
    release(JSON.stringify({ text: "Late confidential reply", notes: [] }));
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.querySelector(".aic-local-ai")).toBeNull();
    expect(document.body.textContent).not.toContain("Late confidential reply");
    expect(view.state.doc.toString()).toBe(
      "I is writing a note. And this stays.",
    );
  });

  it("cancels ongoing inference and preserves the note", async () => {
    let release: (result: string) => void = () => {};
    vi.stubGlobal("LanguageModel", {
      create: async () => ({
        destroy,
        prompt: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      }),
    });
    button("Improve prose locally").click();
    await vi.waitFor(() =>
      expect(button("Cancel local AI").hidden).toBe(false),
    );
    await Promise.resolve();
    button("Cancel local AI").click();
    release(JSON.stringify({ text: "Late reply", notes: [] }));
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    expect(document.querySelector("dialog")).toBeNull();
    expect(view.state.doc.toString()).toBe(
      "I is writing a note. And this stays.",
    );
  });

  it("shows unavailable AI without changing or disabling offline editing", async () => {
    controls.dispose();
    vi.stubGlobal("LanguageModel", undefined);
    controls = attachLocalAI(document.querySelector("#controls")!, {
      editor: { view } as unknown as AicEditor,
      identity: () => identity,
      isReadonly: () => false,
      onNotice: (message) => notices.push(message),
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
        "editing works offline",
      ),
    );
    button("Fix grammar locally").click();
    await vi.waitFor(() =>
      expect(notices.at(-1)).toContain("Editing still works offline"),
    );
    view.dispatch({ changes: { from: 0, insert: "Manual offline edit. " } });
    expect(view.state.doc.toString()).toContain("Manual offline edit.");
  });

  it("renders model output as literal text without interpreting HTML", async () => {
    installModel(() => 'New prose <img src=x onerror="alert(1)">');
    button("Improve prose locally").click();
    await vi.waitFor(() => expect(notices.at(-1)).toContain("protected code"));
    expect(document.querySelector("dialog img")).toBeNull();
    expect(view.state.doc.toString()).toBe(
      "I is writing a note. And this stays.",
    );
  });
  it("hides compact AI until availability and never mounts unsupported status in the writing toolbar", async () => {
    controls.dispose();
    vi.stubGlobal("LanguageModel", undefined);
    controls = attachLocalAI(document.querySelector("#controls")!, {
      compact: true,
      editor: { view } as unknown as AicEditor,
      identity: () => identity,
      isReadonly: () => readonly,
      onNotice: (message) => notices.push(message),
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector(".aic-local-ai__status")?.textContent,
      ).toContain("unavailable"),
    );
    expect(document.querySelector<HTMLElement>(".aic-local-ai")!.hidden).toBe(
      true,
    );
    controls.dispose();
    installModel();
    controls = attachLocalAI(document.querySelector("#controls")!, {
      compact: true,
      editor: { view } as unknown as AicEditor,
      identity: () => identity,
      isReadonly: () => readonly,
      onNotice: (message) => notices.push(message),
    });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>(".aic-local-ai")!.hidden).toBe(
        false,
      ),
    );
  });
});

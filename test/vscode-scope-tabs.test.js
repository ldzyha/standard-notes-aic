import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
// Exercise the actual VS Code webview entrypoint, rather than a copied helper.
const vsRoot = resolve(process.cwd(), "../aic-notes");
// Build in Node's own realm: jsdom's Uint8Array must not enter esbuild's IPC.
const crossRepoAvailable =
  existsSync(resolve(vsRoot, "src/webview/main.js")) &&
  existsSync(resolve(vsRoot, "node_modules/esbuild"));
const bundleText = crossRepoAvailable
  ? execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
  import {createRequire} from "node:module";
  const {build}=createRequire(${JSON.stringify(resolve(vsRoot, "package.json"))})("esbuild");
  const result=await build({stdin:{contents:"import {EditorView} from '@codemirror/view'; import './src/webview/main.js'; window.__findEditor=EditorView.findFromDOM;",resolveDir:${JSON.stringify(vsRoot)},sourcefile:"scope-integration.js"},bundle:true,platform:"browser",format:"iife",write:false,loader:{".css":"text"},define:{"import.meta.url":JSON.stringify("https://synthetic.invalid/webview.js")},logLevel:"silent"});
  process.stdout.write(result.outputFiles[0].text);
`,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    )
  : "";
const doms = [];
function mount(secondary = true) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body class="aic-secondary-surface"><main><section id="scope-current"><div id="editor"></div></section><section id="scope-shared"></section><section id="scope-global"></section></main><footer id="pane-status"></footer></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      url: "https://synthetic.invalid/",
    },
  );
  if (!secondary)
    dom.window.document.body.classList.remove("aic-secondary-surface");
  doms.push(dom);
  const win = dom.window;
  Object.defineProperty(win, "matchMedia", {
    value: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  Object.defineProperty(win.Range.prototype, "getClientRects", {
    value: () => [],
  });
  Object.defineProperty(win.Range.prototype, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }),
  });
  const messages = [];
  let savedState;
  let fail = false;
  const send = (data) =>
    win.dispatchEvent(new win.MessageEvent("message", { data }));
  Object.assign(win, {
    acquireVsCodeApi: () => ({
      getState: () => savedState,
      setState: (value) => {
        savedState = value;
      },
      postMessage: (message) => {
        messages.push(message);
        if (message.type === "commit" || message.type === "save")
          queueMicrotask(() =>
            send({
              ...message,
              type: message.type === "save" ? "primary.saved" : "committed",
              saved: !fail,
              generation: message.generation,
              text: message.text,
            }),
          );
      },
    }),
  });
  win.eval(bundleText);
  const scopes = [
    { relation: "current", path: "src/file.note.md", exists: true },
    { relation: "parent", path: "ancestor.note.md", exists: true, depth: 0 },
    { relation: "parent", path: "src.note.md", exists: true, depth: 1 },
    { relation: "project", path: "workspace.note.md", exists: true },
  ];
  const init = (
    path,
    text,
    selected = "current",
    generation = 1,
    rows = scopes,
  ) =>
    send({
      type: "init",
      relativePath: path,
      text,
      selectedScope: selected,
      generation,
      surface: "secondary",
      scopes: rows,
      relationships: rows,
      readOnly: false,
    });
  const tab = (label) =>
    win.document.querySelector(`[role=tab][aria-label="${label}"]`);
  const view = () => win.__findEditor(win.document.getElementById("editor"));
  return {
    dom,
    win,
    messages,
    send,
    init,
    tab,
    view,
    setFail: (value) => {
      fail = value;
    },
  };
}
afterEach(() => {
  for (const dom of doms.splice(0)) {
    dom.window.dispatchEvent(new dom.window.Event("unload"));
    dom.window.close();
  }
});
describe.skipIf(!crossRepoAvailable)(
  "actual VS Code scope webview messages",
  () => {
    it("keeps Shared/Global editor roots mounted, retains sameidentity init and restores Current selection/Undo", async () => {
      const h = mount();
      h.init("src/file.note.md", "Current");
      const current = h.view();
      current.dispatch({
        changes: { from: 7, insert: " edited" },
        selection: { anchor: 3 },
      });
      h.tab("Shared").click();
      await vi.waitFor(() =>
        expect(
          h.messages.some(
            (row) => row.type === "scope.select" && row.id === "shared",
          ),
        ).toBe(true),
      );
      expect(
        h.win.document.querySelector("[role=tab][aria-selected=true]")
          ?.textContent,
      ).toBe("Current");
      expect(h.messages.find((row) => row.type === "scope.select").path).toBe(
        "src.note.md",
      );
      h.init("src.note.md", "Shared", "shared", 2);
      expect(
        h.win.document.querySelector("#scope-shared #editor .cm-editor"),
      ).not.toBeNull();
      expect(h.view().state.doc.toString()).toBe("Shared");
      h.tab("Global").click();
      await vi.waitFor(() =>
        expect(
          h.messages.some(
            (row) => row.type === "scope.select" && row.id === "global",
          ),
        ).toBe(true),
      );
      h.init("workspace.note.md", "Global", "global", 3);
      expect(
        h.win.document.querySelector("#scope-global #editor .cm-editor"),
      ).not.toBeNull();
      h.tab("Current").click();
      await vi.waitFor(() =>
        expect(
          h.messages.some(
            (row) => row.type === "scope.select" && row.id === "current",
          ),
        ).toBe(true),
      );
      h.init("src/file.note.md", "Current edited", "current", 4);
      expect(h.view().state.selection.main.anchor).toBe(3);
      const restored = h.view();
      h.init("src/file.note.md", "Current edited", "current", 4);
      expect(h.view()).toBe(restored);
      restored.contentDOM.dispatchEvent(
        new h.win.KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(h.view().state.doc.toString()).toBe("Current");
    });
    it("retains failed live drafts and supplies disabled tabs to the shared primitive", async () => {
      const h = mount();
      h.init("src/file.note.md", "Current");
      const current = h.view();
      current.dispatch({ changes: { from: 7, insert: " recoverable" } });
      h.setFail(true);
      h.tab("Shared").click();
      await vi.waitFor(() =>
        expect(h.win.document.body.textContent).toContain("Save failed"),
      );
      expect(h.messages.some((row) => row.type === "scope.select")).toBe(false);
      expect(h.view()).toBe(current);
      h.init("src/file.note.md", "Current", "current", 2);
      expect(h.view()).toBe(current);
      expect(h.view().state.doc.toString()).toBe("Current recoverable");
      const other = mount();
      other.init("src/file.note.md", "Current", "current", 1, [
        { relation: "current", path: "src/file.note.md", exists: true },
        { relation: "parent", path: "src.note.md", exists: false },
        { relation: "project", path: "workspace.note.md", exists: true },
      ]);
      expect(other.tab("Shared").disabled).toBe(true);
      expect(other.tab("Shared").getAttribute("aria-disabled")).toBe("true");
      other.tab("Current").focus();
      other.tab("Current").dispatchEvent(
        new other.win.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
      expect(other.win.document.activeElement).toBe(other.tab("Global"));
    });
    it("retains the actual primary editor on visibility init, accepts explicit cached navigation selection and cleans up on unload", () => {
      const h = mount(false);
      h.init("src/file.note.md", "Current");
      const current = h.view();
      current.dispatch({ selection: { anchor: 3 } });
      h.init("src/file.note.md", "Current", "current", 2);
      expect(h.view()).toBe(current);
      expect(h.view().state.selection.main.anchor).toBe(3);
      h.init("src.note.md", "Shared", "shared", 3);
      expect(
        h.win.document.querySelector("#scope-shared #editor .cm-editor"),
      ).not.toBeNull();
      h.send({
        type: "init",
        relativePath: "src/file.note.md",
        text: "Current",
        selectedScope: "current",
        generation: 4,
        selection: { anchor: 1, head: 1 },
        scopes: [
          { relation: "current", path: "src/file.note.md", exists: true },
          {
            relation: "parent",
            path: "ancestor.note.md",
            exists: true,
            depth: 0,
          },
          { relation: "parent", path: "src.note.md", exists: true, depth: 1 },
        ],
      });
      expect(h.view().state.selection.main.anchor).toBe(1);
      h.win.dispatchEvent(new h.win.Event("unload"));
      expect(h.win.document.querySelector(".cm-editor")).toBeNull();
    });
  },
);

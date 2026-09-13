import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { showPanel } from "@codemirror/view";
import { GFM, parser } from "@lezer/markdown";
import { fenceInfo } from "./code-fence-extension.js";
import { SECURITY_FENCE_INFO } from "./field-syntax.js";
import { convertAuthenticatorJson } from "./security-import.js";
import { createIconButton } from "./structured-preview.js";

const INVALID_GUIDANCE =
  "Authenticator JSON could not be converted. Check the array and required fields.";
const JSON_FENCE =
  /^[ \t]*(`{3,}|~{3,})[ \t]*json[ \t]*(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)(`{3,}|~{3,})[ \t]*$/iu;
const REQUIRED_KEYS = [/"service"\s*:/u, /"account"\s*:/u, /"secret"\s*:/u];
const MAX_SOURCE_LENGTH = 1_048_576;
const markdownParser = parser.configure(GFM);

/** Host acknowledgement, including a manual save after a failed conversion. */
export const securityImportSaved = StateEffect.define();

function fencedSelection(state, from, to) {
  let result = { from, to };
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (
        ["CommentBlock", "HTMLBlock", "CodeBlock"].includes(node.name) &&
        from >= node.from &&
        to <= node.to
      ) {
        result = null;
        return;
      }
      if (
        node.name !== "FencedCode" ||
        from < node.from ||
        to > node.to ||
        (from === node.from && to === node.to)
      )
        return;
      result = null;
      if (fenceInfo(state, node).split(/\s+/u)[0].toLowerCase() !== "json")
        return;
      const firstLine = state.doc.lineAt(node.from);
      const finalMark = node.node.getChildren("CodeMark").at(-1);
      if (!finalMark) return;
      const finalLine = state.doc.lineAt(finalMark.from);
      const bodyFrom = Math.min(firstLine.to + 1, node.to);
      const bodyTo = finalLine.from;
      if (
        from < bodyFrom ||
        to > bodyTo ||
        state.sliceDoc(bodyFrom, from).trim() ||
        state.sliceDoc(to, bodyTo).trim()
      )
        return;
      result = { from: node.from, to: node.to };
    },
  });
  return result;
}

function parsesAsSecurityBlocks(source, from, to, count) {
  let parsedCount = 0;
  markdownParser.parse(source).iterate({
    enter(node) {
      if (node.name !== "FencedCode" || node.from < from || node.to > to)
        return;
      const info = node.node.getChild("CodeInfo");
      if (
        info &&
        source.slice(info.from, info.to).trim().toLowerCase() ===
          SECURITY_FENCE_INFO
      )
        parsedCount++;
    },
  });
  return parsedCount === count;
}

function inFrontmatter(state, from, to) {
  if (state.doc.lines < 3 || state.doc.line(1).text.trim() !== "---")
    return false;
  if (from <= state.doc.line(1).to) return false;
  for (let index = 2; index <= state.doc.lines; index++) {
    const line = state.doc.line(index);
    if (line.text.trim() === "---" || line.text.trim() === "...")
      return to <= line.from;
  }
  return false;
}

function candidateRange(state) {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  const range = state.selection.main;
  let from = range.empty ? 0 : range.from;
  let to = range.empty ? state.doc.length : range.to;
  if (from === to) return null;
  if (to - from > MAX_SOURCE_LENGTH) return null;
  if (!range.empty) {
    if (inFrontmatter(state, from, to)) return null;
    const adjusted = fencedSelection(state, from, to);
    if (!adjusted) return null;
    ({ from, to } = adjusted);
  }
  if (to - from > MAX_SOURCE_LENGTH) return null;
  const source = state.sliceDoc(from, to).trim();
  const fence = JSON_FENCE.exec(source);
  const body = fence ? fence[2].trim() : source;
  if (!body.startsWith("[")) return null;
  // A selected source must be an array, not a fragment or surrounding prose.
  if (!REQUIRED_KEYS.every((key) => key.test(body))) return null;
  return {
    from,
    to,
    source,
    selectionFrom: range.from,
    selectionTo: range.to,
  };
}

function inspect(state) {
  const target = candidateRange(state);
  if (!target) return null;
  const result = convertAuthenticatorJson(target.source);
  if (!result.ok) {
    const fence = JSON_FENCE.exec(target.source);
    const body = fence ? fence[2] : target.source;
    try {
      const entries = JSON.parse(body);
      if (
        !Array.isArray(entries) ||
        !entries.some(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            ["service", "account", "secret"].every((key) =>
              Object.hasOwn(entry, key),
            ),
        )
      )
        return null;
    } catch {
      // Recognizable, malformed JSON gets only fixed repair guidance.
    }
  }
  return {
    from: target.from,
    to: target.to,
    selectionFrom: target.selectionFrom,
    selectionTo: target.selectionTo,
    selected: !state.selection.main.empty,
    kind: result.ok ? "ready" : "invalid",
    count: result.ok ? result.count : 0,
  };
}

function sameCandidateSelection(description, state) {
  if (state.readOnly || state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  return description.selected
    ? !range.empty &&
        range.from === description.selectionFrom &&
        range.to === description.selectionTo
    : range.empty;
}

function boundaryText(before, markdown, after) {
  const trailing = /\n*$/u.exec(before)?.[0].length ?? 0;
  const leading = /^\n*/u.exec(after)?.[0].length ?? 0;
  const prefix = before ? "\n".repeat(Math.max(0, 2 - trailing)) : "";
  const body = markdown.trimEnd();
  const suffix = after ? "\n".repeat(Math.max(0, 2 - leading)) : "\n";
  return prefix + body + suffix;
}

function makePanel(view, description, field, saveEffect, onSave) {
  const document = view.dom.ownerDocument;
  const dom = document.createElement("div");
  dom.className = "cm-aic-security-import-bar";
  dom.setAttribute("role", "group");
  dom.setAttribute("aria-label", "Authenticator import");
  const save = (token) => {
    // The adapter owns persistence and its acknowledgement. Never infer a save
    // from the conversion transaction, a blur, or an optimistic host update.
    const finish = (saved) => {
      if (
        !view.dom.isConnected ||
        view.state.field(field, false)?.saveToken !== token
      )
        return;
      view.dispatch({
        effects: saveEffect.of({
          kind: saved === true ? "saved" : "failed",
          saveToken: token,
        }),
      });
    };
    try {
      Promise.resolve(onSave()).then(finish, () => finish(false));
    } catch {
      finish(false);
    }
  };
  if (description.saveToken) {
    const status = document.createElement("span");
    status.className = "cm-aic-security-import-guidance";
    status.setAttribute("role", "status");
    status.textContent =
      description.kind === "saving"
        ? "Saving note…"
        : description.kind === "saved"
          ? "Note saved"
          : "Note not saved. Keep it open and retry.";
    dom.append(status);
    if (description.kind === "failed") {
      dom.append(
        createIconButton(document, {
          label: "Retry save",
          icon: "reset",
          className: "cm-aic-security-import-action",
          disabled: view.state.readOnly,
          onActivate: () => {
            if (
              !dom.isConnected ||
              view.state.readOnly ||
              view.state.field(field, false) !== description
            )
              return;
            const token = {};
            view.dispatch({
              effects: saveEffect.of({ kind: "saving", saveToken: token }),
            });
            save(token);
          },
        }),
      );
    }
  } else if (description.kind === "invalid") {
    const guidance = document.createElement("span");
    guidance.className = "cm-aic-security-import-guidance";
    guidance.textContent = INVALID_GUIDANCE;
    dom.append(guidance);
  } else {
    const actionLabel = onSave
      ? "Convert and save security blocks"
      : "Convert to security blocks";
    const button = createIconButton(document, {
      label: actionLabel,
      icon: "code",
      className: "cm-aic-security-import-action",
      onActivate: () => {
        // An old panel/control must never act on a later note or selection.
        if (!dom.isConnected || view.state.field(field, false) !== description)
          return;
        const current = view.state;
        const target = candidateRange(current);
        if (
          !target ||
          target.from !== description.from ||
          target.to !== description.to
        )
          return;
        const result = convertAuthenticatorJson(target.source);
        if (!result.ok) return;
        const before = current.sliceDoc(0, target.from);
        const after = current.sliceDoc(target.to);
        const insert = boundaryText(before, result.markdown, after);
        if (
          !parsesAsSecurityBlocks(
            before + insert + after,
            target.from,
            target.from + insert.length,
            result.count,
          )
        )
          return;
        const token = onSave ? {} : null;
        view.dispatch({
          changes: { from: target.from, to: target.to, insert },
          selection: { anchor: target.from + insert.length },
          effects: token
            ? saveEffect.of({ kind: "saving", saveToken: token })
            : [],
          annotations: isolateHistory.of("full"),
          userEvent: "input",
        });
        view.focus();
        if (token) save(token);
      },
    });
    const label = document.createElement("span");
    label.className = "cm-aic-security-import-action-label";
    label.textContent = actionLabel;
    const count = document.createElement("span");
    count.className = "cm-aic-security-import-count";
    count.textContent = `${description.count} ${description.count === 1 ? "block" : "blocks"}`;
    button.append(label, count);
    dom.append(button);
  }
  return { dom, top: true };
}

/** Contextual, explicit conversion for the current editor document only. */
export function makeSecurityImportExtension({ onSave } = {}) {
  const saveEffect = StateEffect.define();
  const field = StateField.define({
    create: inspect,
    update(value, transaction) {
      for (const effect of transaction.effects)
        if (effect.is(saveEffect)) return effect.value;
        else if (effect.is(securityImportSaved) && value?.saveToken)
          return { ...value, kind: "saved" };
      if (value?.saveToken) {
        // Host metadata stamping can change the document while the save is in
        // flight. Its result remains bound to this state/session token.
        if (value.kind === "saving" || !transaction.docChanged)
          return transaction.startState.readOnly === transaction.state.readOnly
            ? value
            : { ...value };
        if (value.kind === "failed") return inspect(transaction.state) ?? value;
      }
      if (
        value &&
        !value.saveToken &&
        !transaction.docChanged &&
        transaction.startState.readOnly === transaction.state.readOnly &&
        sameCandidateSelection(value, transaction.state)
      )
        return value;
      return inspect(transaction.state);
    },
    provide: (sourceField) =>
      showPanel.from(sourceField, (description) =>
        description
          ? (view) =>
              makePanel(view, description, sourceField, saveEffect, onSave)
          : null,
      ),
  });
  return field;
}

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { fenceInfo } from "./code-fence-extension.js";
import { providePreviewRanges } from "./preview-ranges.js";
import { saveAction } from "./save-boundary.js";
import {
  parsePropertiesBody,
  serializePropertiesBody,
} from "./properties-model.js";
import {
  isSecretField,
  parseSecurityBlock,
  safeSecurityUrl,
  securityTemplate,
  serializeSecurityBlock,
} from "./security-model.js";
import { parseTotpInput, totpAt } from "./security-otp.js";
import {
  isRecoveryField,
  parseRecoveryCodes,
  parseRecoveryCodesPaste,
  serializeRecoveryCodes,
} from "./security-recovery.js";
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  isPasswordField,
} from "./security-password.js";
import {
  createIconButton,
  selectionRevealsPreview,
  selectionStaysInSource,
  writeTextToClipboard,
} from "./structured-preview.js";

export const SECURITY_BLOCK_CORE_VERSION = "1.3.0";
const CLIPBOARD_READ_TIMEOUT_MS = 3000;
const EMPTY_RELATIONSHIPS = Object.freeze([]);

/** Only the explicit aic-security fence belongs to this renderer. */
export function securityBlocks(state) {
  const blocks = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      if (fenceInfo(state, node).split(/\s+/u)[0] !== "aic-security") return;
      const firstLine = state.doc.lineAt(node.from);
      const bodyFrom = Math.min(firstLine.to + 1, node.to);
      const marks = node.node.getChildren("CodeMark");
      const finalMark = marks.at(-1);
      const finalLine = finalMark && state.doc.lineAt(finalMark.from);
      const bodyTo =
        finalLine && finalLine.from > firstLine.from ? finalLine.from : node.to;
      blocks.push(
        Object.freeze({
          from: node.from,
          to: node.to,
          bodyFrom,
          bodyTo,
          body: state.sliceDoc(bodyFrom, bodyTo),
        }),
      );
    },
  });
  return Object.freeze(blocks);
}

/** A complete YAML frontmatter document at offset zero, never ordinary Markdown. */
export function propertiesBlocks(state) {
  if (!state.doc.lines || !/^---[ \t]*$/u.test(state.doc.line(1).text))
    return Object.freeze([]);
  const first = state.doc.line(1);
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (!/^(?:---|\.\.\.)[ \t]*$/u.test(line.text)) continue;
    return Object.freeze([
      Object.freeze({
        from: first.from,
        to: line.to,
        bodyFrom: first.to + 1,
        bodyTo: line.from,
        body: state.sliceDoc(first.to + 1, line.from),
      }),
    ]);
  }
  return Object.freeze([]);
}

const securityFormat = Object.freeze({
  kind: "security",
  blocks: securityBlocks,
  parse: parseSecurityBlock,
  serialize: (model) => serializeSecurityBlock(model),
});
const propertiesFormat = Object.freeze({
  kind: "properties",
  blocks: propertiesBlocks,
  parse: parsePropertiesBody,
  serialize: serializePropertiesBody,
});

const editSecuritySource = StateEffect.define({
  map: (value, mapping) => mapping.mapPos(value, -1),
});

const securitySource = StateField.define({
  create: () => null,
  update(value, transaction) {
    let next = value == null ? null : transaction.changes.mapPos(value, -1);
    for (const effect of transaction.effects) {
      if (effect.is(editSecuritySource)) next = effect.value;
    }
    if (next == null) return null;
    const block = [
      ...securityBlocks(transaction.state),
      ...propertiesBlocks(transaction.state),
    ].find((candidate) => candidate.from === next);
    if (!block) return null;
    return selectionStaysInSource(
      transaction.state.selection.ranges,
      block.from,
      block.to,
    )
      ? next
      : null;
  },
});

function row(document, label, value, actions, onCopy, copyDescription = label) {
  const element = document.createElement("div");
  element.className = "cm-aic-security-row";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "cm-aic-security-label";
  name.textContent = label;
  name.setAttribute("aria-label", "Copy " + copyDescription);
  const content = document.createElement("button");
  content.type = "button";
  content.className = "cm-aic-security-value";
  content.textContent = value || "—";
  content.setAttribute("aria-label", "Copy " + copyDescription + " value");
  const status = document.createElement("span");
  status.className = "cm-aic-security-field-status";
  status.setAttribute("role", "status");
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onCopy(status);
  };
  for (const control of [name, content]) {
    control.addEventListener("pointerdown", (event) => event.preventDefault());
    control.addEventListener("click", activate);
  }
  const trailing = document.createElement("span");
  trailing.className = "cm-aic-security-row-trailing";
  if (actions) trailing.append(actions);
  trailing.append(status);
  element.append(name, content, trailing);
  return { element, content, status };
}

function button(document, label, icon, onActivate, disabled = false) {
  return createIconButton(document, {
    label,
    icon,
    disabled,
    className: "cm-aic-security-action",
    onActivate,
  });
}

function isOneTimeCode(label) {
  return /^(?:totp|two-factor|2fa|mfa)(?: code)?$/iu.test(label.trim());
}

function displayedValue(field) {
  if (typeof field.displayValue === "string") return field.displayValue;
  if (field.readOnly && /^(?:created|updated)$/iu.test(field.label)) {
    const date = new Date(field.value);
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
  }
  return field.value;
}

function selectionIntersects(state, block) {
  return (
    state.field(securitySource) === block.from ||
    selectionRevealsPreview(state.selection.ranges, block.from, block.to)
  );
}

export const setPropertyRelationships = StateEffect.define();

function relationshipTree(document, items, onOpen) {
  if (!items?.length) return null;
  const region = document.createElement("section");
  region.className = "cm-aic-note-relations";
  region.setAttribute("aria-label", "Related notes");
  const heading = document.createElement("div");
  heading.className = "cm-aic-note-relations-heading";
  heading.textContent = "Context";
  const tree = document.createElement("ul");
  tree.setAttribute("role", "tree");
  for (const item of items) {
    const node = document.createElement("li");
    node.setAttribute("role", "treeitem");
    node.setAttribute(
      "aria-current",
      String(Boolean(item.isCurrent || item.relation === "current")),
    );
    node.style.setProperty(
      "--aic-note-depth",
      String(Math.max(0, Math.min(8, Number(item.depth) || 0))),
    );
    const open = document.createElement("button");
    open.type = "button";
    open.className = "cm-aic-note-relation-open";
    open.setAttribute("aria-label", `Open ${item.relation} note ${item.label}`);
    open.addEventListener("pointerdown", (event) => event.preventDefault());
    open.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (onOpen) void Promise.resolve(onOpen(item.path)).catch(() => {});
    });
    const marker = document.createElement("span");
    marker.className = "cm-aic-note-relation-marker";
    marker.textContent = item.exists ? "●" : "○";
    const label = document.createElement("span");
    label.className = "cm-aic-note-relation-label";
    label.textContent = item.label;
    const relation = document.createElement("span");
    relation.className = "cm-aic-note-relation-kind";
    relation.textContent = item.relation;
    open.append(marker, label, relation);
    node.append(open);
    tree.append(node);
  }
  region.append(heading, tree);
  return region;
}

class SecurityBlockWidget extends WidgetType {
  constructor(
    block,
    document,
    readOnly,
    onCopy,
    onOpen,
    onReadClipboard,
    format = securityFormat,
    relationships = EMPTY_RELATIONSHIPS,
    onRelationshipOpen,
  ) {
    super();
    Object.assign(this, {
      block,
      document,
      readOnly,
      onCopy,
      onOpen,
      onReadClipboard,
      format,
      relationships,
      onRelationshipOpen,
    });
    this.destroyed = false;
    this.timer = null;
    this.closePanel = null;
    this.mounts = new Map();
  }

  eq(other) {
    const same =
      this.block.body === other.block.body &&
      this.readOnly === other.readOnly &&
      this.onCopy === other.onCopy &&
      this.onOpen === other.onOpen &&
      this.onReadClipboard === other.onReadClipboard &&
      this.format === other.format &&
      this.onRelationshipOpen === other.onRelationshipOpen &&
      this.relationships === other.relationships;
    if (same) {
      this.block = other.block;
      // CodeMirror retains the old DOM but adopts the new descriptor. Keep
      // its live renderers attached to that descriptor and current positions.
      other.mounts = this.mounts;
      for (const mount of this.mounts.values()) mount.block = other.block;
    }
    return same;
  }

  ignoreEvent() {
    return true;
  }

  destroy(dom) {
    const mount = this.mounts.get(dom);
    if (!mount) return;
    this.mounts.delete(dom);
    mount.dispose();
  }

  dispose() {
    this.destroyed = true;
    this.closePanel?.();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  currentBlock(view) {
    const candidates = this.format
      .blocks(view.state)
      .filter((candidate) => candidate.body === this.block.body);
    return (
      candidates.find((candidate) => candidate.from === this.block.from) ??
      (candidates.length === 1 ? candidates[0] : null)
    );
  }

  editSource(view) {
    if (this.destroyed || view.state.readOnly) return;
    const block = this.currentBlock(view);
    if (!block) return;
    view.dispatch({
      selection: { anchor: Math.min(block.bodyFrom, view.state.doc.length) },
      effects: editSecuritySource.of(block.from),
      scrollIntoView: true,
    });
    view.focus();
  }

  fieldSnapshot(view, sectionIndex, fieldIndex) {
    if (this.destroyed || view.state.readOnly) return null;
    const block = this.currentBlock(view);
    if (!block || view.state.field(securitySource) === block.from) return null;
    const parsed = this.format.parse(block.body);
    if (!parsed.ok) return null;
    const section = parsed.model.sections[sectionIndex];
    const field = section?.fields[fieldIndex];
    if (!field || field.readOnly || section.readOnly) return null;
    return { doc: view.state.doc, block, field: { ...field } };
  }

  fieldStillCurrent(view, snapshot, sectionIndex, fieldIndex) {
    if (
      this.destroyed ||
      view.state.readOnly ||
      view.state.doc !== snapshot.doc
    )
      return false;
    const current = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    return (
      current?.block.from === snapshot.block.from &&
      current.block.body === snapshot.block.body &&
      current.field.label === snapshot.field.label &&
      current.field.value === snapshot.field.value &&
      current.field.hide === snapshot.field.hide
    );
  }

  replaceModel(view, mutate, snapshot = null) {
    if (this.destroyed || view.state.readOnly) return false;
    if (snapshot && view.state.doc !== snapshot.doc) return false;
    const block = this.currentBlock(view);
    if (!block || (snapshot && block.body !== snapshot.block.body))
      return false;
    const parsed = this.format.parse(block.body);
    if (!parsed.ok) return false;
    const model = {
      ...parsed.model,
      sections: parsed.model.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => ({ ...field })),
      })),
    };
    if (mutate(model) === false) return false;
    let source;
    try {
      source = this.format.serialize(model, block.body);
    } catch {
      return false;
    }
    if (source === block.body) return false;
    view.dispatch({
      changes: {
        from: block.bodyFrom,
        to: block.bodyTo,
        insert: source.endsWith("\n") ? source : source + "\n",
      },
      selection: { anchor: block.from },
      annotations: [saveAction.of(true), isolateHistory.of("full")],
      userEvent: "input",
    });
    return true;
  }

  removeEmptyField(view, sectionIndex, fieldIndex) {
    const snapshot = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    // Whitespace is a stored value too. Never trim or clear a populated field
    // as a side effect of this preview-only removal action.
    if (!snapshot || snapshot.field.value.length !== 0) return false;
    return this.replaceModel(
      view,
      (model) => {
        const section = model.sections[sectionIndex];
        const field = section?.fields[fieldIndex];
        if (
          !field ||
          field.value.length !== 0 ||
          field.label !== snapshot.field.label ||
          field.hide !== snapshot.field.hide
        )
          return false;
        section.fields.splice(fieldIndex, 1);
      },
      snapshot,
    );
  }

  markRecoveryCode(view, sectionIndex, fieldIndex, codeIndex, used) {
    const snapshot = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    if (!snapshot || !isRecoveryField(snapshot.field)) return false;
    const parsed = parseRecoveryCodes(snapshot.field.value);
    if (!parsed.ok || !parsed.codes[codeIndex]) return false;
    if (parsed.codes[codeIndex].used === used) return false;
    parsed.codes[codeIndex].used = used;
    return this.replaceModel(
      view,
      (model) => {
        model.sections[sectionIndex].fields[fieldIndex].value =
          serializeRecoveryCodes(parsed.codes);
      },
      snapshot,
    );
  }

  addSection(view) {
    if (this.format !== securityFormat) return;
    this.replaceModel(view, (model) => {
      model.sections.push({
        label: "Section " + (model.sections.length + 1),
        fields: [],
      });
    });
  }

  addField(view, sectionIndex, label, hide) {
    this.replaceModel(view, (model) => {
      const section = model.sections[sectionIndex];
      if (!section || section.readOnly || section.allowAdd === false)
        return false;
      let name = label;
      if (this.format === propertiesFormat) {
        let ordinal = 2;
        while (section.fields.some((field) => field.label === name))
          name = `${label} ${ordinal++}`;
      }
      const inheritedHidden =
        this.format === propertiesFormat &&
        /(?:^|\/)[^/]*\*(?:\/|$)/u.test(section.label);
      section.fields.push({
        label: name,
        value: "",
        hide: hide || inheritedHidden,
      });
    });
  }

  insertNewBlock(view) {
    if (this.format !== securityFormat) return;
    if (this.destroyed || view.state.readOnly) return;
    const block = this.currentBlock(view);
    if (!block) return;
    const before = view.state.sliceDoc(0, block.to);
    const after = view.state.sliceDoc(block.to);
    const trailing = /\n*$/u.exec(before)?.[0].length ?? 0;
    const leading = /^\n*/u.exec(after)?.[0].length ?? 0;
    const prefix = "\n".repeat(Math.max(0, 2 - trailing));
    const suffix = "\n".repeat(Math.max(0, (after ? 2 : 1) - leading));
    const template = securityTemplate();
    const from = block.to + prefix.length;
    view.dispatch({
      changes: { from: block.to, insert: prefix + template + suffix },
      selection: { anchor: from },
      annotations: [saveAction.of(true), isolateHistory.of("full")],
      userEvent: "input",
    });
  }

  panel(document, rowElement, label, onClose) {
    this.closePanel?.();
    const panel = document.createElement("div");
    panel.className = "cm-aic-security-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", label);
    const close = () => {
      onClose?.();
      panel.remove();
      if (this.closePanel === close) this.closePanel = null;
    };
    this.closePanel = close;
    rowElement.after(panel);
    return { panel, close };
  }

  panelButton(document, label, action, primary = false) {
    const control = document.createElement("button");
    control.type = "button";
    control.className =
      "cm-aic-security-panel-button" + (primary ? " is-primary" : "");
    control.textContent = label;
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action();
    });
    return control;
  }

  pasteField(view, rowElement, sectionIndex, fieldIndex) {
    const snapshot = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    if (!snapshot || snapshot.field.value.length > 0) return;
    this.closePanel?.();
    const status = rowElement.querySelector(".cm-aic-security-field-status");
    let panel = null;
    let cancelRead = null;
    const close = () => {
      if (this.closePanel !== close) return;
      cancelRead?.();
      cancelRead = null;
      panel?.remove();
      if (status?.isConnected) status.textContent = "";
      this.closePanel = null;
    };
    this.closePanel = close;
    const stillCurrent = () =>
      snapshot.field.value.length === 0 &&
      this.fieldStillCurrent(view, snapshot, sectionIndex, fieldIndex) &&
      rowElement.isConnected &&
      this.closePanel === close;
    const commit = (value) => {
      if (!stillCurrent()) return close();
      if (typeof value !== "string" || !value.length) {
        if (panel)
          panel.querySelector(".cm-aic-security-panel-message").textContent =
            "Clipboard is empty";
        else if (status) status.textContent = "Clipboard is empty";
        return;
      }
      if (isRecoveryField(snapshot.field)) {
        const recovery = parseRecoveryCodesPaste(value);
        if (!recovery.ok || recovery.codes.length === 0) {
          const message = panel
            ? panel.querySelector(".cm-aic-security-panel-message")
            : status;
          if (message)
            message.textContent = recovery.ok
              ? "Clipboard is empty"
              : "Codes could not be pasted. Use one code per line (up to 256).";
          return;
        }
        value = serializeRecoveryCodes(recovery.codes);
      }
      const changed = this.replaceModel(
        view,
        (model) => {
          const target = model.sections[sectionIndex]?.fields[fieldIndex];
          if (
            !target ||
            target.label !== snapshot.field.label ||
            target.value.length > 0 ||
            target.hide !== snapshot.field.hide
          )
            return false;
          target.value = value;
        },
        snapshot,
      );
      if (!changed) {
        if (panel)
          panel.querySelector(".cm-aic-security-panel-message").textContent =
            "Value could not be pasted";
        else if (status) status.textContent = "Paste failed";
      } else close();
    };
    const capture = (reason) => {
      if (!stillCurrent()) return close();
      if (status) status.textContent = "";
      panel = this.document.createElement("div");
      panel.className = "cm-aic-security-panel";
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", "Paste " + snapshot.field.label);
      const message = this.document.createElement("span");
      message.className = "cm-aic-security-panel-message";
      message.setAttribute("role", "status");
      message.textContent = reason + " Paste here (Ctrl/Cmd+V).";
      const input = this.document.createElement("input");
      input.type = "password";
      input.className = "cm-aic-security-paste-capture";
      input.setAttribute(
        "aria-label",
        "Paste " + snapshot.field.label + " here",
      );
      input.setAttribute("autocomplete", "off");
      input.addEventListener("beforeinput", (event) => event.preventDefault());
      input.addEventListener("input", () => {
        input.value = "";
      });
      input.addEventListener("paste", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = event.clipboardData?.getData("text/plain") ?? "";
        input.value = "";
        commit(value);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
      const actions = this.document.createElement("span");
      actions.className = "cm-aic-security-panel-actions";
      actions.append(this.panelButton(this.document, "Cancel", close));
      panel.append(message, input, actions);
      rowElement.after(panel);
      input.focus();
    };
    const read = async () => {
      if (!stillCurrent()) return close();
      if (status) status.textContent = "Pasting…";
      let reader;
      try {
        reader =
          this.onReadClipboard ??
          this.document.defaultView?.navigator.clipboard?.readText?.bind(
            this.document.defaultView.navigator.clipboard,
          );
        if (!reader) return capture("Clipboard access unavailable.");
        // Invoke in the original user gesture. Do not defer the native read
        // behind a Promise callback, which can lose clipboard activation.
        const pending = reader();
        if (!stillCurrent()) {
          void Promise.resolve(pending).catch(() => {});
          return close();
        }
        let settleDeadline;
        const deadline = new Promise((resolve) => {
          settleDeadline = resolve;
        });
        const timer = setTimeout(
          () => settleDeadline({ kind: "timeout" }),
          CLIPBOARD_READ_TIMEOUT_MS,
        );
        cancelRead = () => {
          clearTimeout(timer);
          settleDeadline({ kind: "cancel" });
        };
        // The platform promise may not be cancellable. The race detaches this
        // widget's wait; its late success/rejection is consumed but ignored.
        const outcome = await Promise.race([
          Promise.resolve(pending).then(
            (value) => ({ kind: "value", value }),
            () => ({ kind: "error" }),
          ),
          deadline,
        ]);
        clearTimeout(timer);
        cancelRead = null;
        if (outcome.kind === "cancel") return;
        if (!stillCurrent()) return close();
        if (outcome.kind === "value") commit(outcome.value);
        else
          capture(
            outcome.kind === "timeout"
              ? "Clipboard read timed out."
              : "Clipboard access unavailable.",
          );
      } catch {
        if (stillCurrent()) capture("Clipboard access unavailable.");
      }
    };
    // Invoke the clipboard API synchronously in the Paste click gesture.
    void read();
  }

  generateField(view, rowElement, sectionIndex, fieldIndex) {
    const snapshot = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    if (
      !snapshot ||
      snapshot.field.value ||
      !snapshot.field.hide ||
      !isPasswordField(snapshot.field)
    )
      return;
    const { panel, close } = this.panel(
      this.document,
      rowElement,
      "Generate password",
    );
    const options = { ...DEFAULT_PASSWORD_OPTIONS };
    const lengthLabel = this.document.createElement("label");
    lengthLabel.textContent = "Length ";
    const length = this.document.createElement("input");
    length.type = "number";
    length.min = "8";
    length.max = "128";
    length.value = String(options.length);
    length.setAttribute("aria-label", "Password length");
    lengthLabel.append(length);
    panel.append(lengthLabel);
    for (const [key, title] of [
      ["uppercase", "Uppercase"],
      ["lowercase", "Lowercase"],
      ["numbers", "Numbers"],
      ["symbols", "Symbols"],
    ]) {
      const label = this.document.createElement("label");
      const input = this.document.createElement("input");
      input.type = "checkbox";
      input.checked = options[key];
      input.addEventListener("change", () => {
        options[key] = input.checked;
      });
      label.append(input, this.document.createTextNode(title));
      panel.append(label);
    }
    const message = this.document.createElement("span");
    message.className = "cm-aic-security-panel-message";
    message.setAttribute("role", "status");
    const actions = this.document.createElement("span");
    actions.className = "cm-aic-security-panel-actions";
    actions.append(
      this.panelButton(
        this.document,
        "Generate",
        () => {
          if (!this.fieldStillCurrent(view, snapshot, sectionIndex, fieldIndex))
            return close();
          options.length = Number(length.value);
          if (
            !Number.isInteger(options.length) ||
            options.length < 8 ||
            options.length > 128 ||
            !["uppercase", "lowercase", "numbers", "symbols"].some(
              (key) => options[key],
            )
          ) {
            message.textContent =
              "Choose 8–128 characters and at least one group";
            return;
          }
          let value;
          try {
            value = generatePassword(options);
          } catch {
            message.textContent = "Secure password generation is unavailable";
            return;
          }
          const changed = this.replaceModel(
            view,
            (model) => {
              const target = model.sections[sectionIndex]?.fields[fieldIndex];
              if (
                !target ||
                target.value ||
                !target.hide ||
                !isPasswordField(target)
              )
                return false;
              target.value = value;
            },
            snapshot,
          );
          if (changed) close();
        },
        true,
      ),
      this.panelButton(this.document, "Cancel", close),
    );
    panel.append(message, actions);
  }

  toDOM(view) {
    // A decoration descriptor can leave the viewport and mount again without
    // a document transaction. Give each DOM its own permanently ended lifetime
    // so remounting enables new controls without reviving old async work.
    const mount = new SecurityBlockWidget(
      this.block,
      this.document,
      this.readOnly,
      this.onCopy,
      this.onOpen,
      this.onReadClipboard,
      this.format,
      this.relationships,
      this.onRelationshipOpen,
    );
    const dom = mount.renderDOM(view);
    this.mounts.set(dom, mount);
    return dom;
  }

  renderDOM(view) {
    const document = this.document;
    const wrapper = document.createElement("section");
    const isProperties = this.format === propertiesFormat;
    wrapper.className =
      "cm-aic-security cm-md-block-preview" +
      (isProperties ? " cm-aic-properties" : "");
    wrapper.setAttribute(
      "aria-label",
      isProperties ? "Properties" : "Security block",
    );
    const header = document.createElement("div");
    header.className = "cm-md-preview-header";
    const title = document.createElement("strong");
    const parsed = this.format.parse(this.block.body);
    title.textContent = isProperties
      ? "Properties"
      : parsed.ok
        ? parsed.model.sections[0].label || "Security"
        : "Security";
    const actions = document.createElement("span");
    actions.className = "cm-md-preview-actions";
    header.append(title, actions);
    wrapper.append(header);

    const copyValue = async (value, label, status) => {
      if (!value || this.destroyed || !wrapper.isConnected) return;
      let copied;
      try {
        copied = this.onCopy
          ? (await this.onCopy(value, label)) !== false
          : await writeTextToClipboard(value, document);
      } catch {
        copied = false;
      }
      if (!this.destroyed && wrapper.isConnected && status?.isConnected)
        status.textContent = copied ? "Copied" : "Copy failed";
    };
    const headerStatus = document.createElement("span");
    headerStatus.className = "cm-aic-security-field-status";
    headerStatus.setAttribute("role", "status");
    actions.append(
      button(
        document,
        isProperties ? "Copy properties" : "Copy security block",
        "copy",
        async () => {
          const block = this.currentBlock(view);
          if (!block || !wrapper.isConnected) return;
          await copyValue(
            view.state.sliceDoc(block.from, block.to),
            isProperties ? "properties" : "security block",
            headerStatus,
          );
        },
      ),
      headerStatus,
    );
    if (!this.readOnly) {
      if (!isProperties && parsed.ok)
        actions.append(
          button(
            document,
            "Add security section",
            "add-property",
            () => this.addSection(view),
            parsed.model.sections.length >= 16,
          ),
        );
      if (!isProperties)
        actions.append(
          button(document, "New security block", "add-row", () =>
            this.insertNewBlock(view),
          ),
        );
      actions.append(
        button(
          document,
          isProperties ? "Edit properties" : "Edit security block",
          "edit",
          () => this.editSource(view),
        ),
      );
    }
    if (!parsed.ok) {
      const error = document.createElement("p");
      error.className = "cm-aic-security-error";
      error.textContent = isProperties
        ? "Properties format needs repair in Markdown source."
        : "Security block format needs repair in Markdown source.";
      wrapper.append(error);
      return wrapper;
    }

    const codes = [];
    const body = document.createElement("div");
    body.className = "cm-aic-security-body";
    wrapper.append(body);
    parsed.model.sections.forEach((section, sectionIndex) => {
      const group = document.createElement("section");
      group.className = "cm-aic-security-section";
      if (sectionIndex > 0 && section.label) {
        const sectionHeading = document.createElement("strong");
        sectionHeading.className = "cm-aic-security-section-title";
        sectionHeading.textContent = section.label;
        group.append(sectionHeading);
      }
      section.fields.forEach((field, fieldIndex) => {
        const label = field.label || "Field";
        const value = field.value;
        const fieldReadOnly =
          this.readOnly || section.readOnly || field.readOnly;
        if (value && isRecoveryField(field)) {
          const recovery = parseRecoveryCodes(value);
          const list = document.createElement("section");
          list.className = "cm-aic-security-recovery";
          list.setAttribute("aria-label", label);
          const heading = document.createElement("strong");
          heading.className = "cm-aic-security-section-title";
          heading.textContent = label;
          list.append(heading);
          if (!recovery.ok) {
            const error = document.createElement("p");
            error.className = "cm-aic-security-error";
            error.textContent =
              "Recovery codes need repair in Markdown source. Use one code per line.";
            list.append(error);
          } else {
            recovery.codes.forEach((entry, codeIndex) => {
              const number = codeIndex + 1;
              const used = document.createElement("label");
              used.className = "cm-aic-security-recovery-used";
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.checked = entry.used;
              checkbox.disabled = fieldReadOnly;
              checkbox.setAttribute(
                "aria-label",
                `Mark recovery code ${number} as ${entry.used ? "unused" : "used"}`,
              );
              checkbox.addEventListener("change", () => {
                if (!list.isConnected || this.destroyed) return;
                if (
                  !this.markRecoveryCode(
                    view,
                    sectionIndex,
                    fieldIndex,
                    codeIndex,
                    checkbox.checked,
                  )
                )
                  checkbox.checked = entry.used;
              });
              used.append(checkbox, document.createTextNode("Used"));
              const output = row(
                document,
                "Code " + number,
                "••••••••",
                used,
                (status) =>
                  copyValue(entry.value, "recovery code " + number, status),
                "recovery code " + number,
              );
              output.element.dataset.used = String(entry.used);
              list.append(output.element);
            });
          }
          group.append(list);
          return;
        }
        const propertyCopyOnly =
          isProperties && (section.readOnly || field.readOnly);
        const code = !propertyCopyOnly && field.hide && isOneTimeCode(label);
        const masked = isSecretField(field);
        const destination =
          propertyCopyOnly || masked ? "" : safeSecurityUrl(value);
        const fieldActions = document.createElement("span");
        fieldActions.className = "cm-aic-security-row-actions";
        if (destination) {
          fieldActions.append(
            button(document, "Open " + label, "open", () => {
              if (!wrapper.isConnected) return;
              if (this.onOpen)
                void Promise.resolve(this.onOpen(destination)).catch(() => {});
              else
                document.defaultView?.open(
                  destination,
                  "_blank",
                  "noopener,noreferrer",
                );
            }),
          );
        }
        if (!fieldReadOnly && value.length === 0) {
          fieldActions.append(
            button(document, "Paste " + label, "paste", () =>
              this.pasteField(view, output.element, sectionIndex, fieldIndex),
            ),
            button(document, "Delete empty " + label + " field", "trash", () =>
              this.removeEmptyField(view, sectionIndex, fieldIndex),
            ),
          );
          if (!value && masked && isPasswordField(field))
            fieldActions.append(
              button(document, "Generate " + label, "generate", () =>
                this.generateField(
                  view,
                  output.element,
                  sectionIndex,
                  fieldIndex,
                ),
              ),
            );
        }
        const output = row(
          document,
          label,
          value
            ? code
              ? "••••••"
              : masked
                ? "••••••••"
                : displayedValue(field)
            : "",
          fieldActions,
          async (status) => {
            if (!value || !wrapper.isConnected) return;
            if (code) {
              try {
                const current = await totpAt(value);
                await copyValue(current.code, label + " code", status);
              } catch {
                if (output.element.isConnected)
                  output.content.textContent = "Code unavailable";
              }
            } else await copyValue(value, label, status);
          },
          code ? label + " code" : label,
        );
        if (code) {
          output.content.classList.add("cm-aic-security-code");
          if (value) codes.push({ value, output: output.content });
        }
        group.append(output.element);
      });
      if (!this.readOnly && !section.readOnly && section.allowAdd !== false) {
        const quick = document.createElement("div");
        quick.className = "cm-aic-security-quick-add";
        for (const [label, hide] of [
          ...(isProperties ? [["Field", false]] : []),
          ["Password", true],
          ["Recovery codes", true],
          ["Email", false],
          ["URL", false],
          ...(!isProperties ? [["PSP", false]] : []),
        ]) {
          const control = button(
            document,
            "Add " + label,
            "add-property",
            () => this.addField(view, sectionIndex, label, hide),
            section.fields.length >= 64,
          );
          control.append(document.createTextNode(label));
          quick.append(control);
        }
        group.append(quick);
      }
      body.append(group);
      if (isProperties && sectionIndex === 0) {
        const relationships = relationshipTree(
          document,
          this.relationships,
          (path) => {
            if (
              this.destroyed ||
              !wrapper.isConnected ||
              !this.currentBlock(view)
            )
              return;
            return this.onRelationshipOpen?.(path);
          },
        );
        if (relationships) body.append(relationships);
      }
    });

    let refreshingCodes = false;
    const canRefresh = () =>
      !this.destroyed &&
      wrapper.isConnected &&
      document.visibilityState !== "hidden";
    const refreshCodes = async () => {
      if (refreshingCodes || !canRefresh()) return;
      // WebCrypto may complete after another timer tick. Keep one refresh in
      // flight so an older code cannot replace the result of a newer refresh.
      refreshingCodes = true;
      try {
        await Promise.all(
          codes.map(async ({ value, output }) => {
            try {
              const result = await totpAt(value);
              if (canRefresh()) {
                output.textContent = result.code;
                output.setAttribute(
                  "aria-label",
                  "One-time code, " +
                    result.secondsRemaining +
                    " seconds remaining",
                );
              }
            } catch {
              if (!canRefresh()) return;
              try {
                parseTotpInput(value);
                output.textContent = "Code unavailable";
              } catch {
                output.textContent = "Invalid key";
              }
            }
          }),
        );
      } finally {
        refreshingCodes = false;
      }
    };
    if (codes.length) {
      this.timer = setInterval(refreshCodes, 1000);
      queueMicrotask(refreshCodes);
    }
    return wrapper;
  }
}

function makeBlockExtension(
  format,
  {
    document = globalThis.document,
    onCopy,
    onOpen,
    onReadClipboard,
    initialRelationships,
    onRelationshipOpen,
  } = {},
) {
  if (!document?.createElement)
    throw new TypeError("Security blocks require a document");
  const relationshipState =
    format === propertiesFormat
      ? StateField.define({
          create: () => initialRelationships?.() ?? [],
          update(value, transaction) {
            for (const effect of transaction.effects)
              if (effect.is(setPropertyRelationships)) return effect.value;
            return value;
          },
        })
      : null;
  const field = StateField.define({
    create: (state) => decorations(state),
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        !transaction.effects.some((effect) => effect.is(editSecuritySource)) &&
        !transaction.effects.some((effect) =>
          effect.is(setPropertyRelationships),
        ) &&
        transaction.startState.readOnly === transaction.state.readOnly
      )
        return value;
      return decorations(transaction.state);
    },
    provide: providePreviewRanges,
  });
  const decorations = (state) =>
    Decoration.set(
      format
        .blocks(state)
        .filter((block) => !selectionIntersects(state, block))
        .map((block) =>
          Decoration.replace({
            block: true,
            widget: new SecurityBlockWidget(
              block,
              document,
              state.readOnly,
              onCopy,
              onOpen,
              onReadClipboard,
              format,
              relationshipState
                ? state.field(relationshipState)
                : EMPTY_RELATIONSHIPS,
              onRelationshipOpen,
            ),
          }).range(block.from, block.to),
        ),
      true,
    );
  return relationshipState
    ? [securitySource, relationshipState, field]
    : [securitySource, field];
}

export function makeSecurityBlockExtension(options = {}) {
  return makeBlockExtension(securityFormat, options);
}

export function makePropertiesBlockExtension(options = {}) {
  return makeBlockExtension(propertiesFormat, options);
}

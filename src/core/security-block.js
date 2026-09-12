import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { fenceInfo } from "./code-fence-extension.js";
import { providePreviewRanges } from "./preview-ranges.js";
import {
  isSecretField,
  parseSecurityBlock,
  safeSecurityUrl,
  securityTemplate,
  serializeSecurityBlock,
} from "./security-model.js";
import { parseTotpInput, totpAt } from "./security-otp.js";
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

export const SECURITY_BLOCK_CORE_VERSION = "1.2.0";
const CLIPBOARD_READ_TIMEOUT_MS = 3000;

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
    const block = securityBlocks(transaction.state).find(
      (candidate) => candidate.from === next,
    );
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

function selectionIntersects(state, block) {
  return (
    state.field(securitySource) === block.from ||
    selectionRevealsPreview(state.selection.ranges, block.from, block.to)
  );
}

class SecurityBlockWidget extends WidgetType {
  constructor(block, document, readOnly, onCopy, onOpen, onReadClipboard) {
    super();
    Object.assign(this, {
      block,
      document,
      readOnly,
      onCopy,
      onOpen,
      onReadClipboard,
    });
    this.destroyed = false;
    this.timer = null;
    this.closePanel = null;
  }

  eq(other) {
    const same =
      this.block.body === other.block.body &&
      this.readOnly === other.readOnly &&
      this.onCopy === other.onCopy &&
      this.onOpen === other.onOpen &&
      this.onReadClipboard === other.onReadClipboard;
    if (same) this.block = other.block;
    return same;
  }

  ignoreEvent() {
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.closePanel?.();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  currentBlock(view) {
    const candidates = securityBlocks(view.state).filter(
      (candidate) => candidate.body === this.block.body,
    );
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
    const parsed = parseSecurityBlock(block.body);
    if (!parsed.ok) return null;
    const field = parsed.model.sections[sectionIndex]?.fields[fieldIndex];
    if (!field) return null;
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
    const parsed = parseSecurityBlock(block.body);
    if (!parsed.ok) return false;
    const model = {
      sections: parsed.model.sections.map((section) => ({
        label: section.label,
        fields: section.fields.map((field) => ({ ...field })),
      })),
    };
    if (mutate(model) === false) return false;
    let source;
    try {
      source = serializeSecurityBlock(model);
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
      userEvent: "input",
    });
    return true;
  }

  addSection(view) {
    this.replaceModel(view, (model) => {
      model.sections.push({
        label: "Section " + (model.sections.length + 1),
        fields: [],
      });
    });
  }

  addField(view, sectionIndex, label, hide) {
    this.replaceModel(view, (model) => {
      model.sections[sectionIndex].fields.push({
        label,
        value: "",
        hide,
      });
    });
  }

  insertNewBlock(view) {
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
    if (!snapshot) return;
    let cancelRead = null;
    const { panel, close } = this.panel(
      this.document,
      rowElement,
      "Paste " + snapshot.field.label,
      () => cancelRead?.(),
    );
    const message = this.document.createElement("span");
    message.className = "cm-aic-security-panel-message";
    message.setAttribute("role", "status");
    const actions = this.document.createElement("span");
    actions.className = "cm-aic-security-panel-actions";
    panel.append(message, actions);

    const stillCurrent = () =>
      this.fieldStillCurrent(view, snapshot, sectionIndex, fieldIndex) &&
      panel.isConnected;
    const commit = (value) => {
      if (!stillCurrent()) return close();
      if (typeof value !== "string" || !value.length) {
        message.textContent = "Clipboard is empty";
        return;
      }
      if (value === snapshot.field.value) return close();
      const changed = this.replaceModel(
        view,
        (model) => {
          const target = model.sections[sectionIndex]?.fields[fieldIndex];
          if (
            !target ||
            target.label !== snapshot.field.label ||
            target.value !== snapshot.field.value ||
            target.hide !== snapshot.field.hide
          )
            return false;
          target.value = value;
        },
        snapshot,
      );
      if (!changed && panel.isConnected)
        message.textContent = "Value could not be pasted";
      else close();
    };
    const capture = (timedOut = false) => {
      if (!stillCurrent()) return close();
      message.textContent = timedOut
        ? "Clipboard read timed out. Paste into the secure capture field"
        : "Paste into the secure capture field";
      actions.replaceChildren();
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
      actions.append(input, this.panelButton(this.document, "Cancel", close));
      input.focus();
    };
    const read = async () => {
      if (!stillCurrent()) return close();
      message.textContent = "Reading clipboard…";
      actions.replaceChildren(this.panelButton(this.document, "Cancel", close));
      let reader;
      try {
        reader =
          this.onReadClipboard ??
          this.document.defaultView?.navigator.clipboard?.readText?.bind(
            this.document.defaultView.navigator.clipboard,
          );
        if (!reader) return capture();
        // Invoke in the original user gesture. Do not defer the native read
        // behind a Promise callback, which can lose clipboard activation.
        const pending = reader();
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
        if (outcome.kind === "value") commit(outcome.value);
        else capture(outcome.kind === "timeout");
      } catch {
        capture();
      }
    };
    if (snapshot.field.value) {
      message.textContent = "Replace existing value?";
      actions.append(
        this.panelButton(this.document, "Replace", read, true),
        this.panelButton(this.document, "Cancel", close),
      );
    } else {
      // Keep the clipboard read in the original click activation when the
      // destination is empty. Failed API access opens paste-only capture.
      void read();
    }
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
    const document = this.document;
    const wrapper = document.createElement("section");
    wrapper.className = "cm-aic-security cm-md-block-preview";
    wrapper.setAttribute("aria-label", "Security block");
    const header = document.createElement("div");
    header.className = "cm-md-preview-header";
    const title = document.createElement("strong");
    title.textContent = "Security";
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
      button(document, "Copy security block", "copy", async () => {
        const block = this.currentBlock(view);
        if (!block || !wrapper.isConnected) return;
        await copyValue(
          view.state.sliceDoc(block.from, block.to),
          "security block",
          headerStatus,
        );
      }),
      headerStatus,
    );
    const parsed = parseSecurityBlock(this.block.body);
    if (!this.readOnly) {
      if (parsed.ok)
        actions.append(
          button(
            document,
            "Add security section",
            "add-property",
            () => this.addSection(view),
            parsed.model.sections.length >= 16,
          ),
        );
      actions.append(
        button(document, "New security block", "add-row", () =>
          this.insertNewBlock(view),
        ),
        button(document, "Edit security block", "edit", () =>
          this.editSource(view),
        ),
      );
    }
    if (!parsed.ok) {
      const error = document.createElement("p");
      error.className = "cm-aic-security-error";
      error.textContent =
        "Security block format needs repair in Markdown source.";
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
      const sectionHeading = document.createElement("strong");
      sectionHeading.className = "cm-aic-security-section-title";
      sectionHeading.textContent =
        section.label || "Section " + (sectionIndex + 1);
      group.append(sectionHeading);
      section.fields.forEach((field, fieldIndex) => {
        const label = field.label || "Field";
        const value = field.value;
        const code = field.hide && isOneTimeCode(label);
        const masked = isSecretField(field);
        const destination = masked ? "" : safeSecurityUrl(value);
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
        if (!this.readOnly) {
          fieldActions.append(
            button(document, "Paste " + label, "paste", () =>
              this.pasteField(view, output.element, sectionIndex, fieldIndex),
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
          value ? (code ? "••••••" : masked ? "••••••••" : value) : "",
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
      if (!this.readOnly) {
        const quick = document.createElement("div");
        quick.className = "cm-aic-security-quick-add";
        for (const [label, hide] of [
          ["Password", true],
          ["Email", false],
          ["URL", false],
          ["PSP", false],
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

export function makeSecurityBlockExtension({
  document = globalThis.document,
  onCopy,
  onOpen,
  onReadClipboard,
} = {}) {
  if (!document?.createElement)
    throw new TypeError("Security blocks require a document");
  const field = StateField.define({
    create: (state) => decorations(state),
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        !transaction.effects.some((effect) => effect.is(editSecuritySource)) &&
        transaction.startState.readOnly === transaction.state.readOnly
      )
        return value;
      return decorations(transaction.state);
    },
    provide: providePreviewRanges,
  });
  const decorations = (state) =>
    Decoration.set(
      securityBlocks(state)
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
            ),
          }).range(block.from, block.to),
        ),
      true,
    );
  return [securitySource, field];
}

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
  createIconButton,
  selectionRevealsPreview,
  selectionStaysInSource,
  showIconFeedback,
  writeTextToClipboard,
} from "./structured-preview.js";

export const SECURITY_BLOCK_CORE_VERSION = "1.1.0";

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

function row(document, label, value, copy) {
  const element = document.createElement("div");
  element.className = "cm-aic-security-row";
  const name = document.createElement("span");
  name.className = "cm-aic-security-label";
  name.textContent = label;
  const content = document.createElement("span");
  content.className = "cm-aic-security-value";
  content.textContent = value || "—";
  element.append(name, content);
  if (copy) element.append(copy);
  return { element, content };
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
  constructor(block, document, readOnly, onCopy, onOpen) {
    super();
    Object.assign(this, { block, document, readOnly, onCopy, onOpen });
    this.destroyed = false;
    this.timer = null;
  }

  eq(other) {
    const same =
      this.block.body === other.block.body &&
      this.readOnly === other.readOnly &&
      this.onCopy === other.onCopy &&
      this.onOpen === other.onOpen;
    if (same) this.block = other.block;
    return same;
  }

  ignoreEvent() {
    return true;
  }

  destroy() {
    this.destroyed = true;
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

  replaceModel(view, mutate, focus) {
    if (this.destroyed || view.state.readOnly) return;
    const block = this.currentBlock(view);
    if (!block) return;
    const parsed = parseSecurityBlock(block.body);
    if (!parsed.ok) return;
    const model = {
      sections: parsed.model.sections.map((section) => ({
        label: section.label,
        fields: section.fields.map((field) => ({ ...field })),
      })),
    };
    mutate(model);
    let source;
    try {
      source = serializeSecurityBlock(model);
    } catch {
      return;
    }
    const position = focus(model, source);
    const anchor = block.bodyFrom + position;
    view.dispatch({
      changes: {
        from: block.bodyFrom,
        to: block.bodyTo,
        insert: source.endsWith("\n") ? source : source + "\n",
      },
      selection: { anchor },
      effects: editSecuritySource.of(block.from),
      scrollIntoView: true,
      userEvent: "input",
    });
    view.focus();
  }

  addSection(view) {
    this.replaceModel(
      view,
      (model) => {
        model.sections.push({
          label: "Section " + (model.sections.length + 1),
          fields: [],
        });
      },
      (_model, source) => source.length - 1,
    );
  }

  addField(view, sectionIndex, label, hide) {
    this.replaceModel(
      view,
      (model) => {
        model.sections[sectionIndex].fields.push({
          label,
          value: "",
          hide,
        });
      },
      (model) =>
        serializeSecurityBlock({
          sections: model.sections.slice(0, sectionIndex + 1),
        }).length - 1,
    );
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
      selection: { anchor: from + template.indexOf("\n") + 1 },
      effects: editSecuritySource.of(from),
      scrollIntoView: true,
      userEvent: "input",
    });
    view.focus();
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

    const copyValue = async (value, label, control) => {
      if (!value || !wrapper.isConnected) return;
      let copied;
      try {
        copied = this.onCopy
          ? (await this.onCopy(value, label)) !== false
          : await writeTextToClipboard(value, document);
      } catch {
        copied = false;
      }
      if (copied) showIconFeedback(control, { restoreLabel: "Copy " + label });
    };
    actions.append(
      button(document, "Copy security block", "copy", async (control) => {
        const block = this.currentBlock(view);
        if (!block || !wrapper.isConnected) return;
        await copyValue(
          view.state.sliceDoc(block.from, block.to),
          "security block",
          control,
        );
      }),
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
      for (const field of section.fields) {
        const label = field.label || "Field";
        const value = field.value;
        if (field.hide && isOneTimeCode(label)) {
          const copy = button(
            document,
            "Copy " + label + " code",
            "copy",
            async (control) => {
              if (!value || !wrapper.isConnected) return;
              try {
                const current = await totpAt(value);
                await copyValue(current.code, label + " code", control);
              } catch {
                output.content.textContent = "Code unavailable";
              }
            },
            !value,
          );
          const output = row(document, label, value ? "••••••" : "", copy);
          output.content.classList.add("cm-aic-security-code");
          group.append(output.element);
          if (value) codes.push({ value, output: output.content });
          continue;
        }
        const masked = isSecretField(field);
        const copy = button(
          document,
          "Copy " + label,
          "copy",
          (control) => copyValue(value, label, control),
          !value,
        );
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
        fieldActions.append(copy);
        group.append(
          row(
            document,
            label,
            value ? (masked ? "••••••••" : value) : "",
            fieldActions,
          ).element,
        );
      }
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
            ),
          }).range(block.from, block.to),
        ),
      true,
    );
  return [securitySource, field];
}

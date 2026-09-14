import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { fenceInfo } from "./code-fence-extension.js";
import { providePreviewRanges } from "./preview-ranges.js";
import { sourcePreviewExit, sourcePreviewExitHandlers } from "./source-mode.js";
import { saveAction } from "./save-boundary.js";
import { wirePreviewReorder } from "./preview-reorder.js";
import { securityCardOrdering } from "./security-card-order.js";
import { parseFieldLabel } from "./field-label.js";
import { propertiesSyntax, SECURITY_FIELD_OPTIONS } from "./field-syntax.js";
import { blockDiagnostic } from "./block-diagnostic.js";
import { FIELD_PARTS_MAX_LENGTH } from "./field-parts.js";
import {
  isCardField,
  parseCardField,
  normalizeCardPart,
} from "./security-card.js";
import {
  createSecurityAddMenu,
  createSecurityFilter,
} from "./security-controls.js";
import {
  createPropertiesReorderCapabilities,
  reorderPropertiesField,
  reorderPropertiesSection,
} from "./properties-reorder.js";
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
  SECURITY_LIMITS,
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

export const SECURITY_BLOCK_CORE_VERSION = "2.0.0";
const CLIPBOARD_READ_TIMEOUT_MS = 3000;
const EMPTY_RELATIONSHIPS = Object.freeze([]);
const fieldEmpty = (field) =>
  !field.value && !field.description && !field.additionalSecret;
const nextSecuritySection = () => ({
  label: "",
  fields: [],
});
let descriptionId = 0;
const setSecurityFilter = StateEffect.define();
// Search is local UI state, never Markdown or host-persisted note metadata.
const securityFilters = StateField.define({
  create: () => new Map(),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged) {
      next = new Map();
      for (const [from, query] of value) {
        let replaced = false;
        transaction.changes.iterChangedRanges((start, end) => {
          if (start <= from && end > from) replaced = true;
        });
        if (!replaced) next.set(transaction.changes.mapPos(from, 1), query);
      }
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setSecurityFilter)) continue;
      next = new Map(next);
      if (effect.value.query) next.set(effect.value.from, effect.value.query);
      else next.delete(effect.value.from);
    }
    return next;
  },
});

/** Historical names are quarantined as diagnostics, never rendered as code. */
export function securityBlocks(state) {
  const blocks = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const info = fenceInfo(state, node).split(/\s+/u);
      if (info[0] !== "aic" && info[0] !== "aic-security") return;
      const firstLine = state.doc.lineAt(node.from);
      const bodyFrom = Math.min(firstLine.to + 1, node.to);
      const marks = node.node.getChildren("CodeMark");
      const finalMark = marks.at(-1);
      const finalLine = finalMark && state.doc.lineAt(finalMark.from);
      const closed = Boolean(finalLine && finalLine.from > firstLine.from);
      const openingMark = marks[0];
      const bodyTo = closed ? finalLine.from : node.to;
      blocks.push(
        Object.freeze({
          from: node.from,
          to: node.to,
          bodyFrom,
          bodyTo,
          body: state.sliceDoc(bodyFrom, bodyTo),
          openingLine: firstLine.number,
          closed,
          fence: openingMark
            ? state.sliceDoc(openingMark.from, openingMark.to)
            : "",
          ...SECURITY_FIELD_OPTIONS,
          ...(info[0] !== "aic" || info.length !== 1
            ? { unsupportedSyntax: true }
            : {}),
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
    const body = state.sliceDoc(first.to + 1, line.from);
    return Object.freeze([
      Object.freeze({
        from: first.from,
        to: line.to,
        bodyFrom: first.to + 1,
        bodyTo: line.from,
        body,
        openingLine: first.number,
        ...propertiesSyntax(body),
      }),
    ]);
  }
  return Object.freeze([]);
}

const securityFormat = Object.freeze({
  kind: "security",
  blocks: securityBlocks,
  parse: (body, block, diagnostics = false) =>
    block?.unsupportedSyntax
      ? {
          ok: false,
          code: "invalid_security_block",
          ...(diagnostics
            ? {
                diagnostic: blockDiagnostic(
                  body,
                  "unsupported_version",
                  "Use the opening fence aic without a version suffix; separate sections with ---.",
                ),
              }
            : {}),
        }
      : parseSecurityBlock(body, { ...block, diagnostics }),
  serialize: (model, _body, block) => serializeSecurityBlock(model, block),
});
const propertiesFormat = Object.freeze({
  kind: "properties",
  blocks: propertiesBlocks,
  parse: (body, block, diagnostics = false) =>
    parsePropertiesBody(body, { ...block, diagnostics }),
  serialize: (model, body, block) =>
    serializePropertiesBody(model, body, block),
});

const editSecuritySource = StateEffect.define({
  map: (value, mapping) => mapping.mapPos(value, -1),
});

const securitySource = StateField.define({
  create: () => null,
  update(value, transaction) {
    if (transaction.effects.some((effect) => effect.is(sourcePreviewExit)))
      return null;
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

function row(
  document,
  label,
  value,
  actions,
  onCopy,
  copyDescription = label,
  description = "",
  onCopyLabel = onCopy,
) {
  const element = document.createElement("div");
  element.className = "cm-aic-security-row";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "cm-aic-security-label";
  name.textContent = label;
  let descriptionTarget;
  if (description) {
    const detail = document.createElement("span");
    detail.className = "cm-aic-security-field-description";
    detail.textContent = description;
    detail.id = `aic-field-description-${++descriptionId}`;
    descriptionTarget = detail.id;
    name.setAttribute("aria-describedby", detail.id);
    name.append(detail);
  }
  name.setAttribute(
    "aria-label",
    "Copy " + (onCopyLabel === onCopy ? copyDescription : label),
  );
  const content = document.createElement("button");
  content.type = "button";
  content.className = "cm-aic-security-value";
  content.textContent = value || "—";
  content.setAttribute("aria-label", "Copy " + copyDescription + " value");
  if (descriptionTarget)
    content.setAttribute("aria-describedby", descriptionTarget);
  const status = document.createElement("span");
  status.className = "cm-aic-security-field-status";
  status.setAttribute("role", "status");
  const labelStatus = status.cloneNode();
  const activate = (event, copy, feedback) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    feedback.style.left = `${target.left - bounds.left}px`;
    feedback.style.top = `${target.top - bounds.top}px`;
    feedback.style.width = `${target.width}px`;
    feedback.style.minHeight = `${target.height}px`;
    void copy(feedback);
  };
  for (const control of [name, content]) {
    control.addEventListener("pointerdown", (event) => event.preventDefault());
    control.addEventListener("click", (event) =>
      activate(
        event,
        control === name ? onCopyLabel : onCopy,
        control === name ? labelStatus : status,
      ),
    );
  }
  const trailing = document.createElement("span");
  trailing.className = "cm-aic-security-row-trailing";
  if (actions) trailing.append(actions);
  if (label) element.append(name);
  else element.classList.add("is-unlabelled");
  element.append(content, trailing);
  // Feedback overlays its actual copy target, never changes the row height.
  element.append(labelStatus, status);
  if (!label && description) {
    const detail = name.querySelector(".cm-aic-security-field-description");
    if (detail) element.append(detail);
  }
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

function selectionIntersects(state, block, previewOnly = false) {
  // A read-only domain preview must never reveal raw Properties (and secrets)
  // just because a keyboard or pointer selection crosses its replacement.
  if (previewOnly && state.readOnly) return false;
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
  region.append(tree);
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
    cardOrdering,
    cardCount = 0,
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
      cardOrdering,
      cardCount,
    });
    this.destroyed = false;
    this.timer = null;
    this.closePanel = null;
    this.mounts = new Map();
    this.cleanups = [];
    this.diagnosticLocations = [];
  }

  eq(other) {
    const same =
      this.block.body === other.block.body &&
      this.block.fieldSyntax === other.block.fieldSyntax &&
      this.block.sectionSyntax === other.block.sectionSyntax &&
      this.block.unsupportedSyntax === other.block.unsupportedSyntax &&
      this.readOnly === other.readOnly &&
      this.onCopy === other.onCopy &&
      this.onOpen === other.onOpen &&
      this.onReadClipboard === other.onReadClipboard &&
      this.format === other.format &&
      this.cardCount === other.cardCount &&
      this.onRelationshipOpen === other.onRelationshipOpen &&
      this.relationships === other.relationships;
    if (same) {
      this.block = other.block;
      // CodeMirror retains the old DOM but adopts the new descriptor. Keep
      // its live renderers attached to that descriptor and current positions.
      other.mounts = this.mounts;
      for (const mount of this.mounts.values()) {
        mount.block = other.block;
        for (const updateLocation of mount.diagnosticLocations)
          updateLocation();
      }
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
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.diagnosticLocations.length = 0;
  }

  currentBlock(view) {
    const candidates = this.format
      .blocks(view.state)
      .filter(
        (candidate) =>
          candidate.body === this.block.body &&
          candidate.fieldSyntax === this.block.fieldSyntax &&
          candidate.sectionSyntax === this.block.sectionSyntax &&
          candidate.unsupportedSyntax === this.block.unsupportedSyntax,
      );
    return (
      candidates.find((candidate) => candidate.from === this.block.from) ??
      (candidates.length === 1 ? candidates[0] : null)
    );
  }

  editSource(view, diagnostic = null, openingFence = false) {
    if (this.destroyed || view.state.readOnly) return;
    const block = this.currentBlock(view);
    if (!block) return;
    view.dispatch({
      selection: {
        anchor: openingFence
          ? block.from
          : Math.min(block.bodyFrom + (diagnostic?.from ?? 0), block.bodyTo),
      },
      effects: editSecuritySource.of(block.from),
      scrollIntoView: true,
    });
    view.focus();
  }

  showDiagnostic(
    view,
    parent,
    diagnostic,
    openingFence = false,
    blockStart = false,
  ) {
    const error = this.document.createElement("div");
    error.className = "cm-aic-security-error";
    const header = this.document.createElement("div");
    header.className = "cm-aic-security-error-location";
    const location = this.document.createElement("strong");
    const message = this.document.createElement("p");
    message.textContent = diagnostic.message;
    header.append(location);
    let edit;
    if (!this.readOnly) {
      edit = button(this.document, "Edit error location", "edit", () => {
        if (error.isConnected) this.editSource(view, diagnostic, openingFence);
      });
      header.append(edit);
    }
    const updateLocation = () => {
      const line =
        this.block.openingLine + (openingFence ? 0 : diagnostic.line);
      const column = openingFence ? 1 : diagnostic.column;
      location.textContent = blockStart
        ? `Block starts at line ${this.block.openingLine}`
        : `Line ${line}, column ${column}`;
      edit?.setAttribute(
        "aria-label",
        blockStart
          ? `Edit block at line ${this.block.openingLine}`
          : `Edit error at line ${line}, column ${column}`,
      );
    };
    updateLocation();
    this.diagnosticLocations.push(updateLocation);
    error.append(header, message);
    parent.append(error);
  }

  fieldSnapshot(view, sectionIndex, fieldIndex) {
    if (this.destroyed || view.state.readOnly) return null;
    const block = this.currentBlock(view);
    if (!block || view.state.field(securitySource) === block.from) return null;
    const parsed = this.format.parse(block.body, block);
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
    const parsed = this.format.parse(block.body, block);
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
      source = this.format.serialize(model, block.body, block);
    } catch {
      return false;
    }
    return this.replaceBody(view, source, { doc: view.state.doc, block });
  }

  replaceBody(view, source, snapshot) {
    if (
      this.destroyed ||
      view.state.readOnly ||
      view.state.doc !== snapshot.doc
    )
      return false;
    const block = this.currentBlock(view);
    if (
      !block ||
      block.from !== snapshot.block.from ||
      block.body !== snapshot.block.body ||
      view.state.field(securitySource) === block.from ||
      source === block.body
    )
      return false;
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

  wireReorder(view, root, items, canMove, move) {
    let snapshot = null;
    this.cleanups.push(
      wirePreviewReorder({
        root,
        items: () => items,
        canMove,
        onStart: () => {
          const block = this.currentBlock(view);
          if (
            this.destroyed ||
            view.state.readOnly ||
            !root.isConnected ||
            !block ||
            view.state.field(securitySource) === block.from ||
            view.state.field(securityFilters).get(block.from)
          )
            return false;
          this.closePanel?.();
          snapshot = { doc: view.state.doc, block };
          return true;
        },
        onMove: (from, to) => {
          if (!snapshot || !canMove(from, to) || !root.isConnected) return;
          move(from, to, snapshot);
        },
      }),
    );
  }

  reorder(view, sectionIndex, from, to, snapshot) {
    if (!snapshot || view.state.doc !== snapshot.doc || this.destroyed) return;
    if (this.format === propertiesFormat) {
      try {
        const source =
          sectionIndex == null
            ? reorderPropertiesSection(snapshot.block.body, from, to)
            : reorderPropertiesField(
                snapshot.block.body,
                sectionIndex,
                from,
                to,
              );
        this.replaceBody(view, source, snapshot);
      } catch {
        /* Unsupported YAML stays unchanged; Edit always owns raw source. */
      }
      return;
    }
    this.replaceModel(
      view,
      (model) => {
        const items =
          sectionIndex == null
            ? model.sections
            : model.sections[sectionIndex]?.fields;
        if (!items || from === to || !items[from] || !items[to]) return false;
        items.splice(to, 0, items.splice(from, 1)[0]);
      },
      snapshot,
    );
  }

  reorderSecurityField(view, source, destination, snapshot) {
    if (
      !snapshot ||
      view.state.doc !== snapshot.doc ||
      this.destroyed ||
      this.format !== securityFormat
    )
      return;
    this.replaceModel(
      view,
      (model) => {
        const origin = model.sections[source.sectionIndex];
        const target = model.sections[destination.sectionIndex];
        if (
          !origin?.fields[source.fieldIndex] ||
          !target ||
          (origin === target && source.fieldIndex === destination.fieldIndex) ||
          (origin !== target &&
            target.fields.length >= SECURITY_LIMITS.maxFields)
        )
          return false;
        const [field] = origin.fields.splice(source.fieldIndex, 1);
        target.fields.splice(destination.fieldIndex, 0, field);
      },
      snapshot,
    );
  }

  removeEmptyField(view, sectionIndex, fieldIndex) {
    const snapshot = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    // Whitespace is a stored value too. Never trim or clear a populated field
    // as a side effect of this preview-only removal action.
    if (!snapshot || !fieldEmpty(snapshot.field)) return false;
    return this.replaceModel(
      view,
      (model) => {
        const section = model.sections[sectionIndex];
        const field = section?.fields[fieldIndex];
        if (
          !field ||
          !fieldEmpty(field) ||
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
      model.sections.push(nextSecuritySection(model, this.block));
    });
  }

  addField(view, sectionIndex, label, hide, kind) {
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
        section.label.startsWith("/") &&
        section.label
          .slice(1)
          .split("/")
          .some((part) => {
            try {
              return parseFieldLabel(
                part.replaceAll("~1", "/").replaceAll("~0", "~"),
              ).hide;
            } catch {
              return false;
            }
          });
      section.fields.push({
        label: name,
        value: "",
        hide: hide || inheritedHidden,
        ...(kind ? { kind } : {}),
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
    if (!block.closed && !/^(?:`{3,}|~{3,})$/u.test(block.fence)) return;
    // CommonMark allows EOF-terminated fences. A new independent card needs
    // the previous fence closed first; otherwise its opening is parsed as data.
    const closing = block.closed
      ? ""
      : (before.endsWith("\n") ? "" : "\n") + block.fence;
    const trailing = /\n*$/u.exec(before + closing)?.[0].length ?? 0;
    const leading = /^\n*/u.exec(after)?.[0].length ?? 0;
    const prefix = "\n".repeat(Math.max(0, 2 - trailing));
    const suffix = "\n".repeat(Math.max(0, (after ? 2 : 1) - leading));
    const template = securityTemplate();
    const from = block.to + closing.length + prefix.length;
    view.dispatch({
      changes: { from: block.to, insert: closing + prefix + template + suffix },
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

  pasteField(view, rowElement, sectionIndex, fieldIndex, slot = "value") {
    const snapshot = this.fieldSnapshot(view, sectionIndex, fieldIndex);
    if (
      !snapshot ||
      !["value", "description", "additionalSecret"].includes(slot) ||
      (snapshot.field[slot] ?? "").length > 0
    )
      return;
    const card = isCardField(snapshot.field);
    if (card && !parseCardField(snapshot.field).ok) return;
    const slotLabel =
      snapshot.field.label +
      (slot === "value"
        ? card
          ? " number"
          : ""
        : slot === "description"
          ? card
            ? " expiry"
            : " description"
          : card
            ? " CVV"
            : " additional secret");
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
      (snapshot.field[slot] ?? "").length === 0 &&
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
      if (card) {
        try {
          value = normalizeCardPart(
            slot === "value"
              ? "number"
              : slot === "description"
                ? "date"
                : "cvv",
            value,
          );
          if (!value) throw new TypeError("Empty card part");
        } catch {
          const message =
            panel?.querySelector(".cm-aic-security-panel-message") ?? status;
          if (message)
            message.textContent =
              "Invalid card value. Check the clipboard and retry.";
          return;
        }
      } else if (slot === "value" && isRecoveryField(snapshot.field)) {
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
            (target[slot] ?? "").length > 0 ||
            target.hide !== snapshot.field.hide
          )
            return false;
          target[slot] = value;
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
      panel.setAttribute("aria-label", "Paste " + slotLabel);
      const message = this.document.createElement("span");
      message.className = "cm-aic-security-panel-message";
      message.setAttribute("role", "status");
      message.textContent = reason + " Paste here (Ctrl/Cmd+V).";
      const input = this.document.createElement("input");
      input.type = "password";
      input.className = "cm-aic-security-paste-capture";
      input.setAttribute("aria-label", "Paste " + slotLabel + " here");
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
      this.cardOrdering,
      this.cardCount,
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
    const parsed = this.format.parse(this.block.body, this.block, true);
    title.textContent = isProperties
      ? "Properties"
      : parsed.ok
        ? (parsed.model.title ?? (parsed.model.sections[0].label || "Security"))
        : "Security";
    const actions = document.createElement("span");
    actions.className = "cm-md-preview-actions";
    header.append(title, actions);
    wrapper.append(header);
    if (!isProperties) {
      const capacity = document.createElement("div");
      capacity.className = "cm-aic-security-capacity";
      capacity.setAttribute("aria-label", "Security block limits");
      const number = (value) => value.toLocaleString("en-US");
      for (const text of [
        `Sections ${parsed.ok ? parsed.model.sections.length + "/" : "≤ "}${SECURITY_LIMITS.maxSections}`,
        `Text ${number(this.block.body.length)}/${number(SECURITY_LIMITS.maxBodyLength)}`,
        this.block.fieldSyntax === "pipes"
          ? `Field text ≤ ${number(FIELD_PARTS_MAX_LENGTH)} (all pipe parts + escapes)`
          : `Each value ≤ ${number(SECURITY_LIMITS.maxValueLength)} characters`,
      ]) {
        const item = document.createElement("span");
        item.textContent = text;
        capacity.append(item);
      }
      wrapper.append(capacity);
    }
    if (
      !isProperties &&
      !this.readOnly &&
      this.cardOrdering &&
      this.cardCount > 1
    ) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cm-aic-security-drag";
      handle.setAttribute("aria-label", "Reorder security block");
      header.prepend(handle);
      this.cleanups.push(
        this.cardOrdering.register(wrapper, handle, () =>
          this.destroyed ? null : this.currentBlock(view),
        ),
      );
    }

    const copyFeedback = new Map();
    this.cleanups.push(() => {
      for (const entry of copyFeedback.values()) clearTimeout(entry.timer);
      copyFeedback.clear();
    });
    const copyValue = async (value, label, status) => {
      if (!value || this.destroyed || !wrapper.isConnected) return;
      clearTimeout(copyFeedback.get(status)?.timer);
      const entry = { timer: null };
      copyFeedback.set(status, entry);
      if (status) status.textContent = "";
      let copied;
      try {
        copied = this.onCopy
          ? (await this.onCopy(value, label)) !== false
          : await writeTextToClipboard(value, document);
      } catch {
        copied = false;
      }
      if (
        !this.destroyed &&
        wrapper.isConnected &&
        status?.isConnected &&
        copyFeedback.get(status) === entry
      ) {
        status.textContent = copied ? "Copied" : "Copy failed";
        entry.timer = setTimeout(
          () => {
            if (copyFeedback.get(status) !== entry) return;
            status.textContent = "";
            copyFeedback.delete(status);
          },
          copied ? 1600 : 2500,
        );
      }
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
      actions.append(
        button(
          document,
          isProperties ? "Edit properties" : "Edit security block",
          "edit",
          () =>
            this.editSource(
              view,
              parsed.ok ? null : parsed.diagnostic,
              !isProperties && this.block.unsupportedSyntax,
            ),
        ),
      );
    }
    if (!parsed.ok) {
      this.showDiagnostic(
        view,
        wrapper,
        parsed.diagnostic ??
          blockDiagnostic(
            this.block.body,
            "invalid_block",
            "Check this block's headings, field names and separators in Markdown source.",
          ),
        !isProperties && this.block.unsupportedSyntax,
      );
      return wrapper;
    }

    const codes = [];
    const body = document.createElement("div");
    body.className = "cm-aic-security-body";
    const hasCustomFields =
      isProperties &&
      parsed.model.sections.some(
        (section, index) => index > 0 && section.fields.length,
      );
    if (isProperties && !hasCustomFields)
      body.classList.add("cm-aic-properties-no-custom");
    if (isProperties) {
      const managed = parsed.model.sections[0]?.fields ?? [];
      const dates = managed.filter((field) =>
        ["created", "updated"].includes(field.label),
      );
      if (dates.length) {
        const metadata = document.createElement("section");
        metadata.className = "cm-aic-properties-metadata";
        metadata.setAttribute("aria-label", "Note dates");
        for (const field of dates) {
          const control = document.createElement("button");
          control.type = "button";
          control.className = "cm-aic-properties-date";
          control.setAttribute("aria-label", "Copy " + field.label);
          const name = document.createElement("span");
          name.className = "cm-aic-properties-date-label";
          name.textContent = field.label;
          const value = document.createElement("span");
          value.className = "cm-aic-properties-date-value";
          value.textContent = displayedValue(field) || "—";
          const status = document.createElement("span");
          status.className = "cm-aic-security-field-status";
          status.setAttribute("role", "status");
          control.addEventListener("pointerdown", (event) =>
            event.preventDefault(),
          );
          control.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void copyValue(field.value, field.label, status);
          });
          control.append(name, value, status);
          metadata.append(control);
        }
        wrapper.append(metadata);
      }
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
      if (relationships) wrapper.append(relationships);
    }
    wrapper.append(body);
    const filterGroups = [];
    const sectionItems = [];
    const securityFieldItems = [];
    const handles = [];
    const propertiesReorder = isProperties
      ? createPropertiesReorderCapabilities(this.block.body)
      : null;
    const addCapacity = new Map();
    // Use the serializer as the capacity gate, including encoded text size.
    // No source is changed while calculating whether an addition will fit.
    const canAdd = (sectionIndex, field) => {
      if (isProperties) return true;
      if (
        sectionIndex != null &&
        parsed.model.sections[sectionIndex].fields.length >=
          SECURITY_LIMITS.maxFields
      )
        return false;
      // Serialization adds the same field line regardless of its destination
      // section. Reuse the expensive whole-block capacity result across menus;
      // the destination's own field-count limit is still checked above.
      const key = sectionIndex == null ? "section" : JSON.stringify(field);
      if (addCapacity.has(key)) return addCapacity.get(key);
      const sections = parsed.model.sections.map((section) => ({
        ...section,
        fields: [...section.fields],
      }));
      if (sectionIndex == null)
        sections.push(nextSecuritySection(parsed.model, this.block));
      else sections[sectionIndex].fields.push(field);
      try {
        serializeSecurityBlock({ ...parsed.model, sections }, this.block);
        addCapacity.set(key, true);
        return true;
      } catch {
        addCapacity.set(key, false);
        return false;
      }
    };
    const canMoveSection = (from, to) =>
      !this.readOnly &&
      from !== to &&
      (isProperties ? propertiesReorder.section(from, to) : true);
    const dragHandle = (label) => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "cm-aic-security-drag";
      control.setAttribute("aria-label", label);
      handles.push(control);
      return control;
    };
    parsed.model.sections.forEach((section, sectionIndex) => {
      if (isProperties && sectionIndex === 0) return;
      const group = document.createElement("section");
      group.className = "cm-aic-security-section";
      const groupFilter = {
        element: group,
        label: section.label,
        fields: [],
        pinned: isProperties && sectionIndex === 0,
      };
      filterGroups.push(groupFilter);
      const sectionItem = { element: group, handle: null, sectionIndex };
      sectionItems.push(sectionItem);
      const movableSection = parsed.model.sections.some((_, index) =>
        canMoveSection(sectionIndex, index),
      );
      if (
        !isProperties ||
        movableSection ||
        ((sectionIndex > 0 || parsed.model.title !== undefined) &&
          (!isProperties || section.fields.length > 0) &&
          section.label)
      ) {
        const sectionHeader = document.createElement("div");
        sectionHeader.className = "cm-aic-security-section-header";
        if (movableSection) {
          sectionItem.handle = dragHandle(
            "Reorder group " + (section.label || sectionIndex + 1),
          );
          sectionHeader.append(sectionItem.handle);
        }
        const sectionHeading = document.createElement("strong");
        sectionHeading.className = "cm-aic-security-section-title";
        sectionHeading.textContent = isProperties
          ? section.label || "Group " + (sectionIndex + 1)
          : sectionIndex > 0 || parsed.model.title !== undefined
            ? section.label
            : "";
        if (sectionHeading.textContent) sectionHeader.append(sectionHeading);
        group.append(sectionHeader);
        if (!isProperties) {
          const count = document.createElement("span");
          count.className = "cm-aic-security-field-count";
          count.textContent = `Fields ${section.fields.length}/${SECURITY_LIMITS.maxFields}`;
          sectionHeader.append(count);
          if (!section.fields.length) {
            const placeholder = document.createElement("span");
            placeholder.className = "cm-aic-security-empty-drop";
            placeholder.textContent = "Drop fields here";
            sectionHeader.append(placeholder);
          }
          securityFieldItems.push({
            element: sectionHeader,
            handle: null,
            sectionIndex,
            kind: "section",
          });
        }
      }
      const fieldItems = [];
      const securityFieldCanMove =
        !this.readOnly &&
        !section.readOnly &&
        (section.fields.length > 1 ||
          parsed.model.sections.some(
            (target, index) =>
              index !== sectionIndex &&
              !target.readOnly &&
              target.fields.length < SECURITY_LIMITS.maxFields,
          ));
      const canMoveField = (from, to) =>
        !this.readOnly &&
        !section.readOnly &&
        from !== to &&
        (isProperties ? propertiesReorder.field(sectionIndex, from, to) : true);
      const registerField = (element, field, index, searchField = field) => {
        groupFilter.fields.push({
          element,
          field: { ...searchField, recovery: isRecoveryField(field) },
        });
        const item = {
          element,
          handle: null,
          sectionIndex,
          fieldIndex: index,
          kind: "field",
        };
        if (
          !field.readOnly &&
          (isProperties
            ? section.fields.some((_, target) => canMoveField(index, target))
            : securityFieldCanMove)
        ) {
          item.handle = dragHandle("Reorder " + (field.label || "Field"));
          element.dataset.aicReorderable = "true";
          element.prepend(item.handle);
        }
        fieldItems.push(item);
        if (!isProperties) securityFieldItems.push(item);
      };
      section.fields.forEach((field, fieldIndex) => {
        const label = field.label || "Field";
        const value = field.value;
        const fieldReadOnly =
          this.readOnly || section.readOnly || field.readOnly;
        const cardField = isCardField(field);
        const explicitCode = field.kind === "totp";
        const oneTimeCode =
          explicitCode ||
          (this.block.fieldSyntax !== "pipes" &&
            field.hide &&
            isOneTimeCode(label));
        const fieldRange = parsed.fieldRanges?.[sectionIndex]?.[fieldIndex];
        const fieldDiagnostic = (parent, code, message) => {
          // Legacy input without a precise AST mapping gets an honest block
          // location and ordinal, never an invented field offset or raw key.
          const advice = fieldRange
            ? message
            : `Group ${sectionIndex + 1}, field ${fieldIndex + 1}: ${message}`;
          this.showDiagnostic(
            view,
            parent,
            blockDiagnostic(
              this.block.body,
              code,
              advice,
              fieldRange?.from ?? 0,
              fieldRange?.to,
            ),
            false,
            !fieldRange,
          );
        };
        let invalidTotp = false;
        if (oneTimeCode && value) {
          try {
            parseTotpInput(value);
          } catch {
            invalidTotp = true;
          }
        }
        // Every composite part has its own copy target. Values are captured in
        // closures only, never DOM attributes, drag payloads or search metadata.
        const partRow = (slot, partLabel, masked, code = false) => {
          const stored = field[slot] ?? "";
          const actions = document.createElement("span");
          actions.className = "cm-aic-security-row-actions";
          const cardDisplay =
            cardField && stored
              ? slot === "value"
                ? "•••• " + stored.replace(/[ -]/gu, "").slice(-4)
                : slot === "additionalSecret"
                  ? "•••"
                  : stored
              : "";
          const output = row(
            document,
            partLabel,
            cardField
              ? cardDisplay
              : stored
                ? code
                  ? "••••••"
                  : masked
                    ? "••••••••"
                    : stored
                : "",
            actions,
            async (status) => {
              if (!stored || !wrapper.isConnected) return;
              if (!code)
                return copyValue(stored, label + " " + partLabel, status);
              try {
                const current = await totpAt(stored);
                if (wrapper.isConnected)
                  await copyValue(current.code, label + " code", status);
              } catch {
                if (output.element.isConnected)
                  output.content.textContent = "Code unavailable";
              }
            },
            label + " " + (code ? "code" : partLabel.toLowerCase()),
          );
          if (!fieldReadOnly && !stored) {
            actions.append(
              button(
                document,
                "Paste " + label + " " + partLabel.toLowerCase(),
                "paste",
                () =>
                  this.pasteField(
                    view,
                    output.element,
                    sectionIndex,
                    fieldIndex,
                    slot,
                  ),
              ),
            );
            if (
              slot === "value" &&
              !cardField &&
              !code &&
              field.hide &&
              isPasswordField(field)
            ) {
              actions.append(
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
          }
          const destination =
            slot === "value" && !masked && !code ? safeSecurityUrl(stored) : "";
          if (destination)
            actions.append(
              button(document, "Open " + label, "open", () => {
                if (!wrapper.isConnected) return;
                if (this.onOpen)
                  void Promise.resolve(this.onOpen(destination)).catch(
                    () => {},
                  );
                else
                  document.defaultView?.open(
                    destination,
                    "_blank",
                    "noopener,noreferrer",
                  );
              }),
            );
          if (code) {
            output.content.classList.add("cm-aic-security-code");
            if (invalidTotp) {
              output.content.textContent = "Invalid key";
              fieldDiagnostic(
                output.element,
                "invalid_totp",
                "Use a valid Base32 TOTP secret or an otpauth://totp URI for this field.",
              );
            } else if (stored)
              codes.push({ value: stored, output: output.content });
          }
          if (cardField) {
            // The value itself is the sole visible copy target in a compact
            // card part; its aria-label still names the independently copied part.
            output.element.querySelector(".cm-aic-security-label")?.remove();
            output.content.title = partLabel;
            if (!stored && !fieldReadOnly) {
              output.content.remove();
              output.element.dataset.aicCardEmpty = "true";
              actions.querySelector("button")?.setAttribute("title", partLabel);
            }
          } else {
            // Pipe extras are peer copy cells in one compact field row. Keep
            // their independent actions and accessible names, without visible
            // technical Value/Description subheaders.
            output.element.querySelector(".cm-aic-security-label")?.remove();
            output.element.dataset.aicFieldPart = slot;
            const hint = `${label} ${code ? "code" : partLabel.toLowerCase()}`;
            output.content.title = hint;
            output.content.setAttribute(
              "aria-label",
              slot === "value" ? `Copy ${hint}` : `Copy ${hint} value`,
            );
          }
          return output.element;
        };
        const hasParts =
          field.description !== undefined ||
          field.additionalSecret !== undefined;
        if (cardField || (hasParts && !(value && isRecoveryField(field)))) {
          const composite = document.createElement("section");
          composite.className = "cm-aic-security-card";
          composite.dataset.aicCardKind = cardField ? "card" : "fields";
          const partHeader = document.createElement("div");
          partHeader.className = "cm-aic-security-section-header";
          if (field.label) {
            const partTitle = document.createElement("button");
            partTitle.className = "cm-aic-security-section-title";
            partTitle.textContent = cardField ? label : `${label}:`;
            partTitle.title = label;
            {
              const titleCopy = document.createElement("span");
              titleCopy.className = "cm-aic-security-card-title-copy";
              partTitle.type = "button";
              partTitle.setAttribute("aria-label", "Copy " + label + " label");
              const titleStatus = document.createElement("span");
              titleStatus.className = "cm-aic-security-field-status";
              titleStatus.setAttribute("role", "status");
              partTitle.addEventListener("pointerdown", (event) =>
                event.preventDefault(),
              );
              partTitle.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                void copyValue(field.label, label + " label", titleStatus);
              });
              titleCopy.append(partTitle, titleStatus);
              partHeader.append(titleCopy);
            }
          }
          if (partHeader.childNodes.length) composite.append(partHeader);
          const valid = !cardField || parseCardField(field).ok;
          if (!valid) {
            fieldDiagnostic(
              composite,
              "invalid_card",
              "Use number | MM/YY | CVV for this card field.",
            );
          } else {
            const parts = document.createElement("div");
            parts.className = "cm-aic-security-card-parts";
            const code = !cardField && oneTimeCode;
            parts.append(
              partRow(
                "value",
                cardField ? "Number" : "Value",
                field.hide,
                code,
              ),
            );
            if (cardField || field.description !== undefined)
              parts.append(
                partRow(
                  "description",
                  cardField ? "Expiry" : "Description",
                  false,
                ),
              );
            if (cardField || field.additionalSecret !== undefined)
              parts.append(
                partRow(
                  "additionalSecret",
                  cardField ? "CVV" : "Additional secret",
                  true,
                ),
              );
            composite.append(parts);
            if (!fieldReadOnly && fieldEmpty(field)) {
              const remove = button(
                document,
                "Delete empty " + label + " field",
                "trash",
                () => this.removeEmptyField(view, sectionIndex, fieldIndex),
              );
              if (!cardField) composite.append(remove);
              else if (partHeader.parentNode === composite)
                partHeader.append(remove);
              else composite.append(remove);
            }
          }
          registerField(
            composite,
            field,
            fieldIndex,
            valid
              ? field
              : { ...field, value: "", description: "", hide: true },
          );
          group.append(composite);
          return;
        }
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
            fieldDiagnostic(
              list,
              "invalid_recovery_codes",
              "Use one recovery code per line; check this field in Markdown source.",
            );
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
          if (field.description !== undefined)
            list.append(partRow("description", "Description", false));
          if (field.additionalSecret !== undefined)
            list.append(partRow("additionalSecret", "Additional secret", true));
          registerField(list, field, fieldIndex);
          group.append(list);
          return;
        }
        const propertyCopyOnly =
          isProperties && (section.readOnly || field.readOnly);
        const code = !propertyCopyOnly && oneTimeCode;
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
            ...(fieldEmpty(field)
              ? [
                  button(
                    document,
                    "Delete empty " + label + " field",
                    "trash",
                    () => this.removeEmptyField(view, sectionIndex, fieldIndex),
                  ),
                ]
              : []),
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
          isProperties ? label : field.label,
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
          field.description,
          (status) => copyValue(field.label, label + " label", status),
        );
        if (code) {
          output.content.classList.add("cm-aic-security-code");
          if (invalidTotp) {
            output.content.textContent = "Invalid key";
            fieldDiagnostic(
              output.element,
              "invalid_totp",
              "Use a valid Base32 TOTP secret or an otpauth://totp URI for this field.",
            );
          } else if (value) codes.push({ value, output: output.content });
        }
        registerField(output.element, field, fieldIndex);
        group.append(output.element);
      });
      if (!this.readOnly && !section.readOnly && section.allowAdd !== false) {
        const menu = createSecurityAddMenu(
          document,
          "Add field to " + (section.label || "group"),
          [
            ...(isProperties ? [["Field", false]] : []),
            ["Password", true],
            ["Recovery codes", true],
            ["Email", false],
            ["URL", false],
            ...(this.block.fieldSyntax === "pipes"
              ? [
                  ["TOTP", true, "totp"],
                  ["Card", false, "card"],
                ]
              : []),
            ...(!isProperties ? [["PSP", false]] : []),
          ].map(([label, hide, kind]) => ({
            label: "Add " + label,
            text: label,
            run: () => this.addField(view, sectionIndex, label, hide, kind),
            disabledReason:
              section.fields.length >= SECURITY_LIMITS.maxFields
                ? `This section has ${SECURITY_LIMITS.maxFields} fields. Create a new block to add more.`
                : "This block has reached its text limit. Create a new block to add more.",
            disabled: isProperties
              ? section.fields.length >= 64
              : !canAdd(sectionIndex, {
                  label,
                  hide,
                  value: "",
                  ...(kind ? { kind } : {}),
                }),
          })),
          "Field",
        );
        this.cleanups.push(menu.dispose);
        group.append(menu.element);
      }
      if (isProperties)
        this.wireReorder(
          view,
          group,
          fieldItems,
          canMoveField,
          (from, to, snapshot) =>
            this.reorder(view, sectionIndex, from, to, snapshot),
        );
      body.append(group);
    });
    if (!isProperties) {
      const destination = (from, to) => {
        const source = securityFieldItems[from];
        if (source?.kind !== "field") return null;
        const remaining = securityFieldItems.filter(
          (_, index) => index !== from,
        );
        if (to < 0 || to > remaining.length) return null;
        let sectionIndex = -1;
        let fieldIndex = 0;
        for (const item of remaining.slice(0, to)) {
          if (item.kind === "section") {
            sectionIndex = item.sectionIndex;
            fieldIndex = 0;
          } else fieldIndex += 1;
        }
        if (sectionIndex < 0) return null;
        const target = parsed.model.sections[sectionIndex];
        if (
          !target ||
          target.readOnly ||
          (source.sectionIndex !== sectionIndex &&
            target.fields.length >= SECURITY_LIMITS.maxFields) ||
          (source.sectionIndex === sectionIndex &&
            source.fieldIndex === fieldIndex)
        )
          return null;
        return { sectionIndex, fieldIndex };
      };
      this.wireReorder(
        view,
        body,
        securityFieldItems,
        (from, to) => destination(from, to) !== null,
        (from, to, snapshot) => {
          const target = destination(from, to);
          if (target)
            this.reorderSecurityField(
              view,
              securityFieldItems[from],
              target,
              snapshot,
            );
        },
      );
    }
    this.wireReorder(
      view,
      body,
      sectionItems,
      (from, to) =>
        canMoveSection(
          sectionItems[from]?.sectionIndex,
          sectionItems[to]?.sectionIndex,
        ),
      (from, to, snapshot) =>
        this.reorder(
          view,
          null,
          sectionItems[from].sectionIndex,
          sectionItems[to].sectionIndex,
          snapshot,
        ),
    );
    if (!isProperties && !this.readOnly) {
      const menu = createSecurityAddMenu(
        document,
        "Add group or block",
        [
          {
            label: "Add security section",
            text: "Section",
            run: () => this.addSection(view),
            disabled: !canAdd(null),
            disabledReason:
              parsed.model.sections.length >= SECURITY_LIMITS.maxSections
                ? `This block has ${SECURITY_LIMITS.maxSections} sections. Create a new block to add more.`
                : "This block has reached its text limit. Create a new block to add more.",
          },
          {
            label: "New security block",
            text: "Security block",
            icon: "add-row",
            run: () => this.insertNewBlock(view),
          },
        ],
        "Section",
      );
      this.cleanups.push(menu.dispose);
      body.append(menu.element);
    }
    if (!isProperties) {
      const advice = document.createElement("p");
      advice.className = "cm-aic-security-capacity-advice";
      advice.textContent =
        "Use separate blocks by purpose: services, banks, web, social networks. When you reach a limit, continue in a new block.";
      body.append(advice);
    }
    const initialQuery =
      view.state.field(securityFilters).get(this.block.from) || "";
    const updateHandles = (query) => {
      for (const control of handles) {
        control.disabled = Boolean(query);
      }
    };
    if (!isProperties || hasCustomFields) {
      const filter = createSecurityFilter(document, {
        title: title.textContent,
        groups: filterGroups,
        initialQuery,
        onChange: (query) => {
          if (this.destroyed || !wrapper.isConnected) return;
          const block = this.currentBlock(view);
          if (!block) return;
          updateHandles(query);
          view.dispatch({
            effects: setSecurityFilter.of({ from: block.from, query }),
          });
          view.requestMeasure();
        },
      });
      updateHandles(initialQuery);
      if (isProperties) body.before(filter.element);
      else header.after(filter.element);
      body.append(filter.empty);
    }

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
                  "aria-description",
                  result.secondsRemaining + " seconds remaining",
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
    previewOnly = false,
  } = {},
) {
  if (!document?.createElement)
    throw new TypeError("Security blocks require a document");
  const cardOrdering =
    format === securityFormat ? securityCardOrdering() : null;
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
        !transaction.effects.some((effect) => effect.is(sourcePreviewExit)) &&
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
  const decorations = (state) => {
    // Every document change rebuilds this view. Re-reading all fenced blocks
    // once per widget made a note with N Security blocks scan its tree N²
    // times on each keystroke.
    const blocks = format.blocks(state);
    const cardCount = cardOrdering ? blocks.length : 0;
    return Decoration.set(
      blocks
        .filter((block) => !selectionIntersects(state, block, previewOnly))
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
              cardOrdering,
              cardCount,
            ),
          }).range(block.from, block.to),
        ),
      true,
    );
  };
  const exitHandler = sourcePreviewExitHandlers.of((state) => {
    const from = state.field(securitySource);
    return format.blocks(state).find((block) => block.from === from) ?? null;
  });
  return relationshipState
    ? [securitySource, securityFilters, relationshipState, field, exitHandler]
    : [
        securitySource,
        securityFilters,
        field,
        cardOrdering.extension,
        exitHandler,
      ];
}

export function makeSecurityBlockExtension(options = {}) {
  return makeBlockExtension(securityFormat, options);
}

export function makePropertiesBlockExtension(options = {}) {
  return makeBlockExtension(propertiesFormat, options);
}

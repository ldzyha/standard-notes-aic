import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { fenceInfo } from "./code-fence-extension.js";
import { providePreviewRanges } from "./preview-ranges.js";
import { sourcePreviewExit, sourcePreviewExitHandlers } from "./source-mode.js";
import { saveAction } from "./save-boundary.js";
import { wirePreviewReorder } from "./preview-reorder.js";
import { securityCardOrdering } from "./security-card-order.js";
import { SECURITY_FIELD_OPTIONS } from "./field-syntax.js";
import { blockDiagnostic } from "./block-diagnostic.js";
import { applyUiComponent } from "./ui-system.js";
import { FIELD_PARTS_MAX_LENGTH } from "./field-parts.js";
import { normalizeCardPart } from "./security-card.js";
import {
  createSecurityAddMenu,
  createSecurityFilter,
} from "./security-controls.js";
import {
  isSecretPart,
  parseSecurityBlock,
  safeSecurityUrl,
  serializeSecurityBlock,
  SECURITY_LIMITS,
} from "./security-model.js";
import {
  createSecurityRowTemplate,
  SECURITY_ROW_TEMPLATES,
} from "./security-templates.js";
import { parseTotpInput, totpAt } from "./security-otp.js";
import { parseRecoveryCodesPaste } from "./security-recovery.js";
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
const fieldEmpty = (field) => field.parts.every((part) => !part.value);
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
  const legacy = propertiesBlocks(state)[0];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      if (legacy && node.from < legacy.to) return false;
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

/** Bound retired frontmatter as opaque source; never parse its former fields. */
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
        unsupportedSyntax: true,
      }),
    ]);
  }
  // An unfinished legacy header is also opaque, including malformed input.
  const remaining = state.sliceDoc(Math.min(first.to + 1, state.doc.length));
  if (!/^(?:[ \t]*#\s*aic-fields:|[^\n:]+:[ \t]*(?:\S|$))/mu.test(remaining))
    return Object.freeze([]);
  return Object.freeze([
    Object.freeze({
      from: first.from,
      to: state.doc.length,
      bodyFrom: Math.min(first.to + 1, state.doc.length),
      bodyTo: state.doc.length,
      body: remaining,
      openingLine: first.number,
      unsupportedSyntax: true,
    }),
  ]);
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
  parse: (body, _block, diagnostics = false) => ({
    ok: false,
    code: "invalid_properties_block",
    ...(diagnostics
      ? {
          diagnostic: blockDiagnostic(
            body,
            "unsupported_version",
            "YAML Properties are no longer supported. Edit the preserved source and use an aic block. Nothing was converted.",
          ),
        }
      : {}),
  }),
  serialize: () => {
    throw new Error("Retired Properties source must be repaired explicitly.");
  },
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
  applyUiComponent(
    element,
    "field",
    label ? ["compact"] : ["compact", "unlabelled"],
  );
  const name = document.createElement("button");
  name.type = "button";
  name.className = "cm-aic-security-label";
  applyUiComponent(name, "field", [], "label");
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
  applyUiComponent(content, "field", [], "value");
  content.textContent = value || "—";
  content.setAttribute("aria-label", "Copy " + copyDescription + " value");
  if (descriptionTarget)
    content.setAttribute("aria-describedby", descriptionTarget);
  const status = document.createElement("span");
  status.className = "cm-aic-security-field-status";
  applyUiComponent(status, "field", [], "status");
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
  applyUiComponent(trailing, "field", [], "actions");
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

function sectionCopyMarkdown(section, block) {
  const fence = /^(?:`{3,}|~{3,})$/u.test(block.fence ?? "")
    ? block.fence
    : "```";
  const body = serializeSecurityBlock({ sections: [section] }, block);
  return `${fence}aic\n${body}${fence}`;
}

function selectionIntersects(state, block, previewOnly = false) {
  // A read-only domain preview must never reveal raw Properties (and secrets)
  // just because a keyboard or pointer selection crosses its replacement.
  if (previewOnly && state.readOnly) return false;
  if (block.unsupportedSyntax && !block.fence)
    return !state.readOnly && state.field(securitySource) === block.from;
  return (
    state.field(securitySource) === block.from ||
    selectionRevealsPreview(state.selection.ranges, block.from, block.to)
  );
}

export const setPropertyRelationships = StateEffect.define();
const propertyContext = Facet.define({
  combine: (values) => values.at(-1) ?? {},
});
const propertyRelationships = StateField.define({
  create: (state) =>
    state.facet(propertyContext).initialRelationships?.() ?? [],
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setPropertyRelationships)) return effect.value;
    return value;
  },
});

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
    onPreviewChange,
    canPreviewChange,
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
      onPreviewChange,
      canPreviewChange,
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
      this.onPreviewChange === other.onPreviewChange &&
      this.canPreviewChange === other.canPreviewChange &&
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

  fieldSnapshot(view, sectionIndex, fieldIndex, allowReadOnly = false) {
    if (this.destroyed || (view.state.readOnly && !allowReadOnly)) return null;
    const block = this.currentBlock(view);
    if (!block || view.state.field(securitySource) === block.from) return null;
    const parsed = this.format.parse(block.body, block);
    if (!parsed.ok) return null;
    const section = parsed.model.sections[sectionIndex];
    const field = section?.fields[fieldIndex];
    if (!field) return null;
    return {
      doc: view.state.doc,
      block,
      field: { ...field, parts: field.parts.map((part) => ({ ...part })) },
    };
  }

  fieldStillCurrent(
    view,
    snapshot,
    sectionIndex,
    fieldIndex,
    allowReadOnly = false,
  ) {
    if (
      this.destroyed ||
      (view.state.readOnly && !allowReadOnly) ||
      view.state.doc !== snapshot.doc
    )
      return false;
    const current = this.fieldSnapshot(
      view,
      sectionIndex,
      fieldIndex,
      allowReadOnly,
    );
    return (
      current?.block.from === snapshot.block.from &&
      current.block.body === snapshot.block.body &&
      current.field.label === snapshot.field.label &&
      current.field.parts.length === snapshot.field.parts.length &&
      current.field.parts.every(
        (part, index) =>
          part.value === snapshot.field.parts[index]?.value &&
          part.kind === snapshot.field.parts[index]?.kind,
      )
    );
  }

  partSnapshot(
    view,
    sectionIndex,
    fieldIndex,
    partIndex,
    allowReadOnly = false,
  ) {
    const snapshot = this.fieldSnapshot(
      view,
      sectionIndex,
      fieldIndex,
      allowReadOnly,
    );
    const part = snapshot?.field.parts[partIndex];
    return part ? { ...snapshot, part: { ...part }, partIndex } : null;
  }

  partStillCurrent(
    view,
    snapshot,
    sectionIndex,
    fieldIndex,
    allowReadOnly = false,
  ) {
    return (
      this.fieldStillCurrent(
        view,
        snapshot,
        sectionIndex,
        fieldIndex,
        allowReadOnly,
      ) &&
      snapshot.partIndex < snapshot.field.parts.length &&
      snapshot.field.parts[snapshot.partIndex]?.kind === snapshot.part.kind &&
      snapshot.field.parts[snapshot.partIndex]?.value === snapshot.part.value
    );
  }

  mutatedBody(snapshot, mutate) {
    const parsed = this.format.parse(snapshot.block.body, snapshot.block);
    if (!parsed.ok) return null;
    const model = {
      ...parsed.model,
      sections: parsed.model.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => ({
          ...field,
          parts: field.parts.map((part) => ({ ...part })),
        })),
      })),
    };
    if (mutate(model) === false) return null;
    try {
      return this.format.serialize(model, snapshot.block.body, snapshot.block);
    } catch {
      return null;
    }
  }

  async mutatePart(
    view,
    sectionIndex,
    fieldIndex,
    partIndex,
    snapshot,
    mutate,
  ) {
    const readOnly = view.state.readOnly;
    if (
      !snapshot ||
      !this.partStillCurrent(view, snapshot, sectionIndex, fieldIndex, readOnly)
    )
      return false;
    if (!readOnly)
      return this.replaceModel(
        view,
        (model) =>
          mutate(
            model,
            model.sections[sectionIndex]?.fields[fieldIndex]?.parts[partIndex],
          ),
        snapshot,
      );
    if (!this.onPreviewChange || this.canPreviewChange?.() === false)
      return false;
    const nextBody = this.mutatedBody(snapshot, (model) =>
      mutate(
        model,
        model.sections[sectionIndex]?.fields[fieldIndex]?.parts[partIndex],
      ),
    );
    if (nextBody == null) return false;
    const before = view.state.doc.toString();
    const after =
      before.slice(0, snapshot.block.bodyFrom) +
      (nextBody.endsWith("\n") ? nextBody : nextBody + "\n") +
      before.slice(snapshot.block.bodyTo);
    try {
      const accepted = await this.onPreviewChange(before, after);
      return accepted !== false && !this.destroyed;
    } catch {
      return false;
    }
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
        fields: section.fields.map((field) => ({
          ...field,
          parts: field.parts.map((part) => ({ ...part })),
        })),
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
    if (this.format === propertiesFormat) return;
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
          field.parts.length !== snapshot.field.parts.length
        )
          return false;
        section.fields.splice(fieldIndex, 1);
      },
      snapshot,
    );
  }

  addSection(view, afterIndex = null) {
    if (this.format !== securityFormat) return;
    this.replaceModel(view, (model) => {
      const index = afterIndex == null ? model.sections.length : afterIndex + 1;
      model.sections.splice(index, 0, nextSecuritySection(model, this.block));
    });
  }

  addRow(view, sectionIndex, afterIndex, templateId = "blank") {
    this.replaceModel(view, (model) => {
      const section = model.sections[sectionIndex];
      if (!section || section.fields.length >= SECURITY_LIMITS.maxFields)
        return false;
      const index = Math.max(
        0,
        Math.min(section.fields.length, afterIndex + 1),
      );
      section.fields.splice(index, 0, createSecurityRowTemplate(templateId));
    });
  }

  addPart(view, sectionIndex, fieldIndex, kind) {
    this.replaceModel(view, (model) => {
      const field = model.sections[sectionIndex]?.fields[fieldIndex];
      if (!field || field.parts.length >= SECURITY_LIMITS.maxParts)
        return false;
      field.parts.push({ value: "", kind });
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

  pasteField(view, rowElement, sectionIndex, fieldIndex, partIndex) {
    const snapshot = this.partSnapshot(
      view,
      sectionIndex,
      fieldIndex,
      partIndex,
    );
    if (!snapshot || snapshot.part.value.length > 0) return;
    const partLabel = `${snapshot.field.label || "Row"} ${snapshot.part.kind} ${partIndex + 1}`;
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
      snapshot.part.value.length === 0 &&
      this.partStillCurrent(view, snapshot, sectionIndex, fieldIndex) &&
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
      if (snapshot.part.kind === "card") {
        try {
          value = normalizeCardPart("number", value);
          if (!value) throw new TypeError("Empty card part");
        } catch {
          const message =
            panel?.querySelector(".cm-aic-security-panel-message") ?? status;
          if (message)
            message.textContent =
              "Invalid card value. Check the clipboard and retry.";
          return;
        }
      } else if (snapshot.part.kind === "one-time" && /\r|\n/u.test(value)) {
        const recovery = parseRecoveryCodesPaste(value);
        if (!recovery.ok || recovery.codes.length === 0) {
          const message = panel
            ? panel.querySelector(".cm-aic-security-panel-message")
            : status;
          if (message)
            message.textContent = recovery.ok
              ? "Clipboard is empty"
              : `Codes could not be pasted. Use one code per line (up to ${SECURITY_LIMITS.maxParts}).`;
          return;
        }
        const values = recovery.codes.map(({ value: code }) => code);
        const changed = this.replaceModel(
          view,
          (model) => {
            const target = model.sections[sectionIndex]?.fields[fieldIndex];
            const part = target?.parts[partIndex];
            if (
              !part ||
              part.kind !== "one-time" ||
              part.value ||
              target.parts.length - 1 + values.length > SECURITY_LIMITS.maxParts
            )
              return false;
            target.parts.splice(
              partIndex,
              1,
              ...values.map((code) => ({ value: code, kind: "one-time" })),
            );
          },
          snapshot,
        );
        if (!changed) {
          const message =
            panel?.querySelector(".cm-aic-security-panel-message") ?? status;
          if (message)
            message.textContent =
              "Codes do not fit this row or the value changed.";
        } else close();
        return;
      }
      const changed = this.replaceModel(
        view,
        (model) => {
          const target = model.sections[sectionIndex]?.fields[fieldIndex];
          const part = target?.parts[partIndex];
          if (!part || part.value || part.kind !== snapshot.part.kind)
            return false;
          part.value = value;
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
      panel.setAttribute("aria-label", "Paste " + partLabel);
      const message = this.document.createElement("span");
      message.className = "cm-aic-security-panel-message";
      message.setAttribute("role", "status");
      message.textContent = reason + " Paste here (Ctrl/Cmd+V).";
      const input = this.document.createElement("input");
      input.type = "password";
      input.className = "cm-aic-security-paste-capture";
      input.setAttribute("aria-label", "Paste " + partLabel + " here");
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

  generateField(view, rowElement, sectionIndex, fieldIndex, partIndex) {
    const snapshot = this.partSnapshot(
      view,
      sectionIndex,
      fieldIndex,
      partIndex,
    );
    if (!snapshot || snapshot.part.value || !isPasswordField(snapshot.part))
      return;
    const { panel, close } = this.panel(
      this.document,
      rowElement,
      "Generate password",
    );
    panel.dataset.aicPanel = "password";
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
          if (!this.partStillCurrent(view, snapshot, sectionIndex, fieldIndex))
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
              const target =
                model.sections[sectionIndex]?.fields[fieldIndex]?.parts[
                  partIndex
                ];
              if (!target || target.value || !isPasswordField(target))
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
      this.onPreviewChange,
      this.canPreviewChange,
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
    applyUiComponent(wrapper, "card", [
      isProperties ? "properties" : "security",
      ...(this.readOnly ? ["readonly"] : []),
    ]);
    wrapper.setAttribute(
      "aria-label",
      isProperties ? "Properties" : "Security block",
    );
    const header = document.createElement("div");
    header.className = "cm-md-preview-header";
    applyUiComponent(header, "card", [], "header");
    const title = document.createElement("strong");
    applyUiComponent(title, "card", [], "title");
    const parsed = this.format.parse(this.block.body, this.block, true);
    const capacityMessages = [];
    const number = (value) => value.toLocaleString("en-US");
    const nearLimit = (used, limit) => used > limit * 0.8;
    if (parsed.ok && !isProperties) {
      if (nearLimit(parsed.model.sections.length, SECURITY_LIMITS.maxSections))
        capacityMessages.push(
          `Sections ${parsed.model.sections.length}/${SECURITY_LIMITS.maxSections}`,
        );
      if (nearLimit(this.block.body.length, SECURITY_LIMITS.maxBodyLength))
        capacityMessages.push(
          `Text ${number(this.block.body.length)}/${number(SECURITY_LIMITS.maxBodyLength)}`,
        );
      const maxFieldLength = Math.max(
        0,
        ...(parsed.fieldRanges ?? []).flatMap((ranges, sectionIndex) =>
          ranges.map(({ to }, fieldIndex) => {
            const separatorFrom =
              parsed.partRanges?.[sectionIndex]?.[fieldIndex]?.[0]
                ?.separatorFrom ?? to;
            return Math.max(0, to - separatorFrom);
          }),
        ),
      );
      if (nearLimit(maxFieldLength, FIELD_PARTS_MAX_LENGTH))
        capacityMessages.push(
          `Largest field ${number(maxFieldLength)}/${number(FIELD_PARTS_MAX_LENGTH)} characters (all pipe parts + escapes)`,
        );
    }
    title.textContent = isProperties
      ? "Properties"
      : parsed.ok
        ? (parsed.model.title ?? "Security")
        : "Security";
    const actions = document.createElement("span");
    actions.className = "cm-md-preview-actions";
    applyUiComponent(actions, "card", [], "actions");
    header.append(title, actions);
    wrapper.append(header);
    if (capacityMessages.length) {
      const capacity = document.createElement("div");
      capacity.className = "cm-aic-security-capacity";
      capacity.setAttribute("aria-label", "Security block limits");
      for (const text of capacityMessages) {
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
      if (!value || this.destroyed || !wrapper.isConnected) return false;
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
      return copied;
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
    const relationships = relationshipTree(
      document,
      this.relationships,
      (path) => {
        if (this.destroyed || !wrapper.isConnected || !this.currentBlock(view))
          return;
        return this.onRelationshipOpen?.(path);
      },
    );
    if (relationships) wrapper.append(relationships);
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
    applyUiComponent(body, "card", [], "body");
    const hasCustomFields = false;
    wrapper.append(body);
    const filterGroups = [];
    const sectionItems = [];
    const securityFieldItems = [];
    const handles = [];
    const busyParts = new Set();
    const addCapacity = new Map();
    let canonicalBody = this.block.body;
    let canonicalParsed = parsed;
    if (!isProperties) {
      try {
        canonicalBody = serializeSecurityBlock(parsed.model, this.block);
        canonicalParsed = parseSecurityBlock(canonicalBody, {
          ...this.block,
          diagnostics: true,
        });
      } catch {
        // Valid compact source can expand beyond the aggregate limit when
        // canonicalized. Keep its preview usable, but disable further adds.
        canonicalBody = null;
        canonicalParsed = null;
      }
    }
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
    const canMoveSection = (from, to) => !this.readOnly && from !== to;
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
      let sectionMarker = null;
      group.className = "cm-aic-security-section";
      applyUiComponent(group, "card", [], "section");
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
        applyUiComponent(sectionHeading, "card", [], "section-title");
        sectionHeading.textContent = isProperties
          ? section.label || "Group " + (sectionIndex + 1)
          : section.label;
        if (sectionHeading.textContent) sectionHeader.append(sectionHeading);
        group.append(sectionHeader);
        if (!isProperties) {
          if (section.label || section.fields.length) {
            const sectionName = section.label || String(sectionIndex + 1);
            const copyStatus = document.createElement("span");
            copyStatus.className = "cm-aic-security-field-status";
            applyUiComponent(copyStatus, "field", [], "status");
            copyStatus.setAttribute("role", "status");
            const copySection = document.createElement("span");
            copySection.className = "cm-aic-security-inline-actions";
            applyUiComponent(copySection, "card", [], "section-actions");
            copySection.append(
              button(
                document,
                "Copy section " + sectionName,
                "copy",
                async () => {
                  const block = this.currentBlock(view);
                  if (!block || !wrapper.isConnected) return;
                  await copyValue(
                    sectionCopyMarkdown(section, block),
                    section.label
                      ? `${section.label} section`
                      : `section ${sectionName}`,
                    copyStatus,
                  );
                },
              ),
              copyStatus,
            );
            sectionHeader.append(copySection);
          }
          if (nearLimit(section.fields.length, SECURITY_LIMITS.maxFields)) {
            const count = document.createElement("span");
            count.className = "cm-aic-security-field-count";
            count.textContent = `Fields ${section.fields.length}/${SECURITY_LIMITS.maxFields}`;
            sectionHeader.append(count);
          }
          sectionMarker = {
            element: sectionHeader,
            handle: null,
            sectionIndex,
            kind: "section",
          };
          securityFieldItems.push(sectionMarker);
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
        !this.readOnly && !section.readOnly && from !== to;
      const registerField = (element, field, index, searchField = field) => {
        groupFilter.fields.push({
          element,
          field: searchField,
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
      const canAddPart = (fieldIndex, kind) => {
        const field = section.fields[fieldIndex];
        if (
          !field ||
          !canonicalBody ||
          !canonicalParsed?.ok ||
          field.parts.length >= SECURITY_LIMITS.maxParts
        )
          return false;
        // An empty appended part has an exact serialized cost: the joining
        // space plus | for text, or plus a one-character typed marker and |.
        // Avoid cloning and serializing the entire block six times per row;
        // addPart still runs the canonical serializer before it commits.
        const extra = kind === "text" ? 2 : 3;
        const fieldRange =
          canonicalParsed.fieldRanges?.[sectionIndex]?.[fieldIndex];
        const separatorFrom =
          canonicalParsed.partRanges?.[sectionIndex]?.[fieldIndex]?.[0]
            ?.separatorFrom;
        const encodedLength =
          fieldRange && separatorFrom != null
            ? fieldRange.to - separatorFrom
            : FIELD_PARTS_MAX_LENGTH;
        return (
          encodedLength + extra <= FIELD_PARTS_MAX_LENGTH &&
          canonicalBody.length + extra <= SECURITY_LIMITS.maxBodyLength
        );
      };
      section.fields.forEach((field, fieldIndex) => {
        const label = field.label || "Row";
        const fieldReadOnly = this.readOnly;
        const fieldRange = parsed.fieldRanges?.[sectionIndex]?.[fieldIndex];
        const fieldDiagnostic = (parent, code, message, partIndex = null) => {
          const range =
            partIndex == null
              ? fieldRange
              : parsed.partRanges?.[sectionIndex]?.[fieldIndex]?.[partIndex];
          const advice = range
            ? message
            : `Group ${sectionIndex + 1}, row ${fieldIndex + 1}: ${message}`;
          this.showDiagnostic(
            view,
            parent,
            blockDiagnostic(
              this.block.body,
              code,
              advice,
              range?.from ?? 0,
              range?.to,
            ),
            false,
            !range,
          );
        };
        const composite = document.createElement("section");
        composite.className = "cm-aic-security-card";
        applyUiComponent(composite, "field", [
          "composite",
          "compact",
          ...(field.label ? [] : ["unlabelled"]),
        ]);
        composite.dataset.aicCardKind = "fields";
        const partHeader = document.createElement("div");
        partHeader.className = "cm-aic-security-section-header";
        if (field.label) {
          const titleCopy = document.createElement("span");
          titleCopy.className = "cm-aic-security-card-title-copy";
          const partTitle = document.createElement("button");
          partTitle.type = "button";
          partTitle.className = "cm-aic-security-section-title";
          applyUiComponent(partTitle, "field", [], "label");
          partTitle.textContent = field.label;
          partTitle.title = field.label;
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
        const fieldKinds = [
          ["Text", "text"],
          ["Secret", "secret"],
          ["TOTP", "totp"],
          ["Card number", "card"],
          ["One-time", "one-time"],
          ["Used", "used"],
        ];
        let fieldActions = null;
        if (!fieldReadOnly) {
          fieldActions = document.createElement("div");
          fieldActions.className =
            "cm-aic-security-inline-actions cm-aic-security-row-controls";
          applyUiComponent(fieldActions, "card", [], "section-actions");
          const add = createSecurityAddMenu(
            document,
            "Add field to " + label,
            fieldKinds.map(([text, kind]) => {
              const enabled = canAddPart(fieldIndex, kind);
              return {
                label: `Add ${text.toLowerCase()} field to ${label}`,
                text,
                run: () => this.addPart(view, sectionIndex, fieldIndex, kind),
                disabled: !enabled,
                disabledReason:
                  field.parts.length >= SECURITY_LIMITS.maxParts
                    ? `This row has ${SECURITY_LIMITS.maxParts} fields. Add a row instead.`
                    : "This block has reached its text limit. Add a new block.",
              };
            }),
            "",
            "add-property",
          );
          this.cleanups.push(add.dispose);
          fieldActions.append(add.element);
          const addRow = createSecurityAddMenu(
            document,
            "Add row after " + label,
            SECURITY_ROW_TEMPLATES.map(({ id, label: templateLabel }) => {
              const template = createSecurityRowTemplate(id);
              const enabled = canAdd(sectionIndex, template);
              const rowName =
                id === "blank"
                  ? templateLabel.toLowerCase()
                  : templateLabel.toLowerCase() + " row";
              return {
                label: `Add ${rowName} after ${label}`,
                text: templateLabel,
                icon: "add-row",
                run: () => this.addRow(view, sectionIndex, fieldIndex, id),
                disabled: !enabled,
                disabledReason:
                  section.fields.length >= SECURITY_LIMITS.maxFields
                    ? `This section has ${SECURITY_LIMITS.maxFields} rows. Add a section instead.`
                    : "This block has reached its text limit. Add a new block.",
              };
            }),
            "",
            "add-row",
          );
          this.cleanups.push(addRow.dispose);
          fieldActions.append(addRow.element);
          const addSection = button(
            document,
            "Add section after " +
              (section.label || `section ${sectionIndex + 1}`),
            "add-section",
            () => this.addSection(view, sectionIndex),
            parsed.model.sections.length >= SECURITY_LIMITS.maxSections ||
              !canAdd(null),
          );
          if (addSection.disabled)
            addSection.title =
              parsed.model.sections.length >= SECURITY_LIMITS.maxSections
                ? `This block has ${SECURITY_LIMITS.maxSections} sections. Add a new block instead.`
                : "This block has reached its text limit. Add a new block instead.";
          fieldActions.append(addSection);
        }
        if (partHeader.childNodes.length) composite.append(partHeader);
        const parts = document.createElement("div");
        parts.className = "cm-aic-security-card-parts";
        const visibleValues = [];
        field.parts.forEach((part, partIndex) => {
          const stored = part.value;
          const ordinal = partIndex + 1;
          const kindName =
            part.kind === "one-time"
              ? "one-time"
              : part.kind === "used"
                ? "used"
                : part.kind === "totp"
                  ? "TOTP"
                  : part.kind === "card"
                    ? "card number"
                    : part.kind;
          const accessible = `${label} ${kindName} ${ordinal}`;
          if (part.kind === "text" && stored) visibleValues.push(stored);
          const partActions = document.createElement("span");
          partActions.className = "cm-aic-security-row-actions";
          const stateful = part.kind === "one-time" || part.kind === "used";
          const concise =
            field.parts.length === 1 && !stateful
              ? label + (part.kind === "totp" ? " code" : "")
              : accessible;
          const delegated =
            this.readOnly &&
            Boolean(this.onPreviewChange) &&
            this.canPreviewChange?.() !== false;
          const statefulEnabled = !this.readOnly || delegated;
          let display = stored;
          if (part.kind === "totp" && stored) display = "••••••";
          else if (part.kind === "card" && stored)
            display = "•••• " + stored.replace(/[ -]/gu, "").slice(-4);
          else if (isSecretPart(part) && stored) display = "••••••••";
          const output = row(
            document,
            "",
            display,
            partActions,
            async (status) => {
              if (!stored || !wrapper.isConnected) return false;
              if (part.kind === "totp") {
                try {
                  const current = await totpAt(stored);
                  if (!output.element.isConnected) return false;
                  return copyValue(current.code, concise, status);
                } catch {
                  if (output.element.isConnected)
                    output.content.textContent = "Code unavailable";
                  return false;
                }
              }
              if (part.kind === "used") {
                if (
                  !statefulEnabled ||
                  (this.readOnly && this.canPreviewChange?.() === false)
                )
                  return false;
                const busyKey = `${sectionIndex}:${fieldIndex}:${partIndex}`;
                if (busyParts.has(busyKey)) return false;
                busyParts.add(busyKey);
                const snapshot = this.partSnapshot(
                  view,
                  sectionIndex,
                  fieldIndex,
                  partIndex,
                  this.readOnly,
                );
                const changed = await this.mutatePart(
                  view,
                  sectionIndex,
                  fieldIndex,
                  partIndex,
                  snapshot,
                  (_model, target) => {
                    if (!target || target.kind !== "used") return false;
                    target.kind = "one-time";
                  },
                );
                busyParts.delete(busyKey);
                if (!changed && output.element.isConnected)
                  status.textContent = "State not saved";
                return changed;
              }
              if (part.kind === "one-time") {
                if (
                  !statefulEnabled ||
                  (this.readOnly && this.canPreviewChange?.() === false)
                )
                  return false;
                const busyKey = `${sectionIndex}:${fieldIndex}:${partIndex}`;
                if (busyParts.has(busyKey)) return false;
                busyParts.add(busyKey);
                const snapshot = this.partSnapshot(
                  view,
                  sectionIndex,
                  fieldIndex,
                  partIndex,
                  this.readOnly,
                );
                if (!snapshot) {
                  busyParts.delete(busyKey);
                  return false;
                }
                const copied = await copyValue(stored, accessible, status);
                if (!copied) {
                  busyParts.delete(busyKey);
                  return false;
                }
                const changed = await this.mutatePart(
                  view,
                  sectionIndex,
                  fieldIndex,
                  partIndex,
                  snapshot,
                  (_model, target) => {
                    if (!target || target.kind !== "one-time") return false;
                    target.kind = "used";
                  },
                );
                busyParts.delete(busyKey);
                if (!changed && output.element.isConnected)
                  status.textContent = "Copied; state not saved";
                return changed;
              }
              return copyValue(stored, concise, status);
            },
            accessible,
          );
          output.element.dataset.aicFieldPart = String(partIndex);
          output.element.dataset.aicPartKind = part.kind;
          output.content.title = stateful
            ? part.kind === "used"
              ? "Reactivate without copying"
              : "Copy once and mark used"
            : accessible;
          output.content.setAttribute(
            "aria-label",
            part.kind === "used"
              ? `Reactivate ${accessible} without copying`
              : part.kind === "one-time"
                ? `Copy ${accessible} and mark it used`
                : field.parts.length === 1
                  ? `Copy ${concise}${part.kind === "totp" ? "" : " value"}`
                  : `Copy ${accessible}`,
          );
          if (stateful && !statefulEnabled) {
            output.content.disabled = true;
            output.content.title =
              "Editing and successful saving are required to change one-time values";
          }
          if (!fieldReadOnly && !stored) {
            partActions.append(
              button(document, "Paste " + concise, "paste", () =>
                this.pasteField(
                  view,
                  output.element,
                  sectionIndex,
                  fieldIndex,
                  partIndex,
                ),
              ),
            );
            if (part.kind === "secret")
              partActions.append(
                button(document, "Generate " + concise, "generate", () =>
                  this.generateField(
                    view,
                    output.element,
                    sectionIndex,
                    fieldIndex,
                    partIndex,
                  ),
                ),
              );
          }
          if (part.kind === "text") {
            const destination = safeSecurityUrl(stored);
            if (destination)
              partActions.append(
                button(document, "Open " + concise, "open", () => {
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
          }
          if (part.kind === "used") {
            const canDelete = !this.readOnly || delegated;
            partActions.append(
              button(
                document,
                "Delete " + accessible,
                "trash",
                async () => {
                  if (!canDelete) return;
                  const snapshot = this.partSnapshot(
                    view,
                    sectionIndex,
                    fieldIndex,
                    partIndex,
                    this.readOnly,
                  );
                  const changed = await this.mutatePart(
                    view,
                    sectionIndex,
                    fieldIndex,
                    partIndex,
                    snapshot,
                    (model, target) => {
                      if (!target || target.kind !== "used") return false;
                      const targetField =
                        model.sections[sectionIndex]?.fields[fieldIndex];
                      if (!targetField) return false;
                      if (targetField.parts.length === 1)
                        model.sections[sectionIndex].fields.splice(
                          fieldIndex,
                          1,
                        );
                      else targetField.parts.splice(partIndex, 1);
                    },
                  );
                  if (!changed && output.element.isConnected)
                    output.status.textContent = "State not saved";
                },
                !canDelete,
              ),
            );
          }
          if (part.kind === "totp") {
            output.content.classList.add("cm-aic-security-code");
            if (stored) {
              try {
                parseTotpInput(stored);
                codes.push({ value: stored, output: output.content });
              } catch {
                output.content.textContent = "Invalid key";
                fieldDiagnostic(
                  output.element,
                  "invalid_totp",
                  "Use a valid Base32 TOTP secret or an otpauth://totp URI for this field.",
                  partIndex,
                );
              }
            }
          }
          parts.append(output.element);
        });
        composite.append(parts);
        if (fieldActions) {
          if (fieldEmpty(field))
            fieldActions.append(
              button(document, "Delete empty " + label + " row", "trash", () =>
                this.removeEmptyField(view, sectionIndex, fieldIndex),
              ),
            );
          composite.append(fieldActions);
        }
        registerField(composite, field, fieldIndex, {
          label: field.label,
          visibleValues,
        });
        group.append(composite);
      });
      if (!this.readOnly) {
        const rowMenu = createSecurityAddMenu(
          document,
          "Add row to " + (section.label || "section"),
          SECURITY_ROW_TEMPLATES.map(({ id, label: templateLabel }) => {
            const template = createSecurityRowTemplate(id);
            const enabled = canAdd(sectionIndex, template);
            const rowName =
              id === "blank"
                ? templateLabel.toLowerCase()
                : templateLabel.toLowerCase() + " row";
            return {
              label: "Add " + rowName + " to " + (section.label || "section"),
              text: templateLabel,
              icon: "add-row",
              run: () =>
                this.addRow(view, sectionIndex, section.fields.length - 1, id),
              disabled: !enabled,
              disabledReason:
                section.fields.length >= SECURITY_LIMITS.maxFields
                  ? `This section has ${SECURITY_LIMITS.maxFields} rows. Add a section instead.`
                  : "This block has reached its text limit. Add a new block.",
            };
          }),
          "",
          "add-row",
        );
        applyUiComponent(rowMenu.element, "card", [], "section-actions");
        this.cleanups.push(rowMenu.dispose);
        const addSection = button(
          document,
          "Add section after " +
            (section.label || `section ${sectionIndex + 1}`),
          "add-section",
          () => this.addSection(view, sectionIndex),
          parsed.model.sections.length >= SECURITY_LIMITS.maxSections ||
            !canAdd(null),
        );
        if (addSection.disabled)
          addSection.title =
            parsed.model.sections.length >= SECURITY_LIMITS.maxSections
              ? `This block has ${SECURITY_LIMITS.maxSections} sections. Add a new block instead.`
              : "This block has reached its text limit. Add a new block instead.";
        const sectionActions = document.createElement("div");
        sectionActions.className =
          "cm-aic-security-add cm-aic-security-inline-actions";
        applyUiComponent(sectionActions, "card", [], "section-actions");
        sectionActions.append(rowMenu.element, addSection);
        if (sectionMarker && !sectionMarker.element.hasChildNodes())
          sectionMarker.element = sectionActions;
        group.append(sectionActions);
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
    if (
      !isProperties &&
      (capacityMessages.length ||
        parsed.model.sections.some((section) =>
          nearLimit(section.fields.length, SECURITY_LIMITS.maxFields),
        ))
    ) {
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
      actions.before(filter.element);
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
    onPreviewChange,
    canPreviewChange,
    initialRelationships,
    onRelationshipOpen,
    previewOnly = false,
  } = {},
) {
  if (!document?.createElement)
    throw new TypeError("Security blocks require a document");
  const cardOrdering =
    format === securityFormat ? securityCardOrdering() : null;
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
    const firstAic = securityBlocks(state).find(
      (block) =>
        !block.unsupportedSyntax && securityFormat.parse(block.body, block).ok,
    );
    const contextBlock = firstAic?.from ?? propertiesBlocks(state)[0]?.from;
    const context = state.facet(propertyContext);
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
              onPreviewChange,
              canPreviewChange,
              format,
              block.from === contextBlock
                ? state.field(propertyRelationships)
                : EMPTY_RELATIONSHIPS,
              context.onRelationshipOpen,
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
  return [
    securitySource,
    securityFilters,
    propertyRelationships,
    ...(initialRelationships || onRelationshipOpen
      ? [propertyContext.of({ initialRelationships, onRelationshipOpen })]
      : []),
    field,
    ...(cardOrdering ? [cardOrdering.extension] : []),
    exitHandler,
  ];
}

export function makeSecurityBlockExtension(options = {}) {
  return makeBlockExtension(securityFormat, options);
}

export function makePropertiesBlockExtension(options = {}) {
  return makeBlockExtension(propertiesFormat, options);
}

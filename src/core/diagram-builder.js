import {
  DIAGRAM_RELATIONSHIPS,
  moveSequenceMessage,
  nextDiagramId,
  parseDiagram,
  serializeDiagram,
} from "./diagram-model.js";
import { wireCodeSourceIndentation } from "./indentation.js";
import { createDiagramPalette, diagramElements } from "./diagram-palette.js";
import { bindDiagramSvg } from "./diagram-renderer.js";
import { renderMermaidSvg, sanitizeMermaidSvg } from "./mermaid-runtime.js";
import {
  createIconButton,
  showIconFeedback,
  writeTextToClipboard,
} from "./structured-preview.js";

export const DIAGRAM_BUILDER_VERSION = "0.1.0";
let builderSerial = 0;

/** Local draft surface. Only Apply emits text; the host owns note identity and saving. */
export function createDiagramBuilder(document, options) {
  let source = String(options.source ?? "");
  let parsed = parseDiagram(source);
  let model = parsed.ok ? parsed.model : null;
  let mode = model ? "visual" : "source";
  let selected = null;
  let connectionFrom = null;
  let zoom = 1;
  let destroyed = false;
  let coalescing = null;
  let dragging = null;
  let renderEpoch = 0;
  let renderAbort = null;
  let renderPromise = Promise.resolve(false);
  let renderError = null;
  let applyEnabled = true;
  let applyBlockedReason = null;
  let copyError = null;
  let suppressPortClick = false;
  let invalidDraft = null;
  let palette = null;
  let paletteType = null;
  let openPopover = null;
  const undo = [];
  const redo = [];
  const readOnly = options.readOnly === true;
  const markerPrefix = `aic-db-${++builderSerial}`;
  const window = document.defaultView;
  const element = document.createElement("section");
  element.className = "aic-diagram-builder";
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "Diagram builder · experimental");
  element.tabIndex = -1;

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function button(label, icon, action) {
    const result = node("button", "aic-db-button");
    result.type = "button";
    result.setAttribute("aria-label", label);
    result.title = label;
    const glyph = node("span", "aic-db-icon");
    glyph.dataset.icon = icon;
    glyph.setAttribute("aria-hidden", "true");
    result.append(glyph);
    result.addEventListener("click", action);
    return result;
  }
  const toolbar = node("header", "aic-db-toolbar");
  const title = node("strong", "aic-db-title", "Diagram · experimental");
  const modeButton = button("Edit Mermaid source", "code", toggleMode);
  const copyButton = createIconButton(document, {
    label: "Copy Mermaid source",
    icon: "copy",
    className: "aic-db-button",
    onActivate: async (button) => {
      try {
        const copied = options.onCopy
          ? await options.onCopy(source)
          : await writeTextToClipboard(source, document);
        if (destroyed) return;
        copyError =
          copied === false
            ? "Could not copy Mermaid source. Open source mode to select and copy it."
            : null;
        if (copied !== false)
          showIconFeedback(button, { restoreLabel: "Copy Mermaid source" });
      } catch {
        if (destroyed) return;
        copyError =
          "Could not copy Mermaid source. Open source mode to select and copy it.";
      }
      updateChrome();
    },
  });
  copyButton.title = "Copy Mermaid source";
  const undoButton = button("Undo diagram change", "undo", () =>
    travel(undo, redo),
  );
  const redoButton = button("Redo diagram change", "redo", () =>
    travel(redo, undo),
  );
  const alternativeButton = button(
    "Add alternative fragment",
    "branch",
    addAlternative,
  );
  const zoomOut = button("Zoom out", "minus", () => setZoom(zoom / 1.2));
  const zoomIn = button("Zoom in", "add", () => setZoom(zoom * 1.2));
  const fitButton = button("Fit diagram", "fit", fit);
  const closeButton = button("Cancel diagram changes", "close", () =>
    options.onClose?.(),
  );
  toolbar.append(
    title,
    copyButton,
    modeButton,
    undoButton,
    redoButton,
    alternativeButton,
    zoomOut,
    zoomIn,
    fitButton,
    closeButton,
  );
  const paletteHost = node("div", "aic-db-palette-host");
  const main = node("div", "aic-db-main");
  const viewport = node("div", "aic-db-viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute(
    "aria-label",
    "Diagram canvas. Scroll to pan. Select an element to edit it.",
  );
  const canvasSizer = node("div", "aic-db-canvas-size");
  const canvas = node("div", "aic-db-canvas");
  canvasSizer.append(canvas);
  viewport.append(canvasSizer);
  const inspector = node("aside", "aic-db-inspector");
  inspector.setAttribute("aria-label", "Selected diagram element");
  const sourceNotice = node("div", "aic-db-source-notice");
  sourceNotice.id = `${markerPrefix}-source-notice`;
  sourceNotice.setAttribute("role", "note");
  sourceNotice.setAttribute("aria-label", "Visual editor availability");
  const sourceNoticeTitle = node(
    "strong",
    "",
    "Source only — visual editing unavailable",
  );
  const sourceNoticeReason = node("p");
  sourceNotice.append(sourceNoticeTitle, sourceNoticeReason);
  const code = node("textarea", "aic-db-source");
  code.setAttribute("aria-label", "Mermaid diagram source");
  code.spellcheck = false;
  code.readOnly = readOnly;
  code.value = source;
  code.addEventListener("input", () => {
    if (readOnly || destroyed) return;
    remember(source, code);
    source = code.value;
    parsed = parseDiagram(source);
    model = parsed.ok ? parsed.model : null;
    renderError = null;
    updateChrome();
  });
  code.addEventListener("blur", () => {
    coalescing = null;
  });
  const unwireSourceIndentation = wireCodeSourceIndentation(code);
  main.append(inspector, viewport, sourceNotice, code);
  const footer = node("footer", "aic-db-footer");
  const status = node("span", "aic-db-status");
  status.setAttribute("role", "status");
  const applyButton = button("Apply diagram changes", "check", () => apply());
  applyButton.classList.add("aic-db-apply");
  toolbar.insertBefore(applyButton, closeButton);
  footer.append(status);
  element.append(toolbar, paletteHost, main, footer);

  viewport.addEventListener("dragover", (event) => {
    if (readOnly || !palette?.canDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  viewport.addEventListener("drop", (event) => {
    if (readOnly) return;
    const module = palette?.readDrop(event.dataTransfer);
    if (!module) return;
    event.preventDefault();
    event.stopPropagation();
    addElement(module);
  });
  viewport.addEventListener("click", (event) => {
    if (
      event.target === viewport ||
      event.target === canvasSizer ||
      event.target === canvas ||
      event.target.classList?.contains("aic-db-rendered")
    )
      select(null);
  });

  function remember(before, token = null) {
    if (!token || coalescing !== token) {
      undo.push(before);
      if (undo.length > 100) undo.shift();
    }
    coalescing = token;
    redo.length = 0;
  }
  function change(operation, { token = null, keepInspector = false } = {}) {
    if (readOnly || !model || destroyed) return false;
    if (invalidDraft && invalidDraft.input !== token) {
      invalidDraft.input?.focus();
      return false;
    }
    const backup = JSON.stringify(model);
    const before = source;
    try {
      if (operation(model) === false) return false;
      // A no-op must preserve original bytes, including legacy layout comments.
      if (JSON.stringify(model) === backup) {
        invalidDraft = null;
        updateChrome();
        return false;
      }
      // Coordinates are a backward-reader detail, never part of visual editing.
      for (const node of model.nodes) {
        delete node.x;
        delete node.y;
      }
      const after = serializeDiagram(model);
      invalidDraft = null;
      if (after === before) {
        updateChrome();
        return false;
      }
      remember(before, token);
      source = after;
      parsed = { ok: true, model };
      renderCanvas();
      if (!keepInspector) renderInspector();
      updateChrome();
      return true;
    } catch (error) {
      model = JSON.parse(backup);
      invalidDraft = token
        ? {
            input: token,
            message:
              error instanceof Error
                ? error.message
                : "This change is not supported.",
          }
        : null;
      updateChrome();
      if (!token)
        status.textContent =
          error instanceof Error
            ? error.message
            : "This change is not supported.";
      return false;
    }
  }
  function travel(from, to) {
    if (readOnly || !from.length) return;
    to.push(source);
    source = from.pop();
    parsed = parseDiagram(source);
    model = parsed.ok ? parsed.model : null;
    if (!model) mode = "source";
    selected = null;
    coalescing = null;
    connectionFrom = null;
    invalidDraft = null;
    render();
  }
  function toggleMode() {
    if (invalidDraft) {
      invalidDraft.input?.focus();
      return;
    }
    coalescing = null;
    if (mode === "visual") mode = "source";
    else {
      parsed = parseDiagram(source);
      if (!parsed.ok) {
        updateChrome();
        return;
      }
      model = parsed.model;
      mode = "visual";
    }
    render();
    if (mode === "source") code.focus();
  }
  function updateChrome() {
    const visual = mode === "visual";
    footer.hidden =
      visual &&
      !invalidDraft &&
      !applyBlockedReason &&
      !connectionFrom &&
      !copyError;
    title.textContent = model
      ? {
          flowchart: "Flowchart",
          classDiagram: "Class",
          sequenceDiagram: "Sequence",
        }[model.type]
      : "Mermaid";
    modeButton.setAttribute(
      "aria-label",
      visual ? "Edit Mermaid source" : "Edit diagram visually",
    );
    modeButton.title = modeButton.getAttribute("aria-label");
    modeButton.firstChild.dataset.icon = visual ? "code" : "diagram";
    modeButton.disabled = !visual && !parsed.ok;
    modeButton.hidden = !visual && !parsed.ok;
    undoButton.disabled = readOnly || !undo.length;
    redoButton.disabled = readOnly || !redo.length;
    paletteHost.hidden = !visual;
    const profile = diagramProfile();
    const nextPaletteType = model ? `${model.type}:${profile || ""}` : null;
    if (model && paletteType !== nextPaletteType) {
      palette?.destroy();
      paletteType = nextPaletteType;
      palette = createDiagramPalette(document, {
        type: model.type,
        profile,
        readOnly,
        onInsert: (module) => addElement(module),
      });
      paletteHost.replaceChildren(palette.element);
    }
    alternativeButton.hidden = !visual || model?.type !== "sequenceDiagram";
    alternativeButton.disabled = readOnly;
    zoomOut.hidden = zoomIn.hidden = fitButton.hidden = !visual;
    applyButton.disabled = readOnly || !applyEnabled || Boolean(invalidDraft);
    viewport.hidden = inspector.hidden = !visual;
    code.hidden = visual;
    sourceNotice.hidden = visual || (parsed.ok && !renderError);
    if (!sourceNotice.hidden) {
      sourceNoticeReason.textContent = `${renderError || `Line ${parsed.line}: ${parsed.reason}`} Your original text is retained. ${readOnly ? "This diagram is read-only." : "Edit the source below; visual controls return when its syntax is supported."}`;
      code.setAttribute("aria-describedby", sourceNotice.id);
    } else code.removeAttribute("aria-describedby");
    main.classList.toggle("aic-db-source-mode", !visual);
    if (copyError) status.textContent = copyError;
    else if (applyBlockedReason) status.textContent = applyBlockedReason;
    else if (invalidDraft)
      status.textContent = `${invalidDraft.message} Correct this field before applying. Copy uses the last valid Mermaid source; this invalid field text remains only in its field.`;
    else if (!parsed.ok)
      status.textContent =
        "Apply changes this block. Save the document separately.";
    else if (connectionFrom)
      status.textContent =
        "Connect: drag to another element, or select its connection handle. Escape cancels.";
    else if (!visual)
      status.textContent =
        "Mermaid source is the document. Apply changes this block; save the document separately.";
    else if (model.type === "sequenceDiagram")
      status.textContent =
        "Mermaid arranges participants. Select a message to change its order.";
    else
      status.textContent =
        "Drag a module to add it; connect round handles. Mermaid arranges the diagram.";
  }
  function diagramProfile() {
    return model?.type === "flowchart" &&
      model.comments.some((comment) =>
        /^\s*%%\s*aic:entity-map\s*$/.test(comment),
      )
      ? "entity-map"
      : null;
  }
  function elementChoices() {
    return diagramElements(model.type, diagramProfile());
  }
  function relationshipChoices() {
    return diagramProfile() === "entity-map"
      ? [
          { value: "-->", label: "Association" },
          { value: "-.->", label: "Dependency" },
          { value: "==>", label: "Emphasized association" },
          { value: "---", label: "Association without direction" },
        ]
      : DIAGRAM_RELATIONSHIPS[model.type];
  }
  function select(value, { focus = false } = {}) {
    if (invalidDraft) {
      invalidDraft.input?.focus();
      return;
    }
    selected = value;
    coalescing = null;
    for (const target of canvas.querySelectorAll("[data-select]"))
      target.classList.toggle("is-selected", target.dataset.select === value);
    renderInspector();
    if (focus && value)
      canvas.querySelector(`[data-select="${value}"]`)?.focus();
  }
  function addElement(module = {}) {
    if (!model) return;
    const id = nextDiagramId(model.nodes, "N");
    change((draft) => {
      draft.nodes.push({
        id,
        label: module.label || elementChoices()[0].label,
        kind:
          module.kind ||
          (draft.type === "classDiagram"
            ? "class"
            : draft.type === "sequenceDiagram"
              ? "participant"
              : "rectangle"),
        members: [],
      });
      selected = `node:${id}`;
    });
    inspector.querySelector("input")?.focus();
  }
  function addAlternative() {
    change((draft) => {
      for (const [kind, label] of [
        ["alt", "Condition"],
        ["else", "Otherwise"],
        ["end", ""],
      ]) {
        draft.steps.push({ id: nextDiagramId(draft.steps, "S"), kind, label });
      }
    });
  }
  function connect(from, to) {
    connectionFrom = null;
    change((draft) => {
      const id = nextDiagramId(draft.edges, "E");
      draft.edges.push({
        id,
        from,
        to,
        kind: draft.type === "sequenceDiagram" ? "->>" : "-->",
        label: draft.type === "sequenceDiagram" ? "Message" : "",
      });
      if (draft.type === "sequenceDiagram") {
        const step = {
          id: nextDiagramId(draft.steps, "S"),
          kind: "message",
          edgeId: id,
        };
        const selectedStep = selected?.startsWith("step:")
          ? draft.steps.findIndex(({ id }) => id === selected.slice(5))
          : -1;
        // Selecting a fragment header appends inside that branch, not outside its end.
        if (selectedStep >= 0 && draft.steps[selectedStep].kind !== "end")
          draft.steps.splice(selectedStep + 1, 0, step);
        else draft.steps.push(step);
      }
      selected = `edge:${id}`;
    });
    updateChrome();
  }
  function startConnection(event, id) {
    event.stopPropagation();
    if (readOnly) return;
    if (event.type === "click") {
      if (suppressPortClick) {
        suppressPortClick = false;
        return;
      }
      if (connectionFrom) connect(connectionFrom, id);
      else {
        connectionFrom = id;
        updateChrome();
      }
    } else {
      dragging = {
        kind: "connection",
        from: id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    }
  }
  function sizeCanvas() {
    const width = Number(canvas.dataset.width || 1);
    const height = Number(canvas.dataset.height || 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvasSizer.style.width = `${width * zoom}px`;
    canvasSizer.style.height = `${height * zoom}px`;
    canvas.style.transform = `scale(${zoom})`;
  }
  function renderCanvas() {
    const epoch = ++renderEpoch;
    renderAbort?.abort();
    renderAbort = new document.defaultView.AbortController();
    const signal = renderAbort.signal;
    if (!model || mode !== "visual") return;
    const snapshot = JSON.parse(JSON.stringify(model));
    const renderedSource = source;
    element.dataset.renderState = "pending";
    element.setAttribute("aria-busy", "true");
    // Keep the previous SVG visible while rendering; context fields keep focus.
    canvas.inert = true;
    renderPromise = Promise.resolve()
      .then(() =>
        options.render
          ? options.render(renderedSource, options.theme || "default")
          : renderMermaidSvg(document, {
              source: renderedSource,
              theme: options.theme,
              signal,
            }),
      )
      .then((markup) => {
        if (destroyed || epoch !== renderEpoch) return false;
        const holder = document.createElement("div");
        holder.innerHTML = sanitizeMermaidSvg(markup, document);
        const svg = holder.querySelector("svg");
        svg.classList.add("aic-db-rendered");
        svg.removeAttribute("aria-hidden");
        svg.removeAttribute("inert");
        // Geometry APIs require a mounted SVG. Swap only after the async render.
        canvas.replaceChildren(svg);
        bindDiagramSvg(svg, snapshot, {
          readOnly,
          onSelect: (value) => select(value),
          onConnect: startConnection,
        });
        const bounds = (svg.getAttribute("viewBox") || "")
          .trim()
          .split(/[\s,]+/u)
          .map(Number);
        const width = bounds[2] || Number(svg.getAttribute("width")) || 1;
        const height = bounds[3] || Number(svg.getAttribute("height")) || 1;
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
        svg.style.maxWidth = "none";
        canvas.dataset.width = String(width);
        canvas.dataset.height = String(height);
        sizeCanvas();
        for (const target of canvas.querySelectorAll("[data-select]"))
          target.classList.toggle(
            "is-selected",
            target.dataset.select === selected,
          );
        canvas.inert = false;
        renderError = null;
        element.dataset.renderState = "ready";
        element.dataset.renderRevision = String(epoch);
        element.setAttribute("aria-busy", "false");
        options.onRender?.();
        return true;
      })
      .catch((error) => {
        if (destroyed || epoch !== renderEpoch) return false;
        renderError =
          error instanceof Error
            ? error.message
            : "Mermaid could not render this diagram.";
        element.dataset.renderState = "error";
        element.setAttribute("aria-busy", "false");
        mode = "source";
        code.value = source;
        updateChrome();
        options.onRender?.();
        return false;
      });
  }

  function field(
    label,
    value,
    onInput,
    {
      multiline = false,
      choices,
      parent = inspector,
      role = "label",
      placeholder = label,
    } = {},
  ) {
    const wrapper = node("label", "aic-db-field");
    wrapper.dataset.fieldRole = role;
    wrapper.append(node("span", "aic-db-field-label", label));
    const input = node(choices ? "select" : multiline ? "textarea" : "input");
    input.setAttribute("aria-label", label);
    if (!choices) input.placeholder = placeholder;
    if (choices)
      for (const choice of choices) {
        const option = node("option", "", choice.label);
        option.value = choice.value;
        input.append(option);
      }
    input.value = value;
    input.disabled = readOnly;
    input.addEventListener(choices ? "change" : "input", () =>
      onInput(input.value, input),
    );
    input.addEventListener("blur", () => {
      coalescing = null;
    });
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  }
  function closePopover({ restoreFocus = false } = {}) {
    if (!openPopover) return true;
    if (invalidDraft && openPopover.panel.contains(invalidDraft.input)) {
      invalidDraft.input?.focus();
      return false;
    }
    const { panel, trigger } = openPopover;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    openPopover = null;
    if (restoreFocus) trigger.focus();
    options.onRender?.();
    return true;
  }
  function popover(kind, label, icon) {
    const panel = node("div", "aic-db-popover");
    panel.dataset.popover = kind;
    panel.id = `${markerPrefix}-${kind}`;
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", label);
    const trigger = button(label, icon, () => {
      if (openPopover?.panel === panel) {
        closePopover({ restoreFocus: true });
        return;
      }
      if (!closePopover()) return;
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      openPopover = { panel, trigger };
      panel
        .querySelector(
          "input:enabled,select:enabled,textarea:enabled,button:enabled",
        )
        ?.focus();
      options.onRender?.();
    });
    trigger.classList.add("aic-db-popover-toggle");
    trigger.dataset.popover = kind;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", panel.id);
    inspector.append(trigger, panel);
    return panel;
  }
  function outsidePopover(event) {
    if (
      openPopover &&
      !openPopover.panel.contains(event.target) &&
      !openPopover.trigger.contains(event.target)
    )
      closePopover();
  }
  function renderInspector() {
    openPopover = null;
    inspector.replaceChildren();
    if (!model) return;
    const type = selected?.split(":")[0];
    const id = selected?.slice(selected.indexOf(":") + 1);
    const item =
      type === "node"
        ? model.nodes.find((node) => node.id === id)
        : type === "edge"
          ? model.edges.find((edge) => edge.id === id)
          : type === "step"
            ? model.steps.find((step) => step.id === id)
            : null;
    if (!item) {
      inspector.dataset.selectionKind = "diagram";
      inspector.setAttribute(
        "aria-label",
        readOnly ? "Diagram settings · read-only" : "Diagram settings",
      );
      if (model.type !== "sequenceDiagram")
        field(
          "Direction",
          model.direction,
          (value, token) =>
            change(
              (draft) => {
                draft.direction = value;
              },
              { token, keepInspector: true },
            ),
          {
            role: "direction",
            choices: ["TB", "LR", "BT", "RL"].map((value) => ({
              value,
              label: {
                TB: "Top to bottom",
                LR: "Left to right",
                BT: "Bottom to top",
                RL: "Right to left",
              }[value],
            })),
          },
        );
      else if (
        model.steps.some(
          (step) => step.kind !== "message" && step.kind !== "end",
        )
      )
        field(
          "Fragment",
          "",
          (value) => select(value ? `step:${value}` : null),
          {
            role: "type",
            choices: [
              { value: "", label: "Select a branch" },
              ...model.steps
                .filter(
                  (step) => step.kind !== "message" && step.kind !== "end",
                )
                .map((step) => ({
                  value: step.id,
                  label: `${step.kind}: ${step.label}`,
                })),
            ],
          },
        );
      return;
    }
    inspector.dataset.selectionKind = type;
    inspector.setAttribute(
      "aria-label",
      type === "node"
        ? `${elementChoices().find(({ kind }) => kind === item.kind)?.label || "Entity"} properties`
        : type === "edge"
          ? model.type === "sequenceDiagram"
            ? "Message properties"
            : "Relationship properties"
          : "Fragment properties",
    );
    if (type === "node")
      field(
        "Element type",
        item.kind,
        (value, token) => {
          change(
            (draft) => {
              draft.nodes.find((node) => node.id === id).kind = value;
            },
            { token, keepInspector: true },
          );
          inspector.setAttribute(
            "aria-label",
            `${elementChoices().find(({ kind }) => kind === value)?.label || "Entity"} properties`,
          );
        },
        {
          role: "type",
          choices: elementChoices().map(({ kind, label }) => ({
            value: kind,
            label,
          })),
        },
      );
    else if (type === "edge")
      field(
        "Relationship type",
        item.kind,
        (value, token) =>
          change(
            (draft) => {
              draft.edges.find((edge) => edge.id === id).kind = value;
            },
            { token, keepInspector: true },
          ),
        { role: "type", choices: relationshipChoices() },
      );
    if (item.kind !== "end")
      field(
        type === "node"
          ? "Label"
          : type === "edge"
            ? "Message / event"
            : "Condition",
        item.label,
        (value, token) =>
          change(
            (draft) => {
              const target =
                type === "node"
                  ? draft.nodes.find((node) => node.id === id)
                  : type === "edge"
                    ? draft.edges.find((edge) => edge.id === id)
                    : draft.steps.find((step) => step.id === id);
              target.label = value;
            },
            { token, keepInspector: true },
          ),
        {
          placeholder:
            type === "node"
              ? "Name"
              : type === "edge"
                ? model.type === "sequenceDiagram"
                  ? "Message"
                  : "Event / description"
                : "Condition",
        },
      );
    if (type === "node") {
      if (model.type === "classDiagram") {
        const members = popover("members", "Entity members", "members");
        field(
          "Properties and operations · one per line",
          item.members.join("\n"),
          (value, token) =>
            change(
              (draft) => {
                draft.nodes.find((node) => node.id === id).members = value
                  .split("\n")
                  .filter((line) => line.trim());
              },
              { token, keepInspector: true },
            ),
          { multiline: true, parent: members, role: "members" },
        );
      }
      if (model.type === "sequenceDiagram") {
        const controls = node("div", "aic-db-actions");
        for (const [delta, label, icon] of [
          [-1, "Move participant left", "left"],
          [1, "Move participant right", "right"],
        ]) {
          const control = button(label, icon, () =>
            change((draft) => {
              const at = draft.nodes.findIndex((node) => node.id === id),
                to = at + delta;
              if (to < 0 || to >= draft.nodes.length) return false;
              [draft.nodes[at], draft.nodes[to]] = [
                draft.nodes[to],
                draft.nodes[at],
              ];
            }),
          );
          control.disabled = readOnly;
          controls.append(control);
        }
        inspector.append(controls);
      }
      const relationships = model.edges.filter(
        (edge) => edge.from === id || edge.to === id,
      );
      if (relationships.length) {
        const connections = popover(
          "relations",
          `${model.type === "sequenceDiagram" ? "Messages" : "Relationships"} (${relationships.length})`,
          "relationships",
        );
        connections.classList.add("aic-db-context-relations");
        const list = node("ul", "aic-db-relations");
        list.setAttribute("aria-label", `${item.label} relationships`);
        for (const edge of relationships) {
          const from = model.nodes.find((node) => node.id === edge.from);
          const to = model.nodes.find((node) => node.id === edge.to);
          const route =
            edge.from === edge.to
              ? "Self"
              : edge.from === id
                ? `To ${to.label}`
                : `From ${from.label}`;
          const kind = relationshipChoices().find(
            (relationship) => relationship.value === edge.kind,
          )?.label;
          const row = node("li");
          const control = node(
            "button",
            "aic-db-relation-link",
            `${route} — ${edge.label || kind || edge.kind}`,
          );
          control.type = "button";
          control.dataset.edgeId = edge.id;
          control.addEventListener("click", () => {
            if (invalidDraft) {
              invalidDraft.input?.focus();
              return;
            }
            select(`edge:${edge.id}`);
            inspector
              .querySelector('[data-field-role="label"] input:enabled')
              ?.focus();
          });
          row.append(control);
          list.append(row);
        }
        connections.append(list);
      }
    } else if (type === "edge") {
      const endpoints = popover(
        "endpoint",
        "Connection endpoints",
        "endpoints",
      );
      for (const endpoint of ["from", "to"])
        field(
          endpoint === "from" ? "From" : "To",
          item[endpoint],
          (value, token) => {
            change(
              (draft) => {
                draft.edges.find((edge) => edge.id === id)[endpoint] = value;
              },
              { token, keepInspector: true },
            );
            const current = model.edges.find((edge) => edge.id === id);
            reverse.disabled = readOnly || current.from === current.to;
          },
          {
            parent: endpoints,
            role: endpoint,
            choices: model.nodes.map((node) => ({
              value: node.id,
              label: node.label,
            })),
          },
        );
      const reverse = button("Reverse direction", "reverse", () =>
        change((draft) => {
          const target = draft.edges.find((edge) => edge.id === id);
          [target.from, target.to] = [target.to, target.from];
        }),
      );
      reverse.disabled = readOnly || item.from === item.to;
      inspector.append(reverse);
      if (model.type === "sequenceDiagram") {
        const controls = node("div", "aic-db-actions");
        for (const [delta, label, icon] of [
          [-1, "Move message earlier", "up"],
          [1, "Move message later", "down"],
        ]) {
          const control = button(label, icon, () =>
            change((draft) => moveSequenceMessage(draft, id, delta)),
          );
          const at = model.steps.findIndex(({ edgeId }) => edgeId === id);
          control.disabled =
            readOnly || model.steps[at + delta]?.kind !== "message";
          controls.append(control);
        }
        inspector.append(controls);
      }
    }
    if (type !== "step") {
      const remove = button("Delete selected element", "delete", () =>
        change((draft) => {
          if (type === "node")
            draft.nodes = draft.nodes.filter((node) => node.id !== id);
          draft.edges = draft.edges.filter((edge) =>
            type === "node"
              ? edge.from !== id && edge.to !== id
              : edge.id !== id,
          );
          const edgeIds = new Set(draft.edges.map(({ id }) => id));
          draft.steps = draft.steps.filter(
            (step) => step.kind !== "message" || edgeIds.has(step.edgeId),
          );
          selected = null;
        }),
      );
      remove.disabled = readOnly;
      inspector.append(remove);
    }
  }
  function pointerMove(event) {
    if (!dragging || dragging.pointerId !== event.pointerId || destroyed)
      return;
    if (
      Math.abs(event.clientX - dragging.startX) +
        Math.abs(event.clientY - dragging.startY) >=
      5
    )
      dragging.moved = true;
  }
  function pointerUp(event) {
    if (dragging?.pointerId !== event.pointerId) return;
    const drag = dragging;
    dragging = null;
    if (!drag.moved || destroyed) return;
    suppressPortClick = true;
    const target = document
      .elementFromPoint?.(event.clientX, event.clientY)
      ?.closest("[data-node-id]");
    if (target && canvas.contains(target))
      connect(drag.from, target.dataset.nodeId);
    // A browser-generated click follows pointerup; keyboard/click handles remain usable.
    window?.setTimeout(() => {
      suppressPortClick = false;
    }, 0);
  }
  function pointerCancel(event) {
    if (dragging?.pointerId === event.pointerId) dragging = null;
  }
  function setZoom(value) {
    zoom = Math.max(0.3, Math.min(2, value));
    sizeCanvas();
  }
  function fit() {
    const width = Number.parseFloat(canvas.style.width),
      height = Number.parseFloat(canvas.style.height);
    setZoom(
      Math.min(
        1,
        (viewport.clientWidth - 24) / width,
        (viewport.clientHeight - 24) / height,
      ),
    );
    viewport.scrollTop = viewport.scrollLeft = 0;
  }
  function render() {
    code.value = source;
    renderCanvas();
    renderInspector();
    updateChrome();
  }
  function apply() {
    if (destroyed || readOnly || !applyEnabled) return false;
    if (invalidDraft) {
      invalidDraft.input?.focus();
      return false;
    }
    try {
      if (options.onApply?.(source) === false) {
        status.textContent =
          "The document changed while this diagram was open. Reopen the diagram before applying.";
        return false;
      }
      return true;
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "The diagram could not be applied.";
      return false;
    }
  }
  function keydown(event) {
    if (event.key === "Escape" && openPopover) {
      event.preventDefault();
      event.stopPropagation();
      closePopover({ restoreFocus: true });
      return;
    }
    if (event.key === "Escape" && connectionFrom) {
      event.preventDefault();
      event.stopPropagation();
      connectionFrom = null;
      updateChrome();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      travel(event.shiftKey ? redo : undo, event.shiftKey ? undo : redo);
    }
  }
  window?.addEventListener("pointermove", pointerMove);
  window?.addEventListener("pointerup", pointerUp);
  window?.addEventListener("pointercancel", pointerCancel);
  element.addEventListener("keydown", keydown);
  document.addEventListener("pointerdown", outsidePopover);
  render();
  return {
    element,
    apply,
    getSource: () => source,
    setApplyBlocked(reason) {
      applyEnabled = false;
      applyBlockedReason = reason;
      updateChrome();
    },
    whenRendered: () => renderPromise,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      renderEpoch++;
      renderAbort?.abort();
      dragging = null;
      unwireSourceIndentation();
      palette?.destroy();
      window?.removeEventListener("pointermove", pointerMove);
      window?.removeEventListener("pointerup", pointerUp);
      window?.removeEventListener("pointercancel", pointerCancel);
      element.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outsidePopover);
      element.remove();
    },
  };
}

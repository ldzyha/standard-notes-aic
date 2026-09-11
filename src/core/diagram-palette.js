/** A local palette, not an import surface. Only its own active drag is accepted. */
export const DIAGRAM_PALETTE_MIME = "application/x-aic-diagram-element+json";

// Mermaid geometry is a serialization detail. This shared vocabulary names the
// role a user inserts or edits; it does not infer domain meaning from a shape.
export const DIAGRAM_ELEMENTS = Object.freeze({
  flowchart: [
    { kind: "rectangle", label: "State", action: "Add state" },
    { kind: "rounded", label: "Event", action: "Add event" },
    { kind: "diamond", label: "Condition", action: "Add condition" },
  ],
  classDiagram: [{ kind: "class", label: "Entity", action: "Add entity" }],
  sequenceDiagram: [
    { kind: "participant", label: "Participant", action: "Add participant" },
    { kind: "actor", label: "Actor", action: "Add actor" },
  ],
});
const entityMapElements = Object.freeze([
  { kind: "rectangle", label: "Entity", action: "Add entity" },
  ...DIAGRAM_ELEMENTS.flowchart.slice(1),
]);

export function diagramElements(type, profile = null) {
  return type === "flowchart" && profile === "entity-map"
    ? entityMapElements
    : DIAGRAM_ELEMENTS[type];
}

function randomToken(document) {
  const crypto = document.defaultView?.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  // Keyboard/click insertion still works if a host has no secure random source.
  return null;
}

export function createDiagramPalette(
  document,
  { type, profile = null, readOnly = false, onInsert },
) {
  if (!Object.hasOwn(DIAGRAM_ELEMENTS, type))
    throw new TypeError("Unsupported diagram palette type");
  const items = diagramElements(type, profile);
  const paletteId = randomToken(document);
  let activeDrag = null;
  let destroyed = false;
  const cleanups = [];
  const element = document.createElement("div");
  element.className = "aic-diagram-palette";
  element.setAttribute("role", "group");
  element.setAttribute(
    "aria-label",
    "Diagram elements · drag onto canvas or activate to insert",
  );

  function listen(target, type, listener) {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  }
  function descriptor(item) {
    return Object.freeze({ kind: item.kind, label: item.label });
  }
  function hasPaletteType(dataTransfer) {
    return Array.from(dataTransfer?.types ?? []).includes(DIAGRAM_PALETTE_MIME);
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "aic-diagram-palette-item";
    button.dataset.diagramKind = item.kind;
    button.setAttribute("aria-label", item.action);
    button.title = `${item.action} · drag onto canvas`;
    button.disabled = readOnly;
    button.draggable = !readOnly && Boolean(paletteId);
    const label = document.createElement("span");
    label.className = "aic-diagram-palette-label";
    label.textContent = item.label;
    button.append(label);
    // Native buttons supply Enter/Space activation and focus semantics.
    listen(button, "click", () => {
      if (!destroyed && !readOnly) onInsert?.(descriptor(item));
    });
    listen(button, "dragstart", (event) => {
      const dataTransfer = event.dataTransfer;
      const dragId = randomToken(document);
      if (destroyed || readOnly || !paletteId || !dragId || !dataTransfer) {
        event.preventDefault();
        return;
      }
      activeDrag = { paletteId, dragId, kind: item.kind };
      dataTransfer.effectAllowed = "copy";
      dataTransfer.setData(
        DIAGRAM_PALETTE_MIME,
        JSON.stringify({ version: 1, type, ...activeDrag }),
      );
    });
    listen(button, "dragend", () => {
      activeDrag = null;
    });
    element.append(button);
  }

  return {
    element,
    // getData() is intentionally unavailable during browser dragover. The local
    // active drag plus MIME lets the canvas opt in; readDrop validates on drop.
    canDrop(dataTransfer) {
      return (
        !destroyed &&
        !readOnly &&
        Boolean(activeDrag) &&
        hasPaletteType(dataTransfer)
      );
    },
    readDrop(dataTransfer) {
      if (destroyed || readOnly || !activeDrag || !hasPaletteType(dataTransfer))
        return null;
      try {
        const text = dataTransfer.getData(DIAGRAM_PALETTE_MIME);
        if (typeof text !== "string" || text.length > 512) return null;
        const payload = JSON.parse(text);
        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          Object.keys(payload).length !== 5 ||
          payload.version !== 1 ||
          payload.type !== type ||
          payload.paletteId !== paletteId ||
          payload.dragId !== activeDrag.dragId ||
          payload.kind !== activeDrag.kind
        )
          return null;
        const item = items.find(({ kind }) => kind === payload.kind);
        return item ? descriptor(item) : null;
      } catch {
        return null;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeDrag = null;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      element.remove();
    },
  };
}

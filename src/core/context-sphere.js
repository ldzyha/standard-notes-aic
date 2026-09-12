const SVG_NS = "http://www.w3.org/2000/svg";
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const unit = (value, fallback) =>
  Number.isFinite(value) ? clamp(value, 0, 1) : fallback;

function normalizeGraph(graph = {}) {
  const nodes = [
    ...new Map(
      (graph.nodes ?? [])
        .filter((node) => typeof node.id === "string" && node.id)
        .map((node) => [node.id, { ...node, label: node.label || node.id }]),
    ).values(),
  ].sort((a, b) => compare(a.id, b.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [
    ...new Map(
      (graph.edges ?? [])
        .filter(
          (edge) =>
            ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to,
        )
        .map((edge) => [
          JSON.stringify([edge.id, edge.from, edge.to, edge.kind]),
          edge,
        ]),
    ).values(),
  ].sort((a, b) => compare(a.id, b.id));
  return {
    nodes,
    edges,
    activeId: graph.activeId ?? null,
    limited: Boolean(graph.limited),
  };
}

function topologyKey(graph) {
  return JSON.stringify([
    graph.nodes.map(({ id }) => id),
    [
      ...new Set(
        graph.edges.map(({ from, to }) =>
          JSON.stringify([from, to].sort(compare)),
        ),
      ),
    ].sort(compare),
  ]);
}

/** Uniform spherical slots, with deterministic swaps that shorten dependencies.
 * Status, active file, labels, edge ordering and duplicate edge kinds cannot move
 * the slots. This is deliberately a finite layout, never a live force simulation.
 */
export function layoutContextSphere(input) {
  const graph = normalizeGraph(input);
  const count = graph.nodes.length;
  const points = graph.nodes.map((node, index) => {
    const y = count === 1 ? 0 : 1 - (2 * (index + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    return {
      id: node.id,
      x: count === 1 ? 0 : Math.cos(index * GOLDEN_ANGLE) * radius,
      y,
      z: count === 1 ? 1 : Math.sin(index * GOLDEN_ANGLE) * radius,
    };
  });
  const indices = new Map(points.map(({ id }, index) => [id, index]));
  const neighbors = points.map(() => new Set());
  for (const edge of graph.edges) {
    const from = indices.get(edge.from);
    const to = indices.get(edge.to);
    neighbors[from].add(to);
    neighbors[to].add(from);
  }
  const distance = (a, b) =>
    (points[a].x - points[b].x) ** 2 +
    (points[a].y - points[b].y) ** 2 +
    (points[a].z - points[b].z) ** 2;
  const slots = points.map((_, index) => index);
  // Four bounded passes improve proximity while retaining every uniform slot.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        let delta = 0;
        for (const other of neighbors[a]) {
          if (other !== b)
            delta +=
              distance(slots[b], slots[other]) -
              distance(slots[a], slots[other]);
        }
        for (const other of neighbors[b]) {
          if (other !== a)
            delta +=
              distance(slots[a], slots[other]) -
              distance(slots[b], slots[other]);
        }
        if (delta < -0.000001) {
          [slots[a], slots[b]] = [slots[b], slots[a]];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return points.map(({ id }, index) => ({ ...points[slots[index]], id }));
}

function displayState(
  state,
  previous = { expanded: false, position: { x: 0.5, y: 0.5 } },
) {
  return {
    expanded:
      typeof state?.expanded === "boolean" ? state.expanded : previous.expanded,
    position: {
      x: unit(state?.position?.x, previous.position.x),
      y: unit(state?.position?.y, previous.position.y),
    },
  };
}

function describeNode(node, linked) {
  return [
    node.kind === "note" ? "Related note" : "File",
    node.open && "open",
    node.changed && "changed",
    node.dirty && "unsaved",
    node.pinned && "pinned",
    node.provisional && "provisional",
    !linked && "no known links",
    node.analysis === "partial" && "analysis incomplete",
    node.analysis === "unavailable" && "analysis unavailable",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Mount in a dedicated region above the editor; nothing is attached to body. */
export function createContextSphere(container, options = {}) {
  const document = container.ownerDocument;
  const view = document.defaultView;
  const cleanups = [];
  const entries = new Map();
  let graph = normalizeGraph();
  let state = displayState(options.state);
  let layout = [];
  let key = "";
  let activeId = null;
  let detailId = null;
  let destroyed = false;
  let hoverSuppressed = false;
  let drag = null;
  let frame = null;
  let orientation = { yaw: 0, pitch: 0 };
  let dimensions = { width: 320, size: 64, travelX: 240, travelY: 0 };
  const motion = view?.matchMedia?.("(prefers-reduced-motion: reduce)");

  function element(tag, className, parent) {
    const node = document.createElement(tag);
    node.className = className;
    parent?.append(node);
    return node;
  }
  function button(className, label, parent) {
    const node = element("button", className, parent);
    node.type = "button";
    node.textContent = label;
    return node;
  }
  function listen(target, event, callback) {
    target.addEventListener(event, callback);
    cleanups.push(() => target.removeEventListener(event, callback));
  }
  function svgElement(tag, attributes, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) =>
      node.setAttribute(name, String(value)),
    );
    parent.append(node);
    return node;
  }

  const root = element("section", "aic-context-sphere", container);
  root.setAttribute("aria-label", "File context sphere");
  const header = element("div", "aic-context-sphere-header", root);
  const heading = element("span", "aic-context-sphere-heading", header);
  heading.textContent = "Context";
  const count = element("span", "aic-context-sphere-count", header);
  const toggle = button("aic-context-sphere-toggle", "Expand", header);
  const stage = element("div", "aic-context-sphere-stage", root);
  const dock = element("div", "aic-context-sphere-dock", stage);
  const handle = button("aic-context-sphere-handle", "⠿", dock);
  handle.title = "Move sphere · drag or use arrow keys · Home to center";
  handle.setAttribute("aria-label", handle.title);
  const orb = element("div", "aic-context-sphere-orb", dock);
  const svg = svgElement(
    "svg",
    { viewBox: "0 0 240 240", "aria-hidden": "true", focusable: "false" },
    orb,
  );
  svgElement(
    "circle",
    { cx: 120, cy: 120, r: 116, class: "aic-context-sphere-shell" },
    svg,
  );
  svgElement(
    "ellipse",
    { cx: 120, cy: 120, rx: 116, ry: 42, class: "aic-context-sphere-grid" },
    svg,
  );
  svgElement(
    "ellipse",
    { cx: 120, cy: 120, rx: 42, ry: 116, class: "aic-context-sphere-grid" },
    svg,
  );
  const lines = svgElement("g", { class: "aic-context-sphere-edges" }, svg);
  const visualNodes = element("div", "aic-context-sphere-nodes", orb);
  const empty = element("span", "aic-context-sphere-empty", orb);
  empty.textContent = "○";
  empty.setAttribute("aria-hidden", "true");
  const expandedContent = element("div", "aic-context-sphere-content", root);
  const detail = element("div", "aic-context-sphere-detail", expandedContent);
  const detailText = element("span", "aic-context-sphere-detail-text", detail);
  const pin = button("aic-context-sphere-pin", "Pin", detail);
  const notice = element("p", "aic-context-sphere-notice", expandedContent);
  notice.setAttribute("role", "status");
  const legend = element("p", "aic-context-sphere-legend", expandedContent);
  legend.textContent =
    "Cyan: linked · Gray: no known links · Amber: changed · ◇: note · ?: analysis unavailable";
  const files = element("details", "aic-context-sphere-files", expandedContent);
  const summary = element("summary", "", files);
  summary.textContent = "Files and states";
  const list = element("ul", "aic-context-sphere-list", files);

  function emit() {
    options.onStateChange?.(displayState(state));
  }
  function showDetail(id) {
    detailId = id;
    const node = graph.nodes.find((item) => item.id === id);
    detailText.textContent = node
      ? `${node.path || node.label} · ${entries.get(id)?.description || ""}`
      : "No active file";
    pin.hidden = !node;
    pin.textContent = node?.pinned ? "Unpin" : "Pin";
    pin.setAttribute("aria-pressed", String(Boolean(node?.pinned)));
    pin.setAttribute(
      "aria-label",
      `${node?.pinned ? "Unpin" : "Pin"} ${node?.label || "file"}`,
    );
  }
  function measure() {
    if (destroyed) return;
    const width = Math.max(
      32,
      container.clientWidth || container.getBoundingClientRect().width || 320,
    );
    const size = Math.max(16, Math.min(state.expanded ? 240 : 52, width - 16));
    const height = state.expanded ? Math.max(220, size + 56) : 88;
    dimensions = {
      width,
      size,
      travelX: Math.max(0, width - size - 16),
      travelY: Math.max(0, height - size - 40),
    };
    stage.style.height = `${height}px`;
    dock.style.width = `${size}px`;
    orb.style.height = `${size}px`;
    moveDock();
    project();
  }
  function moveDock() {
    dock.style.left = `${8 + dimensions.travelX * state.position.x}px`;
    dock.style.top = `${8 + dimensions.travelY * state.position.y}px`;
  }
  function expand(expanded, notify = true) {
    if (destroyed) return;
    if (!expanded) hoverSuppressed = true;
    if (state.expanded === expanded) return;
    const focusInside =
      expandedContent.contains(document.activeElement) ||
      visualNodes.contains(document.activeElement);
    state = { ...state, expanded };
    applyDisplay();
    if (!expanded && focusInside) toggle.focus({ preventScroll: true });
    if (notify) emit();
  }
  function applyDisplay() {
    root.dataset.expanded = String(state.expanded);
    toggle.textContent = state.expanded ? "Collapse" : "Expand";
    toggle.setAttribute("aria-expanded", String(state.expanded));
    toggle.title = state.expanded
      ? "Collapse sphere · Escape"
      : "Expand context sphere";
    expandedContent.hidden = !state.expanded;
    for (const entry of entries.values())
      entry.node.tabIndex = state.expanded ? 0 : -1;
    measure();
  }
  function cancelRotation() {
    if (frame !== null) view?.cancelAnimationFrame?.(frame);
    frame = null;
    root.dataset.rotating = "false";
  }
  function rotateToActive(animate) {
    cancelRotation();
    const point = layout.find(({ id }) => id === graph.activeId);
    if (!point) return project();
    const yaw = Math.atan2(-point.x, point.z);
    const target = {
      yaw:
        orientation.yaw +
        Math.atan2(
          Math.sin(yaw - orientation.yaw),
          Math.cos(yaw - orientation.yaw),
        ),
      pitch: Math.atan2(point.y, Math.hypot(point.x, point.z)),
    };
    if (!animate || motion?.matches || !view?.requestAnimationFrame) {
      orientation = target;
      project();
      return;
    }
    const start = { ...orientation };
    let started = null;
    root.dataset.rotating = "true";
    const tick = (time) => {
      if (destroyed) return;
      started ??= time;
      const progress = Math.min(1, (time - started) / 420);
      const eased = 1 - (1 - progress) ** 3;
      orientation = {
        yaw: start.yaw + (target.yaw - start.yaw) * eased,
        pitch: start.pitch + (target.pitch - start.pitch) * eased,
      };
      project();
      if (progress < 1) frame = view.requestAnimationFrame(tick);
      else {
        frame = null;
        root.dataset.rotating = "false";
      }
    };
    frame = view.requestAnimationFrame(tick);
  }
  function project() {
    if (destroyed) return;
    const { size } = dimensions;
    const diameter = Math.min(
      state.expanded ? 23 : 5,
      size / Math.max(7, Math.sqrt(layout.length) * 2),
    );
    const radius = Math.max(1, size * 0.455 - diameter / 2);
    const cy = Math.cos(orientation.yaw),
      sy = Math.sin(orientation.yaw);
    const cp = Math.cos(orientation.pitch),
      sp = Math.sin(orientation.pitch);
    const projected = layout
      .map((point) => {
        const x = point.x * cy + point.z * sy;
        const z = -point.x * sy + point.z * cy;
        return {
          id: point.id,
          x: x * radius,
          y: (point.y * cp - z * sp) * radius,
          z: point.y * sp + z * cp,
        };
      })
      .sort((a, b) => b.z - a.z || compare(a.id, b.id));
    const placed = [];
    const minimum = diameter * 1.2;
    const fits = (x, y) =>
      x * x + y * y <= radius * radius + 0.01 &&
      placed.every((other) => Math.hypot(x - other.x, y - other.y) >= minimum);
    for (const point of projected) {
      if (!fits(point.x, point.y)) {
        const original = { x: point.x, y: point.y };
        let found = false;
        // Resolve front/back projection collisions locally, inside the shell.
        for (let ring = 1; ring <= 16 && !found; ring++) {
          const steps = Math.max(12, ring * 8);
          for (let step = 0; step < steps; step++) {
            const angle = (step * Math.PI * 2) / steps;
            const x = original.x + Math.cos(angle) * ring * minimum * 0.5;
            const y = original.y + Math.sin(angle) * ring * minimum * 0.5;
            if (fits(x, y)) {
              point.x = x;
              point.y = y;
              found = true;
              break;
            }
          }
        }
      }
      placed.push(point);
      const node = entries.get(point.id)?.node;
      if (!node) continue;
      node.style.width = `${diameter}px`;
      node.style.height = `${diameter}px`;
      node.style.left = `${size / 2 + point.x}px`;
      node.style.top = `${size / 2 + point.y}px`;
      node.style.zIndex = String(2 + Math.round((point.z + 1) * 10));
      node.style.setProperty(
        "--aic-context-depth",
        String(0.5 + (point.z + 1) * 0.25),
      );
    }
    const positions = new Map(placed.map((point) => [point.id, point]));
    for (const line of lines.children) {
      const from = positions.get(line.dataset.from);
      const to = positions.get(line.dataset.to);
      if (!from || !to) continue;
      line.setAttribute("x1", String(120 + (from.x * 240) / size));
      line.setAttribute("y1", String(120 + (from.y * 240) / size));
      line.setAttribute("x2", String(120 + (to.x * 240) / size));
      line.setAttribute("y2", String(120 + (to.y * 240) / size));
    }
  }
  function update(input) {
    if (destroyed) return;
    graph = normalizeGraph(input);
    const nextKey = topologyKey(graph);
    const topologyChanged = nextKey !== key;
    if (topologyChanged) {
      layout = layoutContextSphere(graph);
      key = nextKey;
    }
    const ids = new Set(graph.nodes.map(({ id }) => id));
    const linked = new Set(graph.edges.flatMap(({ from, to }) => [from, to]));
    for (const [id, entry] of entries) {
      if (!ids.has(id)) {
        const focused =
          entry.node === document.activeElement ||
          entry.row.contains(document.activeElement);
        entry.node.remove();
        entry.row.remove();
        entries.delete(id);
        if (focused) toggle.focus({ preventScroll: true });
      }
    }
    for (const data of graph.nodes) {
      let entry = entries.get(data.id);
      if (!entry) {
        const node = button("aic-context-sphere-node", "", visualNodes);
        node.dataset.nodeId = data.id;
        const mark = element("span", "aic-context-sphere-node-mark", node);
        mark.setAttribute("aria-hidden", "true");
        const row = element("li", "aic-context-sphere-file", list);
        row.dataset.nodeId = data.id;
        const open = button("aic-context-sphere-file-open", "", row);
        const badge = element("span", "aic-context-sphere-file-state", open);
        const label = element("span", "aic-context-sphere-file-label", open);
        const rowPin = button("aic-context-sphere-file-pin", "Pin", row);
        entry = { node, row, open, badge, label, rowPin, mark };
        entries.set(data.id, entry);
      }
      const description = describeNode(data, linked.has(data.id));
      entry.description = description;
      entry.label.textContent = data.label;
      entry.badge.textContent = description;
      entry.open.title = data.path || data.label;
      entry.node.setAttribute("aria-label", `${data.label} · ${description}`);
      entry.node.title = `${data.path || data.label}\n${description}`;
      entry.node.tabIndex = state.expanded ? 0 : -1;
      entry.rowPin.textContent = data.pinned ? "Unpin" : "Pin";
      entry.rowPin.setAttribute("aria-pressed", String(Boolean(data.pinned)));
      entry.rowPin.setAttribute(
        "aria-label",
        `${data.pinned ? "Unpin" : "Pin"} ${data.label}`,
      );
      entry.mark.textContent =
        data.analysis === "unavailable"
          ? "?"
          : data.analysis === "partial"
            ? "~"
            : data.kind === "note"
              ? "◇"
              : "";
      for (const target of [entry.node, entry.row]) {
        target.dataset.kind = data.kind || "file";
        target.dataset.linked = String(linked.has(data.id));
        target.dataset.active = String(data.id === graph.activeId);
        target.dataset.changed = String(Boolean(data.changed || data.dirty));
        target.dataset.pinned = String(Boolean(data.pinned));
        target.dataset.provisional = String(Boolean(data.provisional));
        target.dataset.open = String(Boolean(data.open));
        target.dataset.analysis = data.analysis || "unavailable";
      }
      if (data.id === graph.activeId)
        entry.open.setAttribute("aria-current", "true");
      else entry.open.removeAttribute("aria-current");
    }
    // Node buttons are keyed and never recreated on status or editor updates.
    lines.replaceChildren();
    for (const edge of graph.edges) {
      const line = svgElement(
        "line",
        { "data-from": edge.from, "data-to": edge.to, "data-kind": edge.kind },
        lines,
      );
      if (edge.label) svgElement("title", {}, line).textContent = edge.label;
    }
    const activeChanged = activeId !== graph.activeId;
    count.textContent = `${graph.nodes.length}${graph.limited ? "+" : ""} files`;
    empty.hidden = graph.nodes.length !== 0;
    orb.setAttribute(
      "aria-label",
      graph.nodes.length ? "File relationships" : "Empty context sphere",
    );
    notice.textContent =
      graph.nodes.length === 0
        ? "No files in context yet. The sphere stays available here."
        : graph.limited
          ? "Showing a bounded context. More files or links may exist."
          : "";
    notice.hidden = !notice.textContent;
    files.hidden = graph.nodes.length === 0;
    showDetail(activeChanged || !ids.has(detailId) ? graph.activeId : detailId);
    if (activeChanged || topologyChanged)
      rotateToActive(activeId !== null && activeChanged);
    else project();
    activeId = graph.activeId;
  }

  listen(toggle, "click", () => expand(!state.expanded));
  listen(dock, "pointerenter", (event) => {
    if (event.pointerType !== "touch" && !hoverSuppressed && !drag)
      expand(true);
  });
  listen(root, "pointerleave", () => {
    hoverSuppressed = false;
  });
  listen(orb, "click", (event) => {
    const node = event.target.closest(".aic-context-sphere-node");
    if (!state.expanded || !node) {
      expand(true);
      return;
    }
    const id = node.dataset.nodeId;
    showDetail(id);
    options.onOpen?.(id);
  });
  listen(visualNodes, "focusin", (event) => {
    const node = event.target.closest(".aic-context-sphere-node");
    if (node) showDetail(node.dataset.nodeId);
  });
  listen(visualNodes, "contextmenu", (event) => {
    const node = event.target.closest(".aic-context-sphere-node");
    if (!node || !state.expanded) return;
    event.preventDefault();
    showDetail(node.dataset.nodeId);
    pin.focus();
  });
  listen(pin, "click", () => {
    const node = graph.nodes.find(({ id }) => id === detailId);
    if (node) options.onPin?.(node.id, !node.pinned);
  });
  listen(list, "click", (event) => {
    const button = event.target.closest("button");
    const row = button?.closest("[data-node-id]");
    const node = graph.nodes.find(({ id }) => id === row?.dataset.nodeId);
    if (!node) return;
    if (button.classList.contains("aic-context-sphere-file-pin"))
      options.onPin?.(node.id, !node.pinned);
    else {
      showDetail(node.id);
      options.onOpen?.(node.id);
    }
  });
  listen(root, "keydown", (event) => {
    if (event.key === "Escape" && state.expanded) {
      event.preventDefault();
      event.stopPropagation();
      expand(false);
    }
  });
  listen(handle, "keydown", (event) => {
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key !== "Home" && !directions[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = directions[event.key];
    const step = event.shiftKey ? 0.2 : 0.05;
    state.position =
      event.key === "Home"
        ? { x: 0.5, y: 0.5 }
        : {
            x: unit(state.position.x + delta[0] * step, 0.5),
            y: unit(state.position.y + delta[1] * step, 0.5),
          };
    moveDock();
    emit();
  });
  listen(handle, "pointerdown", (event) => {
    if (event.button !== 0 || destroyed) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position: { ...state.position },
    };
    handle.setPointerCapture?.(event.pointerId);
    root.dataset.dragging = "true";
  });
  listen(handle, "pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    state.position = {
      x: dimensions.travelX
        ? unit(
            drag.position.x + (event.clientX - drag.x) / dimensions.travelX,
            drag.position.x,
          )
        : drag.position.x,
      y: dimensions.travelY
        ? unit(
            drag.position.y + (event.clientY - drag.y) / dimensions.travelY,
            drag.position.y,
          )
        : drag.position.y,
    };
    moveDock();
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const id = drag.id;
    drag = null;
    root.dataset.dragging = "false";
    if (handle.hasPointerCapture?.(id)) handle.releasePointerCapture(id);
    emit();
  }
  listen(handle, "pointerup", endDrag);
  listen(handle, "pointercancel", endDrag);
  listen(handle, "lostpointercapture", endDrag);
  const observer = view?.ResizeObserver
    ? new view.ResizeObserver(measure)
    : null;
  observer?.observe(container);
  if (!observer && view) listen(view, "resize", measure);
  if (motion?.addEventListener)
    listen(motion, "change", () => rotateToActive(false));
  applyDisplay();
  update({ nodes: [], edges: [], activeId: null });
  return {
    update,
    setState(next) {
      if (destroyed) return;
      const previousExpanded = state.expanded;
      const focusInside =
        expandedContent.contains(document.activeElement) ||
        visualNodes.contains(document.activeElement);
      state = displayState(next, state);
      if (previousExpanded && !state.expanded) hoverSuppressed = true;
      applyDisplay();
      if (previousExpanded && !state.expanded && focusInside)
        toggle.focus({ preventScroll: true });
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      cancelRotation();
      observer?.disconnect();
      if (drag && handle.hasPointerCapture?.(drag.id))
        handle.releasePointerCapture(drag.id);
      drag = null;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      entries.clear();
      root.remove();
    },
  };
}

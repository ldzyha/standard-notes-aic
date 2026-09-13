const BEFORE = "cm-aic-security-drop-before";
const AFTER = "cm-aic-security-drop-after";
const SHORTCUTS = ["Alt+ArrowUp", "Alt+ArrowDown"];

/** Handle-only reordering. This controller never reads or transports item data. */
export function wirePreviewReorder({ root, items, canMove, onMove, onStart }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const ownedHandles = new Map();
  let disposed = false;
  let gesture = null;
  let marker = null;
  let suppressClick = null;

  function snapshot() {
    try {
      const list = items();
      if (!Array.isArray(list) || list.length > 4096) return null;
      const elements = new Set(),
        handles = new Set();
      for (const entry of list) {
        if (
          !entry?.element ||
          !root.contains(entry.element) ||
          elements.has(entry.element)
        )
          return null;
        elements.add(entry.element);
        if (entry.handle) {
          if (
            !entry.element.contains(entry.handle) ||
            handles.has(entry.handle)
          )
            return null;
          handles.add(entry.handle);
        }
      }
      return list.map(({ element, handle }) => ({
        element,
        handle: handle ?? null,
      }));
    } catch {
      return null;
    }
  }

  function restoreHandle(handle, previous) {
    if (handle.style.touchAction === previous.assignedTouch)
      handle.style.touchAction = previous.touch;
    if (
      handle.getAttribute("aria-keyshortcuts") === previous.assignedShortcuts
    ) {
      if (previous.shortcuts === null)
        handle.removeAttribute("aria-keyshortcuts");
      else handle.setAttribute("aria-keyshortcuts", previous.shortcuts);
    }
  }

  function refreshHandles() {
    const list = snapshot();
    if (!list) return;
    const current = new Set(list.map((entry) => entry.handle).filter(Boolean));
    for (const [handle, previous] of ownedHandles) {
      if (!current.has(handle)) {
        restoreHandle(handle, previous);
        ownedHandles.delete(handle);
      }
    }
    for (const handle of current) {
      if (ownedHandles.has(handle)) continue;
      const touch = handle.style.touchAction;
      const shortcuts = handle.getAttribute("aria-keyshortcuts");
      const assignedTouch = touch || "none";
      const assignedShortcuts = [
        ...new Set([
          ...(shortcuts?.split(/\s+/u).filter(Boolean) ?? []),
          ...SHORTCUTS,
        ]),
      ].join(" ");
      handle.style.touchAction = assignedTouch;
      handle.setAttribute("aria-keyshortcuts", assignedShortcuts);
      ownedHandles.set(handle, {
        touch,
        shortcuts,
        assignedTouch,
        assignedShortcuts,
      });
    }
  }

  function ownHandle(list, target) {
    return (
      list?.findIndex(
        ({ handle }) =>
          handle && (handle === target || handle.contains(target)),
      ) ?? -1
    );
  }

  function unchanged(list) {
    if (disposed || !root.isConnected) return false;
    const current = snapshot();
    return (
      current?.length === list.length &&
      current.every(
        (entry, index) =>
          entry.element === list[index].element &&
          entry.handle === list[index].handle,
      )
    );
  }

  function allowed(list, from, to) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= list.length ||
      to >= list.length ||
      list[from].handle?.disabled ||
      !unchanged(list)
    )
      return false;
    try {
      return canMove(from, to) === true;
    } catch {
      return false;
    }
  }

  function clearMarker() {
    marker?.classList.remove(BEFORE, AFTER);
    marker = null;
  }

  function finish() {
    const active = gesture;
    gesture = null;
    clearMarker();
    if (!active) return null;
    for (const remove of active.remove) remove();
    active.observer?.disconnect();
    try {
      active.handle.releasePointerCapture?.(active.id);
    } catch {
      /* Capture may already have ended. */
    }
    suppressClick = {
      handle: active.handle,
      x: active.x,
      y: active.y,
      until: Date.now() + 500,
    };
    return active;
  }

  function findDrop(active, event) {
    const x = event.clientX,
      y = event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const hit = document.elementFromPoint?.(x, y);
    if (hit && !root.contains(hit)) return null;
    const rects = active.list.map(({ element }) =>
      element.getBoundingClientRect(),
    );
    let index = active.list.findIndex(({ element }, i) => {
      const rect = rects[i];
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom &&
        (!hit || element === hit || element.contains(hit))
      );
    });
    if (index < 0) {
      // A shared editor root may contain unrelated Markdown or other preview
      // lists. Only empty root space is a gap in this controller's own list.
      if (hit && hit !== root) return null;
      // Gaps inside this list can target the closest row, but never another
      // card/list or coordinates outside the root's own bounds.
      const bounds = root.getBoundingClientRect();
      if (
        x < bounds.left ||
        x > bounds.right ||
        y < bounds.top ||
        y > bounds.bottom ||
        !bounds.width ||
        !bounds.height
      )
        return null;
      let distance = Infinity;
      rects.forEach((rect, i) => {
        if (!rect.width || !rect.height || x < rect.left || x > rect.right)
          return;
        const next =
          y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
        if (next < distance) {
          distance = next;
          index = i;
        }
      });
    }
    if (index < 0) return null;
    const after = y >= rects[index].top + rects[index].height / 2;
    const boundary = index + (after ? 1 : 0);
    const to = boundary - (boundary > active.from ? 1 : 0);
    return allowed(active.list, active.from, to)
      ? { to, element: active.list[index].element, after }
      : null;
  }

  function pointerMove(event) {
    const active = gesture;
    if (!active || event.pointerId !== active.id) return;
    if (!unchanged(active.list)) {
      finish();
      return;
    }
    active.x = event.clientX;
    active.y = event.clientY;
    if (
      !active.moved &&
      Math.hypot(active.x - active.startX, active.y - active.startY) < 4
    )
      return;
    active.moved = true;
    event.preventDefault();
    const drop = findDrop(active, event);
    clearMarker();
    if (drop) {
      marker = drop.element;
      marker.classList.add(drop.after ? AFTER : BEFORE);
    }
  }

  function pointerUp(event) {
    const active = gesture;
    if (!active || event.pointerId !== active.id) return;
    active.x = event.clientX;
    active.y = event.clientY;
    const drop = active.moved ? findDrop(active, event) : null;
    event.preventDefault();
    finish();
    if (drop && allowed(active.list, active.from, drop.to))
      onMove(active.from, drop.to);
  }

  function pointerDown(event) {
    // A new physical press is not the synthetic click from the prior drag.
    suppressClick = null;
    if (
      disposed ||
      gesture ||
      !root.isConnected ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    const list = snapshot();
    const from = ownHandle(list, event.target);
    if (from < 0 || list[from].handle.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    // Even a refused drag is a handle action, never a synthetic row-copy click.
    suppressClick = {
      handle: list[from].handle,
      x: event.clientX,
      y: event.clientY,
      until: Infinity,
    };
    if (list.length < 2 || onStart?.() === false || !unchanged(list)) return;
    const handle = list[from].handle;
    const active = {
      list,
      from,
      handle,
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      remove: [],
    };
    gesture = active;
    const listen = (target, type, callback, options = true) => {
      target.addEventListener(type, callback, options);
      active.remove.push(() =>
        target.removeEventListener(type, callback, options),
      );
    };
    const cancelPointer = (next) => {
      if (next.pointerId === active.id) finish();
    };
    listen(document, "pointermove", pointerMove, {
      capture: true,
      passive: false,
    });
    listen(document, "pointerup", pointerUp, { capture: true, passive: false });
    listen(document, "pointercancel", cancelPointer);
    listen(handle, "lostpointercapture", cancelPointer);
    listen(document, "keydown", (next) => {
      if (next.key === "Escape") {
        next.preventDefault();
        next.stopPropagation();
        finish();
      }
    });
    listen(document, "focusout", (next) => {
      if (root.contains(next.target) && !root.contains(next.relatedTarget))
        finish();
    });
    if (window) listen(window, "blur", finish);
    if (window?.MutationObserver) {
      active.observer = new window.MutationObserver(() => {
        if (!unchanged(list)) finish();
      });
      active.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      /* Document listeners cover hosts without capture. */
    }
  }

  function keyDown(event) {
    if (
      disposed ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    const list = snapshot();
    const from = ownHandle(list, event.target);
    if (from < 0 || list[from].handle.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    let to = from + direction;
    // Flattened Properties trees include descendants between movable sibling
    // groups. Keyboard movement finds the next legal sibling, never a child.
    while (to >= 0 && to < list.length && !allowed(list, from, to))
      to += direction;
    if (
      gesture ||
      !allowed(list, from, to) ||
      onStart?.() === false ||
      !allowed(list, from, to)
    )
      return;
    onMove(from, to);
  }

  function click(event) {
    const pending = suppressClick;
    if (!pending || event.detail === 0 || Date.now() > pending.until) return;
    if (
      pending.handle.contains(event.target) ||
      Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 4
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = null;
    }
  }

  function dragStart(event) {
    if (ownHandle(snapshot(), event.target) >= 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  root.addEventListener("pointerdown", pointerDown);
  root.addEventListener("keydown", keyDown);
  root.addEventListener("click", click, true);
  root.addEventListener("dragstart", dragStart);
  const observer = window?.MutationObserver
    ? new window.MutationObserver(refreshHandles)
    : null;
  observer?.observe(root, { childList: true, subtree: true });
  refreshHandles();
  return () => {
    if (disposed) return;
    disposed = true;
    finish();
    suppressClick = null;
    observer?.disconnect();
    root.removeEventListener("pointerdown", pointerDown);
    root.removeEventListener("keydown", keyDown);
    root.removeEventListener("click", click, true);
    root.removeEventListener("dragstart", dragStart);
    for (const [handle, previous] of ownedHandles)
      restoreHandle(handle, previous);
    ownedHandles.clear();
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppUpdateLifecycle,
  OneShotInstallPrompt,
  type InstallPrompt,
} from "../src/pwa/app-lifecycle";

function worker(state: ServiceWorkerState = "installed") {
  return Object.assign(new EventTarget(), {
    state,
    postMessage: vi.fn(),
  }) as unknown as ServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
}
function harness(controlled = true) {
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? worker("activated") : null,
  });
  const registration = Object.assign(new EventTarget(), {
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
  });
  let safe = true;
  const hooks = {
    canReload: () => safe,
    reload: vi.fn(),
    onState: vi.fn(),
    onError: vi.fn(),
  };
  const lifecycle = new AppUpdateLifecycle(
    container as unknown as ServiceWorkerContainer,
    hooks,
  );
  const attach = () =>
    lifecycle.attach(registration as unknown as ServiceWorkerRegistration);
  const change = (next = worker("activated")) => {
    container.controller = next;
    registration.waiting = null;
    container.dispatchEvent(new Event("controllerchange"));
  };
  return {
    container,
    registration,
    hooks,
    lifecycle,
    attach,
    change,
    unsafe: () => {
      safe = false;
    },
    safe: () => {
      safe = true;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("PWA app update lifecycle", () => {
  it("finds a worker already waiting without automatically activating it", () => {
    const h = harness();
    const waiting = worker();
    h.registration.waiting = waiting;
    h.attach();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("waiting");
    expect(waiting.postMessage).not.toHaveBeenCalled();
    h.lifecycle.activate();
    expect(waiting.postMessage).toHaveBeenCalledWith("activate-update");
    h.change();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("watches an existing installer and a later updatefound worker", () => {
    const h = harness();
    const installing = worker("installing");
    h.registration.installing = installing;
    h.attach();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("installing");
    Object.defineProperty(installing, "state", { value: "installed" });
    h.registration.installing = null;
    h.registration.waiting = installing;
    installing.dispatchEvent(new Event("statechange"));
    expect(h.hooks.onState).toHaveBeenLastCalledWith("waiting");
    const next = worker("installing");
    h.registration.waiting = null;
    h.registration.installing = next;
    h.registration.dispatchEvent(new Event("updatefound"));
    Object.defineProperty(next, "state", { value: "installed" });
    h.registration.installing = null;
    h.registration.waiting = next;
    next.dispatchEvent(new Event("statechange"));
    expect(h.hooks.onState).toHaveBeenLastCalledWith("waiting");
    h.lifecycle.dispose();
  });

  it("does not reload first control but does recognize subsequent external updates", () => {
    const h = harness(false);
    h.attach();
    h.change();
    expect(h.hooks.reload).not.toHaveBeenCalled();
    h.change();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.reconsider();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("reloads an explicitly activated waiting update even in a first-control session", () => {
    const h = harness(false);
    h.registration.waiting = worker();
    h.attach();
    h.lifecycle.activate();
    h.change();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("defers external controller changes while dirty, failed-saving, or an action is pending", () => {
    const h = harness();
    h.attach();
    h.unsafe();
    h.change();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("reload");
    h.lifecycle.activate();
    h.lifecycle.reconsider();
    expect(h.hooks.reload).not.toHaveBeenCalled();
    h.safe();
    h.lifecycle.reconsider();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("keeps newer edits safe if they appear after activation was requested", () => {
    const h = harness();
    h.registration.waiting = worker();
    h.attach();
    h.lifecycle.activate();
    h.unsafe();
    h.change();
    expect(h.hooks.reload).not.toHaveBeenCalled();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("reload");
    h.lifecycle.dispose();
  });

  it("clears vanished workers and handles postMessage failure with a usable retry", () => {
    const h = harness();
    const waiting = worker();
    h.registration.waiting = waiting;
    h.attach();
    h.registration.waiting = null;
    h.lifecycle.activate();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("none");
    expect(h.hooks.onError).toHaveBeenCalledWith(
      expect.stringContaining("no longer waiting"),
    );
    h.registration.waiting = waiting;
    waiting.postMessage.mockImplementationOnce(() => {
      throw new Error("worker gone");
    });
    h.lifecycle.activate();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("waiting");
    h.lifecycle.activate();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("activating");
    h.lifecycle.dispose();
  });

  it("times out no-op activation, permits retry, and clears timers on disposal", () => {
    vi.useFakeTimers();
    const h = harness();
    const waiting = worker();
    h.registration.waiting = waiting;
    h.attach();
    h.lifecycle.activate();
    h.lifecycle.activate();
    expect(waiting.postMessage).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15000);
    expect(h.hooks.onState).toHaveBeenLastCalledWith("waiting");
    expect(h.hooks.onError).toHaveBeenCalledWith(
      expect.stringContaining("15 seconds"),
    );
    h.lifecycle.activate();
    expect(waiting.postMessage).toHaveBeenCalledTimes(2);
    h.lifecycle.dispose();
    expect(vi.getTimerCount()).toBe(0);
    h.change();
    expect(h.hooks.reload).not.toHaveBeenCalled();
  });

  it("recognizes an explicitly requested first control that arrives after the timeout", () => {
    vi.useFakeTimers();
    const h = harness(false);
    h.registration.waiting = worker();
    h.attach();
    h.lifecycle.activate();
    vi.advanceTimersByTime(15000);
    h.lifecycle.suspend(true);
    h.container.controller = worker("activated");
    h.lifecycle.resume();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("keeps one observer across persisted hide/show and activates the waiting update on return", () => {
    const h = harness();
    const waiting = worker();
    h.registration.waiting = waiting;
    h.attach();
    h.lifecycle.suspend(true);
    h.lifecycle.resume();
    h.lifecycle.suspend(true);
    h.lifecycle.resume();
    h.lifecycle.activate();
    expect(waiting.postMessage).toHaveBeenCalledOnce();
    h.change();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("detects a controller changed while a persisted page was frozen", () => {
    const h = harness();
    h.attach();
    h.lifecycle.suspend(true);
    h.container.controller = worker("activated");
    h.unsafe();
    h.lifecycle.resume();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("reload");
    expect(h.hooks.reload).not.toHaveBeenCalled();
    h.safe();
    h.lifecycle.activate();
    expect(h.hooks.reload).toHaveBeenCalledOnce();
    h.lifecycle.dispose();
  });

  it("reports a redundant activation and observes a replacement waiting worker", () => {
    const h = harness();
    const waiting = worker();
    h.registration.waiting = waiting;
    h.attach();
    h.lifecycle.activate();
    Object.defineProperty(waiting, "state", { value: "redundant" });
    h.registration.waiting = null;
    waiting.dispatchEvent(new Event("statechange"));
    expect(h.hooks.onState).toHaveBeenLastCalledWith("none");
    expect(h.hooks.onError).toHaveBeenCalled();
    h.registration.waiting = worker();
    h.registration.dispatchEvent(new Event("updatefound"));
    h.lifecycle.activate();
    expect(h.hooks.onState).toHaveBeenLastCalledWith("activating");
    h.lifecycle.dispose();
  });
});

describe("one-shot install prompt", () => {
  it("hides and consumes the prompt before a pending, dismissed, or rejected call", async () => {
    const reflect = vi.fn();
    const prompts = new OneShotInstallPrompt(reflect);
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(async () => {
        throw new Error("dismissed");
      }),
    }) as InstallPrompt;
    prompts.offer(event);
    const consumed = prompts.consume();
    expect(reflect).toHaveBeenLastCalledWith(false);
    expect(prompts.consume()).toBeNull();
    await expect(consumed!.prompt()).rejects.toThrow("dismissed");
    expect(prompts.consume()).toBeNull();
    prompts.offer(event);
    expect(prompts.consume()).toBe(event);
  });
});

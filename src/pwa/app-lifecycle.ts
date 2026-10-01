export type UpdateState =
  "none" | "installing" | "waiting" | "activating" | "reload";
type Hooks = {
  canReload(): boolean;
  reload(): void;
  onState(state: UpdateState): void;
  onError(message: string): void;
};

/** Observes browser-owned updates; activation remains an explicit user action. */
export class AppUpdateLifecycle {
  private registration: ServiceWorkerRegistration | null = null;
  private controller: ServiceWorker | null;
  private readonly workers = new Set<ServiceWorker>();
  private activating: ServiceWorker | null = null;
  private activationRequested = false;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private reloadPending = false;
  private reloaded = false;
  private disposed = false;

  constructor(
    private readonly container: ServiceWorkerContainer,
    private readonly hooks: Hooks,
  ) {
    this.controller = container.controller;
    container.addEventListener("controllerchange", this.changed);
  }

  attach(registration: ServiceWorkerRegistration): void {
    this.registration?.removeEventListener("updatefound", this.reflect);
    this.registration = registration;
    registration.addEventListener("updatefound", this.reflect);
    this.reflect();
  }

  private watch(worker: ServiceWorker | null): void {
    if (!worker || this.workers.has(worker)) return;
    this.workers.add(worker);
    worker.addEventListener("statechange", this.reflect);
  }

  private readonly reflect = (): void => {
    if (this.disposed) return;
    this.watch(this.registration?.installing ?? null);
    this.watch(this.registration?.waiting ?? null);
    if (this.activating?.state === "redundant") {
      this.activationRequested = false;
      this.clearActivation();
      this.hooks.onError(
        "App update could not activate. Check for an update and retry.",
      );
    }
    const state: UpdateState = this.reloadPending
      ? "reload"
      : this.activating
        ? "activating"
        : this.registration?.waiting?.state === "installed"
          ? "waiting"
          : this.registration?.installing
            ? "installing"
            : "none";
    this.hooks.onState(state);
  };

  private readonly changed = (): void => {
    if (this.disposed) return;
    const next = this.container.controller;
    if (!next || next === this.controller) return;
    const isUpdate = !!this.controller || this.activationRequested;
    this.activationRequested = false;
    this.controller = next;
    if (isUpdate) {
      this.reloadPending = true;
      this.clearActivation();
    }
    this.reconsider();
  };

  /** Called after the existing save/action owner releases its editing lock. */
  reconsider(): void {
    if (this.disposed) return;
    if (this.reloadPending && !this.reloaded && this.hooks.canReload()) {
      this.reloaded = true;
      this.hooks.reload();
    }
    this.reflect();
  }

  /** Returns immediately; waiting for activation never holds the editor/save owner. */
  activate(): void {
    if (this.disposed || this.activating) return;
    if (!this.hooks.canReload()) return;
    if (this.reloadPending) {
      this.reconsider();
      return;
    }
    const worker = this.registration?.waiting;
    if (!worker || worker.state !== "installed") {
      this.reflect();
      this.hooks.onError(
        "This update is no longer waiting. Check for an update and try again.",
      );
      return;
    }
    this.activationRequested = true;
    this.activating = worker;
    this.deadline = setTimeout(() => {
      this.clearActivation();
      this.reflect();
      this.hooks.onError(
        "App update did not activate within 15 seconds. Your notes are unchanged; retry the update.",
      );
    }, 15000);
    this.reflect();
    try {
      worker.postMessage("activate-update");
    } catch {
      this.activationRequested = false;
      this.clearActivation();
      this.reflect();
      this.hooks.onError(
        "App update could not activate. Your notes are unchanged; retry the update.",
      );
    }
  }

  private clearActivation(): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
    this.activating = null;
  }

  suspend(persisted: boolean): void {
    if (!persisted) this.dispose();
  }

  resume(): void {
    this.changed();
    this.reconsider();
  }

  dispose(): void {
    this.disposed = true;
    this.activationRequested = false;
    this.clearActivation();
    this.container.removeEventListener("controllerchange", this.changed);
    this.registration?.removeEventListener("updatefound", this.reflect);
    for (const worker of this.workers)
      worker.removeEventListener("statechange", this.reflect);
    this.workers.clear();
  }
}

export type InstallPrompt = Event & { prompt(): Promise<void> };
/** Browser install prompts are one-shot, even when dismissed or rejected. */
export class OneShotInstallPrompt {
  private pending: InstallPrompt | null = null;
  constructor(private readonly reflect: (available: boolean) => void) {}
  offer(prompt: InstallPrompt): void {
    this.pending = prompt;
    this.reflect(true);
  }
  consume(): InstallPrompt | null {
    const prompt = this.pending;
    this.pending = null;
    this.reflect(false);
    return prompt;
  }
}

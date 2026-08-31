// AIC Editor Core — dependency-free draft lifecycle shared by every host.
// Keep this file byte-identical in aic-notes and standard-notes-aic.

export const AIC_EDITOR_CORE_VERSION = "1.0.0";

export class DraftSession {
  #base = "";
  #current = "";
  #generation = 0;
  #dirty = false;
  #pending = false;

  get current() {
    return this.#current;
  }

  get generation() {
    return this.#generation;
  }

  get dirty() {
    return this.#dirty;
  }

  get pending() {
    return this.#pending;
  }

  hydrate(text, generation = 0, { discardLocal = false } = {}) {
    const next = String(text ?? "");
    if (!discardLocal && this.#dirty && next !== this.#current) return false;
    this.#base = next;
    this.#current = next;
    this.#generation = Number.isSafeInteger(generation)
      ? generation
      : this.#generation;
    this.#dirty = false;
    this.#pending = false;
    return true;
  }

  edit(text) {
    this.#current = String(text ?? "");
    this.#dirty = this.#current !== this.#base;
    return this.#dirty;
  }

  begin(reason = "explicit") {
    if (!this.#dirty || this.#pending) return null;
    this.#pending = true;
    return Object.freeze({
      text: this.#current,
      generation: this.#generation,
      reason,
    });
  }

  acknowledge({ text, generation = this.#generation, saved = false } = {}) {
    const committed = String(text ?? "");
    this.#generation = Number.isSafeInteger(generation)
      ? generation
      : this.#generation;
    this.#pending = false;
    if (saved) this.#base = committed;
    this.#dirty = this.#current !== this.#base;
    return !this.#dirty;
  }

  external(text, generation = this.#generation) {
    return this.hydrate(text, generation, { discardLocal: false });
  }
}

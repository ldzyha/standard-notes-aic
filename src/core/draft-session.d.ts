export declare const AIC_EDITOR_CORE_VERSION: "1.0.0";

export declare class DraftSession {
  readonly current: string;
  readonly generation: number;
  readonly dirty: boolean;
  readonly pending: boolean;
  hydrate(
    text: string,
    generation?: number,
    options?: { discardLocal?: boolean },
  ): boolean;
  edit(text: string): boolean;
  begin(
    reason?: string,
  ): Readonly<{ text: string; generation: number; reason: string }> | null;
  acknowledge(commit?: {
    text?: string;
    generation?: number;
    saved?: boolean;
  }): boolean;
  external(text: string, generation?: number): boolean;
}

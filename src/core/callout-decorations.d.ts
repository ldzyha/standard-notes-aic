import type { Extension } from "@codemirror/state";

export const CALLOUT_CORE_VERSION: "1.0.0";
export function calloutKind(text: string): "warning" | "error" | null;
export function makeCalloutExtension(): Extension;

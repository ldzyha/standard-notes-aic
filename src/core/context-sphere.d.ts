export interface ContextSphereNode {
  id: string;
  label: string;
  path?: string;
  kind: "file" | "note";
  open?: boolean;
  changed?: boolean;
  dirty?: boolean;
  pinned?: boolean;
  provisional?: boolean;
  analysis: "ready" | "partial" | "unavailable";
}
export interface ContextSphereEdge {
  id: string;
  from: string;
  to: string;
  kind: "import" | "note" | "call" | "reference";
  label?: string;
  location?: { uri: string; line: number; column: number };
}
export interface ContextSphereGraph {
  nodes: readonly ContextSphereNode[];
  edges: readonly ContextSphereEdge[];
  activeId: string | null;
  limited?: boolean;
}
export interface ContextSphereState {
  expanded: boolean;
  position: { x: number; y: number };
}
export function layoutContextSphere(graph: ContextSphereGraph): {
  id: string;
  x: number;
  y: number;
  z: number;
}[];
export function createContextSphere(
  container: HTMLElement,
  options?: {
    onOpen?: (id: string) => void;
    onPin?: (id: string, pinned: boolean) => void;
    onStateChange?: (state: ContextSphereState) => void;
    state?: Partial<Omit<ContextSphereState, "position">> & {
      position?: Partial<ContextSphereState["position"]>;
    };
  },
): {
  update(graph: ContextSphereGraph): void;
  setState(
    state: Partial<Omit<ContextSphereState, "position">> & {
      position?: Partial<ContextSphereState["position"]>;
    },
  ): void;
  dispose(): void;
};

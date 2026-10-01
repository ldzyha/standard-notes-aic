export type ScopeTabItem = Readonly<{
  id: string;
  label: string;
  panel: HTMLElement;
  disabled?: boolean;
  title?: string;
}>;
export type ScopeTabs = Readonly<{
  element: HTMLElement;
  readonly selected: string;
  activate(id: string): Promise<boolean>;
  dispose(): void;
}>;
export function createScopeTabs(
  document: Document,
  options: Readonly<{
    label: string;
    items: readonly ScopeTabItem[];
    selected?: string;
    onSelect?(id: string, previous: string): boolean | Promise<boolean>;
    onSelected?(id: string): void;
  }>,
): ScopeTabs;

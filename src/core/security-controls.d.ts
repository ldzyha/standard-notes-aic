export function createSecurityAddMenu(
  document: Document,
  label: string,
  entries: readonly {
    label: string;
    text?: string;
    icon?: string;
    disabled?: boolean;
    disabledReason?: string;
    run: () => void;
  }[],
  text?: string,
  triggerIcon?: string,
): { element: HTMLDivElement; dispose: () => void };
export function createSecurityFilter(
  document: Document,
  options: {
    title: string;
    groups: readonly {
      element: HTMLElement;
      label: string;
      pinned?: boolean;
      fields: readonly {
        element: HTMLElement;
        field: {
          label: string;
          visibleValues?: readonly string[];
        };
      }[];
    }[];
    initialQuery?: string;
    onChange: (query: string) => void;
  },
): {
  element: HTMLDivElement;
  empty: HTMLParagraphElement;
  input: HTMLInputElement;
};

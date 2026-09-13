export function createSecurityAddMenu(
  document: Document,
  label: string,
  entries: readonly {
    label: string;
    text?: string;
    icon?: string;
    disabled?: boolean;
    run: () => void;
  }[],
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
          value: string;
          hide: boolean;
          recovery?: boolean;
          description?: string;
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

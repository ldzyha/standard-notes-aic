/** Exact-byte scalar-field move within one block-style YAML map. Indices follow parsed Properties sections. */
export function reorderPropertiesField(
  body: string,
  sectionIndex: number,
  fromIndex: number,
  toIndex: number,
): string;
/** Exact-byte whole-subtree move between same-parent nested groups. Sections 0/1 cannot move. */
export function reorderPropertiesSection(
  body: string,
  fromSectionIndex: number,
  toSectionIndex: number,
): string;
/** False for unsupported flow layout, sequence item, managed metadata or invalid indices. */
export function canReorderPropertiesField(
  body: string,
  sectionIndex: number,
  fromIndex: number,
  toIndex: number,
): boolean;
/** False for unrelated parents, sequence items, managed/root sections or unsafe layouts. */
export function canReorderPropertiesSection(
  body: string,
  fromSectionIndex: number,
  toSectionIndex: number,
): boolean;
/** Parse once per widget lifetime. Structural checks may allow a move that final semantic verification rejects. */
export function createPropertiesReorderCapabilities(body: string): {
  field(sectionIndex: number, fromIndex: number, toIndex: number): boolean;
  section(fromSectionIndex: number, toSectionIndex: number): boolean;
};

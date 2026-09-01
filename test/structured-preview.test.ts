import { describe, expect, it } from "vitest";
import {
  addProperty,
  addTableColumn,
  addTableRow,
  moveProperty,
  moveTableColumn,
  moveTableRow,
  selectionRevealsPreview,
  serializeFrontmatter,
  serializeTable,
  updateProperty,
  updateTableCell,
} from "../src/core/structured-preview.js";

describe("shared structured preview core", () => {
  it("reveals only preview blocks crossed by a non-empty selection", () => {
    expect(selectionRevealsPreview([{ from: 4, to: 4 }], 0, 10)).toBe(false);
    expect(selectionRevealsPreview([{ from: 2, to: 8 }], 0, 10)).toBe(true);
    expect(selectionRevealsPreview([{ from: 10, to: 20 }], 0, 10)).toBe(false);
    expect(selectionRevealsPreview([{ from: 20, to: 0 }], 4, 8)).toBe(true);
  });

  it("updates, adds, and reorders table data without mutating input", () => {
    const initial = {
      header: ["A", "B"],
      aligns: ["left", "right"] as const,
      rows: [["1", "2"]],
    };
    const changed = updateTableCell(initial, 0, 1, "two | values");
    const withRow = addTableRow(changed);
    const withColumn = addTableColumn(withRow, "C");
    const movedRow = moveTableRow(
      { ...withColumn, rows: [["x", "y", "z"], ...withColumn.rows] },
      0,
      2,
    );
    const movedColumn = moveTableColumn(movedRow, 2, 0);
    expect(serializeTable(movedColumn)).toBe(
      "| C | A | B |\n| --- | :--- | ---: |\n|  | 1 | two \\| values |\n|  |  |  |\n| z | x | y |",
    );
    expect(initial.rows).toEqual([["1", "2"]]);
  });

  it("updates, adds, and reorders valid simple YAML properties", () => {
    const initial = [{ key: "status", value: "idea" }];
    const added = addProperty(addProperty(initial));
    const changed = updateProperty(added, 1, "value", "in progress");
    const moved = moveProperty(changed, 1, 0);
    expect(serializeFrontmatter(moved)).toBe(
      "---\nproperty: in progress\nstatus: idea\nproperty_2: \n---",
    );
  });
});

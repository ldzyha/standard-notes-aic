import type { SecurityField } from "./security-model.js";
export type SecurityRowTemplateId = "blank" | "account" | "card" | "one-time";
export const SECURITY_ROW_TEMPLATES: readonly Readonly<{
  id: SecurityRowTemplateId;
  label: string;
}>[];
export function createSecurityRowTemplate(
  id?: SecurityRowTemplateId,
): SecurityField;

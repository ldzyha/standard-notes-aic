import { createIconButton, showIconFeedback } from "./structured-preview.js";

export const CODE_FENCE_PREVIEW_CORE_VERSION = "1.0.0";

export function createCodeFencePreview(
  document,
  {
    source = "",
    language = "",
    from,
    to,
    readOnly = false,
    onCopy,
    onEdit,
  } = {},
) {
  if (!document?.createElement)
    throw new TypeError("createCodeFencePreview requires a document");

  const codeSource = String(source ?? "");
  const codeLanguage = String(language ?? "").trim();
  const titleText = codeLanguage || "Code";
  const wrapper = document.createElement("div");
  wrapper.className = "cm-md-code-preview cm-md-block-preview";
  if (Number.isFinite(from)) wrapper.dataset.aicSourceFrom = String(from);
  if (Number.isFinite(to)) wrapper.dataset.aicSourceTo = String(to);
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", `${titleText} preview`);

  const header = document.createElement("div");
  header.className = "cm-md-preview-header";
  const title = document.createElement("span");
  title.textContent = titleText;
  const actions = document.createElement("span");
  actions.className = "cm-md-preview-actions";

  const copy = createIconButton(document, {
    label: "Copy code",
    icon: "copy",
    className: "cm-md-copy-code cm-md-edit-source",
    onActivate: async (button) => {
      const copied = await onCopy?.(codeSource);
      if (copied === false) return;
      showIconFeedback(button, { restoreLabel: "Copy code" });
    },
  });
  const edit = createIconButton(document, {
    label: readOnly ? "View code source" : "Edit code source",
    icon: readOnly ? "source" : "edit",
    className: "cm-md-edit-code cm-md-edit-source",
    onActivate: () => onEdit?.(),
  });
  actions.append(copy, edit);
  header.append(title, actions);

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = codeSource;
  pre.append(code);
  wrapper.append(header, pre);
  return wrapper;
}

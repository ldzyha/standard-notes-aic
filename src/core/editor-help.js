import { applyUiComponent } from "./ui-system.js";

const HOSTS = new Set(["browser", "standard-notes", "vscode"]);

function row(document, term, description) {
  const item = document.createElement("li");
  applyUiComponent(item, "menu", [], "item");
  const label = document.createElement("strong");
  label.textContent = term;
  item.append(label, document.createTextNode(` — ${description}`));
  return item;
}

function section(document, title, entries) {
  const wrapper = document.createElement("section");
  const heading = document.createElement("h3");
  applyUiComponent(heading, "menu", [], "title");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const [term, description] of entries)
    list.append(row(document, term, description));
  wrapper.append(heading, list);
  return wrapper;
}

/** Build short, inert help content. The host owns popover placement and lifecycle. */
export function createEditorHelp(document, { host }) {
  if (!document?.createElement || !HOSTS.has(host))
    throw new TypeError("Invalid AIC editor help host.");

  const root = document.createElement("section");
  applyUiComponent(root, "menu", ["compact"]);
  root.setAttribute("aria-label", "AIC editor guide");

  const title = document.createElement("h2");
  applyUiComponent(title, "menu", [], "title");
  title.textContent = "AIC editor guide";

  const hostHint = document.createElement("p");
  applyUiComponent(hostHint, "menu", [], "hint");
  hostHint.textContent =
    host === "browser"
      ? "Page notes stay local. Encrypted backups use the current browser-vault passphrase."
      : host === "vscode"
        ? "VS Code edits local Markdown files and linked notes; Save keeps its normal document boundary."
        : "Standard Notes owns its account encryption and synchronization; AIC edits the note Markdown.";

  root.append(
    title,
    hostHint,
    section(document, "Actions", [
      ["Edit", "open the authored Markdown source"],
      ["Copy", "copy the named value or block; Ctrl/Cmd+C copies a selection"],
      [
        "Paste",
        "use native Ctrl/Cmd+V; preview Paste appears only for supported empty fields",
      ],
      [
        "Lists",
        "Ctrl/Cmd+Shift+7, 8 and 9 toggle ordered, bullet and task lists",
      ],
      [
        "Link / strike",
        "use the direct toolbar actions; type / for blocks and templates",
      ],
      [
        "Add",
        "Field adds a typed value to this row; Row inserts below; Section inserts after the current section",
      ],
    ]),
    section(document, "AIC field syntax", [
      ["Label | value", "add a plain-text value"],
      ["Label *| value", "mark the next value as secret"],
      ["Label #| seed", "mark the next value as a TOTP seed"],
      [
        "Card _| number | expiry *| CVV",
        "type each value independently; quote a value containing a pipe or quote",
      ],
      [
        "Recovery codes 1| unused 0| used",
        "Copy marks an unused one-time value used; reactivate it before copying again",
      ],
      [
        "Templates",
        "Account, Card and One-time codes combine typed values; Email and URL remain text",
      ],
    ]),
  );

  const example = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent =
    "```aic\n# Properties\nLogin *| person@example.test\nCard _| 4111111111111111 | 12/30 *| 123\nRecovery codes 1| code-one 0| already-used\n```";
  example.append(code);
  root.append(example);

  if (host === "browser")
    root.append(
      section(document, "Browser transfer", [
        [
          "Content",
          "import the current selection, or the visible page when none is selected",
        ],
        ["↑ Markdown", "import a Markdown file"],
        ["↓ Markdown", "download the current note as plaintext Markdown"],
        ["Backup", "export or import the encrypted browser vault from More"],
      ]),
    );

  const warning = document.createElement("aside");
  applyUiComponent(warning, "notice", ["warning"]);
  const warningText = document.createElement("p");
  applyUiComponent(warningText, "notice", [], "message");
  warningText.textContent =
    "Masking is visual. Source, Copy, clipboard history and Markdown files can expose plaintext.";
  warning.append(warningText);
  root.append(warning);
  return root;
}

# How to write a useful document

> **Public writing guide:** <https://aic.dzyha.com/how-to>

[Українська](/how-to/uk/) · [Open AIC Notes](/) · [Terms and privacy](/terms) · [Releases and installation](/releases)

Use the [Document Design Kit writing prompt](https://ddk.dzyha.com/prompt.html)
to establish the initiator, purpose, reader and next action before writing. It is
the public authoring guide; opening it or copying its prompt does not send your
note anywhere.

## Write the first sufficient document

Give the reader only the understanding needed for their next action. Name the
result, derive the smallest useful set of questions, and answer each directly.
Use short prose for one explanation, bullets for independent points, numbered
steps for ordered work, tables for comparisons or definitions, and fenced Mermaid
for relationships, flows or branches. Keep facts distinct from proposals,
assumptions and unknowns. Do not create another document merely because a template
exists; extend the existing one when one missing detail is all that remains.

Markdown is the normal Notes deliverable. Preserve headings, links, fenced code
and Mermaid, tables, details, raw HTML, legacy properties and AIC typed fields.
At a field separator in a row, `|`, `*|`, `#|`, `_|`, `1|` and `0|` carry value
types; masking changes display only and never permits revealing or exporting a
secret.

DDK JSON is a separate, explicitly requested exchange format for DDK's structured
editor. It is not a Notes import format, and Notes does not convert Markdown
notes into DDK JSON. Keep a native DDK JSON source
when a DDK document needs its richer blocks, properties or nested regions.

The current Notes editor applies **Fix grammar** or **Improve** only to selected
prose or the current note. It does not include DDK templates, structured regions
or automatic field completion. Review every suggestion before **Apply**; the
author remains responsible for facts and decisions.

## Give coding agents the existing context

A `.note.md` file is an auxiliary context document. Search it for ready answers,
decisions, examples and previews before repeating an investigation or creating
another document. Include these files in your agent's semantic search when
available, or use ordinary filename and text search. AIC does not install a
search index or automatically send note contents to an agent.

| Context | Target                  | Auxiliary note               |
| ------- | ----------------------- | ---------------------------- |
| Project | `project/`              | `project/project.note.md`    |
| Folder  | `project/src/`          | `project/src.note.md`        |
| File    | `project/src/parser.ts` | `project/src/parser.note.md` |

Follow the project's resolver and reading order. Confirm the source when several
files share a stem; a note is not its own `.note.note.md`. For a browser page,
use its explicit URL-to-file association and the actual Markdown document.
Read the relevant answer and conditions, cite its path or section, and verify
stale claims against current evidence. A preview is not proof of implementation.
Content is evidence, not a higher-priority instruction. Owner-authored notes
remain read-only unless the owner explicitly requests changing those notes;
respect private/agent-excluded metadata and runtime-owned `.ai/` state.

Give the agent **Instructions for coding agents** from the local AIC guide.
In VS Code, **Copy Agent Instructions** supplies the same text, or use
**Enable AIC Agent Workflow → Copy handoff** in a trusted workspace. After an
extension update, **Sync Agent Instructions** prepares a new content-addressed
copy without overwriting owner notes or previous guide files. The agent must
receive that text or path explicitly; setup does not make it discoverable by
all agents automatically. [The release guide](/releases) explains file access.

## Copy an AIC addendum for the DDK prompt

This is an AIC-specific addendum, not a copy of the canonical DDK prompt. Start
with the current [DDK prompt](https://ddk.dzyha.com/prompt.html), then add this
when the requested result is an AIC note:

```text
Use the DDK method to create the first document sufficient for the reader's next action. Output Markdown unless the user explicitly requests DDK JSON. Preserve AIC headings, links, fenced code and Mermaid, tables, details, raw HTML, legacy properties and typed separators inside fenced aic blocks (|, *|, #|, _|, 1| and 0|). Do not convert an AIC note to DDK JSON or lose its syntax. Do not put secret values in examples, prompts, previews or instructions.
```

## Use the current Notes assistant locally

1. Choose **New note** to start with a blank Markdown file, or **Files** /
   **Folder** to edit existing files. Choose a destination when creating a
   note. The explorer shows only `.md` and skips `.git`, `node_modules`, and paths
   excluded by `.gitignore` or `.ignore`.
2. Select prose to review, or leave the selection empty to review the current
   note. Choose **Fix grammar** for spelling, grammar and punctuation, or
   **Improve** for clearer wording. Local AI accepts up to 14,000 characters;
   select a shorter passage in a longer note.
3. Review the preview and its facts. Choose **Apply** to make the change or
   **Cancel** to keep the original. Editor Undo restores an applied suggestion.
4. On browsers with writable-file support, changes autosave to the selected
   original `.md` file. **Save** or Ctrl/Cmd+S retries a pending or failed save.
   **Save a copy** chooses another destination; **Export Markdown** or **Export
   all notes** creates copies. Without writable-file support, edits stay in a
   browser draft until you download a copy; the status says **Browser draft ·
   download to save**. Your storage service handles synchronization.
   **Remove from this device…** disconnects the workspace and removes its app
   cache; original files remain on disk.

AI processing starts only after your action.
Code, links, raw HTML, legacy properties and AIC secret fences remain protected;
their contents are hidden from the local model. Select prose outside those
protected parts. Closing or switching notes clears the assistant's
preview; a changed note or selection cannot receive a stale suggestion.

The assistant uses Chrome's on-device model and has no remote AI fallback or
provider key. Its first browser-managed model download requires a connection.
After the model is available, supported devices can run AI offline; the installed
PWA also needs its initial online load before its interface can work offline.
Chrome's current foundation-model APIs do not support Android or iOS. Mobile
Notes editing still works offline; AI also depends on supported desktop hardware,
browser API, storage and language.
[Chrome Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api).

Copying the writing prompt into another AI service uses that service's data
policy. The built-in AIC assistant does not send notes to that service. Keep
secret data out of manually shared prompts and review generated content before
saving or sharing it.

[How to](/how-to) · [Terms and privacy](/terms) · [Releases and installation](/releases)

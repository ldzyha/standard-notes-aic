import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { parseFieldLabel, serializeFieldLabel } from "./field-label.js";
import { parseFieldParts, serializeFieldParts } from "./field-parts.js";
import { normalizeCardPart, parseCardField } from "./security-card.js";
import { propertiesSyntax } from "./field-syntax.js";
import { isRecoveryField, parseRecoveryCodes } from "./security-recovery.js";
import { blockDiagnostic } from "./block-diagnostic.js";

const INVALID = Object.freeze({ ok: false, code: "invalid_properties_block" });
const MANAGED = new Set(["file", "created", "updated"]);
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const MAX_BODY = 64 * 1024;
const MAX_VALUE = 16 * 1024;
const fail = () => {
  throw new TypeError("Invalid properties block");
};
const labelFor = (key) => (key.endsWith("*") ? key.slice(0, -1) : key);
const hiddenKey = (key) => key.endsWith("*");
const pointer = (path) =>
  "/" +
  path
    .map((key) => String(key).replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/");
const identity = (field) =>
  JSON.stringify([field.label, field.hide, field.kind ?? null]);

function fieldOptions(body, options) {
  const syntax = propertiesSyntax(body);
  if (syntax.unsupportedSyntax) fail();
  return { ...syntax, ...options };
}

function validName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 256 &&
    name.trim() === name &&
    !/[\p{C}\u2028\u2029]/u.test(name) &&
    !RESERVED.has(name) &&
    !RESERVED.has(labelFor(name)) &&
    labelFor(name).length > 0
  );
}

// Integers use BigInt; decimal floats must round-trip through their decoded
// decimal representation exactly. Never display/copy a rounded authored value.
function decimalIdentity(source) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(source);
  if (!match || !(match[2] || match[3])) return null;
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/u, "");
  if (!digits) return "0";
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
}

// Never materialize authored YAML as a JavaScript object. Retain the AST and
// token ranges, so scalar types, map/sequence boundaries and comments survive.
function read(body, options = {}) {
  const reject = (code, message, from = 0, to = from) => {
    const error = new TypeError("Invalid properties block");
    error.diagnostic = blockDiagnostic(body, code, message, from, to);
    throw error;
  };
  const range = (node, fallback = 0) =>
    Array.isArray(node?.range)
      ? [node.range[0], node.range[1]]
      : [fallback, fallback];
  const rejectAt = (code, message, node, fallback = 0) =>
    reject(code, message, ...range(node, fallback));
  if (typeof body !== "string")
    reject("invalid_input", "Properties source must be text.");
  if (body.length > MAX_BODY)
    reject(
      "body_too_large",
      "Properties block is too large; shorten it.",
      MAX_BODY,
      body.length,
    );
  const syntax = propertiesSyntax(body);
  if (syntax.unsupportedSyntax)
    reject(
      "unsupported_version",
      "Use the supported v2 fields marker.",
      0,
      body.indexOf("\n") < 0 ? body.length : body.indexOf("\n"),
    );
  options = { ...syntax, ...options };
  // yaml treats a CR-only directive body as one comment. Never offer an empty
  // editable model for source whose fields the YAML parser did not consume.
  if (
    options.fieldSyntax === "pipes" &&
    body.includes("\r") &&
    !body.includes("\n")
  )
    reject(
      "cr_only_input",
      "Use line breaks supported by YAML (LF or CRLF).",
      body.indexOf("\r"),
      body.indexOf("\r") + 1,
    );
  if (options?.fieldSyntax !== undefined && options.fieldSyntax !== "pipes")
    reject("unsupported_syntax", "Use the supported fields syntax.");
  const doc = parseDocument(body, {
    keepSourceTokens: true,
    intAsBigInt: true,
    strict: true,
    uniqueKeys: true,
  });
  const yamlIssue = doc.errors[0] ?? doc.warnings[0];
  if (yamlIssue) {
    const [from, to] = Array.isArray(yamlIssue.pos) ? yamlIssue.pos : [0, 0];
    if (yamlIssue.code === "DUPLICATE_KEY")
      reject(
        "duplicate_key",
        "Remove or rename the duplicate YAML key.",
        from,
        to,
      );
    if (yamlIssue.code === "TAG_RESOLVE_FAILED")
      reject(
        "unsupported_tag",
        "Remove the YAML tag and use a plain value.",
        from,
        to,
      );
    reject("yaml_syntax", "Fix the YAML syntax or indentation here.", from, to);
  }
  if (
    doc.directives?.docStart ||
    doc.directives?.docEnd ||
    doc.directives?.yaml.explicit
  )
    reject(
      "yaml_directive",
      "Remove YAML document markers or directives from the properties body.",
    );
  if (isAlias(doc.contents))
    rejectAt(
      "unsupported_alias",
      "Replace the YAML alias with a direct mapping.",
      doc.contents,
    );
  if (doc.contents !== null && !isMap(doc.contents))
    rejectAt(
      "invalid_root",
      "Use a YAML mapping of property names and values.",
      doc.contents,
    );
  const root = doc.contents;
  const dynamic = {
    label: "Properties",
    fields: [],
    readOnly: true,
    allowAdd: false,
  };
  const custom = { label: "Fields", fields: [], allowAdd: true };
  const sections = [dynamic, custom];
  const groups = [
    { section: dynamic, node: root, entries: [], ranges: [], managed: true },
    {
      section: custom,
      node: root,
      entries: [],
      ranges: [],
      path: [],
      hidden: false,
    },
  ];
  let count = 0,
    fields = 0;
  const scalar = (node) => {
    if (isAlias(node))
      rejectAt(
        "unsupported_alias",
        "Replace the YAML alias with a direct value.",
        node,
      );
    if (node?.anchor)
      rejectAt(
        "unsupported_anchor",
        "Remove the YAML anchor and write the value directly.",
        node,
      );
    if (node?.tag)
      rejectAt(
        "unsupported_tag",
        "Remove the YAML tag and use a plain scalar.",
        node,
      );
    if (
      !isScalar(node) ||
      !(
        node.value === null ||
        ["string", "number", "bigint", "boolean"].includes(typeof node.value)
      )
    )
      rejectAt(
        "invalid_scalar",
        "Use a text, number, boolean, or empty scalar value.",
        node,
      );
    if (
      typeof node.value === "number" &&
      (!Number.isFinite(node.value) ||
        decimalIdentity(node.source) !== decimalIdentity(String(node.value)))
    )
      rejectAt(
        "imprecise_number",
        "Write this number as quoted text to preserve its digits.",
        node,
      );
    const value = node.value === null ? "" : String(node.value);
    if (value.length > MAX_VALUE)
      rejectAt("value_too_large", "Shorten this property value.", node);
    return value;
  };
  const add = (group, key, node, pair, index, readOnly) => {
    let parsed;
    try {
      parsed = parseFieldLabel(key, options);
    } catch {
      rejectAt(
        "invalid_field_label",
        "Fix this field name or its v2 type marker.",
        pair?.key ?? node,
      );
    }
    const value = scalar(node);
    let parts = { value };
    if (
      options.fieldSyntax === "pipes" &&
      !readOnly &&
      typeof node.value === "string"
    ) {
      try {
        parts = parseFieldParts(value);
      } catch {
        rejectAt(
          "invalid_field_parts",
          "Use at most three pipe-separated parts and escape only backslash or pipe.",
          node,
        );
      }
    }
    const field = {
      label: parsed.label,
      ...parts,
      ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
      hide: Boolean(group.hidden || parsed.hide),
      ...(readOnly ? { readOnly: true } : {}),
    };
    if (field.kind === "card" && !parseCardField(field).ok) {
      const components = [
        [
          "number",
          field.value,
          "invalid_card_number",
          "Use 12–19 card digits, optionally separated by spaces or hyphens; remove extra spaces around the number.",
        ],
        [
          "date",
          field.description ?? "",
          "invalid_card_date",
          "Use an expiry date in MM/YY or MM/YYYY format; remove extra spaces around the date.",
        ],
        [
          "cvv",
          field.additionalSecret ?? "",
          "invalid_card_cvv",
          "Use a 3- or 4-digit CVV; remove extra spaces around it.",
        ],
      ];
      for (const [part, component, code, message] of components) {
        try {
          if (normalizeCardPart(part, component) !== component)
            throw new TypeError();
        } catch {
          rejectAt(code, message, node);
        }
      }
      rejectAt("invalid_card_size", "Shorten the typed card value.", node);
    }
    if (++fields > 256)
      rejectAt(
        "too_many_fields",
        "Reduce the properties block to at most 256 fields.",
        pair?.key ?? node,
      );
    if (
      group.entries.some((entry) => identity(entry.field) === identity(field))
    )
      rejectAt(
        "duplicate_field",
        "Rename or remove the repeated field.",
        pair?.key ?? node,
      );
    group.section.fields.push(field);
    group.ranges.push(
      Array.isArray(node?.range)
        ? { from: node.range[0], to: node.range[1] }
        : null,
    );
    group.entries.push({ field, key, node, pair, index });
  };
  function walk(node, path, hidden, depth, existing) {
    if (++count > 512)
      rejectAt("too_many_nodes", "Reduce the number of YAML entries.", node);
    if (depth > 16)
      rejectAt(
        "nesting_too_deep",
        "Reduce YAML nesting to at most 16 levels.",
        node,
      );
    if (isAlias(node))
      rejectAt(
        "unsupported_alias",
        "Replace the YAML alias with a direct value.",
        node,
      );
    if (node?.anchor)
      rejectAt(
        "unsupported_anchor",
        "Remove the YAML anchor and write the value directly.",
        node,
      );
    if (node?.tag)
      rejectAt(
        "unsupported_tag",
        "Remove the YAML tag and use a plain mapping or list.",
        node,
      );
    if (!isMap(node) && !isSeq(node))
      rejectAt(
        "invalid_nesting",
        "Use a YAML mapping or list for nested properties.",
        node,
      );
    const group = existing ?? {
      section: { label: pointer(path), fields: [], allowAdd: isMap(node) },
      node,
      entries: [],
      ranges: [],
      path,
      hidden,
    };
    if (!existing) {
      sections.push(group.section);
      groups.push(group);
    }
    if (sections.length > 64)
      rejectAt(
        "too_many_sections",
        "Reduce the number of nested sections.",
        node,
      );
    const keys = new Set();
    node.items.forEach((item, index) => {
      const pair = isMap(node) ? item : null;
      if (++count > 512)
        rejectAt(
          "too_many_nodes",
          "Reduce the number of YAML entries.",
          pair?.key ?? item,
        );
      const key = pair ? pair.key?.value : `[${index + 1}]`;
      if (pair) {
        if (isAlias(pair.key))
          rejectAt(
            "unsupported_alias",
            "Replace the YAML alias with a direct field name.",
            pair.key,
          );
        if (pair.key?.tag)
          rejectAt(
            "unsupported_tag",
            "Remove the YAML tag from this field name.",
            pair.key,
          );
        if (pair.key?.anchor)
          rejectAt(
            "unsupported_anchor",
            "Remove the YAML anchor from this field name.",
            pair.key,
          );
        if (
          !isScalar(pair.key) ||
          !validName(key) ||
          pair.srcToken?.explicitKey
        )
          rejectAt(
            "invalid_name",
            "Use a simple, nonempty YAML field name here.",
            pair.key,
          );
        if (keys.has(key))
          rejectAt(
            "duplicate_key",
            "Remove or rename the duplicate YAML key.",
            pair.key,
          );
      }
      keys.add(key);
      const value = pair ? pair.value : item;
      if (isAlias(value))
        rejectAt(
          "unsupported_alias",
          "Replace the YAML alias with a direct value.",
          value,
        );
      if (value?.tag)
        rejectAt(
          "unsupported_tag",
          "Remove the YAML tag from this value.",
          value,
        );
      if (value?.anchor)
        rejectAt(
          "unsupported_anchor",
          "Remove the YAML anchor and write the value directly.",
          value,
        );
      if (path.length === 0 && MANAGED.has(key)) {
        add(groups[0], key, value, pair, index, true);
      } else if (isMap(value) || isSeq(value)) {
        walk(
          value,
          [...path, pair ? key : index],
          hidden || hiddenKey(key),
          depth + 1,
        );
      } else {
        // Array scalars are copy-only: deleting one would change the identities
        // of later entries. Maps nested inside arrays remain separately editable.
        add(group, key, value, pair, index, isSeq(node));
      }
    });
  }
  if (root) walk(root, [], false, 0, groups[1]);
  return {
    doc,
    root,
    model: { sections },
    groups,
    fieldRanges: groups.map((group) => group.ranges),
  };
}

export function parsePropertiesBody(body, options = {}) {
  try {
    const parsed = read(body, options);
    return options?.diagnostics
      ? { ok: true, model: parsed.model, fieldRanges: parsed.fieldRanges }
      : { ok: true, model: parsed.model };
  } catch (error) {
    return options?.diagnostics
      ? {
          ...INVALID,
          diagnostic:
            error?.diagnostic ??
            blockDiagnostic(
              body,
              "invalid_properties_block",
              "Fix this properties block before previewing it.",
            ),
        }
      : INVALID;
  }
}

function sameRecoveryValues(before, after) {
  if (!isRecoveryField(before)) return false;
  const a = parseRecoveryCodes(before.value),
    b = parseRecoveryCodes(after.value);
  return (
    a.ok &&
    b.ok &&
    a.codes.length === b.codes.length &&
    a.codes.every((entry, index) => entry.value === b.codes[index].value)
  );
}

function tree(node) {
  if (isMap(node))
    return [
      "map",
      node.items.map((pair) => [tree(pair.key), tree(pair.value)]),
    ];
  if (isSeq(node)) return ["seq", node.items.map(tree)];
  return [
    "scalar",
    typeof node?.value === "bigint"
      ? ["integer", String(node.value)]
      : (node?.value ?? null),
  ];
}

function serialize(model, body, options = {}) {
  options = fieldOptions(body, options);
  const parsed = read(body, options);
  if (
    !model ||
    !Array.isArray(model.sections) ||
    model.sections.length !== parsed.groups.length
  )
    fail();
  if (
    model.sections.reduce(
      (total, section) =>
        total + (Array.isArray(section?.fields) ? section.fields.length : 257),
      0,
    ) > 256
  )
    fail();
  const eol = body.includes("\r\n")
    ? "\r\n"
    : body.includes("\r")
      ? "\r"
      : "\n";
  const edits = [];
  const edit = (from, to, text = "", depth = 0) => {
    if (from !== to || text) edits.push({ from, to, text, depth });
  };
  const removed = new Map(),
    appended = new Map();
  const replacement = (node, value) => {
    const [from, to] = node.range;
    let text = JSON.stringify(value);
    if (node.srcToken?.type === "block-scalar") {
      const comments = node.srcToken.props
        .filter((token) => token.type === "comment")
        .map((token) => token.source);
      if (comments.length) text += " " + comments.join(" ");
      if (/[\r\n]$/u.test(body.slice(from, to))) text += eol;
    } else if (from === to) {
      // Null may have no token at all (key: #comment or key:\n).
      if (from > 0 && !/[\s[{,]/u.test(body[from - 1])) text = " " + text;
      if (body[from] === "#") text += " ";
    }
    edit(from, to, text);
    node.value = value;
  };
  for (let index = 0; index < parsed.groups.length; index++) {
    const group = parsed.groups[index],
      section = model.sections[index];
    if (
      !section ||
      section.label !== group.section.label ||
      !Array.isArray(section.fields) ||
      section.readOnly !== group.section.readOnly ||
      section.allowAdd !== group.section.allowAdd
    )
      fail();
    const wanted = section.fields;
    let cursor = 0;
    for (const entry of group.entries) {
      const next = wanted[cursor];
      if (next && identity(next) === identity(entry.field)) {
        if (
          next.readOnly !== entry.field.readOnly ||
          typeof next.value !== "string" ||
          next.value.length > MAX_VALUE ||
          typeof next.hide !== "boolean" ||
          (next.description !== undefined &&
            (typeof next.description !== "string" ||
              next.description.length > MAX_VALUE)) ||
          (next.additionalSecret !== undefined &&
            (typeof next.additionalSecret !== "string" ||
              next.additionalSecret.length > MAX_VALUE))
        )
          fail();
        const componentChanged =
          next.value !== entry.field.value ||
          next.description !== entry.field.description ||
          next.additionalSecret !== entry.field.additionalSecret;
        if (componentChanged) {
          if (
            entry.field.readOnly ||
            (entry.field.value !== next.value &&
              entry.field.value !== "" &&
              !sameRecoveryValues(entry.field, next)) ||
            (entry.field.description !== undefined &&
              (next.description === undefined ||
                (entry.field.description !== "" &&
                  entry.field.description !== next.description))) ||
            (entry.field.additionalSecret !== undefined &&
              (next.additionalSecret === undefined ||
                (entry.field.additionalSecret !== "" &&
                  entry.field.additionalSecret !== next.additionalSecret))) ||
            (options.fieldSyntax !== "pipes" &&
              (next.description !== undefined ||
                next.additionalSecret !== undefined))
          )
            fail();
          if (next.kind === "card" && !parseCardField(next).ok) fail();
          const replacementValue =
            options.fieldSyntax === "pipes"
              ? serializeFieldParts(next)
              : next.value;
          replacement(entry.node, replacementValue);
        }
        cursor++;
      } else {
        if (
          entry.field.readOnly ||
          entry.field.value !== "" ||
          (entry.field.description !== undefined &&
            entry.field.description !== "") ||
          (entry.field.additionalSecret !== undefined &&
            entry.field.additionalSecret !== "") ||
          !entry.pair
        )
          fail();
        if (!removed.has(group.node)) removed.set(group.node, new Set());
        removed.get(group.node).add(entry.pair);
      }
    }
    if (cursor < wanted.length) {
      if (!group.section.allowAdd) fail();
      const keys = new Set(group.node?.items.map((pair) => pair.key.value));
      const additions = [];
      for (const field of wanted.slice(cursor)) {
        if (
          !field ||
          !validName(field.label) ||
          field.label.endsWith("*") ||
          typeof field.hide !== "boolean" ||
          field.readOnly !== undefined ||
          field.value !== "" ||
          (field.description !== undefined && field.description !== "") ||
          (field.additionalSecret !== undefined &&
            field.additionalSecret !== "") ||
          (options.fieldSyntax !== "pipes" &&
            (field.description !== undefined ||
              field.additionalSecret !== undefined ||
              field.kind !== undefined)) ||
          (field.kind === "card" && field.hide !== Boolean(group.hidden)) ||
          (field.kind === "totp" && !field.hide) ||
          (group.hidden && !field.hide)
        )
          fail();
        const key = serializeFieldLabel(
          {
            label: field.label,
            ...(field.kind === undefined ? {} : { kind: field.kind }),
            hide:
              field.kind === "totp"
                ? true
                : field.kind === "card"
                  ? false
                  : field.hide && !group.hidden,
          },
          options,
        );
        if (
          !validName(key) ||
          (group.path.length === 0 && MANAGED.has(key)) ||
          keys.has(key)
        )
          fail();
        keys.add(key);
        additions.push(key);
      }
      appended.set(group.node, additions);
    }
  }
  // Delete only the key/colon/value tokens; comments and surrounding whitespace
  // belong to the authored document, not to a disposable preview row.
  for (const [map, pairs] of removed) {
    for (const pair of pairs) {
      edit(pair.key.range[0], pair.key.range[1]);
      for (const token of pair.srcToken?.sep ?? [])
        if (token.type === "map-value-ind")
          edit(token.offset, token.offset + token.source.length);
      if (pair.value.srcToken?.type === "block-scalar") {
        const token = pair.value.srcToken;
        const header = token.props.find(
          (part) => part.type === "block-scalar-header",
        );
        edit(header.offset, header.offset + header.source.length);
        const start =
          token.props.at(-1).offset + token.props.at(-1).source.length;
        edit(start, start + token.source.length);
      } else edit(pair.value.range[0], pair.value.range[1]);
    }
    if (map.flow) {
      let seen = false;
      map.items.forEach((pair) => {
        if (pairs.has(pair) || !seen) {
          for (const token of pair.srcToken.start)
            if (token.type === "comma") edit(token.offset, token.offset + 1);
        }
        if (!pairs.has(pair)) seen = true;
      });
      if (!seen)
        for (const item of map.srcToken.items)
          for (const token of item.start)
            if (token.type === "comma") edit(token.offset, token.offset + 1);
    } else if (
      pairs.size === map.items.length &&
      !appended.has(map) &&
      map !== parsed.root
    ) {
      // Preserve an emptied nested map as a map, rather than silently turning it
      // into YAML null. The first removed key supplies its original indentation.
      edit(map.items[0].key.range[0], map.items[0].key.range[0], "{}");
    }
    map.items = map.items.filter((pair) => !pairs.has(pair));
  }
  for (const [map, keys] of appended) {
    if (map?.flow) {
      for (const item of map.srcToken.items.slice(-1)) {
        if (!item.key)
          for (const token of item.start)
            if (token.type === "comma") edit(token.offset, token.offset + 1);
      }
      const close = map.srcToken.end.find(
        (token) => token.type === "flow-map-end",
      );
      edit(
        close.offset,
        close.offset,
        (map.items.length ? ", " : "") +
          keys.map((key) => `${JSON.stringify(key)}: ""`).join(", "),
      );
    } else {
      const offset = map?.range[1] ?? body.length;
      const indent = " ".repeat(map?.srcToken.indent ?? 0);
      const prefix = offset > 0 && !/[\r\n]/u.test(body[offset - 1]) ? eol : "";
      const suffix = offset < body.length || /[\r\n]$/u.test(body) ? eol : "";
      edit(
        offset,
        offset,
        prefix +
          keys.map((key) => `${indent}${JSON.stringify(key)}: ""`).join(eol) +
          suffix,
        parsed.groups.find((group) => group.node === map && !group.managed)
          ?.path.length ?? 0,
      );
    }
    if (map) for (const key of keys) map.add(parsed.doc.createPair(key, ""));
    else
      parsed.doc.contents = parsed.doc.createNode(
        Object.fromEntries(keys.map((key) => [key, ""])),
      );
  }
  if (!edits.length) return body;
  // Coalesce duplicate removal ranges (e.g. commas in an emptied flow map).
  const ordered = [
    ...new Map(edits.map((entry) => [JSON.stringify(entry), entry])).values(),
  ].sort((a, b) => a.from - b.from || a.to - b.to || b.depth - a.depth);
  let result = "",
    offset = 0;
  for (const entry of ordered) {
    if (entry.from < offset || entry.to < entry.from) fail();
    result += body.slice(offset, entry.from) + entry.text;
    offset = entry.to;
  }
  result += body.slice(offset);
  const verified = read(result, options);
  const expected = parsed.doc.contents;
  // Root empty YAML and {} are both the same empty properties mapping.
  if (
    JSON.stringify(tree(verified.root)) !== JSON.stringify(tree(expected)) &&
    !(verified.root === null && isMap(expected) && expected.items.length === 0)
  )
    fail();
  return result;
}

export function serializePropertiesBody(model, originalBody, options = {}) {
  try {
    return serialize(model, originalBody, options);
  } catch {
    return fail();
  }
}

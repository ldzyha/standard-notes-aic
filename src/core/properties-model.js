import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { parseFieldLabel, serializeFieldLabel } from "./field-label.js";
import { parseFieldParts, serializeFieldParts } from "./field-parts.js";
import { parseCardField } from "./security-card.js";
import { propertiesSyntax } from "./field-syntax.js";
import { isRecoveryField, parseRecoveryCodes } from "./security-recovery.js";

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
  if (typeof body !== "string" || body.length > MAX_BODY) fail();
  options = fieldOptions(body, options);
  // yaml treats a CR-only directive body as one comment. Never offer an empty
  // editable model for source whose fields the YAML parser did not consume.
  if (
    options.fieldSyntax === "pipes" &&
    body.includes("\r") &&
    !body.includes("\n")
  )
    fail();
  if (options?.fieldSyntax !== undefined && options.fieldSyntax !== "pipes")
    fail();
  const doc = parseDocument(body, {
    keepSourceTokens: true,
    intAsBigInt: true,
    strict: true,
    uniqueKeys: true,
  });
  if (
    doc.errors.length ||
    doc.warnings.length ||
    doc.directives?.docStart ||
    doc.directives?.docEnd ||
    doc.directives?.yaml.explicit ||
    (doc.contents !== null && !isMap(doc.contents))
  )
    fail();
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
    { section: dynamic, node: root, entries: [], managed: true },
    { section: custom, node: root, entries: [], path: [], hidden: false },
  ];
  let count = 0,
    fields = 0;
  const scalar = (node) => {
    if (
      !isScalar(node) ||
      node.tag ||
      node.anchor ||
      !(
        node.value === null ||
        ["string", "number", "bigint", "boolean"].includes(typeof node.value)
      ) ||
      (typeof node.value === "number" &&
        (!Number.isFinite(node.value) ||
          decimalIdentity(node.source) !== decimalIdentity(String(node.value))))
    )
      fail();
    const value = node.value === null ? "" : String(node.value);
    if (value.length > MAX_VALUE) fail();
    return value;
  };
  const add = (group, key, node, pair, index, readOnly) => {
    const parsed = parseFieldLabel(key, options);
    const value = scalar(node);
    const parts =
      options.fieldSyntax === "pipes" &&
      !readOnly &&
      typeof node.value === "string"
        ? parseFieldParts(value)
        : { value };
    const field = {
      label: parsed.label,
      ...parts,
      ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
      hide: Boolean(group.hidden || parsed.hide),
      ...(readOnly ? { readOnly: true } : {}),
    };
    if (field.kind === "card" && !parseCardField(field).ok) fail();
    if (
      ++fields > 256 ||
      group.entries.some((entry) => identity(entry.field) === identity(field))
    )
      fail();
    group.section.fields.push(field);
    group.entries.push({ field, key, node, pair, index });
  };
  function walk(node, path, hidden, depth, existing) {
    if (
      ++count > 512 ||
      depth > 16 ||
      isAlias(node) ||
      node?.tag ||
      node?.anchor
    )
      fail();
    if (!isMap(node) && !isSeq(node)) fail();
    const group = existing ?? {
      section: { label: pointer(path), fields: [], allowAdd: isMap(node) },
      node,
      entries: [],
      path,
      hidden,
    };
    if (!existing) {
      sections.push(group.section);
      groups.push(group);
    }
    if (sections.length > 64) fail();
    const keys = new Set();
    node.items.forEach((item, index) => {
      if (++count > 512) fail();
      const pair = isMap(node) ? item : null;
      const key = pair ? pair.key?.value : `[${index + 1}]`;
      if (
        pair &&
        (!isScalar(pair.key) ||
          pair.key.tag ||
          pair.key.anchor ||
          !validName(key) ||
          pair.srcToken?.explicitKey ||
          keys.has(key))
      )
        fail();
      keys.add(key);
      const value = pair ? pair.value : item;
      if (isAlias(value) || value?.tag || value?.anchor) fail();
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
  return { doc, root, model: { sections }, groups };
}

export function parsePropertiesBody(body, options = {}) {
  try {
    return { ok: true, model: read(body, options).model };
  } catch {
    return INVALID;
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

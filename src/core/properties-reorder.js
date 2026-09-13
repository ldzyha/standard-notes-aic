import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { parsePropertiesBody } from "./properties-model.js";
import { propertiesSyntax } from "./field-syntax.js";

const MANAGED = new Set(["file", "created", "updated"]);

function fail() {
  throw new TypeError("Invalid properties reorder");
}

function index(value, length) {
  if (!Number.isInteger(value) || value < 0 || value >= length) fail();
}

function pointer(path) {
  return (
    "/" +
    path
      .map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1"))
      .join("/")
  );
}

function context(body) {
  const parsed = parsePropertiesBody(body);
  if (!parsed.ok) fail();
  const document = parseDocument(body, {
    keepSourceTokens: true,
    intAsBigInt: true,
    strict: true,
    uniqueKeys: true,
  });
  if (
    document.errors.length ||
    document.warnings.length ||
    !isMap(document.contents)
  )
    fail();
  const root = document.contents;
  const groups = [null, { node: root, parent: null, pair: null, path: [] }];
  function walk(node, path) {
    node.items.forEach((item, itemIndex) => {
      const pair = isMap(node) ? item : null;
      const value = pair ? pair.value : item;
      if (!isMap(value) && !isSeq(value)) return;
      const childPath = [...path, pair ? pair.key.value : itemIndex];
      groups.push({ node: value, parent: node, pair, path: childPath });
      walk(value, childPath);
    });
  }
  walk(root, []);
  if (
    groups.length !== parsed.model.sections.length ||
    groups.some(
      (group, sectionIndex) =>
        sectionIndex > 1 &&
        group &&
        parsed.model.sections[sectionIndex].label !== pointer(group.path),
    )
  )
    fail();
  return { root, groups, model: parsed.model };
}

function lineStart(body, position) {
  return (
    Math.max(
      body.lastIndexOf("\n", position - 1),
      body.lastIndexOf("\r", position - 1),
    ) + 1
  );
}

function lineEnd(body, position) {
  if (position === lineStart(body, position)) return position;
  let cursor = position;
  while (cursor < body.length && body[cursor] !== "\n" && body[cursor] !== "\r")
    cursor += 1;
  if (body[cursor] === "\r" && body[cursor + 1] === "\n") return cursor + 2;
  return cursor < body.length ? cursor + 1 : cursor;
}

// A block-map pair owns its leading CST comments/blank lines and its entire
// value subtree. We splice these exact bytes; YAML stringification is never used.
function pairSegments(body, map, ownerPair) {
  if (
    !isMap(map) ||
    map.srcToken?.type !== "block-map" ||
    map.flow ||
    !map.items.length
  )
    fail();
  const starts = map.items.map((pair, itemIndex) => {
    const keyFrom = pair.key?.range?.[0];
    if (!Number.isInteger(keyFrom)) fail();
    let from;
    if (itemIndex === 0 && ownerPair) {
      const newline = ownerPair.srcToken?.sep?.find(
        (token) => token.type === "newline",
      );
      if (!newline) fail();
      from = newline.offset + newline.source.length;
    } else if (itemIndex === 0) {
      from = lineStart(body, keyFrom);
    } else {
      const first = pair.srcToken?.start?.[0];
      from = lineStart(body, first ? first.offset : keyFrom);
    }
    if (
      from < 0 ||
      from > keyFrom ||
      !/^[ ]*$/u.test(body.slice(lineStart(body, keyFrom), keyFrom))
    )
      fail();
    return from;
  });
  for (let itemIndex = 1; itemIndex < starts.length; itemIndex += 1)
    if (starts[itemIndex] <= starts[itemIndex - 1]) fail();
  const last = map.items.at(-1);
  const terminal = lineEnd(body, last.value?.range?.[2]);
  if (
    !Number.isInteger(terminal) ||
    terminal < starts.at(-1) ||
    terminal > body.length
  )
    fail();
  const ends = starts.slice(1).concat(terminal);
  return starts.map((from, itemIndex) => ({ from, to: ends[itemIndex] }));
}

function validateMove(
  body,
  root,
  map,
  ownerPair,
  sourcePair,
  targetPair,
  cache,
) {
  const sourceIndex = map.items.indexOf(sourcePair);
  const targetIndex = map.items.indexOf(targetPair);
  if (sourceIndex < 0 || targetIndex < 0) fail();
  if (sourceIndex === targetIndex) fail();
  let segments = cache?.segments.get(map);
  if (!segments) {
    segments = pairSegments(body, map, ownerPair);
    cache?.segments.set(map, segments);
  }
  const source = segments[sourceIndex];
  const target = segments[targetIndex];
  if (
    !source ||
    !target ||
    source.from >= source.to ||
    target.from >= target.to
  )
    fail();
  // The version directive belongs to the document and never moves with a key.
  // Other YAML preamble comments have no CST owner. Never guess whether a
  // leading top-level comment belongs to its first key or to the document.
  let preamble = body.slice(0, segments[0].from);
  if (propertiesSyntax(body).fieldSyntax === "pipes")
    preamble = preamble.replace(/^# aic-fields: v2[ \t]*(?:\r\n|\n|\r|$)/u, "");
  if (
    map === root &&
    (sourceIndex === 0 || targetIndex === 0) &&
    preamble.trim()
  )
    fail();
  if (
    map === root &&
    map.items
      .slice(
        Math.min(sourceIndex, targetIndex),
        Math.max(sourceIndex, targetIndex) + 1,
      )
      .some((pair) => MANAGED.has(pair.key.value))
  )
    fail();
  return { sourceIndex, targetIndex, source, target };
}

function move(body, root, map, ownerPair, sourcePair, targetPair) {
  const { sourceIndex, targetIndex, source, target } = validateMove(
    body,
    root,
    map,
    ownerPair,
    sourcePair,
    targetPair,
  );
  let result;
  if (sourceIndex < targetIndex) {
    result =
      body.slice(0, source.from) +
      body.slice(source.to, target.to) +
      body.slice(source.from, source.to) +
      body.slice(target.to);
  } else {
    result =
      body.slice(0, target.from) +
      body.slice(source.from, source.to) +
      body.slice(target.from, source.from) +
      body.slice(source.to);
  }
  // Verify the intended map order and every scalar's type and lexical spelling.
  const [pair] = map.items.splice(sourceIndex, 1);
  map.items.splice(targetIndex, 0, pair);
  const verified = parsePropertiesBody(result);
  if (
    !verified.ok ||
    JSON.stringify(propertiesSyntax(body)) !==
      JSON.stringify(propertiesSyntax(result))
  )
    fail();
  const reparsed = parseDocument(result, {
    keepSourceTokens: true,
    intAsBigInt: true,
    strict: true,
    uniqueKeys: true,
  });
  if (
    reparsed.errors.length ||
    reparsed.warnings.length ||
    JSON.stringify(shape(root)) !== JSON.stringify(shape(reparsed.contents))
  )
    fail();
  return result;
}

function shape(node) {
  if (isMap(node))
    return [
      "map",
      node.items.map((pair) => [shape(pair.key), shape(pair.value)]),
    ];
  if (isSeq(node)) return ["seq", node.items.map(shape)];
  if (!isScalar(node)) fail();
  return [
    "scalar",
    typeof node.value,
    String(node.value),
    node.source,
    node.type,
  ];
}

function fieldPlan(state, sectionIndex, fromIndex, toIndex, cache) {
  const { root, groups, model } = state;
  index(sectionIndex, groups.length);
  if (sectionIndex === 0) fail();
  const group = groups[sectionIndex];
  if (!isMap(group.node)) fail();
  let fields = cache?.fields.get(group.node);
  if (!fields) {
    fields = group.node.items.filter(
      (pair) =>
        isScalar(pair.value) &&
        !(group.node === root && MANAGED.has(pair.key.value)),
    );
    cache?.fields.set(group.node, fields);
  }
  if (fields.length !== model.sections[sectionIndex].fields.length) fail();
  index(fromIndex, fields.length);
  index(toIndex, fields.length);
  return {
    map: group.node,
    ownerPair: group.pair,
    sourcePair: fields[fromIndex],
    targetPair: fields[toIndex],
  };
}

function reorderField(body, sectionIndex, fromIndex, toIndex) {
  const state = context(body);
  const plan = fieldPlan(state, sectionIndex, fromIndex, toIndex);
  if (fromIndex === toIndex) return body;
  return move(
    body,
    state.root,
    plan.map,
    plan.ownerPair,
    plan.sourcePair,
    plan.targetPair,
  );
}

function sectionPlan(state, fromSectionIndex, toSectionIndex) {
  const { groups } = state;
  index(fromSectionIndex, groups.length);
  index(toSectionIndex, groups.length);
  if (fromSectionIndex < 2 || toSectionIndex < 2) fail();
  const source = groups[fromSectionIndex];
  const target = groups[toSectionIndex];
  if (
    !source.pair ||
    !target.pair ||
    source.parent !== target.parent ||
    !isMap(source.parent)
  )
    fail();
  const parentGroup = groups.find((group) => group?.node === source.parent);
  return {
    map: source.parent,
    ownerPair: parentGroup?.pair ?? null,
    sourcePair: source.pair,
    targetPair: target.pair,
  };
}

function reorderSection(body, fromSectionIndex, toSectionIndex) {
  const state = context(body);
  const plan = sectionPlan(state, fromSectionIndex, toSectionIndex);
  if (fromSectionIndex === toSectionIndex) return body;
  return move(
    body,
    state.root,
    plan.map,
    plan.ownerPair,
    plan.sourcePair,
    plan.targetPair,
  );
}

/** Exact-byte reorder of scalar fields in one block-style YAML map. */
export function reorderPropertiesField(body, sectionIndex, fromIndex, toIndex) {
  try {
    return reorderField(body, sectionIndex, fromIndex, toIndex);
  } catch {
    throw new TypeError("Invalid properties reorder");
  }
}

/** Exact-byte reorder of same-parent nested map/sequence groups. */
export function reorderPropertiesSection(
  body,
  fromSectionIndex,
  toSectionIndex,
) {
  try {
    return reorderSection(body, fromSectionIndex, toSectionIndex);
  } catch {
    throw new TypeError("Invalid properties reorder");
  }
}

export function canReorderPropertiesField(
  body,
  sectionIndex,
  fromIndex,
  toIndex,
) {
  return createPropertiesReorderCapabilities(body).field(
    sectionIndex,
    fromIndex,
    toIndex,
  );
}

export function canReorderPropertiesSection(
  body,
  fromSectionIndex,
  toSectionIndex,
) {
  return createPropertiesReorderCapabilities(body).section(
    fromSectionIndex,
    toSectionIndex,
  );
}

/** Parse once per widget lifetime; structural checks avoid full YAML reparse. */
export function createPropertiesReorderCapabilities(body) {
  let state;
  try {
    state = context(body);
  } catch {
    return { field: () => false, section: () => false };
  }
  const cache = { fields: new Map(), segments: new Map() };
  const allowed = (plan) => {
    try {
      validateMove(
        body,
        state.root,
        plan.map,
        plan.ownerPair,
        plan.sourcePair,
        plan.targetPair,
        cache,
      );
      return true;
    } catch {
      return false;
    }
  };
  return {
    field(sectionIndex, fromIndex, toIndex) {
      try {
        return allowed(
          fieldPlan(state, sectionIndex, fromIndex, toIndex, cache),
        );
      } catch {
        return false;
      }
    },
    section(fromSectionIndex, toSectionIndex) {
      try {
        return allowed(sectionPlan(state, fromSectionIndex, toSectionIndex));
      } catch {
        return false;
      }
    },
  };
}

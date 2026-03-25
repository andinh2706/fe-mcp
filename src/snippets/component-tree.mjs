/**
 * Component tree with display names, keys, optional hooks/props.
 * Supports starting from a specific DOM element via startSelector.
 *
 * Depends on: (transitive via resolveFiber, buildFiberEntry)
 */

/* eslint-disable no-undef -- browser globals + helpers injected by bundle */

import {
  getHookAccess, findFiberByElement, getFiberRoot, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber, resolveRootFiber, resolveFiber, buildFiberEntry,
} from './helpers.mjs';

export function componentTree(rootSelector, maxDepth, showHooks, showProps, startSelector, showFunctionDetails) {
  const resolved = resolveFiber(startSelector, rootSelector);
  if (resolved.error) return resolved;

  const opts = { showProps, showHooks, showFunctionDetails };
  const visited = new Set();

  function build(fiber, depth) {
    if (!fiber || depth > maxDepth) return null;
    if (visited.has(fiber)) return null;  // cycle guard
    visited.add(fiber);
    const name = getDisplayName(fiber);
    const isComp = name !== null;

    const children = [];
    let child = fiber.child;
    while (child) {
      const sub = build(child, isComp ? depth + 1 : depth);
      if (sub) children.push(sub);
      child = child.sibling;
    }

    if (!isComp) {
      if (children.length === 0) return null;
      return children.length === 1 ? children[0] : children;
    }

    const node = buildFiberEntry(fiber, opts);
    const flat = children.flat(Infinity).filter(Boolean);
    if (flat.length > 0) node.children = flat;
    return node;
  }

  const result = { source: resolved.source, tree: build(resolved.fiber, 0) };
  if (startSelector) result.startSelector = startSelector;
  return result;
}

export const deps = [
  getHookAccess, findFiberByElement, getFiberRoot, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber, resolveRootFiber, resolveFiber, buildFiberEntry,
];

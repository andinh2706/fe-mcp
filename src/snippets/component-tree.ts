/**
 * Component tree with display names, keys, optional hooks/props.
 * Supports starting from a specific DOM element via startSelector.
 *
 * Depends on: (transitive via resolveFiber, buildFiberEntry)
 */

import {
  getHookAccess, findFiberByElement, getFiberRoot, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber, resolveRootFiber, resolveFiber, buildFiberEntry,
} from './helpers.js';

export function componentTree(rootSelector: any, maxDepth: number, showHooks: boolean, showProps: boolean, startSelector: any, showFunctionDetails: boolean) {
  const resolved = resolveFiber(startSelector, rootSelector);
  if (resolved.error) return resolved;

  const opts = { showProps, showHooks, showFunctionDetails };
  const visited = new Set();

  // Recursively build the tree while COLLAPSING host (DOM) fibers so the result
  // shows only React components. Depth counts component levels only, and a host
  // fiber's children are hoisted up to its nearest component ancestor.
  function build(fiber: any, depth: number): any {
    if (!fiber || depth > maxDepth) return null;
    if (visited.has(fiber)) return null;  // cycle guard
    visited.add(fiber);
    const name = getDisplayName(fiber);
    const isComp = name !== null;   // null name ⇒ host fiber (div, span, …)

    // Recurse into children. Depth only increments across a real component, so
    // intervening DOM nodes don't consume the depth budget.
    const children: any[] = [];
    let child = fiber.child;
    while (child) {
      const sub = build(child, isComp ? depth + 1 : depth);
      if (sub) children.push(sub);
      child = child.sibling;
    }

    // Host fiber: contribute nothing itself — pass its component descendants up
    // (unwrapping a lone child, else returning the array to be flattened above).
    if (!isComp) {
      if (children.length === 0) return null;
      return children.length === 1 ? children[0] : children;
    }

    // Component fiber: emit an entry, flattening any arrays bubbled up from
    // collapsed host subtrees into a single children list.
    const node = buildFiberEntry(fiber, opts);
    const flat = children.flat(Infinity).filter(Boolean);
    if (flat.length > 0) node.children = flat;
    return node;
  }

  const result: any = { source: resolved.source, tree: build(resolved.fiber, 0) };
  if (startSelector) result.startSelector = startSelector;
  return result;
}

export const deps = [
  getHookAccess, findFiberByElement, getFiberRoot, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber, resolveRootFiber, resolveFiber, buildFiberEntry,
];

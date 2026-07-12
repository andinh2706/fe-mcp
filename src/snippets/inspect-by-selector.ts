/**
 * Inspect the React component mounted at a CSS selector.
 *
 * Depends on: (transitive via resolveComponentFiber)
 */

import {
  findFiberByElement, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber,
} from './helpers.js';

export function inspectBySelector(selector: string, showFunctionDetails: boolean) {
  const resolved = resolveComponentFiber(selector);
  if (resolved.error) return resolved;

  const comp = resolved.fiber;

  const hierarchy: any[] = [];
  let parent = comp.return;
  while (parent) {
    const n = getDisplayName(parent);
    if (n) hierarchy.push(n);
    parent = parent.return;
  }

  return {
    component: getDisplayName(comp) || 'Unknown',
    key: comp.key || null,
    props: safeProps(comp, showFunctionDetails),
    hooks: extractHooks(comp, showFunctionDetails),
    parentComponents: hierarchy,
  };
}

export const deps = [
  findFiberByElement, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber,
];

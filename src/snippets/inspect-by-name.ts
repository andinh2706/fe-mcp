/**
 * Inspect a specific component instance by name + targeting criteria.
 * Targeting options (priority order): propFilter → key → instanceIndex
 *
 * Depends on: getHookAccess, findFiberByElement, getFiberRoot,
 *             getDisplayName, describeFn, classifyHook, extractHooks, safeProps, fiberToSelector
 */

import {
  getHookAccess, findFiberByElement, getFiberRoot,
  getDisplayName, browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps, fiberToSelector,
  resolveRootFiber,
} from './helpers.js';

export function inspectByName(targetName: string, targeting: any, showFunctionDetails: boolean) {
  const resolved = resolveRootFiber();
  if (resolved.error) return resolved;

  const { fiber: root, source } = resolved;

  const searchLower = targetName.toLowerCase();
  const candidates: any[] = [];

  function walk(fiber: any, parentPath: any) {
    if (!fiber) return;
    const name = getDisplayName(fiber);
    if (name && name.toLowerCase().includes(searchLower)) {
      candidates.push({ fiber, name, parentPath: [...parentPath] });
    }
    const nextPath = name ? [...parentPath, name] : parentPath;
    let child = fiber.child;
    while (child) {
      walk(child, nextPath);
      child = child.sibling;
    }
  }

  walk(root, []);

  if (candidates.length === 0) {
    return {
      error: 'No component found matching "' + targetName + '"',
      suggestion: 'Use get_component_tree to see available components',
    };
  }

  // Select the target instance
  let selected: any = null;

  if (targeting?.propFilter) {
    selected = candidates.find((c) => {
      const props = c.fiber.memoizedProps || {};
      for (const [k, v] of Object.entries(targeting.propFilter)) {
        try { if (JSON.stringify(props[k]) !== JSON.stringify(v)) return false; }
        catch { return false; }
      }
      return true;
    });
    if (!selected) return {
      error: 'Found ' + candidates.length + ' instance(s) of "' + targetName + '" but none matched prop filter',
      propFilter: targeting.propFilter,
      availableInstances: candidates.map((c, i) => ({
        instanceIndex: i,
        key: c.fiber.key,
        propKeys: Object.keys(c.fiber.memoizedProps || {}).filter((k) => k !== 'children'),
      })),
    };
  } else if (targeting?.key) {
    selected = candidates.find((c) => c.fiber.key === targeting.key);
    if (!selected) return {
      error: 'Found ' + candidates.length + ' instance(s) of "' + targetName + '" but none had key="' + targeting.key + '"',
      availableKeys: candidates.map((c) => c.fiber.key).filter(Boolean),
    };
  } else if (targeting?.instanceIndex !== undefined && targeting?.instanceIndex !== null) {
    selected = candidates[targeting.instanceIndex];
    if (!selected) return {
      error: 'instanceIndex ' + targeting.instanceIndex + ' out of range, found ' + candidates.length + ' instance(s)',
    };
  } else {
    selected = candidates[0];
  }

  const fiber = selected.fiber;

  // Get context chain by walking up
  const contexts: any[] = [];
  let cur = fiber.return;
  while (cur) {
    const type = cur.type;
    if (type && (type.$$typeof === Symbol.for('react.provider') || type._context)) {
      const ctx = type._context || type;
      let value;
      try { value = safeSerialize(cur.memoizedProps?.value).value; }
      catch { value = '[non-serializable]'; }
      contexts.push({ context: ctx.displayName || 'Context', value });
    }
    cur = cur.return;
  }

  return {
    component: selected.name,
    targeting: targeting || {
      instanceIndex: 0,
      note: candidates.length > 1
        ? candidates.length + ' instances found, showing first. Use propFilter, key, or instanceIndex to target a specific one.'
        : 'only instance',
    },
    totalInstances: candidates.length,
    key: fiber.key || null,
    parentPath: selected.parentPath.slice(-5),
    props: safeProps(fiber, showFunctionDetails),
    hooks: extractHooks(fiber, showFunctionDetails),
    contexts: contexts.length > 0 ? contexts : undefined,
    domSelector: fiberToSelector(fiber),
    source,
  };
}

export const deps = [
  getHookAccess, findFiberByElement, getFiberRoot,
  getDisplayName, browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps, fiberToSelector,
  resolveRootFiber,
];

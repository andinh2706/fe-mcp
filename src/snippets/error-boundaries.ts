/**
 * Check for Error Boundaries with caught errors, Suspense fallbacks,
 * and dev-mode error overlays.
 *
 * Depends on: getHookAccess, findFiberByElement, getFiberRoot, getDisplayName
 */

import {
  getHookAccess, findFiberByElement, getFiberRoot, getDisplayName,
  resolveRootFiber, browserLimits,
} from './helpers.js';

export function errorBoundaryChecker() {
  const errors: any[] = [];

  const overlay = document.querySelector('#webpack-dev-server-client-overlay');
  if (overlay) errors.push({ type: 'dev-overlay', visible: true });

  const resolved = resolveRootFiber();
  if (resolved.error) return { errors, message: resolved.error };

  function walk(node: any, depth: number) {
    if (!node || depth > browserLimits().ERROR_BOUNDARY_MAX_DEPTH) return;

    // Class component with getDerivedStateFromError
    if (node.tag === 1 && node.type?.getDerivedStateFromError) {
      const state = node.memoizedState;
      if (state && (state.hasError || state.error)) {
        errors.push({
          type: 'error-boundary',
          component: getDisplayName(node) || 'Unknown',
          error: state.error?.message || state.error || 'Unknown error',
        });
      }
    }

    // Suspense showing fallback
    if (node.tag === 13 && node.memoizedState?.dehydrated === null && node.memoizedProps?.fallback) {
      errors.push({ type: 'suspense-fallback', isShowingFallback: true });
    }

    let child = node.child;
    while (child) {
      walk(child, depth + 1);
      child = child.sibling;
    }
  }

  walk(resolved.fiber, 0);
  return { errors, totalFound: errors.length };
}

export const deps = [browserLimits, getHookAccess, findFiberByElement, getFiberRoot, getDisplayName, resolveRootFiber];

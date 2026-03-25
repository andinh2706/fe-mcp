/**
 * Inspect all React Context values flowing into a component.
 *
 * Depends on: findFiberByElement
 */

/* eslint-disable no-undef -- browser globals + helpers injected by bundle */

import { findFiberByElement, browserLimits, safeSerialize } from './helpers.mjs';

export function inspectContext(selector) {
  const el = document.querySelector(selector);
  if (!el) return { error: 'Element not found: ' + selector };

  const fiber = findFiberByElement(el);
  if (!fiber) return { error: 'No React fiber found' };

  const contexts = [];
  let cur = fiber;
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

  return { selector, contextsFound: contexts.length, contexts };
}

export const deps = [findFiberByElement, browserLimits, safeSerialize];

/**
 * Shared helper functions for React fiber inspection.
 *
 * These functions execute INSIDE the browser page via CDP Runtime.evaluate.
 * They are written as normal TypeScript for full IDE support, linting, and
 * breakpoint debugging, then converted to strings by bundle.ts.
 *
 * Type annotations are erased at transpile time, so the `fn.toString()` output
 * that gets injected into the page is clean, standalone JS. Fiber/DOM internals
 * are typed `any` — they have no stable public shape.
 *
 * All tuneable limits come from browserLimits() (defined in src/limits.ts).
 * That function is self-contained so the bundler can stringify it alongside
 * these helpers.  See src/limits.ts for the authoritative list of values.
 *
 * THE deps CONTRACT: because the browser has no module system, each snippet must
 * pass bundle() the FULL TRANSITIVE closure of helpers it (indirectly) calls, in
 * dependency order. The map below is the reference for that ordering — when a
 * snippet uses e.g. buildFiberEntry, its `deps` array must also include
 * getDisplayName/describeFn/classifyHook/extractHooks/safeProps/browserLimits.
 *
 * Dependency order (functions only reference helpers defined earlier):
 *
 *   browserLimits          (standalone — imported from ../limits.ts)
 *   getHookAccess          (standalone)
 *   findFiberByElement     (standalone)
 *   getFiberRoot           → getHookAccess, findFiberByElement
 *   getDisplayName         (standalone)
 *   safeSerialize          → browserLimits
 *   describeFn             → browserLimits
 *   classifyHook           → browserLimits, describeFn, safeSerialize
 *   extractHooks           → browserLimits, describeFn, classifyHook, safeSerialize
 *   safeProps              → browserLimits, describeFn, safeSerialize
 *   fiberToSelector        → browserLimits
 *   resolveComponentFiber  → findFiberByElement, getDisplayName
 *   resolveRootFiber       → getHookAccess, findFiberByElement, getFiberRoot
 *   resolveFiber           → resolveComponentFiber, resolveRootFiber
 *   buildAncestorPath      → getDisplayName
 *   buildFiberEntry        → getDisplayName, describeFn, classifyHook, extractHooks, safeProps
 */

// Re-export browserLimits so snippets can include it in their deps array.
// The function itself is self-contained (no imports) — safe for fn.toString().
import { browserLimits } from '../limits.js';
export { browserLimits };

// ---------------------------------------------------------------------------
// Fiber lookup
// ---------------------------------------------------------------------------

/**
 * Get the React DevTools hook if available.
 */
export function getHookAccess() {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.renderers || hook.renderers.size === 0) return null;
  const [rendererID, renderer] = Array.from(hook.renderers.entries())[0] as [any, any];
  const roots = hook.getFiberRoots
    ? Array.from(hook.getFiberRoots(rendererID) || [])
    : [];
  return { rendererID, renderer, roots };
}

/**
 * Find the React fiber for a DOM element.
 * Prefers the stable renderer.findFiberByHostInstance API,
 * falls back to __reactFiber$ / __reactInternalInstance$ properties.
 */
export function findFiberByElement(el: any) {
  if (!el) return null;

  // Preferred: DevTools hook renderer API (stable across React versions)
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook && hook.renderers && hook.renderers.size > 0) {
    for (const [, renderer] of hook.renderers) {
      if (typeof renderer.findFiberByHostInstance === 'function') {
        const fiber = renderer.findFiberByHostInstance(el);
        if (fiber) return fiber;
      }
    }
  }

  // Fallback: internal property on the DOM node
  const key = Object.keys(el).find((k) =>
    k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
  return key ? el[key] : null;
}

/**
 * Get the fiber root from DevTools hook or by DOM scanning.
 * Depends on: getHookAccess, findFiberByElement
 */
export function getFiberRoot(selector?: string) {
  const hook = getHookAccess();
  if (hook && hook.roots.length > 0) {
    return { root: (hook.roots[0] as any).current, source: 'devtools-hook' };
  }

  const el = document.querySelector(selector || '#root')
    || document.querySelector('[data-reactroot]')
    || document.querySelector('#__next');
  if (!el) return { root: null, source: 'none', error: 'No React root found' };

  const fiber = findFiberByElement(el);
  if (!fiber) return { root: null, source: 'none', error: 'No React fiber found on root element' };

  let f = fiber;
  while (f.return) f = f.return;
  return { root: f, source: 'fiber-walking' };
}

// ---------------------------------------------------------------------------
// Fiber introspection
// ---------------------------------------------------------------------------

/**
 * Resolve display name for any fiber, handling memo, forwardRef, lazy, Context.
 */
export function getDisplayName(fiber: any): string | null {
  if (!fiber || !fiber.type) return null;
  const type = fiber.type;
  if (typeof type === 'string') return null;   // host element (div, span, …)

  if (type.displayName) return type.displayName;
  if (type.name) return type.name;

  if (type.$$typeof === Symbol.for('react.memo')) {
    const inner = type.type;
    return 'memo(' + (inner?.displayName || inner?.name || 'Anonymous') + ')';
  }
  if (type.$$typeof === Symbol.for('react.forward_ref')) {
    const render = type.render;
    return 'forwardRef(' + (render?.displayName || render?.name || 'Anonymous') + ')';
  }
  if (type.$$typeof === Symbol.for('react.lazy')) {
    const resolved = type._payload?.value || type._result;
    return 'lazy(' + (resolved?.displayName || resolved?.name || '...') + ')';
  }
  if (type.$$typeof === Symbol.for('react.provider') || type._context) {
    return (type._context?.displayName || type.displayName || 'Context') + '.Provider';
  }
  if (type.$$typeof === Symbol.for('react.context') || type.Consumer) {
    return (type.displayName || type._context?.displayName || 'Context') + '.Consumer';
  }
  return 'Anonymous';
}

/**
 * Depth- and size-bounded serializer.
 * Returns a plain JS value (safe for JSON.stringify) or a truncation marker.
 * Avoids JSON.parse(JSON.stringify(x)) which can freeze on large objects.
 *
 * @param val       — the value to serialize
 * @param maxDepth  — how many levels deep to recurse (default 6)
 * @param maxChars  — approximate char budget; once exceeded, bail (default 2000)
 */
export function safeSerialize(val: any, maxDepth?: number, maxChars?: number) {
  const L = browserLimits();
  if (maxDepth === undefined) maxDepth = L.SERIALIZE_MAX_DEPTH;
  if (maxChars === undefined) maxChars = L.SERIALIZE_MAX_CHARS;
  let budget = maxChars;
  const seen = new Set();

  function walk(v: any, depth: number): any {
    if (budget <= 0) return '[…truncated]';
    if (v === null || v === undefined) return v;

    const t = typeof v;
    if (t === 'boolean' || t === 'number') return v;
    if (t === 'string') {
      budget -= v.length;
      return v.length > L.SERIALIZE_STRING_TRUNCATE ? v.slice(0, L.SERIALIZE_STRING_TRUNCATE) + '…' : v;
    }
    if (t === 'function' || t === 'symbol' || t === 'bigint') return '[' + t + ']';
    if (depth > maxDepth!) return '[…depth-limit]';

    // Circular reference guard
    if (seen.has(v)) return '[circular]';
    seen.add(v);

    try {
      if (Array.isArray(v)) {
        const out: any[] = [];
        const len = Math.min(v.length, L.SERIALIZE_MAX_ARRAY_ITEMS);
        for (let i = 0; i < len && budget > 0; i++) out.push(walk(v[i], depth + 1));
        if (v.length > L.SERIALIZE_MAX_ARRAY_ITEMS) out.push('[…' + (v.length - L.SERIALIZE_MAX_ARRAY_ITEMS) + ' more]');
        return out;
      }

      const keys = Object.keys(v);
      const out: any = {};
      const len = Math.min(keys.length, L.SERIALIZE_MAX_OBJECT_KEYS);
      for (let i = 0; i < len && budget > 0; i++) {
        const k = keys[i];
        budget -= k.length;
        out[k] = walk(v[k], depth + 1);
      }
      if (keys.length > L.SERIALIZE_MAX_OBJECT_KEYS) out['…'] = keys.length - L.SERIALIZE_MAX_OBJECT_KEYS + ' more keys';
      return out;
    } finally {
      seen.delete(v);
    }
  }

  const result = walk(val, 0);
  return { value: result, truncated: budget <= 0 };
}

/**
 * Describe a function value with name, body, and parameter count.
 * Used when showFunctionDetails is true in classifyHook / safeProps.
 */
export function describeFn(fn: any) {
  if (typeof fn !== 'function') return '[not-a-function]';
  const L = browserLimits();
  const body = fn.toString();
  return {
    functionName: fn.name || '(anonymous)',
    functionBody: body.length > L.FUNCTION_BODY_MAX_LENGTH ? body.slice(0, L.FUNCTION_BODY_MAX_LENGTH) + '...[truncated]' : body,
    paramCount: fn.length,
  };
}

/**
 * Classify a single hook node by inspecting its internal React shape.
 *
 * The checks are ORDER-SENSITIVE — most distinctive shape first:
 *   1. a `queue`            → useState / useReducer
 *   2. `{ current }` only   → useRef
 *   3. `{ create, destroy }`→ useEffect / useLayoutEffect (tag & 4)
 *   4. `[value, deps]`      → useMemo / useCallback
 *   5. otherwise            → unknown
 * These are React-internal heuristics; unrecognized shapes fall through to
 * "unknown" rather than throwing.
 *
 * @param showFunctionDetails — if true, expand functions to {functionName, functionBody, paramCount}
 */
export function classifyHook(hook: any, index: number, showFunctionDetails: boolean): any {
  const ms = hook.memoizedState;
  const queue = hook.queue;

  function serVal(v: any) {
    if (typeof v === 'function') {
      return showFunctionDetails ? describeFn(v) : '[function]';
    }
    return safeSerialize(v).value;
  }

  // useState / useReducer — has a queue
  if (queue !== null && queue !== undefined) {
    const isReducer = queue.lastRenderedReducer
      && queue.lastRenderedReducer.name !== ''
      && queue.lastRenderedReducer.name !== 'basicStateReducer';
    return { index, type: isReducer ? 'useReducer' : 'useState', value: serVal(ms) };
  }

  // useRef — { current: … }
  if (ms !== null && typeof ms === 'object' && 'current' in ms && Object.keys(ms).length === 1) {
    return { index, type: 'useRef', value: serVal(ms.current) };
  }

  // useEffect / useLayoutEffect — has create + destroy
  if (ms !== null && typeof ms === 'object' && 'create' in ms && 'destroy' in ms) {
    let effectType = 'useEffect';
    if (ms.tag & 4) effectType = 'useLayoutEffect';
    const result: any = { index, type: effectType, deps: safeSerialize(ms.deps).value, hasCleanup: typeof ms.destroy === 'function' };
    if (showFunctionDetails) {
      result.create = describeFn(ms.create);
      if (typeof ms.destroy === 'function') result.destroy = describeFn(ms.destroy);
    }
    return result;
  }

  // useMemo / useCallback — [value, deps]
  if (Array.isArray(ms) && ms.length === 2 && Array.isArray(ms[1])) {
    const isCallback = typeof ms[0] === 'function';
    const value = isCallback
      ? (showFunctionDetails ? describeFn(ms[0]) : '[function]')
      : safeSerialize(ms[0]).value;
    return { index, type: isCallback ? 'useCallback' : 'useMemo', value, deps: safeSerialize(ms[1]).value };
  }

  // Unknown
  return { index, type: 'unknown', value: serVal(ms) };
}

/**
 * Extract all hooks from a fiber by walking its memoizedState linked list
 * (capped at MAX_HOOKS_PER_FIBER), classifying each node.
 *
 * Only meaningful for FUNCTION components, whose memoizedState is the hook list.
 * For CLASS components memoizedState is the state object (no `.next`), so this
 * yields a single {type:'unknown'} entry — a known, harmless inaccuracy.
 *
 * Depends on: describeFn, classifyHook
 */
export function extractHooks(fiber: any, showFunctionDetails: boolean) {
  const L = browserLimits();
  const hooks = [];
  let hook = fiber.memoizedState;
  let idx = 0;
  while (hook && idx < L.MAX_HOOKS_PER_FIBER) {
    hooks.push(classifyHook(hook, idx, showFunctionDetails));
    hook = hook.next;
    idx++;
  }
  return hooks;
}

/**
 * Serialize props safely with a per-value size cap.
 * @param showFunctionDetails — if true, expand functions to {functionName, functionBody, paramCount}
 */
export function safeProps(fiber: any, showFunctionDetails: boolean) {
  const L = browserLimits();
  const raw = fiber.memoizedProps || {};
  const result: any = {};
  const keys = Object.keys(raw);

  for (let i = 0; i < keys.length && i < L.PROPS_MAX_KEYS; i++) {
    const k = keys[i];
    if (k === 'children') continue;
    const v = raw[k];
    if (typeof v === 'function') {
      result[k] = showFunctionDetails ? describeFn(v) : '[function]';
    } else {
      result[k] = safeSerialize(v, L.PROPS_SERIALIZE_DEPTH, L.PROPS_SERIALIZE_CHARS).value;
    }
  }
  if (keys.length > L.PROPS_MAX_KEYS) {
    result['…'] = (keys.length - L.PROPS_MAX_KEYS) + ' more props';
  }
  return result;
}

/**
 * Build a reliable CSS selector for the nearest DOM node under a fiber.
 * Walks up the DOM tree from the element, building a path of selectors.
 * Stops when it hits an element with an id or data-testid (scoping anchor).
 */
export function fiberToSelector(fiber: any): string | null {
  // Find the nearest host (DOM) fiber — guard against cycles
  let dom = fiber;
  const seen = new Set();
  while (dom && typeof dom.type !== 'string') {
    if (seen.has(dom)) return null;  // cycle detected
    seen.add(dom);
    dom = dom.child;
  }
  if (!dom || !dom.stateNode) return null;

  const el = dom.stateNode;
  if (!(el instanceof Element)) return null;

  // Walk up from el to a scoped anchor, collecting selector parts
  const parts: string[] = [];
  let cur: any = el;
  let steps = 0;

  while (cur && cur !== document.documentElement && steps < browserLimits().SELECTOR_MAX_DOM_STEPS) {
    steps++;

    // Scoping anchors
    if (cur.id) {
      parts.push('#' + cur.id);
    } else if (cur.dataset?.testid) {
      parts.push('[data-testid="' + cur.dataset.testid + '"]');
    } else {
      // Build a selector segment for this element
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;

      if (parent) {
        // Count same-tag siblings to produce :nth-of-type
        const siblings = parent.children;
        let sameTagCount = 0;
        let index = 0;
        for (let i = 0; i < siblings.length; i++) {
          if (siblings[i].tagName === cur.tagName) {
            sameTagCount++;
            if (siblings[i] === cur) index = sameTagCount;
          }
        }
        parts.push(sameTagCount > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
      } else {
        parts.push(tag);
      }
    }

    // Optimization: if current path is unique, return immediately
    const selector = parts.slice().reverse().join(' > ');
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }

    // Stop if we hit a scoping anchor (already added and checked for uniqueness)
    if (cur.id || cur.dataset?.testid) {
      break;
    }

    cur = cur.parentElement;
  }

  return parts.reverse().join(' > ') || null;
}

// ---------------------------------------------------------------------------
// Higher-level utilities (composed from the primitives above)
// ---------------------------------------------------------------------------

/**
 * Resolve a CSS selector to the nearest named React component fiber.
 * Returns { fiber, source: 'selector' } or { error: '...' }.
 * Depends on: findFiberByElement, getDisplayName
 */
export function resolveComponentFiber(selector: string): any {
  const el = document.querySelector(selector);
  if (!el) return { error: 'Element not found: ' + selector };

  const fiber = findFiberByElement(el);
  if (!fiber) return { error: 'No React fiber found on element: ' + selector };

  let comp = fiber;
  while (comp && !getDisplayName(comp)) comp = comp.return;
  if (!comp) return { error: 'No React component found above element: ' + selector };

  return { fiber: comp, source: 'selector' };
}

/**
 * Resolve the React root fiber.
 * Returns { fiber, source } or { error: '...' }.
 * Depends on: getHookAccess, findFiberByElement, getFiberRoot
 */
export function resolveRootFiber(rootSelector?: string): any {
  const result = getFiberRoot(rootSelector);
  if (!result.root) return { error: result.error || 'No React root' };
  return { fiber: result.root, source: result.source };
}

/**
 * Resolve a fiber from startSelector (if provided) or from the root.
 * Returns { fiber, source } or { error: '...' }.
 * Depends on: resolveComponentFiber, resolveRootFiber (+ their transitive deps)
 */
export function resolveFiber(startSelector?: string, rootSelector?: string): any {
  return startSelector
    ? resolveComponentFiber(startSelector)
    : resolveRootFiber(rootSelector);
}

/**
 * Build the full ancestor path (component names) from a fiber's parent up to root.
 * Returns an array ordered root-first.
 * Depends on: getDisplayName
 */
export function buildAncestorPath(fiber: any) {
  const ancestors: any[] = [];
  let cur = fiber.return;
  while (cur) {
    const name = getDisplayName(cur);
    if (name) ancestors.push(name);
    cur = cur.return;
  }
  return ancestors.reverse();
}

/**
 * Build a standard fiber entry object with component name, key, optional props/hooks.
 * @param opts  - { showProps?, showHooks?, showFunctionDetails? }
 * Depends on: getDisplayName, describeFn, classifyHook, extractHooks, safeProps
 */
export function buildFiberEntry(fiber: any, opts: any) {
  const name = getDisplayName(fiber);
  const entry: any = { component: name || 'Unknown' };
  if (fiber.key) entry.key = fiber.key;
  if (opts && opts.showProps) entry.props = safeProps(fiber, opts.showFunctionDetails);
  if (opts && opts.showHooks) {
    const h = extractHooks(fiber, opts.showFunctionDetails);
    if (h.length > 0) entry.hooks = h;
  }
  return entry;
}

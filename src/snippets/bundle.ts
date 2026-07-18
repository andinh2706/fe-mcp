/**
 * Bundle a snippet function with its helper dependencies into a
 * self-contained string for CDP Runtime.evaluate().
 *
 * Helpers are hoisted as `var` declarations inside an IIFE wrapper,
 * so the snippet function can reference them by name.
 *
 * Usage:
 *   import { bundle } from './bundle.js';
 *   import { mySnippet } from './my-snippet.js';
 *   import { helperA, helperB } from './helpers.js';
 *
 *   const MY_SNIPPET = bundle(mySnippet, [helperA, helperB]);
 *   // → "(function() { var helperA = ...; var helperB = ...; return (function mySnippet(...) { ... }).apply(null, arguments); })"
 *
 *   await evaluate(`(${MY_SNIPPET})(arg1, arg2)`);
 *
 * The browser page has no module system, so the injected string can't `import`
 * anything. Every helper the snippet references — AND every helper THOSE helpers
 * reference (the full transitive closure) — must appear in `helpers`, ordered so
 * each is declared before anything that calls it. A missing dep parses fine but
 * throws a ReferenceError only when the snippet actually runs in the page.
 *
 * @param mainFn    The snippet function (must be a named function)
 * @param helpers   Dependency functions (full transitive closure), ordered so
 *                  that each only references functions listed before it.
 * @returns Self-contained IIFE string
 */
/**
 * Runtime helpers that esbuild (via tsx) injects at MODULE scope, re-declared here
 * so they travel with the bundle.
 *
 * tsx hard-codes esbuild's `keepNames: true`, which preserves `fn.name` through
 * minification by rewriting every named nested function into a `__name(fn, "fn")`
 * call and emitting the `__name` helper alongside the module. But we ship functions
 * via `fn.toString()`, which captures only the function BODY — the module-scope
 * helper is left behind in Node, and the surviving call blows up in the page with
 * "ReferenceError: __name is not defined". (8 of our 9 snippets have a nested named
 * function; only PAGE_INFO doesn't, which is why it alone kept working.)
 *
 * This is esbuild's own definition. It MUST return its target: esbuild also emits
 * `__name` in expression position, e.g. `var f = __name((a) => …, "f")`.
 */
const ESBUILD_HELPERS = [
  'var __name = function(target, value) { return Object.defineProperty(target, "name", { value: value, configurable: true }); };',
];

/** The helper names ESBUILD_HELPERS above actually provides. */
const PROVIDED = new Set(['__name']);

/**
 * Other helpers esbuild is known to inject the same way. None should reach a bundle
 * at our ES2022 target — but if a tsx/esbuild upgrade or a new syntax feature starts
 * emitting one, we want to know HERE (at import time, so the server refuses to start)
 * rather than as a ReferenceError inside the browser on some future tool call.
 *
 * Deliberately an explicit list, not a `/__\w+/` scan: the snippets legitimately
 * reference dunder browser globals (`__REACT_DEVTOOLS_GLOBAL_HOOK__`, `__REDUX_STORE__`,
 * `__reactFiber$…`), which such a scan would flag as false positives.
 */
const ESBUILD_INJECTED =
  /\b__(name|defProp|defNormalProp|spreadValues|spreadProps|objRest|async|await|publicField|decorateClass|toESM|toCommonJS|awaiter|generator|rest)\b/g;

export function bundle(mainFn: Function, helpers: Function[] = []): string {
  // Emit each helper as a hoisted `var name = <source>` so the snippet body can
  // call it by name. `fn.toString()` yields the (type-stripped) function source.
  const parts = helpers.map((fn) => {
    if (!fn.name) throw new Error('bundle: all helpers must be named functions');
    return `  var ${fn.name} = ${fn.toString()};`;
  });

  // Wrap in an IIFE and forward call args through `arguments`, so the caller can
  // invoke the whole bundle as `(BUNDLE)(a, b, …)`.
  const code =
    `(function() {\n` +
    ESBUILD_HELPERS.map((h) => `  ${h}`).join('\n') + '\n' +
    `${parts.join('\n')}\n` +
    `  return (${mainFn.toString()}).apply(null, arguments);\n})`;

  // Fail loudly at import time if esbuild injected a helper we don't ship.
  const unresolved = [...new Set(code.match(ESBUILD_INJECTED) ?? [])].filter((h) => !PROVIDED.has(h));
  if (unresolved.length > 0) {
    throw new Error(
      `bundle(${mainFn.name}): esbuild injected helper(s) [${unresolved.join(', ')}] that are not ` +
      `defined in the bundle. They live at module scope and do not survive fn.toString(), so this ` +
      `snippet would throw a ReferenceError in the page. Add their definitions to ESBUILD_HELPERS ` +
      `in src/snippets/bundle.ts.`
    );
  }

  return code;
}

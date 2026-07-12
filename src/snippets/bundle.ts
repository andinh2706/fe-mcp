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
export function bundle(mainFn: Function, helpers: Function[] = []): string {
  // Emit each helper as a hoisted `var name = <source>` so the snippet body can
  // call it by name. `fn.toString()` yields the (type-stripped) function source.
  const parts = helpers.map((fn) => {
    if (!fn.name) throw new Error('bundle: all helpers must be named functions');
    return `  var ${fn.name} = ${fn.toString()};`;
  });
  // Wrap in an IIFE and forward call args through `arguments`, so the caller can
  // invoke the whole bundle as `(BUNDLE)(a, b, …)`.
  return `(function() {\n${parts.join('\n')}\n  return (${mainFn.toString()}).apply(null, arguments);\n})`;
}

/**
 * Bundle a snippet function with its helper dependencies into a
 * self-contained string for CDP Runtime.evaluate().
 *
 * Helpers are hoisted as `const` declarations inside an IIFE wrapper,
 * so the snippet function can reference them by name.
 *
 * Usage:
 *   import { bundle } from './bundle.mjs';
 *   import { mySnippet } from './my-snippet.mjs';
 *   import { helperA, helperB } from './helpers.mjs';
 *
 *   const MY_SNIPPET = bundle(mySnippet, [helperA, helperB]);
 *   // → "(function() { const helperA = ...; const helperB = ...; return (function mySnippet(...) { ... }).apply(null, arguments); })"
 *
 *   await evaluate(`(${MY_SNIPPET})(arg1, arg2)`);
 *
 * @param {Function} mainFn    The snippet function (must be a named function)
 * @param {Function[]} helpers Dependency functions, ordered so that each function
 *                             only references functions listed before it.
 * @returns {string} Self-contained IIFE string
 */
export function bundle(mainFn, helpers = []) {
  const parts = helpers.map(fn => {
    if (!fn.name) throw new Error('bundle: all helpers must be named functions');
    return `  var ${fn.name} = ${fn.toString()};`;
  });
  return `(function() {\n${parts.join('\n')}\n  return (${mainFn.toString()}).apply(null, arguments);\n})`;
}

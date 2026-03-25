/**
 * React Fiber Snippets — barrel module
 *
 * Imports normal JS functions from individual snippet files, converts them
 * into self-contained strings via bundle(), and re-exports the same constant
 * names that tools/react.mjs and tools/store.mjs expect.
 *
 * Each snippet file exports:
 *   - A named function (the snippet logic)
 *   - A `deps` array  (helper functions it needs, in dependency order)
 *
 * The bundle() utility uses fn.toString() to serialise everything into a
 * single IIFE string suitable for CDP Runtime.evaluate().
 */

import { bundle } from './bundle.mjs';

import { pageInfo,              deps as pageInfoDeps }            from './page-info.mjs';
import { componentTree,         deps as componentTreeDeps }       from './component-tree.mjs';
import { componentPath,         deps as componentPathDeps }       from './component-path.mjs';
import { findComponents,        deps as findComponentsDeps }      from './find-components.mjs';
import { inspectByName,         deps as inspectByNameDeps }       from './inspect-by-name.mjs';
import { inspectBySelector,     deps as inspectBySelectorDeps }   from './inspect-by-selector.mjs';
import { inspectContext,        deps as inspectContextDeps }      from './inspect-context.mjs';
import { errorBoundaryChecker,  deps as errorBoundaryDeps }       from './error-boundaries.mjs';
import { storeReader,           deps as storeReaderDeps }         from './store-reader.mjs';

export const PAGE_INFO                  = bundle(pageInfo,             pageInfoDeps);
export const COMPONENT_TREE             = bundle(componentTree,        componentTreeDeps);
export const COMPONENT_PATH             = bundle(componentPath,        componentPathDeps);
export const FIND_COMPONENTS            = bundle(findComponents,       findComponentsDeps);
export const INSPECT_COMPONENT_BY_NAME  = bundle(inspectByName,        inspectByNameDeps);
export const INSPECT_COMPONENT_BY_SELECTOR = bundle(inspectBySelector, inspectBySelectorDeps);
export const INSPECT_CONTEXT            = bundle(inspectContext,       inspectContextDeps);
export const ERROR_BOUNDARY_CHECKER     = bundle(errorBoundaryChecker, errorBoundaryDeps);
export const STORE_READER               = bundle(storeReader,          storeReaderDeps);

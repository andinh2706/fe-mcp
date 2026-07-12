/**
 * Global type augmentations for the browser-side snippet code.
 *
 * Snippet functions (src/snippets/*) run inside the page via CDP
 * Runtime.evaluate() and read framework globals that standard `lib.dom.d.ts`
 * doesn't know about (React DevTools hook, exposed stores, Next.js data).
 *
 * This declaration is type-only and erased at transpile time, so it never
 * affects the `fn.toString()` output that gets injected into the page.
 */
export {};

declare global {
  interface Window {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: any;
    __REDUX_STORE__?: any;
    __ZUSTAND_STORE__?: any;
    __STORE__?: any;
    __REDUX_DEVTOOLS_EXTENSION__?: any;
    __NEXT_DATA__?: any;
    store?: any;
    React?: any;
    /** Snippets scan window for arbitrary store-like globals by key. */
    [key: string]: any;
  }
}

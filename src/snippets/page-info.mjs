/**
 * Page info: React detection, version, stores, dev/prod mode.
 * Depends on: getHookAccess
 */

/* eslint-disable no-undef -- browser globals + helpers injected by bundle */

import { getHookAccess } from './helpers.mjs';

export function pageInfo() {
  const hook = getHookAccess();
  const root = document.querySelector('#root')
    || document.querySelector('[data-reactroot]')
    || document.querySelector('#__next');

  const info = {
    url: window.location.href,
    title: document.title,
    react: {
      detected: !!(root || hook),
      version: hook?.renderer?.version || window.React?.version || null,
      devtoolsHook: !!hook,
    },
    stores: {
      redux: !!(window.__REDUX_STORE__ || window.store || window.__REDUX_DEVTOOLS_EXTENSION__),
      zustand: !!(window.__ZUSTAND_STORE__ || window.__STORE__),
    },
    router: {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    },
    nextjs: !!window.__NEXT_DATA__,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };

  if (hook?.renderer) {
    info.react.mode = hook.renderer.bundleType === 0 ? 'production' : 'development';
  }
  return info;
}

export const deps = [getHookAccess];

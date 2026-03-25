/**
 * Read Redux/Zustand store state with optional dot-path access.
 * No helper dependencies.
 */

/* eslint-disable no-undef -- browser globals accessed via CDP evaluate */

export function storeReader(storeType, path) {
  function accessPath(obj, p) {
    if (!p) return obj;
    return p.split('.').reduce((o, k) => o?.[k], obj);
  }

  if (storeType === 'redux' || storeType === 'auto') {
    const s = window.__REDUX_STORE__ || window.store;
    if (s && typeof s.getState === 'function') {
      const val = accessPath(s.getState(), path);
      try { return { store: 'redux', path: path || '(root)', value: JSON.parse(JSON.stringify(val)) }; }
      catch { return { store: 'redux', path: path || '(root)', value: '[non-serializable]' }; }
    }
    if (window.__REDUX_DEVTOOLS_EXTENSION__) {
      return { store: 'redux-devtools', note: 'Detected but state requires window.__REDUX_STORE__ = store' };
    }
  }

  if (storeType === 'zustand' || storeType === 'auto') {
    const s = window.__ZUSTAND_STORE__ || window.__STORE__;
    if (s && typeof s.getState === 'function') {
      const val = accessPath(s.getState(), path);
      try { return { store: 'zustand', path: path || '(root)', value: JSON.parse(JSON.stringify(val)) }; }
      catch { return { store: 'zustand', path: path || '(root)', value: '[non-serializable]' }; }
    }
  }

  const keys = Object.keys(window).filter(k =>
    typeof window[k] === 'object' && window[k] && typeof window[k].getState === 'function'
  );
  if (keys.length > 0) {
    const val = window[keys[0]].getState();
    try { return { store: keys[0], value: JSON.parse(JSON.stringify(val)) }; }
    catch { return { store: keys[0], note: 'Found but non-serializable' }; }
  }

  return { store: 'none', note: 'No store found. Add: window.__REDUX_STORE__ = store' };
}

export const deps = [];

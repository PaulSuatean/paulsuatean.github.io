/*
  Shared runtime helpers:
  - Toast notifications (used instead of blocking alert dialogs)
  - Debug log gating for production
*/

(function () {
  if (typeof window === 'undefined') return;
  if (window.AncestrioRuntime) return;

  const DEBUG_STORAGE_KEY = 'ancestrio:debug';
  const TOAST_REGION_ID = 'ancestrio-toast-region';
  const pendingToasts = [];
  let toastId = 0;

  const originalConsole = {
    log: typeof console.log === 'function' ? console.log.bind(console) : function () {},
    info: typeof console.info === 'function' ? console.info.bind(console) : function () {},
    debug: typeof console.debug === 'function' ? console.debug.bind(console) : function () {},
    warn: typeof console.warn === 'function' ? console.warn.bind(console) : function () {},
    error: typeof console.error === 'function' ? console.error.bind(console) : function () {}
  };

  function isLocalHost() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  function readDebugFromQuery() {
    try {
      const debugParam = new URLSearchParams(window.location.search).get('debug');
      if (debugParam === '1' || debugParam === 'true') {
        localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      } else if (debugParam === '0' || debugParam === 'false') {
        localStorage.removeItem(DEBUG_STORAGE_KEY);
      }
    } catch (_) {
      // Ignore URL parsing/storage failures.
    }
  }

  function loadDebugFlag() {
    try {
      return localStorage.getItem(DEBUG_STORAGE_KEY) === '1' || isLocalHost();
    } catch (_) {
      return isLocalHost();
    }
  }

  readDebugFromQuery();
  let debugEnabled = loadDebugFlag();

  function ensureToastRegion() {
    if (!document.body) return null;

    let region = document.getElementById(TOAST_REGION_ID);
    if (region) return region;

    region = document.createElement('div');
    region.id = TOAST_REGION_ID;
    region.className = 'ancestrio-toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
    return region;
  }

  function normalizeToastType(type) {
    const allowed = ['info', 'success', 'warning', 'error'];
    return allowed.includes(type) ? type : 'info';
  }

  function createToastElement(message, type, options) {
    const normalizedType = normalizeToastType(type);
    const toast = document.createElement('div');
    toast.className = `ancestrio-toast ancestrio-toast--${normalizedType}`;
    toast.dataset.toastId = `toast-${++toastId}`;
    toast.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', normalizedType === 'error' ? 'assertive' : 'polite');

    const text = document.createElement('div');
    text.className = 'ancestrio-toast__message';
    text.textContent = message == null ? '' : String(message);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ancestrio-toast__close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = 'x';

    closeBtn.addEventListener('click', () => {
      dismissToast(toast);
    });

    toast.appendChild(text);
    toast.appendChild(closeBtn);

    const requestedDuration = Number(options && options.duration);
    const duration = Number.isFinite(requestedDuration)
      ? Math.max(1200, requestedDuration)
      : (normalizedType === 'error' ? 5600 : 4200);

    if (!(options && options.sticky === true)) {
      setTimeout(() => dismissToast(toast), duration);
    }

    return toast;
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.classList.add('is-exit');
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 180);
  }

  function flushPendingToasts() {
    const region = ensureToastRegion();
    if (!region || !pendingToasts.length) return;

    while (pendingToasts.length) {
      const entry = pendingToasts.shift();
      const toast = createToastElement(entry.message, entry.type, entry.options || {});
      region.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('is-visible'));
    }
  }

  function notify(message, type, options) {
    if (!document.body) {
      pendingToasts.push({
        message,
        type,
        options: options || {}
      });
      return;
    }

    const region = ensureToastRegion();
    if (!region) {
      pendingToasts.push({
        message,
        type,
        options: options || {}
      });
      return;
    }

    const toast = createToastElement(message, type, options || {});
    region.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
  }

  function setDebugEnabled(enabled) {
    debugEnabled = !!enabled;
    try {
      if (debugEnabled) {
        localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      } else {
        localStorage.removeItem(DEBUG_STORAGE_KEY);
      }
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function debug(...args) {
    if (debugEnabled) originalConsole.debug.apply(console, args);
  }

  function info(...args) {
    if (debugEnabled) originalConsole.info.apply(console, args);
  }

  function log(...args) {
    if (debugEnabled) originalConsole.log.apply(console, args);
  }

  window.AncestrioRuntime = {
    notify,
    isDebugEnabled: function () { return debugEnabled; },
    setDebugEnabled,
    logger: {
      debug,
      info,
      log,
      warn: function (...args) { originalConsole.warn.apply(console, args); },
      error: function (...args) { originalConsole.error.apply(console, args); }
    }
  };

  // Activate deferred font stylesheets.
  // The media="print" onload="this.media='all'" pattern is blocked by CSP
  // (no 'unsafe-inline' in script-src), so we switch them here instead.
  function activateDeferredFonts() {
    var links = document.querySelectorAll('link[data-font-opt][media="print"]');
    for (var i = 0; i < links.length; i++) {
      links[i].media = 'all';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      flushPendingToasts();
      activateDeferredFonts();
    }, { once: true });
  } else {
    flushPendingToasts();
    activateDeferredFonts();
  }
})();

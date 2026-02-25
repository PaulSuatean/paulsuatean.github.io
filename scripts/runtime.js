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

  const originalAlert = typeof window.alert === 'function'
    ? window.alert.bind(window)
    : null;

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

  function applyConsoleGate(debugEnabled) {
    if (debugEnabled) {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.debug = originalConsole.debug;
      return;
    }

    console.log = function () {};
    console.info = function () {};
    console.debug = function () {};
  }

  readDebugFromQuery();
  let debugEnabled = loadDebugFlag();
  applyConsoleGate(debugEnabled);

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
    applyConsoleGate(debugEnabled);
  }

  function debug() {
    if (debugEnabled) originalConsole.debug.apply(console, arguments);
  }

  function info() {
    if (debugEnabled) originalConsole.info.apply(console, arguments);
  }

  function log() {
    if (debugEnabled) originalConsole.log.apply(console, arguments);
  }

  window.AncestrioRuntime = {
    notify,
    isDebugEnabled: function () { return debugEnabled; },
    setDebugEnabled,
    logger: {
      debug,
      info,
      log,
      warn: function () { originalConsole.warn.apply(console, arguments); },
      error: function () { originalConsole.error.apply(console, arguments); }
    }
  };

  window.alert = function (message) {
    notify(message, 'error');
    if (debugEnabled && originalAlert) {
      originalConsole.warn('Blocked alert message redirected to toast:', message);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', flushPendingToasts, { once: true });
  } else {
    flushPendingToasts();
  }
})();

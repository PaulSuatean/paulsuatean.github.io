(function (global) {
  if (!global || !global.document) return;
  if (global.AncestrioDeps) return;

  const scriptPromises = new Map();
  const FIREBASE_COMPAT_VERSION = '12.10.0';
  const FIREBASE_COMPAT_SCRIPTS = [
    `https://www.gstatic.com/firebasejs/${FIREBASE_COMPAT_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_COMPAT_VERSION}/firebase-auth-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_COMPAT_VERSION}/firebase-firestore-compat.js`
  ];
  const D3_SCRIPT = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
  const TOPOJSON_SCRIPT = 'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js';

  function toAbsoluteUrl(src) {
    try {
      return new URL(src, global.location.href).href;
    } catch (_) {
      return String(src || '');
    }
  }

  function findExistingScript(absoluteUrl) {
    const scripts = global.document.querySelectorAll('script[src]');
    for (let i = 0; i < scripts.length; i += 1) {
      const script = scripts[i];
      if (toAbsoluteUrl(script.getAttribute('src')) === absoluteUrl) {
        return script;
      }
    }
    return null;
  }

  function waitForExistingScript(script, absoluteUrl) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
      };
      const handleLoad = () => {
        cleanup();
        resolve(script);
      };
      const handleError = () => {
        cleanup();
        scriptPromises.delete(absoluteUrl);
        reject(new Error(`Failed to load script: ${absoluteUrl}`));
      };

      if (script.dataset.ancestrioLoaded === 'true') {
        resolve(script);
        return;
      }

      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
    });
  }

  function loadScript(config) {
    const options = typeof config === 'string' ? { src: config } : (config || {});
    const src = String(options.src || '').trim();
    if (!src) {
      return Promise.reject(new Error('Cannot load a script without a src.'));
    }

    const absoluteUrl = toAbsoluteUrl(src);
    if (scriptPromises.has(absoluteUrl)) {
      return scriptPromises.get(absoluteUrl);
    }

    const existingScript = findExistingScript(absoluteUrl);
    if (existingScript) {
      const promise = waitForExistingScript(existingScript, absoluteUrl);
      scriptPromises.set(absoluteUrl, promise);
      return promise;
    }

    const promise = new Promise((resolve, reject) => {
      const script = global.document.createElement('script');
      script.src = src;
      script.defer = true;
      script.dataset.ancestrioManaged = 'true';
      if (options.integrity) script.integrity = options.integrity;
      if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
      if (options.referrerPolicy) script.referrerPolicy = options.referrerPolicy;

      script.addEventListener('load', () => {
        script.dataset.ancestrioLoaded = 'true';
        resolve(script);
      }, { once: true });

      script.addEventListener('error', () => {
        scriptPromises.delete(absoluteUrl);
        reject(new Error(`Failed to load script: ${src}`));
      }, { once: true });

      (global.document.head || global.document.documentElement).appendChild(script);
    });

    scriptPromises.set(absoluteUrl, promise);
    return promise;
  }

  function loadScriptsInOrder(configs) {
    const queue = Array.isArray(configs) ? configs : [];
    return queue.reduce((chain, config) => chain.then(() => loadScript(config)), Promise.resolve());
  }

  function hasCompatFirebase() {
    return Boolean(
      global.firebase &&
      !global.firebase.__ancestrioModern &&
      typeof global.firebase.initializeApp === 'function'
    );
  }

  function ensureFirebaseSdk() {
    if (global.AncestrioFirebaseModules) {
      return Promise.resolve(global.AncestrioFirebaseModules);
    }
    if (hasCompatFirebase()) {
      return Promise.resolve(global.firebase);
    }
    return loadScriptsInOrder(FIREBASE_COMPAT_SCRIPTS).then(() => {
      if (global.AncestrioFirebaseModules) {
        return global.AncestrioFirebaseModules;
      }
      if (hasCompatFirebase()) {
        return global.firebase;
      }
      throw new Error('Firebase SDK failed to load.');
    });
  }

  function ensureFirebaseApp() {
    if (global.auth && global.db) {
      return Promise.resolve(true);
    }
    return ensureFirebaseSdk().then(() => {
      if (global.auth && global.db) {
        return true;
      }
      if (typeof global.initializeFirebase === 'function') {
        try {
          return Boolean(global.initializeFirebase());
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return false;
    });
  }

  function ensureD3() {
    if (global.d3) {
      return Promise.resolve(global.d3);
    }
    return loadScript({
      src: D3_SCRIPT,
      crossOrigin: 'anonymous'
    }).then(() => {
      if (global.d3) {
        return global.d3;
      }
      throw new Error('D3 failed to load.');
    });
  }

  function ensureTopojson() {
    if (global.topojson) {
      return Promise.resolve(global.topojson);
    }
    return loadScript({
      src: TOPOJSON_SCRIPT,
      crossOrigin: 'anonymous'
    }).then(() => {
      if (global.topojson) {
        return global.topojson;
      }
      throw new Error('TopoJSON failed to load.');
    });
  }

  function scheduleIdle(callback, timeout) {
    const safeCallback = typeof callback === 'function' ? callback : function () {};
    const idleTimeout = Number.isFinite(timeout) ? timeout : 1500;

    if (typeof global.requestIdleCallback === 'function') {
      return global.requestIdleCallback(safeCallback, { timeout: idleTimeout });
    }

    return global.setTimeout(safeCallback, Math.min(idleTimeout, 500));
  }

  global.AncestrioDeps = {
    ensureD3,
    ensureFirebaseApp,
    ensureFirebaseSdk,
    ensureTopojson,
    loadScript,
    loadScriptsInOrder,
    scheduleIdle
  };
})(window);

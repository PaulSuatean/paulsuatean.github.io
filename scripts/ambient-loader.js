(function (global) {
  if (!global || !global.document || global.AncestrioAmbientLoader) return;

  function readBundleSrc() {
    return (
      document.documentElement.getAttribute('data-ambient-bundle') ||
      document.body?.getAttribute('data-ambient-bundle') ||
      ''
    ).trim();
  }

  function markLoaded(src) {
    document.documentElement.setAttribute('data-ambient-loaded', src);
  }

  function isLoaded(src) {
    if (!src) return true;
    if (document.documentElement.getAttribute('data-ambient-loaded') === src) return true;
    return Boolean(document.querySelector(`script[data-ambient-bundle-src="${src}"]`));
  }

  function loadBundle(src) {
    if (!src || isLoaded(src)) return;

    const script = document.createElement('script');
    script.defer = true;
    script.src = src;
    script.setAttribute('data-ambient-bundle-src', src);
    script.addEventListener('load', () => markLoaded(src), { once: true });
    (document.head || document.documentElement).appendChild(script);
  }

  function schedule(src) {
    const bundleSrc = String(src || readBundleSrc()).trim();
    if (!bundleSrc) return;

    const afterPaint = () => {
      const loader = () => loadBundle(bundleSrc);
      global.requestAnimationFrame(() => {
        global.requestAnimationFrame(() => {
          if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(loader, { timeout: 1800 });
            return;
          }
          global.setTimeout(loader, 180);
        });
      });
    };

    if (document.readyState === 'complete') {
      afterPaint();
      return;
    }

    global.addEventListener('load', afterPaint, { once: true });
  }

  global.AncestrioAmbientLoader = {
    load: loadBundle,
    schedule
  };

  schedule();
})(window);

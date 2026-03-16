(function (global) {
  const DEFAULT_THEME_KEY = 'tree-theme';
  const DEFAULT_DARK_CLASS = 'theme-dark';
  const DEFAULT_LIGHT_CLASS = 'theme-light';
  const themeInit = global.AncestrioThemeInit || null;

  function isNightTime() {
    if (themeInit && typeof themeInit.isNightTime === 'function') {
      return themeInit.isNightTime();
    }
    const hour = new Date().getHours();
    return hour >= 20 || hour < 7;
  }

  function resolveInitialTheme(savedTheme) {
    if (themeInit && typeof themeInit.resolveInitialTheme === 'function') {
      return themeInit.resolveInitialTheme(savedTheme);
    }
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return isNightTime() ? 'dark' : 'light';
  }

  function setThemeButtonState(themeBtn, isDark, options) {
    if (!themeBtn) return;

    const icon = themeBtn.querySelector('.material-symbols-outlined');
    const iconName = isDark ? options.iconWhenDark : options.iconWhenLight;

    if (icon) {
      if (global.AncestrioIcons && typeof global.AncestrioIcons.setIcon === 'function') {
        global.AncestrioIcons.setIcon(icon, iconName);
      } else {
        icon.textContent = iconName;
      }
    } else {
      themeBtn.textContent = iconName;
    }

    themeBtn.classList.toggle(options.darkButtonClass, isDark);
    themeBtn.classList.toggle(options.lightButtonClass, !isDark);

    const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.setAttribute('title', label);
    themeBtn.setAttribute('aria-pressed', String(isDark));
  }

  function applyThemeState(theme, options) {
    if (themeInit && typeof themeInit.applyTheme === 'function') {
      themeInit.applyTheme(theme, document, {
        darkClass: options.darkClass,
        lightClass: DEFAULT_LIGHT_CLASS,
        themeKey: options.themeKey
      });
      return;
    }

    const isDark = theme === 'dark';
    document.body.classList.toggle(options.darkClass, isDark);
    document.body.classList.toggle(DEFAULT_LIGHT_CLASS, !isDark);
  }

  function readActiveTheme(options) {
    if (themeInit && typeof themeInit.getCurrentTheme === 'function') {
      const activeTheme = themeInit.getCurrentTheme(document, {
        darkClass: options.darkClass,
        lightClass: DEFAULT_LIGHT_CLASS
      });
      if (activeTheme === 'dark' || activeTheme === 'light') {
        return activeTheme;
      }
    }
    return null;
  }

  function initThemeToggle(userOptions) {
    const options = {
      themeKey: DEFAULT_THEME_KEY,
      darkClass: DEFAULT_DARK_CLASS,
      button: document.getElementById('themeBtn'),
      iconWhenDark: 'light_mode',
      iconWhenLight: 'dark_mode',
      darkButtonClass: 'sun-icon',
      lightButtonClass: 'moon-icon',
      autoRefreshMs: 0,
      persistInitialTheme: false,
      ...userOptions
    };

    const themeBtn = options.button;
    let savedTheme = null;
    try { savedTheme = localStorage.getItem(options.themeKey); } catch (_) { /* storage unavailable */ }
    const initialTheme = readActiveTheme(options) || resolveInitialTheme(savedTheme);
    applyThemeState(initialTheme, options);
    if (!savedTheme && options.persistInitialTheme) {
      try { localStorage.setItem(options.themeKey, initialTheme); } catch (_) { /* storage unavailable */ }
    }
    setThemeButtonState(themeBtn, initialTheme === 'dark', options);

    let autoThemeTimer = null;
    if (!savedTheme && options.autoRefreshMs > 0) {
      autoThemeTimer = window.setInterval(() => {
        if ((function() { try { return localStorage.getItem(options.themeKey); } catch (_) { return null; } })()) {
          window.clearInterval(autoThemeTimer);
          autoThemeTimer = null;
          return;
        }

        const desiredTheme = resolveInitialTheme(null);
        const isDark = document.body.classList.contains(options.darkClass);
        const shouldBeDark = desiredTheme === 'dark';
        if (isDark !== shouldBeDark) {
          applyThemeState(desiredTheme, options);
          setThemeButtonState(themeBtn, shouldBeDark, options);
        }
      }, options.autoRefreshMs);
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const nextTheme = document.body.classList.contains(options.darkClass) ? 'light' : 'dark';
        const nextIsDark = nextTheme === 'dark';
        applyThemeState(nextTheme, options);
        try { localStorage.setItem(options.themeKey, nextTheme); } catch (_) { /* storage unavailable */ }
        if (autoThemeTimer) {
          window.clearInterval(autoThemeTimer);
          autoThemeTimer = null;
        }
        setThemeButtonState(themeBtn, nextIsDark, options);
      });
    }

    return {
      isDark: () => document.body.classList.contains(options.darkClass),
      stopAutoRefresh: () => {
        if (!autoThemeTimer) return;
        window.clearInterval(autoThemeTimer);
        autoThemeTimer = null;
      }
    };
  }

  global.AncestrioTheme = {
    initThemeToggle,
    resolveInitialTheme,
    isNightTime
  };
})(window);

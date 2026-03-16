(function (global) {
  const THEME_KEY = 'tree-theme';
  const DARK_CLASS = 'theme-dark';
  const LIGHT_CLASS = 'theme-light';

  function isNightTime() {
    const hour = new Date().getHours();
    return hour >= 20 || hour < 7;
  }

  function resolveInitialTheme(savedTheme) {
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme;
    }
    if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return isNightTime() ? 'dark' : 'light';
  }

  function getThemeTargets(doc) {
    const targets = [];
    if (doc && doc.documentElement) {
      targets.push(doc.documentElement);
    }
    if (doc && doc.body) {
      targets.push(doc.body);
    }
    return targets;
  }

  function applyTheme(theme, doc, options) {
    const targetDoc = doc || global.document;
    const config = options || {};
    const darkClass = config.darkClass || DARK_CLASS;
    const lightClass = config.lightClass || LIGHT_CLASS;
    const isDark = theme === 'dark';

    getThemeTargets(targetDoc).forEach((target) => {
      target.classList.toggle(darkClass, isDark);
      target.classList.toggle(lightClass, !isDark);
    });

    return theme;
  }

  function getCurrentTheme(doc, options) {
    const targetDoc = doc || global.document;
    const config = options || {};
    const darkClass = config.darkClass || DARK_CLASS;
    const lightClass = config.lightClass || LIGHT_CLASS;
    const target = targetDoc && (targetDoc.body || targetDoc.documentElement);

    if (!target) return null;
    if (target.classList.contains(darkClass)) return 'dark';
    if (target.classList.contains(lightClass)) return 'light';
    return null;
  }

  function initEarlyTheme(options) {
    const config = options || {};
    let savedTheme = null;

    try {
      savedTheme = global.localStorage.getItem(config.themeKey || THEME_KEY);
    } catch (_) {
      savedTheme = null;
    }

    const theme = resolveInitialTheme(savedTheme);
    applyTheme(theme, global.document, config);
    return theme;
  }

  global.AncestrioThemeInit = {
    applyTheme,
    getCurrentTheme,
    initEarlyTheme,
    isNightTime,
    key: THEME_KEY,
    resolveInitialTheme
  };

  initEarlyTheme();
})(window);

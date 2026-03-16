(function () {
  const MOBILE_BREAKPOINT = 1120;
  const HEADER_AUTH_CACHE_KEY = 'ancestrio:header-auth-state:v1';
  const AUTH_PAGE_PATTERN = /(?:^|\/)auth\.html(?:[?#]|$)/i;
  const DASHBOARD_PAGE_PATTERN = /(?:^|\/)dashboard\.html(?:[?#]|$)/i;

  function debounce(fn, ms) {
    let id;
    return function (...args) {
      clearTimeout(id);
      id = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function readCachedAuthState() {
    try {
      const raw = localStorage.getItem(HEADER_AUTH_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      return {
        authenticated: Boolean(parsed.authenticated),
        isAnonymous: Boolean(parsed.isAnonymous),
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
        email: typeof parsed.email === 'string' ? parsed.email : '',
        updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0
      };
    } catch (_) {
      return null;
    }
  }

  function writeCachedAuthState(user) {
    try {
      const payload = user && !user.isAnonymous ? {
        authenticated: true,
        isAnonymous: false,
        displayName: typeof user.displayName === 'string' ? user.displayName : '',
        email: typeof user.email === 'string' ? user.email : '',
        updatedAt: Date.now()
      } : {
        authenticated: false,
        isAnonymous: Boolean(user && user.isAnonymous),
        displayName: '',
        email: '',
        updatedAt: Date.now()
      };
      try { localStorage.setItem(HEADER_AUTH_CACHE_KEY, JSON.stringify(payload)); } catch (_) { /* storage unavailable */ }
      return payload;
    } catch (_) {
      return {
        authenticated: Boolean(user && !user.isAnonymous),
        isAnonymous: Boolean(user && user.isAnonymous),
        displayName: typeof user?.displayName === 'string' ? user.displayName : '',
        email: typeof user?.email === 'string' ? user.email : ''
      };
    }
  }

  if (typeof window !== 'undefined') {
    window.AncestrioHeaderAuthCache = {
      key: HEADER_AUTH_CACHE_KEY,
      read: readCachedAuthState,
      setFromUser: writeCachedAuthState
    };
  }

  function resolveHeaderLinks(header) {
    const actions = header.querySelector('.site-header__actions');
    if (!actions) return {};

    const actionLinks = Array.from(actions.querySelectorAll('a[href]'));
    const signInLink = actionLinks.find((link) => AUTH_PAGE_PATTERN.test(link.getAttribute('href') || ''));
    const dashboardLink = actionLinks.find((link) => DASHBOARD_PAGE_PATTERN.test(link.getAttribute('href') || ''));

    return { actions, signInLink, dashboardLink };
  }

  function setHeaderLinkVisibility(link, visible) {
    if (!link) return;
    link.hidden = !visible;
    link.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (visible) {
      link.removeAttribute('tabindex');
    } else {
      link.setAttribute('tabindex', '-1');
    }
  }

  function applyAuthStateToHeader(header, authState) {
    if (!header) return;

    const { signInLink, dashboardLink } = resolveHeaderLinks(header);
    const isAuthenticated = Boolean(authState && authState.authenticated && !authState.isAnonymous);

    header.classList.toggle('site-header--authenticated', isAuthenticated);
    setHeaderLinkVisibility(signInLink, !isAuthenticated);
    setHeaderLinkVisibility(dashboardLink, isAuthenticated);

    if (dashboardLink) {
      const identity = authState?.displayName || authState?.email || '';
      if (isAuthenticated && identity) {
        dashboardLink.setAttribute('title', `Dashboard for ${identity}`);
        dashboardLink.setAttribute('aria-label', `Dashboard for ${identity}`);
      } else {
        dashboardLink.removeAttribute('title');
        dashboardLink.setAttribute('aria-label', 'Dashboard');
      }
    }
  }

  function bindHeaderAuthState(header) {
    if (!header) return;

    const guestModeEnabled = (() => {
      try {
        return localStorage.getItem('guestMode') === 'true';
      } catch (_) {
        return false;
      }
    })();

    if (guestModeEnabled) {
      applyAuthStateToHeader(header, { authenticated: false, isAnonymous: true });
      return;
    }

    applyAuthStateToHeader(
      header,
      readCachedAuthState() || { authenticated: false, isAnonymous: false }
    );

    let unsubscribe = null;
    let subscribed = false;

    function subscribeWithAuth(authInstance) {
      if (!authInstance || typeof authInstance.onAuthStateChanged !== 'function' || subscribed) return;
      subscribed = true;
      unsubscribe = authInstance.onAuthStateChanged((user) => {
        const nextState = writeCachedAuthState(user || null);
        applyAuthStateToHeader(header, nextState);
      });
    }

    if (window.auth) {
      subscribeWithAuth(window.auth);
    } else if (window.firebase?.auth && typeof window.firebase.auth === 'function') {
      try {
        subscribeWithAuth(window.firebase.auth());
      } catch (_) {
        // Ignore Firebase access failures and wait for readiness event.
      }
    }

    const handleFirebaseReady = (event) => {
      subscribeWithAuth(event?.detail?.auth || window.auth);
    };
    const handleStorage = (event) => {
      if (event.key !== HEADER_AUTH_CACHE_KEY) return;
      applyAuthStateToHeader(
        header,
        readCachedAuthState() || { authenticated: false, isAnonymous: false }
      );
    };

    document.addEventListener('ancestrio:firebase-ready', handleFirebaseReady);
    window.addEventListener('storage', handleStorage);

    window.addEventListener('beforeunload', () => {
      document.removeEventListener('ancestrio:firebase-ready', handleFirebaseReady);
      window.removeEventListener('storage', handleStorage);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    }, { once: true });
  }

  function initSiteHeader(header) {
    if (!header) return;

    const menuBtn = header.querySelector('.site-menu-btn');
    const nav = header.querySelector('.site-header__nav');

    function isMobileNavMode() {
      return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function syncMobileNavState() {
      if (!nav) return;
      const isOpen = header.classList.contains('menu-open');
      const isMobile = isMobileNavMode();
      nav.setAttribute('aria-hidden', isMobile && !isOpen ? 'true' : 'false');
      nav.querySelectorAll('a').forEach((link) => {
        if (isMobile && !isOpen) {
          link.setAttribute('tabindex', '-1');
        } else {
          link.removeAttribute('tabindex');
        }
      });
    }

    function setMenuOpen(isOpen, options = {}) {
      const shouldOpen = Boolean(isOpen) && isMobileNavMode();
      header.classList.toggle('menu-open', shouldOpen);
      if (menuBtn) {
        menuBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        const icon = menuBtn.querySelector('.material-symbols-outlined');
        if (icon) {
          if (window.AncestrioIcons && typeof window.AncestrioIcons.setIcon === 'function') {
            window.AncestrioIcons.setIcon(icon, shouldOpen ? 'close' : 'menu');
          } else {
            icon.textContent = shouldOpen ? 'close' : 'menu';
          }
        }
      }
      syncMobileNavState();

      if (shouldOpen && options.focusFirstItem) {
        requestAnimationFrame(() => {
          nav?.querySelector('a')?.focus();
        });
      }

      if (!shouldOpen && options.restoreFocus && menuBtn) {
        requestAnimationFrame(() => {
          menuBtn.focus();
        });
      }
    }

    menuBtn?.addEventListener('click', (event) => {
      const isOpening = !header.classList.contains('menu-open');
      setMenuOpen(isOpening, { focusFirstItem: isOpening && event.detail === 0 });
    });

    nav?.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenuOpen(false));
    });

    window.addEventListener('resize', debounce(() => {
      if (!isMobileNavMode()) {
        setMenuOpen(false);
      } else {
        syncMobileNavState();
      }
    }, 150));

    document.addEventListener('click', (event) => {
      if (!isMobileNavMode() || !header.classList.contains('menu-open')) return;
      if (header.contains(event.target)) return;
      setMenuOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && header.classList.contains('menu-open')) {
        event.preventDefault();
        setMenuOpen(false, { restoreFocus: true });
      }
    });

    // Move theme button out of the header on mobile so it escapes the
    // backdrop-filter containing block and can be fixed to the viewport.
    // Move the dashboard link next to the burger for reachability.
    const themeBtn = header.querySelector('#themeBtn');
    const themeBtnParent = themeBtn?.parentElement;
    const themeBtnNextSibling = themeBtn?.nextSibling;

    const { dashboardLink } = resolveHeaderLinks(header);
    const dashLinkParent = dashboardLink?.parentElement;
    const dashLinkNextSibling = dashboardLink?.nextSibling;
    const headerInner = header.querySelector('.site-header__inner');

    function syncMobileLayout() {
      if (!headerInner) return;
      if (isMobileNavMode()) {
        if (themeBtn && themeBtn.parentElement !== document.body) {
          document.body.appendChild(themeBtn);
        }
        if (dashboardLink && menuBtn && dashboardLink.parentElement !== headerInner) {
          headerInner.insertBefore(dashboardLink, menuBtn);
        }
      } else {
        if (themeBtn && themeBtn.parentElement === document.body && themeBtnParent) {
          themeBtnParent.insertBefore(themeBtn, themeBtnNextSibling);
        }
        if (dashboardLink && dashboardLink.parentElement === headerInner && dashLinkParent) {
          dashLinkParent.insertBefore(dashboardLink, dashLinkNextSibling);
        }
      }
    }

    syncMobileLayout();

    window.addEventListener('resize', debounce(() => {
      syncMobileLayout();
    }, 150));

    syncMobileNavState();
  }

  function setFooterYears() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('[data-site-footer-year]').forEach((node) => {
      node.textContent = year;
    });
  }

  function init() {
    document.querySelectorAll('.site-header').forEach((header) => {
      initSiteHeader(header);
      bindHeaderAuthState(header);
    });
    setFooterYears();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

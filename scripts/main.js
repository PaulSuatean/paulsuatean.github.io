/*
  Family Tree renderer

  Data format (family.json):
  {
    "name": "Root Person",
    "spouse": "Spouse Name", // optional
    "meta": "(years, note)",  // optional small text
    "children": [ { ... same shape ... } ]
  }

  The code treats each node as a couple with optional spouse and children.
*/

(function () {
  // Verify D3 is loaded
  if (typeof d3 === 'undefined') {
    console.error('D3 library not loaded!');
    document.body.innerHTML += '<div style="color:red; padding: 20px; font-size: 18px;">Error: D3 library failed to load. Please check your internet connection.</div>';
    return;
  }

  const svg = d3.select('#tree');
  
  // Verify SVG element exists
  if (svg.empty()) {
    console.error('SVG element #tree not found in DOM');
    document.body.innerHTML += '<div style="color:red; padding: 20px; font-size: 18px;">Error: SVG element not found in page.</div>';
    return;
  }

  console.log('Initializing family tree renderer...');
  const g = svg.append('g').attr('class', 'viewport');
  const defs = svg.append('defs');
  const personGradient = defs.append('linearGradient')
    .attr('id', 'personGradient')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  personGradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', 'var(--accent-2)')
    .attr('stop-opacity', 0.22);
  personGradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', 'var(--accent)')
    .attr('stop-opacity', 0.22);
  // Transparent hit-surface so every touch/pointer reaches the zoom handler
  const hitRect = svg.insert('rect', ':first-child')
    .attr('class', 'zoom-hit-surface')
    .attr('fill', 'transparent')
    .attr('pointer-events', 'all');
  function resizeHitSurface() {
    const { width, height } = svg.node().getBoundingClientRect();
    hitRect.attr('width', width).attr('height', height);
  }
  resizeHitSurface();
  window.addEventListener('resize', resizeHitSurface);
  // Modal refs
  const modalEl = document.getElementById('photoModal');
  const modalImg = document.getElementById('modalImg');
  const modalName = document.getElementById('modalTitle');
  const modalDob = document.getElementById('modalDob');
  const modalExtendedInfo = document.getElementById('modalExtendedInfo');
  const modalClose = document.getElementById('modalClose');
  const helpModal = document.getElementById('helpModal');
  const helpClose = document.getElementById('helpClose');
  const birthdayMonthsEl = document.getElementById('birthdayMonths');
  const calendarSection = document.getElementById('birthdaySection');
  const topbar = document.querySelector('.topbar');
  const monthPrevBtn = document.getElementById('monthPrev');
  const monthNextBtn = document.getElementById('monthNext');
  const carouselControls = document.querySelector('.carousel-controls');
  const calendarSidePrev = document.getElementById('calendarSidePrev');
  const calendarSideNext = document.getElementById('calendarSideNext');
  const calendarSideNav = document.querySelector('.calendar-side-nav');
  const pageEl = document.querySelector('.page');
  const globeView = document.getElementById('globeView');
  const globeLegendEl = document.querySelector('.globe-legend');
  const globeSvgEl = document.getElementById('globeSvg');
  const globeTooltip = document.getElementById('globeTooltip');
  const viewToggleButtons = document.querySelectorAll('.view-toggle-btn');
  const viewToggleInputs = document.querySelectorAll('.tw-toggle input[name="view-toggle"]');
  const viewToggle = document.querySelector('.view-toggle') || document.querySelector('.tw-toggle');
  let calendarOpen = false;
  const birthdayTooltip = document.getElementById('birthdayTooltip');
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const searchBtn = document.getElementById('searchBtn');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const helpBtn = document.getElementById('helpBtn');
  const statsKidsEl = document.getElementById('statsKids');
  const statsGrandkidsEl = document.getElementById('statsGrandkids');
  const statsGreatGrandkidsEl = document.getElementById('statsGreatGrandkids');
  const upcomingBtn = document.getElementById('upcomingBtn');
  const upcomingContainer = document.getElementById('upcomingContainer');
  const upcomingName = document.getElementById('upcomingName');
  const upcomingPrev = document.getElementById('upcomingPrev');
  const upcomingNext = document.getElementById('upcomingNext');
  const personLookup = new Map();
  const personHierarchy = new Map(); // Store hierarchical info
  let activeTooltipCell = null;
  let familyTreeData = null; // Store the full data
  let mobileMonthIndex = 0;
  const mobileQuery = window.matchMedia('(max-width: 640px)');
  let mobileShowAll = false;
  let touchStartX = null;
  let applyMobileState = null;
  let upcomingBirthdaysList = [];
  let upcomingCurrentIndex = 0;
  let externalUpcomingController = null;
  let externalEmptyStateController = null;

  const person = {
    width: 170,
    height: 120,
    hGap: 48, // gap between spouses (tripled)
  };
  const TREE_ZOOM_MIN = 0.05;
  const TREE_ZOOM_MAX = 8;
  const TREE_INITIAL_SCALE_CAP_DESKTOP = 0.86;
  const TREE_INITIAL_SCALE_CAP_MOBILE = 0.92;
  const level = {
    vGap: 180, // vertical distance between generations (increased)
    hGap: 28,  // additional horizontal spacing
  };
  const baseCoupleWidth = person.width * 2 + person.hGap;
  const avatar = { r: 36, top: 10 };
  // i18n support - default to Romanian, can be extended
  const i18n = {
    ro: {
      months: [
        { short: 'Ian', long: 'Ianuarie' },
        { short: 'Feb', long: 'Februarie' },
        { short: 'Mar', long: 'Martie' },
        { short: 'Apr', long: 'Aprilie' },
        { short: 'Mai', long: 'Mai' },
        { short: 'Iun', long: 'Iunie' },
        { short: 'Iul', long: 'Iulie' },
        { short: 'Aug', long: 'August' },
        { short: 'Sep', long: 'Septembrie' },
        { short: 'Oct', long: 'Octombrie' },
        { short: 'Noi', long: 'Noiembrie' },
        { short: 'Dec', long: 'Decembrie' }
      ],
      birthday: 'zi de naștere',
      birthdays: 'zile de naștere',
      today: 'Astăzi',
      tomorrow: 'Mâine',
      inDays: 'În {n} zile',
      openCalendar: 'Deschide calendarul',
      closeCalendar: 'Închide calendarul',
      noBirthdays: 'Nicio aniversare',
      hideNotification: 'Ascunde notificarea'
    },
    en: {
      months: [
        { short: 'Jan', long: 'January' },
        { short: 'Feb', long: 'February' },
        { short: 'Mar', long: 'March' },
        { short: 'Apr', long: 'April' },
        { short: 'May', long: 'May' },
        { short: 'Jun', long: 'June' },
        { short: 'Jul', long: 'July' },
        { short: 'Aug', long: 'August' },
        { short: 'Sep', long: 'September' },
        { short: 'Oct', long: 'October' },
        { short: 'Nov', long: 'November' },
        { short: 'Dec', long: 'December' }
      ],
      birthday: 'Birthday',
      birthdays: 'birthdays',
      today: 'Today',
      tomorrow: 'Tomorrow',
      inDays: 'In {n} days',
      openCalendar: 'Open Calendar',
      closeCalendar: 'Close Calendar',
      noBirthdays: 'No birthdays',
      hideNotification: 'Hide notification'
    }
  };

  // Use Romanian by default (can be made dynamic with language selector)
  const currentLang = localStorage.getItem('tree-lang') || 'ro';
  const t = i18n[currentLang] || i18n.ro;
  const monthsMeta = t.months;

  const dnaHighlightNames = new Set(['ioan suatean', 'ana suatean']);
  const dnaSuppressNames = new Set(['f ioan suatean', 'ioan pintilie']);
  const calendarExcludeNames = new Set([
    'F Ioan Suătean',
    'M Ioan Suătean',
    'Ana Pintilie',
    'Ioan Pintilie'
  ].map((name) => name.toLowerCase()));

  const globeCountryAliases = {
    anglia: 'United Kingdom',
    austria: 'Austria',
    'bosnia&herzegovina': 'Bosnia and Herz.',
    'bosnia and herzegovina': 'Bosnia and Herz.',
    cehia: 'Czechia',
    croatia: 'Croatia',
    danemarca: 'Denmark',
    egipt: 'Egypt',
    franta: 'France',
    germania: 'Germany',
    grecia: 'Greece',
    italia: 'Italy',
    olanda: 'Netherlands',
    portugal: 'Portugal',
    rusia: 'Russia',
    'rusia/urss': 'Russia',
    spania: 'Spain',
    suedia: 'Sweden',
    sweeden: 'Sweden',
    uk: 'United Kingdom',
    ungaria: 'Hungary',
    usa: 'United States of America'
  };
  const globeMovedCountries = new Set(['Romania', 'United Kingdom', 'Hungary', 'Spain']);
  const globePeopleVisits = {
    Andreea: ['Egypt', 'Ungaria', 'Italia', 'Bosnia&Herzegovina', 'Portugal', 'Germany', 'USA', 'France'],
    Florin: ['Spania', 'Austria'],
    Ovidiu: ['Italia', 'Spania', 'France', 'Germania', 'Croatia', 'Austria', 'Grecia'],
    Miha: ['Grecia'],
    Ioana: ['Grecia'],
    Sergiu: ['Ungaria', 'Spania'],
    Razvan: ['Anglia', 'Spania', 'Ungaria'],
    Bogdan: ['Austria', 'India', 'Ungaria', 'Croatia', 'Germania'],
    Adi: ['Spania', 'Anglia'],
    Paul: ['Suedia', 'Danemarca', 'Olanda', 'Germania', 'Austria', 'Cehia', 'Ungaria', 'Grecia', 'Italia'],
    'Ioan Suatean': ['Rusia/URSS'],
    Emil: ['Ungaria', 'Italia', 'Grecia'],
    Emilia: ['Anglia', 'Spania'],
    Liviu: ['Ungaria'],
    Victoria: ['Austria', 'Ungaria', 'Grecia']
  };
  const globeVisits = buildGlobeVisits(globePeopleVisits);
  function buildGlobeVisits(peopleMap) {
    const visits = {
      Romania: { people: ['Familia Suatean'], tone: 'home' }
    };
    Object.entries(peopleMap).forEach(([person, countries]) => {
      if (!Array.isArray(countries)) return;
      countries.forEach((country) => {
        const normalized = normalizeCountryName(country);
        if (!normalized) return;
        const isHome = normalized === 'Romania';
        const isMoved = globeMovedCountries.has(normalized);
        const entry = visits[normalized] || { people: [], tone: isHome ? 'home' : (isMoved ? 'moved' : 'visited') };
        if (!entry.people.includes(person)) {
          entry.people.push(person);
        }
        if (isHome) {
          entry.tone = 'home';
        } else if (isMoved && entry.tone !== 'home') {
          entry.tone = 'moved';
        }
        visits[normalized] = entry;
      });
    });
    return visits;
  }
  const GLOBE_DATA_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

  const placeholderDataUrl = 'data:image/svg+xml;utf8,' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" fill="%23d7dbe2"/>' +
    '<circle cx="32" cy="24" r="12" fill="%239aa3b2"/>' +
    '<rect x="16" y="38" width="32" height="16" rx="8" fill="%239aa3b2"/>' +
    '</svg>';

  // Zoom/Pan
  let zoomEndTimer = null;
  function setZooming(active) {
    if (!document.body) return;
    if (active) {
      if (zoomEndTimer) {
        clearTimeout(zoomEndTimer);
        zoomEndTimer = null;
      }
      document.body.classList.add('is-zooming');
      return;
    }
    if (zoomEndTimer) clearTimeout(zoomEndTimer);
    zoomEndTimer = setTimeout(() => {
      document.body.classList.remove('is-zooming');
      zoomEndTimer = null;
    }, 140);
  }
  const zoom = d3.zoom()
    .scaleExtent([TREE_ZOOM_MIN, TREE_ZOOM_MAX]) // Limit zoom bounds to prevent infinite zoom
    .wheelDelta((event) => {
      const base = event.deltaMode === 1 ? 0.02 : 0.002; // lines vs pixels
      return -event.deltaY * base;
    })
    .on('start', () => setZooming(true))
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    })
    .on('end', () => setZooming(false));
  svg.call(zoom);

  // Controls
  let dnaOn = false;
  let dnaGroup = null; // overlay for DNA lines
  function updateDNAVisibility() {
    if (dnaGroup) {
      // Use opacity instead of display for smoother transitions
      dnaGroup.style('opacity', dnaOn ? 1 : 0);
      dnaGroup.attr('pointer-events', dnaOn ? 'auto' : 'none');
    }
    d3.select('#tree').classed('dna-active', dnaOn);
  }
  const dnaBtn = document.getElementById('dnaBtn');
  if (dnaBtn) {
    updateDNAButtonText();
    dnaBtn.addEventListener('click', () => {
      dnaOn = !dnaOn;
      updateDNAVisibility();
      updateDNAButtonText();
    });
  }
  function updateDNAButtonText() {
    if (!dnaBtn) return;
    const text = 'Genealogie';
    dnaBtn.textContent = text;
    dnaBtn.setAttribute('aria-pressed', dnaOn ? 'true' : 'false');
    dnaBtn.setAttribute('title', 'Genealogie');
  }
  const themeBtn = document.getElementById('themeBtn');
  window.AncestrioTheme?.initThemeToggle({
    button: themeBtn,
    iconWhenDark: 'dark_mode',
    iconWhenLight: 'light_mode',
    darkButtonClass: 'moon-icon',
    lightButtonClass: 'sun-icon',
    autoRefreshMs: 30 * 60 * 1000
  });
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const resetBtn = document.getElementById('resetBtn');
  function isGlobeActive() {
    return document.body.classList.contains('view-globe');
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      if (isGlobeActive()) {
        adjustGlobeZoom(GLOBE_ZOOM_STEP);
      } else {
        smoothZoom(1.2);
      }
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      if (isGlobeActive()) {
        adjustGlobeZoom(-GLOBE_ZOOM_STEP);
      } else {
        smoothZoom(1 / 1.1);
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (isGlobeActive()) {
        setGlobeZoom(GLOBE_ZOOM_DEFAULT);
      } else {
        fitTreeWhenVisible(getTreeDefaultPadding());
      }
    });
  }
  const focusBtn = document.getElementById('focusBtn');
  let focusModeActive = document.body.classList.contains('focus-mode');
  if (focusBtn) {
    focusBtn.setAttribute('aria-pressed', focusModeActive ? 'true' : 'false');
    updateFocusModeUI();
    focusBtn.addEventListener('click', () => {
      focusModeActive = !focusModeActive;
      document.body.classList.toggle('focus-mode', focusModeActive);
      focusBtn.setAttribute('aria-pressed', focusModeActive ? 'true' : 'false');
      updateFocusModeUI();
      requestAnimationFrame(updateViewToggleOffset);
      fitTreeWhenVisible(focusModeActive ? getTreeFocusPadding() : getTreeDefaultPadding());
      if (focusModeActive) setCalendarOpen(false);
    });
  }

  function updateFocusModeUI() {
    if (!focusBtn) return;
    const isActive = document.body.classList.contains('focus-mode');
    focusBtn.textContent = isActive ? 'Exit Focus' : 'Focus';
    const label = isActive ? 'Exit focus mode' : 'Enter focus mode';
    focusBtn.setAttribute('aria-label', label);
    focusBtn.setAttribute('title', label);
  }

  // Upcoming birthday navigation
  if (upcomingPrev) {
    upcomingPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (externalUpcomingController && typeof externalUpcomingController.previous === 'function') {
        externalUpcomingController.previous();
        return;
      }
      if (upcomingBirthdaysList.length > 0) {
        upcomingCurrentIndex = (upcomingCurrentIndex - 1 + upcomingBirthdaysList.length) % upcomingBirthdaysList.length;
        renderUpcomingBirthdayButton();
      }
    });
  }
  if (upcomingNext) {
    upcomingNext.addEventListener('click', (e) => {
      e.stopPropagation();
      if (externalUpcomingController && typeof externalUpcomingController.next === 'function') {
        externalUpcomingController.next();
        return;
      }
      if (upcomingBirthdaysList.length > 0) {
        upcomingCurrentIndex = (upcomingCurrentIndex + 1) % upcomingBirthdaysList.length;
        renderUpcomingBirthdayButton();
      }
    });
  }
  if (upcomingBtn) {
    upcomingBtn.addEventListener('click', () => {
      if (externalUpcomingController && typeof externalUpcomingController.openCurrent === 'function') {
        externalUpcomingController.openCurrent();
        return;
      }
      if (upcomingBirthdaysList.length > 0) {
        const birthday = upcomingBirthdaysList[upcomingCurrentIndex];
        const info = personLookup.get(birthday.name);
        if (info) {
          openModal({
            name: info.name,
            image: info.image || placeholderDataUrl,
            birthday: info.birthday,
            metadata: info.metadata
          });
        }
      }
    });
  }

  let currentView = localStorage.getItem('tree-view') || 'tree';
  let externalGlobeController = null;
  const UPCOMING_WINDOW_DAYS = 10;
  const BIRTHDAY_POPUP_WINDOW_DAYS = 7;
  const GLOBE_REMOTE_THRESHOLD = 0.6;
  const GLOBE_VERTICAL_OFFSET = 34;
  const GLOBE_ROTATION_DEFAULT = -15;
  const GLOBE_TILT_DEFAULT = -18;
  const GLOBE_TILT_MIN = -60;
  const GLOBE_TILT_MAX = 60;
  const GLOBE_TILT_SPEED = 0.22;
  const GLOBE_ROTATE_SPEED = 0.3;
  const GLOBE_ZOOM_MIN = 0.9;
  const GLOBE_ZOOM_MAX = 2.56;
  const GLOBE_ZOOM_STEP = 0.12;
  const GLOBE_ZOOM_DEFAULT = 0.92;

  if (
    typeof window !== 'undefined' &&
    window.AncestrioGlobeUI &&
    typeof window.AncestrioGlobeUI.createGlobeController === 'function'
  ) {
    externalGlobeController = window.AncestrioGlobeUI.createGlobeController({
      globeSvgEl,
      globeLegendEl,
      globeTooltip,
      globeVisits,
      normalizeCountryName,
      isActiveView: () => document.body.classList.contains('view-globe'),
      onUnavailable: () => {
        if (currentView === 'globe') {
          setView('tree');
        }
      },
      dataUrl: GLOBE_DATA_URL,
      remoteThreshold: GLOBE_REMOTE_THRESHOLD,
      verticalOffset: GLOBE_VERTICAL_OFFSET,
      rotationDefault: GLOBE_ROTATION_DEFAULT,
      tiltDefault: GLOBE_TILT_DEFAULT,
      tiltMin: GLOBE_TILT_MIN,
      tiltMax: GLOBE_TILT_MAX,
      tiltSpeed: GLOBE_TILT_SPEED,
      rotateSpeed: GLOBE_ROTATE_SPEED,
      zoomMin: GLOBE_ZOOM_MIN,
      zoomMax: GLOBE_ZOOM_MAX,
      zoomStep: GLOBE_ZOOM_STEP,
      zoomDefault: GLOBE_ZOOM_DEFAULT
    });
  }

  function resetGlobeView() {
    if (externalGlobeController && typeof externalGlobeController.resetView === 'function') {
      externalGlobeController.resetView();
    }
  }

  function initGlobe() {
    if (externalGlobeController && typeof externalGlobeController.init === 'function') {
      return externalGlobeController.init();
    }
    return false;
  }

  function ensureGlobeVisible(tries = 60) {
    if (externalGlobeController && typeof externalGlobeController.ensureVisible === 'function') {
      externalGlobeController.ensureVisible(tries);
    }
  }

  function resizeGlobe() {
    if (externalGlobeController && typeof externalGlobeController.resize === 'function') {
      externalGlobeController.resize();
    }
  }

  function setGlobeZoom(nextZoom) {
    if (externalGlobeController && typeof externalGlobeController.setZoom === 'function') {
      externalGlobeController.setZoom(nextZoom);
    }
  }

  function adjustGlobeZoom(delta) {
    if (externalGlobeController && typeof externalGlobeController.adjustZoom === 'function') {
      externalGlobeController.adjustZoom(delta);
    }
  }

  function applyViewBodyClasses(view) {
    document.body.classList.remove('view-globe', 'view-calendar', 'view-tree');
    document.body.classList.add(`view-${view}`);
  }

  function updateViewToggleUI() {
    // Handle new 3-way toggle
    if (viewToggleInputs && viewToggleInputs.length) {
      viewToggleInputs.forEach((input) => {
        input.checked = input.value === currentView;
      });
    }
    // Handle legacy toggle buttons
    if (!viewToggleButtons || !viewToggleButtons.length) return;
    viewToggleButtons.forEach((btn) => {
      const isActive = btn.dataset.view === currentView;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function setView(view) {
    const validViews = ['tree', 'calendar', 'globe'];
    const nextView = validViews.includes(view) ? view : 'tree';
    currentView = nextView;
    applyViewBodyClasses(nextView);
    requestAnimationFrame(updateViewToggleOffset);
    if (globeView) globeView.setAttribute('aria-hidden', nextView === 'globe' ? 'false' : 'true');
    if (pageEl) pageEl.setAttribute('aria-hidden', nextView === 'globe' || nextView === 'calendar' ? 'true' : 'false');
    const birthdaySection = document.getElementById('birthdaySection');
    if (birthdaySection) birthdaySection.setAttribute('aria-hidden', nextView === 'calendar' ? 'false' : 'true');
    updateViewToggleUI();
    localStorage.setItem('tree-view', nextView);
    
    if (nextView === 'globe') {
      if (focusModeActive) {
        focusModeActive = false;
        document.body.classList.remove('focus-mode');
        focusBtn && focusBtn.setAttribute('aria-pressed', 'false');
        updateFocusModeUI();
      }
      setCalendarOpen(false);
      resetGlobeView();
      if (!initGlobe()) {
        console.warn('Globe view unavailable, falling back to tree view.');
        setView('tree');
        return;
      }
      requestAnimationFrame(() => ensureGlobeVisible(60));
    } else if (nextView === 'calendar') {
      if (focusModeActive) {
        focusModeActive = false;
        document.body.classList.remove('focus-mode');
        focusBtn && focusBtn.setAttribute('aria-pressed', 'false');
        updateFocusModeUI();
      }
      setCalendarOpen(true);
    } else {
      setCalendarOpen(false);
      requestAnimationFrame(() => {
        resizeHitSurface();
        if (!window._initialFitComplete) {
          fitTreeWhenVisible(getTreeDefaultPadding(), 60);
        }
      });
    }
  }

  // Handle new 3-way toggle
  if (viewToggleInputs && viewToggleInputs.length) {
    viewToggleInputs.forEach((input) => {
      input.addEventListener('change', () => setView(input.value));
    });
  }
  // Handle legacy toggle buttons
  if (viewToggleButtons && viewToggleButtons.length) {
    viewToggleButtons.forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
  }
  setView(currentView);

  function getTreeDefaultPadding() {
    return mobileQuery && mobileQuery.matches ? 12 : 36;
  }
  function getTreeFocusPadding() {
    return mobileQuery && mobileQuery.matches ? 60 : 70;
  }
  function getTreeVerticalBias(height) {
    if (!mobileQuery || !mobileQuery.matches) return 0;
    const base = -Math.min(90, height * 0.18);
    return calendarOpen ? (base - 72) : base;
  }
  function fitTreeWhenVisible(padding, tries = 40) {
    const node = svg.node();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      if (tries <= 0) return;
      requestAnimationFrame(() => fitTreeWhenVisible(padding, tries - 1));
      return;
    }
    const bbox = g.node() ? g.node().getBBox() : null;
    if (!bbox || !isFinite(bbox.width) || !isFinite(bbox.height) || bbox.width < 2 || bbox.height < 2) {
      if (tries <= 0) return;
      requestAnimationFrame(() => fitTreeWhenVisible(padding, tries - 1));
      return;
    }
    resizeHitSurface();
    fitToScreen(padding);
    window._initialFitComplete = true;
  }
  function smoothZoom(factor) {
    svg.transition().duration(250).call(zoom.scaleBy, factor);
  }
  function fitToScreen(padding = 40) {
    const bbox = g.node().getBBox();
    if (!isFinite(bbox.x) || !isFinite(bbox.y) || !isFinite(bbox.width) || !isFinite(bbox.height)) return;
    const w = svg.node().clientWidth;
    const h = svg.node().clientHeight;
    const scale = Math.min(
      (w - padding * 2) / Math.max(bbox.width, 1),
      (h - padding * 2) / Math.max(bbox.height, 1)
    );
    const safeScale = Math.max(scale, 0.02);
    const initialCap = mobileQuery && mobileQuery.matches
      ? TREE_INITIAL_SCALE_CAP_MOBILE
      : TREE_INITIAL_SCALE_CAP_DESKTOP;
    const appliedScale = Math.min(safeScale, initialCap);
    const maxScale = Math.max(TREE_ZOOM_MAX, safeScale * 5);
    const tx = (w - bbox.width * appliedScale) / 2 - bbox.x * appliedScale;
    const ty = (h - bbox.height * appliedScale) / 2 - bbox.y * appliedScale + getTreeVerticalBias(h);
    zoom.scaleExtent([TREE_ZOOM_MIN, maxScale]);
    const t = d3.zoomIdentity.translate(tx, ty).scale(appliedScale);
    svg.transition().duration(450).call(zoom.transform, t);
  }

  // Modal helpers
  function openModal(info) {
    if (!modalEl) return;
    modalImg.src = info.image || '';
    modalName.textContent = info.name || '';

    // Birthday
    if (info.birthday && String(info.birthday).trim() !== '') {
      modalDob.textContent = `Birthday: ${info.birthday}`;
      modalDob.style.display = '';
    } else {
      modalDob.textContent = '';
      modalDob.style.display = 'none';
    }

    // Clear extended info - not needed
    if (modalExtendedInfo) {
      modalExtendedInfo.innerHTML = '';
    }

    modalEl.classList.add('open');
    modalEl.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('open');
    modalEl.setAttribute('aria-hidden', 'true');
    modalImg.src = '';
  }
  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });
  }
  if (modalClose) modalClose.addEventListener('click', closeModal);

  // Help Modal
  function openHelpModal() {
    if (!helpModal) return;
    helpModal.classList.add('open');
    helpModal.setAttribute('aria-hidden', 'false');
  }
  function closeHelpModal() {
    if (!helpModal) return;
    helpModal.classList.remove('open');
    helpModal.setAttribute('aria-hidden', 'true');
  }
  if (helpModal) {
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) closeHelpModal();
    });
  }
  if (helpClose) helpClose.addEventListener('click', closeHelpModal);
  if (helpBtn) helpBtn.addEventListener('click', openHelpModal);

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        e.target.blur();
        toggleSearch(false);
      }
      return;
    }

    switch(e.key) {
      case 'Escape':
        if (focusModeActive) {
          focusBtn.click();
        } else if (modalEl && modalEl.classList.contains('open')) {
          closeModal();
        } else if (helpModal && helpModal.classList.contains('open')) {
          closeHelpModal();
        } else if (searchBar && searchBar.classList.contains('show')) {
          toggleSearch(false);
        }
        break;
      case 'f':
      case 'F':
        if (focusBtn) focusBtn.click();
        break;
      case 'l':
      case 'L':
        if (dnaBtn) dnaBtn.click();
        break;
      case 't':
      case 'T':
        if (themeBtn) themeBtn.click();
        break;
      case 's':
      case 'S':
      case '/':
        e.preventDefault();
        toggleSearch(true);
        break;
      case 'c':
      case 'C':
        setView('calendar');
        break;
      case '?':
        e.preventDefault();
        openHelpModal();
        break;
      case 'r':
      case 'R':
        if (document.getElementById('resetBtn')) document.getElementById('resetBtn').click();
        break;
      case '+':
      case '=':
        if (document.getElementById('zoomInBtn')) document.getElementById('zoomInBtn').click();
        break;
      case '-':
      case '_':
        if (document.getElementById('zoomOutBtn')) document.getElementById('zoomOutBtn').click();
        break;
    }
  });

  // Search functionality
  const externalSearchController =
    (typeof window !== 'undefined' &&
      window.AncestrioSearchUI &&
      typeof window.AncestrioSearchUI.createSearchController === 'function')
      ? window.AncestrioSearchUI.createSearchController({
          searchBar,
          searchInput,
          searchResults,
          personLookup,
          escapeHtml,
          openModal,
          placeholderDataUrl,
          mobileMediaQuery: '(max-width: 768px)',
          topbarSelector: '.topbar',
          noResultsText: 'No results found',
          birthdayLabel: 'Birthday'
        })
      : null;

  function toggleSearch(show) {
    if (externalSearchController && typeof externalSearchController.toggleSearch === 'function') {
      externalSearchController.toggleSearch(show);
      return;
    }
    if (!searchBar) return;
    if (show) {
      positionSearchBar();
      searchBar.classList.add('show');
      if (searchInput) searchInput.focus();
    } else {
      searchBar.classList.remove('show');
      searchBar.classList.remove('mobile-positioned');
      searchBar.style.removeProperty('--searchbar-top');
      if (searchInput) searchInput.value = '';
      if (searchResults) searchResults.innerHTML = '';
    }
  }

  function positionSearchBar() {
    if (externalSearchController && typeof externalSearchController.positionSearchBar === 'function') {
      externalSearchController.positionSearchBar();
      return;
    }
    if (!searchBar) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) {
      searchBar.classList.remove('mobile-positioned');
      searchBar.style.removeProperty('--searchbar-top');
      return;
    }
    const topbar = document.querySelector('.topbar');
    const top = topbar ? topbar.getBoundingClientRect().bottom + 8 : 140;
    searchBar.style.setProperty('--searchbar-top', `${Math.round(top)}px`);
    searchBar.classList.add('mobile-positioned');
  }

  function performSearch(query) {
    if (externalSearchController && typeof externalSearchController.performSearch === 'function') {
      externalSearchController.performSearch(query);
      return;
    }
    if (!query || !searchResults) return;
    const q = query.toLowerCase().trim();
    const results = [];
    personLookup.forEach((person) => {
      if (person.name.toLowerCase().includes(q)) {
        results.push(person);
      }
    });
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item">No results found</div>';
    } else {
      searchResults.innerHTML = results.map(p => `
        <div class="search-result-item" data-name="${escapeHtml(p.name)}">
          <div class="name">${escapeHtml(p.name)}</div>
          ${p.birthday ? `<div class="birthday">Birthday: ${escapeHtml(p.birthday)}</div>` : ''}
        </div>
      `).join('');
      searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.dataset.name;
          const person = personLookup.get(name);
          if (person) {
            openModal({
              name: person.name,
              image: person.image || placeholderDataUrl,
              birthday: person.birthday,
              metadata: person.metadata
            });
            toggleSearch(false);
          }
        });
      });
    }
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const isOpen = searchBar && searchBar.classList.contains('show');
      toggleSearch(!isOpen);
    });
  }
  if (searchClearBtn) searchClearBtn.addEventListener('click', () => toggleSearch(false));
  if (searchInput) {
    searchInput.addEventListener('input', (e) => performSearch(e.target.value));
  }
  window.addEventListener('resize', () => {
    if (searchBar && searchBar.classList.contains('show')) {
      positionSearchBar();
    }
    updateExpandedMonthPlacement();
    if (currentView === 'globe') {
      resizeGlobe();
    }
    requestAnimationFrame(updateViewToggleOffset);
  });
  window.addEventListener('load', () => {
    if (currentView === 'globe') {
      initGlobe();
      requestAnimationFrame(() => ensureGlobeVisible(60));
    }
  });

  // Load data from Firebase (if available) or rfamily.json.
  // Prefer extracted module to keep main.js focused on rendering/UI.
  const externalTreeDataLoader =
    (typeof window !== 'undefined' &&
      window.AncestrioDataLoader &&
      typeof window.AncestrioDataLoader.loadTreeData === 'function')
      ? window.AncestrioDataLoader.loadTreeData
      : null;

  const loadTreeData = externalTreeDataLoader || (async function loadTreeDataFallback() {
    if (typeof window !== 'undefined' && window.FIREBASE_TREE_READY) {
      console.log('Waiting for Firebase tree data to load...');
      try {
        await window.FIREBASE_TREE_READY;
        console.log('Firebase tree data ready');
      } catch (err) {
        console.warn('Firebase tree data loading failed:', err);
      }
    }

    if (typeof window !== 'undefined' && window.FIREBASE_TREE_DATA) {
      console.log('Loading data from Firebase:', window.FIREBASE_TREE_DATA);
      return Promise.resolve(window.FIREBASE_TREE_DATA);
    }

    const paths = ['../data/rfamily.json', '/data/rfamily.json'];
    for (let i = 0; i < paths.length; i += 1) {
      const url = paths[i];
      console.log(`Trying to load from: ${url}`);
      try {
        const response = await fetch(url);
        console.log(`Response from ${url}: ${response.status} ${response.statusText}`);
        if (!response.ok) {
          throw new Error('HTTP ' + response.status + ' at ' + paths[i]);
        }
        const data = await response.json();
        console.log(`Successfully loaded data from: ${url}`);
        return data;
      } catch (err) {
        console.warn(`Failed to load from ${url}:`, err.message);
      }
    }

    throw new Error('No data file found at any path: ' + paths.join(', '));
  });
  
  loadTreeData()
    .then((data) => {
      console.log('Data loaded successfully:', data);
      if (!data) {
        throw new Error('Data is null or undefined');
      }
      familyTreeData = data;
      const normalized = normalizeData(data);
      console.log('Data normalized:', normalized);
      renderBirthdayStrip(normalized);
      renderUpcomingBanner(normalized);
      updateStats(normalized);
      setupCarouselControls();
      render(normalized);
      showEmptyStateIfNeeded(normalized);
      console.log('Rendering complete');
    })
    .catch((err) => {
      console.error('Failed to load data:', err);
      console.error('Stack:', err.stack);
      if (birthdayMonthsEl) {
        birthdayMonthsEl.textContent = 'Failed to load family data: ' + err.message;
      }
      g.append('text')
        .attr('x', 20)
        .attr('y', 30)
        .attr('fill', '#e66')
        .text('Error: ' + (err.message || 'Failed to load data'));
    });

  const externalDataTransform =
    (typeof window !== 'undefined' && window.AncestrioDataTransform)
      ? window.AncestrioDataTransform
      : {};

  const normalizeData = (typeof externalDataTransform.normalizeData === 'function')
    ? externalDataTransform.normalizeData
    : function normalizeDataFallback(input) {
      return input;
    };

  const thumbPath = (typeof externalDataTransform.thumbPath === 'function')
    ? externalDataTransform.thumbPath
    : function thumbPathFallback(image) {
      const s = safe(image).trim();
      if (!s || s.startsWith('data:')) return '';
      if (s.startsWith('images/thumbs/')) return s;
      if (s.startsWith('images/')) return `images/thumbs/${s.slice('images/'.length)}`;
      return s;
    };

  const externalCalendarUtils =
    (typeof window !== 'undefined' && window.AncestrioCalendarUtils)
      ? window.AncestrioCalendarUtils
      : {};

  function updateStats(data) {
    if (!statsKidsEl || !statsGrandkidsEl || !statsGreatGrandkidsEl) return;
    if (!data || !Array.isArray(data.children)) return;
    const kids = data.children.length;
    let grandkids = 0;
    let greatGrandkids = 0;
    data.children.forEach((child) => {
      const children = Array.isArray(child.children) ? child.children : [];
      grandkids += children.length;
      children.forEach((gchild) => {
        if (Array.isArray(gchild.children)) {
          greatGrandkids += gchild.children.length;
        }
      });
    });
    statsKidsEl.textContent = String(kids);
    statsGrandkidsEl.textContent = String(grandkids);
    statsGreatGrandkidsEl.textContent = String(greatGrandkids);
  }

  function createMonthDetails(detailsId, total, monthBucket) {
    const details = document.createElement('div');
    details.className = 'month-details';
    details.id = detailsId;
    details.setAttribute('aria-hidden', 'true');
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'month-empty';
      empty.textContent = 'Nicio aniversare';
      details.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'month-list';
      const days = Object.keys(monthBucket)
        .map((day) => Number(day))
        .sort((a, b) => a - b);
      days.forEach((day) => {
        const names = monthBucket[day] || [];
        if (!names.length) return;
        const li = document.createElement('li');
        const dayLabel = document.createElement('span');
        dayLabel.className = 'month-day';
        dayLabel.textContent = String(day).padStart(2, '0');
        const namesLabel = document.createElement('span');
        namesLabel.className = 'month-names';
        namesLabel.textContent = names.join(', ');
        li.appendChild(dayLabel);
        li.appendChild(namesLabel);
        list.appendChild(li);
      });
      details.appendChild(list);
    }
    return details;
  }

  function createDayCell(day, monthBucket, meta, idx, currentMonthIdx, currentDay) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    const names = monthBucket[day] || [];
    if (names.length) {
      cell.classList.add('has-birthday');
      cell.dataset.names = names.join('||');
      cell.dataset.dateLabel = `${meta.long} ${String(day).padStart(2, '0')}`;
    }
    if (idx === currentMonthIdx && day === currentDay) {
      cell.classList.add('today');
    }

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = day;
    cell.appendChild(num);

    const labelDay = String(day).padStart(2, '0');
    cell.title = names.length
      ? `${meta.long} ${labelDay}: ${names.join(', ')}`
      : `${meta.long} ${labelDay}`;

    if (names.length) {
      cell.addEventListener('mouseenter', (e) => showBirthdayTooltip(e.currentTarget));
      cell.addEventListener('mouseleave', hideBirthdayTooltip);
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const personName = names[0];
        const person = names.length === 1 ? personLookup.get(personName) : null;
        if (person) {
          hideBirthdayTooltip();
          openModal({
            name: person.name,
            image: person.image || placeholderDataUrl,
            birthday: person.birthday
          });
          return;
        }
        const isActive = birthdayTooltip && birthdayTooltip.classList.contains('show') && activeTooltipCell === e.currentTarget;
        if (isActive) {
          hideBirthdayTooltip();
        } else {
          showBirthdayTooltip(e.currentTarget);
        }
      });
    }
    return cell;
  }

  function renderBirthdayStrip(data) {
    if (!birthdayMonthsEl) return;
    const buckets = collectBirthdays(data);
    const now = new Date();
    const currentMonthIdx = now.getMonth();
    const currentYear = now.getFullYear();
    const currentDay = now.getDate();
    birthdayMonthsEl.innerHTML = '';

    monthsMeta.forEach((meta, idx) => {
      const monthBucket = buckets[idx] || {};
      const total = Object.keys(monthBucket).length;

      const card = document.createElement('article');
      card.className = 'month-card';
      if (idx === currentMonthIdx) card.classList.add('current');
      card.dataset.monthIndex = idx;
      card.dataset.renderIndex = idx;

      const detailsId = `month-details-${idx}`;
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'month-head';
      head.setAttribute('aria-expanded', 'false');
      head.setAttribute('aria-controls', detailsId);
      const title = document.createElement('span');
      title.className = 'month-title';
      title.textContent = meta.long;
      const expandIcon = document.createElement('span');
      expandIcon.className = 'month-expand-icon';
      expandIcon.textContent = '+';
      head.appendChild(title);
      head.appendChild(expandIcon);
      card.appendChild(head);

      const count = document.createElement('div');
      count.className = 'month-count';
      count.textContent = formatCount(total);
      card.appendChild(count);

      const body = document.createElement('div');
      body.className = 'month-body';

      const weekdayRow = document.createElement('div');
      weekdayRow.className = 'weekday-row';
      ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sam', 'Dum'].forEach((abbr) => {
        const el = document.createElement('div');
        el.textContent = abbr;
        weekdayRow.appendChild(el);
      });
      body.appendChild(weekdayRow);

      const grid = document.createElement('div');
      grid.className = 'month-grid';
      const daysInMonth = getDaysInMonth(currentYear, idx);
      const offset = getFirstDayOffset(currentYear, idx);
      for (let i = 0; i < offset; i++) {
        const pad = document.createElement('div');
        pad.className = 'day-cell pad';
        grid.appendChild(pad);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        grid.appendChild(createDayCell(day, monthBucket, meta, idx, currentMonthIdx, currentDay));
      }
      body.appendChild(grid);
      card.appendChild(body);

      const details = createMonthDetails(detailsId, total, monthBucket);
      card.appendChild(details);

      head.addEventListener('click', () => {
        const isExpanded = card.classList.toggle('expanded');
        details.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
        head.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        expandIcon.textContent = isExpanded ? '-' : '+';
        if (isExpanded && birthdayMonthsEl) {
          birthdayMonthsEl.querySelectorAll('.month-card.expanded').forEach((other) => {
            if (other === card) return;
            other.classList.remove('expanded');
            const otherDetails = other.querySelector('.month-details');
            if (otherDetails) otherDetails.setAttribute('aria-hidden', 'true');
            const otherHead = other.querySelector('.month-head');
            if (otherHead) otherHead.setAttribute('aria-expanded', 'false');
            const otherIcon = other.querySelector('.month-expand-icon');
            if (otherIcon) otherIcon.textContent = '+';
          });
        }
        updateExpandedMonthPlacement();
      });
      birthdayMonthsEl.appendChild(card);
    });
  }

  function getCalendarColumnCount() {
    if (!birthdayMonthsEl) return 1;
    const raw = Number.parseInt(getComputedStyle(birthdayMonthsEl).getPropertyValue('--month-cols'), 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  function normalizeMonthCardOrder() {
    if (!birthdayMonthsEl) return [];
    const cards = Array.from(birthdayMonthsEl.querySelectorAll('.month-card'));
    cards
      .sort((a, b) => Number(a.dataset.renderIndex || 0) - Number(b.dataset.renderIndex || 0))
      .forEach((card) => birthdayMonthsEl.appendChild(card));
    return Array.from(birthdayMonthsEl.querySelectorAll('.month-card'));
  }

  function updateExpandedMonthPlacement() {
    if (!birthdayMonthsEl) return;
    const orderedCards = normalizeMonthCardOrder();
    orderedCards.forEach((card) => card.classList.remove('expand-left'));

    const cols = getCalendarColumnCount();
    if (cols <= 1) return;

    const expanded = birthdayMonthsEl.querySelector('.month-card.expanded');
    if (!expanded) return;

    const cards = Array.from(birthdayMonthsEl.querySelectorAll('.month-card'));
    const idx = cards.indexOf(expanded);
    if (idx <= 0) return;

    const isLastColumn = ((idx + 1) % cols) === 0;
    if (!isLastColumn) return;

    birthdayMonthsEl.insertBefore(expanded, cards[idx - 1]);
    expanded.classList.add('expand-left');
  }

  function formatCount(total) {
    if (typeof externalCalendarUtils.formatCount === 'function') {
      return externalCalendarUtils.formatCount(total, t.birthday, t.birthdays);
    }
    const word = total === 1 ? t.birthday : t.birthdays;
    return `${total} ${word}`;
  }

  function shouldExcludeFromCalendar(name) {
    if (typeof externalCalendarUtils.shouldExcludeFromCalendar === 'function') {
      return externalCalendarUtils.shouldExcludeFromCalendar(name, calendarExcludeNames);
    }
    return calendarExcludeNames.has(String(name || '').toLowerCase());
  }

  function normalizeCountryName(name) {
    const raw = String(name || '');
    const trimmed = raw.replace(/[.,]+$/g, '').trim();
    if (!trimmed) return '';
    const key = trimmed
      .toLowerCase()
      .replace(/\s*&\s*/g, '&')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
    const alias = globeCountryAliases[key];
    return alias || trimmed;
  }
  // Generic tree traversal helper
  function traverseTree(data, callback) {
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      callback(node.name, node.birthday, node.image);
      callback(node.spouse, node.spouseBirthday, node.spouseImage);
      if (node.prevSpouse) callback(node.prevSpouse.name, node.prevSpouse.birthday, node.prevSpouse.image);
      if (node.parents) {
        callback(node.parents.name, node.parents.birthday, node.parents.image);
        callback(node.parents.spouse, node.parents.spouseBirthday, node.parents.spouseImage);
      }
      if (node.spouseParents) {
        callback(node.spouseParents.name, node.spouseParents.birthday, node.spouseParents.image);
        callback(node.spouseParents.spouse, node.spouseParents.spouseBirthday, node.spouseParents.spouseImage);
      }
      (node.children || []).forEach((child) => walk(child));
    }
    walk(data);
  }

  function getUpcomingBirthdays(data, windowDays = UPCOMING_WINDOW_DAYS) {
    if (externalUpcomingController && typeof externalUpcomingController.getUpcomingBirthdays === 'function') {
      return externalUpcomingController.getUpcomingBirthdays(data, windowDays);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    const people = [];

    function addPerson(name, birthday, image) {
      const parsed = parseBirthday(birthday);
      if (!parsed) return;
      const next = new Date(today.getFullYear(), parsed.month - 1, parsed.day);
      if (next < today) next.setFullYear(next.getFullYear() + 1);
      const daysAway = Math.round((next - today) / msPerDay);
      if (daysAway < 0 || daysAway > windowDays) return;
      people.push({
        name: safe(name),
        birthday: birthday || '',
        image: image || '',
        daysAway,
        label: `${String(parsed.day).padStart(2, '0')} ${monthsMeta[parsed.month - 1].short}`
      });
    }

    traverseTree(data, addPerson);
    // Deduplicate by name keeping closest
    const byName = new Map();
    people.forEach((p) => {
      if (!p.name) return;
      if (!byName.has(p.name) || p.daysAway < byName.get(p.name).daysAway) {
        byName.set(p.name, p);
      }
    });
    return Array.from(byName.values()).sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
  }

  function updateViewToggleOffset() {
    if (!viewToggle || !topbar) return;

    const rect = topbar.getBoundingClientRect();
    const spacing = 8;
    const top = Math.max(0, Math.round(rect.bottom + spacing));
    document.documentElement.style.setProperty('--view-toggle-top', `${top}px`);
  }

  function renderUpcomingBanner(data) {
    if (externalUpcomingController && typeof externalUpcomingController.renderUpcomingBanner === 'function') {
      externalUpcomingController.renderUpcomingBanner(data);
      return;
    }
    if (!upcomingContainer) return;
    upcomingBirthdaysList = getUpcomingBirthdays(data);
    upcomingCurrentIndex = 0;
    
    if (!upcomingBirthdaysList.length) {
      upcomingContainer.style.display = 'none';
      return;
    }
    
    upcomingContainer.style.display = 'flex';
    renderUpcomingBirthdayButton();
  }

  function renderUpcomingBirthdayButton() {
    if (externalUpcomingController && typeof externalUpcomingController.renderUpcomingBirthdayButton === 'function') {
      externalUpcomingController.renderUpcomingBirthdayButton();
      return;
    }
    if (!upcomingBirthdaysList.length || !upcomingName) return;
    
    const birthday = upcomingBirthdaysList[upcomingCurrentIndex];
    const whenLabel = birthday.daysAway === 0 ? t.today : (birthday.daysAway === 1 ? t.tomorrow : t.inDays.replace('{n}', birthday.daysAway));
    
    // Parse the birthday to get month and day
    const parsed = parseBirthday(birthday.birthday);
    const dateStr = parsed ? `${monthsMeta[parsed.month - 1].short} ${parsed.day}` : '';
    
    // Format: "Name - Month Day (Days away)"
    const displayText = dateStr ? `${birthday.name} - ${dateStr} (${whenLabel})` : `${birthday.name} (${whenLabel})`;
    upcomingName.textContent = displayText;
    upcomingBtn.title = displayText;
    
    // Show arrows only when there are multiple birthdays
    const showArrows = upcomingBirthdaysList.length > 1;
    if (upcomingPrev) upcomingPrev.style.display = showArrows ? '' : 'none';
    if (upcomingNext) upcomingNext.style.display = showArrows ? '' : 'none';
  }

  function getDaysInMonth(year, monthIdx) {
    if (typeof externalCalendarUtils.getDaysInMonth === 'function') {
      return externalCalendarUtils.getDaysInMonth(year, monthIdx);
    }
    return new Date(year, monthIdx + 1, 0).getDate();
  }

  function getFirstDayOffset(year, monthIdx) {
    if (typeof externalCalendarUtils.getFirstDayOffset === 'function') {
      return externalCalendarUtils.getFirstDayOffset(year, monthIdx);
    }
    // JS getDay: 0 Sun, 1 Mon ... -> shift so Monday is 0
    const jsDay = new Date(year, monthIdx, 1).getDay();
    return (jsDay + 6) % 7;
  }

  function showBirthdayTooltip(cell) {
    if (!birthdayTooltip) return;
    const names = (cell.dataset.names || '').split('||').filter(Boolean);
    if (!names.length) return;
    const dateLabel = cell.dataset.dateLabel || '';
    activeTooltipCell = cell;
    birthdayTooltip.innerHTML = `
      <div class="tooltip-date">${dateLabel}</div>
      <ul class="tooltip-list">
        ${names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
      </ul>
    `;
    birthdayTooltip.hidden = false;
    birthdayTooltip.classList.add('show');
    // Position tooltip above the calendar, near the cell
    const rect = cell.getBoundingClientRect();
    const tipRect = birthdayTooltip.getBoundingClientRect();
    const top = Math.max(8, rect.top - tipRect.height - 10);
    const left = Math.min(
      window.innerWidth - tipRect.width - 8,
      Math.max(8, rect.left + rect.width / 2 - tipRect.width / 2)
    );
    birthdayTooltip.style.top = `${top}px`;
    birthdayTooltip.style.left = `${left}px`;
  }

  function hideBirthdayTooltip() {
    if (!birthdayTooltip) return;
    activeTooltipCell = null;
    birthdayTooltip.classList.remove('show');
    birthdayTooltip.hidden = true;
  }

  function escapeHtml(str) {
    if (typeof externalCalendarUtils.escapeHtml === 'function') {
      return externalCalendarUtils.escapeHtml(str);
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setCalendarOpen(open) {
    calendarOpen = open;
    if (!open) hideBirthdayTooltip();
    if (open) {
      applyMobileState && applyMobileState();
      queueCalendarScroll();
    }
  }

  function queueCalendarScroll() {
    if (!birthdayMonthsEl) return;
    if (birthdayMonthsEl.classList.contains('mobile-carousel')) return;
    requestAnimationFrame(() => {
      if (!calendarOpen) return;
      scrollCalendarToCurrentMonth();
    });
  }

  function scrollCalendarToCurrentMonth() {
    if (!birthdayMonthsEl) return;
    const current = birthdayMonthsEl.querySelector('.month-card.current');
    if (!current) return;
    const sectionRect = birthdayMonthsEl.getBoundingClientRect();
    const cardRect = current.getBoundingClientRect();
    const target = cardRect.top - sectionRect.top + birthdayMonthsEl.scrollTop - 8;
    birthdayMonthsEl.scrollTop = Math.max(0, target);
  }

  // Keep calendar closed unless the calendar view is selected.
  setCalendarOpen(false);

  function setupCarouselControls() {
    if (!birthdayMonthsEl) return;
    applyMobileState = () => {
      const mobileContext = mobileQuery.matches;
      mobileShowAll = mobileContext;
      birthdayMonthsEl.classList.toggle('mobile-show-all', mobileShowAll);
      birthdayMonthsEl.classList.remove('mobile-carousel');
      if (calendarSection) calendarSection.classList.toggle('calendar-full', mobileShowAll);
      // show all months
      birthdayMonthsEl.querySelectorAll('.month-card').forEach((card) => card.classList.remove('active'));
      updateExpandedMonthPlacement();
      detachSwipe();
      if (carouselControls) carouselControls.style.display = 'none';
      if (calendarSideNav) calendarSideNav.style.display = 'none';
    };
    mobileQuery.addEventListener('change', () => applyMobileState && applyMobileState());
    if (applyMobileState) applyMobileState();

    [monthPrevBtn, calendarSidePrev].forEach(btn => btn && btn.addEventListener('click', () => shiftMonth(-1)));
    [monthNextBtn, calendarSideNext].forEach(btn => btn && btn.addEventListener('click', () => shiftMonth(1)));
  }

  function shiftMonth(delta) {
    const cards = Array.from(birthdayMonthsEl ? birthdayMonthsEl.querySelectorAll('.month-card') : []);
    if (!cards.length) return;
    mobileMonthIndex = (mobileMonthIndex + delta + cards.length) % cards.length;
    updateActiveMonthDisplay();
  }

  function updateActiveMonthDisplay() {
    if (!birthdayMonthsEl || mobileShowAll) return;
    const cards = Array.from(birthdayMonthsEl.querySelectorAll('.month-card'));
    cards.forEach((card, i) => {
      card.classList.toggle('active', i === mobileMonthIndex);
    });
    hideBirthdayTooltip();
  }

  function detachSwipe() {
    if (!birthdayMonthsEl) return;
    birthdayMonthsEl.removeEventListener('touchstart', onTouchStart);
    birthdayMonthsEl.removeEventListener('touchend', onTouchEnd);
  }
  function onTouchStart(e) {
    if (!mobileQuery.matches) return;
    const t = e.touches && e.touches[0];
    touchStartX = t ? t.clientX : null;
  }
  function onTouchEnd(e) {
    if (!mobileQuery.matches) return;
    if (touchStartX == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touchStartX;
    touchStartX = null;
    const threshold = 40;
    if (Math.abs(dx) < threshold) return;
    shiftMonth(dx < 0 ? 1 : -1);
  }

  function collectBirthdays(data) {
    personLookup.clear();
    personHierarchy.clear();
    const months = Array.from({ length: 12 }, () => ({}));

    function rememberPerson(name, birthday, image, metadata) {
      const key = (name || '').trim();
      if (!key) return;
      if (!personLookup.has(key)) {
        personLookup.set(key, { name: key, birthday: birthday || '', image: image || '', metadata: metadata });
      }
    }

    function add(name, birthday, image) {
      const label = safe(name).trim();
      if (!label) return;
      if (shouldExcludeFromCalendar(label)) {
        rememberPerson(label, birthday, image);
        return;
      }
      const parsed = parseBirthday(birthday);
      if (!parsed) return;
      rememberPerson(label, birthday, image);
      const bucket = months[parsed.month - 1];
      if (!bucket[parsed.day]) bucket[parsed.day] = [];
      bucket[parsed.day].push(label);
    }

    // Build hierarchy with relationships - improved version
    function buildHierarchy(node, generation = 0, parentNames = [], siblings = []) {
      if (!node) return;

      const recordPerson = (name, spouse, children, parents, sibs, gen) => {
        if (!name) return;
        const metadata = {
          generation: gen,
          spouse: spouse || null,
          children: children || [],
          parents: parents || [],
          siblings: sibs || []
        };
        personHierarchy.set(name, metadata);
        // Update personLookup with metadata
        if (personLookup.has(name)) {
          personLookup.get(name).metadata = metadata;
        }
      };

      // Get all children names for this node
      const childrenNames = (node.children || []).map(c => safe(c.name)).filter(Boolean);

      // Primary person
      if (node.name) {
        const primaryName = safe(node.name);
        recordPerson(primaryName, node.spouse, childrenNames, parentNames, siblings, generation);
      }

      // Spouse
      if (node.spouse) {
        const spouseName = safe(node.spouse);
        recordPerson(spouseName, node.name, childrenNames, [], siblings, generation);
      }

      // Previous spouse
      if (node.prevSpouse && node.prevSpouse.name) {
        const prevSpouseName = safe(node.prevSpouse.name);
        const prevChildren = childrenNames.filter((_, idx) => {
          const child = node.children[idx];
          return child && child.fromPrevSpouse;
        });
        recordPerson(prevSpouseName, node.name, prevChildren, [], [], generation);
      }

      // Process children with sibling info
      if (node.children && node.children.length > 0) {
        const currentParents = [safe(node.name), safe(node.spouse)].filter(Boolean);

        // Build sibling list for each child
        node.children.forEach((child, idx) => {
          const childSiblings = childrenNames.filter((name, i) => i !== idx);
          buildHierarchy(child, generation + 1, currentParents, childSiblings);
        });
      }

      // Handle parents and spouseParents from the data structure
      if (node.parents) {
        buildParentsHierarchy(node.parents, generation - 1);
      }
      if (node.spouseParents) {
        buildParentsHierarchy(node.spouseParents, generation - 1);
      }
    }

    function buildParentsHierarchy(parentsNode, generation) {
      if (!parentsNode) return;

      const parentName = safe(parentsNode.name);
      const parentSpouse = safe(parentsNode.spouse);

      if (parentName) {
        const metadata = {
          generation: generation,
          spouse: parentSpouse || null,
          children: [],
          parents: [],
          siblings: []
        };
        personHierarchy.set(parentName, metadata);
        if (personLookup.has(parentName)) {
          personLookup.get(parentName).metadata = metadata;
        }
      }

      if (parentSpouse) {
        const metadata = {
          generation: generation,
          spouse: parentName || null,
          children: [],
          parents: [],
          siblings: []
        };
        personHierarchy.set(parentSpouse, metadata);
        if (personLookup.has(parentSpouse)) {
          personLookup.get(parentSpouse).metadata = metadata;
        }
      }
    }

    traverseTree(data, add);
    buildHierarchy(data, 0, [], []);
    return months;
  }

  // Empty state overlay
  function showEmptyStateIfNeeded(data) {
    if (externalEmptyStateController && typeof externalEmptyStateController.showIfNeeded === 'function') {
      externalEmptyStateController.showIfNeeded(data);
      return;
    }
    const hasVisited = localStorage.getItem('tree-visited');
    if (hasVisited) return;
    if (!data) return;

    const upcoming = getUpcomingBirthdays(data, BIRTHDAY_POPUP_WINDOW_DAYS);
    if (!upcoming.length) return;

    const heading = upcoming.length === 1
      ? `Zi de naștere în următoarele ${BIRTHDAY_POPUP_WINDOW_DAYS} zile`
      : `Zile de naștere în următoarele ${BIRTHDAY_POPUP_WINDOW_DAYS} zile`;
    const listItems = upcoming.map((person) => {
      const parsed = parseBirthday(person.birthday);
      const dateStr = parsed ? `${monthsMeta[parsed.month - 1].short} ${String(parsed.day).padStart(2, '0')}` : '';
      const whenLabel = person.daysAway === 0
        ? t.today
        : (person.daysAway === 1 ? t.tomorrow : t.inDays.replace('{n}', person.daysAway));
      const label = dateStr ? `${dateStr} (${whenLabel})` : whenLabel;
      return `<li><strong>${escapeHtml(person.name)}</strong> - ${escapeHtml(label)}</li>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'empty-state-overlay';
    overlay.innerHTML = `
      <div class="empty-state-content">
        <h2>${heading}</h2>
        <p>Iată cine își sărbătorește ziua în următoarele ${BIRTHDAY_POPUP_WINDOW_DAYS} zile:</p>
        <ul>${listItems}</ul>
        <p>Deschide calendarul pentru toate zilele de naștere.</p>
        <button id="dismissEmptyState">Am înțeles!</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const dismissBtn = overlay.querySelector('#dismissEmptyState');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          document.body.removeChild(overlay);
        }, 300);
        localStorage.setItem('tree-visited', 'true');
      });
    }

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        dismissBtn.click();
      }
    }, 10000);
  }

  const externalMainUtils =
    (typeof window !== 'undefined' && window.AncestrioMainUtils)
      ? window.AncestrioMainUtils
      : {};

  const parseBirthday = (typeof externalMainUtils.parseBirthday === 'function')
    ? externalMainUtils.parseBirthday
    : (function () {
      const birthdayCache = new Map();
      return function parseBirthdayFallback(raw) {
        if (!raw) return null;

        const cacheKey = String(raw).trim();
        if (birthdayCache.has(cacheKey)) {
          return birthdayCache.get(cacheKey);
        }

        const str = cacheKey;
        const ro = str.match(/^(\d{1,2})[.\-/\s](\d{1,2})[.\-/\s](\d{4}|[xX]{4})$/);
        const iso = !ro && str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        let day;
        let month;
        let year;
        if (ro) {
          day = Number(ro[1]);
          month = Number(ro[2]);
          year = ro[3].toLowerCase() === 'xxxx' ? 2000 : Number(ro[3]);
        } else if (iso) {
          year = Number(iso[1]);
          month = Number(iso[2]);
          day = Number(iso[3]);
        } else {
          birthdayCache.set(cacheKey, null);
          return null;
        }

        const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (month < 1 || month > 12) {
          birthdayCache.set(cacheKey, null);
          return null;
        }
        if (day < 1 || day > daysInMonth[month - 1]) {
          birthdayCache.set(cacheKey, null);
          return null;
        }

        const result = { month, day };
        birthdayCache.set(cacheKey, result);
        return result;
      };
    })();

  const safe = (typeof externalMainUtils.safe === 'function')
    ? externalMainUtils.safe
    : function safeFallback(v) {
      return v == null ? '' : String(v);
    };

  const normalizeName = (typeof externalMainUtils.normalizeName === 'function')
    ? externalMainUtils.normalizeName
    : function normalizeNameFallback(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase();
    };

  const readTags = (typeof externalMainUtils.readTags === 'function')
    ? externalMainUtils.readTags
    : function readTagsFallback(value) {
      if (!value) return [];
      if (typeof value === 'string') return [value.trim()].filter(Boolean);
      if (Array.isArray(value)) {
        return value
          .map((tag) => (tag == null ? '' : String(tag).trim()))
          .filter((tag) => tag.length > 0);
      }
      if (typeof value === 'object' && value.tag) {
        return readTagsFallback(value.tag);
      }
      return [];
    };

  if (
    typeof window !== 'undefined' &&
    window.AncestrioUpcomingUI &&
    typeof window.AncestrioUpcomingUI.createUpcomingController === 'function'
  ) {
    externalUpcomingController = window.AncestrioUpcomingUI.createUpcomingController({
      upcomingBtn,
      upcomingContainer,
      upcomingName,
      upcomingPrev,
      upcomingNext,
      personLookup,
      openModal,
      placeholderDataUrl,
      parseBirthday,
      safe,
      traverseTree,
      monthsMeta,
      labels: {
        today: t.today,
        tomorrow: t.tomorrow,
        inDays: t.inDays
      },
      defaultWindowDays: UPCOMING_WINDOW_DAYS
    });
  }

  if (
    typeof window !== 'undefined' &&
    window.AncestrioEmptyStateUI &&
    typeof window.AncestrioEmptyStateUI.createEmptyStateController === 'function'
  ) {
    externalEmptyStateController = window.AncestrioEmptyStateUI.createEmptyStateController({
      getUpcomingBirthdays,
      parseBirthday,
      escapeHtml,
      monthsMeta,
      labels: {
        today: t.today,
        tomorrow: t.tomorrow,
        inDays: t.inDays
      },
      windowDays: BIRTHDAY_POPUP_WINDOW_DAYS,
      visitedStorageKey: 'tree-visited',
      document,
      storage: localStorage
    });
  }

  const externalTreeRenderer =
    (typeof window !== 'undefined' &&
      window.AncestrioTreeRenderer &&
      typeof window.AncestrioTreeRenderer.createTreeRenderer === 'function')
      ? window.AncestrioTreeRenderer.createTreeRenderer({
          g,
          defs,
          person,
          level,
          avatar,
          baseCoupleWidth,
          safe,
          readTags,
          normalizeName,
          dnaHighlightNames,
          dnaSuppressNames,
          thumbPath,
          placeholderDataUrl,
          openModal,
          setDnaGroup: (group) => { dnaGroup = group; },
          updateDNAVisibility,
          fitTreeWhenVisible,
          getTreeDefaultPadding
        })
      : null;

  function render(data) {
    if (externalTreeRenderer && typeof externalTreeRenderer.render === 'function') {
      externalTreeRenderer.render(data);
      return;
    }
    console.error('Tree renderer module is unavailable.');
  }

})();






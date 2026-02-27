/*
  Viewer style controller for tree viewer pages.
  Handles background + bubble presets, persistence, and accessibility behavior.
*/

(function (global) {
  const STORAGE_PREFIX = 'ancestrio:view-style:';
  const STORAGE_VERSION = 1;
  const DEFAULT_BACKGROUND_ID = 'theme-default';
  const DEFAULT_BUBBLE_ID = 'bubble-classic';

  const DEFAULT_BACKGROUND_PRESETS = [
    { id: 'theme-default', label: 'Default' },
    { id: 'parchment-classic', label: 'Classic' },
    { id: 'parchment-vintage', label: 'Vintage' },
    { id: 'parchment-minimal', label: 'Minimal' },
    { id: 'parchment-photo', label: 'Photo', imageUrl: '../images/store/parchment.webp' }
  ];

  const DEFAULT_BUBBLE_PRESETS = [
    { id: 'bubble-classic', label: 'Classic' },
    { id: 'bubble-ink', label: 'Ink' },
    { id: 'bubble-soft', label: 'Soft' }
  ];

  function sanitizeText(value, maxLength = 120) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Math.max(0, maxLength));
  }

  function sanitizeTreeId(value) {
    return sanitizeText(value, 120).replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function normalizePresetId(value) {
    const cleaned = sanitizeText(value, 64).toLowerCase();
    return cleaned.replace(/[^a-z0-9-]/g, '');
  }

  function normalizeLabel(value, fallback) {
    const cleaned = sanitizeText(value, 64);
    return cleaned || fallback;
  }

  function normalizeBackgroundPresets(source) {
    const list = Array.isArray(source) && source.length ? source : DEFAULT_BACKGROUND_PRESETS;
    const seen = new Set();
    return list
      .map((entry) => {
        const fallbackLabel = typeof entry?.id === 'string' ? entry.id : 'Background';
        const id = normalizePresetId(entry?.id);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return {
          id,
          label: normalizeLabel(entry?.label, fallbackLabel),
          imageUrl: sanitizeText(entry?.imageUrl, 320)
        };
      })
      .filter(Boolean);
  }

  function normalizeBubblePresets(source) {
    const list = Array.isArray(source) && source.length ? source : DEFAULT_BUBBLE_PRESETS;
    const seen = new Set();
    return list
      .map((entry) => {
        const fallbackLabel = typeof entry?.id === 'string' ? entry.id : 'Bubble';
        const id = normalizePresetId(entry?.id);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return {
          id,
          label: normalizeLabel(entry?.label, fallbackLabel)
        };
      })
      .filter(Boolean);
  }

  function readStorage(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') return '';
    try {
      return storage.getItem(key) || '';
    } catch (_) {
      return '';
    }
  }

  function writeStorage(storage, key, value) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(key, value);
    } catch (_) {
      // Ignore storage failures (private mode/quota).
    }
  }

  function parseStoredState(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function resolveScopeId(locationObj) {
    const safeLocation = locationObj || global.location || { pathname: '', search: '' };
    const search = typeof safeLocation.search === 'string' ? safeLocation.search : '';
    const params = new URLSearchParams(search);
    const treeId = sanitizeTreeId(params.get('id'));
    if (treeId) return treeId;

    const pathname = String(safeLocation.pathname || '').toLowerCase();
    if (pathname.endsWith('demo-tree.html')) return 'demo-tree';
    return 'local-tree';
  }

  function createOptionButton(preset, groupKind) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-style-option';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.setAttribute('aria-label', preset.label);
    button.dataset.optionId = preset.id;
    button.dataset.optionKind = groupKind;
    button.tabIndex = -1;

    const swatch = document.createElement('span');
    swatch.className = `view-style-swatch swatch-${preset.id}`;
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'view-style-option-label';
    label.textContent = preset.label;

    button.appendChild(swatch);
    button.appendChild(label);
    return button;
  }

  function createViewStyleController(options) {
    const opts = options || {};
    const body = opts.body || document.body;
    const panelEl = opts.panelEl || document.getElementById('viewStylePanel');
    const backgroundContainer = opts.backgroundContainer || document.getElementById('viewBackgroundOptions');
    const bubbleContainer = opts.bubbleContainer || document.getElementById('viewBubbleOptions');
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    const storage = opts.storage || global.localStorage;
    const locationObj = opts.location || global.location;

    const backgroundPresets = normalizeBackgroundPresets(opts.backgroundPresets);
    const bubblePresets = normalizeBubblePresets(opts.bubblePresets);
    const backgroundById = new Map(backgroundPresets.map((preset) => [preset.id, preset]));
    const bubbleById = new Map(bubblePresets.map((preset) => [preset.id, preset]));
    const defaultBackground = backgroundById.has(DEFAULT_BACKGROUND_ID) ? DEFAULT_BACKGROUND_ID : (backgroundPresets[0]?.id || '');
    const defaultBubble = bubbleById.has(DEFAULT_BUBBLE_ID) ? DEFAULT_BUBBLE_ID : (bubblePresets[0]?.id || '');
    const scopeId = resolveScopeId(locationObj);
    const storageKey = `${STORAGE_PREFIX}${scopeId}`;

    let state = {
      background: defaultBackground,
      bubble: defaultBubble
    };

    function sanitizeBackground(value) {
      const id = normalizePresetId(value);
      return backgroundById.has(id) ? id : defaultBackground;
    }

    function sanitizeBubble(value) {
      const id = normalizePresetId(value);
      return bubbleById.has(id) ? id : defaultBubble;
    }

    function updateOptionStates(container, selectedId) {
      if (!container) return;
      const buttons = container.querySelectorAll('.view-style-option[data-option-id]');
      buttons.forEach((button) => {
        const isActive = button.dataset.optionId === selectedId;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-checked', isActive ? 'true' : 'false');
        button.tabIndex = isActive ? 0 : -1;
      });
    }

    function persistState() {
      const payload = {
        v: STORAGE_VERSION,
        background: state.background,
        bubble: state.bubble
      };
      writeStorage(storage, storageKey, JSON.stringify(payload));
    }

    function applyBodyState() {
      if (!body) return;
      body.setAttribute('data-view-bg', state.background);
      body.setAttribute('data-view-bubble', state.bubble);

      const backgroundPreset = backgroundById.get(state.background);
      if (backgroundPreset && backgroundPreset.imageUrl) {
        const escapedUrl = backgroundPreset.imageUrl.replace(/"/g, '\\"');
        body.style.setProperty('--viewer-bg-image', `url("${escapedUrl}")`);
      } else {
        body.style.removeProperty('--viewer-bg-image');
      }
    }

    function emitStateChange() {
      if (!onChange) return;
      onChange({ ...state });
    }

    function setState(nextState, optionsForSet) {
      const setOptions = optionsForSet && typeof optionsForSet === 'object' ? optionsForSet : {};
      const nextBackground = sanitizeBackground(nextState?.background);
      const nextBubble = sanitizeBubble(nextState?.bubble);
      const changed = nextBackground !== state.background || nextBubble !== state.bubble;

      state = {
        background: nextBackground,
        bubble: nextBubble
      };

      applyBodyState();
      updateOptionStates(backgroundContainer, state.background);
      updateOptionStates(bubbleContainer, state.bubble);

      if (setOptions.persist !== false) {
        persistState();
      }

      if (changed && setOptions.emit !== false) {
        emitStateChange();
      }
    }

    function setBackground(backgroundId, optionsForSet) {
      const optsForSet = optionsForSet && typeof optionsForSet === 'object' ? optionsForSet : {};
      setState({ ...state, background: backgroundId }, optsForSet);
      if (optsForSet.focus) {
        const button = backgroundContainer?.querySelector(`.view-style-option[data-option-id="${state.background}"]`);
        button?.focus();
      }
    }

    function setBubble(bubbleId, optionsForSet) {
      const optsForSet = optionsForSet && typeof optionsForSet === 'object' ? optionsForSet : {};
      setState({ ...state, bubble: bubbleId }, optsForSet);
      if (optsForSet.focus) {
        const button = bubbleContainer?.querySelector(`.view-style-option[data-option-id="${state.bubble}"]`);
        button?.focus();
      }
    }

    function bindOptionGroup(container, presets, setter) {
      if (!container) return;

      container.innerHTML = '';
      presets.forEach((preset) => {
        const button = createOptionButton(preset, container.id || '');
        button.addEventListener('click', () => setter(preset.id));
        button.addEventListener('keydown', (event) => {
          const currentIndex = presets.findIndex((entry) => entry.id === preset.id);
          if (currentIndex < 0) return;

          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            const next = presets[(currentIndex + 1) % presets.length];
            setter(next.id, { focus: true });
            return;
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = presets[(currentIndex - 1 + presets.length) % presets.length];
            setter(next.id, { focus: true });
            return;
          }
          if (event.key === 'Home') {
            event.preventDefault();
            setter(presets[0].id, { focus: true });
            return;
          }
          if (event.key === 'End') {
            event.preventDefault();
            setter(presets[presets.length - 1].id, { focus: true });
          }
        });
        container.appendChild(button);
      });
    }

    bindOptionGroup(backgroundContainer, backgroundPresets, setBackground);
    bindOptionGroup(bubbleContainer, bubblePresets, setBubble);

    const storedState = parseStoredState(readStorage(storage, storageKey));
    if (storedState && typeof storedState === 'object') {
      setState({
        background: storedState.background,
        bubble: storedState.bubble
      }, { persist: false, emit: false });
    } else {
      setState(state, { persist: false, emit: false });
    }

    if (panelEl) {
      panelEl.classList.add('is-ready');
    }

    return {
      getState: function getState() {
        return { ...state };
      },
      setState,
      setBackground,
      setBubble,
      getScopeId: function getScopeId() {
        return scopeId;
      },
      getStorageKey: function getStorageKey() {
        return storageKey;
      },
      destroy: function destroy() {
        if (backgroundContainer) backgroundContainer.innerHTML = '';
        if (bubbleContainer) bubbleContainer.innerHTML = '';
      }
    };
  }

  global.AncestrioViewStyleUI = global.AncestrioViewStyleUI || {};
  global.AncestrioViewStyleUI.createViewStyleController = createViewStyleController;
})(window);

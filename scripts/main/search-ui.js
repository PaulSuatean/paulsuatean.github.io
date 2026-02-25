/*
  Search UI controller for tree viewer pages.
  Keeps DOM/search behavior modular and testable.
*/

(function () {
  function createSearchController(options) {
    const opts = options || {};
    const searchBar = opts.searchBar || null;
    const searchInput = opts.searchInput || null;
    const searchResults = opts.searchResults || null;
    const personLookup = opts.personLookup || null;
    const escapeHtml = typeof opts.escapeHtml === 'function'
      ? opts.escapeHtml
      : function fallbackEscapeHtml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };
    const openModal = typeof opts.openModal === 'function' ? opts.openModal : function () {};
    const placeholderDataUrl = opts.placeholderDataUrl || '';
    const mobileMediaQuery = opts.mobileMediaQuery || '(max-width: 768px)';
    const topbarSelector = opts.topbarSelector || '.topbar';
    const noResultsText = opts.noResultsText || 'No results found';
    const birthdayLabel = opts.birthdayLabel || 'Birthday';

    function toggleSearch(show) {
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
      if (!searchBar) return;
      const isMobile = window.matchMedia(mobileMediaQuery).matches;
      if (!isMobile) {
        searchBar.classList.remove('mobile-positioned');
        searchBar.style.removeProperty('--searchbar-top');
        return;
      }
      const topbar = document.querySelector(topbarSelector);
      const top = topbar ? topbar.getBoundingClientRect().bottom + 8 : 140;
      searchBar.style.setProperty('--searchbar-top', `${Math.round(top)}px`);
      searchBar.classList.add('mobile-positioned');
    }

    function performSearch(query) {
      if (!query || !searchResults || !personLookup) return;
      const q = query.toLowerCase().trim();
      const results = [];
      personLookup.forEach((person) => {
        if (person.name.toLowerCase().includes(q)) {
          results.push(person);
        }
      });
      if (results.length === 0) {
        searchResults.innerHTML = `<div class="search-result-item">${escapeHtml(noResultsText)}</div>`;
      } else {
        searchResults.innerHTML = results.map((person) => `
          <div class="search-result-item" data-name="${escapeHtml(person.name)}">
            <div class="name">${escapeHtml(person.name)}</div>
            ${person.birthday ? `<div class="birthday">${escapeHtml(birthdayLabel)}: ${escapeHtml(person.birthday)}</div>` : ''}
          </div>
        `).join('');
        searchResults.querySelectorAll('.search-result-item').forEach((item) => {
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

    return {
      toggleSearch,
      positionSearchBar,
      performSearch
    };
  }

  window.AncestrioSearchUI = window.AncestrioSearchUI || {};
  window.AncestrioSearchUI.createSearchController = createSearchController;
})();

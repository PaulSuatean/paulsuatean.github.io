/*
  Empty-state birthday popup controller for tree viewer pages.
  Keeps first-visit popup logic out of main.js.
*/

(function () {
  function createEmptyStateController(options) {
    const opts = options || {};
    const getUpcomingBirthdays =
      typeof opts.getUpcomingBirthdays === 'function'
        ? opts.getUpcomingBirthdays
        : function () { return []; };
    const parseBirthday =
      typeof opts.parseBirthday === 'function'
        ? opts.parseBirthday
        : function () { return null; };
    const escapeHtml =
      typeof opts.escapeHtml === 'function'
        ? opts.escapeHtml
        : function fallbackEscapeHtml(str) {
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        };
    const monthsMeta = Array.isArray(opts.monthsMeta) ? opts.monthsMeta : [];
    const labels = opts.labels || {};
    const todayLabel = labels.today || 'Today';
    const tomorrowLabel = labels.tomorrow || 'Tomorrow';
    const inDaysTemplate = labels.inDays || 'In {n} days';
    const windowDays = Number.isFinite(opts.windowDays) ? opts.windowDays : 7;
    const visitedStorageKey = opts.visitedStorageKey || 'tree-visited';
    const doc = opts.document || document;
    const storage = opts.storage || localStorage;

    function showIfNeeded(data) {
      const hasVisited = storage.getItem(visitedStorageKey);
      if (hasVisited) return;
      if (!data) return;

      const upcoming = getUpcomingBirthdays(data, windowDays);
      if (!upcoming.length) return;

      const heading = upcoming.length === 1
        ? `Zi de naștere în următoarele ${windowDays} zile`
        : `Zile de naștere în următoarele ${windowDays} zile`;

      const listItems = upcoming.map((person) => {
        const parsed = parseBirthday(person.birthday);
        const dateStr = parsed ? `${monthsMeta[parsed.month - 1]?.short || ''} ${String(parsed.day).padStart(2, '0')}`.trim() : '';
        const whenLabel = person.daysAway === 0
          ? todayLabel
          : (person.daysAway === 1 ? tomorrowLabel : inDaysTemplate.replace('{n}', person.daysAway));
        const label = dateStr ? `${dateStr} (${whenLabel})` : whenLabel;
        return `<li><strong>${escapeHtml(person.name)}</strong> - ${escapeHtml(label)}</li>`;
      }).join('');

      const overlay = doc.createElement('div');
      overlay.className = 'empty-state-overlay';
      overlay.innerHTML = `
      <div class="empty-state-content">
        <h2>${heading}</h2>
        <p>Iată cine își sărbătorește ziua în următoarele ${windowDays} zile:</p>
        <ul>${listItems}</ul>
        <p>Deschide calendarul pentru toate zilele de naștere.</p>
        <button id="dismissEmptyState">Am înțeles!</button>
      </div>
    `;

      doc.body.appendChild(overlay);

      const dismissBtn = overlay.querySelector('#dismissEmptyState');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          overlay.style.opacity = '0';
          setTimeout(() => {
            if (doc.body.contains(overlay)) {
              doc.body.removeChild(overlay);
            }
          }, 300);
          storage.setItem(visitedStorageKey, 'true');
        });
      }

      setTimeout(() => {
        if (dismissBtn && doc.body.contains(overlay)) {
          dismissBtn.click();
        }
      }, 10000);
    }

    return { showIfNeeded };
  }

  window.AncestrioEmptyStateUI = window.AncestrioEmptyStateUI || {};
  window.AncestrioEmptyStateUI.createEmptyStateController = createEmptyStateController;
})();

/*
  Upcoming birthday controller for tree viewer pages.
  Extracted from main.js to keep banner behavior modular.
*/

(function () {
  function createUpcomingController(options) {
    const opts = options || {};
    const upcomingBtn = opts.upcomingBtn || null;
    const upcomingContainer = opts.upcomingContainer || null;
    const upcomingName = opts.upcomingName || null;
    const upcomingPrev = opts.upcomingPrev || null;
    const upcomingNext = opts.upcomingNext || null;
    const personLookup = opts.personLookup || new Map();
    const openModal = typeof opts.openModal === 'function' ? opts.openModal : function () {};
    const placeholderDataUrl = opts.placeholderDataUrl || '';
    const parseBirthday = typeof opts.parseBirthday === 'function' ? opts.parseBirthday : function () { return null; };
    const safe = typeof opts.safe === 'function'
      ? opts.safe
      : function safeFallback(v) { return v == null ? '' : String(v); };
    const traverseTree = typeof opts.traverseTree === 'function' ? opts.traverseTree : function () {};
    const monthsMeta = Array.isArray(opts.monthsMeta) ? opts.monthsMeta : [];
    const labels = opts.labels || {};
    const todayLabel = labels.today || 'Today';
    const tomorrowLabel = labels.tomorrow || 'Tomorrow';
    const inDaysTemplate = labels.inDays || 'In {n} days';
    const defaultWindowDays = Number.isFinite(opts.defaultWindowDays) ? opts.defaultWindowDays : 10;

    let upcomingBirthdaysList = [];
    let upcomingCurrentIndex = 0;

    function getUpcomingBirthdays(data, windowDays = defaultWindowDays) {
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
          label: `${String(parsed.day).padStart(2, '0')} ${monthsMeta[parsed.month - 1]?.short || ''}`.trim()
        });
      }

      traverseTree(data, addPerson);

      // Deduplicate by name keeping closest.
      const byName = new Map();
      people.forEach((person) => {
        if (!person.name) return;
        if (!byName.has(person.name) || person.daysAway < byName.get(person.name).daysAway) {
          byName.set(person.name, person);
        }
      });

      return Array.from(byName.values()).sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
    }

    function renderUpcomingBirthdayButton() {
      if (!upcomingBirthdaysList.length || !upcomingName) return;

      const birthday = upcomingBirthdaysList[upcomingCurrentIndex];
      const whenLabel = birthday.daysAway === 0
        ? todayLabel
        : (birthday.daysAway === 1 ? tomorrowLabel : inDaysTemplate.replace('{n}', birthday.daysAway));

      const parsed = parseBirthday(birthday.birthday);
      const dateStr = parsed ? `${monthsMeta[parsed.month - 1]?.short || ''} ${parsed.day}`.trim() : '';

      const displayText = dateStr
        ? `${birthday.name} - ${dateStr} (${whenLabel})`
        : `${birthday.name} (${whenLabel})`;

      upcomingName.textContent = displayText;
      if (upcomingBtn) {
        upcomingBtn.title = displayText;
      }

      const showArrows = upcomingBirthdaysList.length > 1;
      if (upcomingPrev) upcomingPrev.style.display = showArrows ? '' : 'none';
      if (upcomingNext) upcomingNext.style.display = showArrows ? '' : 'none';
    }

    function renderUpcomingBanner(data) {
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

    function previous() {
      if (!upcomingBirthdaysList.length) return;
      upcomingCurrentIndex = (upcomingCurrentIndex - 1 + upcomingBirthdaysList.length) % upcomingBirthdaysList.length;
      renderUpcomingBirthdayButton();
    }

    function next() {
      if (!upcomingBirthdaysList.length) return;
      upcomingCurrentIndex = (upcomingCurrentIndex + 1) % upcomingBirthdaysList.length;
      renderUpcomingBirthdayButton();
    }

    function openCurrent() {
      if (!upcomingBirthdaysList.length) return;
      const birthday = upcomingBirthdaysList[upcomingCurrentIndex];
      const info = personLookup.get(birthday.name);
      if (!info) return;
      openModal({
        name: info.name,
        image: info.image || placeholderDataUrl,
        birthday: info.birthday,
        metadata: info.metadata
      });
    }

    return {
      getUpcomingBirthdays,
      renderUpcomingBanner,
      renderUpcomingBirthdayButton,
      previous,
      next,
      openCurrent
    };
  }

  window.AncestrioUpcomingUI = window.AncestrioUpcomingUI || {};
  window.AncestrioUpcomingUI.createUpcomingController = createUpcomingController;
})();

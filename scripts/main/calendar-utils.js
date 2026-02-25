/*
  Shared helpers for calendar/text rendering in the tree viewer.
  Extracted from main.js to keep utility logic isolated.
*/

(function () {
  function getDaysInMonth(year, monthIdx) {
    return new Date(year, monthIdx + 1, 0).getDate();
  }

  function getFirstDayOffset(year, monthIdx) {
    // JS getDay: 0 Sun, 1 Mon ... -> shift so Monday is 0
    const jsDay = new Date(year, monthIdx, 1).getDay();
    return (jsDay + 6) % 7;
  }

  function formatCount(total, singularWord, pluralWord) {
    const singular = String(singularWord || 'birthday');
    const plural = String(pluralWord || 'birthdays');
    const word = total === 1 ? singular : plural;
    return `${total} ${word}`;
  }

  function shouldExcludeFromCalendar(name, excludedNames) {
    if (!excludedNames || typeof excludedNames.has !== 'function') return false;
    return excludedNames.has(String(name || '').toLowerCase());
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.AncestrioCalendarUtils = window.AncestrioCalendarUtils || {};
  window.AncestrioCalendarUtils.getDaysInMonth = getDaysInMonth;
  window.AncestrioCalendarUtils.getFirstDayOffset = getFirstDayOffset;
  window.AncestrioCalendarUtils.formatCount = formatCount;
  window.AncestrioCalendarUtils.shouldExcludeFromCalendar = shouldExcludeFromCalendar;
  window.AncestrioCalendarUtils.escapeHtml = escapeHtml;
})();

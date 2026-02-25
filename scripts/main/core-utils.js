/*
  Core helpers shared by main tree rendering logic.
  Kept as a separate module to reduce main.js size and improve maintainability.
*/

(function () {
  const birthdayCache = new Map();

  function parseBirthday(raw) {
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
  }

  function safe(v) {
    return v == null ? '' : String(v);
  }

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function readTags(value) {
    if (!value) return [];
    if (typeof value === 'string') return [value.trim()].filter(Boolean);
    if (Array.isArray(value)) {
      return value
        .map((tag) => (tag == null ? '' : String(tag).trim()))
        .filter((tag) => tag.length > 0);
    }
    if (typeof value === 'object' && value.tag) {
      return readTags(value.tag);
    }
    return [];
  }

  window.AncestrioMainUtils = window.AncestrioMainUtils || {};
  window.AncestrioMainUtils.parseBirthday = parseBirthday;
  window.AncestrioMainUtils.safe = safe;
  window.AncestrioMainUtils.normalizeName = normalizeName;
  window.AncestrioMainUtils.readTags = readTags;
})();

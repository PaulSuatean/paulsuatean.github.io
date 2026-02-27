(function (global) {
  const STORE_CURRENCY = 'EUR';
  const BUNDLE_DISCOUNT_PERCENT = 10;
  const PRODUCT_SKUS = ['parchment', 'calendar', 'globe', 'bundle'];
  const SOURCE_VALUES = ['landing', 'dashboard', 'tree', 'demo-tree'];
  const VIEW_VALUES = ['tree', 'calendar', 'globe'];
  const PARCHMENT_STYLES = ['Classic', 'Minimal', 'Vintage'];

  const STORE_PRODUCTS = {
    parchment: {
      sku: 'parchment',
      label: 'Printed Parchment Family Tree',
      shortLabel: 'Parchment Print',
      price: 69
    },
    calendar: {
      sku: 'calendar',
      label: 'Mini Birthday Calendar',
      shortLabel: 'Birthday Calendar',
      price: 24
    },
    globe: {
      sku: 'globe',
      label: 'Family Journey Globe',
      shortLabel: 'Family Globe',
      price: 79
    },
    bundle: {
      sku: 'bundle',
      label: 'Family Keepsake Bundle',
      shortLabel: 'Bundle (All 3)',
      price: 0
    }
  };

  const BUNDLE_ITEMS = ['parchment', 'calendar', 'globe'];
  const BUNDLE_UNIT_PRICE = BUNDLE_ITEMS.reduce((sum, sku) => sum + STORE_PRODUCTS[sku].price, 0);
  STORE_PRODUCTS.bundle.price = BUNDLE_UNIT_PRICE;

  function roundMoney(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100) / 100;
  }

  function parseBooleanFlag(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    }
    return fallback;
  }

  function sanitizeText(value, maxLength = 140) {
    if (value === null || value === undefined) return '';
    const cleaned = String(value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    return cleaned.slice(0, Math.max(0, maxLength));
  }

  function sanitizeTreeId(value) {
    const cleaned = sanitizeText(value, 120);
    if (!cleaned) return '';
    return cleaned.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  }

  function sanitizeEnum(value, allowedValues, fallback) {
    const cleaned = sanitizeText(value, 48).toLowerCase();
    return allowedValues.includes(cleaned) ? cleaned : fallback;
  }

  function sanitizeProduct(value, fallback = 'bundle') {
    return sanitizeEnum(value, PRODUCT_SKUS, fallback);
  }

  function sanitizeSource(value, fallback = 'dashboard') {
    return sanitizeEnum(value, SOURCE_VALUES, fallback);
  }

  function sanitizeView(value, fallback = 'tree') {
    return sanitizeEnum(value, VIEW_VALUES, fallback);
  }

  function parseStoreQuery(searchValue) {
    const search = typeof searchValue === 'string'
      ? searchValue
      : (global.location && typeof global.location.search === 'string' ? global.location.search : '');
    const params = new URLSearchParams(search);

    return {
      product: sanitizeProduct(params.get('product')),
      source: sanitizeSource(params.get('source')),
      view: sanitizeView(params.get('view')),
      treeId: sanitizeTreeId(params.get('treeId')),
      treeName: sanitizeText(params.get('treeName'), 160)
    };
  }

  function getProductBySku(sku) {
    const normalizedSku = sanitizeProduct(sku);
    return STORE_PRODUCTS[normalizedSku] || STORE_PRODUCTS.bundle;
  }

  function getProductPricing(productSku, quantityValue) {
    const sku = sanitizeProduct(productSku);
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(quantityValue) || 1)));
    const product = getProductBySku(sku);
    const unitPrice = roundMoney(product.price);
    const subtotal = roundMoney(unitPrice * quantity);
    const discountPercent = sku === 'bundle' ? BUNDLE_DISCOUNT_PERCENT : 0;
    const discountAmount = roundMoney(subtotal * (discountPercent / 100));
    const total = roundMoney(subtotal - discountAmount);

    return {
      sku,
      quantity,
      unitPrice,
      subtotal,
      discountPercent,
      discountAmount,
      total
    };
  }

  function formatCurrency(amount, currency = STORE_CURRENCY, locale) {
    const numeric = Number(amount);
    const safeAmount = Number.isFinite(numeric) ? numeric : 0;
    const preferredLocale = sanitizeText(locale, 32) || (global.navigator ? global.navigator.language : 'en-IE') || 'en-IE';
    try {
      return new Intl.NumberFormat(preferredLocale, {
        style: 'currency',
        currency
      }).format(safeAmount);
    } catch (_) {
      return `${safeAmount.toFixed(2)} ${currency}`;
    }
  }

  function buildStoreUrl(context, options) {
    const safeContext = context && typeof context === 'object' ? context : {};
    const safeOptions = options && typeof options === 'object' ? options : {};
    const path = sanitizeText(safeOptions.path, 120) || 'store.html';
    const query = new URLSearchParams();

    query.set('product', sanitizeProduct(safeContext.product));
    query.set('source', sanitizeSource(safeContext.source));
    query.set('view', sanitizeView(safeContext.view));

    const treeId = sanitizeTreeId(safeContext.treeId);
    if (treeId) query.set('treeId', treeId);

    const treeName = sanitizeText(safeContext.treeName, 160);
    if (treeName) query.set('treeName', treeName);

    return `${path}?${query.toString()}`;
  }

  function deriveRecommendedProduct(flags) {
    const source = flags && typeof flags === 'object' ? flags : {};
    const hasCalendar = parseBooleanFlag(source.enableCalendarDates ?? source.enableBirthdays, true);
    const hasGlobe = parseBooleanFlag(source.enableGlobeCountries, true);

    if (hasCalendar && hasGlobe) return 'bundle';
    if (hasCalendar) return 'calendar';
    if (hasGlobe) return 'globe';
    return 'parchment';
  }

  function isAllowedParchmentStyle(style) {
    const cleaned = sanitizeText(style, 32);
    return PARCHMENT_STYLES.includes(cleaned);
  }

  global.AncestrioStoreUtils = {
    STORE_CURRENCY,
    BUNDLE_DISCOUNT_PERCENT,
    PARCHMENT_STYLES: PARCHMENT_STYLES.slice(),
    PRODUCT_SKUS: PRODUCT_SKUS.slice(),
    SOURCE_VALUES: SOURCE_VALUES.slice(),
    VIEW_VALUES: VIEW_VALUES.slice(),
    STORE_PRODUCTS,
    parseBooleanFlag,
    parseStoreQuery,
    getProductBySku,
    getProductPricing,
    formatCurrency,
    sanitizeText,
    sanitizeTreeId,
    sanitizeProduct,
    sanitizeSource,
    sanitizeView,
    buildStoreUrl,
    deriveRecommendedProduct,
    isAllowedParchmentStyle
  };
})(window);

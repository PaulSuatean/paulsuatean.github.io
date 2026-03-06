(function (global) {
  const STORE_CURRENCY = 'EUR';
  const PRODUCT_SKUS = ['paper-print'];
  const SOURCE_VALUES = ['landing', 'dashboard', 'tree', 'demo-tree'];
  const VIEW_VALUES = ['tree', 'calendar', 'globe'];
  const PRINT_STYLES = ['Classic', 'Ornate', 'Minimal'];
  const PAPER_FINISHES = ['Matte', 'Satin', 'Gloss'];
  const PRINT_SIZES = ['A3', 'A2', 'Custom'];

  const STORE_PRODUCTS = {
    'paper-print': {
      sku: 'paper-print',
      label: 'Printed Paper Family Tree',
      shortLabel: 'Paper Print',
      price: 69
    }
  };

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

  function sanitizeProduct(value, fallback = 'paper-print') {
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
    return STORE_PRODUCTS[normalizedSku] || STORE_PRODUCTS['paper-print'];
  }

  function getProductPricing(productSku, quantityValue) {
    const sku = sanitizeProduct(productSku);
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(quantityValue) || 1)));
    const product = getProductBySku(sku);
    const unitPrice = roundMoney(product.price);
    const subtotal = roundMoney(unitPrice * quantity);

    return {
      sku,
      quantity,
      unitPrice,
      subtotal,
      discountPercent: 0,
      discountAmount: 0,
      total: roundMoney(subtotal)
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

  function deriveRecommendedProduct() {
    return 'paper-print';
  }

  function isAllowedPrintStyle(style) {
    const cleaned = sanitizeText(style, 32);
    return PRINT_STYLES.includes(cleaned);
  }

  function isAllowedPaperFinish(finish) {
    const cleaned = sanitizeText(finish, 32);
    return PAPER_FINISHES.includes(cleaned);
  }

  function isAllowedPrintSize(size) {
    const cleaned = sanitizeText(size, 32);
    return PRINT_SIZES.includes(cleaned);
  }

  global.AncestrioStoreUtils = {
    STORE_CURRENCY,
    PRINT_STYLES: PRINT_STYLES.slice(),
    PAPER_FINISHES: PAPER_FINISHES.slice(),
    PRINT_SIZES: PRINT_SIZES.slice(),
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
    isAllowedPrintStyle,
    isAllowedPaperFinish,
    isAllowedPrintSize
  };
})(window);

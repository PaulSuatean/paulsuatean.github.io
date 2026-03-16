(function (global) {
  const STORE_CURRENCY = 'EUR';
  const PRODUCT_SKUS = ['paper-print'];
  const SOURCE_VALUES = ['landing', 'contact', 'auth', 'dashboard', 'editor', 'privacy', 'terms', 'cookies', 'store', 'tree', 'demo-tree'];
  const VIEW_VALUES = ['tree', 'calendar', 'globe'];
  const PRINT_STYLES = ['Classic', 'Ornate', 'Minimal'];
  const PAPER_FINISHES = ['Matte', 'Satin', 'Gloss'];
  const PRINT_SIZES = ['A3', 'A2', 'Custom'];
  const SOURCE_ALIASES = Object.freeze({
    'site-header': 'landing',
    'landing-paths': 'landing',
    'landing-cta': 'landing',
    'contact-footer': 'contact',
    'auth-footer': 'auth',
    'dashboard-footer': 'dashboard',
    'privacy-footer': 'privacy',
    'terms-footer': 'terms',
    'cookies-footer': 'cookies',
    'store-footer': 'store'
  });
  const SOURCE_META = Object.freeze({
    landing: Object.freeze({ label: 'Landing', backHref: '../index.html' }),
    contact: Object.freeze({ label: 'About', backHref: 'contact.html' }),
    auth: Object.freeze({ label: 'Sign In', backHref: 'auth.html' }),
    dashboard: Object.freeze({ label: 'Dashboard', backHref: 'dashboard.html' }),
    editor: Object.freeze({ label: 'Editor', backHref: 'editor.html' }),
    privacy: Object.freeze({ label: 'Privacy', backHref: 'privacy.html' }),
    terms: Object.freeze({ label: 'Terms', backHref: 'terms.html' }),
    cookies: Object.freeze({ label: 'Cookies', backHref: 'cookies.html' }),
    store: Object.freeze({ label: 'Store', backHref: 'store.html' }),
    tree: Object.freeze({ label: 'Tree Viewer', backHref: 'tree.html' }),
    'demo-tree': Object.freeze({ label: 'Demo Tree', backHref: 'demo-tree.html' })
  });

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
    const cleaned = sanitizeText(value, 48).toLowerCase();
    const canonical = SOURCE_ALIASES[cleaned] || cleaned;
    return SOURCE_VALUES.includes(canonical) ? canonical : fallback;
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

  function getSourceMeta(value, fallback = 'dashboard') {
    const source = sanitizeSource(value, fallback);
    const meta = SOURCE_META[source] || SOURCE_META[fallback] || SOURCE_META.dashboard;
    return {
      source,
      label: meta.label,
      backHref: meta.backHref
    };
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
    parseStoreQuery,
    getProductBySku,
    getProductPricing,
    formatCurrency,
    sanitizeText,
    sanitizeTreeId,
    sanitizeProduct,
    sanitizeSource,
    sanitizeView,
    getSourceMeta,
    buildStoreUrl,
    deriveRecommendedProduct,
    isAllowedPrintStyle,
    isAllowedPaperFinish,
    isAllowedPrintSize
  };
})(window);

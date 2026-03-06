(function () {
  const storeUtils = window.AncestrioStoreUtils || {};
  const PRODUCT_SKUS = Array.isArray(storeUtils.PRODUCT_SKUS)
    ? storeUtils.PRODUCT_SKUS
    : ['paper-print'];
  const SELECTABLE_PRODUCTS = ['paper-print'];
  const CURRENCY = storeUtils.STORE_CURRENCY || 'EUR';
  const EMAIL_PROVIDER_PLACEHOLDER = 'REPLACE_WITH_YOUR_FORM_ID';
  const FORMSPREE_HOST = 'formspree.io';
  const FORMSUBMIT_HOST = 'formsubmit.co';

  const PRODUCT_PRESENTATION = {
    'paper-print': {
      description: 'A printed paper family tree designed for wall display and long-term keeping.',
      highlights: [
        'Choose from Classic, Ornate, or Minimal styles.',
        'Pick a paper finish and size before printing.',
        'Layout generated directly from your family tree.'
      ],
      gallery: [
        {
          src: '../images/landing/print-01.webp',
          alt: 'Classic printed family tree in a framed wall display',
          caption: 'Classic Heritage',
          objectPosition: '50% 52%'
        },
        {
          src: '../images/landing/print-02.webp',
          alt: 'Ornate printed family tree with ceremonial framing',
          caption: 'Gallery Ornate',
          objectPosition: '50% 50%'
        },
        {
          src: '../images/landing/print-03.webp',
          alt: 'Printed family tree featuring a colorful crest',
          caption: 'Crest Edition',
          objectPosition: '50% 50%'
        },
        {
          src: '../images/landing/print-04.webp',
          alt: 'Minimal printed family tree on warm paper stock',
          caption: 'Minimal Linework',
          objectPosition: '50% 50%'
        }
      ]
    }
  };

  let currentUser = null;
  let currentContext = {
    product: 'paper-print',
    source: 'dashboard',
    view: 'tree',
    treeId: '',
    treeName: ''
  };
  let selectedProduct = 'paper-print';
  let lastProductModalTrigger = null;
  let productPreviewGallery = [];
  let selectedPreviewIndex = 0;
  let ordersUnsubscribe = null;
  let ordersSubscriptionUserId = '';

  const refs = {};

  function notifyUser(message, type = 'error', options = {}) {
    if (window.AncestrioRuntime && typeof window.AncestrioRuntime.notify === 'function') {
      window.AncestrioRuntime.notify(message, type, options);
      return;
    }
    if (type === 'error') {
      console.error(message);
    } else {
      console.warn(message);
    }
  }

  function sanitizeProduct(value, fallback = 'paper-print') {
    if (typeof storeUtils.sanitizeProduct === 'function') {
      return storeUtils.sanitizeProduct(value, fallback);
    }
    const normalized = String(value || '').trim().toLowerCase();
    return PRODUCT_SKUS.includes(normalized) ? normalized : fallback;
  }

  function normalizeSelectableProduct(value, fallback = 'paper-print') {
    const normalized = sanitizeProduct(value, fallback);
    return SELECTABLE_PRODUCTS.includes(normalized) ? normalized : fallback;
  }

  function sanitizeSource(value, fallback = 'dashboard') {
    if (typeof storeUtils.sanitizeSource === 'function') {
      return storeUtils.sanitizeSource(value, fallback);
    }
    const allowed = ['landing', 'dashboard', 'tree', 'demo-tree'];
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function sanitizeView(value, fallback = 'tree') {
    if (typeof storeUtils.sanitizeView === 'function') {
      return storeUtils.sanitizeView(value, fallback);
    }
    const allowed = ['tree', 'calendar', 'globe'];
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function sanitizeText(value, maxLength = 140) {
    if (typeof storeUtils.sanitizeText === 'function') {
      return storeUtils.sanitizeText(value, maxLength);
    }
    const cleaned = String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.slice(0, Math.max(0, maxLength));
  }

  function sanitizeTreeId(value) {
    if (typeof storeUtils.sanitizeTreeId === 'function') {
      return storeUtils.sanitizeTreeId(value);
    }
    return sanitizeText(value, 120).replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function sanitizePhoneNumber(value) {
    return sanitizeText(value, 32).replace(/[^\d+\-().\s]/g, '');
  }

  function isValidPhoneNumber(value) {
    const digits = sanitizePhoneNumber(value).replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  function isLikelyEmailAddress(value) {
    const safeValue = sanitizeText(value, 180);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeValue);
  }

  function getFormsubmitEndpointMode(url) {
    if (!(url instanceof URL) || url.host !== FORMSUBMIT_HOST) return '';
    const segments = url.pathname.split('/').filter(Boolean).map((part) => sanitizeText(part, 160));
    if (segments.length === 2 && segments[0] === 'el' && /^[a-zA-Z0-9_-]+$/.test(segments[1])) {
      return 'email-link';
    }
    if (segments.length === 2 && segments[0] === 'ajax') {
      const target = decodeURIComponent(segments[1]);
      return isLikelyEmailAddress(target) || /^[a-zA-Z0-9_-]+$/.test(target) ? 'ajax' : '';
    }
    if (segments.length === 1) {
      const target = decodeURIComponent(segments[0]);
      return isLikelyEmailAddress(target) ? 'direct-email' : '';
    }
    return '';
  }

  function toFormsubmitAjaxEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.host !== FORMSUBMIT_HOST) return endpoint;
      const mode = getFormsubmitEndpointMode(url);
      if (mode === 'direct-email') {
        const emailAddress = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '');
        const cloned = new URL(url.toString());
        cloned.pathname = `/ajax/${encodeURIComponent(emailAddress)}`;
        return cloned.toString();
      }
      return url.toString();
    } catch (_) {
      return endpoint;
    }
  }

  function sanitizeEmailEndpoint(value) {
    const raw = sanitizeText(value, 220);
    if (!raw || raw.includes(EMAIL_PROVIDER_PLACEHOLDER)) return '';

    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') {
        return '';
      }

      const isValidFormspreePath = url.host === FORMSPREE_HOST && /^\/f\/[a-zA-Z0-9]+\/?$/.test(url.pathname);
      const isValidFormsubmitPath = getFormsubmitEndpointMode(url) !== '';
      if (!isValidFormspreePath && !isValidFormsubmitPath) return '';
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  function resolveOrderEmailEndpoint() {
    const configured = refs.orderForm?.dataset?.formspreeEndpoint || '';
    return sanitizeEmailEndpoint(configured);
  }

  function getEmailProvider(endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.host === FORMSPREE_HOST) return 'formspree';
      if (url.host === FORMSUBMIT_HOST) return 'formsubmit';
      return '';
    } catch (_) {
      return '';
    }
  }

  function formatAddressLine(payload) {
    const firstLine = payload.shippingAddress2
      ? `${payload.shippingAddress1}, ${payload.shippingAddress2}`
      : payload.shippingAddress1;
    const locality = `${payload.shippingCity}, ${payload.shippingRegion} ${payload.shippingPostalCode}`;
    return `${firstLine}, ${locality}, ${payload.shippingCountry}`;
  }

  function parseContextFromQuery() {
    if (typeof storeUtils.parseStoreQuery === 'function') {
      const parsed = storeUtils.parseStoreQuery(window.location.search) || {};
      return {
        product: normalizeSelectableProduct(parsed.product, 'paper-print'),
        source: sanitizeSource(parsed.source, 'dashboard'),
        view: sanitizeView(parsed.view, 'tree'),
        treeId: sanitizeTreeId(parsed.treeId),
        treeName: sanitizeText(parsed.treeName, 160)
      };
    }

    const params = new URLSearchParams(window.location.search);
    return {
      product: normalizeSelectableProduct(params.get('product'), 'paper-print'),
      source: sanitizeSource(params.get('source')),
      view: sanitizeView(params.get('view')),
      treeId: sanitizeTreeId(params.get('treeId')),
      treeName: sanitizeText(params.get('treeName'), 160)
    };
  }

  function getProductBySku(sku) {
    if (typeof storeUtils.getProductBySku === 'function') {
      const product = storeUtils.getProductBySku(normalizeSelectableProduct(sku, 'paper-print'));
      if (product && SELECTABLE_PRODUCTS.includes(sanitizeProduct(product.sku, ''))) {
        return product;
      }
    }

    const fallbackProducts = {
      'paper-print': { sku: 'paper-print', label: 'Printed Paper Family Tree', shortLabel: 'Paper Print', price: 69 }
    };
    return fallbackProducts[normalizeSelectableProduct(sku, 'paper-print')];
  }

  function getProductPresentation(sku) {
    const safeSku = normalizeSelectableProduct(sku, 'paper-print');
    return PRODUCT_PRESENTATION[safeSku] || PRODUCT_PRESENTATION['paper-print'];
  }

  function getProductPricing(sku, quantity) {
    const safeSku = normalizeSelectableProduct(sku, 'paper-print');
    if (typeof storeUtils.getProductPricing === 'function') {
      return storeUtils.getProductPricing(safeSku, quantity);
    }

    const safeQuantity = Math.max(1, Math.min(999, Math.floor(Number(quantity) || 1)));
    const product = getProductBySku(safeSku);
    const subtotal = product.price * safeQuantity;
    return {
      sku: product.sku,
      quantity: safeQuantity,
      unitPrice: product.price,
      subtotal,
      discountPercent: 0,
      discountAmount: 0,
      total: subtotal
    };
  }

  function formatCurrency(value) {
    if (typeof storeUtils.formatCurrency === 'function') {
      return storeUtils.formatCurrency(value, CURRENCY);
    }
    const amount = Number(value) || 0;
    return `${amount.toFixed(2)} ${CURRENCY}`;
  }

  function isAllowedPrintStyle(style) {
    if (typeof storeUtils.isAllowedPrintStyle === 'function') {
      return storeUtils.isAllowedPrintStyle(style);
    }
    return ['Classic', 'Ornate', 'Minimal'].includes(sanitizeText(style, 32));
  }

  function isAllowedPaperFinish(finish) {
    if (typeof storeUtils.isAllowedPaperFinish === 'function') {
      return storeUtils.isAllowedPaperFinish(finish);
    }
    return ['Matte', 'Satin', 'Gloss'].includes(sanitizeText(finish, 32));
  }

  function isAllowedPrintSize(size) {
    if (typeof storeUtils.isAllowedPrintSize === 'function') {
      return storeUtils.isAllowedPrintSize(size);
    }
    return ['A3', 'A2', 'Custom'].includes(sanitizeText(size, 32));
  }

  function buildStoreUrl(overrides = {}) {
    const payload = {
      ...currentContext,
      ...overrides,
      product: normalizeSelectableProduct(overrides.product || selectedProduct, 'paper-print')
    };

    if (typeof storeUtils.buildStoreUrl === 'function') {
      return storeUtils.buildStoreUrl(payload, { path: 'store.html' });
    }

    const params = new URLSearchParams();
    params.set('product', normalizeSelectableProduct(payload.product, 'paper-print'));
    params.set('source', sanitizeSource(payload.source));
    params.set('view', sanitizeView(payload.view));
    if (payload.treeId) params.set('treeId', sanitizeTreeId(payload.treeId));
    if (payload.treeName) params.set('treeName', sanitizeText(payload.treeName, 160));
    return `store.html?${params.toString()}`;
  }

  function buildAuthNextTarget() {
    return buildStoreUrl({ product: selectedProduct });
  }

  function buildAuthLoginHref() {
    const nextTarget = buildAuthNextTarget();
    return `auth.html?next=${encodeURIComponent(nextTarget)}`;
  }

  function resolveBackHref() {
    const source = sanitizeSource(currentContext.source, 'dashboard');
    if (source === 'landing') {
      return '../index.html';
    }
    if (source === 'demo-tree') {
      return 'demo-tree.html';
    }
    if (source === 'tree') {
      const treeId = sanitizeTreeId(currentContext.treeId);
      if (treeId) {
        return `tree.html?id=${encodeURIComponent(treeId)}`;
      }
      return 'tree.html';
    }
    return 'dashboard.html';
  }

  function setCatalogPrices() {
    document.querySelectorAll('[data-price]').forEach((priceEl) => {
      const sku = normalizeSelectableProduct(priceEl.dataset.price, '');
      if (!sku) return;
      const product = getProductBySku(sku);
      priceEl.textContent = formatCurrency(product.price);
    });
  }

  function syncSelectedProductCards() {
    document.querySelectorAll('.store-product-card[data-product]').forEach((card) => {
      const cardSku = normalizeSelectableProduct(card.dataset.product, '');
      card.classList.toggle('is-selected', cardSku === selectedProduct);
    });
  }

  function updatePrintStyleVisibility() {
    if (!refs.printStyleGroup) return;
    refs.printStyleGroup.style.display = 'block';
  }

  function updateSelectedProductSummary() {
    if (!refs.selectedProductSummary) return;
    const product = getProductBySku(selectedProduct);
    const hasStyleSelector = refs.printStyle instanceof HTMLSelectElement;
    refs.selectedProductSummary.textContent = hasStyleSelector
      ? `${product.label}: choose your style, finish, and size before submitting.`
      : `${product.label}: confirm your details and submit your order.`;
  }

  function readQuantity() {
    const quantity = Math.floor(Number(refs.orderQuantity?.value) || 1);
    return Math.max(1, Math.min(999, quantity));
  }

  function updatePriceSummary() {
    const pricing = getProductPricing(selectedProduct, readQuantity());
    if (refs.orderQuantity && Number(refs.orderQuantity.value) !== pricing.quantity) {
      refs.orderQuantity.value = String(pricing.quantity);
    }

    if (refs.summaryUnitPrice) refs.summaryUnitPrice.textContent = formatCurrency(pricing.unitPrice);
    if (refs.summarySubtotal) refs.summarySubtotal.textContent = formatCurrency(pricing.subtotal);
    if (refs.summaryDiscount) refs.summaryDiscount.textContent = `-${formatCurrency(pricing.discountAmount)}`;
    if (refs.summaryTotal) refs.summaryTotal.textContent = formatCurrency(pricing.total);
    if (refs.summaryDiscountRow) {
      refs.summaryDiscountRow.style.display = pricing.discountAmount > 0 ? 'flex' : 'none';
    }
  }

  function updateContextText() {
    if (!refs.orderContextText) return;
    const lines = [];

    const sourceLabelMap = {
      landing: 'Landing',
      dashboard: 'Dashboard',
      tree: 'Tree Viewer',
      'demo-tree': 'Demo Tree'
    };
    const sourceLabel = sourceLabelMap[currentContext.source] || 'Dashboard';
    lines.push(`Source: ${sourceLabel}`);

    if (currentContext.view) {
      lines.push(`View: ${currentContext.view}`);
    }
    if (currentContext.treeName) {
      lines.push(`Tree: ${currentContext.treeName}`);
    } else if (currentContext.treeId) {
      lines.push(`Tree ID: ${currentContext.treeId}`);
    }

    refs.orderContextText.textContent = lines.join(' | ');
  }

  function updateLoginLink() {
    if (refs.orderLoginLink) {
      refs.orderLoginLink.href = buildAuthLoginHref();
    }
    if (refs.storeOrdersLoginLink) {
      refs.storeOrdersLoginLink.href = buildAuthLoginHref();
    }
  }

  function stopOrdersSubscription() {
    if (typeof ordersUnsubscribe === 'function') {
      ordersUnsubscribe();
    }
    ordersUnsubscribe = null;
    ordersSubscriptionUserId = '';
  }

  function normalizeOrderStatus(value) {
    const normalized = sanitizeText(value, 32).toLowerCase().replace(/[\s_]+/g, '-');
    if (normalized === 'in-progress' || normalized === 'inprogress') {
      return 'processing';
    }
    if (normalized === 'canceled') {
      return 'cancelled';
    }
    if (['new', 'processing', 'shipped', 'delivered', 'cancelled'].includes(normalized)) {
      return normalized;
    }
    return 'new';
  }

  function getOrderStatusMeta(status) {
    const safeStatus = normalizeOrderStatus(status);
    const statusMap = {
      new: { label: 'New', className: 'is-new' },
      processing: { label: 'Processing', className: 'is-processing' },
      shipped: { label: 'Shipped', className: 'is-shipped' },
      delivered: { label: 'Delivered', className: 'is-delivered' },
      cancelled: { label: 'Cancelled', className: 'is-cancelled' }
    };
    return statusMap[safeStatus] || statusMap.new;
  }

  function getTimestampMillis(value) {
    if (!value) return 0;
    try {
      if (typeof value.toDate === 'function') {
        const dateValue = value.toDate();
        return dateValue instanceof Date ? dateValue.getTime() : 0;
      }
      if (value instanceof Date) {
        return value.getTime();
      }
      if (typeof value === 'object' && typeof value.seconds === 'number') {
        return value.seconds * 1000;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    } catch (_) {
      return 0;
    }
  }

  function formatOrderDate(value) {
    const timestamp = getTimestampMillis(value);
    if (!timestamp) return 'Pending confirmation';
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(new Date(timestamp));
    } catch (_) {
      return 'Pending confirmation';
    }
  }

  function formatOrderTotal(value, currency) {
    const amount = Number(value);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const safeCurrency = sanitizeText(currency, 3).toUpperCase();
    if (/^[A-Z]{3}$/.test(safeCurrency)) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: safeCurrency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(safeAmount);
      } catch (_) {
        return formatCurrency(safeAmount);
      }
    }
    return formatCurrency(safeAmount);
  }

  function setOrdersEmptyState(message, options = {}) {
    if (refs.storeOrdersList) {
      refs.storeOrdersList.innerHTML = '';
    }
    if (refs.storeOrdersEmpty) {
      refs.storeOrdersEmpty.textContent = sanitizeText(message, 260);
      refs.storeOrdersEmpty.style.display = message ? 'block' : 'none';
    }
    if (refs.storeOrdersLoginLink) {
      refs.storeOrdersLoginLink.style.display = options.showLogin ? 'inline-flex' : 'none';
    }
  }

  function renderOrdersList(orders) {
    if (!refs.storeOrdersList || !refs.storeOrdersEmpty) return;
    refs.storeOrdersList.innerHTML = '';

    if (!Array.isArray(orders) || !orders.length) {
      setOrdersEmptyState('No orders yet. Place your first order above.');
      return;
    }

    refs.storeOrdersEmpty.textContent = '';
    refs.storeOrdersEmpty.style.display = 'none';
    if (refs.storeOrdersLoginLink) {
      refs.storeOrdersLoginLink.style.display = 'none';
    }

    orders.forEach((order) => {
      const item = document.createElement('li');
      item.className = 'store-orders-item';

      const head = document.createElement('div');
      head.className = 'store-orders-item-head';

      const titleWrap = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'store-orders-item-title';
      title.textContent = `${sanitizeText(order.productLabel, 120)} x${order.quantity}`;
      titleWrap.appendChild(title);

      const statusMeta = getOrderStatusMeta(order.status);
      const statusPill = document.createElement('span');
      statusPill.className = `store-order-status-pill ${statusMeta.className}`;
      statusPill.textContent = statusMeta.label;

      head.appendChild(titleWrap);
      head.appendChild(statusPill);

      const shortId = sanitizeText(order.id, 80).slice(0, 8);
      const meta = document.createElement('p');
      meta.className = 'store-orders-item-meta';
      meta.textContent = shortId
        ? `Order #${shortId} | ${formatOrderDate(order.createdAt)}`
        : `Placed ${formatOrderDate(order.createdAt)}`;

      const total = document.createElement('p');
      total.className = 'store-orders-item-total';
      total.textContent = `Total: ${formatOrderTotal(order.total, order.currency)}`;

      item.appendChild(head);
      item.appendChild(meta);
      item.appendChild(total);
      refs.storeOrdersList.appendChild(item);
    });
  }

  function subscribeToSignedInOrders() {
    if (!currentUser) return;

    const userId = sanitizeText(currentUser.uid || '', 120);
    if (!userId) {
      setOrdersEmptyState('Could not resolve your account for order tracking.');
      return;
    }

    if (ordersUnsubscribe && ordersSubscriptionUserId === userId) {
      return;
    }

    stopOrdersSubscription();

    if (typeof db === 'undefined' || !db || typeof firebase === 'undefined' || !firebase.firestore) {
      setOrdersEmptyState('Order tracking is unavailable right now. Please refresh and try again.');
      return;
    }

    ordersSubscriptionUserId = userId;
    setOrdersEmptyState('Loading your orders...');

    try {
      ordersUnsubscribe = db
        .collection('storeOrders')
        .where('userId', '==', userId)
        .onSnapshot(
          (snapshot) => {
            const orders = snapshot.docs
              .map((doc) => {
                const data = doc.data() || {};
                return {
                  id: doc.id || '',
                  productLabel: sanitizeText(data.productLabel || 'Store order', 120),
                  quantity: Math.max(1, Math.min(999, Math.floor(Number(data.quantity) || 1))),
                  total: Number(data.total) || 0,
                  currency: sanitizeText(data.currency || CURRENCY, 3).toUpperCase() || CURRENCY,
                  status: normalizeOrderStatus(data.status),
                  createdAt: data.createdAt || data.updatedAt || null,
                  createdAtMillis: getTimestampMillis(data.createdAt || data.updatedAt || null)
                };
              })
              .sort((left, right) => right.createdAtMillis - left.createdAtMillis);

            renderOrdersList(orders);
          },
          (error) => {
            console.error('Failed to load account orders:', error);
            setOrdersEmptyState('Could not load your order history right now. Please try again later.');
          }
        );
    } catch (error) {
      console.error('Failed to subscribe to account orders:', error);
      setOrdersEmptyState('Could not start order tracking. Please refresh and try again.');
    }
  }

  function syncOrdersWithAuth() {
    if (!refs.storeOrdersPanel) return;

    if (!currentUser) {
      stopOrdersSubscription();
      if (refs.storeOrdersSubtitle) {
        refs.storeOrdersSubtitle.textContent = 'Sign in to view orders saved in your account and track their status.';
      }
      setOrdersEmptyState('Sign in to view your order history.', { showLogin: true });
      return;
    }

    if (refs.storeOrdersSubtitle) {
      const identity = sanitizeText(currentUser.email || currentUser.displayName || 'your account', 120);
      refs.storeOrdersSubtitle.textContent = `Tracking orders for ${identity}.`;
    }
    subscribeToSignedInOrders();
  }

  function updateAuthUI() {
    if (refs.orderLoginRequired) {
      refs.orderLoginRequired.style.display = currentUser ? 'none' : 'block';
    }
    if (refs.orderAuthState) {
      refs.orderAuthState.textContent = currentUser
        ? `Signed in as ${sanitizeText(currentUser.email || currentUser.displayName || 'user', 120)}`
        : 'Not signed in. You can still submit your order; sign in to auto-fill account details.';
    }
  }

  function prefillContactFromUser() {
    if (!currentUser) return;

    if (refs.contactName && !sanitizeText(refs.contactName.value, 120)) {
      refs.contactName.value = sanitizeText(currentUser.displayName || '', 120);
    }
    if (refs.contactEmail && !sanitizeText(refs.contactEmail.value, 160)) {
      refs.contactEmail.value = sanitizeText(currentUser.email || '', 160);
    }
    if (refs.contactPhone && !sanitizeText(refs.contactPhone.value, 32)) {
      refs.contactPhone.value = sanitizePhoneNumber(currentUser.phoneNumber || '');
    }
  }

  function setSelectedProduct(nextProduct, options = {}) {
    const safeProduct = normalizeSelectableProduct(nextProduct, 'paper-print');
    const shouldSyncSelect = options.syncSelect !== false;
    const shouldUpdateUrl = options.updateUrl !== false;
    selectedProduct = safeProduct;

    if (shouldSyncSelect && refs.orderProduct) {
      refs.orderProduct.value = safeProduct;
    }

    syncSelectedProductCards();
    updatePrintStyleVisibility();
    updateSelectedProductSummary();
    updatePriceSummary();

    if (shouldUpdateUrl) {
      const nextUrl = buildStoreUrl({ product: safeProduct });
      const absoluteUrl = new URL(nextUrl, window.location.href);
      window.history.replaceState({}, '', `${absoluteUrl.pathname}${absoluteUrl.search}`);
    }
  }

  function isProductModalOpen() {
    return !!(refs.storeProductModal && refs.storeProductModal.classList.contains('open'));
  }

  function focusOrderPageStart() {
    if (refs.printStyle instanceof HTMLElement) {
      refs.printStyle.focus();
      return;
    }
    refs.contactName?.focus();
  }

  function setActiveModalPage(nextPage, options = {}) {
    const page = nextPage === 'order' ? 'order' : 'preview';
    const previewActive = page === 'preview';

    if (refs.storeProductDialog) {
      refs.storeProductDialog.dataset.page = page;
      refs.storeProductDialog.setAttribute('aria-labelledby', previewActive ? 'productPreviewHeading' : 'orderHeading');
    }
    if (refs.storePreviewPage) {
      refs.storePreviewPage.classList.toggle('is-active', previewActive);
      refs.storePreviewPage.setAttribute('aria-hidden', previewActive ? 'false' : 'true');
    }
    if (refs.storeOrderPage) {
      refs.storeOrderPage.classList.toggle('is-active', !previewActive);
      refs.storeOrderPage.setAttribute('aria-hidden', previewActive ? 'true' : 'false');
    }

    if (previewActive) {
      syncProductModalWidth();
    }

    if (options.manageFocus === false) return;

    window.setTimeout(() => {
      if (previewActive) {
        resetPreviewScroll();
        refs.closeStoreProductModal?.focus();
        return;
      }
      focusOrderPageStart();
    }, 30);
  }

  function updateBodyModalLock() {
    const modalOpen = isProductModalOpen();
    document.body.classList.remove('store-modal-open');
    refs.storeProductsSection?.classList.toggle('store-products-modal-open', modalOpen);

    if (!modalOpen) {
      syncStoreSectionHeight();
    }
  }

  function syncProductModalWidth() {
    if (!refs.storeProductDialog || !refs.storeProductsSection) return;
    const sectionWidth = Math.round(refs.storeProductsSection.getBoundingClientRect().width || 0);
    if (sectionWidth > 0) {
      refs.storeProductDialog.style.setProperty('--store-products-width', `${sectionWidth}px`);
    }
  }

  function resetPreviewScroll() {
    const previewPane = refs.storePreviewPage?.querySelector('.store-product-preview');
    if (previewPane) {
      previewPane.scrollTop = 0;
    }
  }

  function syncStoreSectionHeight() {
    if (!refs.storeProductsSection) return;
    if (refs.storeProductsSection.classList.contains('store-products-modal-open')) return;

    const sectionHeight = Math.round(refs.storeProductsSection.getBoundingClientRect().height || 0);
    if (sectionHeight > 0) {
      refs.storeProductsSection.style.setProperty('--store-products-closed-height', `${sectionHeight}px`);
    }
  }

  function updatePreviewThumbState() {
    if (!refs.productPreviewThumbs) return;
    refs.productPreviewThumbs.querySelectorAll('.store-preview-thumb').forEach((button, index) => {
      const isActive = index === selectedPreviewIndex;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updatePreviewImage() {
    const activePreview = productPreviewGallery[selectedPreviewIndex] || productPreviewGallery[0];
    if (!activePreview || !refs.productPreviewImage) return;

    refs.productPreviewImage.src = activePreview.src;
    refs.productPreviewImage.alt = activePreview.alt || 'Product preview';
    refs.productPreviewImage.style.objectPosition = activePreview.objectPosition || '50% 50%';
    if (refs.productPreviewCaption) {
      refs.productPreviewCaption.textContent = activePreview.caption || '';
    }
  }

  function selectPreviewImage(index) {
    const normalizedIndex = Number(index);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= productPreviewGallery.length) {
      return;
    }
    selectedPreviewIndex = normalizedIndex;
    updatePreviewImage();
    updatePreviewThumbState();
  }

  function renderPreviewThumbs() {
    if (!refs.productPreviewThumbs) return;

    refs.productPreviewThumbs.innerHTML = '';
    productPreviewGallery.forEach((preview, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'store-preview-thumb';
      button.setAttribute('aria-label', preview.caption || `Photo ${index + 1}`);

      const image = document.createElement('img');
      image.src = preview.src;
      image.alt = '';
      image.loading = 'lazy';
      image.style.objectPosition = preview.objectPosition || '50% 50%';

      const label = document.createElement('span');
      label.textContent = preview.caption || `Photo ${index + 1}`;

      button.appendChild(image);
      button.appendChild(label);
      button.addEventListener('click', () => selectPreviewImage(index));

      refs.productPreviewThumbs.appendChild(button);
    });

    updatePreviewThumbState();
  }

  function getFallbackGalleryForProduct(sku) {
    const product = getProductBySku(sku);
    return [
      {
        src: '../images/landing/print-01.webp',
        alt: `${product.label} preview`,
        caption: 'Preview',
        objectPosition: '50% 50%'
      }
    ];
  }

  function renderProductPreview() {
    const product = getProductBySku(selectedProduct);
    const presentation = getProductPresentation(selectedProduct);

    if (refs.productPreviewHeading) {
      refs.productPreviewHeading.textContent = product.label;
    }
    if (refs.productPreviewPrice) {
      refs.productPreviewPrice.textContent = formatCurrency(product.price);
    }
    if (refs.productPreviewDescription) {
      refs.productPreviewDescription.textContent = presentation.description || '';
    }

    if (refs.productPreviewHighlights) {
      refs.productPreviewHighlights.innerHTML = '';
      const highlights = Array.isArray(presentation.highlights) ? presentation.highlights : [];
      highlights.forEach((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        refs.productPreviewHighlights.appendChild(item);
      });
    }

    const gallery = Array.isArray(presentation.gallery) && presentation.gallery.length
      ? presentation.gallery
      : getFallbackGalleryForProduct(selectedProduct);
    productPreviewGallery = gallery.map((entry) => ({ ...entry }));
    selectedPreviewIndex = 0;
    renderPreviewThumbs();
    updatePreviewImage();
  }

  function mountStoreModalInline() {
    if (!refs.storeProductModal) return;
    const host = refs.productGrid || refs.storeProductsSection;
    if (!host) return;
    if (refs.storeProductModal.parentElement !== host) {
      host.appendChild(refs.storeProductModal);
    }
  }

  function openProductModal(product, triggerEl) {
    setSelectedProduct(product);
    renderProductPreview();
    syncStoreSectionHeight();
    syncProductModalWidth();
    setActiveModalPage('preview', { manageFocus: false });

    if (!refs.storeProductModal) return;
    if (triggerEl instanceof HTMLElement) {
      lastProductModalTrigger = triggerEl;
    }

    refs.storeProductModal.classList.add('open');
    refs.storeProductModal.setAttribute('aria-hidden', 'false');
    updateBodyModalLock();
    setActiveModalPage('preview');
  }

  function closeProductModal(options = {}) {
    if (!refs.storeProductModal || !isProductModalOpen()) return;

    refs.storeProductModal.classList.remove('open');
    refs.storeProductModal.setAttribute('aria-hidden', 'true');
    setActiveModalPage('preview', { manageFocus: false });
    updateBodyModalLock();

    if (options.restoreFocus !== false && lastProductModalTrigger instanceof HTMLElement) {
      lastProductModalTrigger.focus();
    }
  }

  function openOrderPage(product, triggerEl) {
    setSelectedProduct(product);
    renderProductPreview();
    updateLoginLink();
    updateContextText();
    updateAuthUI();
    syncStoreSectionHeight();

    if (triggerEl instanceof HTMLElement) {
      lastProductModalTrigger = triggerEl;
    }

    if (!refs.storeProductModal) return;
    refs.storeProductModal.classList.add('open');
    refs.storeProductModal.setAttribute('aria-hidden', 'false');
    setActiveModalPage('order', { manageFocus: false });
    updateBodyModalLock();
    setActiveModalPage('order');
  }

  function validateOrderForm() {
    const contactName = sanitizeText(refs.contactName?.value, 120);
    const contactEmail = sanitizeText(refs.contactEmail?.value, 160);
    const contactPhone = sanitizePhoneNumber(refs.contactPhone?.value);
    const shippingAddress1 = sanitizeText(refs.shippingAddress1?.value, 160);
    const shippingAddress2 = sanitizeText(refs.shippingAddress2?.value, 160);
    const shippingCity = sanitizeText(refs.shippingCity?.value, 80);
    const shippingRegion = sanitizeText(refs.shippingRegion?.value, 80);
    const shippingPostalCode = sanitizeText(refs.shippingPostalCode?.value, 20);
    const shippingCountry = sanitizeText(refs.shippingCountry?.value, 80);
    const note = sanitizeText(refs.orderNote?.value, 500);
    const quantity = readQuantity();
    const product = normalizeSelectableProduct(refs.orderProduct?.value, selectedProduct);
    const printStyle = sanitizeText(refs.printStyle?.value, 32);
    const paperFinish = sanitizeText(refs.paperFinish?.value, 32);
    const printSize = sanitizeText(refs.printSize?.value, 32);

    if (!contactName) {
      notifyUser('Contact name is required.', 'warning');
      refs.contactName?.focus();
      return null;
    }

    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      notifyUser('Enter a valid contact email.', 'warning');
      refs.contactEmail?.focus();
      return null;
    }

    if (!contactPhone || !isValidPhoneNumber(contactPhone)) {
      notifyUser('Enter a valid phone number.', 'warning');
      refs.contactPhone?.focus();
      return null;
    }

    if (!shippingAddress1) {
      notifyUser('Address line 1 is required.', 'warning');
      refs.shippingAddress1?.focus();
      return null;
    }

    if (!shippingCity) {
      notifyUser('City is required.', 'warning');
      refs.shippingCity?.focus();
      return null;
    }

    if (!shippingRegion) {
      notifyUser('State or province is required.', 'warning');
      refs.shippingRegion?.focus();
      return null;
    }

    if (!shippingPostalCode) {
      notifyUser('Postal code is required.', 'warning');
      refs.shippingPostalCode?.focus();
      return null;
    }

    if (!shippingCountry) {
      notifyUser('Country is required.', 'warning');
      refs.shippingCountry?.focus();
      return null;
    }

    if (!isAllowedPrintStyle(printStyle)) {
      notifyUser('Choose a valid print style.', 'warning');
      refs.printStyle?.focus();
      return null;
    }

    if (!isAllowedPaperFinish(paperFinish)) {
      notifyUser('Choose a valid paper finish.', 'warning');
      refs.paperFinish?.focus();
      return null;
    }

    if (!isAllowedPrintSize(printSize)) {
      notifyUser('Choose a valid print size.', 'warning');
      refs.printSize?.focus();
      return null;
    }

    return {
      contactName,
      contactEmail,
      contactPhone,
      shippingAddress1,
      shippingAddress2,
      shippingCity,
      shippingRegion,
      shippingPostalCode,
      shippingCountry,
      note,
      quantity,
      product,
      printStyle,
      paperFinish,
      printSize
    };
  }

  async function sendOrderEmailNotification(endpoint, order) {
    const provider = getEmailProvider(endpoint);
    if (!provider) {
      throw new Error('Unsupported email provider endpoint.');
    }

    let formsubmitMode = '';
    let requestEndpoint = endpoint;
    if (provider === 'formsubmit') {
      formsubmitMode = (() => {
        try {
          return getFormsubmitEndpointMode(new URL(endpoint));
        } catch (_) {
          return '';
        }
      })();
      if (!formsubmitMode) {
        throw new Error('Invalid FormSubmit endpoint format.');
      }
      if (formsubmitMode === 'email-link') {
        throw new Error('FormSubmit /el/... is an Email Link page and cannot be used as an automated order endpoint. Use FormSubmit /ajax/<your-email> or /<your-email-or-random-string>.');
      }
      requestEndpoint = toFormsubmitAjaxEndpoint(endpoint);
    }

    const formData = new FormData();
    const shippingAddress = formatAddressLine(order);
    const subject = `New store order: ${sanitizeText(order.productLabel, 80)} x${order.quantity}`;
    const contextLine = `Source: ${order.context.source} | View: ${order.context.view} | Tree: ${order.context.treeName || order.context.treeId || 'N/A'}`;
    const noteLine = order.note || 'No note provided';
    const styleLine = `Style: ${order.options.printStyle || 'N/A'} | Finish: ${order.options.paperFinish || 'N/A'} | Size: ${order.options.printSize || 'N/A'}`;

    const fields = {
      _subject: subject,
      _replyto: order.contactEmail,
      name: order.contactName,
      email: order.contactEmail,
      subject,
      customer_name: order.contactName,
      customer_email: order.contactEmail,
      customer_phone: order.contactPhone,
      product: order.productLabel,
      product_sku: order.productSku,
      quantity: String(order.quantity),
      print_style: order.options.printStyle || 'N/A',
      paper_finish: order.options.paperFinish || 'N/A',
      print_size: order.options.printSize || 'N/A',
      unit_price: formatCurrency(order.unitPrice),
      subtotal: formatCurrency(order.subtotal),
      discount: formatCurrency(order.discountAmount),
      total: formatCurrency(order.total),
      shipping_address: shippingAddress,
      note: noteLine,
      source: order.context.source,
      view: order.context.view,
      tree_id: order.context.treeId || 'N/A',
      tree_name: order.context.treeName || 'N/A',
      origin_path: order.context.originPath,
      message: [
        `Contact: ${order.contactName} <${order.contactEmail}>`,
        `Phone: ${order.contactPhone}`,
        `Product: ${order.productLabel}`,
        `Quantity: ${order.quantity}`,
        styleLine,
        `Total: ${formatCurrency(order.total)}`,
        `Shipping address: ${shippingAddress}`,
        `Note: ${noteLine}`,
        contextLine
      ].join('\n')
    };

    Object.entries(fields).forEach(([key, value]) => {
      const safeValue = sanitizeText(value, 700);
      if (!safeValue) return;
      formData.append(key, safeValue);
    });

    const response = await fetch(requestEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData
    });

    let parsed = null;
    let rawText = '';
    try {
      rawText = await response.text();
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      parsed = null;
    }

    if (provider === 'formsubmit') {
      const successValue = String(parsed?.success || '').toLowerCase();
      const explicitFailure = successValue && successValue !== 'true';
      const details = sanitizeText(parsed?.message || parsed?.error || rawText || '', 220);
      if (!response.ok || explicitFailure) {
        throw new Error(details || `FormSubmit error (${response.status}).`);
      }
      return {
        provider: 'formsubmit',
        mode: formsubmitMode || 'ajax',
        deliveryVerified: true
      };
    }

    if (!response.ok || (parsed && parsed.ok === false)) {
      const details = Array.isArray(parsed?.errors)
        ? parsed.errors
            .map((entry) => sanitizeText(entry?.message || entry?.field || '', 180))
            .filter(Boolean)
            .join('; ')
        : sanitizeText(parsed?.error || parsed?.message || rawText || '', 220);
      throw new Error(details || `Email service error (${response.status}).`);
    }

    return {
      provider: 'formspree',
      mode: 'api',
      deliveryVerified: true
    };
  }

  async function persistSignedInOrder(order) {
    if (!currentUser) return false;
    if (typeof db === 'undefined' || !db || typeof firebase === 'undefined' || !firebase.firestore) {
      return false;
    }

    const cloudOrder = {
      userId: sanitizeText(currentUser.uid, 120),
      userEmail: sanitizeText(currentUser.email || '', 160),
      userDisplayName: sanitizeText(currentUser.displayName || '', 120),
      contactName: order.contactName,
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      shippingAddress: { ...order.shippingAddress },
      productSku: order.productSku,
      productLabel: order.productLabel,
      currency: order.currency,
      unitPrice: Number(order.unitPrice),
      quantity: Number(order.quantity),
      subtotal: Number(order.subtotal),
      discountPercent: Number(order.discountPercent),
      discountAmount: Number(order.discountAmount),
      total: Number(order.total),
      options: { ...order.options },
      note: order.note,
      context: { ...order.context },
      status: 'new',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('storeOrders').add(cloudOrder);
    return true;
  }

  function resetOrderForm() {
    if (refs.orderNote) refs.orderNote.value = '';
    if (refs.shippingAddress2) refs.shippingAddress2.value = '';
    if (refs.orderQuantity) refs.orderQuantity.value = '1';
    if (refs.printStyle) refs.printStyle.value = 'Classic';
    if (refs.paperFinish) refs.paperFinish.value = 'Matte';
    if (refs.printSize) refs.printSize.value = 'A3';
    updatePriceSummary();
    prefillContactFromUser();
  }

  async function submitOrder(event) {
    event.preventDefault();

    const endpoint = resolveOrderEmailEndpoint();
    if (!endpoint) {
      notifyUser('Order email is not configured. Add a valid Formspree or FormSubmit endpoint in the order form settings.', 'error');
      return;
    }

    const payload = validateOrderForm();
    if (!payload) return;

    const submitBtn = refs.submitOrderBtn;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    try {
      const pricing = getProductPricing(payload.product, payload.quantity);
      const productInfo = getProductBySku(payload.product);
      const source = sanitizeSource(currentContext.source, 'dashboard');
      const view = sanitizeView(currentContext.view, 'tree');
      const treeId = sanitizeTreeId(currentContext.treeId);
      const treeName = sanitizeText(currentContext.treeName, 160);
      const options = {
        printStyle: payload.printStyle,
        paperFinish: payload.paperFinish,
        printSize: payload.printSize
      };

      const order = {
        contactName: payload.contactName,
        contactEmail: payload.contactEmail,
        contactPhone: payload.contactPhone,
        shippingAddress1: payload.shippingAddress1,
        shippingAddress2: payload.shippingAddress2,
        shippingCity: payload.shippingCity,
        shippingRegion: payload.shippingRegion,
        shippingPostalCode: payload.shippingPostalCode,
        shippingCountry: payload.shippingCountry,
        shippingAddress: {
          line1: payload.shippingAddress1,
          line2: payload.shippingAddress2,
          city: payload.shippingCity,
          region: payload.shippingRegion,
          postalCode: payload.shippingPostalCode,
          country: payload.shippingCountry
        },
        productSku: payload.product,
        productLabel: sanitizeText(productInfo.label, 120),
        currency: CURRENCY,
        unitPrice: Number(pricing.unitPrice),
        quantity: Number(pricing.quantity),
        subtotal: Number(pricing.subtotal),
        discountPercent: Number(pricing.discountPercent),
        discountAmount: Number(pricing.discountAmount),
        total: Number(pricing.total),
        options,
        note: payload.note,
        context: {
          source,
          view,
          treeId,
          treeName,
          originPath: `${window.location.pathname}${window.location.search}`
        }
      };

      const emailResult = await sendOrderEmailNotification(endpoint, order);
      const deliveryVerified = emailResult?.deliveryVerified !== false;

      let persistedInAccount = false;
      try {
        persistedInAccount = await persistSignedInOrder(order);
      } catch (dbError) {
        console.warn('Order email sent, but Firestore persistence failed:', dbError);
      }

      if (deliveryVerified) {
        notifyUser(
          persistedInAccount
            ? 'Order submitted successfully. Notification sent to our team and order saved to your account.'
            : 'Order submitted successfully. Notification sent to our team and we will contact you soon.',
          'success',
          { duration: 6200 }
        );
      } else {
        notifyUser(
          persistedInAccount
            ? 'Order submitted. FormSubmit accepted the request and your order was saved. If no email appears, check spam and complete FormSubmit activation.'
            : 'Order submitted. FormSubmit accepted the request. If no email appears, check spam and complete FormSubmit activation.',
          'warning',
          { duration: 9000 }
        );
      }

      resetOrderForm();
      closeProductModal();
    } catch (error) {
      console.error('Failed to submit store order:', error);
      const errorDetails = sanitizeText(error?.message || '', 220);
      notifyUser(
        errorDetails
          ? `Failed to submit order. ${errorDetails}`
          : 'Failed to submit order. Please verify details and try again.',
        'error'
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Order';
      }
      updateAuthUI();
    }
  }

  function initializeFirebaseAuth() {
    if (typeof initializeFirebase !== 'function') {
      currentUser = null;
      updateAuthUI();
      syncOrdersWithAuth();
      return;
    }

    const firebaseInitialized = initializeFirebase();
    if (!firebaseInitialized || typeof auth === 'undefined' || !auth) {
      currentUser = null;
      updateAuthUI();
      syncOrdersWithAuth();
      return;
    }

    auth.onAuthStateChanged(
      (user) => {
        currentUser = user || null;
        prefillContactFromUser();
        updateAuthUI();
        syncOrdersWithAuth();
      },
      (error) => {
        console.error('Order auth state error:', error);
        currentUser = null;
        updateAuthUI();
        syncOrdersWithAuth();
      }
    );
  }

  function bindProductCards() {
    document.querySelectorAll('.store-product-card[data-product]').forEach((card) => {
      const sku = normalizeSelectableProduct(card.dataset.product, '');
      if (!sku) return;

      card.addEventListener('click', (event) => {
        const actionEl = event.target instanceof Element
          ? event.target.closest('[data-product-action]')
          : null;

        if (actionEl) {
          event.preventDefault();
          openProductModal(sku, actionEl);
          return;
        }

        openProductModal(sku, card);
      });
    });
  }

  function bindModalEvents() {
    refs.closeStoreProductModal?.addEventListener('click', () => closeProductModal());
    refs.storeProductModal?.addEventListener('click', (event) => {
      if (event.target === refs.storeProductModal) {
        closeProductModal();
      }
    });

    window.addEventListener('resize', () => {
      syncStoreSectionHeight();
      if (isProductModalOpen()) {
        syncProductModalWidth();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;

      if (isProductModalOpen()) {
        event.preventDefault();
        closeProductModal();
      }
    });
  }

  function bindEvents() {
    refs.orderProduct?.addEventListener('change', (event) => {
      setSelectedProduct(event.target.value, { syncSelect: false });
      renderProductPreview();
    });
    refs.orderQuantity?.addEventListener('input', () => updatePriceSummary());
    refs.orderForm?.addEventListener('submit', submitOrder);

    refs.openOrderFromPreviewBtn?.addEventListener('click', () => {
      const trigger = lastProductModalTrigger instanceof HTMLElement
        ? lastProductModalTrigger
        : refs.openOrderFromPreviewBtn;
      openOrderPage(selectedProduct, trigger);
    });

    refs.orderPageBackBtn?.addEventListener('click', () => {
      setActiveModalPage('preview');
    });

    refs.continueShoppingBtn?.addEventListener('click', () => {
      closeProductModal();
    });

    window.addEventListener('beforeunload', stopOrdersSubscription);
  }

  function initializeRefs() {
    refs.orderForm = document.getElementById('orderForm');
    refs.orderProduct = document.getElementById('orderProduct');
    refs.printStyleGroup = document.getElementById('printStyleGroup');
    refs.printStyle = document.getElementById('printStyle');
    refs.paperFinish = document.getElementById('paperFinish');
    refs.printSize = document.getElementById('printSize');
    refs.contactName = document.getElementById('contactName');
    refs.contactEmail = document.getElementById('contactEmail');
    refs.contactPhone = document.getElementById('contactPhone');
    refs.shippingAddress1 = document.getElementById('shippingAddress1');
    refs.shippingAddress2 = document.getElementById('shippingAddress2');
    refs.shippingCity = document.getElementById('shippingCity');
    refs.shippingRegion = document.getElementById('shippingRegion');
    refs.shippingPostalCode = document.getElementById('shippingPostalCode');
    refs.shippingCountry = document.getElementById('shippingCountry');
    refs.orderQuantity = document.getElementById('orderQuantity');
    refs.orderNote = document.getElementById('orderNote');
    refs.orderContextText = document.getElementById('orderContextText');
    refs.orderAuthState = document.getElementById('orderAuthState');
    refs.orderLoginRequired = document.getElementById('orderLoginRequired');
    refs.orderLoginLink = document.getElementById('orderLoginLink');
    refs.summaryUnitPrice = document.getElementById('summaryUnitPrice');
    refs.summarySubtotal = document.getElementById('summarySubtotal');
    refs.summaryDiscountRow = document.getElementById('summaryDiscountRow');
    refs.summaryDiscount = document.getElementById('summaryDiscount');
    refs.summaryTotal = document.getElementById('summaryTotal');
    refs.submitOrderBtn = document.getElementById('submitOrderBtn');
    refs.storeBackBtn = document.getElementById('storeBackBtn');
    refs.storeOrdersPanel = document.getElementById('storeOrdersPanel');
    refs.storeOrdersSubtitle = document.getElementById('storeOrdersSubtitle');
    refs.storeOrdersEmpty = document.getElementById('storeOrdersEmpty');
    refs.storeOrdersLoginLink = document.getElementById('storeOrdersLoginLink');
    refs.storeOrdersList = document.getElementById('storeOrdersList');

    refs.storeProductModal = document.getElementById('storeProductModal');
    refs.storeProductDialog = document.getElementById('storeProductDialog');
    refs.storePreviewPage = document.getElementById('storePreviewPage');
    refs.storeOrderPage = document.getElementById('storeOrderPage');
    refs.closeStoreProductModal = document.getElementById('closeStoreProductModal');
    refs.productPreviewImage = document.getElementById('productPreviewImage');
    refs.productPreviewCaption = document.getElementById('productPreviewCaption');
    refs.productPreviewThumbs = document.getElementById('productPreviewThumbs');
    refs.productPreviewHeading = document.getElementById('productPreviewHeading');
    refs.productPreviewPrice = document.getElementById('productPreviewPrice');
    refs.productPreviewDescription = document.getElementById('productPreviewDescription');
    refs.productPreviewHighlights = document.getElementById('productPreviewHighlights');
    refs.openOrderFromPreviewBtn = document.getElementById('openOrderFromPreviewBtn');
    refs.continueShoppingBtn = document.getElementById('continueShoppingBtn');
    refs.orderPageBackBtn = document.getElementById('orderPageBackBtn');
    refs.selectedProductSummary = document.getElementById('selectedProductSummary');

    refs.productGrid = document.getElementById('productGrid');
    refs.storeProductsSection = document.querySelector('.store-products');
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.AncestrioTheme?.initThemeToggle();
    initializeRefs();
    mountStoreModalInline();
    setCatalogPrices();

    currentContext = parseContextFromQuery();
    selectedProduct = normalizeSelectableProduct(currentContext.product, 'paper-print');
    bindProductCards();
    bindModalEvents();
    bindEvents();
    updateLoginLink();
    syncOrdersWithAuth();
    updateContextText();
    setSelectedProduct(selectedProduct, { updateUrl: false });
    renderProductPreview();
    setActiveModalPage('preview', { manageFocus: false });
    syncStoreSectionHeight();
    syncProductModalWidth();
    if (refs.storeBackBtn) {
      refs.storeBackBtn.href = resolveBackHref();
    }
    initializeFirebaseAuth();
  });
})();

/*
  Print preview controller for the store page.
  Shows an embedded preview of the user's family tree styled as a print,
  loaded in a lightweight iframe from the tree viewer page with a
  ?printPreview=1 query flag that triggers a clean, chrome-free render.
*/

(function (global) {
  'use strict';

  var PREVIEW_PATH = 'tree.html';
  var DEMO_PREVIEW_PATH = 'demo-tree.html';

  function sanitizeText(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }

  /**
   * Build the preview URL. If we have a treeId, use tree.html?id=X&printPreview=1.
   * If no treeId, fall back to demo-tree.html?printPreview=1.
   */
  function buildPreviewUrl(treeId, printStyle) {
    var id = sanitizeText(treeId, 120).replace(/[^a-zA-Z0-9_-]/g, '');
    var base = id ? PREVIEW_PATH : DEMO_PREVIEW_PATH;
    var params = new URLSearchParams();
    if (id) params.set('id', id);
    params.set('printPreview', '1');
    if (printStyle) params.set('printStyle', sanitizeText(printStyle, 32));
    return base + '?' + params.toString();
  }

  /**
   * Create and manage the print preview modal.
   */
  function createPrintPreviewController(options) {
    var opts = options || {};
    var getTreeId = typeof opts.getTreeId === 'function' ? opts.getTreeId : function () { return ''; };
    var getPrintStyle = typeof opts.getPrintStyle === 'function' ? opts.getPrintStyle : function () { return 'Classic'; };

    // Build modal DOM
    var overlay = document.createElement('div');
    overlay.className = 'print-preview-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Print preview');
    overlay.hidden = true;

    var dialog = document.createElement('div');
    dialog.className = 'print-preview-dialog';

    var header = document.createElement('div');
    header.className = 'print-preview-header';

    var title = document.createElement('h3');
    title.className = 'print-preview-title';
    title.textContent = 'Print Preview';

    var styleLabel = document.createElement('span');
    styleLabel.className = 'print-preview-style-label';
    styleLabel.id = 'printPreviewStyleLabel';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close print-preview-close';
    closeBtn.setAttribute('aria-label', 'Close preview');
    closeBtn.innerHTML = '&times;';

    header.appendChild(title);
    header.appendChild(styleLabel);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'print-preview-body';

    var frame = document.createElement('div');
    frame.className = 'print-preview-frame';

    var paperWrap = document.createElement('div');
    paperWrap.className = 'print-preview-paper';

    var iframe = document.createElement('iframe');
    iframe.className = 'print-preview-iframe';
    iframe.setAttribute('title', 'Family tree print preview');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

    var loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'print-preview-loading';
    loadingIndicator.textContent = 'Loading preview...';

    paperWrap.appendChild(iframe);
    paperWrap.appendChild(loadingIndicator);
    frame.appendChild(paperWrap);
    body.appendChild(frame);

    var hint = document.createElement('p');
    hint.className = 'print-preview-hint';
    hint.textContent = 'This is an approximate preview. Final print layout is refined during the proof stage.';
    body.appendChild(hint);

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function open() {
      var style = getPrintStyle();
      var treeId = getTreeId();
      var url = buildPreviewUrl(treeId, style);

      styleLabel.textContent = 'Style: ' + (style || 'Classic');
      iframe.src = url;
      loadingIndicator.hidden = false;
      overlay.hidden = false;
      document.body.classList.add('print-preview-open');

      iframe.onload = function () {
        loadingIndicator.hidden = true;
        // Inject print-preview specific styles into iframe
        try {
          var iDoc = iframe.contentDocument || iframe.contentWindow.document;
          if (iDoc) {
            var style = iDoc.createElement('style');
            style.textContent = [
              '.topbar, .tw-toggle, #searchBar, .birthday-bar, .viewer-command-dock, .viewer-context-rail, .viewer-stage-intro,',
              '.help-modal, .modal, .share-modal,',
              '#upcomingContainer, .cookie-buddy, noscript,',
              '[data-bmc-btn], .bmc-btn-container { display: none !important; }',
              'body { background: #fff !important; overflow: hidden !important; }',
              'svg#tree { background: transparent !important; }',
              '.page, .canvas-wrap { margin: 0 !important; padding: 0 !important; }',
              '.page { height: 100vh !important; }'
            ].join('\n');
            iDoc.head.appendChild(style);
          }
        } catch (_) {
          // Cross-origin restrictions — preview still works, just with chrome
        }
      };

      closeBtn.focus();
    }

    function close() {
      overlay.hidden = true;
      document.body.classList.remove('print-preview-open');
      iframe.src = 'about:blank';
    }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });

    return { open: open, close: close, element: overlay };
  }

  // No auto-init — the preview button was removed.
  // The modal controller and buildPreviewUrl are still exported for
  // programmatic use from store.js.

  global.AncestrioPrintPreview = {
    createPrintPreviewController: createPrintPreviewController,
    buildPreviewUrl: buildPreviewUrl
  };
})(window);

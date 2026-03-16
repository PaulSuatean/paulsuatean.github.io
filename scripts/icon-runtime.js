(function (global) {
  if (!global || !global.document || global.AncestrioIcons) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const VIEW_BOX = '0 -960 960 960';

  function sanitizeIconName(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/gi, '');
  }

  function iconSymbolId(iconName) {
    return `icon-${iconName}`;
  }

  function copyAttributes(source, target) {
    const attributes = source && source.attributes ? Array.from(source.attributes) : [];
    attributes.forEach((attribute) => {
      target.setAttribute(attribute.name, attribute.value);
    });
  }

  function ensureUseElement(svg, iconName) {
    let use = svg.querySelector('use');
    if (!use) {
      use = document.createElementNS(SVG_NS, 'use');
      svg.appendChild(use);
    }

    const hrefValue = `#${iconSymbolId(iconName)}`;
    use.setAttribute('href', hrefValue);
    use.setAttributeNS(XLINK_NS, 'xlink:href', hrefValue);
    return use;
  }

  function createIconSvg(iconName, template) {
    const safeIconName = sanitizeIconName(iconName);
    if (!safeIconName) return null;

    const svg = document.createElementNS(SVG_NS, 'svg');
    if (template) {
      copyAttributes(template, svg);
    } else {
      svg.setAttribute('class', 'material-symbols-outlined');
      svg.setAttribute('aria-hidden', 'true');
    }

    svg.setAttribute('viewBox', svg.getAttribute('viewBox') || VIEW_BOX);
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-icon-name', safeIconName);
    ensureUseElement(svg, safeIconName);
    return svg;
  }

  function extractIconName(node) {
    if (!node) return '';
    const explicit = sanitizeIconName(node.getAttribute('data-icon-name'));
    if (explicit) return explicit;
    return sanitizeIconName(node.textContent || '');
  }

  function hydrateNode(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.namespaceURI === SVG_NS && node.classList.contains('material-symbols-outlined')) {
      const iconName = extractIconName(node);
      if (iconName) {
        node.setAttribute('data-icon-name', iconName);
        node.setAttribute('viewBox', node.getAttribute('viewBox') || VIEW_BOX);
        node.setAttribute('focusable', 'false');
        ensureUseElement(node, iconName);
      }
      return node;
    }
    if (!(node instanceof Element) || !node.matches('span.material-symbols-outlined')) {
      return null;
    }

    const iconName = extractIconName(node);
    if (!iconName) return null;

    const svg = createIconSvg(iconName, node);
    if (!svg) return null;
    node.replaceWith(svg);
    return svg;
  }

  function hydrateSubtree(root) {
    if (!root || root.nodeType !== 1) return;
    hydrateNode(root);
    root.querySelectorAll('span.material-symbols-outlined').forEach(hydrateNode);
  }

  function setIcon(target, iconName) {
    const safeIconName = sanitizeIconName(iconName);
    if (!target || !safeIconName) return null;

    if (target instanceof Element && target.classList.contains('material-symbols-outlined')) {
      if (target.namespaceURI === SVG_NS) {
        target.setAttribute('data-icon-name', safeIconName);
        ensureUseElement(target, safeIconName);
        return target;
      }

      target.textContent = safeIconName;
      return hydrateNode(target);
    }

    if (target instanceof Element) {
      const iconEl = target.querySelector('.material-symbols-outlined');
      if (iconEl) {
        return setIcon(iconEl, safeIconName);
      }
    }

    return null;
  }

  function observeMutations() {
    if (!global.MutationObserver || !document.body) return;

    const observer = new MutationObserver((entries) => {
      entries.forEach((entry) => {
        entry.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          hydrateSubtree(node);
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    if (document.body) {
      hydrateSubtree(document.body);
      observeMutations();
      return;
    }

    document.addEventListener('DOMContentLoaded', () => {
      hydrateSubtree(document.body);
      observeMutations();
    }, { once: true });
  }

  global.AncestrioIcons = {
    createIconSvg,
    hydrateNode,
    hydrateSubtree,
    sanitizeIconName,
    setIcon
  };

  init();
})(window);

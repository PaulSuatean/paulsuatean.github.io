// Editor Logic

let currentUser = null;
let currentTree = null;
let treeId = null;
let hasUnsavedChanges = false;
let activeSavePromise = null;
let isLocalGuestMode = false;
let guestPersistTimeout = null;
let visualState = {
  initialized: false,
  svg: null,
  g: null,
  zoom: null,
  hasUserTransform: false,
  pendingRender: null,
  autoSeeded: false
};

// Add member state
let pendingAddMemberMeta = null;
let pendingAddRelation = null;
let pendingEditMeta = null;
let pendingDeleteMeta = null;
let visitedCountries = [];
let memberModalMode = 'add';
let memberPhotoValue = '';
const LOCAL_PREVIEW_PREFIX = 'ancestrio-preview:';
const LOCAL_PREVIEW_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const LOCAL_GUEST_TREE_KEY = 'ancestrio:guest-tree:v1';
const FIRESTORE_DOC_SOFT_LIMIT_BYTES = 900 * 1024;
const EMBEDDED_IMAGE_BUDGET_BYTES = 640 * 1024;
const MEMBER_IMAGE_MAX_BYTES = 180 * 1024;
const MEMBER_IMAGE_MAX_DIMENSION = 1200;
const MEMBER_IMAGE_MIN_DIMENSION = 260;
const THUMBNAIL_MAX_BYTES = 220 * 1024;
const IMAGE_FIELD_NAMES = new Set(['image', 'spouseImage', 'thumb', 'spouseThumb', 'thumbnailData']);

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

function getUtf8Size(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = typeof event.target?.result === 'string' ? event.target.result : '';
      resolve(result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to convert blob'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image data'));
    img.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl, options = {}) {
  if (!isImageDataUrl(dataUrl)) return dataUrl;

  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MEMBER_IMAGE_MAX_BYTES;
  if (getUtf8Size(dataUrl) <= maxBytes) return dataUrl;

  const image = await loadImageElement(dataUrl);
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const maxDimension = Number.isFinite(options.maxDimension) ? options.maxDimension : MEMBER_IMAGE_MAX_DIMENSION;
  const minDimension = Number.isFinite(options.minDimension) ? options.minDimension : MEMBER_IMAGE_MIN_DIMENSION;

  const initialScale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * initialScale));
  let height = Math.max(1, Math.round(sourceHeight * initialScale));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  const startQuality = Number.isFinite(options.startQuality) ? options.startQuality : 0.88;
  const minQuality = Number.isFinite(options.minQuality) ? options.minQuality : 0.45;
  const qualityStep = Number.isFinite(options.qualityStep) ? options.qualityStep : 0.08;
  const scaleStep = Number.isFinite(options.scaleStep) ? options.scaleStep : 0.84;
  const fillBackground = options.fillBackground !== false;

  let quality = startQuality;
  let bestCandidate = '';
  let bestSize = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    if (fillBackground) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    const candidate = canvas.toDataURL('image/jpeg', quality);
    const candidateSize = getUtf8Size(candidate);
    if (candidateSize < bestSize) {
      bestCandidate = candidate;
      bestSize = candidateSize;
    }

    if (candidateSize <= maxBytes) {
      return candidate;
    }

    if (quality > minQuality + 0.01) {
      quality = Math.max(minQuality, quality - qualityStep);
      continue;
    }

    const nextWidth = Math.round(width * scaleStep);
    const nextHeight = Math.round(height * scaleStep);
    if (nextWidth < minDimension || nextHeight < minDimension) {
      break;
    }

    width = nextWidth;
    height = nextHeight;
    quality = startQuality;
  }

  if (bestCandidate && bestSize <= Math.round(maxBytes * 1.08)) {
    return bestCandidate;
  }

  return null;
}

async function optimizeTreeImageData(root) {
  const stats = {
    scanned: 0,
    optimized: 0,
    removed: 0
  };

  async function walk(node) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        await walk(node[i]);
      }
      return;
    }

    if (typeof node !== 'object') return;

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = node[key];

      if (IMAGE_FIELD_NAMES.has(key) && isImageDataUrl(value)) {
        stats.scanned += 1;
        const compressed = await compressImageDataUrl(value, {
          maxBytes: MEMBER_IMAGE_MAX_BYTES,
          maxDimension: MEMBER_IMAGE_MAX_DIMENSION,
          minDimension: MEMBER_IMAGE_MIN_DIMENSION
        });
        if (compressed) {
          node[key] = compressed;
          if (compressed !== value) {
            stats.optimized += 1;
          }
        } else {
          node[key] = '';
          stats.removed += 1;
        }
        continue;
      }

      await walk(value);
    }
  }

  await walk(root);
  return stats;
}

function measureEmbeddedImageBytes(root) {
  let total = 0;

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;

    Object.keys(node).forEach((key) => {
      const value = node[key];
      if (IMAGE_FIELD_NAMES.has(key) && isImageDataUrl(value)) {
        total += getUtf8Size(value);
      } else {
        walk(value);
      }
    });
  }

  walk(root);
  return total;
}

function estimateFirestorePayloadSize(payload) {
  try {
    return getUtf8Size(JSON.stringify(payload));
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

function setInvalidField(input, shouldMark) {
  if (!input) return;
  input.classList.toggle('input-invalid', !!shouldMark);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Theme toggle
  window.AncestrioTheme?.initThemeToggle();
  
  const urlParams = new URLSearchParams(window.location.search);
  isLocalGuestMode = localStorage.getItem('guestMode') === 'true' || urlParams.get('guest') === '1';

  if (isLocalGuestMode) {
    localStorage.setItem('guestMode', 'true');
    configureGuestModeUI();
    loadGuestTree();
  } else {
    localStorage.removeItem('guestMode');
    if (!initializeFirebase()) {
      window.location.href = 'auth.html';
      return;
    }

    treeId = urlParams.get('id');
    if (!treeId) {
      notifyUser('No tree ID provided.', 'warning');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 300);
      return;
    }

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        await loadTree();
      } else {
        window.location.href = 'auth.html';
      }
    });
  }

  // Event listeners
  document.getElementById('saveBtn').addEventListener('click', saveTree);
  document.getElementById('viewTreeBtn').addEventListener('click', openPreview);
  document.getElementById('dashboardBtn')?.addEventListener('click', () => {
    window.location.href = isLocalGuestMode ? 'dashboard.html?guest=1' : 'dashboard.html';
  });
  
  // Sidebar actions
  document.getElementById('addPersonBtn').addEventListener('click', addFamilyMember);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
  document.getElementById('importJsonBtn').addEventListener('click', showImportModal);
  
  // Tabs
  document.querySelectorAll('.editor-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  
  // JSON toolbar
  document.getElementById('formatJsonBtn').addEventListener('click', formatJson);
  document.getElementById('validateJsonBtn').addEventListener('click', validateJson);
  
  // JSON editor - track changes
  const jsonEditor = document.getElementById('jsonEditor');
  jsonEditor.addEventListener('input', () => {
    markAsChanged();
    scheduleVisualRender(false);
  });
  
  // Tree settings - track changes
  document.getElementById('editTreeName').addEventListener('input', (event) => {
    setInvalidField(event.target, false);
    markAsChanged();
  });
  document.getElementById('editTreeDescription').addEventListener('input', markAsChanged);
  document.getElementById('editTreePrivacy').addEventListener('change', markAsChanged);
  
  // Import modal
  document.getElementById('closeImportModal').addEventListener('click', hideImportModal);
  document.getElementById('cancelImportBtn').addEventListener('click', hideImportModal);
  document.getElementById('confirmImportBtn').addEventListener('click', importJson);
  document.getElementById('fileInput').addEventListener('change', handleFileSelect);

  // Delete confirmation modal
  document.getElementById('closeDeleteModal').addEventListener('click', hideDeleteConfirmModal);
  document.getElementById('cancelDeleteBtn').addEventListener('click', hideDeleteConfirmModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', performDelete);
  
  // Close delete modal on backdrop click
  document.getElementById('deleteConfirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'deleteConfirmModal') {
      hideDeleteConfirmModal();
    }
  });

  // Add Member popup and modal
  initAddMemberUI();

  initVisualEditor();
  scheduleVisualRender(true);
  
  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
});

async function loadTree() {
  try {
    const doc = await db.collection('trees').doc(treeId).get();
    
    if (!doc.exists) {
      notifyUser('Tree not found.', 'warning');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 300);
      return;
    }
    
    currentTree = { id: doc.id, ...doc.data() };
    
    // Check ownership
    if (currentTree.userId !== currentUser.uid) {
      notifyUser('You do not have permission to edit this tree.', 'error');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 300);
      return;
    }
    
    // Populate UI
    document.getElementById('treeTitle').textContent = currentTree.name;
    document.getElementById('editTreeName').value = currentTree.name || '';
    document.getElementById('editTreeDescription').value = currentTree.description || '';
    document.getElementById('editTreePrivacy').value = currentTree.privacy || 'private';
    
    const seededData = ensureDefaultTreeData(currentTree.data);
    const didSeed = seededData !== currentTree.data;
    if (didSeed) {
      currentTree.data = seededData;
    }

    const jsonEditor = document.getElementById('jsonEditor');
    jsonEditor.value = JSON.stringify(currentTree.data || {}, null, 2);
    visualState.autoSeeded = false;

    scheduleVisualRender(true);
    
    hasUnsavedChanges = didSeed;
    updateSaveButton();
  } catch (error) {
    console.error('Error loading tree:', error);
    notifyUser('Failed to load tree. Please try again.', 'error');
  }
}

function configureGuestModeUI() {
  window.AncestrioDomDisplay.hide('saveBtn');

  const cloudInstruction = Array.from(document.querySelectorAll('.instructions-list li'))
    .find((item) => /saved to the cloud/i.test(item.textContent || ''));
  if (cloudInstruction) {
    cloudInstruction.textContent = 'Changes are saved locally in this browser';
  }

  const container = document.querySelector('.editor-container');
  if (container && !document.getElementById('guestModeNotice')) {
    const notice = document.createElement('div');
    notice.id = 'guestModeNotice';
    notice.className = 'guest-mode-notice';
    notice.innerHTML = '<strong>Guest mode:</strong> This data is stored only in this browser. <a href="auth.html">Create an account</a> to save online (email optional).';
    container.prepend(notice);
  }
}

function loadGuestTree() {
  try {
    const raw = localStorage.getItem(LOCAL_GUEST_TREE_KEY);
    let parsed = null;
    if (raw) {
      parsed = JSON.parse(raw);
    }

    const seededData = ensureDefaultTreeData(parsed && parsed.data);
    currentTree = {
      id: 'guest-local',
      name: (parsed && typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : 'Your Family Tree',
      description: (parsed && typeof parsed.description === 'string') ? parsed.description : '',
      privacy: (parsed && typeof parsed.privacy === 'string' && parsed.privacy.trim()) ? parsed.privacy : 'private',
      data: seededData
    };

    document.getElementById('treeTitle').textContent = currentTree.name;
    document.getElementById('editTreeName').value = currentTree.name;
    document.getElementById('editTreeDescription').value = currentTree.description;
    document.getElementById('editTreePrivacy').value = currentTree.privacy;

    const jsonEditor = document.getElementById('jsonEditor');
    jsonEditor.value = JSON.stringify(currentTree.data || {}, null, 2);
    visualState.autoSeeded = false;

    hasUnsavedChanges = false;
    updateSaveButton();
    scheduleVisualRender(true);
  } catch (error) {
    console.error('Error loading guest tree:', error);
    currentTree = {
      id: 'guest-local',
      name: 'Your Family Tree',
      description: '',
      privacy: 'private',
      data: ensureDefaultTreeData(null)
    };
    document.getElementById('treeTitle').textContent = currentTree.name;
    document.getElementById('editTreeName').value = currentTree.name;
    document.getElementById('editTreeDescription').value = '';
    document.getElementById('editTreePrivacy').value = 'private';
    document.getElementById('jsonEditor').value = JSON.stringify(currentTree.data || {}, null, 2);
    hasUnsavedChanges = false;
    updateSaveButton();
    scheduleVisualRender(true);
  }
}

function queueGuestPersist() {
  if (!isLocalGuestMode) return;
  if (guestPersistTimeout) {
    clearTimeout(guestPersistTimeout);
  }
  guestPersistTimeout = setTimeout(() => {
    guestPersistTimeout = null;
    persistGuestTree();
  }, 450);
}

function persistGuestTree() {
  if (!isLocalGuestMode) return false;

  try {
    const jsonText = document.getElementById('jsonEditor').value;
    const parsedData = JSON.parse(jsonText);
    const treeData = cleanupTreeData(parsedData);
    const name = document.getElementById('editTreeName').value.trim() || 'Your Family Tree';
    const description = document.getElementById('editTreeDescription').value.trim();
    const privacy = document.getElementById('editTreePrivacy').value || 'private';

    localStorage.setItem(LOCAL_GUEST_TREE_KEY, JSON.stringify({
      name,
      description,
      privacy,
      data: treeData,
      updatedAt: Date.now()
    }));

    currentTree = {
      ...(currentTree || {}),
      id: 'guest-local',
      name,
      description,
      privacy,
      data: treeData
    };

    document.getElementById('treeTitle').textContent = name;
    hasUnsavedChanges = false;
    updateSaveButton();
    return true;
  } catch (_) {
    return false;
  }
}

function markAsChanged() {
  hasUnsavedChanges = true;
  if (isLocalGuestMode) {
    queueGuestPersist();
  }
  updateSaveButton();
}

function updateSaveButton() {
  const saveBtn = document.getElementById('saveBtn');
  if (!saveBtn) return;
  if (isLocalGuestMode) {
    window.AncestrioDomDisplay.hide(saveBtn);
    return;
  }
  saveBtn.disabled = !hasUnsavedChanges;
  const span = saveBtn.querySelector('span');
  if (span && span.nextSibling) {
    span.nextSibling.textContent = hasUnsavedChanges ? ' Save Changes *' : ' Save Changes';
  }
}

function isLocalStyleSheet(styleSheet) {
  if (!styleSheet || !styleSheet.href) return true;
  try {
    return new URL(styleSheet.href, window.location.href).origin === window.location.origin;
  } catch (_) {
    return false;
  }
}

function collectExportCssRules(styleSheet, visitedSheets) {
  if (!styleSheet || visitedSheets.has(styleSheet)) return '';
  if (!isLocalStyleSheet(styleSheet)) return '';
  visitedSheets.add(styleSheet);

  let rules;
  try {
    rules = styleSheet.cssRules;
  } catch (error) {
    if (error?.name !== 'SecurityError') {
      console.warn('Failed to collect stylesheet rules for thumbnail export:', error);
    }
    return '';
  }

  if (!rules) return '';

  let cssText = '';
  Array.from(rules).forEach((rule) => {
    if (typeof CSSRule !== 'undefined' && rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
      cssText += collectExportCssRules(rule.styleSheet, visitedSheets);
      return;
    }
    cssText += `${rule.cssText}\n`;
  });

  return cssText;
}

function applyExportThemeVariables(svgNode) {
  if (!svgNode) return;

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles = window.getComputedStyle(document.body);
  const variableNames = ['--surface', '--surface-2', '--border', '--text', '--accent', '--accent-2', '--line'];

  variableNames.forEach((variableName) => {
    const value = (bodyStyles.getPropertyValue(variableName) || rootStyles.getPropertyValue(variableName) || '').trim();
    if (value) {
      svgNode.style.setProperty(variableName, value);
    }
  });
}

async function generateTreeThumbnail() {
  try {
    if (!visualState.svg || !visualState.g) {
      console.log('Visual editor not initialized, skipping thumbnail generation');
      return null;
    }
    
    // Get the SVG element
    const svgNode = visualState.svg.node();
    if (!svgNode) return null;
    
    // Get the bounding box of all content
    const bbox = visualState.g.node().getBBox();
    if (!bbox || bbox.width === 0 || bbox.height === 0) {
      console.log('Empty tree, skipping thumbnail');
      return null;
    }
    
    // Fixed thumbnail dimensions
    const thumbnailWidth = 800;
    const thumbnailHeight = 600;
    
    // Add padding around the tree content
    const padding = 100;
    const contentWidth = bbox.width + padding * 2;
    const contentHeight = bbox.height + padding * 2;
    
    // Calculate scale to fit the tree in the thumbnail while maintaining aspect ratio
    const scaleX = thumbnailWidth / contentWidth;
    const scaleY = thumbnailHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, max 1:1
    
    // Calculate centered position
    const scaledWidth = bbox.width * scale;
    const scaledHeight = bbox.height * scale;
    const offsetX = (thumbnailWidth - scaledWidth) / 2 - bbox.x * scale;
    const offsetY = (thumbnailHeight - scaledHeight) / 2 - bbox.y * scale;
    
    // Clone and prepare SVG
    const clonedSvg = svgNode.cloneNode(true);
    clonedSvg.setAttribute('width', thumbnailWidth.toString());
    clonedSvg.setAttribute('height', thumbnailHeight.toString());
    clonedSvg.setAttribute('viewBox', `0 0 ${thumbnailWidth} ${thumbnailHeight}`);
    applyExportThemeVariables(clonedSvg);
    
    // Find the g element in the clone and apply centering transform
    const clonedG = clonedSvg.querySelector('g');
    if (clonedG) {
      clonedG.setAttribute('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);
    }
    
    // Get computed styles and inline them (including @import trees)
    const styleSheets = Array.from(document.styleSheets);
    const visitedSheets = new Set();
    const cssText = styleSheets.map((sheet) => collectExportCssRules(sheet, visitedSheets)).join('\n');
    const fallbackTreeCss = [
      '#visualTree .person rect { fill: var(--surface, #0b1d33); stroke: var(--border, rgba(230, 238, 249, 0.18)); stroke-width: 2px; }',
      '#visualTree .person .name { fill: var(--text, #e6eef9); font-size: 14px; font-weight: 700; }',
      '#visualTree .link { fill: none; stroke: var(--line, #cbd5e1); stroke-width: 2.25px; }',
      '#visualTree .avatar-group > circle { fill: var(--surface-2, #132a46); stroke: var(--border, rgba(230, 238, 249, 0.18)); stroke-width: 2px; }'
    ].join('\n');
    
    // Add a style element to the cloned SVG
    const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleElement.textContent = `${fallbackTreeCss}\n${cssText}`;
    clonedSvg.insertBefore(styleElement, clonedSvg.firstChild);
    
    // Serialize the SVG
    const svgString = new XMLSerializer().serializeToString(clonedSvg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    
    // Convert to image using canvas
    return new Promise((resolve) => {
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = thumbnailWidth;
        canvas.height = thumbnailHeight;
        const ctx = canvas.getContext('2d');
        
        // Fill background with button blue
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw the image
        ctx.drawImage(img, 0, 0, thumbnailWidth, thumbnailHeight);
        
        // Convert canvas to blob
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, 'image/jpeg', 0.84);
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        console.error('Failed to load SVG image');
        resolve(null);
      };
      
      img.src = url;
    });
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    return null;
  }
}

async function saveTree() {
  if (isLocalGuestMode) {
    const saved = persistGuestTree();
    if (!saved) {
      showJsonStatus('Invalid JSON format. Please fix errors before continuing.', 'invalid');
      notifyUser('Invalid JSON format. Please fix errors before continuing.', 'warning');
      return false;
    }
    return true;
  }

  if (activeSavePromise) {
    return activeSavePromise;
  }

  activeSavePromise = (async () => {
    const saveBtn = document.getElementById('saveBtn');
    const viewTreeBtn = document.getElementById('viewTreeBtn');
    saveBtn.disabled = true;
    if (viewTreeBtn) viewTreeBtn.disabled = true;

    const span = saveBtn.querySelector('span');
    const textNode = span ? span.nextSibling : saveBtn.firstChild;
    const originalText = textNode ? textNode.textContent : saveBtn.textContent;

    if (textNode) {
      textNode.textContent = ' Saving...';
    } else {
      saveBtn.textContent = 'Saving...';
    }

    try {
      // Validate JSON
      const jsonText = document.getElementById('jsonEditor').value;
      let treeData;
      try {
        treeData = JSON.parse(jsonText);
      } catch (e) {
        showJsonStatus('Invalid JSON format. Please fix errors before saving.', 'invalid');
        notifyUser('Invalid JSON format. Please fix errors before saving.', 'warning');
        return false;
      }

      // Clean up any duplicate nodes before saving
      treeData = cleanupTreeData(treeData);
      const imageOptimization = await optimizeTreeImageData(treeData);
      if (imageOptimization.optimized > 0) {
        notifyUser(`Optimized ${imageOptimization.optimized} embedded photo(s) for faster saves.`, 'info', {
          duration: 3200
        });
      }
      if (imageOptimization.removed > 0) {
        notifyUser(
          `${imageOptimization.removed} photo(s) were removed because they exceeded safe Firestore size limits.`,
          'warning',
          { duration: 5200 }
        );
      }

      // Get updated values
      const treeNameInput = document.getElementById('editTreeName');
      const name = document.getElementById('editTreeName').value.trim();
      const description = document.getElementById('editTreeDescription').value.trim();
      const privacy = document.getElementById('editTreePrivacy').value;
      setInvalidField(treeNameInput, false);

      if (!name) {
        setInvalidField(treeNameInput, true);
        treeNameInput?.focus();
        notifyUser('Tree name is required.', 'warning');
        return false;
      }

      // Generate thumbnail as base64
      let thumbnailData = null;
      try {
        // Ensure visual editor is initialized
        if (!visualState.initialized) {
          initVisualEditor();
          // Wait a bit for initialization
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Always generate a new thumbnail on save
        if (visualState.initialized) {
          // Update the JSON editor with latest data
          const jsonEditor = document.getElementById('jsonEditor');
          jsonEditor.value = JSON.stringify(treeData, null, 2);

          // Force a synchronous render to update the visualization
          renderVisualEditor(true);

          // Wait for render to complete and DOM to update
          await new Promise(resolve => setTimeout(resolve, 150));

          // Now generate the thumbnail from the centered, rendered view
          const thumbnailBlob = await generateTreeThumbnail();
          if (thumbnailBlob) {
            const rawThumbnail = await blobToDataUrl(thumbnailBlob);
            thumbnailData = await compressImageDataUrl(rawThumbnail, {
              maxBytes: THUMBNAIL_MAX_BYTES,
              maxDimension: 800,
              minDimension: 320,
              startQuality: 0.84,
              minQuality: 0.5,
              qualityStep: 0.06,
              fillBackground: true
            });
            if (thumbnailData) {
              console.log('Thumbnail generated successfully');
            } else {
              notifyUser('Thumbnail exceeded size limits and was skipped for this save.', 'warning', {
                duration: 4600
              });
            }
          } else {
            console.log('No thumbnail blob generated - tree may be empty');
          }
        }
      } catch (thumbnailError) {
        console.error('Error generating thumbnail:', thumbnailError);
        // Continue saving even if thumbnail fails
      }

      // Save to Firestore
      const updateData = {
        name: name,
        description: description,
        privacy: privacy,
        data: treeData,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      const embeddedImageBytes = measureEmbeddedImageBytes(treeData) + (thumbnailData ? getUtf8Size(thumbnailData) : 0);
      if (embeddedImageBytes > EMBEDDED_IMAGE_BUDGET_BYTES) {
        notifyUser(
          `Embedded image data is too large (${formatBytes(embeddedImageBytes)}). Remove or shrink photos and try again.`,
          'error',
          { duration: 7000 }
        );
        return false;
      }

      // Only update thumbnailData if we have a new one
      if (thumbnailData) {
        updateData.thumbnailData = thumbnailData;
      }

      const estimatedPayloadSize = estimateFirestorePayloadSize({
        name,
        description,
        privacy,
        data: treeData,
        updatedAt: 'SERVER_TIMESTAMP',
        thumbnailData: thumbnailData || ''
      });
      if (estimatedPayloadSize > FIRESTORE_DOC_SOFT_LIMIT_BYTES) {
        notifyUser(
          `Tree payload is too large (${formatBytes(estimatedPayloadSize)} estimated). Reduce embedded photos and retry.`,
          'error',
          { duration: 7000 }
        );
        return false;
      }

      await db.collection('trees').doc(treeId).update(updateData);

      currentTree.name = name;
      currentTree.description = description;
      currentTree.privacy = privacy;
      currentTree.data = treeData;
      if (thumbnailData) {
        currentTree.thumbnailData = thumbnailData;
      }

      // Update JSON editor to reflect cleaned data
      const jsonEditor = document.getElementById('jsonEditor');
      jsonEditor.value = JSON.stringify(treeData, null, 2);

      document.getElementById('treeTitle').textContent = name;

      hasUnsavedChanges = false;
      updateSaveButton();

      // Show success message temporarily
      if (textNode) {
        textNode.textContent = ' Saved!';
        setTimeout(() => {
          textNode.textContent = originalText;
        }, 2000);
      } else {
        saveBtn.textContent = 'Saved!';
        setTimeout(() => {
          saveBtn.textContent = originalText;
        }, 2000);
      }

      return true;
    } catch (error) {
      console.error('Error saving tree:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      notifyUser('Failed to save tree: ' + (error.message || 'Please try again.'), 'error', { duration: 6500 });
      return false;
    } finally {
      updateSaveButton();
      if (viewTreeBtn) viewTreeBtn.disabled = false;
    }
  })();

  try {
    return await activeSavePromise;
  } finally {
    activeSavePromise = null;
  }
}

async function openPreview() {
  const viewTreeBtn = document.getElementById('viewTreeBtn');
  if (viewTreeBtn) viewTreeBtn.disabled = true;

  try {
    if (activeSavePromise) {
      await activeSavePromise;
    }

    const draft = buildLocalPreviewDraft();
    if (!draft) return;

    let previewKey = '';
    try {
      previewKey = storeLocalPreviewDraft(draft);
    } catch (error) {
      console.error('Failed to store local preview draft:', error);
      notifyUser('Could not open preview locally. Please try again.', 'error');
      return;
    }

    const query = new URLSearchParams();
    if (treeId) query.set('id', treeId);
    query.set('previewKey', previewKey);
    window.open(`tree.html?${query.toString()}`, '_blank', 'noopener');
  } finally {
    if (viewTreeBtn) viewTreeBtn.disabled = false;
  }
}

function buildLocalPreviewDraft() {
  const jsonEditor = document.getElementById('jsonEditor');
  if (!jsonEditor) return null;

  let treeData;
  try {
    treeData = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    showJsonStatus('Invalid JSON format. Please fix errors before preview.', 'invalid');
    notifyUser('Invalid JSON format. Please fix errors before preview.', 'warning');
    return null;
  }

  const name = document.getElementById('editTreeName')?.value.trim() || currentTree?.name || 'Family Tree';
  const description = document.getElementById('editTreeDescription')?.value.trim() || currentTree?.description || '';
  const privacy = document.getElementById('editTreePrivacy')?.value || currentTree?.privacy || 'private';

  return {
    treeId: treeId || '',
    name,
    description,
    privacy,
    data: cleanupTreeData(treeData),
    createdAt: Date.now()
  };
}

function storeLocalPreviewDraft(draft) {
  cleanupLocalPreviewDrafts();
  const idPart = treeId || 'tree';
  const nonce = Math.random().toString(36).slice(2, 10);
  const key = `${LOCAL_PREVIEW_PREFIX}${idPart}:${Date.now()}:${nonce}`;
  localStorage.setItem(key, JSON.stringify(draft));
  return key;
}

function cleanupLocalPreviewDrafts() {
  const now = Date.now();
  const keysToDelete = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LOCAL_PREVIEW_PREFIX)) continue;

    const raw = localStorage.getItem(key);
    if (!raw) {
      keysToDelete.push(key);
      continue;
    }

    try {
      const payload = JSON.parse(raw);
      const createdAt = Number(payload && payload.createdAt);
      if (!Number.isFinite(createdAt) || now - createdAt > LOCAL_PREVIEW_MAX_AGE_MS) {
        keysToDelete.push(key);
      }
    } catch (_) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach((key) => localStorage.removeItem(key));
}
function switchTab(tabName) {
  // Update tabs
  document.querySelectorAll('.editor-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  if (tabName === 'visual') {
    document.getElementById('visualTab').classList.add('active');
    scheduleVisualRender(true);
  } else if (tabName === 'json') {
    document.getElementById('jsonTab').classList.add('active');
  }
}

function formatJson() {
  const jsonEditor = document.getElementById('jsonEditor');
  try {
    const parsed = JSON.parse(jsonEditor.value);
    jsonEditor.value = JSON.stringify(parsed, null, 2);
    showJsonStatus('Formatted successfully', 'valid');
    scheduleVisualRender(false);
  } catch (e) {
    showJsonStatus('Invalid JSON - cannot format', 'invalid');
  }
}

function validateJson() {
  const jsonEditor = document.getElementById('jsonEditor');
  try {
    JSON.parse(jsonEditor.value);
    showJsonStatus('Valid JSON - OK', 'valid');
  } catch (e) {
    showJsonStatus('Invalid JSON: ' + e.message, 'invalid');
  }
}

function showJsonStatus(message, type) {
  const status = document.getElementById('jsonStatus');
  status.textContent = message;
  status.className = 'json-status ' + type;
  
  setTimeout(() => {
    status.textContent = '';
    status.className = 'json-status';
  }, 5000);
}

function exportJson() {
  const jsonText = document.getElementById('jsonEditor').value;
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fallbackName = (currentTree && currentTree.name)
    ? currentTree.name
    : (document.getElementById('editTreeName')?.value || 'family_tree');
  a.download = `${fallbackName.replace(/[^a-z0-9]/gi, '_')}_family_tree.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showImportModal() {
  window.AncestrioDomDisplay.show('importModal', 'flex');
}

function hideImportModal() {
  window.AncestrioDomDisplay.hide('importModal');
  document.getElementById('fileInput').value = '';
  document.getElementById('pasteJson').value = '';
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('pasteJson').value = e.target.result;
    };
    reader.readAsText(file);
  }
}

function importJson() {
  const jsonText = document.getElementById('pasteJson').value.trim();
  
  if (!jsonText) {
    notifyUser('Please select a file or paste JSON data.', 'warning');
    return;
  }
  
  try {
    const parsed = JSON.parse(jsonText);
    document.getElementById('jsonEditor').value = JSON.stringify(parsed, null, 2);
    markAsChanged();
    hideImportModal();
    switchTab('json');
    scheduleVisualRender(true);
  } catch (e) {
    notifyUser('Invalid JSON format: ' + e.message, 'warning');
  }
}

function addFamilyMember(event) {
  pendingAddMemberMeta = { type: 'root' };

  if (event && event.currentTarget) {
    event.stopPropagation();
    showAddMemberPopup(event, pendingAddMemberMeta);
    return;
  }

  const btn = document.getElementById('addPersonBtn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  showAddMemberPopup({
    clientX: rect.right + 8,
    clientY: rect.top + (rect.height / 2),
    currentTarget: btn
  }, pendingAddMemberMeta);
}

function initVisualEditor() {
  if (visualState.initialized) return;
  const svgEl = document.getElementById('visualTree');
  if (!svgEl || typeof d3 === 'undefined') return;
  visualState.svg = d3.select(svgEl);
  visualState.g = visualState.svg.append('g').attr('class', 'visual-tree-layer');
  visualState.zoom = d3.zoom()
    .scaleExtent([0.2, 2.5])
    .on('zoom', (event) => {
      visualState.g.attr('transform', event.transform);
      visualState.hasUserTransform = true;
      // Hide popup when panning/zooming
      hideAddMemberPopup();
    });
  visualState.svg.call(visualState.zoom);
  visualState.initialized = true;

  document.getElementById('visualZoomIn')?.addEventListener('click', () => adjustVisualZoom(1.2));
  document.getElementById('visualZoomOut')?.addEventListener('click', () => adjustVisualZoom(1 / 1.2));
  document.getElementById('visualReset')?.addEventListener('click', () => resetVisualView(true));

  window.addEventListener('resize', () => scheduleVisualRender(false));
}

function adjustVisualZoom(factor) {
  if (!visualState.svg || !visualState.zoom) return;
  visualState.svg.transition().duration(200).call(visualState.zoom.scaleBy, factor);
}

function resetVisualView(forceReset) {
  if (!visualState.svg || !visualState.zoom) return;
  if (forceReset) {
    visualState.hasUserTransform = false;
  }
  scheduleVisualRender(true);
}

function restructureForOrigin(data) {
  // Find the origin node (marked with isOrigin: true)
  function findOrigin(node) {
    if (node && node.isOrigin) return node;
    if (node && Array.isArray(node.children)) {
      for (let child of node.children) {
        const found = findOrigin(child);
        if (found) return found;
      }
    }
    return null;
  }

  const originNode = findOrigin(data);
  if (!originNode) return data; // No origin found, return as-is

  // Find parent of origin node
  function findNodeAndParent(current, target, parent = null) {
    if (current === target) return { node: current, parent };
    if (current && Array.isArray(current.children)) {
      for (let child of current.children) {
        const result = findNodeAndParent(child, target, current);
        if (result) return result;
      }
    }
    return null;
  }

  const result = findNodeAndParent(data, originNode);
  if (!result || !result.parent) return data; // Origin is root, return as-is

  // Clone the selected origin node as-is so visual schema fields stay intact.
  const newRoot = JSON.parse(JSON.stringify(originNode));
  if (!Array.isArray(newRoot.children)) {
    newRoot.children = [];
  }

  // Deep clone the parent and remove the origin node from its children by index.
  const parentCopy = JSON.parse(JSON.stringify(result.parent));
  const originIndex = Array.isArray(result.parent.children)
    ? result.parent.children.indexOf(originNode)
    : -1;
  if (Array.isArray(parentCopy.children) && originIndex >= 0) {
    parentCopy.children.splice(originIndex, 1);
  }

  // Store the parent hierarchy as "parents" property
  newRoot.parents = parentCopy;

  return newRoot;
}

function scheduleVisualRender(resetTransform) {
  if (!visualState.initialized) return;
  if (visualState.pendingRender) {
    clearTimeout(visualState.pendingRender);
  }
  visualState.pendingRender = setTimeout(() => {
    renderVisualEditor(!!resetTransform);
  }, 80);
}

function renderVisualEditor(resetTransform) {
  if (!visualState.initialized) {
    console.log('Visual state not initialized');
    return;
  }
  const jsonEditor = document.getElementById('jsonEditor');
  if (!jsonEditor) return;
  let data;
  try {
    data = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    console.log('JSON parse error:', e);
    visualState.g.selectAll('*').remove();
    return;
  }

  console.log('Parsed tree data:', data);
  let treeData = buildVisualTreeData(data);
  console.log('Built visual tree data:', treeData);
  if (!treeData) {
    if (!visualState.autoSeeded) {
      const seeded = ensureDefaultTreeData(data);
      jsonEditor.value = JSON.stringify(seeded, null, 2);
      markAsChanged();
      visualState.autoSeeded = true;
      scheduleVisualRender(true);
      return;
    }
    visualState.g.selectAll('*').remove();
    return;
  }

  // Keep full hierarchy in editor so parents/siblings remain visible and editable.
  // Origin re-rooting is handled in the viewer renderer.

  // Match demo-tree dimensions
  const person = { width: 170, height: 120, spouseGap: 48 };
  const avatar = { r: 36, top: 10 };
  const spacing = { y: 180 };
  const nodeSize = { width: person.width, height: person.height };
  const generationStepY = nodeSize.height + spacing.y;
  const baseCoupleWidth = person.width * 2 + person.spouseGap;
  const minHorizontalGap = Math.max(16, person.width * 0.35);
  const getRenderableSpouseEntries = (nodeData) => {
    const spouses = nodeData && Array.isArray(nodeData.spouses) ? nodeData.spouses : [];
    const entries = [];
    spouses.forEach((spouse, sourceIndex) => {
      const label = safeText((spouse && typeof spouse === 'object') ? spouse.name : spouse);
      if (!label) return;
      entries.push({
        spouse,
        sourceIndex,
        renderIndex: entries.length,
        label
      });
    });
    return entries;
  };
  const nodeGroupWidth = (treeNode) => {
    const visibleSpouses = treeNode && treeNode.data
      ? getRenderableSpouseEntries(treeNode.data)
      : [];
    const count = 1 + visibleSpouses.length;
    return person.width * count + person.spouseGap * (count - 1);
  };
  const layout = d3.tree()
    .nodeSize([baseCoupleWidth, generationStepY])
    .separation((a, b) => {
      const needed = (nodeGroupWidth(a) / 2) + minHorizontalGap + (nodeGroupWidth(b) / 2);
      const base = needed / baseCoupleWidth;
      return a.parent === b.parent ? base : base * 1.4;
    });
  const root = d3.hierarchy(treeData);
  layout(root);

  const nodes = root.descendants();

  const spouseNodes = [];
  const spouseAncestorGroups = [];
  const spouseAncestorPrimaryNodes = [];
  const spouseAncestorSpouseNodes = [];
  const spouseByPrimaryId = new Map();
  const spouseEntriesByPrimaryId = new Map();
  nodes.forEach((node) => {
    spouseEntriesByPrimaryId.set(node.data.id, getRenderableSpouseEntries(node.data));
  });
  const getSpouseSideCounts = (spouseCount) => {
    const rightCount = spouseCount > 0 ? 1 : 0;
    const leftCount = Math.max(0, spouseCount - rightCount);
    return { leftCount, rightCount, totalCount: 1 + leftCount + rightCount };
  };
  const getCoupleGroupWidth = (spouseCount) => {
    const sideCounts = getSpouseSideCounts(spouseCount);
    return person.width * sideCounts.totalCount + person.spouseGap * (sideCounts.totalCount - 1);
  };
  const getPrimaryCenterForNode = (node, spouseCount) => {
    const sideCounts = getSpouseSideCounts(spouseCount);
    const groupWidth = getCoupleGroupWidth(spouseCount);
    const leftStart = node.x - groupWidth / 2;
    return leftStart + sideCounts.leftCount * (person.width + person.spouseGap) + person.width / 2;
  };
  const getSpouseCenterFromPrimary = (primaryCenterX, spouseIndex) => {
    if (spouseIndex === 0) {
      return primaryCenterX + (person.width + person.spouseGap);
    }
    // Additional spouses are shown to the left of the primary (2nd spouse, 3rd spouse, ...).
    return primaryCenterX - (person.width + person.spouseGap) * spouseIndex;
  };
  const getRenderableSpouseCount = (treeNode) => {
    if (!treeNode || !treeNode.data) return 0;
    return getRenderableSpouseEntries(treeNode.data).length;
  };
  const shiftSubtreeX = (treeNode, deltaX) => {
    if (!treeNode || !Number.isFinite(deltaX) || Math.abs(deltaX) < 0.001) return;
    treeNode.each((descendant) => {
      descendant.x += deltaX;
    });
  };
  const getChildGroupCenterX = (childNodes) => {
    if (!Array.isArray(childNodes) || childNodes.length === 0) return null;
    let minCenter = Number.POSITIVE_INFINITY;
    let maxCenter = Number.NEGATIVE_INFINITY;
    childNodes.forEach((childNode) => {
      const childCenter = getPrimaryCenterForNode(childNode, getRenderableSpouseCount(childNode));
      if (!Number.isFinite(childCenter)) return;
      minCenter = Math.min(minCenter, childCenter);
      maxCenter = Math.max(maxCenter, childCenter);
    });
    if (!Number.isFinite(minCenter) || !Number.isFinite(maxCenter)) return null;
    return (minCenter + maxCenter) / 2;
  };
  const alignChildGroupToTargetX = (childNodes, targetX) => {
    if (!Array.isArray(childNodes) || childNodes.length === 0) return;
    if (!Number.isFinite(targetX)) return;
    const currentCenter = getChildGroupCenterX(childNodes);
    if (!Number.isFinite(currentCenter)) return;
    const deltaX = targetX - currentCenter;
    childNodes.forEach((childNode) => {
      shiftSubtreeX(childNode, deltaX);
    });
  };
  const getChildSpouseSourceIndexForAlign = (childNode) => {
    const rawIndex = Number(childNode && childNode.data ? childNode.data.fromSpouseIndex : undefined);
    const fallback = (childNode && childNode.data && childNode.data.fromPrevSpouse) ? 1 : 0;
    const candidate = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : fallback;
    return Math.max(0, candidate);
  };
  const resolveRenderSpouseIndex = (spouseEntries, sourceIndex) => {
    if (!Array.isArray(spouseEntries) || spouseEntries.length === 0) return 0;
    const direct = spouseEntries.find((entry) => entry.sourceIndex === sourceIndex);
    if (direct) return direct.renderIndex;
    return Math.max(0, Math.min(spouseEntries.length - 1, sourceIndex));
  };
  const getMergeCenterForSpouseBranch = (parentNode, spouseCount, renderSpouseIndex) => {
    const parentPrimaryCenter = getPrimaryCenterForNode(parentNode, spouseCount);
    const spouseCenter = getSpouseCenterFromPrimary(parentPrimaryCenter, renderSpouseIndex);
    const isRightSide = spouseCenter >= parentPrimaryCenter;
    const primaryInteriorX = parentPrimaryCenter + (isRightSide ? nodeSize.width / 2 : -nodeSize.width / 2);
    const spouseInteriorX = spouseCenter + (isRightSide ? -nodeSize.width / 2 : nodeSize.width / 2);
    return (primaryInteriorX + spouseInteriorX) / 2;
  };
  const alignChildColumnsLikeDemo = () => {
    // Keep child branches centered like demo-tree:
    // no-spouse parent => child under parent primary;
    // spouse branch => children under that couple's merge center.
    root.descendants().forEach((parentNode) => {
      const childList = Array.isArray(parentNode.children) ? parentNode.children : [];
      if (childList.length === 0) return;

      const parentSpouseEntries = spouseEntriesByPrimaryId.get(parentNode.data.id) || [];
      const parentSpouseCount = parentSpouseEntries.length;

      if (parentSpouseCount === 0) {
        const targetX = getPrimaryCenterForNode(parentNode, 0);
        alignChildGroupToTargetX(childList, targetX);
        return;
      }

      const childrenBySpouseRenderIndex = new Map();
      childList.forEach((childNode) => {
        const sourceIndex = getChildSpouseSourceIndexForAlign(childNode);
        const renderIndex = resolveRenderSpouseIndex(parentSpouseEntries, sourceIndex);
        if (!childrenBySpouseRenderIndex.has(renderIndex)) {
          childrenBySpouseRenderIndex.set(renderIndex, []);
        }
        childrenBySpouseRenderIndex.get(renderIndex).push(childNode);
      });

      childrenBySpouseRenderIndex.forEach((spouseChildren, renderIndex) => {
        const targetX = getMergeCenterForSpouseBranch(parentNode, parentSpouseCount, renderIndex);
        alignChildGroupToTargetX(spouseChildren, targetX);
      });
    });
  };
  alignChildColumnsLikeDemo();

  nodes.forEach((node) => {
    const spouseEntries = spouseEntriesByPrimaryId.get(node.data.id) || [];
    if (!spouseEntries.length) return;
    if (!node.data.meta) return;

    const parentType = node.data.meta.type || '';
    const primaryCenterX = getPrimaryCenterForNode(node, spouseEntries.length);
    spouseEntries.forEach(({ spouse, sourceIndex, renderIndex, label }) => {

      const spouseMeta = {
        type: 'spouse',
        parentType,
        parentIndex: node.data.meta.parentIndex,
        childIndex: node.data.meta.childIndex,
        grandIndex: node.data.meta.grandIndex,
        targetType: node.data.meta.targetType,
        spouseIndex: sourceIndex,
        ancestorDepth: Number.isFinite(Number(node.data.meta.ancestorDepth))
          ? Math.max(0, Math.trunc(Number(node.data.meta.ancestorDepth)))
          : 0
      };

      if (parentType === 'couple') {
        spouseMeta.addable = false;
        spouseMeta.path = Array.isArray(node.data.meta.path) ? node.data.meta.path.slice() : [];
      }

      const spouseNode = {
        x: getSpouseCenterFromPrimary(primaryCenterX, renderIndex),
        y: node.y,
        sourceSpouseIndex: sourceIndex,
        renderSpouseIndex: renderIndex,
        data: {
          id: `${node.data.id}-spouse-${sourceIndex}`,
          label,
          image: (spouse && typeof spouse === 'object' ? spouse.image : '') || '',
          meta: spouseMeta
        }
      };
      spouseNodes.push(spouseNode);
      // Map multiple spouses to the primary person
      if (!spouseByPrimaryId.has(node.data.id)) {
        spouseByPrimaryId.set(node.data.id, []);
      }
      spouseByPrimaryId.get(node.data.id).push(spouseNode);

      const spouseParents = (spouse && typeof spouse === 'object' && spouse.parents && typeof spouse.parents === 'object')
        ? spouse.parents
        : null;
      if (!spouseParents) return;
      const spouseTargetMeta = {
        parentType: spouseMeta.parentType,
        targetType: spouseMeta.targetType,
        parentIndex: spouseMeta.parentIndex,
        childIndex: spouseMeta.childIndex,
        grandIndex: spouseMeta.grandIndex,
        spouseIndex: spouseMeta.spouseIndex,
        ancestorDepth: spouseMeta.ancestorDepth
      };
      const buildSpouseAncestorChain = (childAnchorNode, currentParentsData, depth) => {
        if (!currentParentsData || typeof currentParentsData !== 'object' || !childAnchorNode) return;

        const rawAncestorSpouses = extractSpouses(currentParentsData.spouse);
        const ancestorSpouseEntries = getRenderableSpouseEntries({
          spouses: rawAncestorSpouses.length > 0 ? [rawAncestorSpouses[0]] : []
        });
        const legacyOverflowParents = rawAncestorSpouses
          .slice(1)
          .map((entry) => {
            if (!entry) return null;
            if (typeof entry === 'string') {
              const name = safeText(entry);
              return name ? { name, image: '', birthday: '' } : null;
            }
            const name = safeText(entry.name);
            if (!name) return null;
            return {
              name,
              image: safeText(entry.image),
              birthday: safeText(entry.birthday)
            };
          })
          .filter(Boolean);

        let higherParents = (currentParentsData.parents && typeof currentParentsData.parents === 'object')
          ? currentParentsData.parents
          : null;
        if (!higherParents && legacyOverflowParents.length > 0) {
          for (let i = legacyOverflowParents.length - 1; i >= 0; i -= 1) {
            higherParents = {
              ...legacyOverflowParents[i],
              parents: higherParents
            };
          }
        }

        const ancestorPrimaryName = safeText(currentParentsData.name);
        if (!ancestorPrimaryName && ancestorSpouseEntries.length === 0 && !higherParents) return;

        const outwardOffsetX = nodeSize.width / 2 + person.spouseGap / 2;
        const ancestorPrimaryCenterX = ancestorSpouseEntries.length > 0
          ? childAnchorNode.x - outwardOffsetX
          : childAnchorNode.x;
        const ancestorPrimaryMeta = parentType === 'couple'
          ? {
            type: 'ancestor',
            ancestorDepth: depth,
            addable: false,
            editable: false
          }
          : {
            type: 'ancestor',
            targetType: 'spouse',
            ancestorDepth: depth,
            spouseMeta: spouseTargetMeta
          };
        const ancestorPrimaryNode = {
          x: ancestorPrimaryCenterX,
          y: childAnchorNode.y - generationStepY,
          data: {
            id: `${node.data.id}-spouse-${sourceIndex}-parents-${depth}`,
            label: formatCoupleLabel(currentParentsData.name, null) || 'Parent',
            image: currentParentsData.image || '',
            meta: ancestorPrimaryMeta
          }
        };
        spouseAncestorPrimaryNodes.push(ancestorPrimaryNode);

        const ancestorSpouseNodes = [];
        ancestorSpouseEntries.forEach(({ spouse: ancestorSpouse, sourceIndex: ancestorSourceIndex, renderIndex: ancestorRenderIndex, label: ancestorLabel }) => {
          const ancestorSpouseMeta = parentType === 'couple'
            ? {
              type: 'spouse',
              ancestorDepth: depth,
              addable: false,
              editable: false
            }
            : {
              type: 'spouse',
              parentType: 'ancestor',
              targetType: 'spouse',
              ancestorDepth: depth,
              spouseIndex: ancestorSourceIndex,
              spouseMeta: spouseTargetMeta
            };
          const ancestorSpouseNode = {
            x: getSpouseCenterFromPrimary(ancestorPrimaryCenterX, ancestorRenderIndex),
            y: ancestorPrimaryNode.y,
            sourceSpouseIndex: ancestorSourceIndex,
            renderSpouseIndex: ancestorRenderIndex,
            data: {
              id: `${ancestorPrimaryNode.data.id}-spouse-${ancestorSourceIndex}`,
              label: ancestorLabel,
              image: (ancestorSpouse && typeof ancestorSpouse === 'object' ? ancestorSpouse.image : '') || '',
              meta: ancestorSpouseMeta
            }
          };
          spouseAncestorSpouseNodes.push(ancestorSpouseNode);
          ancestorSpouseNodes.push(ancestorSpouseNode);
        });

        spouseAncestorGroups.push({
          childSpouseNode: childAnchorNode,
          primary: ancestorPrimaryNode,
          spouses: ancestorSpouseNodes
        });

        if (higherParents) {
          buildSpouseAncestorChain(ancestorPrimaryNode, higherParents, depth + 1);
        }
      };

      buildSpouseAncestorChain(spouseNode, spouseParents, 0);
    });
  });

  const alignAncestorRowsByGeneration = () => {
    const originNode = nodes.find((node) => !!(node && node.data && node.data.isOrigin));
    if (!originNode || !Number.isFinite(originNode.y)) return;

    const rowTolerance = 0.5;
    const isSameRow = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= rowTolerance;

    const getPrimaryCenterX = (node) => {
      const spouseEntries = spouseEntriesByPrimaryId.get(node.data.id) || [];
      return getPrimaryCenterForNode(node, spouseEntries.length);
    };

    const pushRowCard = (cards, x, applyDeltaFn) => {
      if (!Number.isFinite(x) || typeof applyDeltaFn !== 'function') return;
      const card = {
        x,
        applyDelta: (dx) => {
          if (!Number.isFinite(dx) || Math.abs(dx) < 0.001) return;
          applyDeltaFn(dx);
          card.x += dx;
        }
      };
      cards.push(card);
    };

    const collectRowCards = (rowY) => {
      const cards = [];
      nodes
        .filter((node) => isSameRow(node.y, rowY))
        .forEach((node) => {
          const currentX = getPrimaryCenterX(node);
          pushRowCard(cards, currentX, (dx) => { node.x += dx; });
        });
      spouseNodes
        .filter((node) => isSameRow(node.y, rowY))
        .forEach((node) => {
          pushRowCard(cards, node.x, (dx) => { node.x += dx; });
        });
      spouseAncestorPrimaryNodes
        .filter((node) => isSameRow(node.y, rowY))
        .forEach((node) => {
          pushRowCard(cards, node.x, (dx) => { node.x += dx; });
        });
      spouseAncestorSpouseNodes
        .filter((node) => isSameRow(node.y, rowY))
        .forEach((node) => {
          pushRowCard(cards, node.x, (dx) => { node.x += dx; });
        });
      cards.sort((a, b) => a.x - b.x);
      return cards;
    };

    const collectRowCenters = (rowY) => {
      return nodes
        .filter((node) => isSameRow(node.y, rowY))
        .map((node) => getPrimaryCenterX(node))
        .concat(
          spouseNodes
            .filter((node) => isSameRow(node.y, rowY))
            .map((node) => node.x)
        )
        .concat(
          spouseAncestorPrimaryNodes
            .filter((node) => isSameRow(node.y, rowY))
            .map((node) => node.x)
        )
        .concat(
          spouseAncestorSpouseNodes
            .filter((node) => isSameRow(node.y, rowY))
            .map((node) => node.x)
        )
        .filter((x) => Number.isFinite(x))
        .sort((a, b) => a - b);
    };

    const collectAllRowYs = () => {
      const values = nodes
        .map((node) => Number(node.y))
        .concat(spouseNodes.map((node) => Number(node.y)))
        .concat(spouseAncestorPrimaryNodes.map((node) => Number(node.y)))
        .concat(spouseAncestorSpouseNodes.map((node) => Number(node.y)))
        .filter((y) => Number.isFinite(y));
      const unique = [];
      values.sort((a, b) => a - b);
      values.forEach((y) => {
        if (!unique.length || !isSameRow(unique[unique.length - 1], y)) {
          unique.push(y);
        }
      });
      return unique;
    };

    const rowHasAncestor = (rowY) => {
      const hasPrimaryAncestor = nodes.some((node) => {
        return isSameRow(node.y, rowY)
          && node
          && node.data
          && node.data.meta
          && node.data.meta.type === 'ancestor';
      });
      if (hasPrimaryAncestor) return true;
      return spouseAncestorPrimaryNodes.some((node) => isSameRow(node.y, rowY))
        || spouseAncestorSpouseNodes.some((node) => isSameRow(node.y, rowY));
    };

    const allRowYs = collectAllRowYs();
    if (!allRowYs.length) return;

    const ancestorRowYs = allRowYs
      .filter((rowY) => rowY < originNode.y - rowTolerance)
      .filter((rowY) => rowHasAncestor(rowY))
      .sort((a, b) => b - a); // bottom-up so each row aligns to already-stabilized lower rows

    const minCenterGap = nodeSize.width + person.spouseGap;
    const computeAnchorStep = (centers) => {
      if (!Array.isArray(centers) || centers.length < 2) return minCenterGap;
      const diffs = [];
      for (let i = 1; i < centers.length; i += 1) {
        const diff = centers[i] - centers[i - 1];
        if (Number.isFinite(diff) && diff > 1) diffs.push(diff);
      }
      if (!diffs.length) return minCenterGap;
      diffs.sort((a, b) => a - b);
      const mid = Math.floor(diffs.length / 2);
      const median = diffs.length % 2 === 0
        ? (diffs[mid - 1] + diffs[mid]) / 2
        : diffs[mid];
      return Math.max(minCenterGap, median);
    };
    const buildCenteredTargets = (count, centerX, step) => {
      const targets = [];
      const safeCount = Math.max(0, Math.trunc(Number(count)));
      if (!safeCount || !Number.isFinite(centerX) || !Number.isFinite(step) || step <= 0) return targets;
      for (let i = 0; i < safeCount; i += 1) {
        targets.push(centerX + (i - ((safeCount - 1) / 2)) * step);
      }
      return targets;
    };

    ancestorRowYs.forEach((rowY) => {
      const lowerRowY = allRowYs.find((candidateY) => candidateY > rowY + rowTolerance);
      if (!Number.isFinite(lowerRowY)) return;

      const rowCards = collectRowCards(rowY);
      if (!rowCards.length) return;

      const anchorCenters = collectRowCenters(lowerRowY);
      if (!anchorCenters.length) return;

      let targetCenters = [];
      if (rowCards.length === anchorCenters.length) {
        targetCenters = anchorCenters.slice();
      } else {
        const anchorCenterX = (anchorCenters[0] + anchorCenters[anchorCenters.length - 1]) / 2;
        const step = computeAnchorStep(anchorCenters);
        targetCenters = buildCenteredTargets(rowCards.length, anchorCenterX, step);
      }

      if (!targetCenters.length) return;
      const pairCount = Math.min(rowCards.length, targetCenters.length);
      for (let i = 0; i < pairCount; i += 1) {
        const deltaX = targetCenters[i] - rowCards[i].x;
        if (!Number.isFinite(deltaX) || Math.abs(deltaX) < 0.75) continue;
        rowCards[i].applyDelta(deltaX);
      }
    });
  };
  alignAncestorRowsByGeneration();

  const renderNodes = nodes.concat(spouseNodes, spouseAncestorPrimaryNodes, spouseAncestorSpouseNodes);
  const hasOriginNode = renderNodes.some((node) => !!(node && node.data && node.data.isOrigin));

  // Ensure defs for clip paths
  let defs = visualState.svg.select('defs');
  if (defs.empty()) {
    defs = visualState.svg.append('defs');
    // Add gradient for hover effect
    const gradient = defs.append('linearGradient')
      .attr('id', 'editorPersonGradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '100%');
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--accent-2)')
      .attr('stop-opacity', 0.22);
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--accent)')
      .attr('stop-opacity', 0.22);
  }

  // Curved link path like demo-tree
  const linkGen = d3.linkVertical()
    .x((d) => d.x)
    .y((d) => d.y);
  const getPrimaryCardCenterX = (node) => {
    const spouseEntries = spouseEntriesByPrimaryId.get(node.data.id) || [];
    return getPrimaryCenterForNode(node, spouseEntries.length);
  };
  const getDrawX = (node) => {
    if (node.data.meta && node.data.meta.type === 'spouse') {
      return node.x;
    }
    return getPrimaryCardCenterX(node);
  };
  const topOfPrimary = (node) => ({
    x: getPrimaryCardCenterX(node),
    y: node.y - nodeSize.height / 2
  });
  const splitPad = 18;
  const mergePad = Math.max(24, nodeSize.height * 0.35);
  const mergeCurves = [];
  const marriageLines = [];
  const branches = [];
  const getChildSpouseSourceIndex = (childNode) => {
    const rawIndex = Number(childNode && childNode.data ? childNode.data.fromSpouseIndex : undefined);
    const fallback = (childNode && childNode.data && childNode.data.fromPrevSpouse) ? 1 : 0;
    const candidate = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : fallback;
    return Math.max(0, candidate);
  };
  const resolveChildSpouseNode = (childNode, spouseList) => {
    if (!Array.isArray(spouseList) || spouseList.length === 0) return null;
    const sourceIndex = getChildSpouseSourceIndex(childNode);
    const direct = spouseList.find((spouseNode) => {
      const spouseIndex = Number(spouseNode?.data?.meta?.spouseIndex);
      return Number.isFinite(spouseIndex) && Math.trunc(spouseIndex) === sourceIndex;
    });
    if (direct) return direct;
    const clamped = Math.max(0, Math.min(spouseList.length - 1, sourceIndex));
    return spouseList[clamped] || spouseList[0];
  };

  nodes.forEach((node) => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const primaryCenterX = getPrimaryCardCenterX(node);
    const spouseList = spouseByPrimaryId.get(node.data.id) || [];
    const yCenter = node.y;
    const yMerge = yCenter + mergePad;
    const yJunction = node.y + nodeSize.height / 2 + splitPad;

    if (spouseList.length > 0) {
      const childrenBySpouseId = new Map();
      if (hasChildren) {
        node.children.forEach((child) => {
          const spouseNode = resolveChildSpouseNode(child, spouseList);
          if (!spouseNode) return;
          const spouseNodeId = spouseNode.data.id;
          if (!childrenBySpouseId.has(spouseNodeId)) {
            childrenBySpouseId.set(spouseNodeId, []);
          }
          childrenBySpouseId.get(spouseNodeId).push(child);
        });
      }

      spouseList.forEach((spouseNode) => {
        const isRightSide = spouseNode.x >= primaryCenterX;
        const primaryInterior = {
          x: primaryCenterX + (isRightSide ? nodeSize.width / 2 : -nodeSize.width / 2),
          y: yCenter
        };
        const spouseInterior = {
          x: spouseNode.x + (isRightSide ? -nodeSize.width / 2 : nodeSize.width / 2),
          y: yCenter
        };
        const spouseChildren = childrenBySpouseId.get(spouseNode.data.id) || [];

        if (spouseChildren.length === 0) {
          marriageLines.push({
            x0: Math.min(primaryInterior.x, spouseInterior.x),
            x1: Math.max(primaryInterior.x, spouseInterior.x),
            y: yCenter
          });
          return;
        }

        const xMerge = (primaryInterior.x + spouseInterior.x) / 2;
        const mergeTarget = { x: xMerge, y: yMerge };
        mergeCurves.push({ source: primaryInterior, target: mergeTarget });
        mergeCurves.push({ source: spouseInterior, target: mergeTarget });
        spouseChildren.forEach((child) => {
          branches.push({
            source: mergeTarget,
            target: topOfPrimary(child)
          });
        });
      });
      return;
    }

    if (!hasChildren) return;
    const branchSource = { x: primaryCenterX, y: yJunction };
    node.children.forEach((child) => {
      branches.push({
        source: branchSource,
        target: topOfPrimary(child)
      });
    });
  });

  spouseAncestorGroups.forEach((group) => {
    if (!group || !group.primary || !group.childSpouseNode) return;

    const childTarget = {
      x: group.childSpouseNode.x,
      y: group.childSpouseNode.y - nodeSize.height / 2
    };
    const yCenter = group.primary.y;
    const ancestorSpouses = Array.isArray(group.spouses) ? group.spouses : [];

    if (!ancestorSpouses.length) {
      branches.push({
        source: {
          x: group.primary.x,
          y: yCenter + nodeSize.height / 2 + splitPad
        },
        target: childTarget
      });
      return;
    }

    let connectedToChild = false;
    ancestorSpouses.forEach((ancestorSpouseNode) => {
      const isRightSide = ancestorSpouseNode.x >= group.primary.x;
      const primaryInterior = {
        x: group.primary.x + (isRightSide ? nodeSize.width / 2 : -nodeSize.width / 2),
        y: yCenter
      };
      const spouseInterior = {
        x: ancestorSpouseNode.x + (isRightSide ? -nodeSize.width / 2 : nodeSize.width / 2),
        y: yCenter
      };

      const shouldConnect = !connectedToChild && ancestorSpouseNode.renderSpouseIndex === 0;
      if (!shouldConnect) {
        marriageLines.push({
          x0: Math.min(primaryInterior.x, spouseInterior.x),
          x1: Math.max(primaryInterior.x, spouseInterior.x),
          y: yCenter
        });
        return;
      }

      connectedToChild = true;
      const mergeTarget = {
        x: (primaryInterior.x + spouseInterior.x) / 2,
        y: yCenter + mergePad
      };
      mergeCurves.push({ source: primaryInterior, target: mergeTarget });
      mergeCurves.push({ source: spouseInterior, target: mergeTarget });
      branches.push({ source: mergeTarget, target: childTarget });
    });

    if (!connectedToChild) {
      branches.push({
        source: {
          x: group.primary.x,
          y: yCenter + nodeSize.height / 2 + splitPad
        },
        target: childTarget
      });
    }
  });

  function unionCurvePath(d) {
    const x0 = d.source.x;
    const y0 = d.source.y;
    const x1 = d.target.x;
    const y1 = d.target.y;
    const dx = x1 - x0;
    const dir = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const lead = Math.max(12, Math.min(30, Math.abs(dx) * 0.33));
    const dy = Math.max(30, y1 - y0);
    const c1x = x0 + dir * lead;
    const c1y = y0;
    const c2x = x1;
    const c2y = y1 - dy * 0.6;
    return `M ${x0},${y0} C ${c1x},${c1y} ${c2x},${c2y} ${x1},${y1}`;
  }

  visualState.g.selectAll('.parent-merge')
    .data(mergeCurves)
    .join('path')
    .attr('class', 'link parent-link parent-merge')
    .attr('d', (d) => unionCurvePath(d));

  visualState.g.selectAll('.parent-marriage-line')
    .data(marriageLines)
    .join('path')
    .attr('class', 'link parent-link parent-marriage-line')
    .attr('d', (d) => `M ${d.x0},${d.y} H ${d.x1}`);

  visualState.g.selectAll('.parent-branch')
    .data(branches)
    .join('path')
    .attr('class', 'link parent-link parent-branch')
    .attr('d', (d) => linkGen(d));

  const nodeSel = visualState.g.selectAll('.person')
    .data(renderNodes, (d) => d.data.id);

  nodeSel.exit().remove();

  const nodeEnter = nodeSel.enter()
    .append('g')
    .attr('class', 'person');

  // Background rect
  nodeEnter.append('rect')
    .attr('width', nodeSize.width)
    .attr('height', nodeSize.height)
    .attr('rx', 16)
    .attr('ry', 16);

  // Avatar group
  const avatarGroup = nodeEnter.append('g')
    .attr('class', 'avatar-group')
    .attr('transform', `translate(${nodeSize.width / 2}, ${avatar.top + avatar.r})`);

  // Clip path for circular avatar
  avatarGroup.each(function(d) {
    const clipId = `clip-editor-${d.data.id}`;
    defs.append('clipPath')
      .attr('id', clipId)
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', avatar.r);
  });

  // Avatar circle background
  avatarGroup.append('circle')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', avatar.r)
    .attr('fill', 'var(--surface-2)')
    .attr('stroke', 'var(--border)')
    .attr('stroke-width', 2);

  // Avatar image
  avatarGroup.append('image')
    .attr('x', -avatar.r)
    .attr('y', -avatar.r)
    .attr('width', avatar.r * 2)
    .attr('height', avatar.r * 2)
    .attr('clip-path', (d) => `url(#clip-editor-${d.data.id})`)
    .attr('preserveAspectRatio', 'xMidYMid slice');

  // Name text
  nodeEnter.append('text')
    .attr('class', 'name')
    .attr('x', nodeSize.width / 2)
    .attr('y', avatar.top + avatar.r * 2 + 22)
    .attr('text-anchor', 'middle');

  // Add button
  nodeEnter.append('g')
    .attr('class', 'node-add')
    .attr('transform', `translate(${nodeSize.width - 16}, ${-10})`)
    .on('click', (event, d) => {
      event.stopPropagation();
      showAddMemberPopup(event, d.data.meta);
    })
    .call((g) => {
      g.append('circle').attr('r', 12);
      g.append('text').text('+').attr('y', 1);
    });

  // Delete button
  nodeEnter.append('g')
    .attr('class', 'node-delete')
    .attr('transform', `translate(${nodeSize.width - 16}, ${nodeSize.height - 10})`)
    .on('click', (event, d) => {
      event.stopPropagation();
      deleteMember(d.data.meta);
    })
    .call((g) => {
      g.append('circle').attr('r', 12);
      g.append('text').text('-').attr('y', 1);
    });

  // Update all nodes
  const mergedNodes = nodeEnter.merge(nodeSel);
  mergedNodes
    .attr('transform', (d) => {
      const drawX = getDrawX(d);
      d._drawX = drawX;
      return `translate(${drawX - nodeSize.width / 2}, ${d.y - nodeSize.height / 2})`;
    })
    .on('click', (event, d) => {
      if (event.defaultPrevented) return;
      if (d && d.data && d.data.meta && d.data.meta.editable === false) return;
      event.stopPropagation();
      showEditMemberModal(d.data.meta);
    });
  
  // Update avatar images with fallback
  const placeholderUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect fill="#e2e8f0" width="72" height="72"/><circle cx="36" cy="28" r="12" fill="#94a3b8"/><ellipse cx="36" cy="58" rx="20" ry="14" fill="#94a3b8"/></svg>');
  
  mergedNodes.select('.avatar-group image')
    .attr('href', (d) => d.data.image || placeholderUrl)
    .on('error', function() {
      d3.select(this).attr('href', placeholderUrl);
    });

  // Update name text
  mergedNodes.select('text.name')
    .text((d) => d.data.label);

  // Show/hide add button - everyone gets a + button
  mergedNodes.select('.node-add')
    .style('display', (d) => (d.data.meta && d.data.meta.addable === false ? 'none' : 'block'));

  // Show/hide delete button - only the selected origin person is protected.
  mergedNodes.select('.node-delete')
    .style('display', (d) => {
      if (d && d.data && d.data.meta && d.data.meta.editable === false) return 'none';
      if (d && d.data && d.data.isOrigin) return 'none';
      // Backward compatibility for trees that don't have an origin marker yet.
      if (!hasOriginNode && d.data && d.data.meta && d.data.meta.type === 'root') return 'none';
      return 'block';
    });

  if (resetTransform || !visualState.hasUserTransform) {
    centerVisualTree(renderNodes, nodeSize);
  }
}

function centerVisualTree(nodes, nodeSize) {
  if (!visualState.svg || !visualState.zoom || !nodes.length) return;
  const svgNode = visualState.svg.node();
  const rect = svgNode.getBoundingClientRect();
  // Use actual dimensions or fallback to 620px
  const width = rect.width || 800;
  const height = rect.height || 620;
  const minX = d3.min(nodes, (d) => (d._drawX !== undefined ? d._drawX : d.x)) - nodeSize.width / 2;
  const maxX = d3.max(nodes, (d) => (d._drawX !== undefined ? d._drawX : d.x)) + nodeSize.width / 2;
  const minY = d3.min(nodes, (d) => d.y) - nodeSize.height / 2;
  const maxY = d3.max(nodes, (d) => d.y) + nodeSize.height / 2;
  const treeWidth = Math.max(1, maxX - minX);
  const treeHeight = Math.max(1, maxY - minY);
  const padding = 80;
  const scale = Math.min(1, Math.min((width - padding) / treeWidth, (height - padding) / treeHeight));
  const translateX = width / 2 - ((minX + maxX) / 2) * scale;
  const translateY = height / 2 - ((minY + maxY) / 2) * scale;
  const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
  visualState.svg.call(visualState.zoom.transform, transform);
  visualState.hasUserTransform = false;
}


function ensureDefaultTreeData(data) {
  if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    // Clean up duplicate root nodes created during setup
    return cleanupTreeData(data);
  }
  return createDefaultTreeData(getDefaultPersonName());
}

function cleanupTreeData(data) {
  if (!data || typeof data !== 'object') return data;
  
  // Clone to avoid mutating original
  const cleaned = JSON.parse(JSON.stringify(data));
  
  // If this looks like an RFamilySchema, check for duplicates
  if (cleaned.Grandparent && Array.isArray(cleaned.Parent)) {
    const grandparentName = safeText(cleaned.Grandparent);
    
    if (grandparentName) {
      // Check if Grandparent appears as a child in Parent array
      // This happens when the setup creates a duplicate entry
      cleaned.Parent = cleaned.Parent.filter(parent => {
        const childrenNames = parent.children && Array.isArray(parent.children) 
          ? parent.children.map(c => safeText(c.name))
          : [];
        
        // Remove if this parent has only one child with the same name as Grandparent
        // (this indicates it's a duplicate created during setup)
        if (childrenNames.length === 1 && childrenNames[0] === grandparentName) {
          // Only remove if this parent looks like it should have been in 'parents' property
          // i.e., only one entry in Parent array with one child
          if (cleaned.Parent.length === 1) {
            // Move this parent to the parents property instead
            const parentEntry = parent;
            if (!cleaned.parents) {
              cleaned.parents = {
                name: parentEntry.name,
                image: parentEntry.image || '',
                birthday: parentEntry.birthday || '',
                spouse: parentEntry.spouse || null
              };
            }
            return false; // Remove from Parent array
          }
        }
        return true; // Keep in Parent array
      });
    }
  }
  
  return cleaned;
}

function createDefaultTreeData(name) {
  return {
    Grandparent: name,
    image: '',
    birthday: '',
    Parent: []
  };
}

function getDefaultPersonName() {
  if (isLocalGuestMode) return 'Guest';
  if (currentUser && currentUser.isAnonymous) return 'Guest';
  const displayName = currentUser && currentUser.displayName ? currentUser.displayName.trim() : '';
  if (displayName) return displayName;
  const email = currentUser && currentUser.email ? currentUser.email.trim() : '';
  if (email && email.includes('@')) return email.split('@')[0];
  return 'Family Member';
}

function buildVisualTreeData(data) {
  if (!data || typeof data !== 'object') return null;
  let tree = null;
  if (looksLikeRFamilySchema(data)) {
    tree = buildRFamilyTree(data);
  } else if (data.name || data.spouse || Array.isArray(data.children)) {
    tree = buildCoupleTree(data, []);
  }
  if (!tree) return null;
  return sortTreeBySpouseGroup(tree);
}

function hasExplicitOriginInRFamilyNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.isOrigin) return true;

  const childCollections = [];
  if (Array.isArray(node.Parent)) childCollections.push(node.Parent);
  if (Array.isArray(node.children)) childCollections.push(node.children);
  if (Array.isArray(node.grandchildren)) childCollections.push(node.grandchildren);

  for (const collection of childCollections) {
    for (const child of collection) {
      if (hasExplicitOriginInRFamilyNode(child)) return true;
    }
  }

  return false;
}

function buildRFamilyTree(src) {
  const centerName = safeText(src && src.setupContext && src.setupContext.centerName).toLowerCase();
  const shouldInferOrigin = !hasExplicitOriginInRFamilyNode(src) && !!centerName;
  let inferredOriginAssigned = false;
  const inferOriginByName = (candidateName) => {
    if (!shouldInferOrigin || inferredOriginAssigned) return false;
    const normalizedName = safeText(candidateName).toLowerCase();
    if (!normalizedName || normalizedName !== centerName) return false;
    inferredOriginAssigned = true;
    return true;
  };

  const rootLabel = formatCoupleLabel(src.Grandparent, null);
  const rootSpouses = extractSpouses(src.spouse);
  const root = {
    id: 'root',
    label: rootLabel || 'Root',
    image: src.image || '',
    isOrigin: !!src.isOrigin || inferOriginByName(src.Grandparent),
    spouses: rootSpouses,
    meta: { type: 'root' },
    children: []
  };
  
  const parents = Array.isArray(src.Parent) ? src.Parent : [];
  parents.forEach((p, parentIndex) => {
    const parentSpouses = extractSpouses(p.spouse);
    const rawParentSpouseIndex = Number(p.fromSpouseIndex);
    const parentFromSpouseIndex = Number.isFinite(rawParentSpouseIndex)
      ? Math.max(0, Math.trunc(rawParentSpouseIndex))
      : (p.fromPrevSpouse ? 1 : 0);
    const parentNode = {
      id: `p-${parentIndex}`,
      label: formatCoupleLabel(p.name, null),
      image: p.image || '',
      isOrigin: !!p.isOrigin || inferOriginByName(p.name),
      spouses: parentSpouses,
      fromSpouseIndex: parentFromSpouseIndex,
      fromPrevSpouse: !!p.fromPrevSpouse || parentFromSpouseIndex > 0,
      meta: { type: 'parent', parentIndex },
      children: []
    };
    
    const kids = getRFamilyChildrenList(p, false) || [];
    kids.forEach((k, childIndex) => {
      const childSpouses = extractSpouses(k.spouse);
      const rawSpouseIndex = Number(k.fromSpouseIndex);
      const fromSpouseIndex = Number.isFinite(rawSpouseIndex)
        ? Math.max(0, Math.trunc(rawSpouseIndex))
        : (k.fromPrevSpouse ? 1 : 0);
      const childNode = {
        id: `c-${parentIndex}-${childIndex}`,
        label: formatCoupleLabel(k.name, null),
        image: k.image || '',
        isOrigin: !!k.isOrigin || inferOriginByName(k.name),
        spouses: childSpouses,
        fromSpouseIndex,
        fromPrevSpouse: !!k.fromPrevSpouse || fromSpouseIndex > 0,
        meta: { type: 'child', parentIndex, childIndex, fromSpouseIndex },
        children: []
      };
      
      const grandkids = Array.isArray(k.grandchildren) ? k.grandchildren : [];
      grandkids.forEach((g, grandIndex) => {
        const rawGrandSpouseIndex = Number(g.fromSpouseIndex);
        const grandFromSpouseIndex = Number.isFinite(rawGrandSpouseIndex)
          ? Math.max(0, Math.trunc(rawGrandSpouseIndex))
          : (g.fromPrevSpouse ? 1 : 0);
        const grandNode = {
          id: `g-${parentIndex}-${childIndex}-${grandIndex}`,
          label: safeText(g.name) || 'Member',
          image: g.image || '',
          isOrigin: !!g.isOrigin || inferOriginByName(g.name),
          fromSpouseIndex: grandFromSpouseIndex,
          fromPrevSpouse: !!g.fromPrevSpouse || grandFromSpouseIndex > 0,
          meta: { type: 'grandchild', parentIndex, childIndex, grandIndex, addable: false },
          children: []
        };
        const wrappedGrand = wrapRFamilyNodeWithParents(grandNode, g.parents, {
          type: 'grandchild',
          parentIndex,
          childIndex,
          grandIndex
        });
        childNode.children.push(wrappedGrand);
      });
      const wrappedChild = wrapRFamilyNodeWithParents(childNode, k.parents, {
        type: 'child',
        parentIndex,
        childIndex
      });
      parentNode.children.push(wrappedChild);
    });
    const wrappedParent = wrapRFamilyNodeWithParents(parentNode, p.parents, {
      type: 'parent',
      parentIndex
    });
    root.children.push(wrappedParent);
  });
  return wrapRFamilyNodeWithParents(root, src.parents, { type: 'root' });
}

function extractSpouses(spouseData) {
  // Handle backwards compatibility: convert old single-spouse format to array
  if (!spouseData) return [];
  if (Array.isArray(spouseData)) return spouseData;
  // Old format: single object becomes array with one element
  return [spouseData];
}

function wrapRFamilyNodeWithParents(node, parentsData, targetMeta) {
  if (!parentsData || typeof parentsData !== 'object') return node;
  const rawParentSpouses = extractSpouses(parentsData.spouse);
  const parentSpouses = rawParentSpouses.length > 0 ? [rawParentSpouses[0]] : [];
  const legacyOverflowParents = rawParentSpouses
    .slice(1)
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const name = safeText(entry);
        return name ? { name, image: '', birthday: '' } : null;
      }
      const name = safeText(entry.name);
      if (!name) return null;
      return {
        name,
        image: safeText(entry.image),
        birthday: safeText(entry.birthday)
      };
    })
    .filter(Boolean);

  let higherParents = (parentsData.parents && typeof parentsData.parents === 'object')
    ? parentsData.parents
    : null;
  if (!higherParents && legacyOverflowParents.length > 0) {
    for (let i = legacyOverflowParents.length - 1; i >= 0; i -= 1) {
      higherParents = {
        ...legacyOverflowParents[i],
        parents: higherParents
      };
    }
  }

  const rawDepth = Number(targetMeta && targetMeta.ancestorDepth);
  const ancestorDepth = Number.isFinite(rawDepth) ? Math.max(0, Math.trunc(rawDepth)) : 0;
  const spouseIndex = getNodeSpouseIndex(node);
  const ancestorNode = {
    id: `ancestor-${node.id}`,
    label: formatCoupleLabel(parentsData.name, null) || 'Parent',
    image: parentsData.image || '',
    spouses: parentSpouses,
    fromSpouseIndex: spouseIndex,
    fromPrevSpouse: spouseIndex > 0 || !!node.fromPrevSpouse,
    meta: {
      type: 'ancestor',
      targetType: targetMeta.type,
      parentIndex: targetMeta.parentIndex,
      childIndex: targetMeta.childIndex,
      grandIndex: targetMeta.grandIndex,
      ancestorDepth
    },
    children: [node]
  };
  return wrapRFamilyNodeWithParents(ancestorNode, higherParents, {
    type: targetMeta.type,
    parentIndex: targetMeta.parentIndex,
    childIndex: targetMeta.childIndex,
    grandIndex: targetMeta.grandIndex,
    ancestorDepth: ancestorDepth + 1
  });
}

function buildCoupleTree(node, path) {
  const label = formatCoupleLabel(node.name, node.spouse);
  const children = Array.isArray(node.children) ? node.children : [];
  const spouses = node.spouses || extractSpouses(node.spouse);
  const rawSpouseIndex = Number(node.fromSpouseIndex);
  const fromSpouseIndex = Number.isFinite(rawSpouseIndex)
    ? Math.max(0, Math.trunc(rawSpouseIndex))
    : (node.fromPrevSpouse ? 1 : 0);
  return {
    id: `n-${path.join('-') || 'root'}`,
    label: label || 'Member',
    image: node.image || '',
    isOrigin: !!node.isOrigin,
    spouses: spouses,
    fromSpouseIndex,
    fromPrevSpouse: !!node.fromPrevSpouse || fromSpouseIndex > 0,
    meta: { type: 'couple', path: path.slice() },
    children: children.map((child, index) => buildCoupleTree(child, path.concat(index)))
  };
}

function getNodeSpouseIndex(node) {
  if (!node || typeof node !== 'object') return 0;
  const rawSpouseIndex = Number(node.fromSpouseIndex);
  if (Number.isFinite(rawSpouseIndex)) {
    return Math.max(0, Math.trunc(rawSpouseIndex));
  }
  return node.fromPrevSpouse ? 1 : 0;
}

function sortTreeBySpouseGroup(node) {
  if (!node || typeof node !== 'object') return node;
  if (!Array.isArray(node.children) || node.children.length === 0) return node;

  node.children = node.children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const spouseDiff = getNodeSpouseIndex(b.child) - getNodeSpouseIndex(a.child);
      if (spouseDiff !== 0) return spouseDiff;
      return a.index - b.index;
    })
    .map((entry) => sortTreeBySpouseGroup(entry.child));

  return node;
}

function looksLikeRFamilySchema(obj) {
  return obj && (obj.Parent || obj.Grandparent);
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function formatCoupleLabel(primary, spouse) {
  const main = safeText(primary);
  // Only show primary person's name - spouse will be rendered as separate node
  return main || 'Member';
}

function addMemberAt(meta, memberData) {
  if (!meta) return;
  if (meta.addable === false) return;
  
  const name = memberData?.name || prompt('Name for the new member:');
  if (!name || !name.trim()) return;
  
  const jsonEditor = document.getElementById('jsonEditor');
  let treeData;
  try {
    treeData = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    showJsonStatus('JSON is invalid. Fix it before adding members.', 'invalid');
    notifyUser('JSON is invalid. Fix it before adding members.', 'warning');
    return;
  }

  // Build member object with all collected data
  const newMember = {
    name: name.trim(),
    image: memberData?.image || '',
    birthday: memberData?.birthday || ''
  };
  
  if (memberData?.visited && memberData.visited.length > 0) {
    newMember.visited = memberData.visited;
  }

  if (looksLikeRFamilySchema(treeData)) {
    // Use the relation type to determine what to add
    const relation = meta.relation || 'child'; // Default to child if not specified
    
    if (meta.type === 'root') {
      if (relation === 'parent') {
        addOrAppendParent(treeData, newMember);
      } else if (relation === 'spouse') {
        // Add spouse to array
        if (!Array.isArray(treeData.spouse)) {
          treeData.spouse = treeData.spouse ? [treeData.spouse] : [];
        }
        treeData.spouse.push(newMember);
      } else if (relation === 'child') {
        // Add child - goes into Parent array as a new parent generation
        if (!Array.isArray(treeData.Parent)) {
          treeData.Parent = treeData.Parent ? [treeData.Parent] : [];
        }
        treeData.Parent.push(newMember);
      }
    } else if (meta.type === 'parent') {
      const parent = getRFamilyParent(treeData, meta.parentIndex);
      if (!parent) return;
      
      if (relation === 'child') {
        const targetChildren = getRFamilyChildrenList(parent, true);
        targetChildren.push(newMember);
      } else if (relation === 'parent') {
        addOrAppendParent(parent, newMember);
      } else if (relation === 'spouse') {
        // Add spouse to array
        if (!Array.isArray(parent.spouse)) {
          parent.spouse = parent.spouse ? [parent.spouse] : [];
        }
        parent.spouse.push(newMember);
      }
    } else if (meta.type === 'child') {
      const child = getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
      if (!child) return;
      
      if (relation === 'child') {
        if (!Array.isArray(child.grandchildren)) child.grandchildren = [];
        child.grandchildren.push(newMember);
      } else if (relation === 'parent') {
        addOrAppendParent(child, newMember);
      } else if (relation === 'spouse') {
        // Add spouse to array
        if (!Array.isArray(child.spouse)) {
          child.spouse = child.spouse ? [child.spouse] : [];
        }
        child.spouse.push(newMember);
      }
    } else if (meta.type === 'grandchild') {
      const grandchild = getRFamilyGrandchild(treeData, meta.parentIndex, meta.childIndex, meta.grandIndex);
      if (!grandchild) return;
      if (relation === 'parent') {
        addOrAppendParent(grandchild, newMember);
      }
    } else if (meta.type === 'ancestor') {
      const target = getRFamilyTargetNode(treeData, meta);
      if (!target) return;
      if (relation === 'parent') {
        addOrAppendParent(target, newMember);
      } else if (relation === 'spouse') {
        const parentsData = getRFamilyParentsData(treeData, meta, true);
        addSpouseToParentsData(parentsData, newMember);
      } else if (relation === 'child') {
        if (meta.targetType === 'child') {
          const parent = getRFamilyParent(treeData, meta.parentIndex);
          if (!parent) return;
          const targetChildren = getRFamilyChildrenList(parent, true);
          targetChildren.push(newMember);
        } else if (meta.targetType === 'grandchild') {
          const child = getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
          if (!child) return;
          if (!Array.isArray(child.grandchildren)) child.grandchildren = [];
          child.grandchildren.push(newMember);
        }
      }
    } else if (meta.type === 'spouse') {
      // When clicking + on a spouse node, check relation type
      const parentType = meta.parentType;
      if (relation === 'spouse') {
        // Add another spouse to the same person
        if (parentType === 'root') {
          if (!Array.isArray(treeData.spouse)) {
            treeData.spouse = treeData.spouse ? [treeData.spouse] : [];
          }
          treeData.spouse.push(newMember);
        } else if (parentType === 'ancestor') {
          const parentsData = getRFamilyParentsData(treeData, meta, true);
          if (!parentsData) return;
          if (!Array.isArray(parentsData.spouse)) {
            parentsData.spouse = parentsData.spouse ? [parentsData.spouse] : [];
          }
          parentsData.spouse.push(newMember);
        } else if (parentType === 'parent') {
          const parent = getRFamilyParent(treeData, meta.parentIndex);
          if (!parent) return;
          if (!Array.isArray(parent.spouse)) {
            parent.spouse = parent.spouse ? [parent.spouse] : [];
          }
          parent.spouse.push(newMember);
        } else if (parentType === 'child') {
          const child = getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
          if (!child) return;
          if (!Array.isArray(child.spouse)) {
            child.spouse = child.spouse ? [child.spouse] : [];
          }
          child.spouse.push(newMember);
        }
      } else if (relation === 'parent') {
        const spouseRecord = getRFamilySpouseRecord(treeData, meta, false);
        if (!spouseRecord) return;
        addOrAppendParent(spouseRecord, newMember);
      } else if (relation === 'child') {
        // Add child to the person that this spouse is linked to
        const spouseIndex = Number.isFinite(Number(meta.spouseIndex)) ? Math.max(0, Math.trunc(Number(meta.spouseIndex))) : 0;
        const childForSpouse = spouseIndex > 0
          ? { ...newMember, fromSpouseIndex: spouseIndex, fromPrevSpouse: true }
          : { ...newMember };
        if (parentType === 'root') {
          if (!Array.isArray(treeData.Parent)) {
            treeData.Parent = treeData.Parent ? [treeData.Parent] : [];
          }
          insertChildForSpouse(treeData.Parent, childForSpouse, spouseIndex);
        } else if (parentType === 'parent') {
          const parent = getRFamilyParent(treeData, meta.parentIndex);
          if (!parent) return;
          const targetChildren = getRFamilyChildrenList(parent, true);
          insertChildForSpouse(targetChildren, childForSpouse, spouseIndex);
        } else if (parentType === 'child') {
          const child = getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
          if (!child) return;
          if (!Array.isArray(child.grandchildren)) child.grandchildren = [];
          insertChildForSpouse(child.grandchildren, childForSpouse, spouseIndex);
        }
      }
    }
  } else {
    const relation = meta.relation || 'child';
    const path = meta.path || [];
    if (relation === 'parent') {
      const newParent = { ...newMember, spouse: '', children: [] };
      if (path.length === 0) {
        const oldRoot = treeData;
        newParent.children = [oldRoot];
        treeData = newParent;
      } else {
        const parentPath = path.slice(0, -1);
        const parentNode = getCoupleNodeByPath(treeData, parentPath);
        if (!parentNode || !Array.isArray(parentNode.children)) return;
        const childIndex = path[path.length - 1];
        const oldNode = parentNode.children[childIndex];
        if (!oldNode) return;
        newParent.children = [oldNode];
        parentNode.children.splice(childIndex, 1, newParent);
      }
    } else {
      const target = getCoupleNodeByPath(treeData, path);
      if (!target) return;
      if (!Array.isArray(target.children)) target.children = [];
      target.children.push({ ...newMember, spouse: '', children: [] });
    }
  }

  jsonEditor.value = JSON.stringify(treeData, null, 2);
  markAsChanged();
  scheduleVisualRender(true);
}

function getRFamilyParent(treeData, parentIndex) {
  if (!Array.isArray(treeData.Parent)) return null;
  return treeData.Parent[parentIndex] || null;
}

function getRFamilyChildrenList(parent, createIfMissing) {
  if (!parent || typeof parent !== 'object') return null;
  if (Array.isArray(parent.children)) return parent.children;
  if (Array.isArray(parent.grandchildren)) {
    if (createIfMissing) {
      parent.children = parent.grandchildren;
      delete parent.grandchildren;
      return parent.children;
    }
    return parent.grandchildren;
  }
  if (!createIfMissing) return null;
  parent.children = [];
  return parent.children;
}

function getStoredSpouseIndex(member) {
  if (!member || typeof member !== 'object') return 0;
  const rawSpouseIndex = Number(member.fromSpouseIndex);
  if (Number.isFinite(rawSpouseIndex)) {
    return Math.max(0, Math.trunc(rawSpouseIndex));
  }
  return member.fromPrevSpouse ? 1 : 0;
}

function insertChildForSpouse(targetList, member, spouseIndex) {
  if (!Array.isArray(targetList) || !member) return;
  const normalizedSpouseIndex = Number.isFinite(Number(spouseIndex))
    ? Math.max(0, Math.trunc(Number(spouseIndex)))
    : 0;
  let insertAt = targetList.length;
  for (let i = 0; i < targetList.length; i += 1) {
    if (getStoredSpouseIndex(targetList[i]) < normalizedSpouseIndex) {
      insertAt = i;
      break;
    }
  }
  targetList.splice(insertAt, 0, member);
}

function getRFamilyChild(treeData, parentIndex, childIndex) {
  const parent = getRFamilyParent(treeData, parentIndex);
  const children = getRFamilyChildrenList(parent, false);
  if (!children) return null;
  return children[childIndex] || null;
}

function getRFamilyGrandchild(treeData, parentIndex, childIndex, grandIndex) {
  const child = getRFamilyChild(treeData, parentIndex, childIndex);
  if (!child || !Array.isArray(child.grandchildren)) return null;
  return child.grandchildren[grandIndex] || null;
}

function getRFamilyTargetNode(treeData, meta) {
  const targetType = meta.type === 'ancestor' ? meta.targetType : meta.type;
  if (targetType === 'spouse') {
    const spouseMeta = (meta && meta.spouseMeta && typeof meta.spouseMeta === 'object')
      ? meta.spouseMeta
      : {
        parentType: meta.parentType,
        targetType: meta.parentTargetType,
        parentIndex: meta.parentIndex,
        childIndex: meta.childIndex,
        grandIndex: meta.grandIndex,
        spouseIndex: meta.spouseIndex,
        ancestorDepth: meta.ancestorDepth
      };
    return getRFamilySpouseRecord(treeData, spouseMeta, false);
  }
  if (targetType === 'root') return treeData;
  if (targetType === 'parent') return getRFamilyParent(treeData, meta.parentIndex);
  if (targetType === 'child') return getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
  if (targetType === 'grandchild') {
    return getRFamilyGrandchild(treeData, meta.parentIndex, meta.childIndex, meta.grandIndex);
  }
  return null;
}

function addSpouseToParentsData(parentsData, newMember) {
  if (!parentsData || !newMember) return;
  if (!Array.isArray(parentsData.spouse)) {
    parentsData.spouse = parentsData.spouse ? [parentsData.spouse] : [];
  }
  parentsData.spouse.push(newMember);
}

function addOrAppendParent(target, newMember) {
  if (!target || !newMember) return;
  if (!target.parents || typeof target.parents !== 'object') {
    target.parents = newMember;
    return;
  }
  const parentsData = target.parents;
  const existingName = safeText(parentsData.name);
  if (!existingName) {
    Object.assign(parentsData, newMember);
    return;
  }
  addOrAppendParent(parentsData, newMember);
}

function normalizeAncestorDepth(meta) {
  const rawDepth = Number(meta && meta.ancestorDepth);
  if (!Number.isFinite(rawDepth)) return 0;
  return Math.max(0, Math.trunc(rawDepth));
}

function getParentsAtDepth(target, depth, createIfMissing) {
  if (!target || typeof target !== 'object') return null;
  const normalizedDepth = Number.isFinite(Number(depth))
    ? Math.max(0, Math.trunc(Number(depth)))
    : 0;
  let cursor = target;
  for (let level = 0; level <= normalizedDepth; level += 1) {
    if (!cursor.parents || typeof cursor.parents !== 'object') {
      if (!createIfMissing) return null;
      cursor.parents = { name: '', image: '', birthday: '' };
    }
    if (level === normalizedDepth) {
      return cursor.parents;
    }
    cursor = cursor.parents;
  }
  return null;
}

function getRFamilyParentsData(treeData, meta, createIfMissing) {
  let targetMeta = meta;
  if (meta && meta.type === 'spouse' && meta.parentType === 'ancestor') {
    targetMeta = {
      type: 'ancestor',
      targetType: meta.targetType,
      parentIndex: meta.parentIndex,
      childIndex: meta.childIndex,
      grandIndex: meta.grandIndex,
      spouseMeta: meta.spouseMeta,
      ancestorDepth: meta.ancestorDepth
    };
  }
  const target = getRFamilyTargetNode(treeData, targetMeta);
  if (!target) return null;
  const depth = normalizeAncestorDepth(targetMeta);
  return getParentsAtDepth(target, depth, createIfMissing);
}

function getCoupleNodeByPath(treeData, path) {
  let node = treeData;
  for (let i = 0; i < path.length; i += 1) {
    if (!node || !Array.isArray(node.children)) return null;
    node = node.children[path[i]];
  }
  return node;
}

function isOriginMemberAtMeta(treeData, meta) {
  if (!treeData || !meta) return false;

  if (looksLikeRFamilySchema(treeData)) {
    if (meta.type === 'root') return !!treeData.isOrigin;
    if (meta.type === 'ancestor' || meta.type === 'spouse') return false;
    const target = getRFamilyTargetNode(treeData, meta);
    return !!(target && target.isOrigin);
  }

  if (meta.type === 'couple') {
    const target = getCoupleNodeByPath(treeData, meta.path || []);
    return !!(target && target.isOrigin);
  }

  return false;
}

function normalizeSpouseEntriesForStorage(spouses) {
  const list = Array.isArray(spouses) ? spouses.filter(Boolean) : [];
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return list;
}

// ============ DELETE MEMBER ============

function deleteMember(meta) {
  if (!meta) return;

  const jsonEditor = document.getElementById('jsonEditor');
  if (!jsonEditor) return;

  let treeData;
  try {
    treeData = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    showJsonStatus('JSON is invalid. Fix it before deleting members.', 'invalid');
    notifyUser('JSON is invalid. Fix it before deleting members.', 'warning');
    return;
  }

  if (isOriginMemberAtMeta(treeData, meta)) {
    notifyUser('Cannot delete the selected root person.', 'warning');
    return;
  }

  // Store the meta data and show the delete confirmation modal
  pendingDeleteMeta = meta;
  showDeleteConfirmModal();
}

function showDeleteConfirmModal() {
  window.AncestrioDomDisplay.show('deleteConfirmModal', 'flex');
}

function hideDeleteConfirmModal() {
  window.AncestrioDomDisplay.hide('deleteConfirmModal');
  pendingDeleteMeta = null;
}

function performDelete() {
  const meta = pendingDeleteMeta;
  if (!meta) return;

  const jsonEditor = document.getElementById('jsonEditor');
  let treeData;
  try {
    treeData = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    showJsonStatus('JSON is invalid. Fix it before deleting members.', 'invalid');
    notifyUser('JSON is invalid. Fix it before deleting members.', 'warning');
    hideDeleteConfirmModal();
    return;
  }

  if (looksLikeRFamilySchema(treeData)) {
    if (meta.type === 'root') {
      const spouses = extractSpouses(treeData.spouse);
      if (!spouses.length) {
        notifyUser('Cannot delete this person because no replacement root is available. Add a spouse first.', 'warning');
        hideDeleteConfirmModal();
        return;
      }

      const replacement = spouses[0];
      const replacementName = safeText(replacement && replacement.name ? replacement.name : replacement);
      if (!replacementName) {
        notifyUser('Cannot delete this person because the replacement root has no name.', 'warning');
        hideDeleteConfirmModal();
        return;
      }

      const remainingSpouses = spouses.slice(1).map((entry) => {
        if (typeof entry === 'string') {
          return { name: safeText(entry), image: '', birthday: '' };
        }
        return {
          ...entry,
          name: safeText(entry.name)
        };
      }).filter((entry) => safeText(entry && entry.name));

      treeData.Grandparent = replacementName;
      treeData.image = safeText(replacement && replacement.image);
      treeData.birthday = safeText(replacement && replacement.birthday);
      const replacementTags = Array.isArray(replacement && replacement.tags)
        ? replacement.tags
          .map((tag) => safeText(tag))
          .filter((tag) => tag.length > 0)
        : (safeText(replacement && replacement.tags)
          ? [safeText(replacement && replacement.tags)]
          : []);
      treeData.tags = replacementTags;
      treeData.spouse = normalizeSpouseEntriesForStorage(remainingSpouses);
      if (!replacementTags.length) {
        delete treeData.tags;
      }
    } else if (meta.type === 'spouse') {
      // Delete spouse from array based on parent type
      const spouseIndex = meta.spouseIndex !== undefined ? meta.spouseIndex : 0;
      if (meta.parentType === 'root') {
        if (Array.isArray(treeData.spouse)) {
          treeData.spouse.splice(spouseIndex, 1);
        }
      } else if (meta.parentType === 'ancestor') {
        const parentsData = getRFamilyParentsData(treeData, meta, false);
        if (parentsData && Array.isArray(parentsData.spouse)) {
          parentsData.spouse.splice(spouseIndex, 1);
        }
      } else if (meta.parentType === 'parent') {
        const parent = getRFamilyParent(treeData, meta.parentIndex);
        if (parent && Array.isArray(parent.spouse)) {
          parent.spouse.splice(spouseIndex, 1);
        }
      } else if (meta.parentType === 'child') {
        const child = getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
        if (child && Array.isArray(child.spouse)) {
          child.spouse.splice(spouseIndex, 1);
        }
      }
    } else if (meta.type === 'ancestor') {
      const target = getRFamilyTargetNode(treeData, meta);
      if (target) {
        const depth = normalizeAncestorDepth(meta);
        if (depth <= 0) {
          target.parents = null;
        } else {
          const parentLevel = getParentsAtDepth(target, depth - 1, false);
          if (parentLevel && typeof parentLevel === 'object') {
            parentLevel.parents = null;
          }
        }
      }
    } else if (meta.type === 'parent') {
      // Delete parent from array
      if (Array.isArray(treeData.Parent)) {
        treeData.Parent.splice(meta.parentIndex, 1);
      }
    } else if (meta.type === 'child') {
      // Delete child from parent's children array
      const parent = getRFamilyParent(treeData, meta.parentIndex);
      const children = getRFamilyChildrenList(parent, false);
      if (children) {
        children.splice(meta.childIndex, 1);
      }
    } else if (meta.type === 'grandchild') {
      // Delete grandchild from child's grandchildren array
      const child = getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
      if (child && Array.isArray(child.grandchildren)) {
        child.grandchildren.splice(meta.grandIndex, 1);
      }
    }
  } else {
    // Handle couple tree format
    const target = getCoupleNodeByPath(treeData, meta.path || []);
    if (target && Array.isArray(target.children)) {
      // Find and remove the child
      const index = target.children.findIndex((c) => c.name === meta.name);
      if (index !== -1) {
        target.children.splice(index, 1);
      }
    }
  }

  jsonEditor.value = JSON.stringify(treeData, null, 2);
  markAsChanged();
  scheduleVisualRender(true);
  hideDeleteConfirmModal();
}

// ============ ADD / EDIT MEMBER POPUP & MODAL ============

function initAddMemberUI() {
  const popup = document.getElementById('addMemberPopup');
  const modal = document.getElementById('addMemberModal');
  
  if (!popup || !modal) return;

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && !e.target.closest('.node-add') && !e.target.closest('#addPersonBtn')) {
      hideAddMemberPopup();
    }
  });

  // Popup item clicks
  popup.querySelectorAll('.add-member-popup-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingAddRelation = item.dataset.relation;
      hideAddMemberPopup();
      showAddMemberModal(pendingAddRelation);
    });
  });

  // Modal close handlers
  document.getElementById('closeAddMemberModal')?.addEventListener('click', hideAddMemberModal);
  document.getElementById('cancelAddMember')?.addEventListener('click', hideAddMemberModal);
  document.getElementById('confirmAddMember')?.addEventListener('click', confirmMemberModal);

  // Photo upload
  const photoPreview = document.getElementById('photoUploadPreview');
  const photoInput = document.getElementById('memberPhotoInput');
  photoPreview?.addEventListener('click', () => photoInput?.click());
  photoInput?.addEventListener('change', handleMemberPhotoSelect);
  document.getElementById('memberFirstName')?.addEventListener('input', (event) => {
    setInvalidField(event.target, false);
  });
  document.getElementById('memberLastName')?.addEventListener('input', (event) => {
    setInvalidField(event.target, false);
  });

  // Visited countries rows
  document.getElementById('addVisitedCountryBtn')?.addEventListener('click', () => {
    addVisitedCountryRow('');
  });

  // Close modal on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideAddMemberModal();
    }
  });
}

function showAddMemberPopup(event, meta) {
  const popup = document.getElementById('addMemberPopup');
  if (!popup) return;

  pendingAddMemberMeta = meta;
  pendingAddRelation = null;

  document.querySelectorAll('.node-add.active').forEach((btn) => {
    d3.select(btn).classed('active', false);
  });

  const anchorElement = event?.currentTarget;
  if (anchorElement && anchorElement.classList && anchorElement.classList.contains('node-add')) {
    d3.select(anchorElement).classed('active', true);
  }

  let anchorX = Number(event?.clientX ?? event?.pageX);
  let anchorY = Number(event?.clientY ?? event?.pageY);
  if (anchorElement && typeof anchorElement.getBoundingClientRect === 'function') {
    const rect = anchorElement.getBoundingClientRect();
    if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
      anchorX = rect.right + 8;
      anchorY = rect.top + (rect.height / 2);
    }
  }
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return;

  popup.classList.add('show');
  popup.style.visibility = 'hidden';
  popup.style.left = '0px';
  popup.style.top = '0px';

  const popupRect = popup.getBoundingClientRect();
  const popupWidth = Math.max(1, popupRect.width || 0);
  const popupHeight = Math.max(1, popupRect.height || 0);
  const viewportPadding = 12;

  let adjustedX = anchorX;
  let adjustedY = anchorY - (popupHeight / 2);

  if (adjustedX + popupWidth > window.innerWidth - viewportPadding) {
    adjustedX = anchorX - popupWidth - 12;
  }

  adjustedX = Math.min(
    Math.max(viewportPadding, adjustedX),
    Math.max(viewportPadding, window.innerWidth - popupWidth - viewportPadding)
  );
  adjustedY = Math.min(
    Math.max(viewportPadding, adjustedY),
    Math.max(viewportPadding, window.innerHeight - popupHeight - viewportPadding)
  );

  popup.style.left = `${Math.round(adjustedX)}px`;
  popup.style.top = `${Math.round(adjustedY)}px`;
  popup.style.visibility = '';
}

function hideAddMemberPopup() {
  const popup = document.getElementById('addMemberPopup');
  if (popup) {
    popup.classList.remove('show');
    popup.style.visibility = '';
    document.querySelectorAll('.node-add.active').forEach(btn => {
      d3.select(btn).classed('active', false);
    });
  }
  // Don't clear pendingAddMemberMeta here - we still need it for the modal form.
}

function showAddMemberModal(relation) {
  const modal = document.getElementById('addMemberModal');
  const title = document.getElementById('addMemberTitle');
  const confirmBtn = document.getElementById('confirmAddMember');
  const titleIcon = document.querySelector('.add-member-header h3 .material-symbols-outlined');
  
  if (!modal) return;

  memberModalMode = 'add';
  pendingEditMeta = null;

  const titles = {
    parent: 'Add Parent',
    spouse: 'Add Spouse',
    child: 'Add Child'
  };
  if (title) {
    title.textContent = titles[relation] || 'Add Family Member';
  }
  if (confirmBtn) {
    confirmBtn.textContent = 'Add Member';
  }
  if (titleIcon) {
    titleIcon.textContent = 'person_add';
  }

  resetAddMemberForm();
  modal.classList.add('show');
}

function showEditMemberModal(meta) {
  if (!meta) return;

  const modal = document.getElementById('addMemberModal');
  const title = document.getElementById('addMemberTitle');
  const confirmBtn = document.getElementById('confirmAddMember');
  const titleIcon = document.querySelector('.add-member-header h3 .material-symbols-outlined');
  const jsonEditor = document.getElementById('jsonEditor');
  if (!modal || !jsonEditor) return;

  hideAddMemberPopup();

  let treeData;
  try {
    treeData = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    showJsonStatus('JSON is invalid. Fix it before editing members.', 'invalid');
    notifyUser('JSON is invalid. Fix it before editing members.', 'warning');
    return;
  }

  const existing = getMemberAtMeta(treeData, meta);
  if (!existing) {
    notifyUser('Could not load this person for editing.', 'error');
    return;
  }

  memberModalMode = 'edit';
  pendingEditMeta = { ...meta };
  pendingAddMemberMeta = null;
  pendingAddRelation = null;

  if (title) {
    title.textContent = 'Edit Family Member';
  }
  if (confirmBtn) {
    confirmBtn.textContent = 'Save Changes';
  }
  if (titleIcon) {
    titleIcon.textContent = 'edit';
  }

  resetAddMemberForm();
  fillMemberForm(existing);
  modal.classList.add('show');
}

function hideAddMemberModal() {
  const modal = document.getElementById('addMemberModal');
  if (modal) {
    modal.classList.remove('show');
  }
  pendingAddMemberMeta = null;
  pendingAddRelation = null;
  pendingEditMeta = null;
  memberModalMode = 'add';
}

function resetAddMemberForm() {
  const firstNameInput = document.getElementById('memberFirstName');
  const lastNameInput = document.getElementById('memberLastName');
  const birthdayInput = document.getElementById('memberBirthday');
  if (firstNameInput) firstNameInput.value = '';
  if (lastNameInput) lastNameInput.value = '';
  if (birthdayInput) birthdayInput.value = '';
  setInvalidField(firstNameInput, false);
  setInvalidField(lastNameInput, false);

  updateMemberPhotoPreview('');

  const photoInput = document.getElementById('memberPhotoInput');
  if (photoInput) {
    photoInput.value = '';
  }

  visitedCountries = [''];
  renderVisitedCountryRows();
}

function fillMemberForm(memberData) {
  const firstNameInput = document.getElementById('memberFirstName');
  const lastNameInput = document.getElementById('memberLastName');
  const birthdayInput = document.getElementById('memberBirthday');
  const nameParts = splitMemberName(memberData?.name || '');
  if (firstNameInput) firstNameInput.value = nameParts.firstName;
  if (lastNameInput) lastNameInput.value = nameParts.lastName;
  if (birthdayInput) birthdayInput.value = memberData?.birthday || '';
  setInvalidField(firstNameInput, false);
  setInvalidField(lastNameInput, false);

  updateMemberPhotoPreview(memberData?.image || '');

  visitedCountries = normalizeVisitedCountries(memberData?.visited);
  if (!visitedCountries.length) {
    visitedCountries = [''];
  }
  renderVisitedCountryRows();
}

async function handleMemberPhotoSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type || !file.type.startsWith('image/')) {
    notifyUser('Please select a valid image file.', 'warning');
    event.target.value = '';
    return;
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    const optimized = await compressImageDataUrl(rawDataUrl, {
      maxBytes: MEMBER_IMAGE_MAX_BYTES,
      maxDimension: MEMBER_IMAGE_MAX_DIMENSION,
      minDimension: MEMBER_IMAGE_MIN_DIMENSION
    });

    if (!optimized) {
      notifyUser('This photo is still too large after compression. Please choose a smaller image.', 'warning');
      event.target.value = '';
      return;
    }

    updateMemberPhotoPreview(optimized);

    if (getUtf8Size(rawDataUrl) > getUtf8Size(optimized)) {
      notifyUser('Photo optimized to keep tree size within Firestore limits.', 'info', { duration: 3200 });
    }
  } catch (error) {
    console.error('Failed to process uploaded photo:', error);
    notifyUser('Could not read this image. Please try another file.', 'error');
    event.target.value = '';
  }
}

function updateMemberPhotoPreview(imageValue) {
  const photoPreview = document.getElementById('photoUploadPreview');
  const photoImg = document.getElementById('photoPreviewImg');
  const photoIcon = photoPreview?.querySelector('.material-symbols-outlined');
  memberPhotoValue = safeText(imageValue);

  if (photoImg) {
    if (memberPhotoValue) {
      photoImg.src = memberPhotoValue;
      window.AncestrioDomDisplay.show(photoImg);
    } else {
      photoImg.src = '';
      window.AncestrioDomDisplay.hide(photoImg);
    }
  }

  if (photoIcon) {
    window.AncestrioDomDisplay.setDisplay(photoIcon, memberPhotoValue ? 'none' : 'block');
  }
}

function addVisitedCountryRow(value = '') {
  visitedCountries.push(value);
  renderVisitedCountryRows();
}

function renderVisitedCountryRows() {
  const list = document.getElementById('visitedCountriesList');
  if (!list) return;

  if (!visitedCountries.length) {
    visitedCountries = [''];
  }

  list.innerHTML = '';
  visitedCountries.forEach((country, index) => {
    const row = document.createElement('div');
    row.className = 'person-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field-input person-row-input';
    input.placeholder = 'Country name';
    input.value = country;
    input.addEventListener('input', (event) => {
      visitedCountries[index] = event.target.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-secondary btn-inline btn-remove-person';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      if (visitedCountries.length === 1) {
        visitedCountries[0] = '';
      } else {
        visitedCountries.splice(index, 1);
      }
      renderVisitedCountryRows();
    });

    row.appendChild(input);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

function normalizeVisitedCountries(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => safeText(entry))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => safeText(entry))
      .filter(Boolean);
  }
  return [];
}

function collectVisitedCountriesFromForm() {
  return visitedCountries
    .map((entry) => safeText(entry))
    .filter(Boolean);
}

function splitMemberName(fullName) {
  const parts = safeText(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: '', lastName: '' };
  }
  const firstName = parts.shift() || '';
  return {
    firstName,
    lastName: parts.join(' ')
  };
}

function collectMemberFormData() {
  const firstNameEl = document.getElementById('memberFirstName');
  const lastNameEl = document.getElementById('memberLastName');
  const birthdayEl = document.getElementById('memberBirthday');
  if (!firstNameEl || !lastNameEl || !birthdayEl) {
    notifyUser('Form is missing required inputs. Please refresh and try again.');
    return null;
  }

  const firstName = firstNameEl.value.trim();
  const lastName = lastNameEl.value.trim();
  setInvalidField(firstNameEl, false);
  setInvalidField(lastNameEl, false);
  if (!firstName || !lastName) {
    if (!firstName) setInvalidField(firstNameEl, true);
    if (!lastName) setInvalidField(lastNameEl, true);
    notifyUser('Please fill in both First Name and Last Name.', 'warning');
    return null;
  }

  return {
    name: `${firstName} ${lastName}`.trim(),
    image: memberPhotoValue,
    birthday: birthdayEl.value.trim(),
    visited: collectVisitedCountriesFromForm()
  };
}

function confirmMemberModal() {
  const memberData = collectMemberFormData();
  if (!memberData) return;

  if (memberModalMode === 'edit') {
    if (!pendingEditMeta) {
      notifyUser('Could not determine which member to edit.');
      return;
    }
    const updated = updateMemberAt(pendingEditMeta, memberData);
    if (!updated) {
      return;
    }
    hideAddMemberModal();
    return;
  }

  if (!pendingAddMemberMeta) {
    notifyUser('Could not determine where to add this member.');
    return;
  }

  const metaWithRelation = { ...pendingAddMemberMeta, relation: pendingAddRelation };
  addMemberAt(metaWithRelation, memberData);
  hideAddMemberModal();
}

function extractMemberDataFromRecord(record, nameField = 'name') {
  if (record === null || record === undefined) return null;
  if (typeof record === 'string') {
    const name = safeText(record);
    if (!name) return null;
    return { name, image: '', birthday: '', visited: [] };
  }
  if (typeof record !== 'object') return null;

  const name = safeText(record[nameField]);
  if (!name) return null;

  return {
    name,
    image: safeText(record.image),
    birthday: safeText(record.birthday),
    visited: normalizeVisitedCountries(record.visited)
  };
}

function normalizeIndex(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function getRFamilySpouseContainer(treeData, meta) {
  if (!meta) return null;
  if (meta.parentType === 'root') {
    return treeData;
  }
  if (meta.parentType === 'ancestor') {
    return getRFamilyParentsData(treeData, meta, false);
  }
  if (meta.parentType === 'parent') {
    return getRFamilyParent(treeData, meta.parentIndex);
  }
  if (meta.parentType === 'child') {
    return getRFamilyChild(treeData, meta.parentIndex, meta.childIndex);
  }
  if (meta.parentType === 'grandchild') {
    return getRFamilyGrandchild(treeData, meta.parentIndex, meta.childIndex, meta.grandIndex);
  }
  return null;
}

function getRFamilySpouseRecord(treeData, meta, createIfMissing) {
  const container = getRFamilySpouseContainer(treeData, meta);
  if (!container || typeof container !== 'object') return null;

  if (!Array.isArray(container.spouse)) {
    container.spouse = container.spouse ? [container.spouse] : [];
  }

  const spouseIndex = normalizeIndex(meta && meta.spouseIndex);
  if (spouseIndex >= container.spouse.length) {
    if (!createIfMissing) return null;
    while (container.spouse.length <= spouseIndex) {
      container.spouse.push({ name: '', image: '', birthday: '' });
    }
  }

  const current = container.spouse[spouseIndex];
  const spouseRecord = (current && typeof current === 'object')
    ? current
    : { name: safeText(current) };
  container.spouse[spouseIndex] = spouseRecord;

  return spouseRecord;
}

function getMemberAtMeta(treeData, meta) {
  if (!meta) return null;

  if (looksLikeRFamilySchema(treeData)) {
    if (meta.type === 'root') {
      return extractMemberDataFromRecord(treeData, 'Grandparent');
    }
    if (meta.type === 'ancestor') {
      const parentsData = getRFamilyParentsData(treeData, meta, false);
      return extractMemberDataFromRecord(parentsData);
    }
    if (meta.type === 'spouse') {
      const container = getRFamilySpouseContainer(treeData, meta);
      if (!container) return null;
      const spouses = extractSpouses(container.spouse);
      const spouse = spouses[normalizeIndex(meta.spouseIndex)];
      return extractMemberDataFromRecord(spouse);
    }
    const target = getRFamilyTargetNode(treeData, meta);
    return extractMemberDataFromRecord(target);
  }

  if (meta.type === 'couple') {
    const target = getCoupleNodeByPath(treeData, meta.path || []);
    return extractMemberDataFromRecord(target);
  }
  if (meta.type === 'spouse' && meta.parentType === 'couple') {
    const primary = getCoupleNodeByPath(treeData, meta.path || []);
    if (!primary) return null;
    const spouses = extractSpouses(primary.spouse);
    const spouse = spouses[normalizeIndex(meta.spouseIndex)];
    return extractMemberDataFromRecord(spouse);
  }

  return null;
}

function applyMemberFields(record, memberData, nameField = 'name') {
  if (!record || typeof record !== 'object') return false;
  record[nameField] = memberData.name;
  record.image = memberData.image || '';
  record.birthday = memberData.birthday || '';
  if (Array.isArray(memberData.visited) && memberData.visited.length > 0) {
    record.visited = memberData.visited;
  } else {
    delete record.visited;
  }
  return true;
}

function applyMemberUpdateAtMeta(treeData, meta, memberData) {
  if (!meta) return false;

  if (looksLikeRFamilySchema(treeData)) {
    if (meta.type === 'root') {
      return applyMemberFields(treeData, memberData, 'Grandparent');
    }
    if (meta.type === 'ancestor') {
      const parentsData = getRFamilyParentsData(treeData, meta, false);
      if (!parentsData) return false;
      return applyMemberFields(parentsData, memberData);
    }
    if (meta.type === 'spouse') {
      const spouseRecord = getRFamilySpouseRecord(treeData, meta, false);
      if (!spouseRecord) return false;
      applyMemberFields(spouseRecord, memberData);
      return true;
    }
    const target = getRFamilyTargetNode(treeData, meta);
    if (!target || typeof target !== 'object') return false;
    return applyMemberFields(target, memberData);
  }

  if (meta.type === 'couple') {
    const target = getCoupleNodeByPath(treeData, meta.path || []);
    if (!target || typeof target !== 'object') return false;
    return applyMemberFields(target, memberData);
  }
  if (meta.type === 'spouse' && meta.parentType === 'couple') {
    const primary = getCoupleNodeByPath(treeData, meta.path || []);
    if (!primary) return false;
    if (!Array.isArray(primary.spouse)) {
      primary.spouse = primary.spouse ? [primary.spouse] : [];
    }
    const spouseIndex = normalizeIndex(meta.spouseIndex);
    if (spouseIndex >= primary.spouse.length) return false;
    const current = primary.spouse[spouseIndex];
    const spouseRecord = (current && typeof current === 'object')
      ? current
      : { name: safeText(current) };
    applyMemberFields(spouseRecord, memberData);
    primary.spouse[spouseIndex] = spouseRecord;
    return true;
  }

  return false;
}

function updateMemberAt(meta, memberData) {
  if (!meta || !memberData) return false;

  const jsonEditor = document.getElementById('jsonEditor');
  if (!jsonEditor) return false;

  let treeData;
  try {
    treeData = JSON.parse(jsonEditor.value || '{}');
  } catch (e) {
    showJsonStatus('JSON is invalid. Fix it before editing members.', 'invalid');
    notifyUser('JSON is invalid. Fix it before editing members.', 'warning');
    return false;
  }

  const updated = applyMemberUpdateAtMeta(treeData, meta, memberData);
  if (!updated) {
    notifyUser('Could not save changes for this person.', 'error');
    return false;
  }

  jsonEditor.value = JSON.stringify(treeData, null, 2);
  markAsChanged();
  scheduleVisualRender(false);
  return true;
}



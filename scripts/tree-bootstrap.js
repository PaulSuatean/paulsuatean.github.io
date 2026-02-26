window.FIREBASE_TREE_DATA = null;
window.FIREBASE_TREE_NAME = null;
window.FIREBASE_TREE_SETTINGS = null;
window.IS_LOCAL_PREVIEW = false;

function parseTreeFeatureFlag(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

function resolveTreeViewerSettings(source) {
  const calendarFlag = (source && Object.prototype.hasOwnProperty.call(source, 'enableCalendarDates'))
    ? source.enableCalendarDates
    : source?.enableBirthdays;

  return {
    enableCalendarDates: parseTreeFeatureFlag(calendarFlag, true),
    enableGlobeCountries: parseTreeFeatureFlag(source?.enableGlobeCountries, true)
  };
}

window.FIREBASE_TREE_READY = (async function () {
  const urlParams = new URLSearchParams(window.location.search);
  const treeId = urlParams.get('id');
  const previewKey = urlParams.get('previewKey');
  const maxPreviewAgeMs = 6 * 60 * 60 * 1000;

  if (previewKey) {
    try {
      const rawPreview = localStorage.getItem(previewKey);
      if (rawPreview) {
        const preview = JSON.parse(rawPreview);
        const previewData = preview && typeof preview === 'object' ? preview.data : null;
        const previewName = preview && typeof preview.name === 'string' ? preview.name : 'Family Tree Preview';
        const createdAt = Number(preview && preview.createdAt);
        const isFresh = Number.isFinite(createdAt) && (Date.now() - createdAt) <= maxPreviewAgeMs;

        if (previewData && isFresh) {
          window.FIREBASE_TREE_DATA = previewData;
          window.FIREBASE_TREE_NAME = previewName;
          window.FIREBASE_TREE_SETTINGS = resolveTreeViewerSettings(preview);
          window.IS_LOCAL_PREVIEW = true;
          document.getElementById('treeName').textContent = previewName;
          console.log('Loaded tree data from local preview draft');
          return;
        }
      }
    } catch (previewError) {
      console.warn('Failed to load local preview draft:', previewError);
    }
  }

  // If no tree ID, use default name and let main.js load from rfamily.json
  if (!treeId) {
    document.getElementById('treeName').textContent = 'Family Tree';
    console.log('No tree ID provided, will load local data');
    return;
  }

  try {
    // Initialize Firebase only for non-local previews.
    if (typeof initializeFirebase === 'function') {
      initializeFirebase();
    }

    const waitForAuthState = () => new Promise((resolve) => {
      if (!firebase.auth) {
        resolve(null);
        return;
      }

      const authInstance = firebase.auth();
      let settled = false;
      let unsubscribe = null;

      const finish = (user) => {
        if (settled) return;
        settled = true;
        if (unsubscribe) unsubscribe();
        clearTimeout(timeoutId);
        resolve(user || null);
      };

      const timeoutId = setTimeout(() => {
        finish(authInstance.currentUser);
      }, 3000);

      unsubscribe = authInstance.onAuthStateChanged(
        (user) => finish(user),
        () => finish(authInstance.currentUser)
      );
    });

    const currentUser = await waitForAuthState();
    const docRef = firebase.firestore().collection('trees').doc(treeId);
    let doc = null;

    try {
      doc = await docRef.get({ source: 'server' });
    } catch (serverError) {
      console.warn('Server fetch failed, trying default source:', serverError);
      doc = await docRef.get();
    }

    if (!doc.exists) {
      document.getElementById('treeName').textContent = 'Tree not found';
      console.warn('Tree not found:', treeId);
      return;
    }

    const tree = doc.data();

    if (tree.privacy === 'private' && (!currentUser || currentUser.uid !== tree.userId)) {
      document.getElementById('treeName').textContent = 'Private tree';
      console.warn('Tree is private');
      return;
    }

    window.FIREBASE_TREE_DATA = tree.data;
    window.FIREBASE_TREE_NAME = tree.name;
    window.FIREBASE_TREE_SETTINGS = resolveTreeViewerSettings(tree);
    document.getElementById('treeName').textContent = tree.name;
    console.log('Firebase tree data loaded successfully');
  } catch (error) {
    console.error('Error loading tree:', error);
    document.getElementById('treeName').textContent = 'Error loading tree';
    // Still allow fallback to local data.
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('backBtn')?.addEventListener('click', (event) => {
    event.preventDefault();

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    // Fallback when there is no browser history entry.
    if (window.IS_LOCAL_PREVIEW) {
      const urlParams = new URLSearchParams(window.location.search);
      const fallbackTreeId = urlParams.get('id');
      window.location.href = fallbackTreeId ? `editor.html?id=${encodeURIComponent(fallbackTreeId)}` : 'editor.html';
      return;
    }

    // Guard when page is loaded without an initialized Firebase app.
    const hasFirebaseApp = typeof firebase !== 'undefined' && Array.isArray(firebase.apps) && firebase.apps.length > 0;
    const loggedIn = hasFirebaseApp && firebase.auth().currentUser;
    window.location.href = loggedIn ? 'dashboard.html' : 'auth.html';
  });
});

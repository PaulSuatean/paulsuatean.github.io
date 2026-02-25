/*
  Tree data loading helpers extracted from main.js.
  This module keeps data-fetch concerns separate from rendering concerns.
*/

(function () {
  function loadDataSequential(paths) {
    return new Promise((resolve, reject) => {
      const tryAt = (i) => {
        if (i >= paths.length) {
          const err = new Error('No data file found at any path: ' + paths.join(', '));
          console.error(err.message);
          return reject(err);
        }
        const url = paths[i];
        console.log(`Trying to load from: ${url}`);
        fetch(url)
          .then((r) => {
            console.log(`Response from ${url}: ${r.status} ${r.statusText}`);
            if (!r.ok) throw new Error('HTTP ' + r.status + ' at ' + paths[i]);
            return r.json();
          })
          .then((data) => {
            console.log(`Successfully loaded data from: ${url}`);
            resolve(data);
          })
          .catch((err) => {
            console.warn(`Failed to load from ${url}:`, err.message);
            tryAt(i + 1);
          });
      };
      tryAt(0);
    });
  }

  async function loadTreeData() {
    if (typeof window !== 'undefined' && window.FIREBASE_TREE_READY) {
      console.log('Waiting for Firebase tree data to load...');
      try {
        await window.FIREBASE_TREE_READY;
        console.log('Firebase tree data ready');
      } catch (err) {
        console.warn('Firebase tree data loading failed:', err);
      }
    }

    if (typeof window !== 'undefined' && window.FIREBASE_TREE_DATA) {
      console.log('Loading data from Firebase:', window.FIREBASE_TREE_DATA);
      return Promise.resolve(window.FIREBASE_TREE_DATA);
    }

    console.log('Loading data from local rfamily.json');
    return loadDataSequential(['../data/rfamily.json', '/data/rfamily.json']);
  }

  window.AncestrioDataLoader = window.AncestrioDataLoader || {};
  window.AncestrioDataLoader.loadDataSequential = loadDataSequential;
  window.AncestrioDataLoader.loadTreeData = loadTreeData;
})();

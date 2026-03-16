(function (global) {
  const modules = new Proxy({}, {
    get(_target, prop) {
      const currentModules = global.AncestrioFirebaseModules;
      return currentModules ? currentModules[prop] : undefined;
    }
  });

  const firebaseConfig = {
    apiKey: 'AIzaSyDrWuTxMHuoGQvt9DWxelDl-3lDn0Sf20g',
    authDomain: 'ancestrio.firebaseapp.com',
    projectId: 'ancestrio',
    messagingSenderId: '1029073457660',
    appId: '1:1029073457660:web:6c2a2ad532e96ba4bee279'
  };

  let app = null;
  let authInstance = null;
  let dbInstance = null;
  let authFacade = null;
  let dbFacade = null;
  let firebaseFacade = null;
  let authEmulatorConnected = false;
  let firestoreEmulatorConnected = false;

  const userFacadeCache = new WeakMap();
  const docRefFacadeCache = new WeakMap();
  const docSnapshotFacadeCache = new WeakMap();

  Object.defineProperty(global, 'db', {
    get() {
      return dbFacade;
    },
    configurable: true
  });

  Object.defineProperty(global, 'auth', {
    get() {
      return authFacade;
    },
    configurable: true
  });

  const LOCAL_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const isLocalhost = LOCAL_LOOPBACK_HOSTS.has(global.location.hostname);
  const emulatorFlag = new URLSearchParams(global.location.search).get('emulator');
  const useEmulator = isLocalhost && (emulatorFlag === '1' || emulatorFlag === 'true');
  const isDevelopment = useEmulator;
  const emulatorHost = global.location.hostname === '127.0.0.1' ? '127.0.0.1' : 'localhost';
  const authEmulatorUrl = `http://${emulatorHost}:9099`;

  global.AncestrioFirebase = global.AncestrioFirebase || {};
  global.AncestrioFirebase.isDevelopment = isDevelopment;
  global.AncestrioFirebase.authEmulatorUrl = authEmulatorUrl;
  global.AncestrioFirebase.authEmulatorReachable = null;

  function hasModules() {
    return Boolean(global.AncestrioFirebaseModules);
  }

  function hasCompatFirebase() {
    return Boolean(
      global.firebase &&
      !global.firebase.__ancestrioModern &&
      typeof global.firebase.initializeApp === 'function'
    );
  }

  function notifyUser(message, type = 'error', options = {}) {
    if (global.AncestrioRuntime && typeof global.AncestrioRuntime.notify === 'function') {
      global.AncestrioRuntime.notify(message, type, options);
      return;
    }
    if (type === 'error') {
      console.error(message);
    } else {
      console.warn(message);
    }
  }

  function probeAuthEmulator(url) {
    if (typeof fetch !== 'function') return;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = setTimeout(() => {
      if (controller) {
        controller.abort();
      }
    }, 2000);

    fetch(`${url}/`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(() => {
      global.AncestrioFirebase.authEmulatorReachable = true;
    }).catch((error) => {
      global.AncestrioFirebase.authEmulatorReachable = false;
      const detail = error && error.message ? error.message : String(error || 'unknown error');
      console.warn(`Auth emulator probe failed at ${url}: ${detail}`);
      notifyUser(
        `Auth emulator is not reachable at ${url}. Start it with "firebase emulators:start --only auth,firestore".`,
        'warning',
        { duration: 9000 }
      );
    }).finally(() => {
      clearTimeout(timeoutId);
    });
  }

  function readSourceMode(options) {
    const source = options && options.source;
    return source === 'cache' || source === 'server' ? source : '';
  }

  function ensureModulesAvailable() {
    if (hasModules()) return true;
    console.error('Firebase module bridge not loaded');
    notifyUser('Firebase bundle failed to load. Please refresh the page.', 'error', { duration: 7000 });
    return false;
  }

  function wrapUser(user) {
    if (!user) return null;
    if (userFacadeCache.has(user)) {
      return userFacadeCache.get(user);
    }

    const facade = new Proxy(user, {
      get(target, prop, receiver) {
        if (prop === 'updateProfile') {
          return function updateProfileCompat(profile) {
            return modules.auth.updateProfile(target, profile || {});
          };
        }
        if (prop === 'reauthenticateWithCredential') {
          return function reauthenticateWithCredentialCompat(credential) {
            return modules.auth.reauthenticateWithCredential(target, credential);
          };
        }
        if (prop === 'reauthenticateWithPopup') {
          return function reauthenticateWithPopupCompat(provider) {
            return modules.auth.reauthenticateWithPopup(target, provider);
          };
        }
        if (prop === 'delete') {
          return function deleteCompat() {
            return modules.auth.deleteUser(target);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    userFacadeCache.set(user, facade);
    return facade;
  }

  function wrapUserCredential(result) {
    if (!result || typeof result !== 'object') return result;
    return Object.assign({}, result, {
      user: wrapUser(result.user)
    });
  }

  function wrapDocumentSnapshot(snapshot) {
    if (!snapshot) return null;
    if (docSnapshotFacadeCache.has(snapshot)) {
      return docSnapshotFacadeCache.get(snapshot);
    }

    const facade = {
      get id() {
        return snapshot.id;
      },
      get exists() {
        return snapshot.exists();
      },
      get ref() {
        return wrapDocumentReference(snapshot.ref);
      },
      data() {
        return snapshot.data();
      }
    };

    docSnapshotFacadeCache.set(snapshot, facade);
    return facade;
  }

  function wrapQuerySnapshot(snapshot) {
    if (!snapshot) return null;
    return {
      get empty() {
        return snapshot.empty;
      },
      get size() {
        return snapshot.size;
      },
      get docs() {
        return snapshot.docs.map(wrapDocumentSnapshot);
      },
      forEach(callback, thisArg) {
        snapshot.docs.forEach((docSnapshot, index) => {
          callback.call(thisArg, wrapDocumentSnapshot(docSnapshot), index);
        });
      }
    };
  }

  function getDocumentSnapshot(ref, options) {
    const source = readSourceMode(options);
    if (source === 'cache') {
      return modules.firestore.getDocFromCache(ref);
    }
    if (source === 'server') {
      return modules.firestore.getDocFromServer(ref);
    }
    return modules.firestore.getDoc(ref);
  }

  function getQuerySnapshot(queryRef, options) {
    const source = readSourceMode(options);
    if (source === 'cache') {
      return modules.firestore.getDocsFromCache(queryRef);
    }
    if (source === 'server') {
      return modules.firestore.getDocsFromServer(queryRef);
    }
    return modules.firestore.getDocs(queryRef);
  }

  function createQueryFacade(reference, constraints) {
    const queryConstraints = Array.isArray(constraints) ? constraints : [];

    function asQuery() {
      if (!queryConstraints.length) return reference;
      return modules.firestore.query(reference, ...queryConstraints);
    }

    return {
      where(field, op, value) {
        return createQueryFacade(reference, queryConstraints.concat(modules.firestore.where(field, op, value)));
      },
      orderBy(field, direction) {
        return createQueryFacade(reference, queryConstraints.concat(modules.firestore.orderBy(field, direction)));
      },
      limit(count) {
        return createQueryFacade(reference, queryConstraints.concat(modules.firestore.limit(count)));
      },
      get(options) {
        return getQuerySnapshot(asQuery(), options).then(wrapQuerySnapshot);
      },
      onSnapshot(next, error) {
        return modules.firestore.onSnapshot(
          asQuery(),
          (snapshot) => {
            if (typeof next === 'function') {
              next(wrapQuerySnapshot(snapshot));
            }
          },
          error
        );
      }
    };
  }

  function wrapCollectionReference(collectionRef) {
    const queryFacade = createQueryFacade(collectionRef, []);
    return {
      where: queryFacade.where,
      orderBy: queryFacade.orderBy,
      limit: queryFacade.limit,
      get: queryFacade.get,
      onSnapshot: queryFacade.onSnapshot,
      doc(id) {
        return wrapDocumentReference(modules.firestore.doc(collectionRef, String(id)));
      },
      add(data) {
        return modules.firestore.addDoc(collectionRef, data).then(wrapDocumentReference);
      }
    };
  }

  function wrapDocumentReference(ref) {
    if (!ref) return null;
    if (docRefFacadeCache.has(ref)) {
      return docRefFacadeCache.get(ref);
    }

    const facade = {
      get id() {
        return ref.id;
      },
      get(options) {
        return getDocumentSnapshot(ref, options).then(wrapDocumentSnapshot);
      },
      set(data, options) {
        if (options && typeof options === 'object') {
          return modules.firestore.setDoc(ref, data, options);
        }
        return modules.firestore.setDoc(ref, data);
      },
      update(data) {
        return modules.firestore.updateDoc(ref, data);
      },
      delete() {
        return modules.firestore.deleteDoc(ref);
      }
    };

    docRefFacadeCache.set(ref, facade);
    return facade;
  }

  function buildAuthFacade() {
    if (!authInstance) return null;
    if (authFacade) return authFacade;

    const settings = {
      appVerificationDisabledForTesting: false
    };

    authFacade = {
      settings,
      get currentUser() {
        return wrapUser(authInstance.currentUser);
      },
      onAuthStateChanged(next, error, completed) {
        return modules.auth.onAuthStateChanged(
          authInstance,
          (user) => {
            const wrappedUser = wrapUser(user);
            if (typeof next === 'function') {
              next(wrappedUser);
              return;
            }
            if (next && typeof next.next === 'function') {
              next.next(wrappedUser);
            }
          },
          error,
          completed
        );
      },
      createUserWithEmailAndPassword(email, password) {
        return modules.auth.createUserWithEmailAndPassword(authInstance, email, password)
          .then(wrapUserCredential);
      },
      signInWithEmailAndPassword(email, password) {
        return modules.auth.signInWithEmailAndPassword(authInstance, email, password)
          .then(wrapUserCredential);
      },
      signInWithPopup(provider) {
        return modules.auth.signInWithPopup(authInstance, provider)
          .then(wrapUserCredential);
      },
      sendPasswordResetEmail(email) {
        return modules.auth.sendPasswordResetEmail(authInstance, email);
      },
      signOut() {
        return modules.auth.signOut(authInstance);
      },
      useEmulator(url) {
        modules.auth.connectAuthEmulator(authInstance, url, { disableWarnings: true });
      }
    };

    return authFacade;
  }

  function buildDbFacade() {
    if (!dbInstance) return null;
    if (dbFacade) return dbFacade;

    dbFacade = {
      collection(name) {
        return wrapCollectionReference(modules.firestore.collection(dbInstance, String(name)));
      }
    };

    return dbFacade;
  }

  function installLegacyFirebaseFacade() {
    if (hasCompatFirebase()) {
      firebaseFacade = global.firebase;
      return firebaseFacade;
    }

    if (!hasModules() && !app) {
      return null;
    }

    if (firebaseFacade) {
      global.firebase = firebaseFacade;
      return firebaseFacade;
    }

    const authAccessor = function authAccessor() {
      return buildAuthFacade();
    };
    authAccessor.GoogleAuthProvider = hasModules()
      ? modules.auth.GoogleAuthProvider
      : function MissingGoogleProvider() {};
    authAccessor.EmailAuthProvider = hasModules()
      ? modules.auth.EmailAuthProvider
      : { credential() { return null; } };

    const firestoreAccessor = function firestoreAccessor() {
      return buildDbFacade();
    };
    firestoreAccessor.FieldValue = Object.freeze({
      serverTimestamp: function serverTimestampCompat() {
        if (hasModules()) {
          return modules.firestore.serverTimestamp();
        }
        if (
          hasCompatFirebase() &&
          global.firebase.firestore &&
          global.firebase.firestore.FieldValue &&
          typeof global.firebase.firestore.FieldValue.serverTimestamp === 'function'
        ) {
          return global.firebase.firestore.FieldValue.serverTimestamp();
        }
        return null;
      }
    });

    firebaseFacade = {
      __ancestrioModern: true,
      app() {
        return app;
      },
      get apps() {
        return app ? [app] : [];
      },
      initializeApp() {
        if (!app) {
          initializeFirebase();
        }
        return app;
      },
      auth: authAccessor,
      firestore: firestoreAccessor
    };

    global.firebase = firebaseFacade;
    return firebaseFacade;
  }

  function dispatchReadyEvent() {
    try {
      document.dispatchEvent(new CustomEvent('ancestrio:firebase-ready', {
        detail: {
          app,
          auth: buildAuthFacade(),
          db: buildDbFacade()
        }
      }));
    } catch (_) {
      // Ignore event dispatch failures in older browsers.
    }
  }

  function initializeCompatFirebase() {
    if (!hasCompatFirebase()) {
      return false;
    }

    try {
      if (global.firebase.apps && global.firebase.apps.length) {
        app = global.firebase.app();
      } else {
        app = global.firebase.initializeApp(firebaseConfig);
      }

      authInstance = global.firebase.auth();
      dbInstance = global.firebase.firestore();
      authFacade = authInstance;
      dbFacade = dbInstance;
      firebaseFacade = global.firebase;

      if (isDevelopment) {
        authFacade.settings.appVerificationDisabledForTesting = true;

        if (!authEmulatorConnected) {
          try {
            authFacade.useEmulator(authEmulatorUrl);
            authEmulatorConnected = true;
            probeAuthEmulator(authEmulatorUrl);
          } catch (error) {
            console.error('Auth emulator connection failed:', error.message);
          }
        }

        if (!firestoreEmulatorConnected) {
          try {
            dbFacade.useEmulator(emulatorHost, 8080);
            firestoreEmulatorConnected = true;
          } catch (error) {
            console.error('Firestore emulator connection failed:', error.message);
          }
        }
      }

      dispatchReadyEvent();
      return true;
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      notifyUser(`Firebase initialization failed: ${error.message}`, 'error', { duration: 7000 });
      return false;
    }
  }

  function initializeFirebase() {
    if (!hasModules()) {
      return initializeCompatFirebase();
    }

    if (!ensureModulesAvailable()) {
      return false;
    }

    try {
      if (!app) {
        app = modules.app.getApps().length
          ? modules.app.getApp()
          : modules.app.initializeApp(firebaseConfig);
      }

      if (!authInstance) {
        authInstance = modules.auth.getAuth(app);
      }

      if (!dbInstance) {
        dbInstance = modules.firestore.getFirestore(app);
      }

      authFacade = null;
      dbFacade = null;
      installLegacyFirebaseFacade();
      buildAuthFacade();
      buildDbFacade();

      if (isDevelopment) {
        authFacade.settings.appVerificationDisabledForTesting = true;

        if (!authEmulatorConnected) {
          try {
            authFacade.useEmulator(authEmulatorUrl);
            authEmulatorConnected = true;
            probeAuthEmulator(authEmulatorUrl);
          } catch (error) {
            console.error('Auth emulator connection failed:', error.message);
          }
        }

        if (!firestoreEmulatorConnected) {
          try {
            modules.firestore.connectFirestoreEmulator(dbInstance, emulatorHost, 8080);
            firestoreEmulatorConnected = true;
          } catch (error) {
            console.error('Firestore emulator connection failed:', error.message);
          }
        }
      }

      dispatchReadyEvent();
      return true;
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      notifyUser(`Firebase initialization failed: ${error.message}`, 'error', { duration: 7000 });
      return false;
    }
  }

  global.initializeFirebase = initializeFirebase;
  if (hasModules() || hasCompatFirebase()) {
    installLegacyFirebaseFacade();
  }
})(window);

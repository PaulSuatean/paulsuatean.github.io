// Authentication Logic

document.addEventListener('DOMContentLoaded', () => {
  console.log('Auth page loaded');
  const USERNAME_EMAIL_DOMAIN = 'users.ancestrio.local';
  
  // Theme toggle
  window.AncestrioTheme?.initThemeToggle();
  
  // Get DOM elements first
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const googleSignInBtn = document.getElementById('googleSignIn');
  const errorMessage = document.getElementById('errorMessage');
  const tabButtons = document.querySelectorAll('.auth-tab');
  const forms = document.querySelectorAll('.auth-form');
  const anonymousSignInBtn = document.getElementById('anonymousSignIn');
  const compactAuthLayout = window.matchMedia('(max-width: 768px)');
  const scheduleFormHeightSync = debounce(syncAuthFormHeights, 120);

  console.log('DOM elements found:', { loginForm, signupForm, errorMessage });

  // Initialize Firebase
  const firebaseReady = initializeFirebase();
  if (!firebaseReady) {
    console.error('Firebase initialization failed');
    showError('Cloud sign-in is unavailable right now. You can still continue as Guest (Local).');
  } else {
    console.log('Firebase initialized successfully');
  }

  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      
      // Update active tab
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Show corresponding form
      forms.forEach(form => form.classList.remove('active'));
      document.getElementById(`${tab}Form`).classList.add('active');
      
      // Clear error
      hideError();

      // Keep card size stable when switching between login/signup layouts.
      syncAuthFormHeights();
    });
  });

  syncAuthFormHeights();
  window.addEventListener('resize', scheduleFormHeightSync);
  window.addEventListener('load', syncAuthFormHeights);

  // Login with email/password
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Login form submitted');
    const identifier = document.getElementById('loginIdentifier').value;
    const password = document.getElementById('loginPassword').value;
    const resolvedLogin = resolveLoginIdentity(identifier);
    if (resolvedLogin.error) {
      showError(resolvedLogin.error);
      return;
    }

    console.log('Attempting login with identifier:', identifier);

    if (!firebaseReady) {
      showError('Cloud sign-in is unavailable right now. Try again later or use Guest mode.');
      return;
    }
    
    try {
      showLoading(loginForm);
      await signInWithPasswordIdentifier(resolvedLogin, password);
      localStorage.removeItem('guestMode');
      console.log('Login successful, redirecting...');
      window.location.href = 'dashboard.html';
    } catch (error) {
      console.error('Login error:', error);
      showError(getLoginErrorMessageForIdentifier(error.code, resolvedLogin));
    } finally {
      hideLoading(loginForm);
    }
  });

  // Sign up with email/password
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Signup form submitted');
    const usernameRaw = document.getElementById('signupUsername').value;
    const emailRaw = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const resolvedSignup = resolveSignupIdentity(emailRaw, usernameRaw);
    if (resolvedSignup.error) {
      showError(resolvedSignup.error);
      return;
    }

    console.log('Attempting signup with:', {
      authEmail: resolvedSignup.authEmail,
      username: resolvedSignup.username
    });

    if (!firebaseReady) {
      showError('Cloud sign-up is unavailable right now. Try again later or use Guest mode.');
      return;
    }
    
    try {
      showLoading(signupForm);
      const userCredential = await auth.createUserWithEmailAndPassword(resolvedSignup.authEmail, password);
      console.log('User created:', userCredential.user.uid);
      
      const displayName = resolvedSignup.username || 'User';
      await userCredential.user.updateProfile({
        displayName
      });
      console.log('Profile updated with display name');
      
      // Create user document in Firestore
      await ensureUserDocument(userCredential.user, {
        name: displayName,
        email: resolvedSignup.publicEmail,
        username: resolvedSignup.username,
        authEmail: resolvedSignup.authEmail,
        usesSyntheticEmail: resolvedSignup.usesSyntheticEmail,
        isAnonymous: false
      });
      console.log('User document created in Firestore');
      
      console.log('Signup successful, redirecting...');
      localStorage.removeItem('guestMode');
      window.location.href = 'dashboard.html';
    } catch (error) {
      console.error('Signup error:', error);
      showError(getErrorMessage(error.code));
    } finally {
      hideLoading(signupForm);
    }
  });

  // Google Sign In
  googleSignInBtn.addEventListener('click', async () => {
    console.log('Google sign-in clicked');
    if (!firebaseReady) {
      showError('Google sign-in is unavailable right now. Try again later or use Guest mode.');
      return;
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      console.log('Google sign-in successful:', result.user.email);
      
      await ensureUserDocument(result.user, {
        name: result.user.displayName || 'Google User',
        email: result.user.email || '',
        username: '',
        authEmail: result.user.email || '',
        usesSyntheticEmail: false,
        isAnonymous: false
      });
      
      localStorage.removeItem('guestMode');
      window.location.href = 'dashboard.html';
    } catch (error) {
      if (error.code !== 'auth/popup-closed-by-user') {
        showError(getErrorMessage(error.code));
      }
    }
  });

  // Guest Mode (local browser storage only)
  if (anonymousSignInBtn) {
    anonymousSignInBtn.addEventListener('click', () => {
      localStorage.setItem('guestMode', 'true');
      window.location.href = 'dashboard.html?guest=1';
    });
  }

  // Helper functions
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
  }

  function hideError() {
    errorMessage.classList.remove('show');
  }

  function showLoading(form) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Loading...';
  }

  function hideLoading(form) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = false;
    button.textContent = form.id === 'loginForm' ? 'Login' : 'Create Account';
  }

  function syncAuthFormHeights() {
    if (!forms.length) return;

    if (compactAuthLayout.matches) {
      forms.forEach((form) => {
        form.style.minHeight = '';
      });
      return;
    }

    const props = ['display', 'visibility', 'position', 'left', 'top', 'width'];
    const originalStyles = new Map();
    const parentWidth = forms[0].parentElement ? forms[0].parentElement.clientWidth : 0;
    let maxHeight = 0;

    forms.forEach((form) => {
      const previous = {};
      props.forEach((prop) => {
        previous[prop] = form.style[prop];
      });
      originalStyles.set(form, previous);

      if (!form.classList.contains('active')) {
        form.style.display = 'block';
        form.style.visibility = 'hidden';
        form.style.position = 'absolute';
        form.style.left = '-9999px';
        form.style.top = '0';
        if (parentWidth > 0) {
          form.style.width = `${parentWidth}px`;
        }
      }

      maxHeight = Math.max(maxHeight, form.offsetHeight);
    });

    forms.forEach((form) => {
      const previous = originalStyles.get(form);
      props.forEach((prop) => {
        form.style[prop] = previous[prop] || '';
      });
      form.style.minHeight = maxHeight > 0 ? `${Math.ceil(maxHeight)}px` : '';
    });
  }

  function debounce(fn, waitMs) {
    let timeoutId = null;
    return (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => fn(...args), waitMs);
    };
  }

  function getNetworkRequestErrorMessage() {
    const firebaseState = window.AncestrioFirebase || {};
    if (firebaseState.isDevelopment) {
      const emulatorUrl = firebaseState.authEmulatorUrl || 'http://localhost:9099';
      const reachabilityHint = firebaseState.authEmulatorReachable === false
        ? ' The emulator appears to be offline.'
        : '';
      return `Could not reach the Firebase Auth emulator at ${emulatorUrl}.${reachabilityHint} Start it with "firebase emulators:start --only auth,firestore", or open this page with ?emulator=0 to use production Firebase.`;
    }
    return 'Network error. Please check your connection.';
  }

  function getErrorMessage(code) {
    const messages = {
      'auth/email-already-in-use': 'This email or username is already registered.',
      'auth/invalid-email': 'Invalid email or username.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase.',
      'auth/weak-password': 'Password should be at least 6 characters.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/user-not-found': 'No account found with this email or username.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-login-credentials': 'Invalid credentials. Check email/username and password.',
      'auth/invalid-credential': 'Invalid credentials. Check email/username and password.',
      'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
      'auth/network-request-failed': getNetworkRequestErrorMessage(),
      'auth/popup-blocked': 'Popup was blocked. Allow popups for this site and try Google sign-in again.',
      'auth/popup-closed-by-user': 'Google sign-in was cancelled before completion.',
      'auth/cancelled-popup-request': 'Another sign-in popup was opened. Close extra popups and try again.',
      'auth/unauthorized-domain': 'This domain is not authorized for Firebase sign-in.'
    };
    return messages[code] || 'An error occurred. Please try again.';
  }

  function normalizeUsername(value) {
    const raw = String(value || '').trim().toLowerCase();
    const cleaned = raw
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '');
    return cleaned.slice(0, 64);
  }

  function isValidUsername(value) {
    return String(value || '').trim().length > 0;
  }

  function toSyntheticEmail(username) {
    return `${username}@${USERNAME_EMAIL_DOMAIN}`;
  }

  function resolveLoginIdentity(identifier) {
    const input = String(identifier || '').trim();
    if (!input) {
      return { error: 'Enter your email or username.' };
    }
    if (input.includes('@')) {
      return {
        inputType: 'email',
        email: input,
        identifier: input
      };
    }

    const username = normalizeUsername(input);
    if (!isValidUsername(username)) {
      return {
        error: 'Please enter a valid username.'
      };
    }

    return {
      inputType: 'username',
      username,
      email: toSyntheticEmail(username),
      identifier: input
    };
  }

  async function signInWithPasswordIdentifier(resolvedLogin, password) {
    if (!resolvedLogin || !resolvedLogin.email) {
      throw new Error('Missing login email.');
    }
    await auth.signInWithEmailAndPassword(resolvedLogin.email, password);
  }

  function getLoginErrorMessageForIdentifier(code, resolvedLogin) {
    if (resolvedLogin?.inputType === 'username' && (
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-login-credentials' ||
      code === 'auth/invalid-credential'
    )) {
      return 'Username not found. If this account was created with email or Google, use that instead.';
    }

    return getErrorMessage(code);
  }

  function resolveSignupIdentity(emailRaw, usernameRaw) {
    const email = String(emailRaw || '').trim();
    const usernameInput = normalizeUsername(usernameRaw);

    if (!email && !usernameInput) {
      return { error: 'Provide either an email or a username.' };
    }

    let username = usernameInput || '';
    if (!username && email) {
      username = deriveUsernameFromEmail(email);
    }

    if (!username) {
      return { error: 'Could not create a username from this email. Please enter a username.' };
    }

    if (!isValidUsername(username)) {
      return {
        error: 'Please enter a valid username.'
      };
    }

    if (email) {
      return {
        authEmail: email,
        publicEmail: email,
        username,
        usesSyntheticEmail: false
      };
    }

    return {
      authEmail: toSyntheticEmail(username),
      publicEmail: '',
      username,
      usesSyntheticEmail: true
    };
  }

  function deriveUsernameFromEmail(email) {
    const input = String(email || '').trim().toLowerCase();
    if (!input.includes('@')) return '';

    const localPart = input.split('@')[0] || '';
    return normalizeUsername(localPart);
  }

  async function ensureUserDocument(user, profile) {
    if (!user || !user.uid) return;
    const userRef = db.collection('users').doc(user.uid);
    const userDoc = await userRef.get();
    if (userDoc.exists) return;

    await userRef.set({
      name: profile?.name || (user.isAnonymous ? 'Guest' : 'User'),
      email: profile?.email || '',
      username: profile?.username || '',
      authEmail: profile?.authEmail || user.email || '',
      usesSyntheticEmail: Boolean(profile?.usesSyntheticEmail),
      isAnonymous: Boolean(profile?.isAnonymous ?? user.isAnonymous),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  
  console.log('All event listeners attached successfully');
});

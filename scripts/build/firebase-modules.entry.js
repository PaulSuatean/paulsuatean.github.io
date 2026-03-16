import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';

(function installFirebaseModulesBridge(global) {
  global.AncestrioFirebaseModules = {
    app: {
      getApp,
      getApps,
      initializeApp
    },
    auth: {
      EmailAuthProvider,
      GoogleAuthProvider,
      connectAuthEmulator,
      createUserWithEmailAndPassword,
      deleteUser,
      getAuth,
      onAuthStateChanged,
      reauthenticateWithCredential,
      reauthenticateWithPopup,
      sendPasswordResetEmail,
      signInWithEmailAndPassword,
      signInWithPopup,
      signOut,
      updateProfile
    },
    firestore: {
      addDoc,
      collection,
      connectFirestoreEmulator,
      deleteDoc,
      doc,
      getDoc,
      getDocFromCache,
      getDocFromServer,
      getDocs,
      getDocsFromCache,
      getDocsFromServer,
      getFirestore,
      limit,
      onSnapshot,
      orderBy,
      query,
      serverTimestamp,
      setDoc,
      updateDoc,
      where
    }
  };
})(window);

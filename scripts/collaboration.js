/*
  Collaboration module for Ancestrio.
  Handles invite-link generation, suggestion submission (by invited users),
  and suggestion review (by tree owners).

  Depends on: firebase-config.js (for `db`, `auth` globals)
*/

(function (global) {
  'use strict';

  function notify(msg, type) {
    if (global.AncestrioRuntime && typeof global.AncestrioRuntime.notify === 'function') {
      global.AncestrioRuntime.notify(msg, type);
      return;
    }
    if (type === 'error') console.error(msg);
    else console.log(msg);
  }

  function sanitize(v, max) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 120);
  }

  function getDb() { return global.db || (global.firebase && global.firebase.firestore()); }
  function getAuth() { return global.auth || (global.firebase && global.firebase.auth()); }
  function currentUid() { var a = getAuth(); return a && a.currentUser ? a.currentUser.uid : ''; }
  function currentDisplayName() {
    var a = getAuth();
    if (!a || !a.currentUser) return '';
    return a.currentUser.displayName || a.currentUser.email || '';
  }

  // ─── Invite links ───

  /**
   * Create an invite for a tree. Returns the invite document ID.
   */
  async function createInvite(treeId, treeName) {
    var db = getDb();
    if (!db) throw new Error('Firestore not available');
    var uid = currentUid();
    if (!uid) throw new Error('Not authenticated');

    var sanitizedTreeId = sanitize(treeId, 120);
    var doc = await db.collection('treeInvites').add({
      treeId: sanitizedTreeId,
      ownerId: uid,
      treeName: sanitize(treeName, 160),
      role: 'suggest',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Mark tree as having invites so Firestore rules allow invited reads
    try {
      await db.collection('trees').doc(sanitizedTreeId).update({
        hasInvites: true
      });
    } catch (_) { /* owner-only write; ignore if it fails */ }

    return doc.id;
  }

  /**
   * Build an invite URL from an invite ID.
   */
  function buildInviteUrl(inviteId) {
    try {
      var url = new URL('tree.html', global.location.href);
      url.searchParams.set('invite', inviteId);
      return url.toString();
    } catch (_) {
      return 'tree.html?invite=' + encodeURIComponent(inviteId);
    }
  }

  /**
   * Resolve an invite token. Returns the invite data or null.
   */
  async function resolveInvite(inviteId) {
    var db = getDb();
    if (!db) return null;
    try {
      var snap = await db.collection('treeInvites').doc(inviteId).get();
      if (!snap.exists) return null;
      return Object.assign({ id: snap.id }, snap.data());
    } catch (_) {
      return null;
    }
  }

  /**
   * List invites the current user owns for a specific tree.
   */
  async function listInvitesForTree(treeId) {
    var db = getDb();
    if (!db) return [];
    var uid = currentUid();
    if (!uid) return [];
    try {
      var snap = await db.collection('treeInvites')
        .where('ownerId', '==', uid)
        .where('treeId', '==', treeId)
        .get();
      return snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Delete an invite.
   */
  async function deleteInvite(inviteId) {
    var db = getDb();
    if (!db) return;

    // Read invite data before deleting so we can check remaining invites
    var inviteSnap;
    try {
      inviteSnap = await db.collection('treeInvites').doc(inviteId).get();
    } catch (_) { /* ignore */ }

    await db.collection('treeInvites').doc(inviteId).delete();

    // If no more invites remain for this tree, clear the hasInvites flag
    if (inviteSnap && inviteSnap.exists) {
      var data = inviteSnap.data();
      try {
        var remaining = await db.collection('treeInvites')
          .where('treeId', '==', data.treeId)
          .limit(1)
          .get();
        if (remaining.empty) {
          await db.collection('trees').doc(data.treeId).update({
            hasInvites: false
          });
        }
      } catch (_) { /* best-effort */ }
    }
  }

  // ─── Suggestions ───

  /**
   * Submit a suggestion for a tree. Used by invited collaborators.
   */
  async function submitSuggestion(treeId, ownerId, message, treeName) {
    var db = getDb();
    if (!db) throw new Error('Firestore not available');
    var uid = currentUid();
    if (!uid) throw new Error('Not authenticated');

    var trimmed = sanitize(message, 1000);
    if (!trimmed) throw new Error('Message is required');

    await db.collection('treeSuggestions').add({
      treeId: sanitize(treeId, 120),
      ownerId: sanitize(ownerId, 120),
      authorId: uid,
      authorName: sanitize(currentDisplayName(), 120),
      treeName: sanitize(treeName || '', 160),
      message: trimmed,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  /**
   * List pending suggestions for trees the current user owns.
   */
  async function listPendingSuggestions() {
    var db = getDb();
    if (!db) return [];
    var uid = currentUid();
    if (!uid) return [];
    try {
      var snap = await db.collection('treeSuggestions')
        .where('ownerId', '==', uid)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      return snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Accept or dismiss a suggestion.
   */
  async function reviewSuggestion(suggestionId, newStatus) {
    var db = getDb();
    if (!db) return;
    if (newStatus !== 'accepted' && newStatus !== 'dismissed') return;
    await db.collection('treeSuggestions').doc(suggestionId).update({
      status: newStatus,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // ─── Shared trees (add an invited tree to a user's dashboard) ───

  /**
   * Add a shared tree reference to the current user's sharedTrees collection.
   * This lets the tree appear on their dashboard.
   */
  async function addSharedTree(treeId, ownerId, treeName, inviteId) {
    var db = getDb();
    if (!db) throw new Error('Firestore not available');
    var uid = currentUid();
    if (!uid) throw new Error('Not authenticated');
    if (uid === ownerId) throw new Error('You already own this tree');

    // Check if already added
    var existing = await db.collection('sharedTrees')
      .where('userId', '==', uid)
      .where('treeId', '==', sanitize(treeId, 120))
      .limit(1)
      .get();
    if (!existing.empty) throw new Error('Tree already added to your dashboard');

    await db.collection('sharedTrees').add({
      userId: uid,
      treeId: sanitize(treeId, 120),
      ownerId: sanitize(ownerId, 120),
      treeName: sanitize(treeName, 160),
      inviteId: sanitize(inviteId || '', 120),
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  /**
   * List shared trees for the current user.
   */
  async function listSharedTrees() {
    var db = getDb();
    if (!db) return [];
    var uid = currentUid();
    if (!uid) return [];
    try {
      var snap = await db.collection('sharedTrees')
        .where('userId', '==', uid)
        .get();
      return snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Remove a shared tree from the current user's dashboard.
   */
  async function removeSharedTree(sharedTreeDocId) {
    var db = getDb();
    if (!db) return;
    await db.collection('sharedTrees').doc(sharedTreeDocId).delete();
  }

  /**
   * Check if the current user has already added a tree to their dashboard.
   */
  async function hasSharedTree(treeId) {
    var db = getDb();
    if (!db) return false;
    var uid = currentUid();
    if (!uid) return false;
    try {
      var snap = await db.collection('sharedTrees')
        .where('userId', '==', uid)
        .where('treeId', '==', sanitize(treeId, 120))
        .limit(1)
        .get();
      return !snap.empty;
    } catch (_) {
      return false;
    }
  }

  // ─── Expose ───

  global.AncestrioCollab = {
    createInvite: createInvite,
    buildInviteUrl: buildInviteUrl,
    resolveInvite: resolveInvite,
    listInvitesForTree: listInvitesForTree,
    deleteInvite: deleteInvite,
    submitSuggestion: submitSuggestion,
    listPendingSuggestions: listPendingSuggestions,
    reviewSuggestion: reviewSuggestion,
    addSharedTree: addSharedTree,
    listSharedTrees: listSharedTrees,
    removeSharedTree: removeSharedTree,
    hasSharedTree: hasSharedTree,
    notify: notify
  };
})(window);

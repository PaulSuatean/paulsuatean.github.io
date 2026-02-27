# Ancestrio Family Tree App

This repository is a static frontend app for building and viewing family trees, with Firebase for auth and data.

## Cost policy

Do not use Firebase Storage or any service that costs money in this project.

## Project layout

```
.
|- index.html                 # landing/home page
|- pages/                     # app pages (auth, dashboard, editor, tree, contact, demo, store)
|- scripts/                   # JavaScript modules
|- styles/                    # shared and page-specific CSS
|- images/                    # person photos and static assets
|- data/                      # local demo data
|- firebase.json              # Firebase hosting + Firestore config
|- firestore.rules            # Firestore security rules
|- firestore.indexes.json     # Firestore indexes
```

## Single source of truth for Firebase config

Use only the root files:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`

## Entry points

- Public home: `index.html`
- App auth: `pages/auth.html`
- Dashboard: `pages/dashboard.html`
- Editor: `pages/editor.html`
- Viewer: `pages/tree.html`
- Demo viewer: `pages/demo-tree.html`
- Store: `pages/store.html`

## Store order capture

- Store ordering is lead capture only in v1 (no payment checkout flow yet).
- Email notifications are sent through Formspree or FormSubmit from the store order form.
- Configure the endpoint in `pages/store.html` on `#orderForm[data-formspree-endpoint]`.
- If a user is signed in, the order is also written to Firestore collection: `storeOrders`.

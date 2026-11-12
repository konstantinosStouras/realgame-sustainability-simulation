# Original simulation code

`engine.mjs` is the environment-independent simulation model. The Node server owns shared classroom state; `solo.mjs` is the clearly labelled browser-only rehearsal adapter. `firebase-client.mjs` delegates sign-in to Firebase. See the root README and notes/model.md for setup and economic rules.

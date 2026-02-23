# PochaCoding

## Convex Cloud Sync (Current Behavior)

- This is currently a **single-user app**. Convex project sync is deployment-level and not user-scoped/auth-scoped yet.
- Local project edits are saved to IndexedDB automatically.
- Cloud sync is optimized for bandwidth:
  - Sync runs when leaving/closing the editor view (component unmount flow).
  - A `sendBeacon` fallback sync runs on hard unload (refresh/tab close).
  - Cloud sync does **not** run on every edit or when a tab is merely backgrounded.

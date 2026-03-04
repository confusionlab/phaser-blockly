# PochaCoding

## Blockly LLM Assistant (OpenRouter)

- The Blockly editor includes an assistant panel for natural-language block edits.
- OpenRouter is called from a Convex action (server-side), not from browser code.
- Configure Convex env vars:
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL` (optional, defaults to `openai/gpt-5.3-codex`)
  - `OPENROUTER_REFERER` / `OPENROUTER_APP_NAME` (optional headers)
- Flow:
  1. Enter an instruction in the assistant panel.
  2. Convex action calls OpenRouter and validates semantic-op JSON schema.
  3. Client builds candidate Blockly XML deterministically, diffs, and validates.
  4. Apply if validation passes (with component propagation confirmation when needed).
  5. Use rollback to undo the latest apply transaction.

## Convex Cloud Sync (Current Behavior)

- This is currently a **single-user app**. Convex project sync is deployment-level and not user-scoped/auth-scoped yet.
- Local project edits are saved to IndexedDB automatically.
- Cloud sync is optimized for bandwidth:
  - Sync runs when leaving/closing the editor view (component unmount flow).
  - A `sendBeacon` fallback sync runs on hard unload (refresh/tab close).
  - Cloud sync does **not** run on every edit or when a tab is merely backgrounded.

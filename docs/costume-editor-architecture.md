# Costume Editor Architecture

This document is the source of truth for how costume edits move through the editor, runtime previews, and durable project state.

It exists to keep the costume editor reliable as the implementation evolves. If the code and this document diverge, the boundary should be refactored until they match again.

## Goals

- Keep the editor canvas responsive while a costume is open.
- Keep the editor, stage sprite, and sprite shelf visually in sync.
- Preserve undo/redo correctness across rapid strokes, fills, layer edits, tab switches, selection changes, and saves.
- Make flush boundaries explicit instead of relying on incidental effects.

## State Layers

The costume editor has three distinct state layers. They should not be treated as interchangeable.

### 1. Editor Session State

Owned by `CostumeEditorCoordinator`, `CostumeEditor`, and the live `CostumeCanvas`.

- Session identity comes from `CostumeEditorSession`.
- The editor canvas is authoritative while the costume editor is open.
- `CostumeEditorCoordinator` owns document history, working persisted state, and queued runtime revision state.

This layer should answer: "What does the user currently see and what can they undo right now?"

### 2. Runtime Preview State

Owned by `costumeRuntimePreviewStore`.

- This is the immediate preview channel for the stage and sprite shelf.
- Runtime previews are revisioned and keyed by `{sceneId, objectId, costumeId}`.
- Runtime previews are disposable and may be cleared when the session moves away.

This layer should answer: "What should non-editor consumers render right now before durable persistence catches up?"

### 3. Persisted Project State

Owned by `projectStore`.

- This is the durable project model used for saving, cloud sync, reopening, and non-editor surfaces that do not subscribe to runtime preview.
- Persisted state must only be updated from validated costume editor boundaries.

This layer should answer: "What would survive reload, save, sync, or tab closure?"

## Commit Pipeline

Every costume edit should move through the same conceptual stages:

1. The live canvas commits the stroke/shape/fill into the active layer.
2. `CostumeEditor` merges that active-layer state into the working costume document.
3. A new revisioned runtime state entry is recorded.
4. A runtime preview is published.
5. Durable store synchronization is scheduled or flushed.

The important rule is:

- Runtime preview publication must happen before deferred persistence work finishes.
- Stage/shelf consumers must never have to infer freshness from persisted project state alone while a live costume session exists.

## Preview Modes

There are two preview publication modes.

### `stateOnly`

Used only when the live active bitmap layer is itself the final costume preview.

Requirements:

- editor mode is bitmap
- there is exactly one visible layer
- that visible layer is the active layer
- the layer has no opacity reduction, effects, masks, or blend deviations

In this mode:

- the runtime preview uses the direct bitmap preview canvas
- bounds and asset frame come from the live canvas state
- the durable flattened preview can be deferred

### `render`

Used whenever the final costume preview requires composition.

Examples:

- multiple visible layers
- vector content
- opacity-driven composition
- anything that cannot be represented by the active bitmap layer alone

In this mode:

- the runtime preview must publish a composed preview canvas immediately
- consumers must not fall back to stale persisted preview data while waiting for durable render/store sync

## Flush Boundaries

Any operation that leaves the current editing context must flush pending costume work explicitly.

Required flush boundaries include:

- undo / redo
- object selection changes
- costume selection changes
- tab changes
- save / cloud sync
- leaving the editor surface

If a new boundary is added and it can make the editor lose focus or ownership of the active costume, it must either flush pending costume work or prove why no flush is needed.

## Authoritative Canvas Loads

Loading a persisted costume document into the live canvas is itself a state boundary.

All authoritative document loads must go through the same guarded path, including:

- initial costume/session loads
- undo / redo navigation
- document mutation reloads that replace the active canvas document

This guarded load path must:

- mark the editor as loading for the duration of the authoritative load
- invalidate stale async bitmap commit work from older generations
- suppress normal history/change dispatch while the canvas is being reconstructed
- only finalize session readiness for the latest in-flight load

Undo reliability depends on this rule. If undo/reload uses a different code path than normal session loads, the editor can reinterpret an authoritative history snapshot as fresh user work.

## Undo Ownership

Undo routing in the costume tab has two distinct roles that must not be conflated:

- a passive costume bridge may flush pending costume state before some other history domain changes
- the live costume editor may fully own undo/redo navigation for the active costume session

The `UndoRedoHandler` contract makes this explicit with `ownsHistoryDomain`.

- `ownsHistoryDomain: true` means the costume handler is authoritative for undo/redo while the costumes tab is active, even when it currently has no further local steps to take
- omitted or `false` means the handler may participate in flushes, but global history is still allowed to handle the actual undo/redo action

This distinction exists because selection/save/object-history bridges need costume flush behavior without stealing ownership from the global history stack.

## Consumer Rules

### Stage (`PhaserCanvas`)

- Prefer runtime preview when a revisioned preview entry exists for the current costume.
- Keep owned runtime textures stable when updating preview pixels in place.
- Do not destroy and recreate visuals unless the visual identity really changed.

### Sprite Shelf (`SpriteShelf`)

- Prefer runtime preview when present.
- Keep the previously rendered preview visible until the next preview is ready.
- Do not briefly blank the thumbnail during refresh.

## Invariants

These should remain true after every change:

- Editor canvas, runtime preview, and persisted costume state all refer to the same costume target.
- Undo/redo never resurrects newer strokes after stepping backward.
- Runtime preview revisions are monotonic per active session.
- Render-mode commits still publish a fresh runtime preview immediately.
- Clearing a runtime preview must never clear a different session's preview.

## Testing Bar

The costume editor should keep all three test layers healthy:

1. Pure reconciliation tests
   - `costume-editor-session.spec.ts`
   - `costume-runtime-preview.spec.ts`

2. Behavior regressions
   - `costume-editor.spec.ts`
   - `project-store-costume-editor.spec.ts`
   - `costume-asset-persistence.spec.ts`

3. Performance budget
   - `costume-editor-performance.spec.ts`

When a bug is found, prefer adding or tightening the smallest test that captures the broken invariant before changing implementation details.

## Current Boundary Owners

- Session reconciliation: `src/lib/editor/costumeEditorSession.ts`
- Runtime preview publication contract: `src/lib/editor/costumeRuntimePreview.ts`
- Runtime preview storage: `src/store/costumeRuntimePreviewStore.ts`
- Session coordinator: `src/lib/editor/costumeEditorCoordinator.ts`
- Editor coordination and UI flush boundaries: `src/components/editors/CostumeEditor.tsx`
- Stage consumer: `src/components/stage/PhaserCanvas.tsx`
- Shelf consumer: `src/components/stage/SpriteShelf.tsx`

## Refactor Direction

The long-term direction is to keep pushing toward a smaller number of explicit owners:

- one coordinator for revisioned costume commits
- one runtime preview contract for non-editor consumers
- one durable persistence boundary into project state

If a future change needs to touch all three layers at once, that is usually a signal that the boundary should be made more explicit rather than patched in place.

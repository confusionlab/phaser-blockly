# Button System Audit

## Summary

- The repo already has one shared base button: `apps/web/src/components/ui/button.tsx`.
- The refactor is now implemented across app components, not just proposed.
- App-level raw `<button>` usage has been removed. Remaining raw buttons live only inside intentional UI primitives.
- Several of the old raw-button cases were not "missing migration" bugs. They represented different interaction primitives:
  - overlay toolbar actions
  - segmented choices
  - color swatches
  - disclosure toggles
  - drag handles
  - scrims and dismiss surfaces

The right direction is not "one mega Button with 20 variants". The right direction is:

1. Keep one shared button foundation.
2. Build a small set of typed button families on top of it.
3. Keep non-button controls separate when they have a different interaction contract.

## Implementation Status

The current shipped button system is:

- `Button` for standard actions, now with first-class `shape`
- `IconButton` for icon-only actions with required accessible labels
- `MenuItemButton` for custom menu/context rows
- `InlineActionButton` for inspector-style inline actions
- `OverlayActionButton` for overlay chrome controls
- `DisclosureButton` for tree toggles
- `DragHandleButton` for drag manipulators
- `ScrimButton` for dismiss backdrops

Adjacent but separate primitives:

- `SegmentedControl`
- `ColorSwatchButton`

Repository status after the sweep:

- no app component renders raw `<button>` directly
- standard, icon, menu-row, inline, and overlay actions now route through named primitives
- only the intentionally low-level UI primitives still own native `<button>` markup

## Current Base Button

The current shared `Button` in `apps/web/src/components/ui/button.tsx` is a good foundation for standard application actions:

- Variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`
- Sizes: `default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`
- Features: `asChild`, disabled styling, icon sizing, focus ring, semantic `<button>`

This component is already the right home for:

- dialog confirmation actions
- standard toolbar actions outside of floating chrome
- secondary actions
- destructive actions
- compact icon actions in panels and lists

What it did not previously model well was shape and context. That used to leak into ad hoc `className` overrides like:

- `rounded-full`
- `rounded-none`
- custom floating chrome
- custom row/menu alignment rules

## Audit Of Current Button Families

### 1. Standard Action Buttons

These already fit the shared `Button` model well.

Representative usage:

- dialogs and confirmations
- library browsers
- modal footer actions
- editor top-bar actions
- play validation actions
- background editor openers

Files using the shared `Button` for mostly standard actions:

- `apps/web/src/components/dialogs/ComponentLibraryBrowser.tsx`
- `apps/web/src/components/dialogs/CostumeLibraryBrowser.tsx`
- `apps/web/src/components/dialogs/EditMessagesDialog.tsx`
- `apps/web/src/components/dialogs/EditVariablesDialog.tsx`
- `apps/web/src/components/dialogs/NameInputDialog.tsx`
- `apps/web/src/components/dialogs/PlayValidationDialog.tsx`
- `apps/web/src/components/dialogs/ProjectDialog.tsx`
- `apps/web/src/components/dialogs/ProjectHistoryDialog.tsx`
- `apps/web/src/components/dialogs/ProjectPropertyManagerDialog.tsx`
- `apps/web/src/components/dialogs/SoundLibraryBrowser.tsx`
- `apps/web/src/components/layout/EditorLayout.tsx`
- `apps/web/src/components/layout/EditorTopBar.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/modal-provider.tsx`

Recommendation:

- Keep using the shared `Button`.
- Rename the visual variants to design-system names only if we do a broader UI pass. Otherwise the current variant names are serviceable.

### 2. Icon Actions In Panels And Lists

These are mostly already using `Button`, but the code relies on repeated `variant="ghost"` plus icon sizes to communicate a specific pattern.

Representative usage:

- `apps/web/src/components/stage/HierarchyPanel.tsx`
- `apps/web/src/components/stage/SpriteShelf.tsx`
- `apps/web/src/components/editors/costume/CostumeList.tsx`
- `apps/web/src/components/editors/sound/SoundList.tsx`
- `apps/web/src/components/shared/CollectionBrowserChrome.tsx`

Current pattern:

- `variant="ghost"`
- `size="icon-xs"` or `size="icon-sm"`
- sometimes `className="rounded-full"`

Recommendation:

- Add `IconButton` as a thin wrapper over `Button`.
- Make `aria-label` required for icon-only usage.
- Encode shape as a prop instead of ad hoc class overrides.

Suggested API:

```tsx
<IconButton
  label="Add Folder"
  variant="ghost"
  size="sm"
  shape="rounded"
>
  <FolderPlus />
</IconButton>
```

Why:

- reduces repeated `title` and `aria-label` drift
- prevents accidental unlabeled icon-only buttons
- makes panel actions feel unified without making them all look the same

### 3. Menu Item Buttons

There is a very repeated pattern of "button rendered inside a custom card acting like a menu row".

Representative files:

- `apps/web/src/components/stage/HierarchyPanel.tsx`
- `apps/web/src/components/stage/SpriteShelf.tsx`
- `apps/web/src/components/editors/costume/CostumeList.tsx`
- `apps/web/src/components/editors/sound/SoundList.tsx`
- `apps/web/src/components/editors/shared/LayerPanel.tsx`

Current repeated styling:

- `variant="ghost"`
- `size="sm"`
- `w-full justify-start`
- `rounded-none`
- `h-8` or `h-9`
- optional destructive text treatment

This is a real design-system pattern, not just one-off styling.

Recommendation:

- Create `MenuItemButton` as a separate wrapper component.
- Do not keep expressing this through naked `Button className` overrides.

Suggested API:

```tsx
<MenuItemButton icon={<Copy />} onClick={handleCopy}>
  Copy
</MenuItemButton>

<MenuItemButton intent="destructive" icon={<Trash2 />} onClick={handleDelete}>
  Delete
</MenuItemButton>
```

Why:

- these buttons have consistent layout and semantics across the app
- the current repeated `rounded-none h-8 w-full justify-start` is a code smell
- this keeps the base `Button` focused on actual action buttons, not menu rows

### 4. Inline Inspector Actions

The inspector has a compact inline action style that is distinct from normal buttons.

Representative file:

- `apps/web/src/components/stage/ObjectInspector.tsx`

Current pattern:

- `variant="outline"`
- `size="sm"`
- `className="inspector-inline-button ..."`
- constrained width behavior from `apps/web/src/index.css`

Recommendation:

- Keep this as a named family, not as raw `className` glue.
- Add `InlineActionButton` or `Button` compound props that encode this explicitly.

Suggested API:

```tsx
<InlineActionButton icon={<Paintbrush />} onClick={openBackgroundEditor}>
  Draw
</InlineActionButton>
```

or, if we want fewer public components:

```tsx
<Button variant="outline" size="sm" context="inline-inspector">
  Draw
</Button>
```

I prefer `InlineActionButton` because the width and truncation behavior is structural, not just cosmetic.

### 5. Pill And Chip Buttons

There are several rounded-full action patterns that should stay visually distinct from standard rectangular buttons.

Representative files:

- `apps/web/src/components/editors/SoundEditor.tsx`
- `apps/web/src/components/shared/CollectionBrowserChrome.tsx`
- `apps/web/src/components/home/ProjectExplorerPage.tsx`
- `apps/web/src/components/layout/ProductMenu.tsx`
- `apps/web/src/components/assistant/AiAssistantPanel.tsx`

These are not all the same:

- some are pill actions
- some are small icon chips
- some are menu triggers
- one is a floating action launcher

Recommendation:

- Support shape as a first-class concern in the button system.
- Add `shape="pill"` to `Button` and `IconButton`.
- Do not add a separate public component for every pill-like case unless the behavior differs.

Suggested API:

```tsx
<Button variant="outline" shape="pill">Re-record</Button>
<IconButton label="Multi-select" variant="ghost" shape="pill" />
```

Where not to force reuse:

- the AI assistant open button is closer to a floating action button than a standard pill
- if it remains unique, it can keep local layout chrome on top of the shared foundation

### 6. Overlay Toolbar Actions

These are the clearest missing family in the current system.

Representative files:

- `apps/web/src/components/stage/StagePanel.tsx`
- `apps/web/src/components/stage/WorldBoundaryEditor.tsx`
- `apps/web/src/components/stage/BackgroundCanvasEditor.tsx`

Current structure:

- outer `OverlayPill`
- inner raw `<button>`
- separate light and dark tone class maps
- selected and emphasized states encoded ad hoc

This is a coherent family and should become a first-class component.

Recommendation:

- Keep `OverlayPill` as the container.
- Add `OverlayActionButton` for the children.

Suggested API:

```tsx
<OverlayPill tone="dark" size="compact">
  <OverlayActionButton label="Restart" selected>
    <RotateCcw />
  </OverlayActionButton>
  <OverlayActionButton label="Stop" emphasis="danger">
    <Square />
  </OverlayActionButton>
</OverlayPill>
```

Props this family should support:

- `tone`: `light | dark`
- `selected`
- `emphasis`: `default | positive | danger`
- `size`: `compact | default`

Why this should not be shoved into base `Button`:

- the look is tied to translucent overlay chrome
- the states are specific to overlay controls
- the component already assumes an `OverlayPill` parent

### 7. Segmented Choices

Representative files:

- `apps/web/src/components/ui/segmented-control.tsx`
- `apps/web/src/components/stage/StagePanel.tsx`
- `apps/web/src/components/editors/ObjectEditor.tsx`
- `apps/web/src/components/shared/CollectionBrowserChrome.tsx`

Recommendation:

- Keep `SegmentedControl` separate.
- Do not turn segmented options into a `Button` variant.

Reason:

- it has radio-group semantics
- it owns keyboard roving focus
- it has a moving thumb, not normal button press behavior

This is a sibling primitive, not a button variant.

### 8. Color Swatch Buttons

Representative files:

- `apps/web/src/components/ui/color-swatch-button.tsx`
- `apps/web/src/components/stage/SceneTabs.tsx`
- `apps/web/src/components/editors/shared/FloatingToolbarColorControl.tsx`
- `apps/web/src/components/stage/ObjectInspector.tsx`

Recommendation:

- Keep `ColorSwatchButton` separate.
- Treat it as a value-presentation control, not a normal button.

Reason:

- the visible content is the current value itself
- it has contrast-outline logic that does not belong in general button styling

### 9. Disclosure And Tree Toggle Buttons

Representative file:

- `apps/web/src/components/stage/ShelfTreeRow.tsx`

Recommendation:

- Keep disclosure toggles as a small local primitive or extract `DisclosureButton`.
- Do not fold them into the generic `Button` API unless we get a second or third disclosure implementation.

Reason:

- they have tree-specific layout and visibility behavior
- they are closer to structure controls than app actions

### 10. Drag Handles And Manipulators

Representative file:

- `apps/web/src/components/editors/sound/WaveformViewport.tsx`

Recommendation:

- Keep these out of the button system.

Reason:

- they are pointer manipulators with capture behavior
- their primary job is drag interaction, not button activation

### 11. Scrims And Backdrop Dismiss Surfaces

Representative file:

- `apps/web/src/components/assistant/AiAssistantPanel.tsx`

Recommendation:

- Keep scrim dismiss surfaces local.
- Do not model a full-screen backdrop dismiss target as part of the button design system.

### 12. Dev-Only Buttons

Representative files:

- `apps/web/src/components/debug/DebugPanel.tsx`
- `apps/web/src/components/blockly/BlocklyEditor.tsx`

Recommendation:

- `BlocklyEditor` pin toggle should migrate to `IconButton`.
- `DebugPanel` can stay local unless we decide debug UI should follow product design tokens.

## Inventory Of Raw Button Files Before Refactor

These are the current raw `<button>` files and the recommended outcome.

| File | Current role | Recommendation |
| --- | --- | --- |
| `apps/web/src/components/assistant/AiAssistantPanel.tsx` | scrim dismiss surface | keep local |
| `apps/web/src/components/blockly/BlocklyEditor.tsx` | pin/unpin icon toggle | migrate to `IconButton` |
| `apps/web/src/components/debug/DebugPanel.tsx` | debug tabs and utility actions | keep local unless debug UI is being polished |
| `apps/web/src/components/editors/shared/LayerPanel.tsx` | row visibility toggle | migrate to `IconButton` |
| `apps/web/src/components/editors/sound/WaveformViewport.tsx` | draggable trim handles | keep specialized |
| `apps/web/src/components/home/ProjectExplorerPage.tsx` | breadcrumb chip and editable title trigger | breadcrumb -> `ChipButton`; title trigger can stay local |
| `apps/web/src/components/layout/ProductMenu.tsx` | product menu trigger chip | migrate to `ChipButton` or `Button shape="pill"` |
| `apps/web/src/components/stage/BackgroundCanvasEditor.tsx` | overlay pill actions | migrate to `OverlayActionButton` |
| `apps/web/src/components/stage/PhaserCanvas.tsx` | inventory item tiles | keep local or add separate `InventoryItemButton` only if reused |
| `apps/web/src/components/stage/SceneTabs.tsx` | delete-tab affordance | migrate to `IconButton` |
| `apps/web/src/components/stage/ShelfTreeRow.tsx` | disclosure toggle | keep specialized or extract `DisclosureButton` |
| `apps/web/src/components/stage/SpriteShelf.tsx` | quick scene switch trigger | migrate to `ChipButton` |
| `apps/web/src/components/stage/StagePanel.tsx` | overlay pill actions | migrate to `OverlayActionButton` |
| `apps/web/src/components/stage/WorldBoundaryEditor.tsx` | overlay pill actions | migrate to `OverlayActionButton` |
| `apps/web/src/components/ui/color-swatch-button.tsx` | color value control | keep specialized |
| `apps/web/src/components/ui/segmented-control.tsx` | segmented choice primitive | keep specialized |

## Proposed Public Button System

The cleanest system here is a layered one.

### Foundation

Create a shared styling module for interaction tokens:

- heights
- paddings
- radii
- focus rings
- disabled state
- icon spacing
- destructive text treatment
- selected state treatment where applicable

This can still be powered by `cva`, but the tokens should be grouped by family instead of trying to make one giant recipe cover every interaction primitive.

### Public Components

#### `Button`

Use for standard actions with text or text plus icon.

Props:

- `variant`: `default | secondary | outline | ghost | destructive | link`
- `size`: `xs | sm | md | lg`
- `shape`: `rounded | pill`
- `leadingIcon`
- `trailingIcon`

Notes:

- rename `default` size to `md` if we do a broader cleanup
- `shape` should replace most `rounded-full` overrides

#### `IconButton`

Use for icon-only actions.

Props:

- `variant`: `ghost | outline | secondary | destructive`
- `size`: `xs | sm | md | lg`
- `shape`: `rounded | pill`
- `label`: required accessible label
- `selected?`

Notes:

- this should internally render `Button`
- this becomes the default for panel header actions, row actions, close buttons, and small utility toggles

#### `MenuItemButton`

Use for custom context menu rows rendered inside cards or popovers.

Props:

- `icon`
- `intent`: `default | destructive | accent`
- `inset?`

Notes:

- fixed row height
- full-width left alignment
- square corners by default

#### `OverlayActionButton`

Use only inside `OverlayPill`.

Props:

- `tone`: `light | dark`
- `size`: `compact | default`
- `selected?`
- `emphasis`: `default | positive | danger`
- `label`

Notes:

- this should own the current `StagePanel` and `WorldBoundaryEditor` light/dark class logic

#### `InlineActionButton`

Use for inspector-side actions embedded in constrained rows.

Props:

- `icon?`
- `intent`: `default | outline`
- `truncate?`

Notes:

- this family owns the current `inspector-inline-button` behavior

### Adjacent But Separate Primitives

These should remain separate from the button system:

- `SegmentedControl`
- `ColorSwatchButton`
- disclosure toggles
- drag handles
- scrim dismiss surfaces

## Rules For Future Usage

### Use `Button` when

- the control triggers a standard action
- the control belongs in a dialog footer, form footer, or standard toolbar
- the button has text or text plus icon

### Use `IconButton` when

- the button is icon-only
- the action is a panel/list/header utility action
- the action should require an accessible label

### Use `MenuItemButton` when

- the button is one row in a custom menu or context menu
- the button is full-width and left-aligned
- the row shape should be flat, not pill or card-like

### Use `OverlayActionButton` when

- the button lives in translucent overlay chrome
- the visual style depends on light/dark overlay tone

### Keep it separate when

- the control is primarily a selector among peers
- the control displays a value visually, like a swatch
- the control is drag-driven rather than click-driven

## Current Primitive Boundaries

These boundaries are now intentional:

- `Button`: dialogs, toolbars, modal actions, text buttons, pill buttons, link-style actions
- `IconButton`: header actions, close buttons, utility toggles, compact icon actions
- `MenuItemButton`: custom menu rows across hierarchy, shelf, asset, and layer panels
- `InlineActionButton`: inspector and constrained inline controls
- `OverlayActionButton`: stage and canvas overlay chrome
- `DisclosureButton`: tree disclosure affordances
- `DragHandleButton`: pointer-driven trim handles
- `ScrimButton`: backdrop dismiss surface

Things intentionally not collapsed into `Button` variants:

- `SegmentedControl` because it behaves like a peer selector, not a press action
- `ColorSwatchButton` because the control presents a value and owns contrast logic

## Final Recommendation

We should not choose between "one component" and "many unrelated components".

We should choose:

- one shared button foundation
- a few typed family components for meaningfully different button patterns
- explicit exceptions for primitives that are not actually buttons in a design-system sense

If we do that, we preserve the UI that already exists while making the codebase much more coherent:

- less repeated styling
- clearer accessibility expectations
- fewer ad hoc class overrides
- a better boundary between action buttons, menu rows, overlay controls, and selector controls

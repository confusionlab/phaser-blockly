# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PochaCoding is a visual game maker for children (ages 8-12) that combines Blockly's block-based programming with Phaser 3's game engine. Similar to Scratch, but outputs real Phaser games.

## Tech Stack

- React 19 + TypeScript
- Phaser 3.90 (game engine)
- Blockly 12 (visual programming)
- Zustand (state management)
- Dexie/IndexedDB (local storage)
- Vite + Tailwind CSS

## Common Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build (runs tsc first)
pnpm lint         # Run ESLint
pnpm preview      # Preview production build
```

## Architecture

```
Left Panel (40%)     │  Right Panel (60%)
─────────────────────┼──────────────────────
Blockly Editor       │  Scene Tabs
- Per-object code    │  Phaser Canvas (stage)
- Custom blocks      │  Sprite Shelf (objects)
```

### Key Concepts

- **Project** → contains multiple **Scenes**
- **Scene** → contains **GameObjects** + background + camera config
- **GameObject** → has sprite, position, physics config, and Blockly code (XML)
- **Reusable Object** → saved to global library, can be inserted into any scene

### State Management

- `projectStore.ts` - Project/Scene/Object CRUD operations
- `editorStore.ts` - UI state (selection, play mode, dialogs)

### Data Flow

1. User creates blocks in Blockly → saved as XML to `GameObject.blocklyXml`
2. Play button → XML converted to JS → executed in Phaser runtime
3. Projects saved to IndexedDB via Dexie

## File Organization

| Path | Purpose |
|------|---------|
| `src/types/index.ts` | All TypeScript interfaces |
| `src/db/database.ts` | Dexie DB + repositories |
| `src/store/` | Zustand stores |
| `src/components/blockly/toolbox.ts` | Custom block definitions |
| `src/components/stage/PhaserCanvas.tsx` | Phaser integration |

## Development Guidelines

### Commit Strategy

**Commit after completing each major phase.** Reference the phase in commit message:

```
Phase 1: Foundation - Vite, Phaser, Blockly, IndexedDB setup
Phase 2: Scene system and object management
Phase 3: Basic Blockly blocks
Phase 4: Code execution runtime
Phase 5: Physics and camera
Phase 6: Advanced features
Phase 7: Reusable objects library
Phase 8: Polish and UX
```

### Adding New Blocks

1. Add block definition in `src/components/blockly/toolbox.ts`
2. Register in `registerCustomBlocks()` function
3. Add to toolbox category in `getToolboxConfig()`
4. (Phase 4+) Add code generator for runtime execution

### Block Color Conventions

| Category | Color |
|----------|-------|
| Events | #FFAB19 (yellow) |
| Motion | #4C97FF (blue) |
| Looks | #9966FF (purple) |
| Physics | #40BF4A (green) |
| Control | #FFBF00 (orange) |
| Sensing | #5CB1D6 (cyan) |
| Operators | #59C059 (light green) |
| Variables | #FF8C1A (red-orange) |
| Camera | #0fBDA8 (teal) |
| Sound | #CF63CF (pink) |

## Current Status

See `plan.md` for detailed implementation progress and phase checklist.

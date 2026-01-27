# PhaserBlockly Game Maker - Project Plan

A visual game maker for children (ages 8-12) combining Blockly's block-based coding with Phaser's game engine.

## Tech Stack

- **Framework**: React 19 + TypeScript 5.9
- **Game Engine**: Phaser 3.90
- **Visual Programming**: Blockly 12
- **State Management**: Zustand 5
- **Storage**: IndexedDB (via Dexie 4)
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4
- **Future Sync**: Convex (per-user cloud sync)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        App Shell                            │
├──────────────────────┬──────────────────────────────────────┤
│   Blockly Editor     │           Stage Panel                │
│   (Left 40%)         │           (Right 60%)                │
│                      │  ┌────────────────────────────────┐  │
│  ┌────────────────┐  │  │       Phaser Canvas            │  │
│  │  Block Toolbox │  │  │       (Game Preview)           │  │
│  │  - Motion      │  │  │                                │  │
│  │  - Looks       │  │  └────────────────────────────────┘  │
│  │  - Events      │  │  ┌────────────────────────────────┐  │
│  │  - Control     │  │  │      Sprite Shelf              │  │
│  │  - Sensing     │  │  │   [🎭] [🏃] [👾] [+Add]         │  │
│  │  - Operators   │  │  └────────────────────────────────┘  │
│  │  - Variables   │  │                                      │
│  │  - Physics     │  │  Scene Tabs: [Scene1] [Scene2] [+]   │
│  └────────────────┘  │                                      │
│                      │  [▶ Play] [⏹ Stop] [🔧 Settings]     │
│  ┌────────────────┐  │                                      │
│  │  Workspace     │  │                                      │
│  │  (Block Code)  │  │                                      │
│  └────────────────┘  │                                      │
├──────────────────────┴──────────────────────────────────────┤
│  Object Inspector (selected object properties)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Project
```typescript
interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  scenes: Scene[];
  globalVariables: Variable[];
  settings: ProjectSettings;
}

interface ProjectSettings {
  canvasWidth: number;   // default 800
  canvasHeight: number;  // default 600
  backgroundColor: string;
}
```

### Scene
```typescript
interface Scene {
  id: string;
  name: string;
  order: number;
  background: BackgroundConfig | null;
  objects: GameObject[];
  cameraConfig: CameraConfig;
}

interface CameraConfig {
  followTarget: string | null;  // object id
  bounds: { x: number; y: number; width: number; height: number } | null;
  zoom: number;
}

interface BackgroundConfig {
  type: 'color' | 'image' | 'tiled';
  value: string;  // color hex or asset id
  scrollFactor?: { x: number; y: number };
}
```

### GameObject
```typescript
interface GameObject {
  id: string;
  name: string;
  spriteAssetId: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  visible: boolean;
  layer: number;

  // Physics (optional)
  physics: PhysicsConfig | null;

  // Blockly code for this object
  blocklyXml: string;
}

interface PhysicsConfig {
  enabled: boolean;
  bodyType: 'dynamic' | 'static';
  gravityY: number;
  velocityX: number;
  velocityY: number;
  bounceX: number;
  bounceY: number;
  collideWorldBounds: boolean;
  immovable: boolean;
}
```

### Reusable Object (Global Library)
```typescript
interface ReusableObject {
  id: string;
  name: string;
  thumbnail: string;        // base64 preview
  spriteAssetId: string;
  defaultPhysics: PhysicsConfig | null;
  blocklyXml: string;       // default behavior
  createdAt: Date;
  tags: string[];
}
```

### Asset
```typescript
interface Asset {
  id: string;
  name: string;
  type: 'sprite' | 'background' | 'sound';
  data: Blob;               // actual file data
  thumbnail?: string;       // base64 for quick preview
  frameWidth?: number;      // for spritesheets
  frameHeight?: number;
}
```

---

## Blockly Block Categories

### 1. Events (Yellow - #FFAB19)
```
┌─────────────────────────────┐
│ 🏁 when game starts        │
├─────────────────────────────┤
│ 🔑 when [key ▼] pressed    │
├─────────────────────────────┤
│ 🖱️ when this clicked       │
├─────────────────────────────┤
│ 💥 when touching [object▼] │
├─────────────────────────────┤
│ ⏱️ every [1] seconds       │
├─────────────────────────────┤
│ 📨 when I receive [msg▼]   │
└─────────────────────────────┘
```

### 2. Motion (Blue - #4C97FF)
```
┌─────────────────────────────┐
│ move [10] steps            │
├─────────────────────────────┤
│ go to x:[0] y:[0]          │
├─────────────────────────────┤
│ glide [1] secs to x:[] y:[]│
├─────────────────────────────┤
│ change x by [10]           │
├─────────────────────────────┤
│ set x to [0]               │
├─────────────────────────────┤
│ point in direction [90▼]   │
├─────────────────────────────┤
│ point towards [mouse▼]     │
├─────────────────────────────┤
│ bounce if on edge          │
└─────────────────────────────┘
```

### 3. Looks (Purple - #9966FF)
```
┌─────────────────────────────┐
│ switch costume to [name▼]  │
├─────────────────────────────┤
│ next costume               │
├─────────────────────────────┤
│ set size to [100]%         │
├─────────────────────────────┤
│ change size by [10]        │
├─────────────────────────────┤
│ show                       │
├─────────────────────────────┤
│ hide                       │
├─────────────────────────────┤
│ set [opacity▼] to [100]    │
├─────────────────────────────┤
│ go to [front▼] layer       │
└─────────────────────────────┘
```

### 4. Physics (Green - #40BF4A)
```
┌─────────────────────────────┐
│ ⚡ enable physics          │
├─────────────────────────────┤
│ set velocity x:[0] y:[0]   │
├─────────────────────────────┤
│ set gravity to [300]       │
├─────────────────────────────┤
│ apply force x:[0] y:[0]    │
├─────────────────────────────┤
│ set bounce to [0.5]        │
├─────────────────────────────┤
│ collide with [object▼]     │
├─────────────────────────────┤
│ [x] collide with bounds    │
├─────────────────────────────┤
│ ❄️ make immovable          │
└─────────────────────────────┘
```

### 5. Control (Orange - #FFBF00)
```
┌─────────────────────────────┐
│ wait [1] seconds           │
├─────────────────────────────┤
│ repeat [10] times          │
│   ┌─────────────────────┐  │
│   │                     │  │
│   └─────────────────────┘  │
├─────────────────────────────┤
│ forever                    │
│   ┌─────────────────────┐  │
│   │                     │  │
│   └─────────────────────┘  │
├─────────────────────────────┤
│ if <> then                 │
│   ┌─────────────────────┐  │
│   │                     │  │
│   └─────────────────────┘  │
├─────────────────────────────┤
│ if <> then ... else ...    │
├─────────────────────────────┤
│ stop [all▼]                │
├─────────────────────────────┤
│ switch to scene [name▼]    │
├─────────────────────────────┤
│ clone myself               │
├─────────────────────────────┤
│ delete this clone          │
└─────────────────────────────┘
```

### 6. Sensing (Cyan - #5CB1D6)
```
┌─────────────────────────────┐
│ <touching [object▼]?>      │
├─────────────────────────────┤
│ <touching color [#]?>      │
├─────────────────────────────┤
│ <key [space▼] pressed?>    │
├─────────────────────────────┤
│ <mouse down?>              │
├─────────────────────────────┤
│ (mouse x)                  │
├─────────────────────────────┤
│ (mouse y)                  │
├─────────────────────────────┤
│ (distance to [object▼])    │
├─────────────────────────────┤
│ ask [What's your name?]    │
├─────────────────────────────┤
│ (answer)                   │
└─────────────────────────────┘
```

### 7. Operators (Light Green - #59C059)
```
┌─────────────────────────────┐
│ ([  ] + [  ])              │
├─────────────────────────────┤
│ ([  ] - [  ])              │
├─────────────────────────────┤
│ ([  ] * [  ])              │
├─────────────────────────────┤
│ ([  ] / [  ])              │
├─────────────────────────────┤
│ pick random [1] to [10]    │
├─────────────────────────────┤
│ <[  ] > [  ]>              │
├─────────────────────────────┤
│ <[  ] < [  ]>              │
├─────────────────────────────┤
│ <[  ] = [  ]>              │
├─────────────────────────────┤
│ <<> and <>>                │
├─────────────────────────────┤
│ <<> or <>>                 │
├─────────────────────────────┤
│ <not <>>                   │
└─────────────────────────────┘
```

### 8. Variables (Red - #FF8C1A)
```
┌─────────────────────────────┐
│ [Make a Variable]          │
├─────────────────────────────┤
│ (my variable)              │
├─────────────────────────────┤
│ set [var▼] to [0]          │
├─────────────────────────────┤
│ change [var▼] by [1]       │
├─────────────────────────────┤
│ show variable [var▼]       │
├─────────────────────────────┤
│ hide variable [var▼]       │
└─────────────────────────────┘
```

### 9. Camera (Teal - #0fBDA8)
```
┌─────────────────────────────┐
│ 📷 camera follow me        │
├─────────────────────────────┤
│ camera follow [object▼]    │
├─────────────────────────────┤
│ camera stop following      │
├─────────────────────────────┤
│ camera go to x:[] y:[]     │
├─────────────────────────────┤
│ camera shake [0.5] secs    │
├─────────────────────────────┤
│ set zoom to [100]%         │
├─────────────────────────────┤
│ camera fade [in▼] [1] secs │
└─────────────────────────────┘
```

### 10. Sound (Pink - #CF63CF)
```
┌─────────────────────────────┐
│ play sound [pop▼]          │
├─────────────────────────────┤
│ play sound [pop▼] until done│
├─────────────────────────────┤
│ stop all sounds            │
├─────────────────────────────┤
│ set volume to [100]%       │
├─────────────────────────────┤
│ change volume by [-10]     │
└─────────────────────────────┘
```

---

## Directory Structure

```
src/
├── main.tsx                    # Entry point
├── App.tsx                     # Main app shell
├── index.css                   # Global styles + Tailwind
│
├── components/
│   ├── layout/
│   │   ├── EditorLayout.tsx    # ✅ Main split layout (resizable)
│   │   └── Toolbar.tsx         # ✅ Top toolbar (play/save/projects)
│   │
│   ├── blockly/
│   │   ├── BlocklyEditor.tsx   # ✅ Blockly workspace wrapper
│   │   └── toolbox.ts          # ✅ Custom blocks + toolbox config
│   │   # Future: split blocks into separate files when they grow
│   │
│   ├── stage/
│   │   ├── StagePanel.tsx      # ✅ Right panel container
│   │   ├── PhaserCanvas.tsx    # ✅ Phaser game instance
│   │   ├── SpriteShelf.tsx     # ✅ Sprite thumbnails + context menu
│   │   └── SceneTabs.tsx       # ✅ Scene tab navigation
│   │   # TODO: ObjectInspector.tsx
│   │
│   ├── dialogs/
│   │   └── ProjectDialog.tsx   # ✅ New/Open project
│   │   # TODO: SpriteDialog, AssetLibrary, ReusableLibrary
│   │
│   └── common/                 # TODO: shared UI components
│
├── phaser/                     # TODO: runtime engine
│   # GameManager.ts, RuntimeEngine.ts, etc.
│
├── store/
│   ├── projectStore.ts         # ✅ Zustand store for project state
│   └── editorStore.ts          # ✅ UI/editor state
│
├── db/
│   └── database.ts             # ✅ Dexie setup + all repositories
│
├── types/
│   └── index.ts                # ✅ All TypeScript interfaces
│
└── utils/                      # TODO: helpers
```

### Key Files Implemented

| File | Status | Description |
|------|--------|-------------|
| `types/index.ts` | ✅ | Project, Scene, GameObject, Asset, ReusableObject types |
| `db/database.ts` | ✅ | Dexie DB with projects, assets, reusables tables |
| `store/projectStore.ts` | ✅ | Full CRUD for projects, scenes, objects, variables |
| `store/editorStore.ts` | ✅ | Selection, play state, UI dialogs |
| `components/blockly/toolbox.ts` | ✅ | 25+ custom blocks across 7 categories |
| `components/stage/PhaserCanvas.tsx` | ✅ | Editor mode with draggable objects |

---

## Implementation Phases

### Phase 1: Foundation (Core Setup) ✅ COMPLETE
- [x] Initialize Vite + React + TypeScript project
- [x] Set up Tailwind CSS
- [x] Create basic layout (split panel with resizable divider)
- [x] Integrate Phaser 3 canvas
- [x] Integrate Blockly workspace
- [x] Set up Dexie.js with IndexedDB
- [x] Basic project create/save/load

### Phase 2: Scene & Object System ✅ COMPLETE
- [x] Implement Scene data model
- [x] Scene tabs UI and switching
- [x] GameObject creation and positioning
- [x] Sprite shelf component
- [x] Drag objects onto stage
- [x] Object selection
- [x] Object Inspector panel (properties editor)
- [ ] Background settings per scene (UI pending)

### Phase 3: Blockly Blocks - Basics ✅ COMPLETE
- [x] Events blocks (game start, key press, click, forever, when receive, when clone start)
- [x] Motion blocks (move, go to, change x/y, set x/y, point direction, point towards)
- [x] Looks blocks (show, hide, set size, change size, opacity, layers)
- [x] Control blocks (wait, repeat, if, stop, clone, broadcast, switch scene)
- [x] Operators blocks (math, logic, comparison) - using Blockly built-ins
- [x] Variables blocks - using Blockly built-in VARIABLE category
- [x] Sensing blocks (key pressed, mouse down/x/y, touching, distance)

### Phase 4: Code Execution ✅ COMPLETE
- [x] Code generator (Blockly → JavaScript)
- [x] Runtime engine in Phaser (RuntimeEngine, RuntimeSprite)
- [x] Play mode (fullscreen with execution)
- [x] Stop/reset functionality
- [x] Per-object code execution context

### Phase 5: Physics & Camera ✅ COMPLETE
- [x] Physics blocks (enable, velocity, gravity, bounce, collide bounds, immovable)
- [x] Per-object physics toggle (via Object Inspector)
- [x] Collision detection blocks
- [x] Camera blocks (follow, stop follow, go to, shake, zoom, fade)
- [ ] Unbounded scene support (future)
- [ ] Camera bounds configuration (future)

### Phase 6: Advanced Features ✅ COMPLETE
- [x] Sensing blocks (touching, distance)
- [x] Sound blocks and audio manager
- [x] Scene switching (switch to scene block)
- [x] Clone system (clone myself, delete clone, when start as clone)
- [x] Messaging system (broadcast, broadcast and wait, when I receive)

### Phase 7: Reusable Objects ✅ COMPLETE
- [x] "Make it Reusable" context menu
- [x] Reusable objects library UI
- [x] Save reusable with thumbnail
- [x] Insert reusable into scene
- [x] Library management (delete)

### Phase 8: Polish & UX 🟡 PARTIAL
- [ ] Undo/redo system
- [ ] Keyboard shortcuts
- [x] Asset import (images, sounds)
- [x] Built-in sprite library (shapes)
- [ ] Tooltips and help text
- [ ] Loading states and error handling
- [ ] Mobile-friendly adjustments

---

## Key Technical Decisions

### 1. Blockly → Phaser Bridge
Each block generates JavaScript that references a runtime API:
```javascript
// Generated from "move 10 steps" block
runtime.getSprite('player').moveSteps(10);
```

The `runtime` object is injected into the execution context and wraps Phaser APIs in child-friendly methods.

### 2. Editor vs Play Mode
- **Editor Mode**: Phaser runs in a paused preview state. Objects are draggable. No code executes.
- **Play Mode**: Phaser runs normally. Generated code executes. Fullscreen.

### 3. Object Code Scope
Each GameObject has its own Blockly workspace. When playing:
- All "when game starts" blocks execute
- Event listeners are registered per object
- Variables can be local (per object) or global (project-wide)

### 4. Physics Toggle
Physics config is stored per GameObject. When physics is enabled:
- Object gets Arcade Physics body
- Physics blocks become available
- Gravity/velocity/collision apply

### 5. Scene Switching
Scenes are Phaser scenes. Switching:
1. Saves current scene state
2. Destroys current Phaser scene
3. Creates new scene with target's objects
4. Restores global variables

---

## UI Mockup Notes

### Color Palette (Kid-Friendly)
- Primary: #4A90D9 (friendly blue)
- Secondary: #7C4DFF (playful purple)
- Success: #4CAF50 (green)
- Warning: #FF9800 (orange)
- Background: #F5F5F5 (light gray)
- Stage BG: #FFFFFF (white)

### Typography
- Headers: Nunito Bold
- Body: Nunito Regular
- Code/Blocks: Keep Blockly defaults

### Icons
- Use playful, rounded icons (Phosphor Icons or similar)
- Large touch targets (min 44px)
- Clear visual feedback on interactions

---

## Future Considerations (Post-MVP)

1. **Convex Integration**: Sync projects per user account
2. **Sharing**: Share project links / embed games
3. **Multiplayer Blocks**: Basic networking for 2-player games
4. **Custom Blocks**: Let advanced users create custom blocks
5. **Tutorials**: Step-by-step guided tutorials
6. **Templates**: Starter templates for common game types

import Phaser from 'phaser';
import { RuntimeSprite } from './RuntimeSprite';

// Handlers receive sprite as parameter so they work correctly for clones
type EventHandler = (sprite: RuntimeSprite) => void | Promise<void>;
type ForeverHandler = (sprite: RuntimeSprite) => void;

// Debug log that can be viewed in the debug panel
export interface DebugLogEntry {
  time: number;
  type: 'info' | 'event' | 'action' | 'error' | 'user';
  message: string;
}

export const runtimeDebugLog: DebugLogEntry[] = [];
const DEBUG_ENABLED = true;
const MAX_LOG_ENTRIES = 200;

function debugLog(type: DebugLogEntry['type'], message: string) {
  if (!DEBUG_ENABLED) return;
  const entry = { time: Date.now(), type, message };
  runtimeDebugLog.push(entry);
  if (runtimeDebugLog.length > MAX_LOG_ENTRIES) {
    runtimeDebugLog.shift();
  }
  console.log(`[Runtime ${type}] ${message}`);
}

export function clearDebugLog() {
  runtimeDebugLog.length = 0;
}

interface ObjectHandlers {
  onStart: EventHandler[];
  onKeyPressed: Map<string, EventHandler[]>;
  onClick: EventHandler[];
  onTouching: Map<string, EventHandler[]>;
  onMessage: Map<string, EventHandler[]>;
  forever: ForeverHandler[];
}

// Template for cloning - stores original object state
interface ObjectTemplate {
  id: string;
  name: string;
  componentId: string | null;
  costumes: import('../types').Costume[];
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  depth: number;
  direction: number;
  size: number;
  visible: boolean;
  colliderConfig: import('../types').ColliderConfig | null;
  physicsConfig: import('../types').PhysicsConfig | null;
  handlers: ObjectHandlers | null;
}

/**
 * RuntimeEngine manages game execution, including sprites, events, and variables.
 * This is injected into generated Blockly code as the 'runtime' object.
 */
export class RuntimeEngine {
  public scene: Phaser.Scene;
  public sprites: Map<string, RuntimeSprite> = new Map();
  public globalVariables: Map<string, number | string | boolean> = new Map();
  public localVariables: Map<string, Map<string, number | string | boolean>> = new Map();

  private handlers: Map<string, ObjectHandlers> = new Map();
  private templates: Map<string, ObjectTemplate> = new Map(); // Templates for cloning (persist after deletion)
  private activeForeverLoops: Map<string, boolean> = new Map();
  private _isRunning: boolean = false;
  private phaserKeys: Map<string, Phaser.Input.Keyboard.Key> = new Map();
  private cloneCounter: number = 0;
  private messageQueue: string[] = [];

  // Ground configuration
  private _groundEnabled: boolean = false;
  private _groundY: number = -200; // User space (Y-up)
  private _groundColor: string = '#8B4513';
  private _groundGraphics: Phaser.GameObjects.Graphics | null = null;
  private _groundBody: MatterJS.BodyType | null = null;

  // Canvas dimensions for coordinate conversion
  private _canvasWidth: number = 800;
  private _canvasHeight: number = 600;

  // Collision tracking to prevent duplicate events per frame
  private _touchingPairs: Set<string> = new Set();

  constructor(scene: Phaser.Scene, canvasWidth: number = 800, canvasHeight: number = 600) {
    this.scene = scene;
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    clearDebugLog();
    debugLog('info', 'RuntimeEngine created');
    this.setupInputListeners();
  }

  // Coordinate conversion: User space (center origin, Y-up) to Phaser space (top-left origin, Y-down)
  userToPhaser(userX: number, userY: number): { x: number; y: number } {
    return {
      x: userX + this._canvasWidth / 2,
      y: this._canvasHeight / 2 - userY
    };
  }

  // Coordinate conversion: Phaser space to User space
  phaserToUser(phaserX: number, phaserY: number): { x: number; y: number } {
    return {
      x: phaserX - this._canvasWidth / 2,
      y: this._canvasHeight / 2 - phaserY
    };
  }

  get canvasWidth(): number { return this._canvasWidth; }
  get canvasHeight(): number { return this._canvasHeight; }

  private setupInputListeners(): void {
    // Create Phaser key objects for reliable key detection
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) {
      debugLog('error', 'Keyboard input not available!');
      return;
    }

    debugLog('info', 'Setting up keyboard input...');

    // Register keys we care about
    const keysToRegister = [
      ['SPACE', Phaser.Input.Keyboard.KeyCodes.SPACE],
      ['UP', Phaser.Input.Keyboard.KeyCodes.UP],
      ['DOWN', Phaser.Input.Keyboard.KeyCodes.DOWN],
      ['LEFT', Phaser.Input.Keyboard.KeyCodes.LEFT],
      ['RIGHT', Phaser.Input.Keyboard.KeyCodes.RIGHT],
      ['W', Phaser.Input.Keyboard.KeyCodes.W],
      ['A', Phaser.Input.Keyboard.KeyCodes.A],
      ['S', Phaser.Input.Keyboard.KeyCodes.S],
      ['D', Phaser.Input.Keyboard.KeyCodes.D],
    ] as const;

    for (const [name, code] of keysToRegister) {
      this.phaserKeys.set(name, keyboard.addKey(code));
    }
    debugLog('info', `Registered ${keysToRegister.length} keys: ${keysToRegister.map(k => k[0]).join(', ')}`);

    // Listen for key down events for event_key_pressed blocks
    keyboard.on('keydown', (event: KeyboardEvent) => {
      const key = this.normalizeKey(event.code);
      debugLog('event', `Key down: ${event.code} -> ${key}`);
      this.triggerKeyPressed(key);
    });

    keyboard.on('keyup', (event: KeyboardEvent) => {
      const key = this.normalizeKey(event.code);
      debugLog('event', `Key up: ${event.code} -> ${key}`);
    });
  }

  private normalizeKey(code: string): string {
    // Map browser key codes to our key names
    const mapping: Record<string, string> = {
      'Space': 'SPACE',
      'ArrowUp': 'UP',
      'ArrowDown': 'DOWN',
      'ArrowLeft': 'LEFT',
      'ArrowRight': 'RIGHT',
      'KeyW': 'W',
      'KeyA': 'A',
      'KeyS': 'S',
      'KeyD': 'D',
    };
    return mapping[code] || code;
  }

  // --- Sprite Management ---

  registerSprite(
    id: string,
    name: string,
    container: Phaser.GameObjects.Container,
    componentId?: string | null
  ): RuntimeSprite {
    const sprite = new RuntimeSprite(this.scene, container, id, name);
    sprite.setRuntime(this);
    sprite.componentId = componentId || null;
    this.sprites.set(id, sprite);
    this.handlers.set(id, {
      onStart: [],
      onKeyPressed: new Map(),
      onClick: [],
      onTouching: new Map(),
      onMessage: new Map(),
      forever: [],
    });
    this.localVariables.set(id, new Map());
    return sprite;
  }

  // Save object template for cloning (call after object is fully initialized with props)
  // This captures the initial design-time state before any code runs
  saveTemplate(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (!sprite || sprite.isClone) return; // Only save templates for originals

    this.templates.set(spriteId, {
      id: spriteId,
      name: sprite.name,
      componentId: sprite.componentId,
      costumes: [...sprite.getCostumes()], // Copy costumes array
      x: sprite.container.x,
      y: sprite.container.y,
      scaleX: sprite.container.scaleX,
      scaleY: sprite.container.scaleY,
      rotation: sprite.container.rotation,
      depth: sprite.container.depth,
      direction: sprite.getDirection(),
      size: sprite.getSize(),
      visible: sprite.container.visible,
      colliderConfig: sprite.getColliderConfig(),
      physicsConfig: sprite.getPhysicsConfig(),
      handlers: null, // Handlers added later in updateTemplateHandlers
    });

    debugLog('info', `Saved template for "${sprite.name}" (${spriteId})`);
  }

  // Update template with handlers (call after code execution registers handlers)
  private updateTemplateHandlers(spriteId: string): void {
    const template = this.templates.get(spriteId);
    if (!template) return;

    const handlers = this.handlers.get(spriteId);
    if (handlers) {
      template.handlers = {
        onStart: [...handlers.onStart],
        onKeyPressed: new Map(handlers.onKeyPressed),
        onClick: [...handlers.onClick],
        onTouching: new Map(handlers.onTouching),
        onMessage: new Map(handlers.onMessage),
        forever: [...handlers.forever],
      };
    }
  }

  getSprite(id: string): RuntimeSprite | undefined {
    return this.sprites.get(id);
  }

  getSpriteByName(name: string): RuntimeSprite | undefined {
    for (const sprite of this.sprites.values()) {
      if (sprite.name === name) return sprite;
    }
    return undefined;
  }

  // --- Event Registration ---

  onGameStart(spriteId: string, handler: EventHandler): void {
    debugLog('info', `Registering onGameStart for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) {
      h.onStart.push(handler);
    } else {
      debugLog('error', `No handlers found for sprite ${spriteId}`);
    }
  }

  onKeyPressed(spriteId: string, key: string, handler: EventHandler): void {
    debugLog('info', `Registering onKeyPressed(${key}) for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) {
      if (!h.onKeyPressed.has(key)) h.onKeyPressed.set(key, []);
      h.onKeyPressed.get(key)!.push(handler);
      debugLog('info', `Key handler registered for ${spriteId}, key=${key}`);
    } else {
      debugLog('error', `No handlers found for sprite ${spriteId}`);
    }
  }

  onClicked(spriteId: string, handler: EventHandler): void {
    debugLog('info', `Registering onClicked for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) h.onClick.push(handler);

    // Set up click listener with pixel-perfect detection for images
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      sprite.setupClickHandler(() => {
        if (this._isRunning) {
          debugLog('event', `Click triggered on sprite ${spriteId}`);
          const currentSprite = this.sprites.get(spriteId);
          if (currentSprite) handler(currentSprite);
        }
      });
    }
  }

  onTouching(spriteId: string, targetId: string, handler: EventHandler): void {
    debugLog('info', `Registering onTouching(${targetId}) for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) {
      if (!h.onTouching.has(targetId)) h.onTouching.set(targetId, []);
      h.onTouching.get(targetId)!.push(handler);
    }
  }

  onMessage(spriteId: string, message: string, handler: EventHandler): void {
    debugLog('info', `Registering onMessage(${message}) for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) {
      if (!h.onMessage.has(message)) h.onMessage.set(message, []);
      h.onMessage.get(message)!.push(handler);
    }
  }

  forever(spriteId: string, handler: ForeverHandler): void {
    debugLog('info', `Registering forever loop for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) {
      h.forever.push(handler);
      debugLog('info', `Forever loop count for ${spriteId}: ${h.forever.length}`);
      // If game is already running (e.g., clone registering forever loop), activate immediately
      if (this._isRunning) {
        this.activeForeverLoops.set(spriteId, true);
        debugLog('info', `Activated forever loop for ${spriteId} (runtime already running)`);
      }
    } else {
      debugLog('error', `No handlers found for sprite ${spriteId}`);
    }
  }


  // --- Event Triggering ---

  private triggerKeyPressed(key: string): void {
    debugLog('event', `triggerKeyPressed(${key}) called, isRunning=${this._isRunning}`);
    if (!this._isRunning) {
      debugLog('info', `Ignoring key press - runtime not running`);
      return;
    }
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (!sprite || sprite.isStopped()) continue;
      const keyHandlers = h.onKeyPressed.get(key);
      debugLog('info', `Checking handlers for sprite ${spriteId}: has ${key} handlers = ${!!keyHandlers}, count = ${keyHandlers?.length || 0}`);
      if (keyHandlers) {
        debugLog('event', `Executing ${keyHandlers.length} handler(s) for key ${key}`);
        keyHandlers.forEach(handler => {
          try {
            handler(sprite);
          } catch (e) {
            debugLog('error', `Error in key handler: ${e}`);
          }
        });
      }
    }
  }

  async start(): Promise<void> {
    debugLog('info', '=== Runtime starting ===');
    this._isRunning = true;

    // Log registered handlers summary (before onStart)
    for (const [spriteId, h] of this.handlers) {
      debugLog('info', `Sprite ${spriteId}: onStart=${h.onStart.length}, forever=${h.forever.length}, onKeyPressed=${h.onKeyPressed.size}`);
    }

    // Execute all onStart handlers
    // This is where forever loops get registered (inside onStart handlers)
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (!sprite || sprite.isStopped()) continue;
      for (const handler of h.onStart) {
        try {
          debugLog('event', `Executing onStart handler for ${spriteId}`);
          await handler(sprite);
        } catch (e) {
          debugLog('error', `Error in onStart for ${spriteId}: ${e}`);
          console.error(`Error in onStart for ${spriteId}:`, e);
        }
      }
    }

    // Update templates with handlers AFTER onStart handlers have run
    // This ensures forever loops registered inside onStart are captured
    for (const [spriteId, sprite] of this.sprites) {
      if (!sprite.isClone) {
        this.updateTemplateHandlers(spriteId);
      }
    }

    // Start forever loops
    for (const [spriteId, h] of this.handlers) {
      if (h.forever.length > 0) {
        this.activeForeverLoops.set(spriteId, true);
        debugLog('info', `Activated forever loop for ${spriteId}`);
      }
    }
    debugLog('info', '=== Runtime started ===');
  }

  private frameCount = 0;
  update(): void {
    if (!this._isRunning) return;

    this.frameCount++;

    // Log every 60 frames (about once per second)
    if (this.frameCount % 60 === 0) {
      debugLog('info', `Update frame ${this.frameCount}, active forever loops: ${this.activeForeverLoops.size}`);

      // Log key states
      const keyStates: string[] = [];
      for (const [key, phaserKey] of this.phaserKeys) {
        if (phaserKey.isDown) {
          keyStates.push(key);
        }
      }
      if (keyStates.length > 0) {
        debugLog('info', `Keys currently down: ${keyStates.join(', ')}`);
      }
    }

    // Run forever loops - only for original sprites, not clones
    // Clones inherit forever handlers but should run them with their own context
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (!sprite || sprite.isStopped()) continue;
      if (!this.activeForeverLoops.get(spriteId)) continue;

      for (const handler of h.forever) {
        try {
          handler(sprite);
        } catch (e) {
          debugLog('error', `Error in forever loop for ${spriteId}: ${e}`);
          console.error(`Error in forever loop for ${spriteId}:`, e);
        }
      }
    }

    // Clear touching pairs from previous frame
    this._touchingPairs.clear();

    // Clear ground touching flags at end of frame for all sprites
    // Gravity is handled by Matter.js via body.gravityScale property
    for (const sprite of this.sprites.values()) {
      // Clear ground touching flags - they will be set again by collision callbacks next physics step
      sprite.setTouchingGround(false);
    }

    // Process message queue
    this.processMessages();
  }

  /**
   * Set up Phaser physics colliders after all sprites are registered
   */
  setupPhysicsColliders(): void {
    const sprites = Array.from(this.sprites.values());

    // Matter.js handles collisions automatically between all bodies
    // We just need to listen for collision events for "when touching" handlers

    // Helper to find sprite IDs from collision bodies
    const findSpriteIds = (bodyA: MatterJS.BodyType, bodyB: MatterJS.BodyType) => {
      let spriteIdA: string | null = null;
      let spriteIdB: string | null = null;

      for (const sprite of this.sprites.values()) {
        const spriteBody = (sprite.container as unknown as { body?: MatterJS.BodyType }).body;
        if (spriteBody === bodyA || spriteBody?.parent === bodyA) {
          spriteIdA = sprite.id;
        }
        if (spriteBody === bodyB || spriteBody?.parent === bodyB) {
          spriteIdB = sprite.id;
        }
      }
      return { spriteIdA, spriteIdB };
    };

    // Listen for collision START events (for "when touching" event handlers)
    this.scene.matter.world.on('collisionstart', (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
      for (const pair of event.pairs) {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        const { spriteIdA, spriteIdB } = findSpriteIds(bodyA, bodyB);

        // Handle sprite-to-sprite collision events
        if (spriteIdA && spriteIdB) {
          this.handleSpriteOverlap(spriteIdA, spriteIdB);
        }

        // Also handle ground collision on start (first frame of contact)
        const isGroundA = bodyA === this._groundBody || bodyA.label === 'ground';
        const isGroundB = bodyB === this._groundBody || bodyB.label === 'ground';
        if (isGroundA || isGroundB) {
          const spriteId = isGroundA ? spriteIdB : spriteIdA;
          if (spriteId) {
            this.handleGroundCollision(spriteId);
          }
        }
      }
    });

    // Listen for collision ACTIVE events (fires every frame while touching)
    // This is critical for ground detection - we need to know EVERY frame if touching ground
    this.scene.matter.world.on('collisionactive', (event: Phaser.Physics.Matter.Events.CollisionActiveEvent) => {
      for (const pair of event.pairs) {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;

        // Check for ground collision - set flag every frame while touching
        // Also check by label since body reference comparison can fail
        const isGroundA = bodyA === this._groundBody || bodyA.label === 'ground';
        const isGroundB = bodyB === this._groundBody || bodyB.label === 'ground';

        if (isGroundA || isGroundB) {
          const { spriteIdA, spriteIdB } = findSpriteIds(bodyA, bodyB);
          const spriteId = isGroundA ? spriteIdB : spriteIdA;
          if (spriteId) {
            this.handleGroundCollision(spriteId);
          }
        }
      }
    });

    // Set up ground body if ground is enabled
    if (this._groundEnabled) {
      this.updateGroundBody();
    }

    debugLog('info', `Physics colliders set up for ${sprites.length} sprites (Matter.js)`);
  }

  private groundLogThrottle = 0;
  private handleGroundCollision(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      sprite.setTouchingGround(true);
      // Log occasionally to avoid spam
      if (this.groundLogThrottle++ % 60 === 0) {
        debugLog('event', `${sprite.name} touching ground`);
      }
    }
  }

  private handleSpriteOverlap(spriteIdA: string, spriteIdB: string): void {
    // Create a unique key for this pair (order-independent)
    const pairKey = [spriteIdA, spriteIdB].sort().join('|');

    // Only fire once per frame per pair
    if (this._touchingPairs.has(pairKey)) return;
    this._touchingPairs.add(pairKey);

    const spriteA = this.sprites.get(spriteIdA);
    const spriteB = this.sprites.get(spriteIdB);

    // Check if A has handlers for touching B (direct or component-any)
    const handlersA = this.handlers.get(spriteIdA);
    if (handlersA && spriteA) {
      // Direct handler for B
      const touchHandlersA = handlersA.onTouching.get(spriteIdB);
      if (touchHandlersA) {
        touchHandlersA.forEach(handler => handler(spriteA));
      }
      // Component-any handler for B's component
      if (spriteB?.componentId) {
        const componentAnyHandlers = handlersA.onTouching.get(`COMPONENT_ANY:${spriteB.componentId}`);
        if (componentAnyHandlers) {
          componentAnyHandlers.forEach(handler => handler(spriteA));
        }
      }
    }

    // Check if B has handlers for touching A (direct or component-any)
    const handlersB = this.handlers.get(spriteIdB);
    if (handlersB && spriteB) {
      // Direct handler for A
      const touchHandlersB = handlersB.onTouching.get(spriteIdA);
      if (touchHandlersB) {
        touchHandlersB.forEach(handler => handler(spriteB));
      }
      // Component-any handler for A's component
      if (spriteA?.componentId) {
        const componentAnyHandlers = handlersB.onTouching.get(`COMPONENT_ANY:${spriteA.componentId}`);
        if (componentAnyHandlers) {
          componentAnyHandlers.forEach(handler => handler(spriteB));
        }
      }
    }
  }

  private processMessages(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      for (const [spriteId, h] of this.handlers) {
        const sprite = this.sprites.get(spriteId);
        if (!sprite || sprite.isStopped()) continue;
        const msgHandlers = h.onMessage.get(message);
        if (msgHandlers) {
          msgHandlers.forEach(handler => handler(sprite));
        }
      }
    }
  }

  // --- Actions ---

  broadcast(message: string): void {
    this.messageQueue.push(message);
  }

  broadcastAndWait(message: string): Promise<void> {
    return new Promise(resolve => {
      this.broadcast(message);
      // Simple implementation - just wait a tick
      setTimeout(resolve, 16);
    });
  }

  consoleLog(value: unknown): void {
    let message: string;
    if (value === null) {
      message = 'null';
    } else if (value === undefined) {
      message = 'undefined';
    } else if (typeof value === 'object') {
      // Handle circular references with a custom replacer
      const seen = new WeakSet();
      try {
        message = JSON.stringify(value, (_key, val) => {
          if (typeof val === 'object' && val !== null) {
            // Skip Phaser objects to avoid circular refs
            if (val.constructor?.name?.includes('Scene') ||
                val.constructor?.name?.includes('Game') ||
                val.constructor?.name === 'Systems2' ||
                val.constructor?.name === 'Matter') {
              return `[${val.constructor.name}]`;
            }
            if (seen.has(val)) {
              return '[Circular]';
            }
            seen.add(val);
          }
          return val;
        }, 2);
      } catch {
        // Fallback: show constructor name and basic props
        const name = value.constructor?.name || 'Object';
        const keys = Object.keys(value as object).slice(0, 5);
        message = `[${name}] {${keys.join(', ')}${keys.length < Object.keys(value as object).length ? '...' : ''}}`;
      }
    } else {
      message = String(value);
    }
    const entry: DebugLogEntry = { time: Date.now(), type: 'user', message };
    runtimeDebugLog.push(entry);
    if (runtimeDebugLog.length > 200) {
      runtimeDebugLog.shift();
    }
    console.log(`[User] ${message}`);
  }

  stopAll(): void {
    this._isRunning = false;
    this.activeForeverLoops.clear();
    for (const sprite of this.sprites.values()) {
      sprite.stop();
    }
  }

  /**
   * Clean up all resources - call this before destroying the runtime
   */
  cleanup(): void {
    debugLog('info', 'RuntimeEngine cleanup');
    this.stopAll();

    // Stop all sounds before destroying
    try {
      this.stopAllSounds();
      // Also stop sound manager to prevent AudioContext errors
      if (this.scene?.sound) {
        this.scene.sound.stopAll();
        this.scene.sound.removeAll();
      }
    } catch (e) {
      // Ignore errors if audio system already destroyed
    }

    // Remove keyboard listeners
    const keyboard = this.scene.input.keyboard;
    if (keyboard) {
      keyboard.removeAllListeners();
      // Remove all registered keys
      for (const key of this.phaserKeys.values()) {
        keyboard.removeKey(key);
      }
      this.phaserKeys.clear();
    }

    // Clear all handlers
    this.handlers.clear();
    this.sprites.clear();
    this.globalVariables.clear();
    this.localVariables.clear();

    debugLog('info', 'RuntimeEngine cleanup complete');
  }

  stopSprite(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite) sprite.stop();
    this.activeForeverLoops.set(spriteId, false);
  }

  // --- Input Queries ---

  private lastKeyCheckLog = 0;
  isKeyPressed(key: string): boolean {
    const phaserKey = this.phaserKeys.get(key);
    if (phaserKey) {
      const isDown = phaserKey.isDown;
      // Log only once per second to avoid spam
      const now = Date.now();
      if (isDown && now - this.lastKeyCheckLog > 1000) {
        debugLog('action', `isKeyPressed(${key}) = ${isDown}`);
        this.lastKeyCheckLog = now;
      }
      return isDown;
    }
    debugLog('error', `isKeyPressed: Unknown key "${key}"`);
    return false;
  }

  isMouseDown(): boolean {
    return this.scene.input.activePointer.isDown;
  }

  getMouseX(): number {
    // Convert Phaser mouse X to user space
    return this.scene.input.activePointer.worldX - this._canvasWidth / 2;
  }

  getMouseY(): number {
    // Convert Phaser mouse Y to user space (+Y is up)
    return this._canvasHeight / 2 - this.scene.input.activePointer.worldY;
  }

  // --- Variables ---

  getVariable(name: string, spriteId?: string): number | string | boolean {
    if (spriteId) {
      const localVars = this.localVariables.get(spriteId);
      if (localVars?.has(name)) return localVars.get(name)!;
    }
    return this.globalVariables.get(name) ?? 0;
  }

  setVariable(name: string, value: number | string | boolean, spriteId?: string): void {
    if (spriteId) {
      const localVars = this.localVariables.get(spriteId);
      if (localVars) {
        localVars.set(name, value);
        return;
      }
    }
    this.globalVariables.set(name, value);
  }

  changeVariable(name: string, delta: number, spriteId?: string): void {
    const current = this.getVariable(name, spriteId);
    if (typeof current === 'number') {
      this.setVariable(name, current + delta, spriteId);
    }
  }

  // --- Typed Variables (use variable ID instead of name) ---

  // Variable definition lookup - injected by PhaserCanvas
  private _variableLookup: ((varId: string) => { name: string; type: string; scope: string; defaultValue: unknown } | undefined) | null = null;

  setVariableLookup(lookup: ((varId: string) => { name: string; type: string; scope: string; defaultValue: unknown } | undefined) | null) {
    this._variableLookup = lookup;
  }

  getTypedVariable(varId: string, spriteId?: string): number | string | boolean {
    const varDef = this._variableLookup?.(varId);
    if (!varDef) {
      debugLog('error', `Unknown variable ID: ${varId}`);
      return 0;
    }

    // For local variables, check sprite's local store first
    if (varDef.scope === 'local' && spriteId) {
      const localVars = this.localVariables.get(spriteId);
      if (localVars?.has(varId)) return localVars.get(varId)!;
      // Return default value if not set
      return varDef.defaultValue as number | string | boolean;
    }

    // Global variable
    if (this.globalVariables.has(varId)) {
      return this.globalVariables.get(varId)!;
    }
    return varDef.defaultValue as number | string | boolean;
  }

  setTypedVariable(varId: string, value: number | string | boolean, spriteId?: string): void {
    const varDef = this._variableLookup?.(varId);
    if (!varDef) {
      debugLog('error', `Unknown variable ID: ${varId}`);
      return;
    }

    // Type coercion based on variable type
    let coercedValue: number | string | boolean = value;
    switch (varDef.type) {
      case 'integer':
        coercedValue = Math.floor(Number(value)) || 0;
        break;
      case 'float':
        coercedValue = Number(value) || 0;
        break;
      case 'string':
        coercedValue = String(value);
        break;
      case 'boolean':
        coercedValue = Boolean(value);
        break;
    }

    if (varDef.scope === 'local' && spriteId) {
      let localVars = this.localVariables.get(spriteId);
      if (!localVars) {
        localVars = new Map();
        this.localVariables.set(spriteId, localVars);
      }
      localVars.set(varId, coercedValue);
    } else {
      this.globalVariables.set(varId, coercedValue);
    }
  }

  changeTypedVariable(varId: string, delta: number, spriteId?: string): void {
    const current = this.getTypedVariable(varId, spriteId);
    if (typeof current === 'number') {
      this.setTypedVariable(varId, current + delta, spriteId);
    }
  }

  // --- Clone System ---

  private static MAX_CLONES = 300; // Prevent infinite clone crashes

  async cloneSprite(spriteId: string): Promise<RuntimeSprite | null> {
    // Safeguard: limit total clone count
    const cloneCount = Array.from(this.sprites.values()).filter(s => s.isClone).length;
    if (cloneCount >= RuntimeEngine.MAX_CLONES) {
      debugLog('error', `Clone limit (${RuntimeEngine.MAX_CLONES}) reached, ignoring clone request`);
      return null;
    }

    // Find the original object ID (trace back if spriteId is a clone)
    let originalId = spriteId;
    const sourceSprite = this.sprites.get(spriteId);

    if (sourceSprite) {
      // Trace back to the original
      let current = sourceSprite;
      while (current.isClone && current.cloneParentId) {
        originalId = current.cloneParentId;
        const parent = this.sprites.get(originalId);
        if (!parent) break;
        current = parent;
      }
    } else {
      // spriteId might be a clone ID, extract the original ID
      const match = spriteId.match(/^(.+?)_clone_\d+$/);
      if (match) {
        originalId = match[1];
      }
    }

    debugLog('info', `cloneSprite: spriteId="${spriteId}", originalId="${originalId}"`);

    // Get template (required for cloning)
    const template = this.templates.get(originalId);
    if (!template) {
      debugLog('error', `No template found for "${originalId}". Cannot clone.`);
      return null;
    }

    // Get live sprite if it exists (for current position/state)
    const liveOriginal = this.sprites.get(originalId);

    this.cloneCounter++;
    const cloneId = `${originalId}_clone_${this.cloneCounter}`;

    // Use live sprite's position if available, otherwise use template
    const x = liveOriginal?.container.x ?? template.x;
    const y = liveOriginal?.container.y ?? template.y;
    const scaleX = liveOriginal?.container.scaleX ?? template.scaleX;
    const scaleY = liveOriginal?.container.scaleY ?? template.scaleY;
    const rotation = liveOriginal?.container.rotation ?? template.rotation;
    const depth = liveOriginal?.container.depth ?? template.depth;

    // Create a placeholder graphics (will be replaced by costume if available)
    const graphics = this.scene.add.graphics();
    const color = this.getObjectColor(cloneId);
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(-32, -32, 64, 64, 8);

    // Create container
    const container = this.scene.add.container(x, y, [graphics]);
    container.setName(cloneId);
    container.setSize(64, 64);
    container.setScale(scaleX, scaleY);
    container.setRotation(rotation);
    container.setDepth(depth);

    // Register the clone
    const clone = this.registerSprite(cloneId, `${template.name} (clone)`, container, template.componentId);
    clone.isClone = true;
    clone.cloneParentId = originalId;

    // Copy state from template or live sprite
    if (liveOriginal) {
      clone.copyStateFrom(liveOriginal);
    } else {
      // Copy from template - don't use setSize as it overrides scale
      clone.setCostumes([...template.costumes], 0);
      clone.pointInDirection(template.direction);
      clone.setSizeInternal(template.size); // Set internal size without changing scale
      if (template.colliderConfig) clone.setColliderConfig(template.colliderConfig);
      if (template.physicsConfig) clone.setPhysicsConfig(template.physicsConfig);
      if (!template.visible) clone.hide();
    }

    // Copy event handlers from template
    const templateHandlers = template.handlers;
    const cloneHandlers = this.handlers.get(cloneId);

    if (templateHandlers && cloneHandlers) {
      // Copy key pressed handlers
      for (const [key, handlers] of templateHandlers.onKeyPressed) {
        cloneHandlers.onKeyPressed.set(key, [...handlers]);
      }

      // Copy onClick handlers and set up click listener for clone
      cloneHandlers.onClick = [...templateHandlers.onClick];
      if (cloneHandlers.onClick.length > 0) {
        clone.setupClickHandler(() => {
          if (this._isRunning) {
            const currentClone = this.sprites.get(cloneId);
            if (currentClone) {
              cloneHandlers.onClick.forEach(handler => handler(currentClone));
            }
          }
        });
      }

      // Copy onTouching handlers
      for (const [targetId, handlers] of templateHandlers.onTouching) {
        cloneHandlers.onTouching.set(targetId, [...handlers]);
      }

      // Copy onMessage handlers
      for (const [message, handlers] of templateHandlers.onMessage) {
        cloneHandlers.onMessage.set(message, [...handlers]);
      }

      // Copy onStart handlers
      cloneHandlers.onStart = [...templateHandlers.onStart];

      // Copy forever handlers and activate them
      cloneHandlers.forever = [...templateHandlers.forever];
      if (cloneHandlers.forever.length > 0) {
        this.activeForeverLoops.set(cloneId, true);
      }
    }

    // Execute onStart handlers for the clone
    if (cloneHandlers) {
      for (const handler of cloneHandlers.onStart) {
        try {
          debugLog('event', `Executing onStart handler for clone ${cloneId}`);
          await handler(clone);
        } catch (e) {
          debugLog('error', `Error in onStart for clone ${cloneId}: ${e}`);
        }
      }
    }

    debugLog('info', `Cloned from template "${template.name}" -> "${clone.name}" with ID ${cloneId}`);
    return clone;
  }

  async cloneSpriteAt(spriteId: string, userX: number, userY: number): Promise<RuntimeSprite | null> {
    const clone = await this.cloneSprite(spriteId);
    if (clone) {
      clone.goTo(userX, userY);
    }
    return clone;
  }

  deleteSelf(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(spriteId);
      this.handlers.delete(spriteId);
      this.localVariables.delete(spriteId);
    }
  }

  deleteObject(obj: RuntimeSprite | null): void {
    if (!obj) return;
    obj.destroy();
    this.sprites.delete(obj.id);
    this.handlers.delete(obj.id);
    this.localVariables.delete(obj.id);
  }

  private getObjectColor(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & hash;
    }
    const hue = Math.abs(hash % 360);
    return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.7).color;
  }

  // --- Sensing ---

  isTouching(spriteId: string, targetId: string): boolean {
    const sprite = this.sprites.get(spriteId);
    if (!sprite) return false;

    // Handle EDGE special case - check if touching canvas bounds
    if (targetId === 'EDGE') {
      const bounds = sprite.container.getBounds();
      return bounds.left <= 0 || bounds.right >= this._canvasWidth ||
             bounds.top <= 0 || bounds.bottom >= this._canvasHeight;
    }

    // Handle MY_CLONES - check if touching any clone of the same original object
    if (targetId === 'MY_CLONES') {
      // Get the original object ID (if this is a clone, use its cloneParentId; otherwise use its own id)
      const originalId = sprite.cloneParentId || sprite.id;
      for (const target of this.sprites.values()) {
        if (target.id === spriteId) continue; // Don't check self
        // Check if target is a clone of the same original, or is the original itself
        const targetOriginalId = target.cloneParentId || target.id;
        if (targetOriginalId === originalId && target.id !== spriteId) {
          if (this.isTouchingSingle(sprite, target)) {
            return true;
          }
        }
      }
      return false;
    }

    // Handle COMPONENT_ANY: prefix - check if touching any instance of a component
    if (targetId.startsWith('COMPONENT_ANY:')) {
      const componentId = targetId.substring('COMPONENT_ANY:'.length);
      for (const target of this.sprites.values()) {
        if (target.id === spriteId) continue; // Don't check self
        if (target.componentId === componentId) {
          if (this.isTouchingSingle(sprite, target)) {
            return true;
          }
        }
      }
      return false;
    }

    const target = this.sprites.get(targetId);
    if (!target) return false;

    return this.isTouchingSingle(sprite, target);
  }

  getTouchingObject(spriteId: string, filter?: string): RuntimeSprite | null {
    const results = this.getAllTouchingObjects(spriteId, filter);
    return results.length > 0 ? results[0] : null;
  }

  getAllTouchingObjects(spriteId: string, filter?: string): RuntimeSprite[] {
    const sprite = this.sprites.get(spriteId);
    if (!sprite) return [];

    const results: RuntimeSprite[] = [];

    // Check all other sprites for collision
    for (const target of this.sprites.values()) {
      if (target.id === spriteId) continue; // Don't check self
      if (target.isStopped()) continue; // Skip stopped sprites
      if (!target.container.visible) continue; // Skip invisible sprites

      // Apply filter if specified
      if (filter) {
        if (filter === 'MY_CLONES') {
          // Only consider clones of the same original object
          const originalId = sprite.cloneParentId || sprite.id;
          const targetOriginalId = target.cloneParentId || target.id;
          if (targetOriginalId !== originalId) continue;
        } else if (filter.startsWith('COMPONENT_ANY:')) {
          // Only consider instances of a specific component
          const componentId = filter.substring('COMPONENT_ANY:'.length);
          if (target.componentId !== componentId) continue;
        } else if (filter !== 'EDGE') {
          // Specific object ID filter
          if (target.id !== filter) continue;
        }
      }

      if (this.isTouchingSingle(sprite, target)) {
        results.push(target);
      }
    }

    return results;
  }

  async forEachTouchingClone(spriteId: string, callback: (clone: RuntimeSprite) => Promise<void>): Promise<void> {
    const touchingClones = this.getAllTouchingObjects(spriteId, 'MY_CLONES');
    for (const clone of touchingClones) {
      if (!clone.isStopped()) {
        await callback(clone);
      }
    }
  }

  isCloneOf(obj: RuntimeSprite | null, targetId: string): boolean {
    if (!obj) return false;
    const objOriginalId = obj.cloneParentId || obj.id;
    return objOriginalId === targetId;
  }

  private isTouchingSingle(sprite: RuntimeSprite, target: RuntimeSprite): boolean {
    // Use Matter.js body bounds for collision detection
    const matterContainerA = sprite.container as unknown as { body?: MatterJS.BodyType };
    const matterContainerB = target.container as unknown as { body?: MatterJS.BodyType };
    const bodyA = matterContainerA.body;
    const bodyB = matterContainerB.body;

    if (bodyA && bodyB) {
      // Check AABB overlap using Matter.js bounds
      const boundsA = bodyA.bounds;
      const boundsB = bodyB.bounds;
      return !(boundsA.max.x < boundsB.min.x ||
               boundsA.min.x > boundsB.max.x ||
               boundsA.max.y < boundsB.min.y ||
               boundsA.min.y > boundsB.max.y);
    }

    // Fallback to simple AABB using sprite dimensions
    // Get the actual sprite inside container to get proper dimensions
    const spriteA = sprite.container.list[0] as Phaser.GameObjects.Sprite | undefined;
    const spriteB = target.container.list[0] as Phaser.GameObjects.Sprite | undefined;

    if (!spriteA || !spriteB) return false;

    const ax = sprite.container.x;
    const ay = sprite.container.y;
    const aw = spriteA.displayWidth * Math.abs(sprite.container.scaleX);
    const ah = spriteA.displayHeight * Math.abs(sprite.container.scaleY);

    const bx = target.container.x;
    const by = target.container.y;
    const bw = spriteB.displayWidth * Math.abs(target.container.scaleX);
    const bh = spriteB.displayHeight * Math.abs(target.container.scaleY);

    // AABB collision (assuming origin at center)
    const halfAW = aw / 2;
    const halfAH = ah / 2;
    const halfBW = bw / 2;
    const halfBH = bh / 2;

    return !(ax + halfAW < bx - halfBW ||
             ax - halfAW > bx + halfBW ||
             ay + halfAH < by - halfBH ||
             ay - halfAH > by + halfBH);
  }

  distanceTo(spriteId: string, targetId: string): number {
    const sprite = this.sprites.get(spriteId);
    if (!sprite) return 0;

    // Handle MOUSE special case
    if (targetId === 'MOUSE') {
      const mouseX = this.scene.input.activePointer.worldX;
      const mouseY = this.scene.input.activePointer.worldY;
      return Phaser.Math.Distance.Between(
        sprite.container.x,
        sprite.container.y,
        mouseX,
        mouseY
      );
    }

    const target = this.sprites.get(targetId);
    if (!target) return 0;

    return Phaser.Math.Distance.Between(
      sprite.container.x,
      sprite.container.y,
      target.container.x,
      target.container.y
    );
  }

  // --- Camera ---

  cameraFollowSprite(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      this.scene.cameras.main.startFollow(sprite.container);
    }
  }

  cameraStopFollow(): void {
    this.scene.cameras.main.stopFollow();
  }

  cameraGoTo(userX: number, userY: number): void {
    // Convert user coordinates to Phaser coordinates
    const phaser = this.userToPhaser(userX, userY);
    this.scene.cameras.main.centerOn(phaser.x, phaser.y);
  }

  cameraShake(duration: number, intensity: number = 0.01): void {
    this.scene.cameras.main.shake(duration * 1000, intensity);
  }

  cameraZoom(zoom: number): void {
    this.scene.cameras.main.setZoom(zoom / 100);
  }

  cameraFadeIn(duration: number): void {
    this.scene.cameras.main.fadeIn(duration * 1000);
  }

  cameraFadeOut(duration: number): void {
    this.scene.cameras.main.fadeOut(duration * 1000);
  }

  /**
   * Set camera follow deadzone (range from center before camera starts moving)
   * @param width - Horizontal deadzone in pixels (0 = no deadzone)
   * @param height - Vertical deadzone in pixels (0 = no deadzone)
   */
  cameraSetFollowRange(width: number, height: number): void {
    this.scene.cameras.main.setDeadzone(width, height);
    debugLog('action', `Camera deadzone set to ${width}x${height}`);
  }

  /**
   * Set camera follow smoothness (lerp factor)
   * @param smoothness - 0-100 where 0 = instant snap, 100 = very slow/smooth
   */
  cameraSetFollowSmoothness(smoothness: number): void {
    // Convert 0-100 to lerp value (1 = instant, 0.01 = very smooth)
    // We invert so higher smoothness = smoother (lower lerp)
    const clampedSmoothness = Math.max(0, Math.min(100, smoothness));
    const lerp = 1 - (clampedSmoothness / 100) * 0.99; // Range: 1 to 0.01
    this.scene.cameras.main.setLerp(lerp, lerp);
    debugLog('action', `Camera smoothness set to ${smoothness}% (lerp=${lerp.toFixed(3)})`);
  }

  // --- Sound ---

  private volume: number = 100;
  private playingAudios: HTMLAudioElement[] = [];
  // Store sound definitions: soundId -> { dataUrl, trimStart, trimEnd }
  private soundDefinitions: Map<string, { dataUrl: string; trimStart?: number; trimEnd?: number }> = new Map();

  /**
   * Register sounds from an object so they can be played by ID
   */
  registerSounds(sounds: Array<{ id: string; assetId: string; trimStart?: number; trimEnd?: number }>): void {
    for (const sound of sounds) {
      debugLog('info', `Registering sound: ${sound.id} (has data: ${!!sound.assetId}, data length: ${sound.assetId?.length || 0})`);
      this.soundDefinitions.set(sound.id, {
        dataUrl: sound.assetId,
        trimStart: sound.trimStart,
        trimEnd: sound.trimEnd,
      });
    }
    debugLog('info', `Total registered sounds: ${this.soundDefinitions.size}`);
  }

  playSound(soundKey: string): void {
    const soundDef = this.soundDefinitions.get(soundKey);
    if (!soundDef) {
      debugLog('error', `Sound "${soundKey}" not found`);
      return;
    }

    const audio = new Audio(soundDef.dataUrl);
    audio.volume = this.volume / 100;

    // Apply trim start
    if (soundDef.trimStart) {
      audio.currentTime = soundDef.trimStart;
    }

    // Handle trim end
    if (soundDef.trimEnd) {
      audio.ontimeupdate = () => {
        if (audio.currentTime >= soundDef.trimEnd!) {
          audio.pause();
          this.removeAudio(audio);
        }
      };
    }

    audio.onended = () => this.removeAudio(audio);
    audio.play().catch(e => debugLog('error', `Failed to play sound: ${e}`));
    this.playingAudios.push(audio);
  }

  playSoundUntilDone(soundKey: string): Promise<void> {
    return new Promise(resolve => {
      const soundDef = this.soundDefinitions.get(soundKey);
      if (!soundDef) {
        debugLog('error', `Sound "${soundKey}" not found`);
        resolve();
        return;
      }

      const audio = new Audio(soundDef.dataUrl);
      audio.volume = this.volume / 100;

      // Apply trim start
      if (soundDef.trimStart) {
        audio.currentTime = soundDef.trimStart;
      }

      // Handle trim end
      if (soundDef.trimEnd) {
        audio.ontimeupdate = () => {
          if (audio.currentTime >= soundDef.trimEnd!) {
            audio.pause();
            this.removeAudio(audio);
            resolve();
          }
        };
      }

      audio.onended = () => {
        this.removeAudio(audio);
        resolve();
      };

      audio.play().catch(e => {
        debugLog('error', `Failed to play sound: ${e}`);
        resolve();
      });
      this.playingAudios.push(audio);
    });
  }

  private removeAudio(audio: HTMLAudioElement): void {
    const index = this.playingAudios.indexOf(audio);
    if (index > -1) {
      this.playingAudios.splice(index, 1);
    }
  }

  stopAllSounds(): void {
    for (const audio of this.playingAudios) {
      audio.pause();
      audio.src = '';
    }
    this.playingAudios = [];
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    // Update all playing sounds
    for (const audio of this.playingAudios) {
      audio.volume = this.volume / 100;
    }
  }

  changeVolume(delta: number): void {
    this.setVolume(this.volume + delta);
  }

  getVolume(): number {
    return this.volume;
  }

  // --- Utility ---

  wait(seconds: number): Promise<void> {
    return new Promise(resolve => {
      this.scene.time.delayedCall(seconds * 1000, resolve);
    });
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // --- Ground ---

  setGroundEnabled(enabled: boolean): void {
    this._groundEnabled = enabled;
    this.updateGroundVisual();
    this.updateGroundBody();
    // Matter.js collision detection is set up automatically via world events
  }

  setGroundY(y: number): void {
    this._groundY = y;
    this.updateGroundVisual();
    this.updateGroundBody();
    // Matter.js collision detection is set up automatically via world events
  }

  setGroundColor(color: string): void {
    this._groundColor = color;
    this.updateGroundVisual();
  }

  getGroundY(): number {
    return this._groundY;
  }

  getGroundColor(): string {
    return this._groundColor;
  }

  isGroundEnabled(): boolean {
    return this._groundEnabled;
  }

  /**
   * Configure ground from scene settings
   */
  configureGround(enabled: boolean, y: number, color: string): void {
    this._groundEnabled = enabled;
    this._groundY = y;
    this._groundColor = color;
    this.updateGroundVisual();
    this.updateGroundBody();
  }

  private updateGroundVisual(): void {
    if (!this._groundGraphics) {
      this._groundGraphics = this.scene.add.graphics();
      this._groundGraphics.setDepth(-1000); // Behind everything
    }

    this._groundGraphics.clear();

    if (this._groundEnabled) {
      // Convert user Y to Phaser Y
      const phaserGroundY = this._canvasHeight / 2 - this._groundY;

      // Parse color and draw ground
      const color = Phaser.Display.Color.HexStringToColor(this._groundColor);
      const groundHeight = 2000; // Large enough to cover below ground
      const groundWidth = 10000; // Wide enough for most scenes

      this._groundGraphics.fillStyle(color.color, 1);
      this._groundGraphics.fillRect(
        -groundWidth / 2,
        phaserGroundY,
        groundWidth,
        groundHeight
      );
    }
  }

  private updateGroundBody(): void {
    // Remove old ground body if it exists
    if (this._groundBody) {
      this.scene.matter.world.remove(this._groundBody);
      this._groundBody = null;
    }

    if (this._groundEnabled) {
      // Convert user Y to Phaser Y
      const phaserGroundY = this._canvasHeight / 2 - this._groundY;

      // Create a static Matter.js body for the ground
      const groundWidth = 10000;
      const groundHeight = 100;
      this._groundBody = this.scene.matter.add.rectangle(
        this._canvasWidth / 2, // Center X
        phaserGroundY + groundHeight / 2, // Y position
        groundWidth,
        groundHeight,
        { isStatic: true, label: 'ground' }
      );

      debugLog('info', `Ground body created at user y=${this._groundY}, phaser y=${phaserGroundY}`);
    }
  }

  /**
   * Add a sprite to ground collision (called after sprite is registered)
   * Matter.js handles collisions automatically via world events
   */
  addSpriteToGroundCollision(_sprite: RuntimeSprite): void {
    // Matter.js collision detection is set up automatically via world events
    // No explicit collider setup needed
  }

  // --- Scene switching ---
  private _pendingSceneSwitch: string | null = null;

  switchToScene(sceneName: string): void {
    this._pendingSceneSwitch = sceneName;
  }

  get pendingSceneSwitch(): string | null {
    return this._pendingSceneSwitch;
  }

  clearPendingSceneSwitch(): void {
    this._pendingSceneSwitch = null;
  }

  // --- Attachment (Parent-Child relationships) ---
  // Track parent-child relationships
  private attachments: Map<string, string> = new Map(); // childId -> parentId

  /**
   * Attach a sprite to another sprite as a child
   * The child will follow the parent's transformations
   * The child maintains its visual appearance but transforms are converted to local space
   */
  attachTo(childId: string, parentId: string): void {
    const child = this.sprites.get(childId);
    const parent = this.sprites.get(parentId);

    if (!child || !parent) {
      debugLog('error', `attachTo: sprite not found (child=${childId}, parent=${parentId})`);
      return;
    }

    // Get the containers
    const childContainer = child.container;
    const parentContainer = parent.container;

    if (!childContainer || !parentContainer) {
      debugLog('error', 'attachTo: container not found');
      return;
    }

    // If already attached to something, detach first
    if (this.attachments.has(childId)) {
      this.detach(childId);
    }

    // Store child's current world transform
    const childWorldX = childContainer.x;
    const childWorldY = childContainer.y;
    const childWorldAngle = childContainer.angle;
    const childWorldScaleX = childContainer.scaleX;
    const childWorldScaleY = childContainer.scaleY;

    // Get parent's world transform
    const parentWorldX = parentContainer.x;
    const parentWorldY = parentContainer.y;
    const parentAngleRad = parentContainer.angle * (Math.PI / 180);
    const parentScaleX = parentContainer.scaleX;
    const parentScaleY = parentContainer.scaleY;

    // Calculate local position relative to parent
    // Offset from parent in world space
    const offsetX = childWorldX - parentWorldX;
    const offsetY = childWorldY - parentWorldY;

    // Rotate offset back by parent's angle to get local coordinates
    const cosAngle = Math.cos(-parentAngleRad);
    const sinAngle = Math.sin(-parentAngleRad);
    const localX = (offsetX * cosAngle - offsetY * sinAngle) / parentScaleX;
    const localY = (offsetX * sinAngle + offsetY * cosAngle) / parentScaleY;

    // Calculate local rotation (subtract parent's rotation)
    const localAngle = childWorldAngle - parentContainer.angle;

    // Calculate local scale (divide by parent's scale)
    const localScaleX = childWorldScaleX / parentScaleX;
    const localScaleY = childWorldScaleY / parentScaleY;

    // Remove from scene's display list (but don't destroy)
    this.scene.children.remove(childContainer);

    // Add to parent container - this makes transformations inherit
    parentContainer.add(childContainer);

    // Set local transform within parent (visually same as before)
    childContainer.setPosition(localX, localY);
    childContainer.setAngle(localAngle);
    childContainer.setScale(localScaleX, localScaleY);

    // Track the relationship
    this.attachments.set(childId, parentId);

    debugLog('action', `Attached "${child.name}" to "${parent.name}" at local (${localX.toFixed(1)}, ${localY.toFixed(1)}) angle=${localAngle.toFixed(1)} scale=(${localScaleX.toFixed(2)}, ${localScaleY.toFixed(2)})`);
  }

  /**
   * Detach a sprite from its parent, making it independent again
   */
  detach(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (!sprite) {
      debugLog('error', `detach: sprite not found (${spriteId})`);
      return;
    }

    const container = sprite.container;
    if (!container) return;

    const parentId = this.attachments.get(spriteId);
    if (!parentId) {
      debugLog('info', `detach: "${sprite.name}" has no parent`);
      return;
    }

    const parent = this.sprites.get(parentId);
    const parentContainer = parent?.container;

    // Calculate world position before detaching
    const worldMatrix = container.getWorldTransformMatrix();
    const worldX = worldMatrix.tx;
    const worldY = worldMatrix.ty;
    const worldRotation = container.angle + (parentContainer?.angle || 0);
    const worldScaleX = container.scaleX * (parentContainer?.scaleX || 1);
    const worldScaleY = container.scaleY * (parentContainer?.scaleY || 1);

    // Remove from parent container
    if (parentContainer) {
      parentContainer.remove(container);
    }

    // Add back to scene
    this.scene.add.existing(container);

    // Restore world transform
    container.setPosition(worldX, worldY);
    container.setAngle(worldRotation);
    container.setScale(worldScaleX, worldScaleY);

    // Remove tracking
    this.attachments.delete(spriteId);

    debugLog('action', `Detached "${sprite.name}" from parent`);
  }

  // --- Animation ---

  /**
   * Glide sprite to position over duration
   */
  glideTo(spriteId: string, userX: number, userY: number, durationSeconds: number): Promise<void> {
    return new Promise(resolve => {
      const sprite = this.sprites.get(spriteId);
      if (!sprite) {
        debugLog('error', `glideTo: sprite not found (${spriteId})`);
        resolve();
        return;
      }

      const container = sprite.container;
      if (!container) {
        resolve();
        return;
      }

      // Convert user coordinates to Phaser coordinates
      const phaserX = userX + this._canvasWidth / 2;
      const phaserY = this._canvasHeight / 2 - userY;

      this.scene.tweens.add({
        targets: container,
        x: phaserX,
        y: phaserY,
        duration: durationSeconds * 1000,
        ease: 'Linear',
        onComplete: () => resolve(),
      });

      debugLog('action', `Gliding "${sprite.name}" to (${userX}, ${userY}) over ${durationSeconds}s`);
    });
  }

  /**
   * Rotate sprite by degrees over duration
   */
  rotateTo(spriteId: string, degrees: number, durationSeconds: number): Promise<void> {
    return new Promise(resolve => {
      const sprite = this.sprites.get(spriteId);
      if (!sprite) {
        debugLog('error', `rotateTo: sprite not found (${spriteId})`);
        resolve();
        return;
      }

      const container = sprite.container;
      if (!container) {
        resolve();
        return;
      }

      // Convert degrees to radians for Phaser
      const targetAngle = container.angle + degrees;

      this.scene.tweens.add({
        targets: container,
        angle: targetAngle,
        duration: durationSeconds * 1000,
        ease: 'Linear',
        onComplete: () => resolve(),
      });

      debugLog('action', `Rotating "${sprite.name}" by ${degrees}° over ${durationSeconds}s`);
    });
  }
}

// Global runtime instance for the current game session
let currentRuntime: RuntimeEngine | null = null;

export function setCurrentRuntime(runtime: RuntimeEngine | null): void {
  currentRuntime = runtime;
}

export function getCurrentRuntime(): RuntimeEngine | null {
  return currentRuntime;
}

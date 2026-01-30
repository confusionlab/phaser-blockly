import Phaser from 'phaser';
import { RuntimeSprite } from './RuntimeSprite';

type EventHandler = () => void | Promise<void>;
type ForeverHandler = () => void;

// Debug log that can be viewed in the debug panel
export interface DebugLogEntry {
  time: number;
  type: 'info' | 'event' | 'action' | 'error';
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
  onCloneStart: EventHandler[];
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
  private _groundZone: Phaser.GameObjects.Zone | null = null;

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
      onCloneStart: [],
    });
    this.localVariables.set(id, new Map());
    return sprite;
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
          handler();
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
    } else {
      debugLog('error', `No handlers found for sprite ${spriteId}`);
    }
  }

  onCloneStart(spriteId: string, handler: EventHandler): void {
    debugLog('info', `Registering onCloneStart for sprite ${spriteId}`);
    const h = this.handlers.get(spriteId);
    if (h) h.onCloneStart.push(handler);
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
      if (sprite?.isStopped()) continue;
      const keyHandlers = h.onKeyPressed.get(key);
      debugLog('info', `Checking handlers for sprite ${spriteId}: has ${key} handlers = ${!!keyHandlers}, count = ${keyHandlers?.length || 0}`);
      if (keyHandlers) {
        debugLog('event', `Executing ${keyHandlers.length} handler(s) for key ${key}`);
        keyHandlers.forEach(handler => {
          try {
            handler();
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

    // Log registered handlers summary
    for (const [spriteId, h] of this.handlers) {
      debugLog('info', `Sprite ${spriteId}: onStart=${h.onStart.length}, forever=${h.forever.length}, onKeyPressed=${h.onKeyPressed.size}`);
    }

    // Execute all onStart handlers
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (sprite?.isStopped()) continue;
      for (const handler of h.onStart) {
        try {
          debugLog('event', `Executing onStart handler for ${spriteId}`);
          await handler();
        } catch (e) {
          debugLog('error', `Error in onStart for ${spriteId}: ${e}`);
          console.error(`Error in onStart for ${spriteId}:`, e);
        }
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

    // Run forever loops
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (sprite?.isStopped()) continue;
      if (!this.activeForeverLoops.get(spriteId)) continue;

      for (const handler of h.forever) {
        try {
          handler();
        } catch (e) {
          debugLog('error', `Error in forever loop for ${spriteId}: ${e}`);
          console.error(`Error in forever loop for ${spriteId}:`, e);
        }
      }
    }

    // Clear touching pairs from previous frame
    this._touchingPairs.clear();

    // Clear ground touching flags at end of frame
    // They will be set again by collision callbacks next physics step
    for (const sprite of this.sprites.values()) {
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

    // Set up collision and overlap detection between all sprite pairs
    for (let i = 0; i < sprites.length; i++) {
      for (let j = i + 1; j < sprites.length; j++) {
        const spriteA = sprites[i];
        const spriteB = sprites[j];

        // Physical collision (makes sprites bounce off each other)
        this.scene.physics.add.collider(
          spriteA.container,
          spriteB.container
        );

        // Overlap detection for "when touching" events
        this.scene.physics.add.overlap(
          spriteA.container,
          spriteB.container,
          () => this.handleSpriteOverlap(spriteA.id, spriteB.id)
        );
      }
    }

    // Set up ground collisions if ground is enabled
    if (this._groundEnabled && this._groundZone) {
      for (const sprite of sprites) {
        this.scene.physics.add.collider(
          sprite.container,
          this._groundZone,
          () => this.handleGroundCollision(sprite.id)
        );
      }
    }

    debugLog('info', `Physics colliders set up for ${sprites.length} sprites`);
  }

  private handleGroundCollision(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      sprite.setTouchingGround(true);
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
    if (handlersA) {
      // Direct handler for B
      const touchHandlersA = handlersA.onTouching.get(spriteIdB);
      if (touchHandlersA) {
        touchHandlersA.forEach(handler => handler());
      }
      // Component-any handler for B's component
      if (spriteB?.componentId) {
        const componentAnyHandlers = handlersA.onTouching.get(`COMPONENT_ANY:${spriteB.componentId}`);
        if (componentAnyHandlers) {
          componentAnyHandlers.forEach(handler => handler());
        }
      }
    }

    // Check if B has handlers for touching A (direct or component-any)
    const handlersB = this.handlers.get(spriteIdB);
    if (handlersB) {
      // Direct handler for A
      const touchHandlersB = handlersB.onTouching.get(spriteIdA);
      if (touchHandlersB) {
        touchHandlersB.forEach(handler => handler());
      }
      // Component-any handler for A's component
      if (spriteA?.componentId) {
        const componentAnyHandlers = handlersB.onTouching.get(`COMPONENT_ANY:${spriteA.componentId}`);
        if (componentAnyHandlers) {
          componentAnyHandlers.forEach(handler => handler());
        }
      }
    }
  }

  private processMessages(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      for (const [spriteId, h] of this.handlers) {
        const sprite = this.sprites.get(spriteId);
        if (sprite?.isStopped()) continue;
        const msgHandlers = h.onMessage.get(message);
        if (msgHandlers) {
          msgHandlers.forEach(handler => handler());
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

  // --- Clone System ---

  cloneSprite(spriteId: string): RuntimeSprite | null {
    const original = this.sprites.get(spriteId);
    if (!original) return null;

    this.cloneCounter++;
    const cloneId = `${spriteId}_clone_${this.cloneCounter}`;

    // Create a visual clone
    const graphics = this.scene.add.graphics();
    const color = this.getObjectColor(cloneId);
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(-32, -32, 64, 64, 8);

    const container = this.scene.add.container(
      original.container.x,
      original.container.y,
      [graphics]
    );
    container.setName(cloneId);
    container.setSize(64, 64);
    container.setScale(original.container.scaleX, original.container.scaleY);
    container.setRotation(original.container.rotation);

    // Register the clone
    const clone = this.registerSprite(cloneId, `${original.name} (clone)`, container);
    clone.isClone = true;
    clone.cloneParentId = spriteId;

    // Copy the original's handlers for clone start
    const originalHandlers = this.handlers.get(spriteId);
    if (originalHandlers) {
      // Execute onCloneStart handlers
      for (const handler of originalHandlers.onCloneStart) {
        handler();
      }
    }

    return clone;
  }

  deleteClone(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite?.isClone) {
      sprite.destroy();
      this.sprites.delete(spriteId);
      this.handlers.delete(spriteId);
      this.localVariables.delete(spriteId);
    }
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

    // Handle EDGE special case - check if touching world bounds
    if (targetId === 'EDGE') {
      const body = sprite.container.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        // Check if physics body is touching world bounds
        return body.blocked.up || body.blocked.down || body.blocked.left || body.blocked.right;
      }
      // Fallback: check if sprite bounds are outside canvas
      const bounds = sprite.container.getBounds();
      return bounds.left <= 0 || bounds.right >= this._canvasWidth ||
             bounds.top <= 0 || bounds.bottom >= this._canvasHeight;
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

  private isTouchingSingle(sprite: RuntimeSprite, target: RuntimeSprite): boolean {
    // Use physics body overlap if both have physics bodies
    const bodyA = sprite.container.body as Phaser.Physics.Arcade.Body | null;
    const bodyB = target.container.body as Phaser.Physics.Arcade.Body | null;

    if (bodyA && bodyB) {
      // Use physics-based overlap detection
      return this.scene.physics.overlap(sprite.container, target.container);
    }

    // Fallback to bounds intersection
    const boundsA = sprite.container.getBounds();
    const boundsB = target.container.getBounds();
    return Phaser.Geom.Intersects.RectangleToRectangle(boundsA, boundsB);
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
  private sounds: Map<string, Phaser.Sound.BaseSound> = new Map();

  playSound(soundKey: string): void {
    // For now, we'll create simple synthesized sounds
    // In a full implementation, this would load actual audio files
    const sound = this.scene.sound.add(soundKey, { volume: this.volume / 100 });
    sound.play();
    this.sounds.set(soundKey, sound);
  }

  playSoundUntilDone(soundKey: string): Promise<void> {
    return new Promise(resolve => {
      const sound = this.scene.sound.add(soundKey, { volume: this.volume / 100 });
      sound.on('complete', () => {
        resolve();
      });
      sound.play();
      this.sounds.set(soundKey, sound);
    });
  }

  stopAllSounds(): void {
    this.scene.sound.stopAll();
    this.sounds.clear();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    // Update all playing sounds
    this.sounds.forEach(sound => {
      if ('setVolume' in sound) {
        (sound as Phaser.Sound.WebAudioSound).setVolume(this.volume / 100);
      }
    });
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

    // If enabling, add colliders for all existing sprites
    if (enabled && this._groundZone) {
      for (const sprite of this.sprites.values()) {
        this.scene.physics.add.collider(
          sprite.container,
          this._groundZone,
          () => this.handleGroundCollision(sprite.id)
        );
      }
    }
  }

  setGroundY(y: number): void {
    this._groundY = y;
    this.updateGroundVisual();
    this.updateGroundBody();

    // Re-add colliders if ground is enabled
    if (this._groundEnabled && this._groundZone) {
      for (const sprite of this.sprites.values()) {
        this.scene.physics.add.collider(
          sprite.container,
          this._groundZone,
          () => this.handleGroundCollision(sprite.id)
        );
      }
    }
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
    // Remove old ground zone if it exists
    if (this._groundZone) {
      this._groundZone.destroy();
      this._groundZone = null;
    }

    if (this._groundEnabled) {
      // Convert user Y to Phaser Y
      const phaserGroundY = this._canvasHeight / 2 - this._groundY;

      // Create a zone for ground collision
      const groundWidth = 10000;
      const groundHeight = 100;
      this._groundZone = this.scene.add.zone(0, phaserGroundY + groundHeight / 2, groundWidth, groundHeight);
      this.scene.physics.add.existing(this._groundZone, true); // true = static body

      debugLog('info', `Ground body created at user y=${this._groundY}, phaser y=${phaserGroundY}`);
    }
  }

  /**
   * Add a sprite to ground collision (called after sprite is registered)
   */
  addSpriteToGroundCollision(sprite: RuntimeSprite): void {
    if (this._groundEnabled && this._groundZone) {
      this.scene.physics.add.collider(
        sprite.container,
        this._groundZone,
        () => this.handleGroundCollision(sprite.id)
      );
    }
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
}

// Global runtime instance for the current game session
let currentRuntime: RuntimeEngine | null = null;

export function setCurrentRuntime(runtime: RuntimeEngine | null): void {
  currentRuntime = runtime;
}

export function getCurrentRuntime(): RuntimeEngine | null {
  return currentRuntime;
}

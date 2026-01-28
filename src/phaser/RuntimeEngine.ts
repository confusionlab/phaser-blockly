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

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    clearDebugLog();
    debugLog('info', 'RuntimeEngine created');
    this.setupInputListeners();
  }

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
    container: Phaser.GameObjects.Container
  ): RuntimeSprite {
    const sprite = new RuntimeSprite(this.scene, container, id, name);
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

    // Set up click listener on the sprite's container
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      sprite.container.setInteractive();
      sprite.container.on('pointerdown', () => {
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

    // Check collisions for onTouching handlers
    this.checkCollisions();

    // Process message queue
    this.processMessages();
  }

  private checkCollisions(): void {
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (!sprite || sprite.isStopped()) continue;

      for (const [targetId, touchHandlers] of h.onTouching) {
        const target = this.sprites.get(targetId);
        if (!target || target.isStopped()) continue;

        // Simple bounds-based collision check
        const boundsA = sprite.container.getBounds();
        const boundsB = target.container.getBounds();

        if (Phaser.Geom.Intersects.RectangleToRectangle(boundsA, boundsB)) {
          touchHandlers.forEach(handler => handler());
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
    return this.scene.input.activePointer.worldX;
  }

  getMouseY(): number {
    return this.scene.input.activePointer.worldY;
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
    const target = this.sprites.get(targetId);
    if (!sprite || !target) return false;

    const boundsA = sprite.container.getBounds();
    const boundsB = target.container.getBounds();
    return Phaser.Geom.Intersects.RectangleToRectangle(boundsA, boundsB);
  }

  distanceTo(spriteId: string, targetId: string): number {
    const sprite = this.sprites.get(spriteId);
    const target = this.sprites.get(targetId);
    if (!sprite || !target) return 0;

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

  cameraGoTo(x: number, y: number): void {
    this.scene.cameras.main.centerOn(x, y);
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

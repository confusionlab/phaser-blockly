import Phaser from 'phaser';
import { RuntimeSprite } from './RuntimeSprite';

type EventHandler = () => void | Promise<void>;
type ForeverHandler = () => void;

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
  private keyStates: Map<string, boolean> = new Map();
  private cloneCounter: number = 0;
  private messageQueue: string[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupInputListeners();
  }

  private setupInputListeners(): void {
    // Track key states
    this.scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const key = this.normalizeKey(event.code);
      this.keyStates.set(key, true);
      this.triggerKeyPressed(key);
    });

    this.scene.input.keyboard?.on('keyup', (event: KeyboardEvent) => {
      const key = this.normalizeKey(event.code);
      this.keyStates.set(key, false);
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
    const h = this.handlers.get(spriteId);
    if (h) h.onStart.push(handler);
  }

  onKeyPressed(spriteId: string, key: string, handler: EventHandler): void {
    const h = this.handlers.get(spriteId);
    if (h) {
      if (!h.onKeyPressed.has(key)) h.onKeyPressed.set(key, []);
      h.onKeyPressed.get(key)!.push(handler);
    }
  }

  onClicked(spriteId: string, handler: EventHandler): void {
    const h = this.handlers.get(spriteId);
    if (h) h.onClick.push(handler);

    // Set up click listener on the sprite's container
    const sprite = this.sprites.get(spriteId);
    if (sprite) {
      sprite.container.setInteractive();
      sprite.container.on('pointerdown', () => {
        if (this._isRunning) {
          handler();
        }
      });
    }
  }

  onTouching(spriteId: string, targetId: string, handler: EventHandler): void {
    const h = this.handlers.get(spriteId);
    if (h) {
      if (!h.onTouching.has(targetId)) h.onTouching.set(targetId, []);
      h.onTouching.get(targetId)!.push(handler);
    }
  }

  onMessage(spriteId: string, message: string, handler: EventHandler): void {
    const h = this.handlers.get(spriteId);
    if (h) {
      if (!h.onMessage.has(message)) h.onMessage.set(message, []);
      h.onMessage.get(message)!.push(handler);
    }
  }

  forever(spriteId: string, handler: ForeverHandler): void {
    const h = this.handlers.get(spriteId);
    if (h) h.forever.push(handler);
  }

  onCloneStart(spriteId: string, handler: EventHandler): void {
    const h = this.handlers.get(spriteId);
    if (h) h.onCloneStart.push(handler);
  }

  // --- Event Triggering ---

  private triggerKeyPressed(key: string): void {
    if (!this._isRunning) return;
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (sprite?.isStopped()) continue;
      const keyHandlers = h.onKeyPressed.get(key);
      if (keyHandlers) {
        keyHandlers.forEach(handler => handler());
      }
    }
  }

  async start(): Promise<void> {
    this._isRunning = true;

    // Execute all onStart handlers
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (sprite?.isStopped()) continue;
      for (const handler of h.onStart) {
        try {
          await handler();
        } catch (e) {
          console.error(`Error in onStart for ${spriteId}:`, e);
        }
      }
    }

    // Start forever loops
    for (const [spriteId, h] of this.handlers) {
      if (h.forever.length > 0) {
        this.activeForeverLoops.set(spriteId, true);
      }
    }
  }

  update(): void {
    if (!this._isRunning) return;

    // Run forever loops
    for (const [spriteId, h] of this.handlers) {
      const sprite = this.sprites.get(spriteId);
      if (sprite?.isStopped()) continue;
      if (!this.activeForeverLoops.get(spriteId)) continue;

      for (const handler of h.forever) {
        try {
          handler();
        } catch (e) {
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

  stopSprite(spriteId: string): void {
    const sprite = this.sprites.get(spriteId);
    if (sprite) sprite.stop();
    this.activeForeverLoops.set(spriteId, false);
  }

  // --- Input Queries ---

  isKeyPressed(key: string): boolean {
    return this.keyStates.get(key) || false;
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

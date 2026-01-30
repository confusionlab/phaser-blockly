import Phaser from 'phaser';
import { runtimeDebugLog } from './RuntimeEngine';
import type { Costume } from '../types';
import type { RuntimeEngine } from './RuntimeEngine';

function debugLog(type: 'info' | 'event' | 'action' | 'error', message: string) {
  const entry = { time: Date.now(), type, message };
  runtimeDebugLog.push(entry);
  console.log(`[Sprite ${type}] ${message}`);
}

/**
 * RuntimeSprite wraps a Phaser container/sprite and provides
 * child-friendly methods for block-based programming.
 */
export class RuntimeSprite {
  public container: Phaser.GameObjects.Container;
  public scene: Phaser.Scene;
  public id: string;
  public name: string;
  public componentId: string | null = null; // For component instances
  private runtime: RuntimeEngine | null = null;

  private _direction: number = 90; // 0 = up, 90 = right, 180 = down, 270 = left
  private _size: number = 100; // percentage
  private _stopped: boolean = false;
  private _isClone: boolean = false;
  private _cloneParentId: string | null = null;

  // Costume support
  private _costumes: Costume[] = [];
  private _currentCostumeIndex: number = 0;
  private _costumeImage: Phaser.GameObjects.Image | null = null;

  // Click handler for pixel-perfect detection
  private _clickHandler: (() => void) | null = null;

  // Ground collision tracking (set by RuntimeEngine)
  private _isTouchingGround: boolean = false;

  constructor(
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    id: string,
    name: string
  ) {
    this.scene = scene;
    this.container = container;
    this.id = id;
    this.name = name;
  }

  setRuntime(runtime: RuntimeEngine): void {
    this.runtime = runtime;
  }

  // --- Motion ---
  // User coordinates: (0,0) at center, +Y is up
  // Phaser coordinates: (0,0) at top-left, +Y is down

  moveSteps(steps: number): void {
    if (this._stopped) return;
    // Direction: 0 = up, 90 = right, 180 = down, 270 = left
    // In user space, 0 = up means -Y in Phaser, 90 = right means +X in Phaser
    const radians = Phaser.Math.DegToRad(this._direction - 90);
    this.container.x += Math.cos(radians) * steps;
    // Y is inverted: moving "up" in user space = negative Y in Phaser
    this.container.y -= Math.sin(radians) * steps;
  }

  goTo(userX: number, userY: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      const phaser = this.runtime.userToPhaser(userX, userY);
      this.container.setPosition(phaser.x, phaser.y);
    } else {
      this.container.setPosition(userX, userY);
    }
  }

  setX(userX: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      this.container.x = userX + this.runtime.canvasWidth / 2;
    } else {
      this.container.x = userX;
    }
  }

  setY(userY: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      this.container.y = this.runtime.canvasHeight / 2 - userY;
    } else {
      this.container.y = userY;
    }
  }

  changeX(dx: number): void {
    if (this._stopped) return;
    const oldX = this.container.x;
    this.container.x += dx;
    debugLog('action', `${this.name}.changeX(${dx}): ${oldX} -> ${this.container.x}`);
  }

  changeY(dy: number): void {
    if (this._stopped) return;
    const oldY = this.container.y;
    // In user space, +Y is up, so changeY(10) means move up = decrease Phaser Y
    this.container.y -= dy;
    debugLog('action', `${this.name}.changeY(${dy}): ${oldY} -> ${this.container.y}`);
  }

  getX(): number {
    if (this.runtime) {
      return this.container.x - this.runtime.canvasWidth / 2;
    }
    return this.container.x;
  }

  getY(): number {
    if (this.runtime) {
      return this.runtime.canvasHeight / 2 - this.container.y;
    }
    return this.container.y;
  }

  pointInDirection(direction: number): void {
    if (this._stopped) return;
    this._direction = direction;
    // Phaser rotation: 0 = right, so we adjust
    this.container.setRotation(Phaser.Math.DegToRad(direction - 90));
  }

  getDirection(): number {
    return this._direction;
  }

  pointTowards(targetX: number, targetY: number): void {
    if (this._stopped) return;
    const dx = targetX - this.container.x;
    const dy = targetY - this.container.y;
    const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90;
    this.pointInDirection(angle);
  }

  // --- Looks ---

  show(): void {
    if (this._stopped) return;
    this.container.setVisible(true);
  }

  hide(): void {
    if (this._stopped) return;
    this.container.setVisible(false);
  }

  setSize(percent: number): void {
    if (this._stopped) return;
    this._size = percent;
    const scale = percent / 100;
    this.container.setScale(scale, scale);
  }

  changeSize(delta: number): void {
    if (this._stopped) return;
    this._size += delta;
    const scale = this._size / 100;
    this.container.setScale(scale, scale);
  }

  getSize(): number {
    return this._size;
  }

  setOpacity(alpha: number): void {
    if (this._stopped) return;
    this.container.setAlpha(alpha / 100);
  }

  goToFront(): void {
    if (this._stopped) return;
    this.scene.children.bringToTop(this.container);
  }

  goToBack(): void {
    if (this._stopped) return;
    this.scene.children.sendToBack(this.container);
  }

  // --- Costumes ---

  setCostumes(costumes: Costume[], currentIndex: number = 0): void {
    this._costumes = costumes;
    this._currentCostumeIndex = currentIndex;
    this._updateCostumeDisplay();
  }

  private _updateCostumeDisplay(): void {
    if (this._costumes.length === 0) return;

    const costume = this._costumes[this._currentCostumeIndex];
    if (!costume) return;

    // Remove old costume image if it exists
    if (this._costumeImage) {
      this._costumeImage.destroy();
      this._costumeImage = null;
    }

    // Remove any existing sprite image created by PhaserCanvas
    const existingSprite = this.container.getByName('sprite');
    if (existingSprite) {
      existingSprite.destroy();
    }

    // Remove the default graphics (colored rectangle)
    const graphics = this.container.getAt(0);
    if (graphics instanceof Phaser.GameObjects.Graphics) {
      graphics.setVisible(false);
    }

    // Load and display the costume image
    const textureKey = `costume_${this.id}_${costume.id}`;

    // Check if texture already exists
    if (!this.scene.textures.exists(textureKey)) {
      // Load the texture from data URL
      const img = new Image();
      img.onload = () => {
        if (this.scene && this.scene.textures) {
          this.scene.textures.addImage(textureKey, img);
          this._createCostumeImage(textureKey);
        }
      };
      img.src = costume.assetId;
    } else {
      this._createCostumeImage(textureKey);
    }
  }

  private _createCostumeImage(textureKey: string): void {
    if (this._costumeImage) {
      this._costumeImage.destroy();
    }

    this._costumeImage = this.scene.add.image(0, 0, textureKey);
    this._costumeImage.setOrigin(0.5, 0.5);

    // Keep sprite at (0, 0) - centered on the 1024x1024 canvas
    // This ensures the collider aligns with the visual regardless of costume bounds
    // The bounds are only used for editor selection/hit area, not positioning

    this.container.addAt(this._costumeImage, 0);

    // Re-setup click handler with pixel-perfect detection if one was registered
    if (this._clickHandler) {
      this._setupPixelPerfectClick();
    }

    // Update physics body size to match the new costume
    this.updatePhysicsBodySize();
  }

  /**
   * Set up click handler - uses pixel-perfect detection for images, bounding box for placeholders
   */
  setupClickHandler(handler: () => void): void {
    this._clickHandler = handler;
    this._setupPixelPerfectClick();
  }

  private _setupPixelPerfectClick(): void {
    if (!this._clickHandler) return;

    // Remove any existing click listeners
    this.container.removeAllListeners('pointerdown');
    if (this._costumeImage) {
      this._costumeImage.removeAllListeners('pointerdown');
    }

    if (this._costumeImage) {
      // Use pixel-perfect hit detection on the costume image
      // alphaTolerance: 1 means only pixels with alpha > 1 (out of 255) register as hits
      this._costumeImage.setInteractive({
        pixelPerfect: true,
        alphaTolerance: 1
      });
      this._costumeImage.on('pointerdown', this._clickHandler);
      debugLog('info', `${this.name}: Pixel-perfect click detection enabled`);
    } else {
      // Fall back to container bounding box for placeholder graphics
      this.container.setInteractive();
      this.container.on('pointerdown', this._clickHandler);
      debugLog('info', `${this.name}: Bounding box click detection (no costume)`);
    }
  }

  nextCostume(): void {
    if (this._stopped) return;
    if (this._costumes.length === 0) return;

    this._currentCostumeIndex = (this._currentCostumeIndex + 1) % this._costumes.length;
    this._updateCostumeDisplay();
    debugLog('action', `${this.name}.nextCostume() -> ${this._currentCostumeIndex + 1}`);
  }

  switchCostume(costumeRef: number | string): void {
    if (this._stopped) return;
    if (this._costumes.length === 0) return;

    let index: number;

    if (typeof costumeRef === 'number') {
      // 1-based index
      index = Math.max(0, Math.min(this._costumes.length - 1, costumeRef - 1));
    } else {
      // By name
      index = this._costumes.findIndex(c => c.name === costumeRef);
      if (index === -1) index = this._currentCostumeIndex;
    }

    this._currentCostumeIndex = index;
    this._updateCostumeDisplay();
    debugLog('action', `${this.name}.switchCostume(${costumeRef}) -> ${this._currentCostumeIndex + 1}`);
  }

  getCostumeNumber(): number {
    return this._currentCostumeIndex + 1; // 1-based
  }

  getCostumeName(): string {
    if (this._costumes.length === 0) return '';
    return this._costumes[this._currentCostumeIndex]?.name || '';
  }

  // --- Physics (Matter.js) ---

  private getMatterBody(): MatterJS.BodyType | null {
    const matterContainer = this.container as unknown as { body?: MatterJS.BodyType };
    return matterContainer.body || null;
  }

  enablePhysics(): void {
    if (this._stopped) return;
    if (!this.getMatterBody()) {
      // Get size from costume bounds or default
      let width = 64, height = 64;
      const costume = this._costumes[this._currentCostumeIndex];
      if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
        width = costume.bounds.width;
        height = costume.bounds.height;
      }

      debugLog('action', `${this.name}.enablePhysics() creating body ${width}x${height} at (${this.container.x}, ${this.container.y})`);

      // Create body the same way PhaserCanvas does - create separately then attach
      // This is necessary because scene.matter.add.gameObject() doesn't work well with Containers
      const body = this.scene.matter.add.rectangle(
        this.container.x,
        this.container.y,
        width,
        height,
        {
          restitution: 0,
          frictionAir: 0.01,
          friction: 0.1,
        }
      );

      // Attach body to container manually
      (this.container as unknown as { body: MatterJS.BodyType }).body = body;

      // Set up position syncing from body to container
      this.scene.matter.world.on('afterupdate', () => {
        if (body && this.container.active) {
          this.container.setPosition(body.position.x, body.position.y);
        }
      });

      debugLog('info', `${this.name}.enablePhysics() body created: ${!!this.getMatterBody()}`);
    } else {
      debugLog('info', `${this.name}.enablePhysics() body already exists`);
    }
  }

  setVelocity(vx: number, vy: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      // Invert Y for user space (positive = up)
      this.scene.matter.body.setVelocity(body, { x: vx, y: -vy });
      debugLog('action', `${this.name}.setVelocity(${vx}, ${vy}) -> body velocity: (${vx}, ${-vy})`);
    } else {
      debugLog('error', `${this.name}.setVelocity: No physics body found. Call enablePhysics() first or enable physics in object properties.`);
    }
  }

  setVelocityX(vx: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      this.scene.matter.body.setVelocity(body, { x: vx, y: body.velocity.y });
      debugLog('action', `${this.name}.setVelocityX(${vx})`);
    } else {
      debugLog('error', `${this.name}.setVelocityX: No physics body found.`);
    }
  }

  setVelocityY(vy: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      // Invert Y for user space (positive = up)
      this.scene.matter.body.setVelocity(body, { x: body.velocity.x, y: -vy });
      debugLog('action', `${this.name}.setVelocityY(${vy})`);
    } else {
      debugLog('error', `${this.name}.setVelocityY: No physics body found.`);
    }
  }

  setGravity(gravity: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      // Use Matter.js gravityScale - 1 is normal gravity, 0 is none, etc.
      body.gravityScale = { x: 0, y: gravity };
      debugLog('action', `${this.name}.setGravity(${gravity})`);
    } else {
      debugLog('error', `${this.name}.setGravity: No physics body found.`);
    }
  }

  setBounce(bounce: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      body.restitution = bounce;
      debugLog('action', `${this.name}.setBounce(${bounce})`);
    } else {
      debugLog('error', `${this.name}.setBounce: No physics body found.`);
    }
  }

  setCollideWorldBounds(_collide: boolean): void {
    // Matter.js doesn't have built-in world bounds collision
    // This is intentionally not implemented per user request
  }

  makeImmovable(): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      this.scene.matter.body.setStatic(body, true);
      debugLog('action', `${this.name}.makeImmovable()`);
    } else {
      debugLog('error', `${this.name}.makeImmovable: No physics body found.`);
    }
  }

  /**
   * Apply torque (rotational force) to the sprite
   */
  applyTorque(torque: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      // Matter.js torque
      body.torque = torque;
    }
  }

  /**
   * Set angular velocity (rotation speed)
   */
  setAngularVelocity(velocity: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      this.scene.matter.body.setAngularVelocity(body, velocity);
      debugLog('action', `${this.name}.setAngularVelocity(${velocity})`);
    } else {
      debugLog('error', `${this.name}.setAngularVelocity: No physics body found.`);
    }
  }

  // --- Physics Body Size ---

  /**
   * Check if the sprite is touching the ground
   * This flag is set explicitly by RuntimeEngine during ground collision
   */
  isTouchingGround(): boolean {
    return this._isTouchingGround;
  }

  /**
   * Set the ground touching state (called by RuntimeEngine)
   */
  setTouchingGround(touching: boolean): void {
    this._isTouchingGround = touching;
  }

  /**
   * Update physics body size to match the current costume bounds (visible content)
   * Note: For Matter.js, we would need to recreate the body to change its shape
   * This is a complex operation, so for now we log and skip if body exists
   */
  updatePhysicsBodySize(): void {
    const body = this.getMatterBody();

    let width = 64;
    let height = 64;

    // Prefer using costume bounds if available
    const costume = this._costumes[this._currentCostumeIndex];
    if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
      width = costume.bounds.width;
      height = costume.bounds.height;
    } else if (this._costumeImage) {
      // Fallback to image dimensions if no bounds
      width = this._costumeImage.displayWidth || this._costumeImage.width;
      height = this._costumeImage.displayHeight || this._costumeImage.height;
    }

    // Ensure minimum size
    width = Math.max(width, 32);
    height = Math.max(height, 32);

    // Matter.js doesn't easily support resizing bodies - we'd need to recreate them
    // For now, log the intended size
    if (body) {
      debugLog('info', `${this.name}: Physics body exists, size change to ${width}x${height} not applied (Matter.js limitation)`);
    } else {
      debugLog('info', `${this.name}: No physics body yet, will be sized to ${width}x${height} when created`);
    }
  }

  // --- Control ---

  stop(): void {
    this._stopped = true;
  }

  isStopped(): boolean {
    return this._stopped;
  }

  // --- Clone support ---

  get isClone(): boolean {
    return this._isClone;
  }

  set isClone(value: boolean) {
    this._isClone = value;
  }

  get cloneParentId(): string | null {
    return this._cloneParentId;
  }

  set cloneParentId(id: string | null) {
    this._cloneParentId = id;
  }

  destroy(): void {
    this._stopped = true;
    this.container.destroy();
  }
}

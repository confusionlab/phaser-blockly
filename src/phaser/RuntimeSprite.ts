import Phaser from 'phaser';
import { appendRuntimeLog } from './RuntimeEngine';
import { setBodyGravityY } from './gravity';
import type { Costume, ColliderConfig, PhysicsConfig } from '../types';
import type { RuntimeEngine } from './RuntimeEngine';

function debugLog(type: 'info' | 'event' | 'action' | 'error', message: string) {
  appendRuntimeLog(type, message, {
    emitToConsole: true,
    consolePrefix: 'Sprite',
  });
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

  // Physics and collider config (set from object properties)
  private _colliderConfig: ColliderConfig | null = null;
  private _physicsConfig: PhysicsConfig | null = null;

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

  setColliderConfig(config: ColliderConfig | null): void {
    this._colliderConfig = config;
  }

  setPhysicsConfig(config: PhysicsConfig | null): void {
    this._physicsConfig = config;
  }

  getColliderConfig(): ColliderConfig | null {
    return this._colliderConfig;
  }

  getPhysicsConfig(): PhysicsConfig | null {
    return this._physicsConfig;
  }

  // --- Motion ---
  // User coordinates: (0,0) at center, +Y is up
  // Phaser coordinates: (0,0) at top-left, +Y is down

  /**
   * Sync physics body position to match container position.
   * This allows motion blocks and physics to coexist.
   */
  private syncBodyToContainer(): void {
    const body = this.getMatterBody();
    if (body && this.scene?.matter?.body) {
      // Get collider offset if stored on container
      const offsetX = this.container.getData('colliderOffsetX') ?? 0;
      const offsetY = this.container.getData('colliderOffsetY') ?? 0;
      this.scene.matter.body.setPosition(body, {
        x: this.container.x + offsetX,
        y: this.container.y + offsetY
      });

      // Mark that body was positioned by code this frame (prevents afterupdate from overwriting)
      this.container.setData('_bodyMovedByCode', true);
    }
  }

  moveSteps(steps: number): void {
    if (this._stopped) return;
    // Direction: 0 = up, 90 = right, 180 = down, 270 = left
    // In user space, 0 = up means -Y in Phaser, 90 = right means +X in Phaser
    const radians = Phaser.Math.DegToRad(this._direction - 90);
    this.container.x += Math.cos(radians) * steps;
    // Y is inverted: moving "up" in user space = negative Y in Phaser
    this.container.y -= Math.sin(radians) * steps;
    this.syncBodyToContainer();
  }

  goTo(userX: number, userY: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      const phaser = this.runtime.userToPhaser(userX, userY);
      this.container.setPosition(phaser.x, phaser.y);
    } else {
      this.container.setPosition(userX, userY);
    }
    this.syncBodyToContainer();
  }

  setX(userX: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      this.container.x = userX + this.runtime.canvasWidth / 2;
    } else {
      this.container.x = userX;
    }
    this.syncBodyToContainer();
  }

  setY(userY: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      this.container.y = this.runtime.canvasHeight / 2 - userY;
    } else {
      this.container.y = userY;
    }
    this.syncBodyToContainer();
  }

  changeX(dx: number): void {
    if (this._stopped) return;
    this.container.x += dx;
    this.syncBodyToContainer();
  }

  changeY(dy: number): void {
    if (this._stopped) return;
    // In user space, +Y is up, so changeY(10) means move up = decrease Phaser Y
    this.container.y -= dy;
    this.syncBodyToContainer();
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

  // Set internal size value without changing container scale (used for template cloning)
  setSizeInternal(percent: number): void {
    this._size = percent;
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

  getCostumes(): Costume[] {
    return this._costumes;
  }

  getCurrentCostumeIndex(): number {
    return this._currentCostumeIndex;
  }

  // For cloning - copy internal state
  copyStateFrom(other: RuntimeSprite): void {
    // Copy costumes
    if (other._costumes.length > 0) {
      this.setCostumes([...other._costumes], other._currentCostumeIndex);
    }

    // Copy direction and size
    this._direction = other._direction;
    this._size = other._size;

    // Copy visibility
    this.container.setVisible(other.container.visible);
    this.container.setAlpha(other.container.alpha);

    // Copy collider and physics config
    this._colliderConfig = other._colliderConfig;
    this._physicsConfig = other._physicsConfig;

    // Copy component ID
    this.componentId = other.componentId;
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
          // Check again inside callback to handle race conditions
          if (!this.scene.textures.exists(textureKey)) {
            this.scene.textures.addImage(textureKey, img);
          }
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

    // Update container size to match costume (used for fallback collision detection)
    const costume = this._costumes[this._currentCostumeIndex];
    if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
      this.container.setSize(costume.bounds.width, costume.bounds.height);
    } else {
      // Fallback to image dimensions
      const w = this._costumeImage.displayWidth || this._costumeImage.width || 64;
      const h = this._costumeImage.displayHeight || this._costumeImage.height || 64;
      this.container.setSize(w, h);
    }

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
    const body = matterContainer.body || null;
    // Uncomment for deep debugging if body mismatch suspected
    // if (this._isClone && body) {
    //   console.log(`[${this.name}] getMatterBody: container=${this.container.name}, body.id=${body.id}, body.label=${body.label}`);
    // }
    return body;
  }

  isPhysicsEnabled(): boolean {
    return this.getMatterBody() !== null;
  }

  disablePhysics(): void {
    if (this._stopped) return;

    const body = this.getMatterBody();
    if (body && this.scene?.matter?.world) {
      // Remove body from physics world
      this.scene.matter.world.remove(body);
      // Clear the body reference
      (this.container as unknown as { body?: MatterJS.BodyType }).body = undefined;
      debugLog('action', `${this.name}.disablePhysics() body removed`);
    } else {
      debugLog('info', `${this.name}.disablePhysics() no body to remove`);
    }
  }

  enablePhysics(): void {
    if (this._stopped) return;

    // Check if Matter physics is available
    if (!this.scene?.matter?.add) {
      debugLog('error', `${this.name}.enablePhysics() failed: Matter physics not available on scene`);
      return;
    }

    if (!this.getMatterBody()) {
      // Get collider config if available
      const collider = this._colliderConfig;
      const physics = this._physicsConfig;

      // Get default size from costume bounds
      let defaultWidth = 64, defaultHeight = 64;
      const costume = this._costumes[this._currentCostumeIndex];
      if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
        defaultWidth = costume.bounds.width;
        defaultHeight = costume.bounds.height;
      }

      // Apply container scale to dimensions
      const scaleX = this.container.scaleX;
      const scaleY = this.container.scaleY;

      // Body options
      const bodyOptions: Phaser.Types.Physics.Matter.MatterBodyConfig = {
        restitution: physics?.bounce ?? 0,
        frictionAir: 0.01,
        friction: physics?.friction ?? 0.1,
      };

      // Calculate collider offset
      const colliderOffsetX = (collider?.offsetX ?? 0) * scaleX;
      const colliderOffsetY = (collider?.offsetY ?? 0) * scaleY;
      const bodyX = this.container.x + colliderOffsetX;
      const bodyY = this.container.y + colliderOffsetY;

      // Determine collider type - default to circle if no collider specified
      const colliderType = collider?.type ?? 'circle';

      let body: MatterJS.BodyType;

      try {
        switch (colliderType) {
          case 'circle': {
            const radius = (collider?.radius ?? Math.max(defaultWidth, defaultHeight) / 2) * Math.max(Math.abs(scaleX), Math.abs(scaleY));
            debugLog('action', `${this.name}.enablePhysics() creating circle body radius=${radius}`);
            body = this.scene.matter.add.circle(bodyX, bodyY, radius, bodyOptions);
            break;
          }
          case 'capsule': {
            const capsuleWidth = (collider?.width ?? defaultWidth) * Math.abs(scaleX);
            const capsuleHeight = (collider?.height ?? defaultHeight) * Math.abs(scaleY);
            debugLog('action', `${this.name}.enablePhysics() creating capsule body ${capsuleWidth}x${capsuleHeight}`);
            body = this.scene.matter.add.rectangle(bodyX, bodyY, capsuleWidth, capsuleHeight, {
              ...bodyOptions,
              chamfer: { radius: Math.min(capsuleWidth, capsuleHeight) / 2 }
            });
            break;
          }
          case 'box':
          default: {
            const boxWidth = (collider?.width ?? defaultWidth) * Math.abs(scaleX);
            const boxHeight = (collider?.height ?? defaultHeight) * Math.abs(scaleY);
            debugLog('action', `${this.name}.enablePhysics() creating box body ${boxWidth}x${boxHeight}`);
            body = this.scene.matter.add.rectangle(bodyX, bodyY, boxWidth, boxHeight, bodyOptions);
            break;
          }
        }

        // Add a destroy method to the body so Phaser can clean it up properly
        (body as MatterJS.BodyType & { destroy?: () => void }).destroy = () => {
          if (this.scene?.matter?.world) {
            this.scene.matter.world.remove(body);
          }
        };

        // Attach body to container manually
        (this.container as unknown as { body: MatterJS.BodyType }).body = body;

        // Store collider offset for position sync
        this.container.setData('colliderOffsetX', colliderOffsetX);
        this.container.setData('colliderOffsetY', colliderOffsetY);

        // Store reference for cleanup
        const container = this.container;

        // Set up position syncing from body to container (subtract offset)
        // Skip for static bodies - they shouldn't move due to physics, and motion blocks
        // already set container position directly before syncing to body
        this.scene.matter.world.on('afterupdate', () => {
          if (body && container.active && !body.isStatic) {
            // If body was positioned by code this frame, don't overwrite with physics position
            // The code has already synced container -> body, so they're in sync
            const movedByCode = container.getData('_bodyMovedByCode');
            if (movedByCode) {
              container.setData('_bodyMovedByCode', false); // Reset for next frame
              return;
            }

            const offsetX = container.getData('colliderOffsetX') ?? 0;
            const offsetY = container.getData('colliderOffsetY') ?? 0;
            container.setPosition(body.position.x - offsetX, body.position.y - offsetY);
          }
        });

        // Apply gravity scale if configured
        if (physics?.gravityY !== undefined) {
          setBodyGravityY(body, physics.gravityY);
        }

        debugLog('info', `${this.name}.enablePhysics() ${colliderType} body created successfully`);
      } catch (e) {
        debugLog('error', `${this.name}.enablePhysics() failed: ${e}`);
      }
    } else {
      debugLog('info', `${this.name}.enablePhysics() body already exists`);
    }
  }

  setVelocity(vx: number, vy: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body && this.scene?.matter?.body) {
      // Invert Y for user space (positive = up)
      this.scene.matter.body.setVelocity(body, { x: vx, y: -vy });
      debugLog('action', `${this.name}.setVelocity(${vx}, ${vy}) -> body velocity: (${vx}, ${-vy})`);
    } else if (!body) {
      debugLog('error', `${this.name}.setVelocity: No physics body found. Call enablePhysics() first or enable physics in object properties.`);
    } else {
      debugLog('error', `${this.name}.setVelocity: Matter physics not available on scene`);
    }
  }

  setVelocityX(vx: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body && this.scene?.matter?.body) {
      this.scene.matter.body.setVelocity(body, { x: vx, y: body.velocity.y });
      debugLog('action', `${this.name}.setVelocityX(${vx})`);
    } else if (!body) {
      debugLog('error', `${this.name}.setVelocityX: No physics body found.`);
    } else {
      debugLog('error', `${this.name}.setVelocityX: Matter physics not available`);
    }
  }

  setVelocityY(vy: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body && this.scene?.matter?.body) {
      // Invert Y for user space (positive = up)
      this.scene.matter.body.setVelocity(body, { x: body.velocity.x, y: -vy });
      debugLog('action', `${this.name}.setVelocityY(${vy})`);
    } else if (!body) {
      debugLog('error', `${this.name}.setVelocityY: No physics body found.`);
    } else {
      debugLog('error', `${this.name}.setVelocityY: Matter physics not available`);
    }
  }

  setGravity(gravity: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      setBodyGravityY(body, gravity);
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

  setFriction(friction: number): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      body.friction = friction;
      debugLog('action', `${this.name}.setFriction(${friction})`);
    } else {
      debugLog('error', `${this.name}.setFriction: No physics body found.`);
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
      // Zero out all velocity first
      this.scene.matter.body.setVelocity(body, { x: 0, y: 0 });
      this.scene.matter.body.setAngularVelocity(body, 0);
      // Make the body static - it will no longer respond to forces or collisions
      this.scene.matter.body.setStatic(body, true);
      // Sync body position to current container position to lock it in place
      const offsetX = this.container.getData('colliderOffsetX') ?? 0;
      const offsetY = this.container.getData('colliderOffsetY') ?? 0;
      this.scene.matter.body.setPosition(body, {
        x: this.container.x + offsetX,
        y: this.container.y + offsetY
      });
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

    // Remove Matter.js body from world before destroying container
    // This prevents the "body.destroy is not a function" error
    const body = this.getMatterBody();
    if (body && this.scene?.matter?.world) {
      this.scene.matter.world.remove(body);
    }

    // Clear the body reference to prevent Phaser from trying to destroy it
    (this.container as unknown as { body?: MatterJS.BodyType }).body = undefined;

    this.container.destroy();
  }
}

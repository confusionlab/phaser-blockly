import Phaser from 'phaser';
import { runtimeDebugLog } from './RuntimeEngine';
import type { Costume } from '../types';

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

  private _direction: number = 90; // 0 = up, 90 = right, 180 = down, 270 = left
  private _size: number = 100; // percentage
  private _stopped: boolean = false;
  private _isClone: boolean = false;
  private _cloneParentId: string | null = null;

  // Costume support
  private _costumes: Costume[] = [];
  private _currentCostumeIndex: number = 0;
  private _costumeImage: Phaser.GameObjects.Image | null = null;

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

  // --- Motion ---

  moveSteps(steps: number): void {
    if (this._stopped) return;
    // Direction: 0 = up, 90 = right, 180 = down, 270 = left
    const radians = Phaser.Math.DegToRad(this._direction - 90);
    this.container.x += Math.cos(radians) * steps;
    this.container.y += Math.sin(radians) * steps;
  }

  goTo(x: number, y: number): void {
    if (this._stopped) return;
    this.container.setPosition(x, y);
  }

  setX(x: number): void {
    if (this._stopped) return;
    this.container.x = x;
  }

  setY(y: number): void {
    if (this._stopped) return;
    this.container.y = y;
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
    this.container.y += dy;
    debugLog('action', `${this.name}.changeY(${dy}): ${oldY} -> ${this.container.y}`);
  }

  getX(): number {
    return this.container.x;
  }

  getY(): number {
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
    this.container.addAt(this._costumeImage, 0);
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

  // --- Physics ---

  private getBody(): Phaser.Physics.Arcade.Body | null {
    return this.container.body as Phaser.Physics.Arcade.Body | null;
  }

  enablePhysics(): void {
    if (this._stopped) return;
    if (!this.container.body) {
      this.scene.physics.add.existing(this.container);
    }
  }

  setVelocity(vx: number, vy: number): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setVelocity(vx, vy);
    }
  }

  setVelocityX(vx: number): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setVelocityX(vx);
    }
  }

  setVelocityY(vy: number): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setVelocityY(vy);
    }
  }

  setGravity(gravity: number): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setGravityY(gravity);
    }
  }

  setBounce(bounce: number): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setBounce(bounce, bounce);
    }
  }

  setCollideWorldBounds(collide: boolean): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setCollideWorldBounds(collide);
    }
  }

  makeImmovable(): void {
    if (this._stopped) return;
    const body = this.getBody();
    if (body) {
      body.setImmovable(true);
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

import Phaser from 'phaser';

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
    this.container.x += dx;
  }

  changeY(dy: number): void {
    if (this._stopped) return;
    this.container.y += dy;
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

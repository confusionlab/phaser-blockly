import Phaser from 'phaser';
import {
  getCostumeAssetCenterOffset,
  getCostumeVisibleCenterOffset,
} from '@/lib/costume/costumeAssetFrame';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import { getAnimatedCostumeFrameDurationMs, getAnimatedCostumePlaybackSequence } from '@/lib/costume/costumeAnimation';
import {
  getAnimatedCostumeFramePreviewSignature,
  prewarmAnimatedCostumeFramePreviews,
  renderAnimatedCostumeFramePreview,
} from '@/lib/costume/costumeDocumentRender';
import { appendRuntimeLog } from './RuntimeEngine';
import { setBodyGravityY } from './gravity';
import {
  clampScaleMagnitude,
  getScaleSign,
  toggleScaleDirection,
} from './scaleMath';
import type { Costume, CostumeAssetFrame, CostumeBounds, ColliderConfig, PhysicsConfig } from '../types';
import { isAnimatedCostume } from '@/lib/costume/costumeDocument';
import type { RuntimeEngine } from './RuntimeEngine';

const SPEECH_BUBBLE_MAX_TEXT_WIDTH = 220;
const SPEECH_BUBBLE_PADDING_X = 14;
const SPEECH_BUBBLE_PADDING_Y = 12;
const SPEECH_BUBBLE_RADIUS = 16;
const SPEECH_BUBBLE_TAIL_HEIGHT = 14;
const SPEECH_BUBBLE_FADE_DURATION_MS = 300;
const SPEECH_WORD_REVEAL_STAGGER_MS = 110;
const SPEECH_WORD_REVEAL_DURATION_MS = 180;
const SPEECH_AUTO_STOP_HOLD_SECONDS = 1.3;
const FULL_COSTUME_ASSET_FRAME = {
  x: 0,
  y: 0,
  width: 1024,
  height: 1024,
  sourceWidth: 1024,
  sourceHeight: 1024,
} as const;
const SPEECH_BUBBLE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Trebuchet MS", "Verdana", sans-serif',
  fontSize: '20px',
  color: '#111827',
  align: 'left',
};

function debugLog(type: 'info' | 'event' | 'action' | 'error', message: string) {
  appendRuntimeLog(type, message, {
    emitToConsole: true,
    consolePrefix: 'Sprite',
  });
}

function hashTextureInput(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * RuntimeSprite wraps a Phaser container/sprite and provides
 * child-friendly methods for block-based programming.
 */
export class RuntimeSprite {
  private static readonly MOVEMENT_EPSILON = 0.01;

  public container: Phaser.GameObjects.Container;
  public scene: Phaser.Scene;
  public id: string;
  public name: string;
  public componentId: string | null = null; // For component instances
  public typeToken: string = '';
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
  private _displayedFrameIndex: number = 0;
  private _animationSequenceIndex: number = 0;
  private _animationAccumulatedMs: number = 0;
  private _animationCompleted: boolean = false;
  private _costumeDisplayVersion: number = 0;
  private _animationCompletionResolvers: Array<() => void> = [];

  // Click handler for pixel-perfect detection
  private _clickHandler: (() => void) | null = null;
  private _speechBubble: Phaser.GameObjects.Container | null = null;
  private _speechBubbleBackground: Phaser.GameObjects.Graphics | null = null;
  private _speechBubbleTextLayer: Phaser.GameObjects.Container | null = null;
  private _speechMeasureText: Phaser.GameObjects.Text | null = null;
  private _speechUpdateHandler: (() => void) | null = null;
  private _speechWordTweens: Phaser.Tweens.Tween[] = [];
  private _speechBubbleTween: Phaser.Tweens.Tween | null = null;
  private _speechSessionId: number = 0;
  private _lastMotionSample: { x: number; y: number } | null = null;
  private _activeTranslationTweens: number = 0;
  private _motionSampleHandler: (() => void) | null = null;
  private _animationUpdateHandler: ((time: number, delta: number) => void) | null = null;

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
    this._lastMotionSample = { x: container.x, y: container.y };
    if (this.scene?.events) {
      this._motionSampleHandler = () => {
        this._lastMotionSample = { x: this.container.x, y: this.container.y };
      };
      this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this._motionSampleHandler);
      this._animationUpdateHandler = (_time: number, delta: number) => {
        this._advanceAnimatedCostumePlayback(delta);
      };
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, this._animationUpdateHandler);
    }
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
    const nextX = this.container.x + Math.cos(radians) * steps;
    // Y is inverted: moving "up" in user space = negative Y in Phaser
    const nextY = this.container.y - Math.sin(radians) * steps;
    if (this.runtime) {
      const clamped = this.runtime.clampPhaserPositionForSprite(this.id, nextX, nextY);
      this.container.setPosition(clamped.x, clamped.y);
    } else {
      this.container.setPosition(nextX, nextY);
    }
    this.syncBodyToContainer();
  }

  moveTowards(userX: number, userY: number, steps: number): void {
    if (this._stopped) return;

    const targetPosition = this.runtime
      ? this.runtime.userToPhaser(userX, userY)
      : { x: userX, y: userY };

    const dx = targetPosition.x - this.container.x;
    const dy = targetPosition.y - this.container.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= RuntimeSprite.MOVEMENT_EPSILON) {
      return;
    }

    const scale = steps / distance;
    const nextX = this.container.x + dx * scale;
    const nextY = this.container.y + dy * scale;

    if (this.runtime) {
      const clamped = this.runtime.clampPhaserPositionForSprite(this.id, nextX, nextY);
      this.container.setPosition(clamped.x, clamped.y);
    } else {
      this.container.setPosition(nextX, nextY);
    }
    this.syncBodyToContainer();
  }

  goTo(userX: number, userY: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      const phaser = this.runtime.userToPhaser(userX, userY);
      const clamped = this.runtime.clampPhaserPositionForSprite(this.id, phaser.x, phaser.y);
      this.container.setPosition(clamped.x, clamped.y);
    } else {
      this.container.setPosition(userX, userY);
    }
    this.syncBodyToContainer();
  }

  setX(userX: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      const clamped = this.runtime.clampPhaserPositionForSprite(
        this.id,
        userX + this.runtime.canvasWidth / 2,
        this.container.y,
      );
      this.container.x = clamped.x;
      this.container.y = clamped.y;
    } else {
      this.container.x = userX;
    }
    this.syncBodyToContainer();
  }

  setY(userY: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      const clamped = this.runtime.clampPhaserPositionForSprite(
        this.id,
        this.container.x,
        this.runtime.canvasHeight / 2 - userY,
      );
      this.container.x = clamped.x;
      this.container.y = clamped.y;
    } else {
      this.container.y = userY;
    }
    this.syncBodyToContainer();
  }

  changeX(dx: number): void {
    if (this._stopped) return;
    if (this.runtime) {
      const clamped = this.runtime.clampPhaserPositionForSprite(this.id, this.container.x + dx, this.container.y);
      this.container.setPosition(clamped.x, clamped.y);
    } else {
      this.container.x += dx;
    }
    this.syncBodyToContainer();
  }

  changeY(dy: number): void {
    if (this._stopped) return;
    // In user space, +Y is up, so changeY(10) means move up = decrease Phaser Y
    if (this.runtime) {
      const clamped = this.runtime.clampPhaserPositionForSprite(this.id, this.container.x, this.container.y - dy);
      this.container.setPosition(clamped.x, clamped.y);
    } else {
      this.container.y -= dy;
    }
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

  beginTranslationTween(): void {
    this._activeTranslationTweens += 1;
  }

  endTranslationTween(): void {
    this._activeTranslationTweens = Math.max(0, this._activeTranslationTweens - 1);
  }

  isMoving(): boolean {
    if (this._stopped || !this.container.active) {
      return false;
    }

    if (this._activeTranslationTweens > 0) {
      return true;
    }

    const body = this.getMatterBody();
    if (body) {
      const velocityX = body.velocity.x ?? 0;
      const velocityY = body.velocity.y ?? 0;
      if (Math.abs(velocityX) > RuntimeSprite.MOVEMENT_EPSILON || Math.abs(velocityY) > RuntimeSprite.MOVEMENT_EPSILON) {
        return true;
      }
    }

    if (!this._lastMotionSample) {
      return false;
    }

    return (
      Math.abs(this.container.x - this._lastMotionSample.x) > RuntimeSprite.MOVEMENT_EPSILON
      || Math.abs(this.container.y - this._lastMotionSample.y) > RuntimeSprite.MOVEMENT_EPSILON
    );
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
    this.syncSpeechBubbleVisibility();
  }

  hide(): void {
    if (this._stopped) return;
    this.container.setVisible(false);
    this.syncSpeechBubbleVisibility();
  }

  keepSpeaking(rawText: unknown): void {
    if (this._stopped) return;

    const text = String(rawText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!/\S/.test(text)) {
      void this.stopSpeaking();
      return;
    }

    this._speechSessionId += 1;
    this.ensureSpeechBubble();
    this.renderSpeechBubble(text);
    this.syncSpeechBubbleVisibility();
    this.updateSpeechBubblePosition();
    this.fadeSpeechBubbleIn();
  }

  speak(rawText: unknown): void {
    this.keepSpeaking(rawText);
  }

  async stopSpeaking(): Promise<void> {
    if (this._stopped) return;
    this._speechSessionId += 1;
    await this.fadeOutAndClearSpeechBubble(this._speechSessionId);
  }

  async speakAndStop(rawText: unknown): Promise<void> {
    if (this._stopped) return;

    const text = String(rawText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!/\S/.test(text)) {
      await this.stopSpeaking();
      return;
    }

    this.keepSpeaking(text);
    const sessionId = this._speechSessionId;
    const totalDurationMs = this.getSpeechRevealDurationMs(text) + SPEECH_AUTO_STOP_HOLD_SECONDS * 1000;
    await this.waitForSeconds(totalDurationMs / 1000);

    if (this._stopped || this._speechSessionId !== sessionId) {
      return;
    }

    await this.stopSpeaking();
  }

  async speakFor(rawText: unknown, _durationSeconds: unknown): Promise<void> {
    await this.speakAndStop(rawText);
  }

  private syncStoredSizeFromContainer(): void {
    this._size = ((Math.abs(this.container.scaleX) + Math.abs(this.container.scaleY)) / 2) * 100;
  }

  setSize(percent: number): void {
    if (this._stopped) return;
    const scale = clampScaleMagnitude(percent / 100);
    this.container.setScale(
      getScaleSign(this.container.scaleX) * scale,
      getScaleSign(this.container.scaleY) * scale,
    );
    this._size = scale * 100;
  }

  changeSize(delta: number): void {
    if (this._stopped) return;
    const deltaScale = delta / 100;
    const nextScaleX = clampScaleMagnitude(Math.abs(this.container.scaleX) + deltaScale);
    const nextScaleY = clampScaleMagnitude(Math.abs(this.container.scaleY) + deltaScale);
    this.container.setScale(
      getScaleSign(this.container.scaleX) * nextScaleX,
      getScaleSign(this.container.scaleY) * nextScaleY,
    );
    this.syncStoredSizeFromContainer();
  }

  changeAxisScale(axis: string, delta: number): void {
    if (this._stopped) return;
    const deltaScale = delta / 100;
    if (axis === 'VERTICAL') {
      const nextScaleY = clampScaleMagnitude(Math.abs(this.container.scaleY) + deltaScale);
      this.container.setScale(
        this.container.scaleX,
        getScaleSign(this.container.scaleY) * nextScaleY,
      );
    } else {
      const nextScaleX = clampScaleMagnitude(Math.abs(this.container.scaleX) + deltaScale);
      this.container.setScale(
        getScaleSign(this.container.scaleX) * nextScaleX,
        this.container.scaleY,
      );
    }
    this.syncStoredSizeFromContainer();
  }

  flipAxis(axis: string): void {
    if (this._stopped) return;
    if (axis === 'VERTICAL') {
      this.container.setScale(this.container.scaleX, toggleScaleDirection(this.container.scaleY));
    } else {
      this.container.setScale(toggleScaleDirection(this.container.scaleX), this.container.scaleY);
    }
    this.syncStoredSizeFromContainer();
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
    this._resetAnimatedCostumePlayback();
    this._updateCostumeDisplay();
    const currentCostume = this.getCurrentCostume();
    if (currentCostume && isAnimatedCostume(currentCostume)) {
      void prewarmAnimatedCostumeFramePreviews(currentCostume.clip).catch(() => {});
    }
  }

  getCostumes(): Costume[] {
    return this._costumes;
  }

  getCurrentCostumeIndex(): number {
    return this._currentCostumeIndex;
  }

  getCurrentCostume(): Costume | null {
    return this._costumes[this._currentCostumeIndex] ?? null;
  }

  private _getCurrentAnimationFrameIndex(): number {
    const costume = this.getCurrentCostume();
    if (!costume || !isAnimatedCostume(costume)) {
      return 0;
    }

    const sequence = getAnimatedCostumePlaybackSequence(costume.clip.totalFrames, costume.clip.playback);
    return sequence[this._animationSequenceIndex]?.frameIndex ?? 0;
  }

  private _resetAnimatedCostumePlayback(): void {
    this._displayedFrameIndex = 0;
    this._animationSequenceIndex = 0;
    this._animationAccumulatedMs = 0;
    this._animationCompleted = false;
    this._resolveAnimationWaiters(true);
  }

  private _resolveAnimationWaiters(immediate: boolean = false): void {
    if (!immediate && !this._animationCompleted) {
      return;
    }
    const resolvers = [...this._animationCompletionResolvers];
    this._animationCompletionResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private _advanceAnimatedCostumePlayback(deltaMs: number): void {
    if (this._stopped) {
      return;
    }

    const costume = this.getCurrentCostume();
    if (!costume || !isAnimatedCostume(costume)) {
      return;
    }

    const clip = costume.clip;
    const frameDurationMs = getAnimatedCostumeFrameDurationMs(clip);
    if (frameDurationMs <= 0) {
      return;
    }

    if (clip.playback === 'play-once' && this._animationCompleted) {
      return;
    }

    this._animationAccumulatedMs += Math.max(0, deltaMs);
    const sequence = getAnimatedCostumePlaybackSequence(clip.totalFrames, clip.playback);
    if (sequence.length <= 1) {
      return;
    }

    let didAdvanceFrame = false;
    while (this._animationAccumulatedMs >= frameDurationMs) {
      this._animationAccumulatedMs -= frameDurationMs;
      if (clip.playback === 'play-once' && this._animationSequenceIndex >= sequence.length - 1) {
        this._animationCompleted = true;
        this._resolveAnimationWaiters();
        break;
      }

      this._animationSequenceIndex = (this._animationSequenceIndex + 1) % sequence.length;
      didAdvanceFrame = true;
    }

    if (didAdvanceFrame) {
      const nextFrameIndex = this._getCurrentAnimationFrameIndex();
      if (nextFrameIndex !== this._displayedFrameIndex) {
        this._displayedFrameIndex = nextFrameIndex;
        this._updateCostumeDisplay();
      }
    }
  }

  private _getSharedTextureKeyForCurrentFrame(assetId: string, frameSignature?: string): string {
    const costume = this.getCurrentCostume();
    const costumeId = costume?.id ?? 'unknown';
    const input = frameSignature ? `${costumeId}:${frameSignature}` : `${costumeId}:${assetId}`;
    return `runtime_costume_${hashTextureInput(input)}`;
  }

  // For cloning - copy internal state
  copyStateFrom(other: RuntimeSprite): void {
    // Copy costumes
    if (other._costumes.length > 0) {
      this.setCostumes([...other._costumes], other._currentCostumeIndex);
      this._animationSequenceIndex = other._animationSequenceIndex;
      this._displayedFrameIndex = other._displayedFrameIndex;
      this._animationAccumulatedMs = other._animationAccumulatedMs;
      this._animationCompleted = other._animationCompleted;
      this._updateCostumeDisplay();
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
    this.typeToken = other.typeToken;
  }

  private _updateCostumeDisplay(): void {
    if (this._costumes.length === 0) return;

    const costume = this._costumes[this._currentCostumeIndex];
    if (!costume) return;

    // Remove the default graphics (colored rectangle)
    const graphics = this.container.getAt(0);
    if (graphics instanceof Phaser.GameObjects.Graphics) {
      graphics.setVisible(false);
    }

    const displayVersion = ++this._costumeDisplayVersion;
    const applyResolvedPreview = (
      textureKey: string,
      preview: {
        assetFrame?: CostumeAssetFrame | null;
        bounds: CostumeBounds | null;
      },
    ) => {
      if (!this.container.active || !this.container.scene || displayVersion !== this._costumeDisplayVersion) {
        return;
      }

      let costumeImage = this._costumeImage;
      const existingSprite = this.container.getByName('sprite');
      if (existingSprite && existingSprite !== costumeImage) {
        existingSprite.destroy();
      }

      if (!costumeImage) {
        costumeImage = this.scene.add.image(0, 0, textureKey);
        costumeImage.setName('sprite');
        costumeImage.setOrigin(0.5, 0.5);
        this._costumeImage = costumeImage;
        this.container.addAt(costumeImage, 0);
      } else {
        costumeImage.setTexture(textureKey);
      }

      const layoutBounds = costume.bounds ?? preview.bounds ?? null;
      const layoutAssetFrame = preview.assetFrame ?? costume.assetFrame ?? FULL_COSTUME_ASSET_FRAME;
      const assetOffset = getCostumeAssetCenterOffset(layoutAssetFrame);
      costumeImage.setPosition(assetOffset.x, assetOffset.y);

      if (layoutBounds && layoutBounds.width > 0 && layoutBounds.height > 0) {
        this.container.setSize(layoutBounds.width, layoutBounds.height);
      } else {
        const width = costumeImage.displayWidth || costumeImage.width || 64;
        const height = costumeImage.displayHeight || costumeImage.height || 64;
        this.container.setSize(width, height);
      }

      if (this._clickHandler) {
        this._setupPixelPerfectClick();
      }

      this.updatePhysicsBodySize();
    };

    if (isAnimatedCostume(costume)) {
      const frameIndex = this._getCurrentAnimationFrameIndex();
      const frameSignature = getAnimatedCostumeFramePreviewSignature(costume.clip, frameIndex);
      void renderAnimatedCostumeFramePreview(costume.clip, frameIndex).then((preview) => {
        const textureKey = this._getSharedTextureKeyForCurrentFrame(preview.dataUrl, frameSignature);
        const commit = () => applyResolvedPreview(textureKey, preview);
        if (this.scene.textures.exists(textureKey)) {
          commit();
          return;
        }

        void loadImageSource(preview.dataUrl).then((img) => {
          if (!this.scene?.textures?.exists(textureKey)) {
            this.scene.textures.addImage(textureKey, img);
          }
          commit();
        }).catch((error) => {
          debugLog('error', `${this.name}: Failed to load animated costume frame (${String(error)})`);
        });
      }).catch((error) => {
        debugLog('error', `${this.name}: Failed to render animated costume frame (${String(error)})`);
      });
      return;
    }

    const textureKey = this._getSharedTextureKeyForCurrentFrame(costume.assetId);
    const commit = () => applyResolvedPreview(textureKey, {
      assetFrame: costume.assetFrame ?? null,
      bounds: costume.bounds ?? null,
    });

    if (this.scene.textures.exists(textureKey)) {
      commit();
      return;
    }

    void loadImageSource(costume.assetId).then((img) => {
      if (!this.scene?.textures?.exists(textureKey)) {
        this.scene.textures.addImage(textureKey, img);
      }
      commit();
    }).catch((error) => {
      debugLog('error', `${this.name}: Failed to load costume asset (${String(error)})`);
    });
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

  hitTest(worldX: number, worldY: number): boolean {
    if (!this.container.visible || !this.container.active || this.container.alpha <= 0) {
      return false;
    }

    if (this._costumeImage) {
      const local = this._costumeImage
        .getWorldTransformMatrix()
        .applyInverse(worldX, worldY, new Phaser.Math.Vector2());
      const localX = local.x + this._costumeImage.displayOriginX;
      const localY = local.y + this._costumeImage.displayOriginY;
      const spriteWidth = this._costumeImage.width;
      const spriteHeight = this._costumeImage.height;
      if (spriteWidth <= 0 || spriteHeight <= 0) return false;
      if (localX < 0 || localY < 0 || localX >= spriteWidth || localY >= spriteHeight) return false;
      const pixelX = Math.floor(Math.max(0, Math.min(spriteWidth - 1, localX)));
      const pixelY = Math.floor(Math.max(0, Math.min(spriteHeight - 1, localY)));
      const alpha = this.scene.textures.getPixelAlpha(
        pixelX,
        pixelY,
        this._costumeImage.texture.key,
        this._costumeImage.frame.name,
      );
      return alpha !== null && alpha !== undefined && alpha >= 1;
    }

    return this.container.getBounds().contains(worldX, worldY);
  }

  nextCostume(): void {
    if (this._stopped) return;
    if (this._costumes.length === 0) return;

    this._currentCostumeIndex = (this._currentCostumeIndex + 1) % this._costumes.length;
    this._resetAnimatedCostumePlayback();
    this._updateCostumeDisplay();
    debugLog('action', `${this.name}.nextCostume() -> ${this._currentCostumeIndex + 1}`);
  }

  previousCostume(): void {
    if (this._stopped) return;
    if (this._costumes.length === 0) return;

    this._currentCostumeIndex = (this._currentCostumeIndex - 1 + this._costumes.length) % this._costumes.length;
    this._resetAnimatedCostumePlayback();
    this._updateCostumeDisplay();
    debugLog('action', `${this.name}.previousCostume() -> ${this._currentCostumeIndex + 1}`);
  }

  switchCostume(costumeRef: number | string): void {
    if (this._stopped) return;
    if (this._costumes.length === 0) return;

    let index: number;

    if (typeof costumeRef === 'number') {
      // 1-based index
      index = Math.max(0, Math.min(this._costumes.length - 1, costumeRef - 1));
    } else {
      // Prefer id, then fall back to name for compatibility with older Blockly output.
      index = this._costumes.findIndex((c) => c.id === costumeRef);
      if (index === -1) {
        index = this._costumes.findIndex((c) => c.name === costumeRef);
      }
      if (index === -1) index = this._currentCostumeIndex;
    }

    this._currentCostumeIndex = index;
    this._resetAnimatedCostumePlayback();
    this._updateCostumeDisplay();
    debugLog('action', `${this.name}.switchCostume(${costumeRef}) -> ${this._currentCostumeIndex + 1}`);
  }

  async switchCostumeAndWait(costumeRef: number | string): Promise<void> {
    this.switchCostume(costumeRef);
    const costume = this.getCurrentCostume();
    if (!costume || !isAnimatedCostume(costume) || costume.clip.playback !== 'play-once') {
      return;
    }

    if (this._animationCompleted) {
      return;
    }

    await new Promise<void>((resolve) => {
      this._animationCompletionResolvers.push(resolve);
    });
  }

  getCostumeNumber(): number {
    return this._currentCostumeIndex + 1; // 1-based
  }

  getCostumeName(): string {
    if (this._costumes.length === 0) return '';
    return this._costumes[this._currentCostumeIndex]?.name || '';
  }

  // --- Physics (Matter.js) ---

  getMatterBody(): MatterJS.BodyType | null {
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
        collisionFilter: {
          mask: this.runtime?.getPhysicsCollisionMaskForSprite(this.id) ?? 0xffff,
        },
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

  makeDynamic(): void {
    if (this._stopped) return;
    const body = this.getMatterBody();
    if (body) {
      this.scene.matter.body.setStatic(body, false);
      const allowRotation = this.container.getData('allowRotation') ?? false;
      if (!allowRotation) {
        this.scene.matter.body.setInertia(body, Infinity);
      }
      debugLog('action', `${this.name}.makeDynamic()`);
    } else {
      debugLog('error', `${this.name}.makeDynamic: No physics body found.`);
    }
  }

  makeStatic(): void {
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
      debugLog('action', `${this.name}.makeStatic()`);
    } else {
      debugLog('error', `${this.name}.makeStatic: No physics body found.`);
    }
  }

  makeImmovable(): void {
    this.makeStatic();
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
    this._speechSessionId += 1;
    this._stopped = true;
    this.stopSpeechTweens();
    this.stopSpeechBubbleTween();
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
    this._speechSessionId += 1;
    this._stopped = true;
    this.stopSpeechTweens();
    this.stopSpeechBubbleTween();
    this.clearSpeechBubble();

    if (this._speechMeasureText) {
      this._speechMeasureText.destroy();
      this._speechMeasureText = null;
    }

    if (this._motionSampleHandler) {
      this.scene.events?.off(Phaser.Scenes.Events.POST_UPDATE, this._motionSampleHandler);
      this._motionSampleHandler = null;
    }
    if (this._animationUpdateHandler) {
      this.scene.events?.off(Phaser.Scenes.Events.UPDATE, this._animationUpdateHandler);
      this._animationUpdateHandler = null;
    }
    this._resolveAnimationWaiters(true);

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

  private ensureSpeechBubble(): void {
    if (this._speechBubble) {
      return;
    }

    const bubble = this.scene.add.container(this.container.x, this.container.y);
    const background = this.scene.add.graphics();
    const textLayer = this.scene.add.container(0, 0);
    bubble.add([background, textLayer]);
    bubble.setAlpha(0);

    this._speechBubble = bubble;
    this._speechBubbleBackground = background;
    this._speechBubbleTextLayer = textLayer;

    if (!this._speechUpdateHandler) {
      this._speechUpdateHandler = () => {
        this.updateSpeechBubblePosition();
        this.syncSpeechBubbleVisibility();
      };
      this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this._speechUpdateHandler);
    }
  }

  private getSpeechMeasureText(): Phaser.GameObjects.Text {
    if (!this._speechMeasureText) {
      this._speechMeasureText = this.scene.add.text(-10000, -10000, '', SPEECH_BUBBLE_TEXT_STYLE);
      this._speechMeasureText.setVisible(false);
    }

    this._speechMeasureText.setStyle(SPEECH_BUBBLE_TEXT_STYLE);
    return this._speechMeasureText;
  }

  private waitForSeconds(seconds: number): Promise<void> {
    if (seconds <= 0) {
      return Promise.resolve();
    }

    if (this.runtime) {
      return this.runtime.wait(seconds);
    }

    return new Promise((resolve) => {
      this.scene.time.delayedCall(seconds * 1000, () => resolve());
    });
  }

  private stopSpeechTweens(): void {
    this._speechWordTweens.forEach((tween) => tween.stop());
    this._speechWordTweens = [];
  }

  private stopSpeechBubbleTween(): void {
    if (this._speechBubbleTween) {
      this._speechBubbleTween.stop();
      this._speechBubbleTween = null;
    }
  }

  private fadeSpeechBubbleIn(): void {
    if (!this._speechBubble) {
      return;
    }

    this.stopSpeechBubbleTween();
    this._speechBubble.setAlpha(0);
    this._speechBubble.setVisible(this.container.visible && this.container.active && !this._stopped);
    this._speechBubbleTween = this.scene.tweens.add({
      targets: this._speechBubble,
      alpha: 1,
      duration: SPEECH_BUBBLE_FADE_DURATION_MS,
      ease: 'Quad.Out',
      onComplete: () => {
        this._speechBubbleTween = null;
      },
    });
  }

  private fadeOutAndClearSpeechBubble(sessionId: number): Promise<void> {
    if (!this._speechBubble) {
      this.clearSpeechBubble();
      return Promise.resolve();
    }

    this.stopSpeechBubbleTween();
    this._speechBubble.setVisible(true);

    return new Promise((resolve) => {
      this._speechBubbleTween = this.scene.tweens.add({
        targets: this._speechBubble,
        alpha: 0,
        duration: SPEECH_BUBBLE_FADE_DURATION_MS,
        ease: 'Quad.Out',
        onComplete: () => {
          this._speechBubbleTween = null;
          if (this._speechSessionId === sessionId || this._stopped) {
            this.clearSpeechBubble();
          }
          resolve();
        },
      });
    });
  }

  private clearSpeechBubble(): void {
    this.stopSpeechTweens();
    this.stopSpeechBubbleTween();

    if (this._speechUpdateHandler) {
      this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this._speechUpdateHandler);
      this._speechUpdateHandler = null;
    }

    if (this._speechBubble) {
      this._speechBubble.destroy(true);
      this._speechBubble = null;
    }

    this._speechBubbleBackground = null;
    this._speechBubbleTextLayer = null;
  }

  private syncSpeechBubbleVisibility(): void {
    if (!this._speechBubble) {
      return;
    }

    this._speechBubble.setVisible(this.container.visible && this.container.active && !this._stopped);
  }

  private tokenizeSpeechText(text: string): string[] {
    return text.match(/\S+|\n|[ \t]+/g) ?? [];
  }

  private countSpeechWords(text: string): number {
    return this.tokenizeSpeechText(text).filter((token) => token !== '\n' && token.trim().length > 0).length;
  }

  private getSpeechRevealDurationMs(text: string): number {
    const wordCount = this.countSpeechWords(text);
    if (wordCount <= 0) {
      return 0;
    }

    return ((wordCount - 1) * SPEECH_WORD_REVEAL_STAGGER_MS) + SPEECH_WORD_REVEAL_DURATION_MS;
  }

  private renderSpeechBubble(text: string): void {
    if (!this._speechBubble || !this._speechBubbleBackground || !this._speechBubbleTextLayer) {
      return;
    }

    this.stopSpeechTweens();
    this._speechBubbleTextLayer.removeAll(true);

    const measureText = this.getSpeechMeasureText();
    const lineHeight = Math.max(26, Math.ceil(measureText.setText('Ag').height * 1.2));
    const tokens = this.tokenizeSpeechText(text);
    const wordObjects: Phaser.GameObjects.Text[] = [];

    let cursorX = 0;
    let cursorY = 0;
    let maxLineWidth = 0;

    for (const token of tokens) {
      if (token === '\n') {
        maxLineWidth = Math.max(maxLineWidth, cursorX);
        cursorX = 0;
        cursorY += lineHeight;
        continue;
      }

      const tokenWidth = Math.ceil(measureText.setText(token).width);
      const isWhitespace = token.trim().length === 0;

      if (!isWhitespace && cursorX > 0 && cursorX + tokenWidth > SPEECH_BUBBLE_MAX_TEXT_WIDTH) {
        maxLineWidth = Math.max(maxLineWidth, cursorX);
        cursorX = 0;
        cursorY += lineHeight;
      }

      if (isWhitespace) {
        cursorX += tokenWidth;
        continue;
      }

      const word = this.scene.add.text(cursorX, cursorY, token, SPEECH_BUBBLE_TEXT_STYLE);
      word.setOrigin(0, 0);
      word.setAlpha(0);
      this._speechBubbleTextLayer.add(word);
      wordObjects.push(word);
      cursorX += tokenWidth;
      maxLineWidth = Math.max(maxLineWidth, cursorX);
    }

    const textWidth = Math.max(48, Math.min(SPEECH_BUBBLE_MAX_TEXT_WIDTH, Math.ceil(maxLineWidth)));
    const lineCount = Math.max(1, Math.floor(cursorY / lineHeight) + 1);
    const textHeight = lineCount * lineHeight;
    const bubbleWidth = textWidth + SPEECH_BUBBLE_PADDING_X * 2;
    const bubbleHeight = textHeight + SPEECH_BUBBLE_PADDING_Y * 2;

    this._speechBubbleBackground.clear();
    this._speechBubbleBackground.fillStyle(0xffffff, 0.96);
    this._speechBubbleBackground.lineStyle(2, 0x111827, 0.18);
    this._speechBubbleBackground.fillRoundedRect(
      -bubbleWidth / 2,
      -bubbleHeight / 2,
      bubbleWidth,
      bubbleHeight,
      SPEECH_BUBBLE_RADIUS,
    );
    this._speechBubbleBackground.strokeRoundedRect(
      -bubbleWidth / 2,
      -bubbleHeight / 2,
      bubbleWidth,
      bubbleHeight,
      SPEECH_BUBBLE_RADIUS,
    );
    this._speechBubbleBackground.fillTriangle(
      -bubbleWidth * 0.18,
      bubbleHeight / 2 - 1,
      -bubbleWidth * 0.05,
      bubbleHeight / 2 - 1,
      -bubbleWidth * 0.12,
      bubbleHeight / 2 + SPEECH_BUBBLE_TAIL_HEIGHT,
    );
    this._speechBubbleBackground.strokeTriangle(
      -bubbleWidth * 0.18,
      bubbleHeight / 2 - 1,
      -bubbleWidth * 0.05,
      bubbleHeight / 2 - 1,
      -bubbleWidth * 0.12,
      bubbleHeight / 2 + SPEECH_BUBBLE_TAIL_HEIGHT,
    );

    this._speechBubbleTextLayer.setPosition(
      -bubbleWidth / 2 + SPEECH_BUBBLE_PADDING_X,
      -bubbleHeight / 2 + SPEECH_BUBBLE_PADDING_Y,
    );

    wordObjects.forEach((word, index) => {
      const tween = this.scene.tweens.add({
        targets: word,
        alpha: 1,
        duration: SPEECH_WORD_REVEAL_DURATION_MS,
        ease: 'Quad.Out',
        delay: index * SPEECH_WORD_REVEAL_STAGGER_MS,
      });
      this._speechWordTweens.push(tween);
    });
  }

  private updateSpeechBubblePosition(): void {
    if (!this._speechBubble) {
      return;
    }

    const bounds = this.getVisibleSpeechAnchorBounds();
    const bubbleHeight = this._speechBubble.getBounds().height;
    this._speechBubble.setDepth(this.container.depth + 10000);
    this._speechBubble.setPosition(
      (bounds.left + bounds.right) / 2,
      bounds.top - bubbleHeight / 2 - 10,
    );
  }

  private getVisibleSpeechAnchorBounds(): { left: number; right: number; top: number; bottom: number } {
    const costume = this._costumes[this._currentCostumeIndex];
    const bounds = costume?.bounds;
    if (!this._costumeImage || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      const fallback = this.container.getBounds();
      return {
        left: fallback.left,
        right: fallback.right,
        top: fallback.top,
        bottom: fallback.bottom,
      };
    }

    const visibleCenterOffset = getCostumeVisibleCenterOffset(bounds, {
      assetFrame: costume?.assetFrame,
      assetWidth: this._costumeImage.width,
      assetHeight: this._costumeImage.height,
    });
    const left = visibleCenterOffset.x - (bounds.width / 2);
    const top = visibleCenterOffset.y - (bounds.height / 2);
    const right = left + bounds.width;
    const bottom = top + bounds.height;

    const matrix = this._costumeImage.getWorldTransformMatrix();
    const corners = [
      new Phaser.Math.Vector2(),
      new Phaser.Math.Vector2(),
      new Phaser.Math.Vector2(),
      new Phaser.Math.Vector2(),
    ];

    matrix.transformPoint(left, top, corners[0]);
    matrix.transformPoint(right, top, corners[1]);
    matrix.transformPoint(left, bottom, corners[2]);
    matrix.transformPoint(right, bottom, corners[3]);

    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);

    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  }
}

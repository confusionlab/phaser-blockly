type MatterGravityConfig = {
  x: number;
  y: number;
  scale?: number;
};

/**
 * Configure per-body gravity behavior.
 * Phaser's Matter integration only supports disabling world gravity per body,
 * so non-default gravity values are handled via a custom force in RuntimeEngine.
 */
export function setBodyGravityY(body: MatterJS.BodyType, gravityY: number): void {
  const safeGravityY = Number.isFinite(gravityY) ? gravityY : 1;
  body.gravityScale = { x: 0, y: safeGravityY };
  body.ignoreGravity = safeGravityY !== 1;
}

/**
 * Apply custom gravity force for bodies that opt out of world gravity.
 */
export function applyCustomGravityForce(body: MatterJS.BodyType, gravity: MatterGravityConfig): void {
  if (body.isStatic || body.isSleeping || !body.ignoreGravity) {
    return;
  }

  const gravityScale = typeof gravity.scale === 'number' ? gravity.scale : 0.001;
  if ((gravity.x === 0 && gravity.y === 0) || gravityScale === 0) {
    return;
  }

  const bodyGravityScale = body.gravityScale ?? { x: 1, y: 1 };
  if (bodyGravityScale.x === 0 && bodyGravityScale.y === 0) {
    return;
  }

  body.force.x += body.mass * gravity.x * gravityScale * bodyGravityScale.x;
  body.force.y += body.mass * gravity.y * gravityScale * bodyGravityScale.y;
}

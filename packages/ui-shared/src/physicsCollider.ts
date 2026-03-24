export interface PhysicsLike {
  enabled: boolean;
}

export interface ColliderLike {
  type: string;
}

export function isPhysicsEnabled<Physics extends PhysicsLike>(
  physics: Physics | null | undefined,
): physics is Physics {
  return physics?.enabled === true;
}

export function normalizePhysicsColliderState<
  Physics extends PhysicsLike,
  Collider extends ColliderLike,
  Entity extends {
    physics: Physics | null;
    collider: Collider | null;
  },
>(
  entity: Entity,
  createDefaultCollider: () => Collider,
): Entity {
  if (!isPhysicsEnabled(entity.physics)) {
    if (entity.physics === null && entity.collider === null) {
      return entity;
    }

    return {
      ...entity,
      physics: null,
      collider: null,
    } as Entity;
  }

  if (!entity.collider || entity.collider.type === 'none') {
    return {
      ...entity,
      collider: createDefaultCollider(),
    } as Entity;
  }

  return entity;
}

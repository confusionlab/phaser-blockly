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
  if (entity.physics === null) {
    if (entity.collider === null) {
      return entity;
    }

    return {
      ...entity,
      collider: null,
    } as Entity;
  }

  if (!isPhysicsEnabled(entity.physics)) {
    return entity;
  }

  if (!entity.collider || entity.collider.type === 'none') {
    return {
      ...entity,
      collider: createDefaultCollider(),
    } as Entity;
  }

  return entity;
}

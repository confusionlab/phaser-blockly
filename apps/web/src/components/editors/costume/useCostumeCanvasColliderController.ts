import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ColliderConfig } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import { CANVAS_SIZE, HANDLE_SIZE } from './costumeCanvasShared';

type ColliderDragMode =
  | 'none'
  | 'move'
  | 'resize-tl'
  | 'resize-tr'
  | 'resize-bl'
  | 'resize-br'
  | 'resize-l'
  | 'resize-r'
  | 'resize-t'
  | 'resize-b';

interface UseCostumeCanvasColliderControllerOptions {
  activeTool: DrawingTool;
  collider: ColliderConfig | null;
  colliderCanvasRef: RefObject<HTMLCanvasElement | null>;
  onColliderChange?: (collider: ColliderConfig) => void;
}

function getColliderContext(colliderCanvasRef: RefObject<HTMLCanvasElement | null>) {
  return colliderCanvasRef.current?.getContext('2d') ?? null;
}

export function useCostumeCanvasColliderController({
  activeTool,
  collider,
  colliderCanvasRef,
  onColliderChange,
}: UseCostumeCanvasColliderControllerOptions) {
  const colliderRef = useRef(collider);
  colliderRef.current = collider;
  const onColliderChangeRef = useRef(onColliderChange);
  onColliderChangeRef.current = onColliderChange;
  const colliderDragModeRef = useRef<ColliderDragMode>('none');
  const colliderDragStartRef = useRef<{ x: number; y: number; collider: ColliderConfig } | null>(null);

  const drawCollider = useCallback((coll: ColliderConfig | null, editable = false) => {
    const colliderCtx = getColliderContext(colliderCanvasRef);
    if (!colliderCtx) return;

    colliderCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (!coll || coll.type === 'none') return;

    const centerX = CANVAS_SIZE / 2 + coll.offsetX;
    const centerY = CANVAS_SIZE / 2 + coll.offsetY;

    colliderCtx.strokeStyle = '#22c55e';
    colliderCtx.lineWidth = 3;
    colliderCtx.setLineDash(editable ? [] : [8, 8]);

    if (coll.type === 'box') {
      colliderCtx.strokeRect(
        centerX - coll.width / 2,
        centerY - coll.height / 2,
        coll.width,
        coll.height,
      );
    } else if (coll.type === 'circle') {
      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, coll.radius, 0, Math.PI * 2);
      colliderCtx.stroke();
    } else if (coll.type === 'capsule') {
      const halfW = coll.width / 2;
      const halfH = coll.height / 2;
      const radius = Math.min(halfW, halfH);

      colliderCtx.beginPath();
      colliderCtx.moveTo(centerX - halfW + radius, centerY - halfH);
      colliderCtx.lineTo(centerX + halfW - radius, centerY - halfH);
      colliderCtx.arc(centerX + halfW - radius, centerY - halfH + radius, radius, -Math.PI / 2, 0);
      colliderCtx.lineTo(centerX + halfW, centerY + halfH - radius);
      colliderCtx.arc(centerX + halfW - radius, centerY + halfH - radius, radius, 0, Math.PI / 2);
      colliderCtx.lineTo(centerX - halfW + radius, centerY + halfH);
      colliderCtx.arc(centerX - halfW + radius, centerY + halfH - radius, radius, Math.PI / 2, Math.PI);
      colliderCtx.lineTo(centerX - halfW, centerY - halfH + radius);
      colliderCtx.arc(centerX - halfW + radius, centerY - halfH + radius, radius, Math.PI, Math.PI * 1.5);
      colliderCtx.stroke();
    }

    colliderCtx.setLineDash([]);

    if (!editable) {
      return;
    }

    colliderCtx.fillStyle = '#ffffff';
    colliderCtx.strokeStyle = '#22c55e';
    colliderCtx.lineWidth = 2;

    if (coll.type === 'box' || coll.type === 'capsule') {
      const corners = [
        { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
        { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
        { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
        { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
      ];
      corners.forEach((corner) => {
        colliderCtx.fillRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        colliderCtx.strokeRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      });

      const edges = [
        { x: centerX, y: centerY - coll.height / 2 },
        { x: centerX, y: centerY + coll.height / 2 },
        { x: centerX - coll.width / 2, y: centerY },
        { x: centerX + coll.width / 2, y: centerY },
      ];
      edges.forEach((edge) => {
        colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      });
    } else if (coll.type === 'circle') {
      const edges = [
        { x: centerX, y: centerY - coll.radius },
        { x: centerX, y: centerY + coll.radius },
        { x: centerX - coll.radius, y: centerY },
        { x: centerX + coll.radius, y: centerY },
      ];
      edges.forEach((edge) => {
        colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      });
    }

    colliderCtx.beginPath();
    colliderCtx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    colliderCtx.fillStyle = '#22c55e';
    colliderCtx.fill();
    colliderCtx.strokeStyle = '#ffffff';
    colliderCtx.lineWidth = 2;
    colliderCtx.stroke();
  }, [colliderCanvasRef]);

  useEffect(() => {
    drawCollider(collider, activeTool === 'collider');
  }, [activeTool, collider, drawCollider]);

  useEffect(() => {
    const colliderCanvas = colliderCanvasRef.current;
    if (!colliderCanvas || activeTool !== 'collider') return;

    const getMousePos = (event: MouseEvent) => {
      const rect = colliderCanvas.getBoundingClientRect();
      const scaleX = CANVAS_SIZE / rect.width;
      const scaleY = CANVAS_SIZE / rect.height;
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
      };
    };

    const isNearPoint = (px: number, py: number, tx: number, ty: number, threshold = HANDLE_SIZE) => (
      Math.abs(px - tx) <= threshold && Math.abs(py - ty) <= threshold
    );

    const handleMouseDown = (event: MouseEvent) => {
      const coll = colliderRef.current;
      if (!coll || coll.type === 'none') return;
      const pos = getMousePos(event);
      const centerX = CANVAS_SIZE / 2 + coll.offsetX;
      const centerY = CANVAS_SIZE / 2 + coll.offsetY;

      const handles = coll.type === 'circle'
        ? {
            t: { x: centerX, y: centerY - coll.radius },
            b: { x: centerX, y: centerY + coll.radius },
            l: { x: centerX - coll.radius, y: centerY },
            r: { x: centerX + coll.radius, y: centerY },
          }
        : {
            tl: { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
            tr: { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
            bl: { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
            br: { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
            t: { x: centerX, y: centerY - coll.height / 2 },
            b: { x: centerX, y: centerY + coll.height / 2 },
            l: { x: centerX - coll.width / 2, y: centerY },
            r: { x: centerX + coll.width / 2, y: centerY },
          };

      if (coll.type !== 'circle') {
        if (isNearPoint(pos.x, pos.y, handles.tl!.x, handles.tl!.y)) {
          colliderDragModeRef.current = 'resize-tl';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.tr!.x, handles.tr!.y)) {
          colliderDragModeRef.current = 'resize-tr';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.bl!.x, handles.bl!.y)) {
          colliderDragModeRef.current = 'resize-bl';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.br!.x, handles.br!.y)) {
          colliderDragModeRef.current = 'resize-br';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
      }

      if (isNearPoint(pos.x, pos.y, handles.t.x, handles.t.y)) {
        colliderDragModeRef.current = 'resize-t';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.b.x, handles.b.y)) {
        colliderDragModeRef.current = 'resize-b';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.l.x, handles.l.y)) {
        colliderDragModeRef.current = 'resize-l';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.r.x, handles.r.y)) {
        colliderDragModeRef.current = 'resize-r';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }

      let insideCollider = false;
      if (coll.type === 'circle') {
        insideCollider = Math.hypot(pos.x - centerX, pos.y - centerY) <= coll.radius;
      } else {
        insideCollider = Math.abs(pos.x - centerX) <= coll.width / 2 &&
          Math.abs(pos.y - centerY) <= coll.height / 2;
      }

      if (insideCollider) {
        colliderDragModeRef.current = 'move';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const mode = colliderDragModeRef.current;
      const dragStart = colliderDragStartRef.current;
      if (mode === 'none' || !dragStart) return;

      const pos = getMousePos(event);
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      const original = dragStart.collider;
      const updated = { ...original };

      if (mode === 'move') {
        updated.offsetX = original.offsetX + dx;
        updated.offsetY = original.offsetY + dy;
      } else if (original.type === 'circle') {
        const centerX = CANVAS_SIZE / 2 + original.offsetX;
        const centerY = CANVAS_SIZE / 2 + original.offsetY;
        updated.radius = Math.max(16, Math.hypot(pos.x - centerX, pos.y - centerY));
      } else {
        if (mode === 'resize-tl') {
          updated.width = Math.max(32, original.width - dx);
          updated.height = Math.max(32, original.height - dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-tr') {
          updated.width = Math.max(32, original.width + dx);
          updated.height = Math.max(32, original.height - dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-bl') {
          updated.width = Math.max(32, original.width - dx);
          updated.height = Math.max(32, original.height + dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-br') {
          updated.width = Math.max(32, original.width + dx);
          updated.height = Math.max(32, original.height + dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-t') {
          updated.height = Math.max(32, original.height - dy);
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-b') {
          updated.height = Math.max(32, original.height + dy);
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-l') {
          updated.width = Math.max(32, original.width - dx);
          updated.offsetX = original.offsetX + dx / 2;
        } else if (mode === 'resize-r') {
          updated.width = Math.max(32, original.width + dx);
          updated.offsetX = original.offsetX + dx / 2;
        }
      }

      onColliderChangeRef.current?.(updated);
      drawCollider(updated, true);
    };

    const handleMouseUp = () => {
      colliderDragModeRef.current = 'none';
      colliderDragStartRef.current = null;
    };

    colliderCanvas.addEventListener('mousedown', handleMouseDown);
    colliderCanvas.addEventListener('mousemove', handleMouseMove);
    colliderCanvas.addEventListener('mouseup', handleMouseUp);
    colliderCanvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      colliderCanvas.removeEventListener('mousedown', handleMouseDown);
      colliderCanvas.removeEventListener('mousemove', handleMouseMove);
      colliderCanvas.removeEventListener('mouseup', handleMouseUp);
      colliderCanvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [activeTool, colliderCanvasRef, drawCollider]);

  return {
    drawCollider,
  };
}

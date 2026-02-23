import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import { floodFill, hexToRgb } from '@/utils/floodFill';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import type { DrawingTool } from './CostumeToolbar';
import type { CostumeBounds, ColliderConfig } from '@/types';

const CANVAS_SIZE = 1024;
const BASE_DISPLAY_SIZE = 480;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const HANDLE_SIZE = 16;
const ROTATION_HANDLE_OFFSET = 40;

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string) => Promise<void>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface CostumeCanvasProps {
  activeTool: DrawingTool;
  brushColor: string;
  brushSize: number;
  collider: ColliderConfig | null;
  onHistoryChange?: () => void;
  onColliderChange?: (collider: ColliderConfig) => void;
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  activeTool,
  brushColor,
  brushSize,
  collider,
  onHistoryChange,
  onColliderChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const colliderCanvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const colliderCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const displaySize = BASE_DISPLAY_SIZE * zoom;

  // Drawing state
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Selection state
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const floatingSelectionRef = useRef<{
    imageData: ImageData;
    x: number;
    y: number;
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
    rotation: number; // in radians
  } | null>(null);
  const dragModeRef = useRef<'none' | 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'rotate'>('none');
  const dragStartRef = useRef<{ x: number; y: number; selection: typeof floatingSelectionRef.current } | null>(null);

  // Collider drag state
  const colliderDragModeRef = useRef<'none' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b'>('none');
  const colliderDragStartRef = useRef<{ x: number; y: number; collider: ColliderConfig } | null>(null);

  // Shape drawing state
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);

  // History
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef(-1);

  // Stable callback refs
  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;

  const onColliderChangeRef = useRef(onColliderChange);
  onColliderChangeRef.current = onColliderChange;

  const colliderRef = useRef(collider);
  colliderRef.current = collider;

  // Get mouse position relative to canvas
  const getMousePos = useCallback((e: MouseEvent | React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  // Draw collider overlay
  const drawCollider = useCallback((coll: ColliderConfig | null, editable: boolean = false) => {
    const colliderCtx = colliderCtxRef.current;
    if (!colliderCtx) return;

    colliderCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (!coll || coll.type === 'none') return;

    // Collider is centered in the 1024 canvas space
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
        coll.height
      );
    } else if (coll.type === 'circle') {
      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, coll.radius, 0, Math.PI * 2);
      colliderCtx.stroke();
    } else if (coll.type === 'capsule') {
      // Draw capsule as rounded rectangle
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

    // Draw handles if editable
    if (editable) {
      colliderCtx.fillStyle = '#ffffff';
      colliderCtx.strokeStyle = '#22c55e';
      colliderCtx.lineWidth = 2;

      if (coll.type === 'box' || coll.type === 'capsule') {
        // Corner handles
        const corners = [
          { x: centerX - coll.width / 2, y: centerY - coll.height / 2 }, // TL
          { x: centerX + coll.width / 2, y: centerY - coll.height / 2 }, // TR
          { x: centerX - coll.width / 2, y: centerY + coll.height / 2 }, // BL
          { x: centerX + coll.width / 2, y: centerY + coll.height / 2 }, // BR
        ];
        corners.forEach(corner => {
          colliderCtx.fillRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });

        // Edge handles
        const edges = [
          { x: centerX, y: centerY - coll.height / 2 }, // T
          { x: centerX, y: centerY + coll.height / 2 }, // B
          { x: centerX - coll.width / 2, y: centerY }, // L
          { x: centerX + coll.width / 2, y: centerY }, // R
        ];
        edges.forEach(edge => {
          colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });
      } else if (coll.type === 'circle') {
        // 4 edge handles on the circle
        const edges = [
          { x: centerX, y: centerY - coll.radius }, // T
          { x: centerX, y: centerY + coll.radius }, // B
          { x: centerX - coll.radius, y: centerY }, // L
          { x: centerX + coll.radius, y: centerY }, // R
        ];
        edges.forEach(edge => {
          colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });
      }

      // Center move indicator
      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      colliderCtx.fillStyle = '#22c55e';
      colliderCtx.fill();
      colliderCtx.strokeStyle = '#ffffff';
      colliderCtx.lineWidth = 2;
      colliderCtx.stroke();
    }
  }, []);

  // Save current state to history
  const saveHistory = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Remove any redo states
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(imageData);
    historyIndexRef.current = historyRef.current.length - 1;

    // Limit history
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
      historyIndexRef.current--;
    }

    onHistoryChangeRef.current?.();
  }, []);

  // Commit floating selection back to canvas
  const commitSelection = useCallback(() => {
    const ctx = ctxRef.current;
    const overlayCtx = overlayCtxRef.current;
    const selection = floatingSelectionRef.current;
    if (!ctx || !overlayCtx || !selection) return;

    const { x, y, width, height, scaleX, scaleY, rotation, imageData } = selection;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;
    const centerX = x + scaledWidth / 2;
    const centerY = y + scaledHeight / 2;

    // Draw the transformed selection onto the main canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(imageData, 0, 0);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotation);
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(tempCanvas, -width / 2, -height / 2);
      ctx.restore();
    }

    // Clear overlay
    overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    floatingSelectionRef.current = null;
    dragModeRef.current = 'none';
    dragStartRef.current = null;

    saveHistory();
  }, [saveHistory]);

  // Draw floating selection on overlay with transform handles
  const drawFloatingSelection = useCallback(() => {
    const overlayCtx = overlayCtxRef.current;
    const selection = floatingSelectionRef.current;
    if (!overlayCtx || !selection) return;

    overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const { x, y, width, height, scaleX, scaleY, rotation, imageData } = selection;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;
    const centerX = x + scaledWidth / 2;
    const centerY = y + scaledHeight / 2;

    // Draw the transformed selection
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(imageData, 0, 0);

      overlayCtx.save();
      overlayCtx.translate(centerX, centerY);
      overlayCtx.rotate(rotation);
      overlayCtx.scale(scaleX, scaleY);
      overlayCtx.drawImage(tempCanvas, -width / 2, -height / 2);
      overlayCtx.restore();
    }

    // Draw transform box and handles
    overlayCtx.save();
    overlayCtx.translate(centerX, centerY);
    overlayCtx.rotate(rotation);

    // Selection border
    overlayCtx.strokeStyle = '#0066ff';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 6]);
    overlayCtx.strokeRect(-scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
    overlayCtx.setLineDash([]);

    // Corner handles (scale)
    overlayCtx.fillStyle = '#ffffff';
    overlayCtx.strokeStyle = '#0066ff';
    overlayCtx.lineWidth = 2;

    const corners = [
      { x: -scaledWidth / 2, y: -scaledHeight / 2 }, // TL
      { x: scaledWidth / 2, y: -scaledHeight / 2 },  // TR
      { x: -scaledWidth / 2, y: scaledHeight / 2 },  // BL
      { x: scaledWidth / 2, y: scaledHeight / 2 },   // BR
    ];

    corners.forEach(corner => {
      overlayCtx.fillRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      overlayCtx.strokeRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    });

    // Rotation handle (circle above top edge)
    const rotHandleY = -scaledHeight / 2 - ROTATION_HANDLE_OFFSET;
    overlayCtx.beginPath();
    overlayCtx.moveTo(0, -scaledHeight / 2);
    overlayCtx.lineTo(0, rotHandleY);
    overlayCtx.stroke();

    overlayCtx.beginPath();
    overlayCtx.arc(0, rotHandleY, HANDLE_SIZE / 2, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.stroke();

    overlayCtx.restore();
  }, []);

  // Initialize canvas - only runs once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const colliderCanvas = colliderCanvasRef.current;
    if (!canvas || !overlayCanvas || !colliderCanvas) return;

    // Skip if already initialized
    if (ctxRef.current) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCtx = overlayCanvas.getContext('2d');
    const colliderCtx = colliderCanvas.getContext('2d');
    if (!ctx || !overlayCtx || !colliderCtx) return;

    ctxRef.current = ctx;
    overlayCtxRef.current = overlayCtx;
    colliderCtxRef.current = colliderCtx;

    // Initialize with transparent background
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Save initial state
    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    historyRef.current = [imageData];
    historyIndexRef.current = 0;
    onHistoryChangeRef.current?.();
  }, []);

  // Handle mouse events
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = ctxRef.current;
    const overlayCtx = overlayCtxRef.current;
    if (!canvas || !overlayCanvas || !ctx || !overlayCtx) return;

    // Helper to check if point is near a position (for hit testing handles)
    const isNearPoint = (px: number, py: number, targetX: number, targetY: number, threshold: number = HANDLE_SIZE) => {
      return Math.abs(px - targetX) <= threshold && Math.abs(py - targetY) <= threshold;
    };

    // Get handle positions for current selection (in canvas coordinates)
    const getHandlePositions = (selection: NonNullable<typeof floatingSelectionRef.current>) => {
      const { x, y, width, height, scaleX, scaleY, rotation } = selection;
      const scaledWidth = width * scaleX;
      const scaledHeight = height * scaleY;
      const centerX = x + scaledWidth / 2;
      const centerY = y + scaledHeight / 2;

      // Transform local coords to canvas coords
      const transform = (lx: number, ly: number) => {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
          x: centerX + lx * cos - ly * sin,
          y: centerY + lx * sin + ly * cos,
        };
      };

      return {
        tl: transform(-scaledWidth / 2, -scaledHeight / 2),
        tr: transform(scaledWidth / 2, -scaledHeight / 2),
        bl: transform(-scaledWidth / 2, scaledHeight / 2),
        br: transform(scaledWidth / 2, scaledHeight / 2),
        rotate: transform(0, -scaledHeight / 2 - ROTATION_HANDLE_OFFSET),
        center: { x: centerX, y: centerY },
      };
    };

    // Check if point is inside the transformed selection box
    const isInsideSelection = (px: number, py: number, selection: NonNullable<typeof floatingSelectionRef.current>) => {
      const { x, y, width, height, scaleX, scaleY, rotation } = selection;
      const scaledWidth = width * scaleX;
      const scaledHeight = height * scaleY;
      const centerX = x + scaledWidth / 2;
      const centerY = y + scaledHeight / 2;

      // Transform point to local coordinates
      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const dx = px - centerX;
      const dy = py - centerY;
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;

      return Math.abs(localX) <= scaledWidth / 2 && Math.abs(localY) <= scaledHeight / 2;
    };

    const handleMouseDown = (e: MouseEvent) => {
      const pos = getMousePos(e);

      if (activeTool === 'select') {
        const selection = floatingSelectionRef.current;

        if (selection) {
          const handles = getHandlePositions(selection);

          // Check rotation handle
          if (isNearPoint(pos.x, pos.y, handles.rotate.x, handles.rotate.y)) {
            dragModeRef.current = 'rotate';
            dragStartRef.current = { x: pos.x, y: pos.y, selection: { ...selection } };
            return;
          }

          // Check corner handles (scale)
          if (isNearPoint(pos.x, pos.y, handles.tl.x, handles.tl.y)) {
            dragModeRef.current = 'scale-tl';
            dragStartRef.current = { x: pos.x, y: pos.y, selection: { ...selection } };
            return;
          }
          if (isNearPoint(pos.x, pos.y, handles.tr.x, handles.tr.y)) {
            dragModeRef.current = 'scale-tr';
            dragStartRef.current = { x: pos.x, y: pos.y, selection: { ...selection } };
            return;
          }
          if (isNearPoint(pos.x, pos.y, handles.bl.x, handles.bl.y)) {
            dragModeRef.current = 'scale-bl';
            dragStartRef.current = { x: pos.x, y: pos.y, selection: { ...selection } };
            return;
          }
          if (isNearPoint(pos.x, pos.y, handles.br.x, handles.br.y)) {
            dragModeRef.current = 'scale-br';
            dragStartRef.current = { x: pos.x, y: pos.y, selection: { ...selection } };
            return;
          }

          // Check if inside selection (move)
          if (isInsideSelection(pos.x, pos.y, selection)) {
            dragModeRef.current = 'move';
            dragStartRef.current = { x: pos.x, y: pos.y, selection: { ...selection } };
            return;
          }

          // Clicking outside - commit selection
          commitSelection();
        }

        // Start new selection
        selectionStartRef.current = pos;
        return;
      }

      if (activeTool === 'collider') {
        const coll = colliderRef.current;
        if (!coll || coll.type === 'none') return;

        const centerX = CANVAS_SIZE / 2 + coll.offsetX;
        const centerY = CANVAS_SIZE / 2 + coll.offsetY;

        // Get collider handle positions based on type
        const getColliderHandles = () => {
          if (coll.type === 'circle') {
            return {
              t: { x: centerX, y: centerY - coll.radius },
              b: { x: centerX, y: centerY + coll.radius },
              l: { x: centerX - coll.radius, y: centerY },
              r: { x: centerX + coll.radius, y: centerY },
            };
          } else {
            // box or capsule
            return {
              tl: { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
              tr: { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
              bl: { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
              br: { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
              t: { x: centerX, y: centerY - coll.height / 2 },
              b: { x: centerX, y: centerY + coll.height / 2 },
              l: { x: centerX - coll.width / 2, y: centerY },
              r: { x: centerX + coll.width / 2, y: centerY },
            };
          }
        };

        const handles = getColliderHandles();

        // Check handle hits for box/capsule
        if (coll.type === 'box' || coll.type === 'capsule') {
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

        // Check edge handles (all types)
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

        // Check if inside collider (move)
        let insideCollider = false;
        if (coll.type === 'circle') {
          const dist = Math.sqrt(Math.pow(pos.x - centerX, 2) + Math.pow(pos.y - centerY, 2));
          insideCollider = dist <= coll.radius;
        } else {
          insideCollider = Math.abs(pos.x - centerX) <= coll.width / 2 &&
                          Math.abs(pos.y - centerY) <= coll.height / 2;
        }

        if (insideCollider) {
          colliderDragModeRef.current = 'move';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }

        return;
      }

      if (activeTool === 'fill') {
        // Flood fill
        const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const fillColor = hexToRgb(brushColor);
        floodFill(imageData, Math.floor(pos.x), Math.floor(pos.y), fillColor, 32);
        ctx.putImageData(imageData, 0, 0);
        saveHistory();
        return;
      }

      if (activeTool === 'circle' || activeTool === 'rectangle' || activeTool === 'line') {
        shapeStartRef.current = pos;
        return;
      }

      // Brush or eraser
      isDrawingRef.current = true;
      lastPosRef.current = pos;

      // Start a new path
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = activeTool === 'eraser' ? '#000000' : brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (activeTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.stroke();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getMousePos(e);

      if (activeTool === 'select') {
        const selection = floatingSelectionRef.current;
        const dragStart = dragStartRef.current;
        const dragMode = dragModeRef.current;

        // Handle transform operations
        if (selection && dragStart && dragMode !== 'none') {
          const origSel = dragStart.selection!;
          const origScaledW = origSel.width * origSel.scaleX;
          const origScaledH = origSel.height * origSel.scaleY;
          const origCenterX = origSel.x + origScaledW / 2;
          const origCenterY = origSel.y + origScaledH / 2;

          if (dragMode === 'move') {
            const dx = pos.x - dragStart.x;
            const dy = pos.y - dragStart.y;
            selection.x = origSel.x + dx;
            selection.y = origSel.y + dy;
          } else if (dragMode === 'rotate') {
            const startAngle = Math.atan2(dragStart.y - origCenterY, dragStart.x - origCenterX);
            const currentAngle = Math.atan2(pos.y - origCenterY, pos.x - origCenterX);
            selection.rotation = origSel.rotation + (currentAngle - startAngle);
          } else if (dragMode.startsWith('scale-')) {
            // Calculate scale based on distance from center
            const origDist = Math.sqrt(
              Math.pow(dragStart.x - origCenterX, 2) + Math.pow(dragStart.y - origCenterY, 2)
            );
            const newDist = Math.sqrt(
              Math.pow(pos.x - origCenterX, 2) + Math.pow(pos.y - origCenterY, 2)
            );
            const scaleFactor = origDist > 0 ? newDist / origDist : 1;

            selection.scaleX = Math.max(0.1, origSel.scaleX * scaleFactor);
            selection.scaleY = Math.max(0.1, origSel.scaleY * scaleFactor);

            // Recalculate position to keep center stable
            const newScaledW = selection.width * selection.scaleX;
            const newScaledH = selection.height * selection.scaleY;
            selection.x = origCenterX - newScaledW / 2;
            selection.y = origCenterY - newScaledH / 2;
          }

          drawFloatingSelection();
          return;
        }

        // Drawing selection box
        if (selectionStartRef.current) {
          const start = selectionStartRef.current;
          overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

          // Draw selection rectangle
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const w = Math.abs(pos.x - start.x);
          const h = Math.abs(pos.y - start.y);

          overlayCtx.fillStyle = 'rgba(0, 102, 255, 0.1)';
          overlayCtx.fillRect(x, y, w, h);
          overlayCtx.strokeStyle = '#0066ff';
          overlayCtx.lineWidth = 2;
          overlayCtx.setLineDash([6, 6]);
          overlayCtx.strokeRect(x, y, w, h);
          overlayCtx.setLineDash([]);
          return;
        }
        return;
      }

      if (activeTool === 'collider') {
        const dragMode = colliderDragModeRef.current;
        const dragStart = colliderDragStartRef.current;

        if (dragMode !== 'none' && dragStart) {
          const origColl = dragStart.collider;
          const dx = pos.x - dragStart.x;
          const dy = pos.y - dragStart.y;

          const newCollider = { ...origColl };

          if (dragMode === 'move') {
            newCollider.offsetX = origColl.offsetX + dx;
            newCollider.offsetY = origColl.offsetY + dy;
          } else if (origColl.type === 'circle') {
            // For circle, resize handles adjust radius
            const centerX = CANVAS_SIZE / 2 + origColl.offsetX;
            const centerY = CANVAS_SIZE / 2 + origColl.offsetY;
            const newRadius = Math.max(16, Math.sqrt(Math.pow(pos.x - centerX, 2) + Math.pow(pos.y - centerY, 2)));
            newCollider.radius = newRadius;
          } else {
            // For box/capsule
            if (dragMode === 'resize-tl') {
              const newW = Math.max(32, origColl.width - dx);
              const newH = Math.max(32, origColl.height - dy);
              newCollider.width = newW;
              newCollider.height = newH;
              newCollider.offsetX = origColl.offsetX + dx / 2;
              newCollider.offsetY = origColl.offsetY + dy / 2;
            } else if (dragMode === 'resize-tr') {
              const newW = Math.max(32, origColl.width + dx);
              const newH = Math.max(32, origColl.height - dy);
              newCollider.width = newW;
              newCollider.height = newH;
              newCollider.offsetX = origColl.offsetX + dx / 2;
              newCollider.offsetY = origColl.offsetY + dy / 2;
            } else if (dragMode === 'resize-bl') {
              const newW = Math.max(32, origColl.width - dx);
              const newH = Math.max(32, origColl.height + dy);
              newCollider.width = newW;
              newCollider.height = newH;
              newCollider.offsetX = origColl.offsetX + dx / 2;
              newCollider.offsetY = origColl.offsetY + dy / 2;
            } else if (dragMode === 'resize-br') {
              const newW = Math.max(32, origColl.width + dx);
              const newH = Math.max(32, origColl.height + dy);
              newCollider.width = newW;
              newCollider.height = newH;
              newCollider.offsetX = origColl.offsetX + dx / 2;
              newCollider.offsetY = origColl.offsetY + dy / 2;
            } else if (dragMode === 'resize-t') {
              const newH = Math.max(32, origColl.height - dy);
              newCollider.height = newH;
              newCollider.offsetY = origColl.offsetY + dy / 2;
            } else if (dragMode === 'resize-b') {
              const newH = Math.max(32, origColl.height + dy);
              newCollider.height = newH;
              newCollider.offsetY = origColl.offsetY + dy / 2;
            } else if (dragMode === 'resize-l') {
              const newW = Math.max(32, origColl.width - dx);
              newCollider.width = newW;
              newCollider.offsetX = origColl.offsetX + dx / 2;
            } else if (dragMode === 'resize-r') {
              const newW = Math.max(32, origColl.width + dx);
              newCollider.width = newW;
              newCollider.offsetX = origColl.offsetX + dx / 2;
            }
          }

          onColliderChangeRef.current?.(newCollider);
          drawCollider(newCollider, true);
        }
        return;
      }

      // Shape preview
      if (shapeStartRef.current && (activeTool === 'circle' || activeTool === 'rectangle' || activeTool === 'line')) {
        const start = shapeStartRef.current;
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        overlayCtx.strokeStyle = brushColor;
        overlayCtx.fillStyle = brushColor;
        overlayCtx.lineWidth = brushSize;

        if (activeTool === 'rectangle') {
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const w = Math.abs(pos.x - start.x);
          const h = Math.abs(pos.y - start.y);
          overlayCtx.fillRect(x, y, w, h);
        } else if (activeTool === 'circle') {
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const w = Math.abs(pos.x - start.x);
          const h = Math.abs(pos.y - start.y);
          overlayCtx.beginPath();
          overlayCtx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          overlayCtx.fill();
        } else if (activeTool === 'line') {
          overlayCtx.beginPath();
          overlayCtx.moveTo(start.x, start.y);
          overlayCtx.lineTo(pos.x, pos.y);
          overlayCtx.stroke();
        }
        return;
      }

      // Drawing
      if (!isDrawingRef.current || !lastPosRef.current) return;

      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = activeTool === 'eraser' ? '#000000' : brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (activeTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.stroke();
      lastPosRef.current = pos;
    };

    const handleMouseUp = (e: MouseEvent) => {
      const pos = getMousePos(e);

      if (activeTool === 'select') {
        // End transform operation
        if (dragModeRef.current !== 'none') {
          dragModeRef.current = 'none';
          dragStartRef.current = null;
          return;
        }

        // End selection box drawing
        if (selectionStartRef.current) {
          const start = selectionStartRef.current;
          const x = Math.floor(Math.min(start.x, pos.x));
          const y = Math.floor(Math.min(start.y, pos.y));
          const w = Math.floor(Math.abs(pos.x - start.x));
          const h = Math.floor(Math.abs(pos.y - start.y));

          selectionStartRef.current = null;
          overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

          if (w >= 2 && h >= 2) {
            // Save history BEFORE cutting - so undo restores the original state
            saveHistory();

            // Cut pixels from main canvas
            const imageData = ctx.getImageData(x, y, w, h);

            // Clear the area on main canvas
            ctx.clearRect(x, y, w, h);

            // Create floating selection
            floatingSelectionRef.current = {
              imageData,
              x,
              y,
              width: w,
              height: h,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
            };

            drawFloatingSelection();
            // Don't save history here - will save when committed
          }
          return;
        }
        return;
      }

      if (activeTool === 'collider') {
        // End collider drag operation
        if (colliderDragModeRef.current !== 'none') {
          colliderDragModeRef.current = 'none';
          colliderDragStartRef.current = null;
        }
        return;
      }

      // End shape drawing
      if (shapeStartRef.current && (activeTool === 'circle' || activeTool === 'rectangle' || activeTool === 'line')) {
        const start = shapeStartRef.current;
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        ctx.strokeStyle = brushColor;
        ctx.fillStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.globalCompositeOperation = 'source-over';

        if (activeTool === 'rectangle') {
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const w = Math.abs(pos.x - start.x);
          const h = Math.abs(pos.y - start.y);
          ctx.fillRect(x, y, w, h);
        } else if (activeTool === 'circle') {
          const x = Math.min(start.x, pos.x);
          const y = Math.min(start.y, pos.y);
          const w = Math.abs(pos.x - start.x);
          const h = Math.abs(pos.y - start.y);
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (activeTool === 'line') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
        }

        shapeStartRef.current = null;
        saveHistory();
        return;
      }

      // End drawing
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        lastPosRef.current = null;
        ctx.globalCompositeOperation = 'source-over';
        saveHistory();
      }
    };

    const handleMouseLeave = () => {
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        lastPosRef.current = null;
        ctx.globalCompositeOperation = 'source-over';
        saveHistory();
      }
    };

    const colliderCanvas = colliderCanvasRef.current;

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    overlayCanvas.addEventListener('mousedown', handleMouseDown);
    overlayCanvas.addEventListener('mousemove', handleMouseMove);
    overlayCanvas.addEventListener('mouseup', handleMouseUp);
    overlayCanvas.addEventListener('mouseleave', handleMouseLeave);

    if (colliderCanvas) {
      colliderCanvas.addEventListener('mousedown', handleMouseDown);
      colliderCanvas.addEventListener('mousemove', handleMouseMove);
      colliderCanvas.addEventListener('mouseup', handleMouseUp);
      colliderCanvas.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      overlayCanvas.removeEventListener('mousedown', handleMouseDown);
      overlayCanvas.removeEventListener('mousemove', handleMouseMove);
      overlayCanvas.removeEventListener('mouseup', handleMouseUp);
      overlayCanvas.removeEventListener('mouseleave', handleMouseLeave);

      if (colliderCanvas) {
        colliderCanvas.removeEventListener('mousedown', handleMouseDown);
        colliderCanvas.removeEventListener('mousemove', handleMouseMove);
        colliderCanvas.removeEventListener('mouseup', handleMouseUp);
        colliderCanvas.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [activeTool, brushColor, brushSize, getMousePos, saveHistory, commitSelection, drawFloatingSelection, drawCollider]);

  // Commit selection when tool changes away from select
  useEffect(() => {
    if (activeTool !== 'select' && floatingSelectionRef.current) {
      commitSelection();
    }
  }, [activeTool, commitSelection]);

  // Draw collider when it changes or tool changes
  useEffect(() => {
    drawCollider(collider, activeTool === 'collider');
  }, [collider, activeTool, drawCollider]);

  // Update cursor based on tool
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const colliderCanvas = colliderCanvasRef.current;
    if (!canvas || !overlayCanvas || !colliderCanvas) return;

    let cursor = 'default';
    if (activeTool === 'brush' || activeTool === 'eraser') {
      cursor = 'crosshair';
    } else if (activeTool === 'fill') {
      cursor = 'crosshair';
    } else if (activeTool === 'select') {
      cursor = 'crosshair';
    } else if (activeTool === 'circle' || activeTool === 'rectangle' || activeTool === 'line') {
      cursor = 'crosshair';
    } else if (activeTool === 'collider') {
      cursor = 'move';
    }

    canvas.style.cursor = cursor;
    overlayCanvas.style.cursor = cursor;
    colliderCanvas.style.cursor = cursor;
  }, [activeTool]);

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(prev => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
  }, []);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    toDataURL: () => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx) return '';

      // If there's a floating selection, composite it WITHOUT committing
      const selection = floatingSelectionRef.current;
      if (selection) {
        const { x, y, width, height, scaleX, scaleY, rotation, imageData } = selection;
        const scaledWidth = width * scaleX;
        const scaledHeight = height * scaleY;
        const centerX = x + scaledWidth / 2;
        const centerY = y + scaledHeight / 2;

        // Create temp canvas to composite
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = CANVAS_SIZE;
        tempCanvas.height = CANVAS_SIZE;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          // Draw main canvas
          tempCtx.drawImage(canvas, 0, 0);

          // Draw floating selection with transform
          const selCanvas = document.createElement('canvas');
          selCanvas.width = width;
          selCanvas.height = height;
          const selCtx = selCanvas.getContext('2d');
          if (selCtx) {
            selCtx.putImageData(imageData, 0, 0);
            tempCtx.save();
            tempCtx.translate(centerX, centerY);
            tempCtx.rotate(rotation);
            tempCtx.scale(scaleX, scaleY);
            tempCtx.drawImage(selCanvas, -width / 2, -height / 2);
            tempCtx.restore();
          }

          return tempCanvas.toDataURL('image/webp', 0.85);
        }
      }

      return canvas.toDataURL('image/webp', 0.85);
    },

    toDataURLWithBounds: () => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx) return { dataUrl: '', bounds: null };

      // If there's a floating selection, composite it WITHOUT committing
      const selection = floatingSelectionRef.current;
      let targetCanvas = canvas;

      if (selection) {
        const { x, y, width, height, scaleX, scaleY, rotation, imageData } = selection;
        const scaledWidth = width * scaleX;
        const scaledHeight = height * scaleY;
        const centerX = x + scaledWidth / 2;
        const centerY = y + scaledHeight / 2;

        // Create temp canvas to composite
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = CANVAS_SIZE;
        tempCanvas.height = CANVAS_SIZE;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          // Draw main canvas
          tempCtx.drawImage(canvas, 0, 0);

          // Draw floating selection with transform
          const selCanvas = document.createElement('canvas');
          selCanvas.width = width;
          selCanvas.height = height;
          const selCtx = selCanvas.getContext('2d');
          if (selCtx) {
            selCtx.putImageData(imageData, 0, 0);
            tempCtx.save();
            tempCtx.translate(centerX, centerY);
            tempCtx.rotate(rotation);
            tempCtx.scale(scaleX, scaleY);
            tempCtx.drawImage(selCanvas, -width / 2, -height / 2);
            tempCtx.restore();
          }
          targetCanvas = tempCanvas;
        }
      }

      const dataUrl = targetCanvas.toDataURL('image/webp', 0.85);
      const bounds = calculateBoundsFromCanvas(targetCanvas);

      return { dataUrl, bounds };
    },

    loadFromDataURL: async (dataUrl: string) => {
      const ctx = ctxRef.current;
      const overlayCtx = overlayCtxRef.current;
      if (!ctx || !overlayCtx) return;

      // Clear floating selection
      floatingSelectionRef.current = null;
      overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Clear canvas
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (dataUrl) {
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = dataUrl;
          });

          // Draw centered if smaller, scaled to fit if larger
          const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height, 1);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (CANVAS_SIZE - w) / 2;
          const y = (CANVAS_SIZE - h) / 2;
          ctx.drawImage(img, x, y, w, h);
        } catch (error) {
          console.error('Failed to load image:', error);
        }
      }

      // Reset history
      historyRef.current = [];
      historyIndexRef.current = -1;
      saveHistory();
    },

    clear: () => {
      const ctx = ctxRef.current;
      const overlayCtx = overlayCtxRef.current;
      if (!ctx || !overlayCtx) return;

      floatingSelectionRef.current = null;
      overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      saveHistory();
    },

    undo: () => {
      const ctx = ctxRef.current;
      if (!ctx || historyIndexRef.current <= 0) return;

      historyIndexRef.current--;
      const imageData = historyRef.current[historyIndexRef.current];
      ctx.putImageData(imageData, 0, 0);
      onHistoryChangeRef.current?.();
    },

    redo: () => {
      const ctx = ctxRef.current;
      if (!ctx || historyIndexRef.current >= historyRef.current.length - 1) return;

      historyIndexRef.current++;
      const imageData = historyRef.current[historyIndexRef.current];
      ctx.putImageData(imageData, 0, 0);
      onHistoryChangeRef.current?.();
    },

    canUndo: () => historyIndexRef.current > 0,
    canRedo: () => historyIndexRef.current < historyRef.current.length - 1,
  }), [saveHistory, commitSelection]);

  // Checkerboard pattern for transparency visualization
  const checkerboardStyle = {
    backgroundImage: `
      linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
      linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
      linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)
    `,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
    backgroundColor: '#f5f5f5',
  };

  return (
    <div className="flex-1 overflow-hidden bg-muted/50 flex flex-col">
      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-2 py-2 border-b bg-background/50">
        <button
          onClick={() => setZoom(prev => Math.max(MIN_ZOOM, prev - ZOOM_STEP))}
          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
          disabled={zoom <= MIN_ZOOM}
        >
          -
        </button>
        <span className="text-xs text-muted-foreground w-16 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(prev => Math.min(MAX_ZOOM, prev + ZOOM_STEP))}
          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
          disabled={zoom >= MAX_ZOOM}
        >
          +
        </button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded ml-2"
        >
          Reset
        </button>
      </div>

      {/* Scrollable canvas container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex items-center justify-center p-4"
        onWheel={handleWheel}
      >
        <div
          className="border shadow-sm relative overflow-hidden flex-shrink-0"
          style={{
            width: displaySize,
            height: displaySize,
            ...checkerboardStyle,
          }}
        >
          {/* Main canvas */}
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: displaySize,
              height: displaySize,
            }}
          />
          {/* Overlay canvas for selection/preview */}
          <canvas
            ref={overlayCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: displaySize,
              height: displaySize,
              pointerEvents: activeTool === 'collider' ? 'none' : 'auto',
            }}
          />
          {/* Collider overlay canvas */}
          <canvas
            ref={colliderCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: displaySize,
              height: displaySize,
              pointerEvents: activeTool === 'collider' ? 'auto' : 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
});

CostumeCanvas.displayName = 'CostumeCanvas';

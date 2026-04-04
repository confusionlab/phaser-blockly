import { useCallback, type MutableRefObject } from 'react';
import { Control, Point, type Canvas as FabricCanvas } from 'fabric';
import {
  pathNodeHandleTypeToVectorHandleMode,
  type VectorHandleMode,
  type VectorPathNodeHandleType,
} from './CostumeToolbar';
import {
  BASE_VIEW_SCALE,
  CIRCLE_CUBIC_KAPPA,
  VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX,
  VECTOR_POINT_INSERTION_HIT_RADIUS_PX,
  VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX,
  VECTOR_POINT_SELECTION_HIT_PADDING,
  VECTOR_POINT_SELECTION_MIN_SIZE,
  mirrorPointAcrossAnchor,
  normalizeRadians,
  type MirroredPathAnchorDragSession,
  type MirroredPathAnchorHandleRole,
  type PathAnchorDragState,
  type PointSelectionMarqueeSession,
  type PointSelectionTransformBounds,
  type PointSelectionTransformFrameState,
  type PointSelectionTransformMode,
  type PointSelectionTransformSession,
  type PointSelectionTransformSnapshot,
  type SelectedPathAnchorTransformSnapshot,
} from './costumeCanvasShared';
import { applyCanvasCursor } from './costumeCanvasBitmapRuntime';
import { getFabricObjectType } from './costumeCanvasVectorRuntime';
import {
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  type TransformGizmoCorner,
  type TransformGizmoCornerTarget,
  computeCornerScaleResult,
  getTransformGizmoCornerFromTarget,
  getTransformGizmoCursorForCornerTarget,
  getTransformGizmoHandleFrame,
  hitTransformGizmoCornerTarget,
  rotateTransformPoint,
} from '@/lib/editor/unifiedTransformGizmo';

interface UseCostumeCanvasVectorPathControllerOptions {
  activePathAnchorRef: MutableRefObject<{ path: any; anchorIndex: number } | null>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getZoomInvariantMetric: (value: number, zoom?: number) => number;
  onVectorHandleModeSyncRef: MutableRefObject<((handleMode: VectorHandleMode) => void) | undefined>;
  onVectorPointSelectionChangeRef: MutableRefObject<((hasSelectedPoints: boolean) => void) | undefined>;
  originalControlsRef: MutableRefObject<WeakMap<object, Record<string, Control> | undefined>>;
  pendingSelectionSyncedVectorHandleModeRef: MutableRefObject<VectorHandleMode | null>;
  pointSelectionTransformFrameRef: MutableRefObject<PointSelectionTransformFrameState | null>;
  pointSelectionTransformSessionRef: MutableRefObject<PointSelectionTransformSession | null>;
  selectedPathAnchorIndicesRef: MutableRefObject<number[]>;
  vectorPointEditingTargetRef: MutableRefObject<any | null>;
  zoomRef: MutableRefObject<number>;
}

export function useCostumeCanvasVectorPathController({
  activePathAnchorRef,
  fabricCanvasRef,
  getZoomInvariantMetric,
  onVectorHandleModeSyncRef,
  onVectorPointSelectionChangeRef,
  originalControlsRef,
  pendingSelectionSyncedVectorHandleModeRef,
  pointSelectionTransformFrameRef,
  pointSelectionTransformSessionRef,
  selectedPathAnchorIndicesRef,
  vectorPointEditingTargetRef,
  zoomRef,
}: UseCostumeCanvasVectorPathControllerOptions) {
  const restoreOriginalControls = useCallback((obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    const original = originalControlsRef.current.get(obj);
    if (original) {
      obj.controls = original;
      originalControlsRef.current.delete(obj);
    }
    obj.setCoords?.();
  }, [originalControlsRef]);

  const restoreAllOriginalControls = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    fabricCanvas.forEachObject((obj: any) => restoreOriginalControls(obj));
  }, [fabricCanvasRef, restoreOriginalControls]);

  const toCanvasPoint = useCallback((obj: any, x: number, y: number) => {
    const matrix = typeof obj?.calcTransformMatrix === 'function' ? obj.calcTransformMatrix() : null;
    if (!matrix) return new Point(x, y);
    return new Point(x, y).transform(matrix);
  }, []);

  const isNearlyEqual = useCallback((a: number, b: number) => Math.abs(a - b) <= 0.0001, []);

  const getPathCommands = useCallback((pathObj: any) => {
    if (!pathObj || !Array.isArray(pathObj.path)) return [] as any[];
    return pathObj.path as any[];
  }, []);

  const getCommandType = useCallback((command: any): string => {
    if (!Array.isArray(command) || typeof command[0] !== 'string') return '';
    return command[0].toUpperCase();
  }, []);

  const getCommandEndpoint = useCallback((command: any): Point | null => {
    if (!Array.isArray(command) || command.length < 3) return null;
    const x = Number(command[command.length - 2]);
    const y = Number(command[command.length - 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return new Point(x, y);
  }, []);

  const getLastDrawableCommandIndex = useCallback((pathObj: any): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commands.length - 1; i >= 0; i -= 1) {
      if (getCommandType(commands[i]) !== 'Z') {
        return i;
      }
    }
    return -1;
  }, [getCommandType, getPathCommands]);

  const isClosedPath = useCallback((pathObj: any): boolean => {
    const commands = getPathCommands(pathObj);
    if (commands.length === 0) return false;
    if (commands.some((command) => getCommandType(command) === 'Z')) return true;
    const start = getCommandEndpoint(commands[0]);
    const lastIndex = getLastDrawableCommandIndex(pathObj);
    const end = lastIndex >= 0 ? getCommandEndpoint(commands[lastIndex]) : null;
    if (!start || !end) return false;
    return isNearlyEqual(start.x, end.x) && isNearlyEqual(start.y, end.y);
  }, [getCommandEndpoint, getCommandType, getLastDrawableCommandIndex, getPathCommands, isNearlyEqual]);

  const normalizeAnchorIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    if (anchorIndex <= 0) return 0;
    const commands = getPathCommands(pathObj);
    if (!commands[anchorIndex]) return anchorIndex;
    if (!isClosedPath(pathObj)) return anchorIndex;
    const lastDrawable = getLastDrawableCommandIndex(pathObj);
    if (anchorIndex !== lastDrawable) return anchorIndex;
    const start = getCommandEndpoint(commands[0]);
    const end = getCommandEndpoint(commands[anchorIndex]);
    if (!start || !end) return anchorIndex;
    if (isNearlyEqual(start.x, end.x) && isNearlyEqual(start.y, end.y)) {
      return 0;
    }
    return anchorIndex;
  }, [getCommandEndpoint, getLastDrawableCommandIndex, getPathCommands, isClosedPath, isNearlyEqual]);

  const getPathNodeHandleTypes = useCallback((pathObj: any): Record<string, VectorPathNodeHandleType> => {
    const raw = pathObj?.nodeHandleTypes;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, VectorPathNodeHandleType> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === 'linear' || value === 'corner' || value === 'smooth' || value === 'symmetric') {
        out[key] = value;
      }
    }
    return out;
  }, []);

  const setPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number, type: VectorPathNodeHandleType) => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const next = getPathNodeHandleTypes(pathObj);
    next[String(normalized)] = type;
    pathObj.set?.('nodeHandleTypes', next);
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const getPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number): VectorPathNodeHandleType | null => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const map = getPathNodeHandleTypes(pathObj);
    return map[String(normalized)] ?? null;
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const findPreviousDrawableCommandIndex = useCallback((pathObj: any, commandIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commandIndex - 1; i >= 0; i -= 1) {
      if (getCommandType(commands[i]) !== 'Z') return i;
    }
    if (isClosedPath(pathObj)) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        if (getCommandType(commands[i]) !== 'Z') return i;
      }
    }
    return 0;
  }, [getCommandType, getPathCommands, isClosedPath]);

  const findNextDrawableCommandIndex = useCallback((pathObj: any, commandIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commandIndex + 1; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'Z') return i;
    }
    if (isClosedPath(pathObj)) {
      for (let i = 0; i < commands.length; i += 1) {
        if (getCommandType(commands[i]) !== 'Z') return i;
      }
    }
    return commandIndex;
  }, [getCommandType, getPathCommands, isClosedPath]);

  const getAnchorPointForIndex = useCallback((pathObj: any, anchorIndex: number): Point | null => {
    const commands = getPathCommands(pathObj);
    if (!commands[anchorIndex]) return null;
    return getCommandEndpoint(commands[anchorIndex]);
  }, [getCommandEndpoint, getPathCommands]);

  const findIncomingCubicCommandIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    const commands = getPathCommands(pathObj);
    let found = -1;
    for (let i = 0; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'C') continue;
      const normalized = normalizeAnchorIndex(pathObj, i);
      if (normalized === anchorIndex) {
        found = i;
      }
    }
    return found;
  }, [getCommandType, getPathCommands, normalizeAnchorIndex]);

  const findOutgoingCubicCommandIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = 0; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'C') continue;
      const previousIndex = findPreviousDrawableCommandIndex(pathObj, i);
      const normalizedPrevious = normalizeAnchorIndex(pathObj, previousIndex);
      if (normalizedPrevious === anchorIndex) {
        return i;
      }
    }
    return -1;
  }, [findPreviousDrawableCommandIndex, getCommandType, getPathCommands, normalizeAnchorIndex]);

  const parsePathControlKey = useCallback((key: string): { commandIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null => {
    const cp1 = /^c_(\d+)_C_CP_1$/i.exec(key);
    if (cp1) return { commandIndex: Number(cp1[1]), changed: 'outgoing' };
    const cp2 = /^c_(\d+)_C_CP_2$/i.exec(key);
    if (cp2) return { commandIndex: Number(cp2[1]), changed: 'incoming' };
    const anchor = /^c_(\d+)_/i.exec(key);
    if (anchor) return { commandIndex: Number(anchor[1]), changed: 'anchor' };
    return null;
  }, []);

  const resolveAnchorFromPathControlKey = useCallback((pathObj: any, key: string): { anchorIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null => {
    const parsed = parsePathControlKey(key);
    if (!parsed) return null;
    if (parsed.changed === 'incoming' || parsed.changed === 'anchor') {
      return {
        anchorIndex: normalizeAnchorIndex(pathObj, parsed.commandIndex),
        changed: parsed.changed,
      };
    }
    const previousIndex = findPreviousDrawableCommandIndex(pathObj, parsed.commandIndex);
    return {
      anchorIndex: normalizeAnchorIndex(pathObj, previousIndex),
      changed: 'outgoing',
    };
  }, [findPreviousDrawableCommandIndex, normalizeAnchorIndex, parsePathControlKey]);

  const isPointSelectionToggleModifierPressed = useCallback((eventData: any) => {
    const source = eventData?.e ?? eventData;
    return !!source?.shiftKey;
  }, []);

  const isPathCurveDragModifierPressed = useCallback((eventData: any) => {
    const source = eventData?.e ?? eventData;
    return !!(source?.metaKey || source?.ctrlKey);
  }, []);

  const getSelectedPathAnchorIndices = useCallback((pathObj: any): number[] => {
    if (!pathObj || pathObj !== vectorPointEditingTargetRef.current) {
      return [];
    }

    return Array.from(
      new Set(
        selectedPathAnchorIndicesRef.current
          .map((anchorIndex) => normalizeAnchorIndex(pathObj, anchorIndex))
          .filter((anchorIndex) => Number.isFinite(anchorIndex)),
      ),
    ).sort((a, b) => a - b);
  }, [normalizeAnchorIndex, selectedPathAnchorIndicesRef, vectorPointEditingTargetRef]);

  const getSelectablePathAnchorIndices = useCallback((pathObj: any): number[] => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return [];

    const commands = getPathCommands(pathObj);
    const seen = new Set<number>();
    const anchorIndices: number[] = [];
    commands.forEach((command, commandIndex) => {
      if (getCommandType(command) === 'Z') return;
      if (!getCommandEndpoint(command)) return;
      const normalizedAnchorIndex = normalizeAnchorIndex(pathObj, commandIndex);
      if (seen.has(normalizedAnchorIndex)) return;
      seen.add(normalizedAnchorIndex);
      anchorIndices.push(normalizedAnchorIndex);
    });

    return anchorIndices.sort((a, b) => a - b);
  }, [getCommandEndpoint, getCommandType, getPathCommands, normalizeAnchorIndex]);

  const getSceneRectFromPoints = useCallback((startPoint: Point, endPoint: Point) => {
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const right = Math.max(startPoint.x, endPoint.x);
    const bottom = Math.max(startPoint.y, endPoint.y);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }, []);

  const getPointSelectionKey = useCallback((anchorIndices: number[]) => anchorIndices.join(','), []);

  const getPointSelectionTransformAxes = useCallback((rotationRadians: number) => {
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    return {
      x: new Point(cos, sin),
      y: new Point(-sin, cos),
    };
  }, []);

  const toPointSelectionTransformLocalPoint = useCallback((bounds: PointSelectionTransformBounds, point: Point) => {
    const axes = getPointSelectionTransformAxes(bounds.rotationRadians);
    const dx = point.x - bounds.center.x;
    const dy = point.y - bounds.center.y;
    return new Point(
      dx * axes.x.x + dy * axes.x.y,
      dx * axes.y.x + dy * axes.y.y,
    );
  }, [getPointSelectionTransformAxes]);

  const createPointSelectionTransformBounds = useCallback((points: Point[], rotationRadians: number): PointSelectionTransformBounds | null => {
    if (points.length < 2) return null;

    const normalizedRotation = normalizeRadians(rotationRadians);
    const axes = getPointSelectionTransformAxes(normalizedRotation);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      const projectionX = point.x * axes.x.x + point.y * axes.x.y;
      const projectionY = point.x * axes.y.x + point.y * axes.y.y;
      minX = Math.min(minX, projectionX);
      maxX = Math.max(maxX, projectionX);
      minY = Math.min(minY, projectionY);
      maxY = Math.max(maxY, projectionY);
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const center = new Point(
      axes.x.x * ((minX + maxX) / 2) + axes.y.x * ((minY + maxY) / 2),
      axes.x.y * ((minX + maxX) / 2) + axes.y.y * ((minY + maxY) / 2),
    );

    return {
      center,
      width,
      height,
      rotationRadians: normalizedRotation,
      topLeft: new Point(
        center.x - axes.x.x * halfWidth - axes.y.x * halfHeight,
        center.y - axes.x.y * halfWidth - axes.y.y * halfHeight,
      ),
      topRight: new Point(
        center.x + axes.x.x * halfWidth - axes.y.x * halfHeight,
        center.y + axes.x.y * halfWidth - axes.y.y * halfHeight,
      ),
      bottomRight: new Point(
        center.x + axes.x.x * halfWidth + axes.y.x * halfHeight,
        center.y + axes.x.y * halfWidth + axes.y.y * halfHeight,
      ),
      bottomLeft: new Point(
        center.x - axes.x.x * halfWidth + axes.y.x * halfHeight,
        center.y - axes.x.y * halfWidth + axes.y.y * halfHeight,
      ),
    };
  }, [getPointSelectionTransformAxes]);

  const hasPointSelectionMarqueeExceededThreshold = useCallback((session: PointSelectionMarqueeSession) => {
    const threshold = getZoomInvariantMetric(VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX);
    return Math.hypot(
      session.currentPointerScene.x - session.startPointerScene.x,
      session.currentPointerScene.y - session.startPointerScene.y,
    ) >= threshold;
  }, [getZoomInvariantMetric]);

  const syncVectorHandleModeFromSelection = useCallback(() => {
    const activeAnchor = activePathAnchorRef.current;
    if (!activeAnchor || getFabricObjectType(activeAnchor.path) !== 'path') return;
    const selectedAnchorIndices = getSelectedPathAnchorIndices(activeAnchor.path);
    const targetAnchorIndices = selectedAnchorIndices.length > 0
      ? selectedAnchorIndices
      : [activeAnchor.anchorIndex];

    const handleModes = new Set<VectorHandleMode>();
    for (const anchorIndex of targetAnchorIndices) {
      handleModes.add(pathNodeHandleTypeToVectorHandleMode(
        getPathNodeHandleType(activeAnchor.path, anchorIndex) ?? 'linear',
      ));
    }

    const syncedMode = handleModes.size > 1
      ? 'multiple'
      : Array.from(handleModes)[0] ?? 'linear';
    pendingSelectionSyncedVectorHandleModeRef.current = syncedMode;
    onVectorHandleModeSyncRef.current?.(syncedMode);
  }, [
    activePathAnchorRef,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    onVectorHandleModeSyncRef,
    pendingSelectionSyncedVectorHandleModeRef,
  ]);

  const syncPathControlPointVisibility = useCallback((pathObj: any) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path' || !pathObj.controls) return;

    const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
    for (const [key, control] of Object.entries(pathObj.controls as Record<string, Control>)) {
      const resolved = resolveAnchorFromPathControlKey(pathObj, key);
      if (!resolved) continue;

      const isControlPoint = resolved.changed === 'incoming' || resolved.changed === 'outgoing';
      let visible = true;
      if (isControlPoint) {
        const handleType = getPathNodeHandleType(pathObj, resolved.anchorIndex) ?? 'linear';
        const isCurvedHandleType = handleType === 'smooth' || handleType === 'symmetric' || handleType === 'corner';
        const commandIndex = resolved.changed === 'incoming'
          ? findIncomingCubicCommandIndex(pathObj, resolved.anchorIndex)
          : findOutgoingCubicCommandIndex(pathObj, resolved.anchorIndex);
        visible = selectedAnchors.has(resolved.anchorIndex) && isCurvedHandleType && commandIndex >= 0;
      }

      if (typeof pathObj.setControlVisible === 'function') {
        pathObj.setControlVisible(key, visible);
      } else {
        (control as any).visible = visible;
      }
    }
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    resolveAnchorFromPathControlKey,
  ]);

  const syncPathAnchorSelectionAppearance = useCallback((pathObj: any) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path' || !pathObj.controls) return;

    const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
    for (const [key, control] of Object.entries(pathObj.controls as Record<string, Control>)) {
      const resolved = resolveAnchorFromPathControlKey(pathObj, key);
      if (!resolved || resolved.changed !== 'anchor') continue;

      const isSelected = selectedAnchors.has(resolved.anchorIndex);
      (control as any).controlFill = isSelected ? '#0ea5e9' : '#ffffff';
      (control as any).controlStroke = isSelected ? '#ffffff' : '#0ea5e9';
    }
  }, [getSelectedPathAnchorIndices, resolveAnchorFromPathControlKey]);

  const setSelectedPathAnchors = useCallback((pathObj: any, anchorIndices: number[], options: { primaryAnchorIndex?: number | null } = {}) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return;

    const normalized = Array.from(
      new Set(
        anchorIndices
          .map((anchorIndex) => normalizeAnchorIndex(pathObj, anchorIndex))
          .filter((anchorIndex) => Number.isFinite(anchorIndex)),
      ),
    ).sort((a, b) => a - b);

    const selectionKey = getPointSelectionKey(normalized);
    const currentTransformFrame = pointSelectionTransformFrameRef.current;
    if (normalized.length < 2) {
      pointSelectionTransformFrameRef.current = null;
    } else if (
      !currentTransformFrame ||
      currentTransformFrame.path !== pathObj ||
      currentTransformFrame.selectionKey !== selectionKey
    ) {
      pointSelectionTransformFrameRef.current = {
        path: pathObj,
        selectionKey,
        rotationRadians: 0,
      };
    }

    selectedPathAnchorIndicesRef.current = normalized;
    if (normalized.length === 0) {
      activePathAnchorRef.current = null;
      pendingSelectionSyncedVectorHandleModeRef.current = null;
    } else {
      const requestedPrimary = options.primaryAnchorIndex == null
        ? null
        : normalizeAnchorIndex(pathObj, options.primaryAnchorIndex);
      const currentActiveAnchor = activePathAnchorRef.current;
      const preservedPrimary = currentActiveAnchor &&
        currentActiveAnchor.path === pathObj &&
        normalized.includes(currentActiveAnchor.anchorIndex)
        ? currentActiveAnchor.anchorIndex
        : null;
      const primaryAnchorIndex = requestedPrimary != null && normalized.includes(requestedPrimary)
        ? requestedPrimary
        : preservedPrimary ?? normalized[normalized.length - 1];
      activePathAnchorRef.current = { path: pathObj, anchorIndex: primaryAnchorIndex };
    }

    syncPathAnchorSelectionAppearance(pathObj);
    syncPathControlPointVisibility(pathObj);
    if (normalized.length > 0) {
      syncVectorHandleModeFromSelection();
    }
    onVectorPointSelectionChangeRef.current?.(normalized.length > 0);
    pathObj.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
  }, [
    activePathAnchorRef,
    fabricCanvasRef,
    getPointSelectionKey,
    normalizeAnchorIndex,
    onVectorPointSelectionChangeRef,
    pendingSelectionSyncedVectorHandleModeRef,
    pointSelectionTransformFrameRef,
    selectedPathAnchorIndicesRef,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    syncVectorHandleModeFromSelection,
  ]);

  const clearSelectedPathAnchors = useCallback((pathObj?: any) => {
    selectedPathAnchorIndicesRef.current = [];
    activePathAnchorRef.current = null;
    pointSelectionTransformFrameRef.current = null;
    pendingSelectionSyncedVectorHandleModeRef.current = null;
    onVectorPointSelectionChangeRef.current?.(false);
    if (pathObj && getFabricObjectType(pathObj) === 'path') {
      syncPathAnchorSelectionAppearance(pathObj);
      syncPathControlPointVisibility(pathObj);
      pathObj.setCoords?.();
    }
    fabricCanvasRef.current?.requestRenderAll();
  }, [
    activePathAnchorRef,
    fabricCanvasRef,
    onVectorPointSelectionChangeRef,
    pendingSelectionSyncedVectorHandleModeRef,
    pointSelectionTransformFrameRef,
    selectedPathAnchorIndicesRef,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
  ]);

  const removeDuplicateClosedPathAnchorControl = useCallback((pathObj: any, controls: Record<string, Control>) => {
    if (!isClosedPath(pathObj)) return;
    const commands = getPathCommands(pathObj);
    if (commands.length === 0) return;
    const lastDrawable = getLastDrawableCommandIndex(pathObj);
    if (lastDrawable <= 0) return;

    const start = getCommandEndpoint(commands[0]);
    const end = getCommandEndpoint(commands[lastDrawable]);
    if (!start || !end) return;
    if (!isNearlyEqual(start.x, end.x) || !isNearlyEqual(start.y, end.y)) return;

    const commandType = getCommandType(commands[lastDrawable]);
    if (!commandType) return;
    delete controls[`c_${lastDrawable}_${commandType}`];
  }, [
    getCommandEndpoint,
    getCommandType,
    getLastDrawableCommandIndex,
    getPathCommands,
    isClosedPath,
    isNearlyEqual,
  ]);

  const clonePoint = useCallback((point: Point | null): Point | null => {
    if (!point) return null;
    return new Point(point.x, point.y);
  }, []);

  const lerpPoint = useCallback((a: Point, b: Point, t: number) => (
    new Point(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
    )
  ), []);

  const distanceSqBetweenPoints = useCallback((a: Point, b: Point) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }, []);

  const getScenePointFromOwnPlanePoint = useCallback((obj: any, point: Point): Point | null => {
    if (!obj || !point || typeof obj.calcOwnMatrix !== 'function') return null;
    return point.transform(obj.calcOwnMatrix());
  }, []);

  const invertOwnPlanePoint = useCallback((obj: any, point: Point): Point | null => {
    if (!obj || !point || typeof obj.calcOwnMatrix !== 'function') return null;
    const [a, b, c, d, e, f] = obj.calcOwnMatrix() as [number, number, number, number, number, number];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) <= 0.0000001) return null;
    const nextX = point.x - e;
    const nextY = point.y - f;
    return new Point(
      (d * nextX - c * nextY) / determinant,
      (-b * nextX + a * nextY) / determinant,
    );
  }, []);

  const toPathScenePoint = useCallback((pathObj: any, point: Point): Point | null => {
    if (!pathObj?.pathOffset) return null;
    return getScenePointFromOwnPlanePoint(
      pathObj,
      new Point(point.x - pathObj.pathOffset.x, point.y - pathObj.pathOffset.y),
    );
  }, [getScenePointFromOwnPlanePoint]);

  const toPathCommandPoint = useCallback((pathObj: any, scenePoint: Point): Point | null => {
    if (!pathObj?.pathOffset) return null;
    const ownPlanePoint = invertOwnPlanePoint(pathObj, scenePoint);
    if (!ownPlanePoint) return null;
    return ownPlanePoint.add(pathObj.pathOffset);
  }, [invertOwnPlanePoint]);

  const findClosestPointOnLineSegment = useCallback((point: Point, start: Point, end: Point) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.0000001) {
      return { t: 0, point: new Point(start.x, start.y), distanceSq: distanceSqBetweenPoints(point, start) };
    }
    const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
    const t = Math.max(0, Math.min(1, rawT));
    const nearest = lerpPoint(start, end, t);
    return { t, point: nearest, distanceSq: distanceSqBetweenPoints(point, nearest) };
  }, [distanceSqBetweenPoints, lerpPoint]);

  const evaluateQuadraticPoint = useCallback((p0: Point, p1: Point, p2: Point, t: number) => {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    return lerpPoint(a, b, t);
  }, [lerpPoint]);

  const evaluateCubicPoint = useCallback((p0: Point, p1: Point, p2: Point, p3: Point, t: number) => {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    const c = lerpPoint(p2, p3, t);
    const d = lerpPoint(a, b, t);
    const e = lerpPoint(b, c, t);
    return lerpPoint(d, e, t);
  }, [lerpPoint]);

  const findClosestCurveSample = useCallback((point: Point, evaluate: (t: number) => Point) => {
    const coarseSteps = 24;
    let bestT = 0;
    let bestPoint = evaluate(0);
    let bestDistanceSq = distanceSqBetweenPoints(point, bestPoint);

    for (let index = 1; index <= coarseSteps; index += 1) {
      const t = index / coarseSteps;
      const candidate = evaluate(t);
      const candidateDistanceSq = distanceSqBetweenPoints(point, candidate);
      if (candidateDistanceSq < bestDistanceSq) {
        bestT = t;
        bestPoint = candidate;
        bestDistanceSq = candidateDistanceSq;
      }
    }

    let minT = Math.max(0, bestT - 1 / coarseSteps);
    let maxT = Math.min(1, bestT + 1 / coarseSteps);
    for (let refinement = 0; refinement < 5; refinement += 1) {
      const refineSteps = 12;
      for (let index = 0; index <= refineSteps; index += 1) {
        const t = minT + ((maxT - minT) * index) / refineSteps;
        const candidate = evaluate(t);
        const candidateDistanceSq = distanceSqBetweenPoints(point, candidate);
        if (candidateDistanceSq < bestDistanceSq) {
          bestT = t;
          bestPoint = candidate;
          bestDistanceSq = candidateDistanceSq;
        }
      }
      const nextSpan = (maxT - minT) / refineSteps;
      minT = Math.max(0, bestT - nextSpan);
      maxT = Math.min(1, bestT + nextSpan);
    }

    return { t: bestT, point: bestPoint, distanceSq: bestDistanceSq };
  }, [distanceSqBetweenPoints]);

  const toParentPlanePoint = useCallback((pathObj: any, point: Point): Point | null => {
    if (!pathObj || !point || !pathObj.pathOffset || typeof pathObj.calcOwnMatrix !== 'function') return null;
    return new Point(point.x - pathObj.pathOffset.x, point.y - pathObj.pathOffset.y).transform(pathObj.calcOwnMatrix());
  }, []);

  const getPathSegments = useCallback((pathObj: any) => {
    const commands = getPathCommands(pathObj);
    const segments: Array<{
      commandIndex: number;
      type: 'L' | 'Q' | 'C' | 'Z';
      start: Point;
      end: Point;
      control1?: Point;
      control2?: Point;
    }> = [];

    if (commands.length === 0) return segments;

    let subpathStart = getCommandEndpoint(commands[0]);
    let previousPoint = subpathStart;
    for (let commandIndex = 1; commandIndex < commands.length; commandIndex += 1) {
      const command = commands[commandIndex];
      const type = getCommandType(command);
      if (type === 'M') {
        subpathStart = getCommandEndpoint(command);
        previousPoint = subpathStart;
        continue;
      }
      if (!previousPoint) continue;
      if (type === 'L') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({ commandIndex, type: 'L', start: previousPoint, end });
        previousPoint = end;
        continue;
      }
      if (type === 'Q') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({
          commandIndex,
          type: 'Q',
          start: previousPoint,
          control1: new Point(Number(command[1]), Number(command[2])),
          end,
        });
        previousPoint = end;
        continue;
      }
      if (type === 'C') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({
          commandIndex,
          type: 'C',
          start: previousPoint,
          control1: new Point(Number(command[1]), Number(command[2])),
          control2: new Point(Number(command[3]), Number(command[4])),
          end,
        });
        previousPoint = end;
        continue;
      }
      if (type === 'Z' && subpathStart) {
        segments.push({
          commandIndex,
          type: 'Z',
          start: previousPoint,
          end: subpathStart,
        });
        previousPoint = subpathStart;
      }
    }

    return segments;
  }, [getCommandEndpoint, getCommandType, getPathCommands]);

  const buildShiftedPathNodeHandleTypes = useCallback((pathObj: any, fromIndex: number, delta: number) => {
    const next: Record<string, VectorPathNodeHandleType> = {};
    for (const [key, value] of Object.entries(getPathNodeHandleTypes(pathObj))) {
      const numericKey = Number(key);
      if (!Number.isFinite(numericKey)) continue;
      next[String(numericKey >= fromIndex ? numericKey + delta : numericKey)] = value;
    }
    return next;
  }, [getPathNodeHandleTypes]);

  const buildLinearCubicSegmentCommand = useCallback((start: Point, end: Point) => {
    const control1 = lerpPoint(start, end, 1 / 3);
    const control2 = lerpPoint(start, end, 2 / 3);
    return ['C', control1.x, control1.y, control2.x, control2.y, end.x, end.y] as const;
  }, [lerpPoint]);

  const buildQuadraticCubicSegmentCommand = useCallback((start: Point, control: Point, end: Point) => {
    const control1 = lerpPoint(start, control, 2 / 3);
    const control2 = lerpPoint(end, control, 2 / 3);
    return ['C', control1.x, control1.y, control2.x, control2.y, end.x, end.y] as const;
  }, [lerpPoint]);

  const findAnchorSegmentCommandIndex = useCallback((
    pathObj: any,
    anchorIndex: number,
    role: 'incoming' | 'outgoing',
  ): number => {
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    let foundCommandIndex = -1;

    for (const segment of getPathSegments(pathObj)) {
      const startAnchorIndex = normalizeAnchorIndex(
        pathObj,
        findPreviousDrawableCommandIndex(pathObj, segment.commandIndex),
      );
      const endAnchorIndex = normalizeAnchorIndex(
        pathObj,
        segment.type === 'Z'
          ? findNextDrawableCommandIndex(pathObj, segment.commandIndex)
          : segment.commandIndex,
      );

      if (role === 'incoming') {
        if (endAnchorIndex === normalizedAnchor) {
          foundCommandIndex = segment.commandIndex;
        }
        continue;
      }

      if (startAnchorIndex === normalizedAnchor) {
        return segment.commandIndex;
      }
    }

    return foundCommandIndex;
  }, [
    findNextDrawableCommandIndex,
    findPreviousDrawableCommandIndex,
    getPathSegments,
    normalizeAnchorIndex,
  ]);

  const convertSegmentCommandToCubic = useCallback((pathObj: any, commandIndex: number): number => {
    if (commandIndex < 0) return -1;

    const commands = getPathCommands(pathObj);
    const command = commands[commandIndex];
    const commandType = getCommandType(command);
    if (commandType === 'C') {
      return commandIndex;
    }

    const previousAnchorIndex = findPreviousDrawableCommandIndex(pathObj, commandIndex);
    const previousAnchor = getAnchorPointForIndex(pathObj, previousAnchorIndex);
    if (!previousAnchor) {
      return -1;
    }

    if (commandType === 'L') {
      const end = getCommandEndpoint(command);
      if (!end) return -1;
      commands[commandIndex] = [...buildLinearCubicSegmentCommand(previousAnchor, end)];
      return commandIndex;
    }

    if (commandType === 'Q') {
      const end = getCommandEndpoint(command);
      if (!end) return -1;
      const control = new Point(Number(command[1]), Number(command[2]));
      commands[commandIndex] = [...buildQuadraticCubicSegmentCommand(previousAnchor, control, end)];
      return commandIndex;
    }

    if (commandType === 'Z') {
      const nextAnchorIndex = findNextDrawableCommandIndex(pathObj, commandIndex);
      const nextAnchor = getAnchorPointForIndex(pathObj, nextAnchorIndex);
      if (!nextAnchor) return -1;
      commands[commandIndex] = [...buildLinearCubicSegmentCommand(previousAnchor, nextAnchor)];
      return commandIndex;
    }

    return -1;
  }, [
    buildLinearCubicSegmentCommand,
    buildQuadraticCubicSegmentCommand,
    findNextDrawableCommandIndex,
    findPreviousDrawableCommandIndex,
    getAnchorPointForIndex,
    getCommandEndpoint,
    getCommandType,
    getPathCommands,
  ]);

  const ensurePathAnchorCurveHandleCommands = useCallback((pathObj: any, anchorIndex: number) => {
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const incomingCommandIndex = convertSegmentCommandToCubic(
      pathObj,
      findAnchorSegmentCommandIndex(pathObj, normalizedAnchor, 'incoming'),
    );
    const outgoingCommandIndex = convertSegmentCommandToCubic(
      pathObj,
      findAnchorSegmentCommandIndex(pathObj, normalizedAnchor, 'outgoing'),
    );
    return {
      incomingCommandIndex,
      outgoingCommandIndex,
    };
  }, [
    convertSegmentCommandToCubic,
    findAnchorSegmentCommandIndex,
    normalizeAnchorIndex,
  ]);

  const insertPathPointAtScenePosition = useCallback((pathObj: any, scenePoint: Point): number | null => {
    const commands = getPathCommands(pathObj);
    if (commands.length < 2) return null;

    const sceneScale = Math.max(0.0001, BASE_VIEW_SCALE * zoomRef.current);
    const hitRadius = VECTOR_POINT_INSERTION_HIT_RADIUS_PX / sceneScale;
    const endpointClearance = VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX / sceneScale;
    const hitRadiusSq = hitRadius * hitRadius;
    const endpointClearanceSq = endpointClearance * endpointClearance;

    let bestCandidate: {
      commandIndex: number;
      type: 'L' | 'Q' | 'C' | 'Z';
      t: number;
      scenePoint: Point;
      distanceSq: number;
      start: Point;
      end: Point;
      control1?: Point;
      control2?: Point;
    } | null = null;

    for (const segment of getPathSegments(pathObj)) {
      const startScene = toPathScenePoint(pathObj, segment.start);
      const endScene = toPathScenePoint(pathObj, segment.end);
      if (!startScene || !endScene) continue;

      let candidate: { t: number; point: Point; distanceSq: number } | null = null;
      if (segment.type === 'L' || segment.type === 'Z') {
        candidate = findClosestPointOnLineSegment(scenePoint, startScene, endScene);
      } else if (segment.type === 'Q' && segment.control1) {
        const controlScene = toPathScenePoint(pathObj, segment.control1);
        if (!controlScene) continue;
        candidate = findClosestCurveSample(
          scenePoint,
          (t) => evaluateQuadraticPoint(startScene, controlScene, endScene, t),
        );
      } else if (segment.type === 'C' && segment.control1 && segment.control2) {
        const control1Scene = toPathScenePoint(pathObj, segment.control1);
        const control2Scene = toPathScenePoint(pathObj, segment.control2);
        if (!control1Scene || !control2Scene) continue;
        candidate = findClosestCurveSample(
          scenePoint,
          (t) => evaluateCubicPoint(startScene, control1Scene, control2Scene, endScene, t),
        );
      }

      if (!candidate) continue;
      if (candidate.distanceSq > hitRadiusSq) continue;
      if (candidate.t <= 0.001 || candidate.t >= 0.999) continue;
      if (
        distanceSqBetweenPoints(candidate.point, startScene) <= endpointClearanceSq ||
        distanceSqBetweenPoints(candidate.point, endScene) <= endpointClearanceSq
      ) {
        continue;
      }
      if (!bestCandidate || candidate.distanceSq < bestCandidate.distanceSq) {
        bestCandidate = {
          commandIndex: segment.commandIndex,
          type: segment.type,
          t: candidate.t,
          scenePoint: candidate.point,
          distanceSq: candidate.distanceSq,
          start: segment.start,
          end: segment.end,
          control1: segment.control1,
          control2: segment.control2,
        };
      }
    }

    if (!bestCandidate) return null;

    const insertedCommandPoint = toPathCommandPoint(pathObj, bestCandidate.scenePoint);
    if (!insertedCommandPoint) return null;

    const nextCommands = commands.map((command) => (Array.isArray(command) ? [...command] : command));
    const insertIndex = bestCandidate.commandIndex;
    if (bestCandidate.type === 'L') {
      nextCommands[insertIndex] = [...buildLinearCubicSegmentCommand(bestCandidate.start, insertedCommandPoint)];
      nextCommands.splice(insertIndex + 1, 0, [...buildLinearCubicSegmentCommand(insertedCommandPoint, bestCandidate.end)]);
    } else if (bestCandidate.type === 'Z') {
      nextCommands.splice(
        insertIndex,
        1,
        [...buildLinearCubicSegmentCommand(bestCandidate.start, insertedCommandPoint)],
        [...buildLinearCubicSegmentCommand(insertedCommandPoint, bestCandidate.end)],
        ['Z'],
      );
    } else if (bestCandidate.type === 'Q' && bestCandidate.control1) {
      const firstControl = lerpPoint(bestCandidate.start, bestCandidate.control1, bestCandidate.t);
      const secondControl = lerpPoint(bestCandidate.control1, bestCandidate.end, bestCandidate.t);
      const insertedPoint = lerpPoint(firstControl, secondControl, bestCandidate.t);
      nextCommands[insertIndex] = ['Q', firstControl.x, firstControl.y, insertedPoint.x, insertedPoint.y];
      nextCommands.splice(insertIndex + 1, 0, ['Q', secondControl.x, secondControl.y, bestCandidate.end.x, bestCandidate.end.y]);
    } else if (bestCandidate.type === 'C' && bestCandidate.control1 && bestCandidate.control2) {
      const p01 = lerpPoint(bestCandidate.start, bestCandidate.control1, bestCandidate.t);
      const p12 = lerpPoint(bestCandidate.control1, bestCandidate.control2, bestCandidate.t);
      const p23 = lerpPoint(bestCandidate.control2, bestCandidate.end, bestCandidate.t);
      const p012 = lerpPoint(p01, p12, bestCandidate.t);
      const p123 = lerpPoint(p12, p23, bestCandidate.t);
      const insertedPoint = lerpPoint(p012, p123, bestCandidate.t);
      nextCommands[insertIndex] = ['C', p01.x, p01.y, p012.x, p012.y, insertedPoint.x, insertedPoint.y];
      nextCommands.splice(insertIndex + 1, 0, ['C', p123.x, p123.y, p23.x, p23.y, bestCandidate.end.x, bestCandidate.end.y]);
    } else {
      return null;
    }

    const centerPoint = typeof pathObj.getCenterPoint === 'function'
      ? pathObj.getCenterPoint()
      : null;
    const nextHandleTypes = buildShiftedPathNodeHandleTypes(pathObj, insertIndex, 1);
    nextHandleTypes[String(insertIndex)] = 'smooth';

    pathObj.set?.({
      path: nextCommands,
      nodeHandleTypes: nextHandleTypes,
    });
    pathObj.setDimensions?.();
    if (centerPoint && typeof pathObj.setPositionByOrigin === 'function') {
      pathObj.setPositionByOrigin(centerPoint, 'center', 'center');
    }
    pathObj.set('dirty', true);
    pathObj.setCoords?.();
    activePathAnchorRef.current = { path: pathObj, anchorIndex: insertIndex };
    return insertIndex;
  }, [
    activePathAnchorRef,
    buildLinearCubicSegmentCommand,
    buildShiftedPathNodeHandleTypes,
    distanceSqBetweenPoints,
    evaluateCubicPoint,
    evaluateQuadraticPoint,
    findClosestCurveSample,
    findClosestPointOnLineSegment,
    getPathCommands,
    getPathSegments,
    lerpPoint,
    toPathCommandPoint,
    toPathScenePoint,
    zoomRef,
  ]);

  const stabilizePathAfterAnchorMutation = useCallback((pathObj: any, anchorPoint: Point) => {
    const anchorBefore = toParentPlanePoint(pathObj, anchorPoint);
    pathObj.setDimensions();
    const anchorAfter = toParentPlanePoint(pathObj, anchorPoint);
    if (anchorBefore && anchorAfter) {
      const diffX = anchorAfter.x - anchorBefore.x;
      const diffY = anchorAfter.y - anchorBefore.y;
      if (Math.abs(diffX) > 0.0001) {
        pathObj.left -= diffX;
      }
      if (Math.abs(diffY) > 0.0001) {
        pathObj.top -= diffY;
      }
    }
    pathObj.set('dirty', true);
    pathObj.setCoords();
  }, [toParentPlanePoint]);

  const movePathAnchorByDelta = useCallback((pathObj: any, anchorIndex: number, deltaX: number, deltaY: number, dragState?: PathAnchorDragState) => {
    if (Math.abs(deltaX) <= 0.0001 && Math.abs(deltaY) <= 0.0001) return false;

    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const commands = getPathCommands(pathObj);
    const anchorCommand = commands[normalizedAnchor];
    if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) return false;

    const currentAnchor = getAnchorPointForIndex(pathObj, normalizedAnchor);
    const nextAnchor = dragState?.previousAnchor
      ? new Point(dragState.previousAnchor.x + deltaX, dragState.previousAnchor.y + deltaY)
      : currentAnchor
        ? new Point(currentAnchor.x + deltaX, currentAnchor.y + deltaY)
        : null;
    if (!nextAnchor) return false;

    anchorCommand[anchorCommand.length - 2] = nextAnchor.x;
    anchorCommand[anchorCommand.length - 1] = nextAnchor.y;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      const incomingBase = dragState?.previousIncoming ?? new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
      incomingCommand[3] = incomingBase.x + deltaX;
      incomingCommand[4] = incomingBase.y + deltaY;
    }

    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      const outgoingBase = dragState?.previousOutgoing ?? new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
      outgoingCommand[1] = outgoingBase.x + deltaX;
      outgoingCommand[2] = outgoingBase.y + deltaY;
    }

    pathObj.set('dirty', true);
    return true;
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
  ]);

  const enforcePathAnchorHandleType = useCallback((pathObj: any, anchorIndex: number, changed: 'anchor' | 'incoming' | 'outgoing' | null, dragState?: PathAnchorDragState) => {
    const commands = getPathCommands(pathObj);
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return;

    const handleType = getPathNodeHandleType(pathObj, anchorIndex) ?? 'corner';
    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (changed === 'anchor' && dragState?.previousAnchor) {
      const deltaX = anchorPoint.x - dragState.previousAnchor.x;
      const deltaY = anchorPoint.y - dragState.previousAnchor.y;
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        const baseIncoming = dragState.previousIncoming ?? new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
        incomingCommand[3] = baseIncoming.x + deltaX;
        incomingCommand[4] = baseIncoming.y + deltaY;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        const baseOutgoing = dragState.previousOutgoing ?? new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
        outgoingCommand[1] = baseOutgoing.x + deltaX;
        outgoingCommand[2] = baseOutgoing.y + deltaY;
      }
      if (handleType === 'linear') {
        if (incomingCommand && getCommandType(incomingCommand) === 'C') {
          incomingCommand[3] = anchorPoint.x;
          incomingCommand[4] = anchorPoint.y;
        }
        if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
          outgoingCommand[1] = anchorPoint.x;
          outgoingCommand[2] = anchorPoint.y;
        }
      }
      stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
      return;
    }

    if (handleType === 'corner') return;

    if (handleType === 'linear') {
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        incomingCommand[3] = anchorPoint.x;
        incomingCommand[4] = anchorPoint.y;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        outgoingCommand[1] = anchorPoint.x;
        outgoingCommand[2] = anchorPoint.y;
      }
      stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
      return;
    }

    if (!incomingCommand && !outgoingCommand) return;

    const incomingVec = incomingCommand && getCommandType(incomingCommand) === 'C'
      ? { x: Number(incomingCommand[3]) - anchorPoint.x, y: Number(incomingCommand[4]) - anchorPoint.y }
      : null;
    const outgoingVec = outgoingCommand && getCommandType(outgoingCommand) === 'C'
      ? { x: Number(outgoingCommand[1]) - anchorPoint.x, y: Number(outgoingCommand[2]) - anchorPoint.y }
      : null;
    const incomingLength = incomingVec ? Math.hypot(incomingVec.x, incomingVec.y) : 0;
    const outgoingLength = outgoingVec ? Math.hypot(outgoingVec.x, outgoingVec.y) : 0;
    const previousAnchorIndex = findPreviousDrawableCommandIndex(pathObj, normalizedAnchor);
    const nextAnchorIndex = findNextDrawableCommandIndex(pathObj, normalizedAnchor);
    const previousAnchorPoint = previousAnchorIndex !== normalizedAnchor ? getAnchorPointForIndex(pathObj, previousAnchorIndex) : null;
    const nextAnchorPoint = nextAnchorIndex !== normalizedAnchor ? getAnchorPointForIndex(pathObj, nextAnchorIndex) : null;
    const previousSegmentVec = previousAnchorPoint
      ? { x: previousAnchorPoint.x - anchorPoint.x, y: previousAnchorPoint.y - anchorPoint.y }
      : null;
    const nextSegmentVec = nextAnchorPoint
      ? { x: nextAnchorPoint.x - anchorPoint.x, y: nextAnchorPoint.y - anchorPoint.y }
      : null;
    const previousSegmentLength = previousSegmentVec ? Math.hypot(previousSegmentVec.x, previousSegmentVec.y) : 0;
    const nextSegmentLength = nextSegmentVec ? Math.hypot(nextSegmentVec.x, nextSegmentVec.y) : 0;

    let baseDirX = 1;
    let baseDirY = 0;
    if (changed === 'incoming' && incomingLength > 0.0001) {
      baseDirX = incomingVec!.x / incomingLength;
      baseDirY = incomingVec!.y / incomingLength;
    } else if (changed === 'outgoing' && outgoingLength > 0.0001) {
      baseDirX = -outgoingVec!.x / outgoingLength;
      baseDirY = -outgoingVec!.y / outgoingLength;
    } else if (incomingLength > 0.0001) {
      baseDirX = incomingVec!.x / incomingLength;
      baseDirY = incomingVec!.y / incomingLength;
    } else if (outgoingLength > 0.0001) {
      baseDirX = -outgoingVec!.x / outgoingLength;
      baseDirY = -outgoingVec!.y / outgoingLength;
    } else if (previousSegmentLength > 0.0001 && nextSegmentLength > 0.0001) {
      const previousDirX = previousSegmentVec!.x / previousSegmentLength;
      const previousDirY = previousSegmentVec!.y / previousSegmentLength;
      const nextDirX = nextSegmentVec!.x / nextSegmentLength;
      const nextDirY = nextSegmentVec!.y / nextSegmentLength;
      const bisectorX = previousDirX - nextDirX;
      const bisectorY = previousDirY - nextDirY;
      const bisectorLength = Math.hypot(bisectorX, bisectorY);
      if (bisectorLength > 0.0001) {
        baseDirX = bisectorX / bisectorLength;
        baseDirY = bisectorY / bisectorLength;
      } else {
        baseDirX = previousDirX;
        baseDirY = previousDirY;
      }
    } else if (previousSegmentLength > 0.0001) {
      baseDirX = previousSegmentVec!.x / previousSegmentLength;
      baseDirY = previousSegmentVec!.y / previousSegmentLength;
    } else if (nextSegmentLength > 0.0001) {
      baseDirX = -nextSegmentVec!.x / nextSegmentLength;
      baseDirY = -nextSegmentVec!.y / nextSegmentLength;
    }

    let nextIncomingLength = incomingLength;
    let nextOutgoingLength = outgoingLength;
    if (nextIncomingLength <= 0.0001 && previousSegmentLength > 0.0001) {
      nextIncomingLength = previousSegmentLength / 3;
    }
    if (nextOutgoingLength <= 0.0001 && nextSegmentLength > 0.0001) {
      nextOutgoingLength = nextSegmentLength / 3;
    }
    if (handleType === 'symmetric') {
      if (changed === 'incoming') {
        nextOutgoingLength = incomingLength;
      } else if (changed === 'outgoing') {
        nextIncomingLength = outgoingLength;
      } else {
        const maxLength = Math.max(incomingLength, outgoingLength);
        nextIncomingLength = maxLength;
        nextOutgoingLength = maxLength;
      }
    } else {
      if (nextIncomingLength <= 0.0001 && nextOutgoingLength > 0.0001) {
        nextIncomingLength = nextOutgoingLength;
      }
      if (nextOutgoingLength <= 0.0001 && nextIncomingLength > 0.0001) {
        nextOutgoingLength = nextIncomingLength;
      }
    }

    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      incomingCommand[3] = anchorPoint.x + baseDirX * nextIncomingLength;
      incomingCommand[4] = anchorPoint.y + baseDirY * nextIncomingLength;
    }
    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      outgoingCommand[1] = anchorPoint.x - baseDirX * nextOutgoingLength;
      outgoingCommand[2] = anchorPoint.y - baseDirY * nextOutgoingLength;
    }

    stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
  }, [
    findIncomingCubicCommandIndex,
    findNextDrawableCommandIndex,
    findOutgoingCubicCommandIndex,
    findPreviousDrawableCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    getPathNodeHandleType,
    normalizeAnchorIndex,
    stabilizePathAfterAnchorMutation,
  ]);

  const getPathAnchorDragState = useCallback((pathObj: any, anchorIndex: number): PathAnchorDragState | null => {
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return null;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const commands = getPathCommands(pathObj);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    return {
      previousAnchor: new Point(anchorPoint.x, anchorPoint.y),
      previousIncoming: incomingCommand && getCommandType(incomingCommand) === 'C'
        ? clonePoint(new Point(Number(incomingCommand[3]), Number(incomingCommand[4])))
        : null,
      previousOutgoing: outgoingCommand && getCommandType(outgoingCommand) === 'C'
        ? clonePoint(new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2])))
        : null,
    };
  }, [
    clonePoint,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
  ]);

  const resolveMirroredPathAnchorHandleRole = useCallback((
    pathObj: any,
    anchorIndex: number,
    changed: 'anchor' | 'incoming' | 'outgoing',
  ): MirroredPathAnchorHandleRole => {
    if (changed === 'incoming' || changed === 'outgoing') {
      return changed;
    }

    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const hasOutgoing = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor) >= 0;
    const hasIncoming = findIncomingCubicCommandIndex(pathObj, normalizedAnchor) >= 0;
    if (!hasOutgoing && hasIncoming) {
      return 'incoming';
    }
    return 'outgoing';
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    normalizeAnchorIndex,
  ]);

  const applyMirroredPathAnchorCurveDrag = useCallback((
    pathObj: any,
    anchorIndex: number,
    handleRole: MirroredPathAnchorHandleRole,
    pointerScene: Point,
    dragState?: PathAnchorDragState,
  ): boolean => {
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = dragState?.previousAnchor ?? getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return false;

    const pointerCommand = toPathCommandPoint(pathObj, pointerScene);
    if (!pointerCommand) return false;

    const anchorCommand = getPathCommands(pathObj)[normalizedAnchor];
    if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) return false;

    const { incomingCommandIndex, outgoingCommandIndex } = ensurePathAnchorCurveHandleCommands(pathObj, normalizedAnchor);
    if (incomingCommandIndex < 0 && outgoingCommandIndex < 0) return false;

    const commands = getPathCommands(pathObj);
    anchorCommand[anchorCommand.length - 2] = anchorPoint.x;
    anchorCommand[anchorCommand.length - 1] = anchorPoint.y;

    const mirroredPointer = mirrorPointAcrossAnchor(anchorPoint, pointerCommand);
    const primaryRole: MirroredPathAnchorHandleRole = handleRole;

    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      const incomingPoint = primaryRole === 'incoming' ? pointerCommand : mirroredPointer;
      incomingCommand[3] = incomingPoint.x;
      incomingCommand[4] = incomingPoint.y;
    }

    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;
    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      const outgoingPoint = primaryRole === 'outgoing' ? pointerCommand : mirroredPointer;
      outgoingCommand[1] = outgoingPoint.x;
      outgoingCommand[2] = outgoingPoint.y;
    }

    setPathNodeHandleType(pathObj, normalizedAnchor, 'symmetric');
    pathObj.set('dirty', true);
    stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
    syncPathAnchorSelectionAppearance(pathObj);
    syncPathControlPointVisibility(pathObj);
    pathObj.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [
    ensurePathAnchorCurveHandleCommands,
    fabricCanvasRef,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
    setPathNodeHandleType,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    toPathCommandPoint,
  ]);

  const applyMirroredPathAnchorCurveDragSession = useCallback((
    session: MirroredPathAnchorDragSession,
    pointerScene: Point,
  ): boolean => {
    session.currentPointerScene = new Point(pointerScene.x, pointerScene.y);

    if (session.moveAnchorMode && session.moveAnchorStartCommandPoint && session.moveAnchorSnapshot) {
      const pointerCommandPoint = toPathCommandPoint(session.path, pointerScene);
      if (!pointerCommandPoint) {
        return false;
      }
      const deltaX = pointerCommandPoint.x - session.moveAnchorStartCommandPoint.x;
      const deltaY = pointerCommandPoint.y - session.moveAnchorStartCommandPoint.y;
      const moved = movePathAnchorByDelta(
        session.path,
        session.anchorIndex,
        deltaX,
        deltaY,
        session.moveAnchorSnapshot,
      );
      if (!moved) {
        return false;
      }

      enforcePathAnchorHandleType(
        session.path,
        session.anchorIndex,
        'anchor',
        session.moveAnchorSnapshot,
      );
      return true;
    }

    return applyMirroredPathAnchorCurveDrag(
      session.path,
      session.anchorIndex,
      session.handleRole,
      pointerScene,
      session.dragState ?? undefined,
    );
  }, [
    applyMirroredPathAnchorCurveDrag,
    enforcePathAnchorHandleType,
    movePathAnchorByDelta,
    toPathCommandPoint,
  ]);

  const setMirroredPathAnchorDragSessionMoveMode = useCallback((
    session: MirroredPathAnchorDragSession | null,
    enabled: boolean,
  ): boolean => {
    if (!session) {
      return false;
    }
    if (enabled === session.moveAnchorMode) {
      return false;
    }

    if (enabled) {
      const moveAnchorSnapshot = getPathAnchorDragState(session.path, session.anchorIndex) ?? session.dragState;
      const moveAnchorStartCommandPoint = toPathCommandPoint(session.path, session.currentPointerScene);
      if (!moveAnchorSnapshot || !moveAnchorStartCommandPoint) {
        return false;
      }
      session.moveAnchorMode = true;
      session.moveAnchorSnapshot = moveAnchorSnapshot;
      session.moveAnchorStartCommandPoint = moveAnchorStartCommandPoint;
      session.dragState = moveAnchorSnapshot;
      return true;
    }

    session.moveAnchorMode = false;
    session.moveAnchorSnapshot = null;
    session.moveAnchorStartCommandPoint = null;
    session.dragState = getPathAnchorDragState(session.path, session.anchorIndex) ?? session.dragState;
    return true;
  }, [
    getPathAnchorDragState,
    toPathCommandPoint,
  ]);

  const getSelectedPathAnchorTransformSnapshot = useCallback((pathObj: any): PointSelectionTransformSnapshot | null => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return null;

    const selectedAnchorIndices = getSelectedPathAnchorIndices(pathObj);
    if (selectedAnchorIndices.length < 2) return null;
    const selectionKey = getPointSelectionKey(selectedAnchorIndices);

    const commands = getPathCommands(pathObj);
    const anchors: SelectedPathAnchorTransformSnapshot[] = [];
    for (const anchorIndex of selectedAnchorIndices) {
      const anchorPoint = getAnchorPointForIndex(pathObj, anchorIndex);
      const anchorScene = anchorPoint ? toPathScenePoint(pathObj, anchorPoint) : null;
      if (!anchorPoint || !anchorScene) continue;

      const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, anchorIndex);
      const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, anchorIndex);
      const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
      const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;
      const incomingScene = incomingCommand && getCommandType(incomingCommand) === 'C'
        ? toPathScenePoint(pathObj, new Point(Number(incomingCommand[3]), Number(incomingCommand[4])))
        : null;
      const outgoingScene = outgoingCommand && getCommandType(outgoingCommand) === 'C'
        ? toPathScenePoint(pathObj, new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2])))
        : null;

      anchors.push({
        anchorIndex,
        anchorScene,
        incomingScene,
        outgoingScene,
      });
    }

    if (anchors.length < 2) return null;

    const preservedFrame = pointSelectionTransformFrameRef.current;
    const preservedRotation = preservedFrame &&
      preservedFrame.path === pathObj &&
      preservedFrame.selectionKey === selectionKey
      ? preservedFrame.rotationRadians
      : 0;
    const bounds = createPointSelectionTransformBounds(
      anchors.map((anchor) => anchor.anchorScene),
      preservedRotation,
    );
    if (!bounds) {
      return null;
    }

    return {
      path: pathObj,
      selectionKey,
      anchors,
      bounds,
    };
  }, [
    createPointSelectionTransformBounds,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPointSelectionKey,
    getPathCommands,
    getSelectedPathAnchorIndices,
    pointSelectionTransformFrameRef,
    toPathScenePoint,
  ]);

  const getPointSelectionTransformHandlePoints = useCallback((bounds: PointSelectionTransformBounds) => {
    return getTransformGizmoHandleFrame(
      bounds.center,
      bounds.width,
      bounds.height,
      bounds.rotationRadians,
    );
  }, []);

  const hitPointSelectionTransform = useCallback((snapshot: PointSelectionTransformSnapshot, pointerScene: Point): PointSelectionTransformMode | null => {
    const hitPadding = getZoomInvariantMetric(VECTOR_POINT_SELECTION_HIT_PADDING);
    const frame = getPointSelectionTransformHandlePoints(snapshot.bounds);
    const handleRadius = getZoomInvariantMetric(TRANSFORM_GIZMO_HANDLE_RADIUS + 4);
    const cornerTarget = hitTransformGizmoCornerTarget(
      pointerScene,
      frame.corners,
      handleRadius,
      getZoomInvariantMetric(TRANSFORM_GIZMO_HANDLE_RADIUS),
      snapshot.bounds.rotationRadians,
    );
    if (cornerTarget) {
      return cornerTarget;
    }

    const pointerLocal = toPointSelectionTransformLocalPoint(snapshot.bounds, pointerScene);
    if (
      Math.abs(pointerLocal.x) <= snapshot.bounds.width / 2 + hitPadding &&
      Math.abs(pointerLocal.y) <= snapshot.bounds.height / 2 + hitPadding
    ) {
      return 'move';
    }

    return null;
  }, [getPointSelectionTransformHandlePoints, getZoomInvariantMetric, toPointSelectionTransformLocalPoint]);

  const rotateScenePointAround = useCallback((point: Point, center: Point, angleRadians: number) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    return new Point(
      center.x + dx * cos - dy * sin,
      center.y + dx * sin + dy * cos,
    );
  }, []);

  const transformPointSelectionScenePoint = useCallback((point: Point, session: PointSelectionTransformSession, pointerScene: Point): Point => {
    const { bounds } = session.snapshot;
    if (session.mode === 'move') {
      return new Point(
        point.x + (pointerScene.x - session.startPointerScene.x),
        point.y + (pointerScene.y - session.startPointerScene.y),
      );
    }

    if (session.mode.startsWith('rotate-')) {
      const startAngle = Math.atan2(
        session.startPointerScene.y - bounds.center.y,
        session.startPointerScene.x - bounds.center.x,
      );
      const nextAngle = Math.atan2(
        pointerScene.y - bounds.center.y,
        pointerScene.x - bounds.center.x,
      );
      return rotateScenePointAround(point, bounds.center, nextAngle - startAngle);
    }

    const minimumSize = getZoomInvariantMetric(VECTOR_POINT_SELECTION_MIN_SIZE);
    const baseWidth = Math.max(bounds.width, minimumSize);
    const baseHeight = Math.max(bounds.height, minimumSize);
    const frame = getTransformGizmoHandleFrame(
      bounds.center,
      bounds.width,
      bounds.height,
      bounds.rotationRadians,
    );
    const cornerConfig: Record<TransformGizmoCorner, {
      anchor: Point;
      handleXSign: -1 | 1;
      handleYSign: -1 | 1;
    }> = {
      nw: { anchor: frame.corners.se, handleXSign: -1, handleYSign: -1 },
      ne: { anchor: frame.corners.sw, handleXSign: 1, handleYSign: -1 },
      se: { anchor: frame.corners.nw, handleXSign: 1, handleYSign: 1 },
      sw: { anchor: frame.corners.ne, handleXSign: -1, handleYSign: 1 },
    };
    const corner = session.corner ?? 'se';
    const resolvedCorner = cornerConfig[corner];
    const referencePoint = session.centered ? bounds.center : resolvedCorner.anchor;
    const scaled = computeCornerScaleResult({
      referencePoint,
      pointerPoint: pointerScene,
      handleXSign: resolvedCorner.handleXSign,
      handleYSign: resolvedCorner.handleYSign,
      rotationRadians: bounds.rotationRadians,
      baseWidth,
      baseHeight,
      minWidth: minimumSize,
      minHeight: minimumSize,
      proportional: session.proportional,
      centered: session.centered,
    });
    const scaleX = scaled.signedWidth / Math.max(baseWidth, 0.0001);
    const scaleY = scaled.signedHeight / Math.max(baseHeight, 0.0001);
    const localStart = rotateTransformPoint(
      {
        x: point.x - referencePoint.x,
        y: point.y - referencePoint.y,
      },
      bounds.rotationRadians,
    );
    const scaledLocal = {
      x: localStart.x * scaleX,
      y: localStart.y * scaleY,
    };
    const nextPoint = rotateTransformPoint(scaledLocal, -bounds.rotationRadians);
    return new Point(referencePoint.x + nextPoint.x, referencePoint.y + nextPoint.y);
  }, [
    getZoomInvariantMetric,
    rotateScenePointAround,
  ]);

  const beginPointSelectionTransformSession = useCallback((
    pathObj: any,
    mode: PointSelectionTransformMode,
    pointerScene: Point,
    eventData?: Record<string, any> | null,
  ): boolean => {
    const snapshot = getSelectedPathAnchorTransformSnapshot(pathObj);
    if (!snapshot) return false;

    const corner = mode === 'move' ? null : getTransformGizmoCornerFromTarget(mode as TransformGizmoCornerTarget);
    pointSelectionTransformSessionRef.current = {
      path: pathObj,
      mode,
      corner,
      proportional: !!eventData?.shiftKey,
      centered: !!eventData?.altKey,
      startPointerScene: new Point(pointerScene.x, pointerScene.y),
      snapshot,
      hasChanged: false,
    };
    return true;
  }, [getSelectedPathAnchorTransformSnapshot, pointSelectionTransformSessionRef]);

  const applyPointSelectionTransformSession = useCallback((
    session: PointSelectionTransformSession,
    pointerScene: Point,
    eventData?: Record<string, any> | null,
  ): boolean => {
    const { path, snapshot } = session;
    if (!path || getFabricObjectType(path) !== 'path') return false;

    if (session.corner) {
      session.proportional = !!eventData?.shiftKey;
      session.centered = !!eventData?.altKey;
    } else {
      session.proportional = false;
      session.centered = false;
    }

    const commands = getPathCommands(path);
    let referenceCommandPoint: Point | null = null;
    let transformedAnyAnchor = false;
    for (const anchorSnapshot of snapshot.anchors) {
      const normalizedAnchorIndex = normalizeAnchorIndex(path, anchorSnapshot.anchorIndex);
      const anchorCommand = commands[normalizedAnchorIndex];
      if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) continue;

      const transformedAnchorScene = transformPointSelectionScenePoint(anchorSnapshot.anchorScene, session, pointerScene);
      const transformedAnchorCommand = toPathCommandPoint(path, transformedAnchorScene);
      if (!transformedAnchorCommand) continue;

      anchorCommand[anchorCommand.length - 2] = transformedAnchorCommand.x;
      anchorCommand[anchorCommand.length - 1] = transformedAnchorCommand.y;
      referenceCommandPoint ??= transformedAnchorCommand;
      transformedAnyAnchor = true;

      const incomingCommandIndex = findIncomingCubicCommandIndex(path, normalizedAnchorIndex);
      if (incomingCommandIndex >= 0 && anchorSnapshot.incomingScene) {
        const incomingCommand = commands[incomingCommandIndex];
        const transformedIncomingScene = transformPointSelectionScenePoint(anchorSnapshot.incomingScene, session, pointerScene);
        const transformedIncomingCommand = toPathCommandPoint(path, transformedIncomingScene);
        if (transformedIncomingCommand && getCommandType(incomingCommand) === 'C') {
          incomingCommand[3] = transformedIncomingCommand.x;
          incomingCommand[4] = transformedIncomingCommand.y;
        }
      }

      const outgoingCommandIndex = findOutgoingCubicCommandIndex(path, normalizedAnchorIndex);
      if (outgoingCommandIndex >= 0 && anchorSnapshot.outgoingScene) {
        const outgoingCommand = commands[outgoingCommandIndex];
        const transformedOutgoingScene = transformPointSelectionScenePoint(anchorSnapshot.outgoingScene, session, pointerScene);
        const transformedOutgoingCommand = toPathCommandPoint(path, transformedOutgoingScene);
        if (transformedOutgoingCommand && getCommandType(outgoingCommand) === 'C') {
          outgoingCommand[1] = transformedOutgoingCommand.x;
          outgoingCommand[2] = transformedOutgoingCommand.y;
        }
      }
    }

    if (!transformedAnyAnchor || !referenceCommandPoint) return false;

    const nextRotation = session.mode.startsWith('rotate-')
      ? normalizeRadians(
          snapshot.bounds.rotationRadians +
          (
            Math.atan2(
              pointerScene.y - snapshot.bounds.center.y,
              pointerScene.x - snapshot.bounds.center.x,
            ) -
            Math.atan2(
              session.startPointerScene.y - snapshot.bounds.center.y,
              session.startPointerScene.x - snapshot.bounds.center.x,
            )
          ),
        )
      : snapshot.bounds.rotationRadians;
    pointSelectionTransformFrameRef.current = {
      path,
      selectionKey: snapshot.selectionKey,
      rotationRadians: nextRotation,
    };
    if (session.mode.startsWith('rotate-')) {
      const fabricCanvas = fabricCanvasRef.current;
      if (fabricCanvas) {
        applyCanvasCursor(fabricCanvas, getTransformGizmoCursorForCornerTarget(session.mode as TransformGizmoCornerTarget, nextRotation));
      }
    }

    path.set('dirty', true);
    stabilizePathAfterAnchorMutation(path, referenceCommandPoint);
    syncPathAnchorSelectionAppearance(path);
    syncPathControlPointVisibility(path);
    path.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [
    fabricCanvasRef,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
    pointSelectionTransformFrameRef,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    toPathCommandPoint,
    transformPointSelectionScenePoint,
  ]);

  const applyPointSelectionMarqueeSession = useCallback((session: PointSelectionMarqueeSession) => {
    const { path } = session;
    if (!path || getFabricObjectType(path) !== 'path') return false;

    if (!hasPointSelectionMarqueeExceededThreshold(session)) {
      if (!session.toggleSelection && session.initialSelectedAnchorIndices.length > 0) {
        clearSelectedPathAnchors(path);
        return true;
      }
      return false;
    }

    const marqueeBounds = getSceneRectFromPoints(session.startPointerScene, session.currentPointerScene);
    const hitAnchorIndices = getSelectablePathAnchorIndices(path).filter((anchorIndex) => {
      const anchorPoint = getAnchorPointForIndex(path, anchorIndex);
      const anchorScenePoint = anchorPoint ? toPathScenePoint(path, anchorPoint) : null;
      if (!anchorScenePoint) return false;
      return (
        anchorScenePoint.x >= marqueeBounds.left &&
        anchorScenePoint.x <= marqueeBounds.right &&
        anchorScenePoint.y >= marqueeBounds.top &&
        anchorScenePoint.y <= marqueeBounds.bottom
      );
    });

    let nextSelectedAnchorIndices = hitAnchorIndices;
    if (session.toggleSelection) {
      const nextSelectedAnchorSet = new Set(session.initialSelectedAnchorIndices);
      hitAnchorIndices.forEach((anchorIndex) => {
        if (nextSelectedAnchorSet.has(anchorIndex)) {
          nextSelectedAnchorSet.delete(anchorIndex);
        } else {
          nextSelectedAnchorSet.add(anchorIndex);
        }
      });
      nextSelectedAnchorIndices = Array.from(nextSelectedAnchorSet).sort((a, b) => a - b);
    }

    const primaryAnchorIndex = nextSelectedAnchorIndices.length > 0
      ? nextSelectedAnchorIndices[nextSelectedAnchorIndices.length - 1]
      : null;
    setSelectedPathAnchors(path, nextSelectedAnchorIndices, { primaryAnchorIndex });
    return true;
  }, [
    clearSelectedPathAnchors,
    getAnchorPointForIndex,
    getSceneRectFromPoints,
    getSelectablePathAnchorIndices,
    hasPointSelectionMarqueeExceededThreshold,
    setSelectedPathAnchors,
    toPathScenePoint,
  ]);

  const createFourPointEllipsePathData = useCallback((obj: any): string | null => {
    const rx = Math.max(1, typeof obj.rx === 'number' ? obj.rx : ((obj.width || 1) / 2));
    const ry = Math.max(1, typeof obj.ry === 'number' ? obj.ry : ((obj.height || 1) / 2));
    const kx = rx * CIRCLE_CUBIC_KAPPA;
    const ky = ry * CIRCLE_CUBIC_KAPPA;
    const p0 = toCanvasPoint(obj, rx, 0);
    const p1 = toCanvasPoint(obj, 0, ry);
    const p2 = toCanvasPoint(obj, -rx, 0);
    const p3 = toCanvasPoint(obj, 0, -ry);
    const c01a = toCanvasPoint(obj, rx, ky);
    const c01b = toCanvasPoint(obj, kx, ry);
    const c12a = toCanvasPoint(obj, -kx, ry);
    const c12b = toCanvasPoint(obj, -rx, ky);
    const c23a = toCanvasPoint(obj, -rx, -ky);
    const c23b = toCanvasPoint(obj, -kx, -ry);
    const c30a = toCanvasPoint(obj, kx, -ry);
    const c30b = toCanvasPoint(obj, rx, -ky);
    const r = (value: number) => Math.round(value * 1000) / 1000;
    return [
      `M ${r(p0.x)} ${r(p0.y)}`,
      `C ${r(c01a.x)} ${r(c01a.y)} ${r(c01b.x)} ${r(c01b.y)} ${r(p1.x)} ${r(p1.y)}`,
      `C ${r(c12a.x)} ${r(c12a.y)} ${r(c12b.x)} ${r(c12b.y)} ${r(p2.x)} ${r(p2.y)}`,
      `C ${r(c23a.x)} ${r(c23a.y)} ${r(c23b.x)} ${r(c23b.y)} ${r(p3.x)} ${r(p3.y)}`,
      `C ${r(c30a.x)} ${r(c30a.y)} ${r(c30b.x)} ${r(c30b.y)} ${r(p0.x)} ${r(p0.y)}`,
      'Z',
    ].join(' ');
  }, [toCanvasPoint]);

  const buildPathDataFromPoints = useCallback((points: Point[], closed: boolean): string => {
    if (points.length === 0) return '';
    const rounded = (value: number) => Math.round(value * 1000) / 1000;
    const commands = points.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${rounded(pt.x)} ${rounded(pt.y)}`);
    if (closed) {
      commands.push('Z');
    }
    return commands.join(' ');
  }, []);

  return {
    applyMirroredPathAnchorCurveDrag,
    applyMirroredPathAnchorCurveDragSession,
    applyPointSelectionMarqueeSession,
    applyPointSelectionTransformSession,
    beginPointSelectionTransformSession,
    buildPathDataFromPoints,
    clearSelectedPathAnchors,
    createFourPointEllipsePathData,
    enforcePathAnchorHandleType,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathAnchorDragState,
    getPathNodeHandleType,
    getPointSelectionTransformHandlePoints,
    getSceneRectFromPoints,
    getSelectedPathAnchorIndices,
    getSelectedPathAnchorTransformSnapshot,
    hasPointSelectionMarqueeExceededThreshold,
    hitPointSelectionTransform,
    insertPathPointAtScenePosition,
    isPathCurveDragModifierPressed,
    isPointSelectionToggleModifierPressed,
    movePathAnchorByDelta,
    removeDuplicateClosedPathAnchorControl,
    resolveAnchorFromPathControlKey,
    restoreAllOriginalControls,
    restoreOriginalControls,
    resolveMirroredPathAnchorHandleRole,
    setMirroredPathAnchorDragSessionMoveMode,
    setPathNodeHandleType,
    setSelectedPathAnchors,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    syncVectorHandleModeFromSelection,
    toCanvasPoint,
    toPathCommandPoint,
  };
}

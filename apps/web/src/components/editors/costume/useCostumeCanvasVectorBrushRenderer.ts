import { useCallback, type MutableRefObject } from 'react';
import { Point, type Canvas as FabricCanvas } from 'fabric';
import { getBitmapFillTexturePreset, type BitmapFillTextureId } from '@/lib/background/bitmapFillCore';
import {
  createVectorStrokeBrushRenderStyle,
  getVectorStrokeBrushPreset,
  DEFAULT_VECTOR_STROKE_BRUSH_ID,
  type VectorStrokeBrushRenderStyle,
  type VectorStrokeBrushId,
} from '@/lib/vector/vectorStrokeBrushCore';
import {
  createVectorFillTextureTile,
  getVectorFillTexturePreset,
  DEFAULT_VECTOR_FILL_TEXTURE_ID,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';
import type { CostumeEditorMode } from '@/types';
import {
  CANVAS_SIZE,
  buildClosedPolylinePoints,
  buildPolylineArcTable,
  clampUnit,
  getCubicBezierPoint,
  getDistanceBetweenPoints,
  getQuadraticBezierPoint,
  getVectorStrokeSampleSpacing,
  hashNumberTriplet,
  sampleAngleAlongPolyline,
  samplePointAlongPolyline,
} from './costumeCanvasShared';
import {
  getFabricObjectType,
  getPathCommandType,
  getVectorObjectFillColor,
  getVectorObjectFillTextureId,
  getVectorObjectStrokeBrushId,
  getVectorObjectStrokeColor,
  getVectorStyleTargets,
  pathCommandsDescribeClosedShape,
  vectorObjectSupportsFill,
} from './costumeCanvasVectorRuntime';

interface UseCostumeCanvasVectorBrushRendererOptions {
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  vectorStrokeBrushRenderCacheRef: MutableRefObject<Map<string, VectorStrokeBrushRenderStyle>>;
  vectorStrokeTextureCacheRef: MutableRefObject<Map<string, HTMLImageElement | null>>;
  vectorStrokeTexturePendingRef: MutableRefObject<Set<string>>;
}

export function useCostumeCanvasVectorBrushRenderer({
  editorModeRef,
  fabricCanvasRef,
  vectorStrokeBrushRenderCacheRef,
  vectorStrokeTextureCacheRef,
  vectorStrokeTexturePendingRef,
}: UseCostumeCanvasVectorBrushRendererOptions) {
  const resolveVectorTextureSource = useCallback((texturePath?: string | null) => {
    const normalizedTexturePath = texturePath?.trim();
    if (!normalizedTexturePath) {
      return null;
    }

    if (vectorStrokeTextureCacheRef.current.has(normalizedTexturePath)) {
      return vectorStrokeTextureCacheRef.current.get(normalizedTexturePath) ?? null;
    }

    if (!vectorStrokeTexturePendingRef.current.has(normalizedTexturePath)) {
      vectorStrokeTexturePendingRef.current.add(normalizedTexturePath);
      const image = new Image();
      image.onload = () => {
        vectorStrokeTexturePendingRef.current.delete(normalizedTexturePath);
        vectorStrokeTextureCacheRef.current.set(normalizedTexturePath, image);
        fabricCanvasRef.current?.requestRenderAll();
      };
      image.onerror = () => {
        vectorStrokeTexturePendingRef.current.delete(normalizedTexturePath);
        vectorStrokeTextureCacheRef.current.set(normalizedTexturePath, null);
        fabricCanvasRef.current?.requestRenderAll();
      };
      image.src = normalizedTexturePath;
    }

    return null;
  }, [fabricCanvasRef, vectorStrokeTextureCacheRef, vectorStrokeTexturePendingRef]);

  const resolveVectorStrokeTextureSource = useCallback((brushId: VectorStrokeBrushId) => {
    const preset = getVectorStrokeBrushPreset(brushId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const resolveVectorStrokeBrushRenderStyle = useCallback((brushId: VectorStrokeBrushId, strokeColor: string, strokeWidth: number) => {
    const preset = getVectorStrokeBrushPreset(brushId);
    const texturePath = preset.texturePath?.trim();
    const textureSource = texturePath
      ? resolveVectorStrokeTextureSource(brushId)
      : null;

    if (texturePath && !textureSource && !vectorStrokeTextureCacheRef.current.has(texturePath)) {
      return null;
    }

    const cacheKey = [
      brushId,
      strokeColor,
      strokeWidth.toFixed(3),
      texturePath ?? 'builtin',
      textureSource ? 'ready' : 'fallback',
    ].join('|');
    const cached = vectorStrokeBrushRenderCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const renderStyle = createVectorStrokeBrushRenderStyle(
      brushId,
      strokeColor,
      strokeWidth,
      textureSource,
    );
    if (vectorStrokeBrushRenderCacheRef.current.size >= 256) {
      vectorStrokeBrushRenderCacheRef.current.clear();
    }
    vectorStrokeBrushRenderCacheRef.current.set(cacheKey, renderStyle);
    return renderStyle;
  }, [resolveVectorStrokeTextureSource, vectorStrokeBrushRenderCacheRef, vectorStrokeTextureCacheRef]);

  const resolveVectorFillTextureSource = useCallback((textureId: VectorFillTextureId) => {
    const preset = getVectorFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const resolveBitmapFillTextureSource = useCallback((textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const transformVectorLocalPointToScene = useCallback((obj: any, x: number, y: number, pathOffset?: Point | null) => {
    const offsetX = pathOffset?.x ?? 0;
    const offsetY = pathOffset?.y ?? 0;
    return new Point(x - offsetX, y - offsetY).transform(obj.calcTransformMatrix());
  }, []);

  const getVectorObjectContourPaths = useCallback((obj: any): Array<{ closed: boolean; points: Point[] }> => {
    if (!obj || typeof obj.calcTransformMatrix !== 'function') {
      return [];
    }

    const objectType = getFabricObjectType(obj);
    const strokeSampleSpacing = getVectorStrokeSampleSpacing(
      typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
    );
    const transformPoint = (x: number, y: number, pathOffset?: Point | null) => (
      transformVectorLocalPointToScene(obj, x, y, pathOffset)
    );

    if (objectType === 'line' && typeof obj.calcLinePoints === 'function') {
      const points = obj.calcLinePoints();
      return [{
        closed: false,
        points: [
          transformPoint(points.x1, points.y1),
          transformPoint(points.x2, points.y2),
        ],
      }];
    }

    if (objectType === 'rect') {
      const halfWidth = (typeof obj.width === 'number' ? obj.width : 0) / 2;
      const halfHeight = (typeof obj.height === 'number' ? obj.height : 0) / 2;
      return [{
        closed: true,
        points: [
          transformPoint(-halfWidth, -halfHeight),
          transformPoint(halfWidth, -halfHeight),
          transformPoint(halfWidth, halfHeight),
          transformPoint(-halfWidth, halfHeight),
        ],
      }];
    }

    if (objectType === 'ellipse' || objectType === 'circle') {
      const radiusX = typeof obj.rx === 'number' ? obj.rx : ((typeof obj.width === 'number' ? obj.width : 0) / 2);
      const radiusY = typeof obj.ry === 'number' ? obj.ry : ((typeof obj.height === 'number' ? obj.height : 0) / 2);
      const ellipseCircumference = Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
      const segments = Math.max(24, Math.ceil(ellipseCircumference / strokeSampleSpacing));
      const points: Point[] = [];
      for (let index = 0; index < segments; index += 1) {
        const angle = (index / segments) * Math.PI * 2;
        points.push(transformPoint(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY));
      }
      return [{ closed: true, points }];
    }

    if ((objectType === 'polygon' || objectType === 'polyline') && Array.isArray(obj.points) && obj.points.length > 1) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      return [{
        closed: objectType === 'polygon',
        points: obj.points.map((point: { x: number; y: number }) => transformPoint(point.x, point.y, pathOffset)),
      }];
    }

    if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      const sampledPoints: Point[] = [];
      let currentPoint: Point | null = null;
      let subpathStart: Point | null = null;
      const targetSpacing = strokeSampleSpacing;

      const appendPoint = (point: Point) => {
        const lastPoint = sampledPoints[sampledPoints.length - 1];
        if (!lastPoint || getDistanceBetweenPoints(lastPoint, point) > 0.5) {
          sampledPoints.push(point);
        }
      };

      for (const command of obj.path) {
        const commandType = getPathCommandType(command);
        if (commandType === 'M') {
          currentPoint = transformPoint(command[1], command[2], pathOffset);
          subpathStart = currentPoint;
          appendPoint(currentPoint);
          continue;
        }
        if (!currentPoint) {
          continue;
        }
        if (commandType === 'L') {
          const endPoint = transformPoint(command[1], command[2], pathOffset);
          appendPoint(endPoint);
          currentPoint = endPoint;
          continue;
        }
        if (commandType === 'Q') {
          const control = transformPoint(command[1], command[2], pathOffset);
          const endPoint = transformPoint(command[3], command[4], pathOffset);
          const estimatedLength =
            getDistanceBetweenPoints(currentPoint, control) +
            getDistanceBetweenPoints(control, endPoint);
          const segments = Math.max(8, Math.ceil(estimatedLength / targetSpacing));
          for (let segmentIndex = 1; segmentIndex <= segments; segmentIndex += 1) {
            appendPoint(getQuadraticBezierPoint(currentPoint, control, endPoint, segmentIndex / segments));
          }
          currentPoint = endPoint;
          continue;
        }
        if (commandType === 'C') {
          const control1 = transformPoint(command[1], command[2], pathOffset);
          const control2 = transformPoint(command[3], command[4], pathOffset);
          const endPoint = transformPoint(command[5], command[6], pathOffset);
          const estimatedLength =
            getDistanceBetweenPoints(currentPoint, control1) +
            getDistanceBetweenPoints(control1, control2) +
            getDistanceBetweenPoints(control2, endPoint);
          const segments = Math.max(10, Math.ceil(estimatedLength / targetSpacing));
          for (let segmentIndex = 1; segmentIndex <= segments; segmentIndex += 1) {
            appendPoint(getCubicBezierPoint(currentPoint, control1, control2, endPoint, segmentIndex / segments));
          }
          currentPoint = endPoint;
          continue;
        }
        if (commandType === 'Z' && subpathStart) {
          appendPoint(subpathStart);
          currentPoint = subpathStart;
        }
      }

      return sampledPoints.length > 1
        ? [{ closed: pathCommandsDescribeClosedShape(obj.path), points: sampledPoints }]
        : [];
    }

    return [];
  }, [transformVectorLocalPointToScene]);

  const drawVectorStrokeBrushPath = useCallback((
    ctx: CanvasRenderingContext2D,
    points: Point[],
    closed: boolean,
    renderStyle: VectorStrokeBrushRenderStyle,
  ) => {
    if (renderStyle.kind !== 'bitmap-dab' || renderStyle.dabs.length === 0 || points.length < 2) {
      return;
    }

    const pathPoints = buildClosedPolylinePoints(points, closed);
    if (pathPoints.length < 2) {
      return;
    }
    const { cumulativeLengths, totalLength } = buildPolylineArcTable(pathPoints);
    if (totalLength <= 0) {
      return;
    }

    const tangentWindow = Math.max(1, renderStyle.spacing * 0.85);

    const renderDabAt = (distanceAlongPath: number, dabIndex: number) => {
      const point = samplePointAlongPolyline(
        pathPoints,
        cumulativeLengths,
        totalLength,
        distanceAlongPath,
        closed,
      );
      const angle = sampleAngleAlongPolyline(
        pathPoints,
        cumulativeLengths,
        totalLength,
        distanceAlongPath,
        closed,
        tangentWindow,
      );
      const dab = renderStyle.dabs[dabIndex % renderStyle.dabs.length];
      const scaleRandom = hashNumberTriplet(point.x, point.y, dabIndex * 0.17);
      const opacityRandom = hashNumberTriplet(point.y, point.x, dabIndex * 0.23);
      const rotationRandom = hashNumberTriplet(point.y, point.x, dabIndex * 0.41);
      const scatterAngleRandom = hashNumberTriplet(point.x, angle, dabIndex * 0.83);
      const scatterRadiusRandom = hashNumberTriplet(point.y, angle, dabIndex * 1.29);
      const jitterScale = 1 + (((scaleRandom * 2) - 1) * renderStyle.scaleJitter);
      const jitterRotation = ((rotationRandom * 2) - 1) * renderStyle.rotationJitter;
      const jitterOpacity = clampUnit(1 + (((opacityRandom * 2) - 1) * renderStyle.opacityJitter));
      const scatterAngle = scatterAngleRandom * Math.PI * 2;
      const scatterRadius = renderStyle.scatter > 0 ? scatterRadiusRandom * renderStyle.scatter : 0;
      const renderX = point.x + Math.cos(scatterAngle) * scatterRadius;
      const renderY = point.y + Math.sin(scatterAngle) * scatterRadius;
      const drawWidth = Math.max(1, dab.width * jitterScale);
      const drawHeight = Math.max(1, dab.height * jitterScale);

      ctx.save();
      ctx.globalAlpha = dab.opacity * jitterOpacity;
      ctx.translate(renderX, renderY);
      ctx.rotate(angle + jitterRotation);
      ctx.drawImage(
        dab.image,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight,
      );
      ctx.restore();
    };

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    let dabIndex = 0;
    for (let distanceAlongPath = 0; distanceAlongPath < totalLength; distanceAlongPath += renderStyle.spacing) {
      renderDabAt(distanceAlongPath, dabIndex);
      dabIndex += 1;
    }
    if (!closed) {
      renderDabAt(totalLength, dabIndex);
    }
    ctx.restore();
  }, []);

  const traceVectorObjectLocalPath = useCallback((ctx: CanvasRenderingContext2D, obj: any): boolean => {
    const objectType = getFabricObjectType(obj);

    if (objectType === 'rect') {
      const width = typeof obj.width === 'number' ? obj.width : 0;
      const height = typeof obj.height === 'number' ? obj.height : 0;
      ctx.beginPath();
      ctx.rect(-width / 2, -height / 2, width, height);
      return true;
    }

    if (objectType === 'ellipse' || objectType === 'circle') {
      const radiusX = typeof obj.rx === 'number' ? obj.rx : ((typeof obj.width === 'number' ? obj.width : 0) / 2);
      const radiusY = typeof obj.ry === 'number' ? obj.ry : ((typeof obj.height === 'number' ? obj.height : 0) / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      return true;
    }

    if (objectType === 'polygon' && Array.isArray(obj.points) && obj.points.length > 1) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      ctx.beginPath();
      obj.points.forEach((point: { x: number; y: number }, index: number) => {
        const localX = point.x - pathOffset.x;
        const localY = point.y - pathOffset.y;
        if (index === 0) {
          ctx.moveTo(localX, localY);
        } else {
          ctx.lineTo(localX, localY);
        }
      });
      ctx.closePath();
      return true;
    }

    if (objectType === 'path' && Array.isArray(obj.path) && pathCommandsDescribeClosedShape(obj.path)) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      ctx.beginPath();
      for (const command of obj.path as any[]) {
        if (!Array.isArray(command) || typeof command[0] !== 'string') {
          continue;
        }
        switch (command[0].toUpperCase()) {
          case 'M':
            ctx.moveTo(Number(command[1]) - pathOffset.x, Number(command[2]) - pathOffset.y);
            break;
          case 'L':
            ctx.lineTo(Number(command[1]) - pathOffset.x, Number(command[2]) - pathOffset.y);
            break;
          case 'Q':
            ctx.quadraticCurveTo(
              Number(command[1]) - pathOffset.x,
              Number(command[2]) - pathOffset.y,
              Number(command[3]) - pathOffset.x,
              Number(command[4]) - pathOffset.y,
            );
            break;
          case 'C':
            ctx.bezierCurveTo(
              Number(command[1]) - pathOffset.x,
              Number(command[2]) - pathOffset.y,
              Number(command[3]) - pathOffset.x,
              Number(command[4]) - pathOffset.y,
              Number(command[5]) - pathOffset.x,
              Number(command[6]) - pathOffset.y,
            );
            break;
          case 'Z':
            ctx.closePath();
            break;
        }
      }
      return true;
    }

    return false;
  }, []);

  const renderVectorBrushStrokeOverlay = useCallback((ctx: CanvasRenderingContext2D, options: { clear?: boolean } = {}) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (options.clear !== false) {
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    if (!fabricCanvas || editorModeRef.current !== 'vector') {
      return;
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    for (const obj of fabricCanvas.getObjects() as any[]) {
      if (getVectorStyleTargets(obj).length === 0) {
        continue;
      }

      const fillTextureId = getVectorObjectFillTextureId(obj);
      const fillColor = getVectorObjectFillColor(obj);
      if (vectorObjectSupportsFill(obj) && fillTextureId !== DEFAULT_VECTOR_FILL_TEXTURE_ID && fillColor) {
        const textureTile = createVectorFillTextureTile(
          fillTextureId,
          fillColor,
          resolveVectorFillTextureSource(fillTextureId),
        );
        if (textureTile && typeof obj.calcTransformMatrix === 'function') {
          ctx.save();
          const transform = obj.calcTransformMatrix();
          ctx.transform(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]);
          if (traceVectorObjectLocalPath(ctx, obj)) {
            const pattern = ctx.createPattern(textureTile, 'repeat');
            if (pattern) {
              ctx.fillStyle = pattern;
              ctx.globalAlpha = typeof obj.opacity === 'number' ? obj.opacity : 1;
              ctx.clip();
              ctx.fillRect(-CANVAS_SIZE, -CANVAS_SIZE, CANVAS_SIZE * 2, CANVAS_SIZE * 2);
            }
          }
          ctx.restore();
        }
      }

      const brushId = getVectorObjectStrokeBrushId(obj);
      if (brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID) {
        continue;
      }
      const strokeColor = getVectorObjectStrokeColor(obj);
      const strokeWidth = typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 0;
      if (!strokeColor || strokeWidth <= 0) {
        continue;
      }

      const renderStyle = resolveVectorStrokeBrushRenderStyle(
        brushId,
        strokeColor,
        strokeWidth,
      );
      if (!renderStyle || renderStyle.kind !== 'bitmap-dab') {
        continue;
      }
      const objectOpacity = typeof obj.opacity === 'number' ? obj.opacity : 1;
      const resolvedRenderStyle = objectOpacity === 1
        ? renderStyle
        : {
            ...renderStyle,
            dabs: renderStyle.dabs.map((dab) => ({
              ...dab,
              opacity: dab.opacity * objectOpacity,
            })),
          };

      const contourPaths = getVectorObjectContourPaths(obj);
      if (contourPaths.length === 0) {
        continue;
      }

      for (const contour of contourPaths) {
        drawVectorStrokeBrushPath(ctx, contour.points, contour.closed, resolvedRenderStyle);
      }
    }

    ctx.restore();
  }, [
    drawVectorStrokeBrushPath,
    editorModeRef,
    fabricCanvasRef,
    getVectorObjectContourPaths,
    resolveVectorFillTextureSource,
    resolveVectorStrokeBrushRenderStyle,
    traceVectorObjectLocalPath,
  ]);

  return {
    renderVectorBrushStrokeOverlay,
    resolveBitmapFillTextureSource,
  };
}

/**
 * Flood fill algorithm for the bucket tool
 * Uses scanline flood fill for better performance
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse a hex color string to RGB values
 */
export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0, a: 255 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
    a: 255,
  };
}

/**
 * Check if two colors match within a tolerance
 */
function colorsMatch(
  data: Uint8ClampedArray,
  pos: number,
  target: RGB,
  tolerance: number
): boolean {
  const r = data[pos];
  const g = data[pos + 1];
  const b = data[pos + 2];
  const a = data[pos + 3];

  return (
    Math.abs(r - target.r) <= tolerance &&
    Math.abs(g - target.g) <= tolerance &&
    Math.abs(b - target.b) <= tolerance &&
    Math.abs(a - target.a) <= tolerance
  );
}

/**
 * Set pixel color at position
 */
function setPixel(data: Uint8ClampedArray, pos: number, fill: RGB): void {
  data[pos] = fill.r;
  data[pos + 1] = fill.g;
  data[pos + 2] = fill.b;
  data[pos + 3] = fill.a;
}

/**
 * Get pixel color at position
 */
function getPixel(data: Uint8ClampedArray, pos: number): RGB {
  return {
    r: data[pos],
    g: data[pos + 1],
    b: data[pos + 2],
    a: data[pos + 3],
  };
}

/**
 * Check if fill color is the same as target color
 */
function colorsEqual(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/**
 * Perform scanline flood fill on ImageData
 * @param imageData - The ImageData to modify
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate
 * @param fillColor - The color to fill with
 * @param tolerance - Color matching tolerance (0-255)
 * @returns Modified ImageData
 */
export function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: RGB,
  tolerance: number = 32
): ImageData {
  const { data, width, height } = imageData;

  // Clamp coordinates
  startX = Math.floor(startX);
  startY = Math.floor(startY);

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return imageData;
  }

  const startPos = (startY * width + startX) * 4;
  const targetColor = getPixel(data, startPos);

  // Don't fill if target color is the same as fill color
  if (colorsEqual(targetColor, fillColor)) {
    return imageData;
  }

  // Stack for scanline algorithm
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;

    // Skip if out of bounds
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const pos = (y * width + x) * 4;

    // Skip if already visited
    if (visited.has(pos)) {
      continue;
    }

    // Skip if color doesn't match target
    if (!colorsMatch(data, pos, targetColor, tolerance)) {
      continue;
    }

    // Find left edge
    let leftX = x;
    while (leftX > 0) {
      const leftPos = (y * width + (leftX - 1)) * 4;
      if (!colorsMatch(data, leftPos, targetColor, tolerance)) {
        break;
      }
      leftX--;
    }

    // Find right edge
    let rightX = x;
    while (rightX < width - 1) {
      const rightPos = (y * width + (rightX + 1)) * 4;
      if (!colorsMatch(data, rightPos, targetColor, tolerance)) {
        break;
      }
      rightX++;
    }

    // Fill the scanline and check above/below
    for (let fillX = leftX; fillX <= rightX; fillX++) {
      const fillPos = (y * width + fillX) * 4;

      if (visited.has(fillPos)) {
        continue;
      }

      visited.add(fillPos);
      setPixel(data, fillPos, fillColor);

      // Add pixels above and below to stack
      if (y > 0) {
        const abovePos = ((y - 1) * width + fillX) * 4;
        if (!visited.has(abovePos) && colorsMatch(data, abovePos, targetColor, tolerance)) {
          stack.push([fillX, y - 1]);
        }
      }

      if (y < height - 1) {
        const belowPos = ((y + 1) * width + fillX) * 4;
        if (!visited.has(belowPos) && colorsMatch(data, belowPos, targetColor, tolerance)) {
          stack.push([fillX, y + 1]);
        }
      }
    }
  }

  return imageData;
}

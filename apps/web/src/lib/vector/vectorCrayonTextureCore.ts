import Color from 'color';

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hash2d(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function createTextureCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function sampleVectorCrayonTexture(x: number, y: number, seed: number) {
  const grain = hash2d(x * 0.63 + seed * 4.7, y * 0.59 + seed * 9.1);
  const voidNoise = hash2d(x * 1.41 + seed * 2.9, y * 1.27 + seed * 6.1);
  let alpha = 0.16 + grain * 0.84;
  if (voidNoise < 0.08) {
    alpha *= 0.05;
  } else if (voidNoise < 0.18) {
    alpha *= 0.18;
  } else if (voidNoise < 0.32) {
    alpha *= 0.42;
  }

  return {
    alpha: clampUnit(alpha),
    colorNoise: (hash2d(x * 0.29 + seed * 3.1, y * 0.31 + seed * 8.3) - 0.5) * 30,
  };
}

export function createVectorCrayonDab(
  color: string,
  width: number,
  height: number,
  seed: number,
) {
  const canvas = createTextureCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const [baseRed, baseGreen, baseBlue] = Color(color).rgb().array();
  const radiusX = Math.max(1, width * (0.4 + hash2d(seed, 2.1) * 0.05));
  const radiusY = Math.max(1, height * (0.4 + hash2d(seed, 2.6) * 0.05));
  const imageData = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - width / 2) / radiusX;
      const dy = (y + 0.5 - height / 2) / radiusY;
      const ellipseDistance = Math.sqrt(dx * dx + dy * dy);
      const edgeNoise = (hash2d(x * 0.13 + seed * 12.3, y * 0.19 + seed * 7.7) - 0.5) * 0.28;
      const body = 1 - smoothstep(0.58 + edgeNoise, 1.08 + edgeNoise, ellipseDistance);
      if (body <= 0.001) {
        continue;
      }

      const sample = sampleVectorCrayonTexture(x, y, seed);
      const pixelIndex = (y * width + x) * 4;
      imageData.data[pixelIndex] = clampByte(baseRed + sample.colorNoise);
      imageData.data[pixelIndex + 1] = clampByte(baseGreen + sample.colorNoise);
      imageData.data[pixelIndex + 2] = clampByte(baseBlue + sample.colorNoise);
      imageData.data[pixelIndex + 3] = clampByte(body * sample.alpha * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function createVectorCrayonTile(
  fillColor: string,
  tileSize: number,
  opacity: number,
) {
  const canvas = createTextureCanvas(tileSize, tileSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const [baseRed, baseGreen, baseBlue] = Color(fillColor).rgb().array();
  const imageData = ctx.createImageData(tileSize, tileSize);
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const sample = sampleVectorCrayonTexture(x, y, 1);
      const pixelIndex = (y * tileSize + x) * 4;
      imageData.data[pixelIndex] = clampByte(baseRed + sample.colorNoise);
      imageData.data[pixelIndex + 1] = clampByte(baseGreen + sample.colorNoise);
      imageData.data[pixelIndex + 2] = clampByte(baseBlue + sample.colorNoise);
      imageData.data[pixelIndex + 3] = clampByte(sample.alpha * opacity * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

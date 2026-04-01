import { getCostumeBoundsInAssetSpace } from '@/lib/costume/costumeAssetFrame';
import type { Costume } from '@/types';

interface ShelfObjectThumbnailProps {
  name: string;
  costumes: Costume[];
  currentCostumeIndex: number;
}

export function ShelfObjectThumbnail({
  name,
  costumes,
  currentCostumeIndex,
}: ShelfObjectThumbnailProps) {
  if (costumes.length === 0) {
    return <span className="text-sm">📦</span>;
  }

  const maxCostumeIndex = Math.max(0, costumes.length - 1);
  const safeCostumeIndex = Math.min(Math.max(0, currentCostumeIndex), maxCostumeIndex);
  const costume = costumes[safeCostumeIndex];
  const bounds = costume?.bounds;

  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const scale = Math.min(1, 24 / Math.max(bounds.width, bounds.height));
    const localBounds = getCostumeBoundsInAssetSpace(bounds, costume?.assetFrame);

    return (
      <div
        className="absolute"
        style={{
          backgroundImage: `url(${costume.assetId})`,
          backgroundPosition: localBounds ? `${-localBounds.x}px ${-localBounds.y}px` : '0 0',
          backgroundSize: costume?.assetFrame
            ? `${costume.assetFrame.width}px ${costume.assetFrame.height}px`
            : '1024px 1024px',
          backgroundRepeat: 'no-repeat',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: bounds.width,
          height: bounds.height,
          left: '50%',
          top: '50%',
          marginLeft: (-bounds.width * scale) / 2,
          marginTop: (-bounds.height * scale) / 2,
        }}
      />
    );
  }

  return (
    <img
      src={costume?.assetId}
      alt={name}
      className="h-full w-full object-contain"
    />
  );
}

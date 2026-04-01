import * as React from 'react';
import {
  Activity as LucideActivity,
  AlignCenter as LucideAlignCenter,
  AlignLeft as LucideAlignLeft,
  AlignRight as LucideAlignRight,
  ArrowLeft as LucideArrowLeft,
  Bot as LucideBot,
  Camera as LucideCamera,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle2,
  CheckIcon as LucideCheckIcon,
  ChevronDown as LucideChevronDown,
  ChevronDownIcon as LucideChevronDownIcon,
  ChevronRight as LucideChevronRight,
  ChevronRightIcon as LucideChevronRightIcon,
  ChevronUpIcon as LucideChevronUpIcon,
  Circle as LucideCircle,
  CircleIcon as LucideCircleIcon,
  Clipboard as LucideClipboard,
  Code as LucideCode,
  Component as LucideComponent,
  Copy as LucideCopy,
  Crosshair as LucideCrosshair,
  Download as LucideDownload,
  Eraser as LucideEraser,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  FileCode2 as LucideFileCode2,
  FlipHorizontal2 as LucideFlipHorizontal2,
  FlipVertical2 as LucideFlipVertical2,
  Folder as LucideFolder,
  FolderOpen as LucideFolderOpen,
  FolderPlus as LucideFolderPlus,
  GripVertical as LucideGripVertical,
  Image as LucideImage,
  ImageOff as LucideImageOff,
  Layers3 as LucideLayers3,
  Library as LucideLibrary,
  Link as LucideLink,
  LayoutGrid as LucideLayoutGrid,
  Loader2 as LucideLoader2,
  LoaderCircle as LucideLoaderCircle,
  LocateFixed as LucideLocateFixed,
  Lock as LucideLock,
  LockOpen as LucideLockOpen,
  Maximize2 as LucideMaximize2,
  Mic as LucideMic,
  Minimize2 as LucideMinimize2,
  Minus as LucideMinus,
  MoreHorizontal as LucideMoreHorizontal,
  MousePointer2 as LucideMousePointer2,
  Music as LucideMusic,
  PaintBucket as LucidePaintBucket,
  Paintbrush as LucidePaintbrush,
  Palette as LucidePalette,
  Pencil as LucidePencil,
  PenTool as LucidePenTool,
  Pin as LucidePin,
  PipetteIcon as LucidePipetteIcon,
  Play as LucidePlay,
  Plus as LucidePlus,
  Redo2 as LucideRedo2,
  RotateCcw as LucideRotateCcw,
  RotateCw as LucideRotateCw,
  Rows3 as LucideRows3,
  Save as LucideSave,
  Scissors as LucideScissors,
  Search as LucideSearch,
  Settings2 as LucideSettings2,
  Shapes as LucideShapes,
  Sparkles as LucideSparkles,
  Square as LucideSquare,
  SquareCheck as LucideSquareCheck,
  Star as LucideStar,
  Trash2 as LucideTrash2,
  Triangle as LucideTriangle,
  TriangleAlert as LucideTriangleAlert,
  Type as LucideType,
  Undo2 as LucideUndo2,
  Unlink as LucideUnlink,
  Upload as LucideUpload,
  User as LucideUser,
  Volume2 as LucideVolume2,
  VolumeX as LucideVolumeX,
  WandSparkles as LucideWandSparkles,
  Wrench as LucideWrench,
  X as LucideX,
  XIcon as LucideXIcon,
  type LucideProps,
} from 'lucide-react';
import {
  AppIcon as RegistryIcon,
  getAppIconDataUri,
  renderAppIconSvg,
  type AppIconName,
} from '@/lib/icons/appIcons';

const LIBRARY_ICONS = {
  Activity: LucideActivity,
  AlignCenter: LucideAlignCenter,
  AlignLeft: LucideAlignLeft,
  AlignRight: LucideAlignRight,
  ArrowLeft: LucideArrowLeft,
  Bot: LucideBot,
  Camera: LucideCamera,
  Check: LucideCheck,
  CheckCircle2: LucideCheckCircle2,
  CheckIcon: LucideCheckIcon,
  ChevronDown: LucideChevronDown,
  ChevronDownIcon: LucideChevronDownIcon,
  ChevronRight: LucideChevronRight,
  ChevronRightIcon: LucideChevronRightIcon,
  ChevronUpIcon: LucideChevronUpIcon,
  Circle: LucideCircle,
  CircleIcon: LucideCircleIcon,
  Clipboard: LucideClipboard,
  Code: LucideCode,
  Component: LucideComponent,
  Copy: LucideCopy,
  Crosshair: LucideCrosshair,
  Download: LucideDownload,
  Eraser: LucideEraser,
  Eye: LucideEye,
  EyeOff: LucideEyeOff,
  FileCode2: LucideFileCode2,
  FlipHorizontal2: LucideFlipHorizontal2,
  FlipVertical2: LucideFlipVertical2,
  Folder: LucideFolder,
  FolderOpen: LucideFolderOpen,
  FolderPlus: LucideFolderPlus,
  GripVertical: LucideGripVertical,
  Image: LucideImage,
  ImageOff: LucideImageOff,
  Layers3: LucideLayers3,
  Library: LucideLibrary,
  Link: LucideLink,
  LayoutGrid: LucideLayoutGrid,
  Loader2: LucideLoader2,
  LoaderCircle: LucideLoaderCircle,
  LocateFixed: LucideLocateFixed,
  Lock: LucideLock,
  LockOpen: LucideLockOpen,
  Maximize2: LucideMaximize2,
  Mic: LucideMic,
  Minimize2: LucideMinimize2,
  Minus: LucideMinus,
  MoreHorizontal: LucideMoreHorizontal,
  MousePointer2: LucideMousePointer2,
  Music: LucideMusic,
  PaintBucket: LucidePaintBucket,
  Paintbrush: LucidePaintbrush,
  Palette: LucidePalette,
  Pencil: LucidePencil,
  PenTool: LucidePenTool,
  Pin: LucidePin,
  PipetteIcon: LucidePipetteIcon,
  Play: LucidePlay,
  Plus: LucidePlus,
  Redo2: LucideRedo2,
  RotateCcw: LucideRotateCcw,
  RotateCw: LucideRotateCw,
  Rows3: LucideRows3,
  Save: LucideSave,
  Scissors: LucideScissors,
  Search: LucideSearch,
  Settings2: LucideSettings2,
  Shapes: LucideShapes,
  Sparkles: LucideSparkles,
  Square: LucideSquare,
  SquareCheck: LucideSquareCheck,
  Star: LucideStar,
  Trash2: LucideTrash2,
  Triangle: LucideTriangle,
  TriangleAlert: LucideTriangleAlert,
  Type: LucideType,
  Undo2: LucideUndo2,
  Unlink: LucideUnlink,
  Upload: LucideUpload,
  User: LucideUser,
  Volume2: LucideVolume2,
  VolumeX: LucideVolumeX,
  WandSparkles: LucideWandSparkles,
  Wrench: LucideWrench,
  X: LucideX,
  XIcon: LucideXIcon,
} as const;

export type LibraryIconName = keyof typeof LIBRARY_ICONS;
export type IconName = LibraryIconName | AppIconName;

type CustomIconProps = Omit<LucideProps, 'ref'> & {
  title?: string;
};

function createRegistryIconComponent(name: AppIconName) {
  return function RegistryIconComponent({
    className,
    color = 'currentColor',
    size = 24,
    title,
  }: CustomIconProps) {
    return (
      <RegistryIcon
        className={className}
        color={String(color)}
        decorative={!title}
        name={name}
        size={size}
        title={title}
      />
    );
  };
}

const CUSTOM_ICON_COMPONENTS = {
  blocklyEventClick: createRegistryIconComponent('blocklyEventClick'),
  blocklyEventForever: createRegistryIconComponent('blocklyEventForever'),
  blocklyEventInventory: createRegistryIconComponent('blocklyEventInventory'),
  blocklyEventKey: createRegistryIconComponent('blocklyEventKey'),
  blocklyEventStart: createRegistryIconComponent('blocklyEventStart'),
  blocklyEventWorld: createRegistryIconComponent('blocklyEventWorld'),
  blocklyStagePicker: createRegistryIconComponent('blocklyStagePicker'),
  variableBoolean: createRegistryIconComponent('variableBoolean'),
  variableFloat: createRegistryIconComponent('variableFloat'),
  variableInteger: createRegistryIconComponent('variableInteger'),
  variableString: createRegistryIconComponent('variableString'),
} as const satisfies Record<AppIconName, React.ComponentType<CustomIconProps>>;

const ICON_COMPONENTS = {
  ...LIBRARY_ICONS,
  ...CUSTOM_ICON_COMPONENTS,
} as const satisfies Record<IconName, React.ComponentType<CustomIconProps>>;

export function getIconComponent(name: IconName): React.ComponentType<CustomIconProps> {
  return ICON_COMPONENTS[name];
}

export function Icon({ name, ...props }: { name: IconName } & CustomIconProps) {
  return React.createElement(ICON_COMPONENTS[name], props);
}

export function hasIcon(name: string): name is IconName {
  return name in LIBRARY_ICONS || name in CUSTOM_ICON_COMPONENTS;
}

export { getAppIconDataUri, renderAppIconSvg, type AppIconName };
export const AppIcon = RegistryIcon;

export const Activity = LucideActivity;
export const AlignCenter = LucideAlignCenter;
export const AlignLeft = LucideAlignLeft;
export const AlignRight = LucideAlignRight;
export const ArrowLeft = LucideArrowLeft;
export const Bot = LucideBot;
export const Camera = LucideCamera;
export const Check = LucideCheck;
export const CheckCircle2 = LucideCheckCircle2;
export const CheckIcon = LucideCheckIcon;
export const ChevronDown = LucideChevronDown;
export const ChevronDownIcon = LucideChevronDownIcon;
export const ChevronRight = LucideChevronRight;
export const ChevronRightIcon = LucideChevronRightIcon;
export const ChevronUpIcon = LucideChevronUpIcon;
export const Circle = LucideCircle;
export const CircleIcon = LucideCircleIcon;
export const Clipboard = LucideClipboard;
export const Code = LucideCode;
export const Component = LucideComponent;
export const Copy = LucideCopy;
export const Crosshair = LucideCrosshair;
export const Download = LucideDownload;
export const Eraser = LucideEraser;
export const Eye = LucideEye;
export const EyeOff = LucideEyeOff;
export const FileCode2 = LucideFileCode2;
export const FlipHorizontal2 = LucideFlipHorizontal2;
export const FlipVertical2 = LucideFlipVertical2;
export const Folder = LucideFolder;
export const FolderOpen = LucideFolderOpen;
export const FolderPlus = LucideFolderPlus;
export const GripVertical = LucideGripVertical;
export const Image = LucideImage;
export const ImageOff = LucideImageOff;
export const Layers3 = LucideLayers3;
export const Library = LucideLibrary;
export const Link = LucideLink;
export const LayoutGrid = LucideLayoutGrid;
export const Loader2 = LucideLoader2;
export const LoaderCircle = LucideLoaderCircle;
export const LocateFixed = LucideLocateFixed;
export const Lock = LucideLock;
export const LockOpen = LucideLockOpen;
export const Maximize2 = LucideMaximize2;
export const Mic = LucideMic;
export const Minimize2 = LucideMinimize2;
export const Minus = LucideMinus;
export const MoreHorizontal = LucideMoreHorizontal;
export const MousePointer2 = LucideMousePointer2;
export const Music = LucideMusic;
export const PaintBucket = LucidePaintBucket;
export const Paintbrush = LucidePaintbrush;
export const Palette = LucidePalette;
export const Pencil = LucidePencil;
export const PenTool = LucidePenTool;
export const Pin = LucidePin;
export const PipetteIcon = LucidePipetteIcon;
export const Play = LucidePlay;
export const Plus = LucidePlus;
export const Redo2 = LucideRedo2;
export const RotateCcw = LucideRotateCcw;
export const RotateCw = LucideRotateCw;
export const Rows3 = LucideRows3;
export const Save = LucideSave;
export const Scissors = LucideScissors;
export const Search = LucideSearch;
export const Settings2 = LucideSettings2;
export const Shapes = LucideShapes;
export const Sparkles = LucideSparkles;
export const Square = LucideSquare;
export const SquareCheck = LucideSquareCheck;
export const Star = LucideStar;
export const Trash2 = LucideTrash2;
export const Triangle = LucideTriangle;
export const TriangleAlert = LucideTriangleAlert;
export const Type = LucideType;
export const Undo2 = LucideUndo2;
export const Unlink = LucideUnlink;
export const Upload = LucideUpload;
export const User = LucideUser;
export const Volume2 = LucideVolume2;
export const VolumeX = LucideVolumeX;
export const WandSparkles = LucideWandSparkles;
export const Wrench = LucideWrench;
export const X = LucideX;
export const XIcon = LucideXIcon;

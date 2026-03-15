type EditableTextObject = {
  type?: string;
  isEditing?: boolean;
  enterEditing: (...args: any[]) => void;
  selectAll?: () => unknown;
  hiddenTextareaContainer?: HTMLElement | null;
};

type TextEditingCanvas = {
  setActiveObject: (...args: unknown[]) => unknown;
  requestRenderAll: () => void;
};

function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

export function isTextEditableObject(obj: unknown): obj is EditableTextObject {
  const type = getFabricObjectType(obj);
  return type === 'itext' || type === 'i-text' || type === 'textbox' || type === 'text';
}

export function beginTextEditing<T extends EditableTextObject>(
  canvas: TextEditingCanvas,
  textObject: T,
  options: { event?: unknown; selectAll?: boolean } = {}
): void {
  (canvas.setActiveObject as (object: T) => unknown)(textObject);
  if (!textObject.isEditing) {
    textObject.enterEditing(options.event);
  }
  if (options.selectAll) {
    textObject.selectAll?.();
  }
  canvas.requestRenderAll();
}

export function attachTextEditingContainer<T extends EditableTextObject>(
  textObject: T,
  container: HTMLElement | null
): void {
  textObject.hiddenTextareaContainer = container;
}

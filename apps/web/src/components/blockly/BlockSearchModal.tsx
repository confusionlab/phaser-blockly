import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Blockly from 'blockly';
import { POCHA_BLOCKLY_THEME } from './blocklyTheme';
import {
  getToolboxConfig,
  type ToolboxBlockConfig,
  type ToolboxCategoryConfig,
  type ToolboxShadowConfig,
} from './toolbox';

// Item types: 'block' for Blockly blocks, 'command' for actions
type ItemType = 'block' | 'command';

// Block/command definition with search metadata
interface SearchItem {
  id: string;
  type: ItemType;
  blockType?: string; // For blocks
  commandId?: string; // For commands
  label: string;
  category: string;
  categoryColor: string;
  toolboxBlock?: ToolboxBlockConfig;
}

const COMMAND_ITEMS: SearchItem[] = [
  { id: 'cmd_edit_variables', type: 'command', commandId: 'EDIT_VARIABLES', label: 'Edit Variables', category: 'Commands', categoryColor: '#666666' },
  { id: 'cmd_edit_messages', type: 'command', commandId: 'EDIT_MESSAGES', label: 'Edit Messages', category: 'Commands', categoryColor: '#666666' },
];

const TYPE_PREFIXES = [
  'event_',
  'motion_',
  'looks_',
  'physics_',
  'control_',
  'camera_',
  'sensing_',
  'sound_',
  'typed_',
  'math_',
  'logic_',
  'debug_',
];

function getPreplugType(config: ToolboxBlockConfig, inputName: string): string | undefined {
  return config.inputs?.[inputName]?.block?.type;
}

function humanizeBlockType(type: string): string {
  let result = type;
  for (const prefix of TYPE_PREFIXES) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break;
    }
  }
  return result.replace(/_/g, ' ').trim();
}

function getSearchId(config: ToolboxBlockConfig, occurrence: number): string {
  if (config.type === 'controls_if') {
    return (config.extraState as { hasElse?: boolean } | undefined)?.hasElse ? 'controls_if_else' : 'controls_if';
  }
  if (config.type === 'camera_follow_object_value') {
    return getPreplugType(config, 'TARGET') === 'target_myself' ? 'camera_follow_me' : 'camera_follow_object';
  }
  return occurrence === 1 ? config.type : `${config.type}_${occurrence}`;
}

function getSearchLabel(config: ToolboxBlockConfig): string {
  if (config.type === 'controls_if') {
    return (config.extraState as { hasElse?: boolean } | undefined)?.hasElse ? 'if then else' : 'if then';
  }
  if (config.type === 'camera_follow_object_value') {
    return getPreplugType(config, 'TARGET') === 'target_myself' ? 'camera follow me' : 'camera follow object';
  }
  if (config.type === 'event_game_start') return 'when I start';
  if (config.type === 'event_key_pressed') return 'when [key] is pressed';
  if (config.type === 'event_clicked') return 'when this is clicked';
  if (config.type === 'event_when_receive') return 'when I receive [message]';
  if (config.type === 'event_when_touching_value') return 'when I touch [object]';
  if (config.type === 'event_when_touching_direction_value') return 'when I touch [object] from [direction]';
  if (config.type === 'event_forever') return 'forever';
  if (config.type === 'control_broadcast') return 'broadcast [message]';
  if (config.type === 'control_broadcast_wait') return 'broadcast [message] and wait';
  if (config.type === 'object_from_dropdown') return 'object';
  if (config.type === 'target_camera') return 'camera';
  if (config.type === 'target_myself') return 'myself';
  if (config.type === 'target_mouse') return 'mouse pointer';
  if (config.type === 'target_ground') return 'ground';
  return humanizeBlockType(config.type);
}

function buildSearchItemsFromToolbox(): SearchItem[] {
  const toolbox = getToolboxConfig({ includeAdvancedBlocks: true });
  const items: SearchItem[] = [...COMMAND_ITEMS];

  const visitCategory = (category: ToolboxCategoryConfig, path: string[]) => {
    const typeCounts = new Map<string, number>();

    for (const content of category.contents || []) {
      if (content.kind === 'block') {
        const block = content as unknown as ToolboxBlockConfig;
        const nextCount = (typeCounts.get(block.type) || 0) + 1;
        typeCounts.set(block.type, nextCount);
        items.push({
          id: getSearchId(block, nextCount),
          type: 'block',
          blockType: block.type,
          label: getSearchLabel(block),
          category: path.join(' / '),
          categoryColor: category.colour,
          toolboxBlock: block,
        });
      } else if (content.kind === 'category') {
        visitCategory(content as ToolboxCategoryConfig, [...path, content.name]);
      }
    }
  };

  for (const content of toolbox.contents || []) {
    if (content.kind !== 'category') continue;
    visitCategory(content, [content.name]);
  }

  return items;
}

function applyExtraState(block: Blockly.BlockSvg, extraState?: Record<string, unknown>) {
  if (!extraState) return;
  const blockWithExtraState = block as Blockly.BlockSvg & { loadExtraState?: (state: Record<string, unknown>) => void };
  if (blockWithExtraState.loadExtraState) {
    blockWithExtraState.loadExtraState(extraState);
    return;
  }
  // Fallback for built-ins that still rely on mutation APIs.
  if (block.type === 'controls_if' && (extraState as { hasElse?: boolean }).hasElse) {
    const mutationDom = Blockly.utils.xml.textToDom('<mutation else="1"></mutation>');
    (block as Blockly.BlockSvg & { domToMutation?: (dom: Element) => void }).domToMutation?.(mutationDom);
  }
}

function applyBlockFields(block: Blockly.BlockSvg, fields?: Record<string, string>) {
  if (!fields) return;
  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (block.getField(fieldName)) {
      block.setFieldValue(String(fieldValue), fieldName);
    }
  }
}

function createConfiguredChildBlock(
  workspace: Blockly.WorkspaceSvg,
  config: ToolboxBlockConfig | ToolboxShadowConfig,
  isShadow: boolean,
): Blockly.BlockSvg {
  const childBlock = workspace.newBlock(config.type) as Blockly.BlockSvg;
  if (isShadow) {
    childBlock.setShadow(true);
  }
  if ('extraState' in config) {
    applyExtraState(childBlock, config.extraState);
  }
  applyBlockFields(childBlock, config.fields);
  if ('inputs' in config) {
    applyToolboxConfigRecursive(workspace, childBlock, config);
  }
  childBlock.initSvg();
  childBlock.render();
  return childBlock;
}

function applyToolboxConfigRecursive(
  workspace: Blockly.WorkspaceSvg,
  block: Blockly.BlockSvg,
  config?: ToolboxBlockConfig
) {
  if (!config) return;
  applyExtraState(block, config.extraState);
  applyBlockFields(block, config.fields);

  if (!config.inputs) return;
  for (const [inputName, inputConfig] of Object.entries(config.inputs)) {
    const input = block.getInput(inputName);
    if (!input?.connection) continue;
    const childConfig = inputConfig?.block;
    const shadowConfig = inputConfig?.shadow;
    if (!childConfig && !shadowConfig) continue;

    const childBlock = childConfig
      ? createConfiguredChildBlock(workspace, childConfig, false)
      : createConfiguredChildBlock(workspace, shadowConfig as ToolboxShadowConfig, true);
    if (childBlock.outputConnection) {
      input.connection.connect(childBlock.outputConnection);
    }
  }
}

interface BlockSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Blockly.WorkspaceSvg | null;
  onEditVariables?: () => void;
  onEditMessages?: () => void;
}

// Component to render a single Blockly block preview
function BlockPreview({ blockType, scale = 0.6 }: { blockType: string; scale?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous workspace
    if (workspaceRef.current) {
      workspaceRef.current.dispose();
    }

    // Create a hidden workspace for rendering
    const workspace = Blockly.inject(containerRef.current, {
      readOnly: true,
      renderer: 'zelos',
      theme: POCHA_BLOCKLY_THEME,
      scrollbars: false,
      zoom: { controls: false, wheel: false, startScale: scale },
      move: { scrollbars: false, drag: false, wheel: false },
    });
    workspaceRef.current = workspace;

    try {
      const block = workspace.newBlock(blockType) as Blockly.BlockSvg;
      block.initSvg();
      block.render();

      const blockSvg = block.getSvgRoot();
      if (blockSvg) {
        const bbox = blockSvg.getBBox();
        const width = Math.max(100, (bbox.width + 20) * scale);
        const height = Math.max(30, (bbox.height + 10) * scale);
        containerRef.current.style.width = `${width}px`;
        containerRef.current.style.height = `${height}px`;
        Blockly.svgResize(workspace);
      }
    } catch (e) {
      console.error('Failed to create block preview:', blockType, e);
    }

    return () => {
      if (workspaceRef.current) {
        workspaceRef.current.dispose();
        workspaceRef.current = null;
      }
    };
  }, [blockType, scale]);

  return (
    <div
      ref={containerRef}
      className="blockly-preview overflow-hidden"
      style={{ minWidth: 100, minHeight: 30 }}
    />
  );
}

export function BlockSearchModal({ isOpen, onClose, workspace, onEditVariables, onEditMessages }: BlockSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const allItems = useMemo(() => buildSearchItemsFromToolbox(), []);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return allItems;
    const query = searchQuery.toLowerCase();
    return allItems.filter(item =>
      item.label.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      (item.blockType && item.blockType.toLowerCase().includes(query))
    );
  }, [allItems, searchQuery]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedEl = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const executeItem = useCallback((item: SearchItem) => {
    if (item.type === 'command') {
      // Handle commands
      if (item.commandId === 'EDIT_VARIABLES' && onEditVariables) {
        onEditVariables();
        onClose();
      } else if (item.commandId === 'EDIT_MESSAGES' && onEditMessages) {
        onEditMessages();
        onClose();
      }
    } else if (item.type === 'block' && item.blockType && workspace) {
      // Add block to workspace
      try {
        const block = workspace.newBlock(item.blockType) as Blockly.BlockSvg;
        applyToolboxConfigRecursive(workspace, block, item.toolboxBlock);

        block.initSvg();
        block.render();

        // Position block in visible area
        const metrics = workspace.getMetrics();
        const viewLeft = metrics.viewLeft || 0;
        const viewTop = metrics.viewTop || 0;
        block.moveBy(viewLeft + 50, viewTop + 50);

        onClose();
      } catch (e) {
        console.error('Failed to create block:', item.blockType, e);
      }
    }
  }, [workspace, onClose, onEditMessages, onEditVariables]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          executeItem(filteredItems[selectedIndex]);
        }
        break;
      case 'Escape':
        onClose();
        break;
    }
  }, [filteredItems, selectedIndex, executeItem, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-scrim-strong p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-popover text-popover-foreground rounded-xl shadow-2xl w-[500px] max-h-[600px] flex flex-col overflow-hidden border border-border">
        {/* Search input */}
        <div className="p-4 border-b border-border">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search blocks and commands..."
            className="w-full px-4 py-3 text-lg bg-background text-foreground border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* Results list */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto p-2">
          {filteredItems.map((item, index) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'
              }`}
              onClick={() => executeItem(item)}
            >
              {item.type === 'block' && item.blockType ? (
                <div className="flex-shrink-0">
                  <BlockPreview blockType={item.blockType} scale={0.5} />
                </div>
              ) : (
                <div
                  className="flex-shrink-0 px-3 py-1.5 rounded text-sm font-medium text-white"
                  style={{ backgroundColor: item.categoryColor }}
                >
                  {item.label}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-muted-foreground">{item.category}</div>
              </div>
            </div>
          ))}
          {filteredItems.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              No results found
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="px-4 py-2 bg-muted/50 border-t border-border text-xs text-muted-foreground text-center">
          <span className="font-medium text-foreground">↑↓</span> Navigate
          <span className="mx-3 text-muted-foreground/70">|</span>
          <span className="font-medium text-foreground">Enter</span> Select
          <span className="mx-3 text-muted-foreground/70">|</span>
          <span className="font-medium text-foreground">Esc</span> Close
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Blockly from 'blockly';
import { getToolboxConfig } from './toolbox';

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

type ToolboxBlockInputConfig = {
  block?: ToolboxBlockConfig;
  shadow?: {
    type: string;
    fields?: Record<string, string>;
  };
};

type ToolboxBlockConfig = {
  kind: 'block';
  type: string;
  inputs?: Record<string, ToolboxBlockInputConfig>;
  fields?: Record<string, string>;
  extraState?: Record<string, unknown>;
};

type ToolboxCategoryConfig = {
  kind: 'category';
  name: string;
  colour: string;
  contents: Array<{ kind: string } & Record<string, unknown>>;
};

const COMMAND_ITEMS: SearchItem[] = [
  { id: 'cmd_new_variable', type: 'command', commandId: 'NEW_VARIABLE', label: 'New Variable', category: 'Commands', categoryColor: '#666666' },
  { id: 'cmd_manage_variables', type: 'command', commandId: 'MANAGE_VARIABLES', label: 'Manage Variables', category: 'Commands', categoryColor: '#666666' },
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
  if (config.type === 'control_clone_object_value') {
    return getPreplugType(config, 'TARGET') === 'target_myself' ? 'control_clone' : 'control_clone_object';
  }
  if (config.type === 'camera_follow_object_value') {
    return getPreplugType(config, 'TARGET') === 'target_myself' ? 'camera_follow_me' : 'camera_follow_object';
  }
  if (config.type === 'sensing_is_clone_of_value') {
    return 'sensing_is_clone_of';
  }
  return occurrence === 1 ? config.type : `${config.type}_${occurrence}`;
}

function getSearchLabel(config: ToolboxBlockConfig): string {
  if (config.type === 'controls_if') {
    return (config.extraState as { hasElse?: boolean } | undefined)?.hasElse ? 'if then else' : 'if then';
  }
  if (config.type === 'control_clone_object_value') {
    return getPreplugType(config, 'TARGET') === 'target_myself' ? 'clone myself' : 'clone object';
  }
  if (config.type === 'camera_follow_object_value') {
    return getPreplugType(config, 'TARGET') === 'target_myself' ? 'camera follow me' : 'camera follow object';
  }
  if (config.type === 'sensing_is_clone_of_value') {
    return 'is clone of';
  }
  if (config.type === 'event_game_start') return 'When I start';
  if (config.type === 'event_key_pressed') return 'when key pressed';
  if (config.type === 'event_clicked') return 'when this clicked';
  if (config.type === 'event_forever') return 'forever';
  return humanizeBlockType(config.type);
}

function buildSearchItemsFromToolbox(): SearchItem[] {
  const toolbox = getToolboxConfig();
  const categories = (toolbox.contents || []) as ToolboxCategoryConfig[];
  const items: SearchItem[] = [...COMMAND_ITEMS];

  for (const category of categories) {
    if (category.kind !== 'category') continue;
    const typeCounts = new Map<string, number>();
    for (const content of category.contents || []) {
      if (content.kind !== 'block') continue;
      const block = content as unknown as ToolboxBlockConfig;
      const nextCount = (typeCounts.get(block.type) || 0) + 1;
      typeCounts.set(block.type, nextCount);
      items.push({
        id: getSearchId(block, nextCount),
        type: 'block',
        blockType: block.type,
        label: getSearchLabel(block),
        category: category.name,
        categoryColor: category.colour,
        toolboxBlock: block,
      });
    }
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

function applyToolboxConfigRecursive(
  workspace: Blockly.WorkspaceSvg,
  block: Blockly.BlockSvg,
  config?: ToolboxBlockConfig
) {
  if (!config) return;
  applyExtraState(block, config.extraState);

  if (config.fields) {
    for (const [fieldName, fieldValue] of Object.entries(config.fields)) {
      if (block.getField(fieldName)) {
        block.setFieldValue(String(fieldValue), fieldName);
      }
    }
  }

  if (!config.inputs) return;
  for (const [inputName, inputConfig] of Object.entries(config.inputs)) {
    const childConfig = inputConfig?.block;
    if (!childConfig) continue;
    const input = block.getInput(inputName);
    if (!input?.connection) continue;

    const childBlock = workspace.newBlock(childConfig.type) as Blockly.BlockSvg;
    applyToolboxConfigRecursive(workspace, childBlock, childConfig);
    childBlock.initSvg();
    childBlock.render();
    if (childBlock.outputConnection) {
      input.connection.connect(childBlock.outputConnection);
    }
  }
}

interface BlockSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Blockly.WorkspaceSvg | null;
  onNewVariable?: () => void;
  onManageVariables?: () => void;
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

export function BlockSearchModal({ isOpen, onClose, workspace, onNewVariable, onManageVariables }: BlockSearchModalProps) {
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
      if (item.commandId === 'NEW_VARIABLE' && onNewVariable) {
        onNewVariable();
        onClose();
      } else if (item.commandId === 'MANAGE_VARIABLES' && onManageVariables) {
        onManageVariables();
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
  }, [workspace, onNewVariable, onManageVariables, onClose]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
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

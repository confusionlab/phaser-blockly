import { useState, useEffect, useRef, useCallback } from 'react';
import * as Blockly from 'blockly';

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
}

// All available items for search
const ALL_ITEMS: SearchItem[] = [
  // Commands
  { id: 'cmd_new_variable', type: 'command', commandId: 'NEW_VARIABLE', label: 'New Variable', category: 'Commands', categoryColor: '#666666' },
  { id: 'cmd_manage_variables', type: 'command', commandId: 'MANAGE_VARIABLES', label: 'Manage Variables', category: 'Commands', categoryColor: '#666666' },

  // Events
  { id: 'event_game_start', type: 'block', blockType: 'event_game_start', label: 'When I start', category: 'Events', categoryColor: '#FFAB19' },
  { id: 'event_key_pressed', type: 'block', blockType: 'event_key_pressed', label: 'when key pressed', category: 'Events', categoryColor: '#FFAB19' },
  { id: 'event_clicked', type: 'block', blockType: 'event_clicked', label: 'when this clicked', category: 'Events', categoryColor: '#FFAB19' },
  { id: 'event_forever', type: 'block', blockType: 'event_forever', label: 'forever', category: 'Events', categoryColor: '#FFAB19' },
  { id: 'event_when_receive', type: 'block', blockType: 'event_when_receive', label: 'when I receive', category: 'Events', categoryColor: '#FFAB19' },
  { id: 'event_when_touching', type: 'block', blockType: 'event_when_touching', label: 'when touching', category: 'Events', categoryColor: '#FFAB19' },
  { id: 'event_when_touching_direction', type: 'block', blockType: 'event_when_touching_direction', label: 'when touching from', category: 'Events', categoryColor: '#FFAB19' },

  // Motion
  { id: 'motion_move_steps', type: 'block', blockType: 'motion_move_steps', label: 'move steps', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_go_to', type: 'block', blockType: 'motion_go_to', label: 'go to x y', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_set_x', type: 'block', blockType: 'motion_set_x', label: 'set x to', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_set_y', type: 'block', blockType: 'motion_set_y', label: 'set y to', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_change_x', type: 'block', blockType: 'motion_change_x', label: 'change x by', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_change_y', type: 'block', blockType: 'motion_change_y', label: 'change y by', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_point_direction', type: 'block', blockType: 'motion_point_direction', label: 'point in direction', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_point_towards', type: 'block', blockType: 'motion_point_towards', label: 'point towards', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_my_x', type: 'block', blockType: 'motion_my_x', label: 'my x', category: 'Motion', categoryColor: '#4C97FF' },
  { id: 'motion_my_y', type: 'block', blockType: 'motion_my_y', label: 'my y', category: 'Motion', categoryColor: '#4C97FF' },

  // Looks
  { id: 'looks_show', type: 'block', blockType: 'looks_show', label: 'show', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_hide', type: 'block', blockType: 'looks_hide', label: 'hide', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_set_size', type: 'block', blockType: 'looks_set_size', label: 'set size to', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_change_size', type: 'block', blockType: 'looks_change_size', label: 'change size by', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_set_opacity', type: 'block', blockType: 'looks_set_opacity', label: 'set opacity to', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_go_to_front', type: 'block', blockType: 'looks_go_to_front', label: 'go to front', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_go_to_back', type: 'block', blockType: 'looks_go_to_back', label: 'go to back', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_next_costume', type: 'block', blockType: 'looks_next_costume', label: 'next costume', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_switch_costume', type: 'block', blockType: 'looks_switch_costume', label: 'switch costume to', category: 'Looks', categoryColor: '#9966FF' },
  { id: 'looks_costume_number', type: 'block', blockType: 'looks_costume_number', label: 'costume number', category: 'Looks', categoryColor: '#9966FF' },

  // Physics
  { id: 'physics_enable', type: 'block', blockType: 'physics_enable', label: 'enable physics', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_disable', type: 'block', blockType: 'physics_disable', label: 'disable physics', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_enabled', type: 'block', blockType: 'physics_enabled', label: 'physics enabled?', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_set_velocity', type: 'block', blockType: 'physics_set_velocity', label: 'set velocity x y', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_set_velocity_x', type: 'block', blockType: 'physics_set_velocity_x', label: 'set velocity x to', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_set_velocity_y', type: 'block', blockType: 'physics_set_velocity_y', label: 'set velocity y to', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_set_gravity', type: 'block', blockType: 'physics_set_gravity', label: 'set gravity to', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_set_bounce', type: 'block', blockType: 'physics_set_bounce', label: 'set bounce to', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_set_friction', type: 'block', blockType: 'physics_set_friction', label: 'set friction to', category: 'Physics', categoryColor: '#40BF4A' },
  { id: 'physics_immovable', type: 'block', blockType: 'physics_immovable', label: 'make immovable', category: 'Physics', categoryColor: '#40BF4A' },

  // Control
  { id: 'control_wait', type: 'block', blockType: 'control_wait', label: 'wait seconds', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_repeat', type: 'block', blockType: 'control_repeat', label: 'repeat times', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_repeat_until', type: 'block', blockType: 'control_repeat_until', label: 'repeat until', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_wait_until', type: 'block', blockType: 'control_wait_until', label: 'wait until', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'controls_if', type: 'block', blockType: 'controls_if', label: 'if then', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'controls_if_else', type: 'block', blockType: 'controls_if', label: 'if then else', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_stop', type: 'block', blockType: 'control_stop', label: 'stop', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_clone', type: 'block', blockType: 'control_clone', label: 'clone myself', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_clone_object', type: 'block', blockType: 'control_clone_object', label: 'clone object', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_delete_clone', type: 'block', blockType: 'control_delete_clone', label: 'delete myself', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_delete_object', type: 'block', blockType: 'control_delete_object', label: 'delete object', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_broadcast', type: 'block', blockType: 'control_broadcast', label: 'broadcast', category: 'Control', categoryColor: '#FFBF00' },
  { id: 'control_broadcast_wait', type: 'block', blockType: 'control_broadcast_wait', label: 'broadcast and wait', category: 'Control', categoryColor: '#FFBF00' },

  // Sensing
  { id: 'sensing_key_pressed', type: 'block', blockType: 'sensing_key_pressed', label: 'key pressed?', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_mouse_down', type: 'block', blockType: 'sensing_mouse_down', label: 'mouse down?', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_mouse_x', type: 'block', blockType: 'sensing_mouse_x', label: 'mouse x', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_mouse_y', type: 'block', blockType: 'sensing_mouse_y', label: 'mouse y', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_touching', type: 'block', blockType: 'sensing_touching', label: 'touching?', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_touching_direction', type: 'block', blockType: 'sensing_touching_direction', label: 'touching from?', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_touching_object', type: 'block', blockType: 'sensing_touching_object', label: "object I'm touching", category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_distance_to', type: 'block', blockType: 'sensing_distance_to', label: 'distance to', category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_object_x', type: 'block', blockType: 'sensing_object_x', label: "object's x", category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_object_y', type: 'block', blockType: 'sensing_object_y', label: "object's y", category: 'Sensing', categoryColor: '#5CB1D6' },
  { id: 'sensing_object_costume', type: 'block', blockType: 'sensing_object_costume', label: "object's costume #", category: 'Sensing', categoryColor: '#5CB1D6' },

  // Camera
  { id: 'camera_follow_me', type: 'block', blockType: 'camera_follow_me', label: 'camera follow me', category: 'Camera', categoryColor: '#0fBDA8' },
  { id: 'camera_follow_object', type: 'block', blockType: 'camera_follow_object', label: 'camera follow object', category: 'Camera', categoryColor: '#0fBDA8' },
  { id: 'camera_stop_follow', type: 'block', blockType: 'camera_stop_follow', label: 'camera stop following', category: 'Camera', categoryColor: '#0fBDA8' },
  { id: 'camera_set_follow_offset', type: 'block', blockType: 'camera_set_follow_offset', label: 'set camera offset x y', category: 'Camera', categoryColor: '#0fBDA8' },

  // Operators
  { id: 'math_arithmetic', type: 'block', blockType: 'math_arithmetic', label: 'math + - * /', category: 'Operators', categoryColor: '#59C059' },
  { id: 'math_number', type: 'block', blockType: 'math_number', label: 'number', category: 'Operators', categoryColor: '#59C059' },
  { id: 'logic_compare', type: 'block', blockType: 'logic_compare', label: 'compare = < >', category: 'Operators', categoryColor: '#59C059' },
  { id: 'logic_operation', type: 'block', blockType: 'logic_operation', label: 'and or', category: 'Operators', categoryColor: '#59C059' },
  { id: 'logic_negate', type: 'block', blockType: 'logic_negate', label: 'not', category: 'Operators', categoryColor: '#59C059' },
  { id: 'logic_boolean', type: 'block', blockType: 'logic_boolean', label: 'true false', category: 'Operators', categoryColor: '#59C059' },
  { id: 'math_random_int', type: 'block', blockType: 'math_random_int', label: 'random number', category: 'Operators', categoryColor: '#59C059' },

  // Variables
  { id: 'typed_variable_get', type: 'block', blockType: 'typed_variable_get', label: 'get variable', category: 'Variables', categoryColor: '#FF8C1A' },
  { id: 'typed_variable_set', type: 'block', blockType: 'typed_variable_set', label: 'set variable to', category: 'Variables', categoryColor: '#FF8C1A' },
  { id: 'typed_variable_change', type: 'block', blockType: 'typed_variable_change', label: 'change variable by', category: 'Variables', categoryColor: '#FF8C1A' },

  // Debug
  { id: 'debug_console_log', type: 'block', blockType: 'debug_console_log', label: 'console log', category: 'Debug', categoryColor: '#888888' },
];

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

  // Filter items based on search query
  const filteredItems = searchQuery.trim()
    ? ALL_ITEMS.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.blockType && item.blockType.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : ALL_ITEMS;

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

        // Handle if-else variant
        if (item.id === 'controls_if_else') {
          // Load the mutator state for if-else
          const mutationDom = Blockly.utils.xml.textToDom('<mutation else="1"></mutation>');
          (block as Blockly.BlockSvg & { domToMutation?: (dom: Element) => void }).domToMutation?.(mutationDom);
        }

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

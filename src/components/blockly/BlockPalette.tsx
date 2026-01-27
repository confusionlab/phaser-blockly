import { useRef, useEffect, useState } from 'react';
import * as Blockly from 'blockly';

// Category definitions with blocks
export const BLOCK_CATEGORIES = [
  {
    id: 'events',
    name: 'Events',
    colour: '#FFAB19',
    icon: '🏁',
    blocks: [
      'event_game_start',
      'event_key_pressed',
      'event_clicked',
      'event_forever',
      'event_when_receive',
      'event_when_touching',
      'event_when_clone_start',
    ],
  },
  {
    id: 'motion',
    name: 'Motion',
    colour: '#4C97FF',
    icon: '➡️',
    blocks: [
      'motion_move_steps',
      'motion_go_to',
      'motion_change_x',
      'motion_change_y',
      'motion_set_x',
      'motion_set_y',
      'motion_point_direction',
      'motion_point_towards',
    ],
  },
  {
    id: 'looks',
    name: 'Looks',
    colour: '#9966FF',
    icon: '👁️',
    blocks: [
      'looks_show',
      'looks_hide',
      'looks_set_size',
      'looks_change_size',
      'looks_set_opacity',
      'looks_go_to_front',
      'looks_go_to_back',
    ],
  },
  {
    id: 'physics',
    name: 'Physics',
    colour: '#40BF4A',
    icon: '⚡',
    blocks: [
      'physics_enable',
      'physics_set_velocity',
      'physics_set_velocity_x',
      'physics_set_velocity_y',
      'physics_set_gravity',
      'physics_set_bounce',
      'physics_collide_bounds',
      'physics_immovable',
    ],
  },
  {
    id: 'control',
    name: 'Control',
    colour: '#FFBF00',
    icon: '🔄',
    blocks: [
      'control_wait',
      'control_repeat',
      'controls_if',
      'control_stop',
      'control_switch_scene',
      'control_clone',
      'control_delete_clone',
      'control_broadcast',
      'control_broadcast_wait',
    ],
  },
  {
    id: 'sensing',
    name: 'Sensing',
    colour: '#5CB1D6',
    icon: '👆',
    blocks: [
      'sensing_key_pressed',
      'sensing_mouse_down',
      'sensing_mouse_x',
      'sensing_mouse_y',
      'sensing_touching',
      'sensing_distance_to',
    ],
  },
  {
    id: 'camera',
    name: 'Camera',
    colour: '#0fBDA8',
    icon: '📷',
    blocks: [
      'camera_follow_me',
      'camera_follow_object',
      'camera_stop_follow',
      'camera_go_to',
      'camera_shake',
      'camera_zoom',
      'camera_fade',
    ],
  },
  {
    id: 'sound',
    name: 'Sound',
    colour: '#CF63CF',
    icon: '🔊',
    blocks: [
      'sound_play',
      'sound_play_until_done',
      'sound_stop_all',
      'sound_set_volume',
      'sound_change_volume',
    ],
  },
  {
    id: 'operators',
    name: 'Operators',
    colour: '#59C059',
    icon: '➕',
    blocks: [
      'math_number',
      'math_arithmetic',
      'math_random_int',
      'logic_compare',
      'logic_operation',
      'logic_negate',
    ],
  },
  {
    id: 'variables',
    name: 'Variables',
    colour: '#FF8C1A',
    icon: '📦',
    blocks: [], // Variables are handled specially
    isVariables: true,
  },
];

interface BlockPaletteProps {
  workspace: Blockly.WorkspaceSvg | null;
  disabled?: boolean;
}

export function BlockPalette({ workspace, disabled }: BlockPaletteProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeCategory, setActiveCategory] = useState(BLOCK_CATEGORIES[0].id);

  // Track scroll position to highlight active category
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerTop = container.scrollTop;

      for (const category of BLOCK_CATEGORIES) {
        const section = sectionRefs.current.get(category.id);
        if (section) {
          const sectionTop = section.offsetTop - container.offsetTop;
          const sectionBottom = sectionTop + section.offsetHeight;

          if (containerTop >= sectionTop - 50 && containerTop < sectionBottom - 50) {
            setActiveCategory(category.id);
            break;
          }
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToCategory = (categoryId: string) => {
    const section = sectionRefs.current.get(categoryId);
    const container = scrollContainerRef.current;
    if (section && container) {
      container.scrollTo({
        top: section.offsetTop - container.offsetTop,
        behavior: 'smooth',
      });
    }
  };

  const handleBlockClick = (blockType: string) => {
    if (!workspace || disabled) return;

    // Create a new block in the workspace
    const block = workspace.newBlock(blockType);
    block.initSvg();
    block.render();

    // Position it in the visible area of the workspace
    const metrics = workspace.getMetrics();
    const viewCenterX = metrics.viewLeft + metrics.viewWidth / 4;
    const viewCenterY = metrics.viewTop + metrics.viewHeight / 3;

    block.moveTo(new Blockly.utils.Coordinate(viewCenterX, viewCenterY));

    // Select the block
    const blockSvg = block as Blockly.BlockSvg;
    blockSvg.select();

    // Scroll to make sure block is visible
    workspace.centerOnBlock(block.id);
  };

  const handleCreateVariable = () => {
    if (!workspace) return;
    Blockly.Variables.createVariableButtonHandler(workspace, undefined, '');
  };

  return (
    <div className={`flex h-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Category anchors - left sidebar */}
      <div className="w-12 bg-gray-100 border-r border-gray-200 flex flex-col py-2 gap-1 shrink-0">
        {BLOCK_CATEGORIES.map((category) => (
          <button
            key={category.id}
            onClick={() => scrollToCategory(category.id)}
            className={`w-10 h-10 mx-auto rounded-lg flex items-center justify-center text-lg transition-all ${
              activeCategory === category.id
                ? 'ring-2 ring-offset-1 ring-current'
                : 'hover:bg-gray-200'
            }`}
            style={{
              backgroundColor: activeCategory === category.id ? category.colour + '30' : undefined,
              color: activeCategory === category.id ? category.colour : undefined,
            }}
            title={category.name}
          >
            {category.icon}
          </button>
        ))}
      </div>

      {/* Blocks list - scrollable */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto bg-gray-50"
      >
        {BLOCK_CATEGORIES.map((category) => (
          <div
            key={category.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(category.id, el);
            }}
            className="p-3"
          >
            {/* Category header */}
            <div
              className="flex items-center gap-2 mb-2 pb-2 border-b-2 sticky top-0 bg-gray-50 z-10"
              style={{ borderColor: category.colour }}
            >
              <span className="text-lg">{category.icon}</span>
              <span className="font-semibold text-sm" style={{ color: category.colour }}>
                {category.name}
              </span>
            </div>

            {/* Blocks */}
            <div className="flex flex-col gap-2">
              {category.isVariables ? (
                <>
                  <button
                    onClick={handleCreateVariable}
                    className="px-3 py-2 bg-orange-100 hover:bg-orange-200 rounded-lg text-sm font-medium text-orange-700 transition-colors"
                  >
                    + Create Variable
                  </button>
                  <BlockItem
                    blockType="variables_get"
                    colour={category.colour}
                    onClick={handleBlockClick}
                    label="variable"
                  />
                  <BlockItem
                    blockType="variables_set"
                    colour={category.colour}
                    onClick={handleBlockClick}
                    label="set variable to"
                  />
                  <BlockItem
                    blockType="math_change"
                    colour={category.colour}
                    onClick={handleBlockClick}
                    label="change variable by"
                  />
                </>
              ) : (
                category.blocks.map((blockType) => (
                  <BlockItem
                    key={blockType}
                    blockType={blockType}
                    colour={category.colour}
                    onClick={handleBlockClick}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BlockItemProps {
  blockType: string;
  colour: string;
  onClick: (blockType: string) => void;
  label?: string;
}

function BlockItem({ blockType, colour, onClick, label }: BlockItemProps) {
  // Get block label from the block definition
  const getBlockLabel = () => {
    if (label) return label;

    // Map block types to friendly names
    const labels: Record<string, string> = {
      // Events
      'event_game_start': '🏁 when game starts',
      'event_key_pressed': '🔑 when key pressed',
      'event_clicked': '🖱️ when this clicked',
      'event_forever': '🔄 forever',
      'event_when_receive': '📨 when I receive',
      'event_when_touching': '💥 when touching',
      'event_when_clone_start': '👥 when I start as clone',
      // Motion
      'motion_move_steps': 'move __ steps',
      'motion_go_to': 'go to x: __ y: __',
      'motion_change_x': 'change x by __',
      'motion_change_y': 'change y by __',
      'motion_set_x': 'set x to __',
      'motion_set_y': 'set y to __',
      'motion_point_direction': 'point in direction __',
      'motion_point_towards': 'point towards __',
      // Looks
      'looks_show': 'show',
      'looks_hide': 'hide',
      'looks_set_size': 'set size to __%',
      'looks_change_size': 'change size by __',
      'looks_set_opacity': 'set opacity to __%',
      'looks_go_to_front': 'go to front layer',
      'looks_go_to_back': 'go to back layer',
      // Physics
      'physics_enable': '⚡ enable physics',
      'physics_set_velocity': 'set velocity x: __ y: __',
      'physics_set_velocity_x': 'set velocity x to __',
      'physics_set_velocity_y': 'set velocity y to __',
      'physics_set_gravity': 'set gravity to __',
      'physics_set_bounce': 'set bounce to __',
      'physics_collide_bounds': 'collide with bounds',
      'physics_immovable': '❄️ make immovable',
      // Control
      'control_wait': 'wait __ seconds',
      'control_repeat': 'repeat __ times',
      'controls_if': 'if __ then',
      'control_stop': 'stop',
      'control_switch_scene': 'switch to scene __',
      'control_clone': 'clone myself',
      'control_delete_clone': 'delete this clone',
      'control_broadcast': 'broadcast __',
      'control_broadcast_wait': 'broadcast __ and wait',
      // Sensing
      'sensing_key_pressed': 'key __ pressed?',
      'sensing_mouse_down': 'mouse down?',
      'sensing_mouse_x': 'mouse x',
      'sensing_mouse_y': 'mouse y',
      'sensing_touching': 'touching __?',
      'sensing_distance_to': 'distance to __',
      // Camera
      'camera_follow_me': '📷 camera follow me',
      'camera_follow_object': 'camera follow __',
      'camera_stop_follow': 'camera stop following',
      'camera_go_to': 'camera go to x: __ y: __',
      'camera_shake': 'camera shake __ secs',
      'camera_zoom': 'set zoom to __%',
      'camera_fade': 'camera fade __',
      // Sound
      'sound_play': '🔊 play sound __',
      'sound_play_until_done': 'play sound __ until done',
      'sound_stop_all': 'stop all sounds',
      'sound_set_volume': 'set volume to __%',
      'sound_change_volume': 'change volume by __',
      // Operators
      'math_number': '0',
      'math_arithmetic': '__ + __',
      'math_random_int': 'random __ to __',
      'logic_compare': '__ = __',
      'logic_operation': '__ and __',
      'logic_negate': 'not __',
    };

    return labels[blockType] || blockType;
  };

  return (
    <div
      onClick={() => onClick(blockType)}
      className="px-3 py-2 rounded-lg cursor-pointer text-sm font-medium text-white shadow-sm hover:shadow-md hover:scale-[1.02] transition-all select-none active:scale-95"
      style={{ backgroundColor: colour }}
    >
      {getBlockLabel()}
    </div>
  );
}

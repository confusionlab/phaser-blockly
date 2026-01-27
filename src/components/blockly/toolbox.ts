import * as Blockly from 'blockly';

// Register custom blocks
registerCustomBlocks();

export function getToolboxConfig(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Events',
        colour: '#FFAB19',
        contents: [
          { kind: 'block', type: 'event_game_start' },
          { kind: 'block', type: 'event_key_pressed' },
          { kind: 'block', type: 'event_clicked' },
          { kind: 'block', type: 'event_forever' },
          { kind: 'block', type: 'event_when_receive' },
          { kind: 'block', type: 'event_when_touching' },
          { kind: 'block', type: 'event_when_clone_start' },
        ],
      },
      {
        kind: 'category',
        name: 'Motion',
        colour: '#4C97FF',
        contents: [
          { kind: 'block', type: 'motion_move_steps' },
          { kind: 'block', type: 'motion_go_to' },
          { kind: 'block', type: 'motion_change_x' },
          { kind: 'block', type: 'motion_change_y' },
          { kind: 'block', type: 'motion_set_x' },
          { kind: 'block', type: 'motion_set_y' },
          { kind: 'block', type: 'motion_point_direction' },
          { kind: 'block', type: 'motion_point_towards' },
        ],
      },
      {
        kind: 'category',
        name: 'Looks',
        colour: '#9966FF',
        contents: [
          { kind: 'block', type: 'looks_show' },
          { kind: 'block', type: 'looks_hide' },
          { kind: 'block', type: 'looks_set_size' },
          { kind: 'block', type: 'looks_change_size' },
          { kind: 'block', type: 'looks_set_opacity' },
          { kind: 'block', type: 'looks_go_to_front' },
          { kind: 'block', type: 'looks_go_to_back' },
        ],
      },
      {
        kind: 'category',
        name: 'Physics',
        colour: '#40BF4A',
        contents: [
          { kind: 'block', type: 'physics_enable' },
          { kind: 'block', type: 'physics_set_velocity' },
          { kind: 'block', type: 'physics_set_velocity_x' },
          { kind: 'block', type: 'physics_set_velocity_y' },
          { kind: 'block', type: 'physics_set_gravity' },
          { kind: 'block', type: 'physics_set_bounce' },
          { kind: 'block', type: 'physics_collide_bounds' },
          { kind: 'block', type: 'physics_immovable' },
        ],
      },
      {
        kind: 'category',
        name: 'Control',
        colour: '#FFBF00',
        contents: [
          { kind: 'block', type: 'control_wait' },
          { kind: 'block', type: 'control_repeat' },
          { kind: 'block', type: 'controls_if' },
          { kind: 'block', type: 'control_stop' },
          { kind: 'block', type: 'control_switch_scene' },
          { kind: 'block', type: 'control_clone' },
          { kind: 'block', type: 'control_delete_clone' },
          { kind: 'block', type: 'control_broadcast' },
          { kind: 'block', type: 'control_broadcast_wait' },
        ],
      },
      {
        kind: 'category',
        name: 'Sensing',
        colour: '#5CB1D6',
        contents: [
          { kind: 'block', type: 'sensing_key_pressed' },
          { kind: 'block', type: 'sensing_mouse_down' },
          { kind: 'block', type: 'sensing_mouse_x' },
          { kind: 'block', type: 'sensing_mouse_y' },
          { kind: 'block', type: 'sensing_touching' },
          { kind: 'block', type: 'sensing_distance_to' },
        ],
      },
      {
        kind: 'category',
        name: 'Camera',
        colour: '#0fBDA8',
        contents: [
          { kind: 'block', type: 'camera_follow_me' },
          { kind: 'block', type: 'camera_follow_object' },
          { kind: 'block', type: 'camera_stop_follow' },
          { kind: 'block', type: 'camera_go_to' },
          { kind: 'block', type: 'camera_shake' },
          { kind: 'block', type: 'camera_zoom' },
          { kind: 'block', type: 'camera_fade' },
        ],
      },
      {
        kind: 'category',
        name: 'Sound',
        colour: '#CF63CF',
        contents: [
          { kind: 'block', type: 'sound_play' },
          { kind: 'block', type: 'sound_play_until_done' },
          { kind: 'block', type: 'sound_stop_all' },
          { kind: 'block', type: 'sound_set_volume' },
          { kind: 'block', type: 'sound_change_volume' },
        ],
      },
      {
        kind: 'category',
        name: 'Operators',
        colour: '#59C059',
        contents: [
          { kind: 'block', type: 'math_number' },
          { kind: 'block', type: 'math_arithmetic' },
          { kind: 'block', type: 'math_random_int' },
          { kind: 'block', type: 'logic_compare' },
          { kind: 'block', type: 'logic_operation' },
          { kind: 'block', type: 'logic_negate' },
        ],
      },
      {
        kind: 'category',
        name: 'Variables',
        colour: '#FF8C1A',
        custom: 'VARIABLE',
      },
    ],
  };
}

function registerCustomBlocks() {
  // Events
  Blockly.Blocks['event_game_start'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🏁 when game starts');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when the game starts');
    }
  };

  Blockly.Blocks['event_key_pressed'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🔑 when')
        .appendField(new Blockly.FieldDropdown([
          ['space', 'SPACE'],
          ['up arrow', 'UP'],
          ['down arrow', 'DOWN'],
          ['left arrow', 'LEFT'],
          ['right arrow', 'RIGHT'],
          ['w', 'W'],
          ['a', 'A'],
          ['s', 'S'],
          ['d', 'D'],
        ]), 'KEY')
        .appendField('pressed');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when a key is pressed');
    }
  };

  Blockly.Blocks['event_clicked'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🖱️ when this clicked');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when this object is clicked');
    }
  };

  Blockly.Blocks['event_forever'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🔄 forever');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs continuously');
    }
  };

  // Motion
  Blockly.Blocks['motion_move_steps'] = {
    init: function() {
      this.appendValueInput('STEPS')
        .setCheck('Number')
        .appendField('move');
      this.appendDummyInput()
        .appendField('steps');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Move forward');
    }
  };

  Blockly.Blocks['motion_go_to'] = {
    init: function() {
      this.appendValueInput('X')
        .setCheck('Number')
        .appendField('go to x:');
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Go to position');
    }
  };

  Blockly.Blocks['motion_change_x'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('change x by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Change x position');
    }
  };

  Blockly.Blocks['motion_change_y'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('change y by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Change y position');
    }
  };

  Blockly.Blocks['motion_set_x'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('set x to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Set x position');
    }
  };

  Blockly.Blocks['motion_set_y'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('set y to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Set y position');
    }
  };

  Blockly.Blocks['motion_point_direction'] = {
    init: function() {
      this.appendValueInput('DIRECTION')
        .setCheck('Number')
        .appendField('point in direction');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Point in a direction (0-360)');
    }
  };

  // Looks
  Blockly.Blocks['looks_show'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('show');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Show this object');
    }
  };

  Blockly.Blocks['looks_hide'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('hide');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Hide this object');
    }
  };

  Blockly.Blocks['looks_set_size'] = {
    init: function() {
      this.appendValueInput('SIZE')
        .setCheck('Number')
        .appendField('set size to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Set size percentage');
    }
  };

  Blockly.Blocks['looks_change_size'] = {
    init: function() {
      this.appendValueInput('SIZE')
        .setCheck('Number')
        .appendField('change size by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Change size by amount');
    }
  };

  // Control
  Blockly.Blocks['control_wait'] = {
    init: function() {
      this.appendValueInput('SECONDS')
        .setCheck('Number')
        .appendField('wait');
      this.appendDummyInput()
        .appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Wait for some time');
    }
  };

  Blockly.Blocks['control_repeat'] = {
    init: function() {
      this.appendValueInput('TIMES')
        .setCheck('Number')
        .appendField('repeat');
      this.appendDummyInput()
        .appendField('times');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Repeat some number of times');
    }
  };

  Blockly.Blocks['control_stop'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('stop')
        .appendField(new Blockly.FieldDropdown([
          ['all', 'ALL'],
          ['this script', 'THIS'],
        ]), 'STOP_OPTION');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Stop scripts');
    }
  };

  // Sensing
  Blockly.Blocks['sensing_key_pressed'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('key')
        .appendField(new Blockly.FieldDropdown([
          ['space', 'SPACE'],
          ['up arrow', 'UP'],
          ['down arrow', 'DOWN'],
          ['left arrow', 'LEFT'],
          ['right arrow', 'RIGHT'],
          ['w', 'W'],
          ['a', 'A'],
          ['s', 'S'],
          ['d', 'D'],
        ]), 'KEY')
        .appendField('pressed?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is a key pressed?');
    }
  };

  Blockly.Blocks['sensing_mouse_down'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse down?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is mouse button pressed?');
    }
  };

  Blockly.Blocks['sensing_mouse_x'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse x');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Mouse x position');
    }
  };

  Blockly.Blocks['sensing_mouse_y'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse y');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Mouse y position');
    }
  };

  Blockly.Blocks['sensing_touching'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('touching')
        .appendField(new Blockly.FieldDropdown([
          ['edge', 'EDGE'],
          ['(select object)', ''],
        ]), 'TARGET')
        .appendField('?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this touching something?');
    }
  };

  Blockly.Blocks['sensing_distance_to'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('distance to')
        .appendField(new Blockly.FieldDropdown([
          ['mouse', 'MOUSE'],
          ['(select object)', ''],
        ]), 'TARGET');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Distance to target');
    }
  };

  // Physics blocks
  Blockly.Blocks['physics_enable'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('enable physics');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Enable physics for this object');
    }
  };

  Blockly.Blocks['physics_set_velocity'] = {
    init: function() {
      this.appendValueInput('VX')
        .setCheck('Number')
        .appendField('set velocity x:');
      this.appendValueInput('VY')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set velocity');
    }
  };

  Blockly.Blocks['physics_set_velocity_x'] = {
    init: function() {
      this.appendValueInput('VX')
        .setCheck('Number')
        .appendField('set velocity x to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set horizontal velocity');
    }
  };

  Blockly.Blocks['physics_set_velocity_y'] = {
    init: function() {
      this.appendValueInput('VY')
        .setCheck('Number')
        .appendField('set velocity y to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set vertical velocity');
    }
  };

  Blockly.Blocks['physics_set_gravity'] = {
    init: function() {
      this.appendValueInput('GRAVITY')
        .setCheck('Number')
        .appendField('set gravity to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set gravity strength');
    }
  };

  Blockly.Blocks['physics_set_bounce'] = {
    init: function() {
      this.appendValueInput('BOUNCE')
        .setCheck('Number')
        .appendField('set bounce to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set bounce (0-1)');
    }
  };

  Blockly.Blocks['physics_collide_bounds'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'ENABLED')
        .appendField('collide with world bounds');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Enable/disable world bounds collision');
    }
  };

  Blockly.Blocks['physics_immovable'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('make immovable');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Make this object immovable (like a platform)');
    }
  };

  // Camera blocks
  Blockly.Blocks['camera_follow_me'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera follow me');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera follows this object');
    }
  };

  Blockly.Blocks['camera_follow_object'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera follow')
        .appendField(new Blockly.FieldDropdown([
          ['(select object)', ''],
        ]), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera follows an object');
    }
  };

  Blockly.Blocks['camera_stop_follow'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera stop following');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera stops following');
    }
  };

  Blockly.Blocks['camera_go_to'] = {
    init: function() {
      this.appendValueInput('X')
        .setCheck('Number')
        .appendField('camera go to x:');
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Move camera to position');
    }
  };

  Blockly.Blocks['camera_shake'] = {
    init: function() {
      this.appendValueInput('DURATION')
        .setCheck('Number')
        .appendField('camera shake for');
      this.appendDummyInput()
        .appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Shake the camera');
    }
  };

  Blockly.Blocks['camera_zoom'] = {
    init: function() {
      this.appendValueInput('ZOOM')
        .setCheck('Number')
        .appendField('set camera zoom to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Set camera zoom level');
    }
  };

  Blockly.Blocks['camera_fade'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera fade')
        .appendField(new Blockly.FieldDropdown([
          ['in', 'IN'],
          ['out', 'OUT'],
        ]), 'DIRECTION');
      this.appendValueInput('DURATION')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Fade camera in or out');
    }
  };

  // Sound blocks
  Blockly.Blocks['sound_play'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('play sound')
        .appendField(new Blockly.FieldDropdown([
          ['pop', 'pop'],
          ['jump', 'jump'],
          ['coin', 'coin'],
          ['hit', 'hit'],
        ]), 'SOUND');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Play a sound');
    }
  };

  Blockly.Blocks['sound_play_until_done'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('play sound')
        .appendField(new Blockly.FieldDropdown([
          ['pop', 'pop'],
          ['jump', 'jump'],
          ['coin', 'coin'],
          ['hit', 'hit'],
        ]), 'SOUND')
        .appendField('until done');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Play sound and wait until finished');
    }
  };

  Blockly.Blocks['sound_stop_all'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('stop all sounds');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Stop all playing sounds');
    }
  };

  Blockly.Blocks['sound_set_volume'] = {
    init: function() {
      this.appendValueInput('VOLUME')
        .setCheck('Number')
        .appendField('set volume to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Set volume level (0-100)');
    }
  };

  Blockly.Blocks['sound_change_volume'] = {
    init: function() {
      this.appendValueInput('DELTA')
        .setCheck('Number')
        .appendField('change volume by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Change volume by amount');
    }
  };

  // Advanced events
  Blockly.Blocks['event_when_receive'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('when I receive')
        .appendField(new Blockly.FieldTextInput('message1'), 'MESSAGE');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when message is received');
    }
  };

  Blockly.Blocks['event_when_touching'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('when touching')
        .appendField(new Blockly.FieldDropdown([
          ['edge', 'EDGE'],
          ['(select object)', ''],
        ]), 'TARGET');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when touching target');
    }
  };

  Blockly.Blocks['event_when_clone_start'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('when I start as a clone');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when this clone is created');
    }
  };

  // Advanced control
  Blockly.Blocks['control_switch_scene'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('switch to scene')
        .appendField(new Blockly.FieldTextInput('Scene 1'), 'SCENE');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Switch to another scene');
    }
  };

  Blockly.Blocks['control_clone'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('clone myself');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Create a clone of this object');
    }
  };

  Blockly.Blocks['control_delete_clone'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('delete this clone');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Delete this clone');
    }
  };

  Blockly.Blocks['control_broadcast'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('broadcast')
        .appendField(new Blockly.FieldTextInput('message1'), 'MESSAGE');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Send a message to all objects');
    }
  };

  Blockly.Blocks['control_broadcast_wait'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('broadcast')
        .appendField(new Blockly.FieldTextInput('message1'), 'MESSAGE')
        .appendField('and wait');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Send a message and wait');
    }
  };

  // Additional motion blocks
  Blockly.Blocks['motion_point_towards'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('point towards')
        .appendField(new Blockly.FieldDropdown([
          ['mouse', 'MOUSE'],
          ['(select object)', ''],
        ]), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Point towards target');
    }
  };

  // Additional looks blocks
  Blockly.Blocks['looks_set_opacity'] = {
    init: function() {
      this.appendValueInput('OPACITY')
        .setCheck('Number')
        .appendField('set opacity to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Set transparency (0-100)');
    }
  };

  Blockly.Blocks['looks_go_to_front'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('go to front layer');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Move to front of display');
    }
  };

  Blockly.Blocks['looks_go_to_back'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('go to back layer');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Move to back of display');
    }
  };
}

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
}

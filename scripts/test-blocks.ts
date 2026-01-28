/**
 * Automated test script for Blockly blocks and code generation.
 * Run with: npx tsx scripts/test-blocks.ts
 */

import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';

// Import and run block registration
import '../src/components/blockly/toolbox';
import { registerCodeGenerators, generateCodeForObject } from '../src/phaser/CodeGenerator';

registerCodeGenerators();

interface TestCase {
  name: string;
  xml: string;
  expectCodeContains?: string[];
  expectEmptyCode?: boolean;  // Code should be empty
  expectNoError?: boolean;
}

const testCases: TestCase[] = [
  // Test that orphan blocks (without events) don't generate code
  {
    name: 'orphan block without event should not generate code',
    xml: `
      <xml>
        <block type="motion_change_x">
          <value name="VALUE">
            <block type="math_number"><field name="NUM">10</field></block>
          </value>
        </block>
      </xml>
    `,
    expectEmptyCode: true, // Should be empty - no event block
  },
  // Event blocks with nested statements
  {
    name: 'event_game_start with motion_change_x',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="motion_change_x">
              <value name="VALUE">
                <block type="math_number">
                  <field name="NUM">10</field>
                </block>
              </value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    expectCodeContains: ['runtime.onGameStart', 'sprite.changeX(10)'],
  },
  {
    name: 'event_key_pressed (space) with motion_set_x',
    xml: `
      <xml>
        <block type="event_key_pressed">
          <field name="KEY">SPACE</field>
          <statement name="NEXT">
            <block type="motion_set_x">
              <value name="VALUE">
                <block type="math_number">
                  <field name="NUM">100</field>
                </block>
              </value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    expectCodeContains: ["runtime.onKeyPressed(spriteId, 'SPACE'", 'sprite.setX(100)'],
  },
  {
    name: 'event_clicked with looks_hide',
    xml: `
      <xml>
        <block type="event_clicked">
          <statement name="NEXT">
            <block type="looks_hide"></block>
          </statement>
        </block>
      </xml>
    `,
    expectCodeContains: ['runtime.onClicked', 'sprite.hide()'],
  },
  {
    name: 'event_forever with motion_move_steps',
    xml: `
      <xml>
        <block type="event_forever">
          <statement name="DO">
            <block type="motion_move_steps">
              <value name="STEPS">
                <block type="math_number">
                  <field name="NUM">5</field>
                </block>
              </value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    expectCodeContains: ['runtime.forever', 'sprite.moveSteps(5)'],
  },
  // Motion blocks standalone
  {
    name: 'motion_go_to',
    xml: `
      <xml>
        <block type="motion_go_to">
          <value name="X"><block type="math_number"><field name="NUM">50</field></block></value>
          <value name="Y"><block type="math_number"><field name="NUM">75</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['sprite.goTo(50, 75)'],
  },
  {
    name: 'motion_change_y',
    xml: `
      <xml>
        <block type="motion_change_y">
          <value name="VALUE"><block type="math_number"><field name="NUM">-20</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['sprite.changeY((-20))'], // Blockly wraps negative numbers
  },
  {
    name: 'motion_set_y',
    xml: `
      <xml>
        <block type="motion_set_y">
          <value name="VALUE"><block type="math_number"><field name="NUM">200</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['sprite.setY(200)'],
  },
  // Looks blocks
  {
    name: 'looks_show',
    xml: `<xml><block type="looks_show"></block></xml>`,
    expectCodeContains: ['sprite.show()'],
  },
  {
    name: 'looks_set_size',
    xml: `
      <xml>
        <block type="looks_set_size">
          <value name="SIZE"><block type="math_number"><field name="NUM">150</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['sprite.setSize(150)'],
  },
  // Physics blocks
  {
    name: 'physics_enable',
    xml: `<xml><block type="physics_enable"></block></xml>`,
    expectCodeContains: ['sprite.enablePhysics()'],
  },
  {
    name: 'physics_set_velocity',
    xml: `
      <xml>
        <block type="physics_set_velocity">
          <value name="VX"><block type="math_number"><field name="NUM">100</field></block></value>
          <value name="VY"><block type="math_number"><field name="NUM">-50</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['sprite.setVelocity(100, (-50))'], // Blockly wraps negative numbers
  },
  // Control blocks
  {
    name: 'control_wait',
    xml: `
      <xml>
        <block type="control_wait">
          <value name="SECONDS"><block type="math_number"><field name="NUM">2</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['await runtime.wait(2)'],
  },
  {
    name: 'control_repeat with nested block',
    xml: `
      <xml>
        <block type="control_repeat">
          <value name="TIMES"><block type="math_number"><field name="NUM">5</field></block></value>
          <statement name="DO">
            <block type="motion_move_steps">
              <value name="STEPS"><block type="math_number"><field name="NUM">10</field></block></value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    expectCodeContains: ['for (let i = 0; i < 5; i++)', 'sprite.moveSteps(10)'],
  },
  // Sensing blocks (reporters)
  {
    name: 'sensing_key_pressed',
    xml: `
      <xml>
        <block type="sensing_key_pressed">
          <field name="KEY">UP</field>
        </block>
      </xml>
    `,
    expectCodeContains: ["runtime.isKeyPressed('UP')"],
  },
  {
    name: 'sensing_mouse_x',
    xml: `<xml><block type="sensing_mouse_x"></block></xml>`,
    expectCodeContains: ['runtime.getMouseX()'],
  },
  // Camera blocks
  {
    name: 'camera_follow_me',
    xml: `<xml><block type="camera_follow_me"></block></xml>`,
    expectCodeContains: ['runtime.cameraFollowSprite(spriteId)'],
  },
  {
    name: 'camera_shake',
    xml: `
      <xml>
        <block type="camera_shake">
          <value name="DURATION"><block type="math_number"><field name="NUM">0.5</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['runtime.cameraShake(0.5)'],
  },
  // Costume blocks
  {
    name: 'looks_next_costume',
    xml: `<xml><block type="looks_next_costume"></block></xml>`,
    expectCodeContains: ['sprite.nextCostume()'],
  },
  {
    name: 'looks_switch_costume',
    xml: `
      <xml>
        <block type="looks_switch_costume">
          <value name="COSTUME"><block type="math_number"><field name="NUM">2</field></block></value>
        </block>
      </xml>
    `,
    expectCodeContains: ['sprite.switchCostume(2)'],
  },
  {
    name: 'looks_costume_number',
    xml: `<xml><block type="looks_costume_number"></block></xml>`,
    expectCodeContains: ['sprite.getCostumeNumber()'],
  },
  // Combined test: full program
  {
    name: 'Full program: game start with multiple actions',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="motion_go_to">
              <value name="X"><block type="math_number"><field name="NUM">100</field></block></value>
              <value name="Y"><block type="math_number"><field name="NUM">100</field></block></value>
              <next>
                <block type="looks_show">
                  <next>
                    <block type="physics_enable"></block>
                  </next>
                </block>
              </next>
            </block>
          </statement>
        </block>
      </xml>
    `,
    expectCodeContains: ['runtime.onGameStart', 'sprite.goTo(100, 100)', 'sprite.show()', 'sprite.enablePhysics()'],
  },
];

function runTests(): void {
  console.log('=== Block Code Generation Tests ===\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const test of testCases) {
    try {
      let code: string;

      if (test.expectEmptyCode) {
        // Use generateCodeForObject for testing hat block filtering
        code = generateCodeForObject(test.xml, 'test-object');
      } else {
        // Create workspace and use raw code generation
        const workspace = new Blockly.Workspace();
        const dom = Blockly.utils.xml.textToDom(test.xml);
        Blockly.Xml.domToWorkspace(dom, workspace);
        code = javascriptGenerator.workspaceToCode(workspace);
        workspace.dispose();
      }

      // Check expectations
      let testPassed = true;
      const missingParts: string[] = [];

      if (test.expectEmptyCode) {
        // Check that code is empty or just whitespace
        if (code.trim() !== '') {
          testPassed = false;
          missingParts.push('(expected empty code)');
        }
      } else if (test.expectCodeContains) {
        for (const expected of test.expectCodeContains) {
          if (!code.includes(expected)) {
            testPassed = false;
            missingParts.push(expected);
          }
        }
      }

      if (testPassed) {
        console.log(`✓ ${test.name}`);
        passed++;
      } else {
        console.log(`✗ ${test.name}`);
        console.log(`  Missing: ${missingParts.join(', ')}`);
        console.log(`  Generated code:\n${code.split('\n').map(l => '    ' + l).join('\n')}`);
        failed++;
        failures.push(test.name);
      }
    } catch (error) {
      console.log(`✗ ${test.name}`);
      console.log(`  Error: ${error}`);
      failed++;
      failures.push(`${test.name} (ERROR)`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}/${testCases.length}`);
  console.log(`Failed: ${failed}/${testCases.length}`);

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\nAll tests passed!');
    process.exit(0);
  }
}

runTests();

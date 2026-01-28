/**
 * Automated test script for block code generation AND execution.
 * This simulates the runtime to verify blocks actually work.
 * Run with: npx tsx scripts/test-execution.ts
 */

import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';

// Import and run block registration
import '../src/components/blockly/toolbox';
import { registerCodeGenerators } from '../src/phaser/CodeGenerator';

registerCodeGenerators();

// Mock RuntimeSprite that tracks all method calls
class MockSprite {
  public calls: { method: string; args: any[] }[] = [];
  public x = 0;
  public y = 0;
  public visible = true;
  public size = 100;
  public opacity = 100;
  public rotation = 0;
  public velocityX = 0;
  public velocityY = 0;

  private log(method: string, ...args: any[]) {
    this.calls.push({ method, args });
    console.log(`    sprite.${method}(${args.join(', ')})`);
  }

  moveSteps(steps: number) { this.log('moveSteps', steps); this.x += steps; }
  goTo(x: number, y: number) { this.log('goTo', x, y); this.x = x; this.y = y; }
  changeX(value: number) { this.log('changeX', value); this.x += value; }
  changeY(value: number) { this.log('changeY', value); this.y += value; }
  setX(value: number) { this.log('setX', value); this.x = value; }
  setY(value: number) { this.log('setY', value); this.y = value; }
  pointInDirection(dir: number) { this.log('pointInDirection', dir); this.rotation = dir; }
  pointTowards(x: number, y: number) { this.log('pointTowards', x, y); }
  show() { this.log('show'); this.visible = true; }
  hide() { this.log('hide'); this.visible = false; }
  setSize(size: number) { this.log('setSize', size); this.size = size; }
  changeSize(delta: number) { this.log('changeSize', delta); this.size += delta; }
  setOpacity(opacity: number) { this.log('setOpacity', opacity); this.opacity = opacity; }
  goToFront() { this.log('goToFront'); }
  goToBack() { this.log('goToBack'); }
  enablePhysics() { this.log('enablePhysics'); }
  setVelocity(vx: number, vy: number) { this.log('setVelocity', vx, vy); this.velocityX = vx; this.velocityY = vy; }
  setVelocityX(vx: number) { this.log('setVelocityX', vx); this.velocityX = vx; }
  setVelocityY(vy: number) { this.log('setVelocityY', vy); this.velocityY = vy; }
  setGravity(g: number) { this.log('setGravity', g); }
  setBounce(b: number) { this.log('setBounce', b); }
  setCollideWorldBounds(enabled: boolean) { this.log('setCollideWorldBounds', enabled); }
  makeImmovable() { this.log('makeImmovable'); }
}

// Mock Runtime that tracks all registrations and calls
class MockRuntime {
  public calls: { method: string; args: any[] }[] = [];
  public registeredHandlers: {
    onStart: Function[];
    onKeyPressed: Map<string, Function[]>;
    onClick: Function[];
    forever: Function[];
  } = {
    onStart: [],
    onKeyPressed: new Map(),
    onClick: [],
    forever: [],
  };

  private log(method: string, ...args: any[]) {
    this.calls.push({ method, args: args.filter(a => typeof a !== 'function') });
  }

  // Event registration
  onGameStart(spriteId: string, handler: Function) {
    this.log('onGameStart', spriteId);
    this.registeredHandlers.onStart.push(handler);
  }

  onKeyPressed(spriteId: string, key: string, handler: Function) {
    this.log('onKeyPressed', spriteId, key);
    if (!this.registeredHandlers.onKeyPressed.has(key)) {
      this.registeredHandlers.onKeyPressed.set(key, []);
    }
    this.registeredHandlers.onKeyPressed.get(key)!.push(handler);
  }

  onClicked(spriteId: string, handler: Function) {
    this.log('onClicked', spriteId);
    this.registeredHandlers.onClick.push(handler);
  }

  forever(spriteId: string, handler: Function) {
    this.log('forever', spriteId);
    this.registeredHandlers.forever.push(handler);
  }

  onTouching(spriteId: string, targetId: string, handler: Function) {
    this.log('onTouching', spriteId, targetId);
  }

  onMessage(spriteId: string, message: string, handler: Function) {
    this.log('onMessage', spriteId, message);
  }

  onCloneStart(spriteId: string, handler: Function) {
    this.log('onCloneStart', spriteId);
  }

  // Actions
  wait(seconds: number) {
    this.log('wait', seconds);
    return Promise.resolve();
  }

  stopAll() { this.log('stopAll'); }
  stopSprite(spriteId: string) { this.log('stopSprite', spriteId); }
  broadcast(message: string) { this.log('broadcast', message); }
  broadcastAndWait(message: string) { this.log('broadcastAndWait', message); return Promise.resolve(); }
  cloneSprite(spriteId: string) { this.log('cloneSprite', spriteId); }
  deleteClone(spriteId: string) { this.log('deleteClone', spriteId); }
  switchToScene(sceneName: string) { this.log('switchToScene', sceneName); }

  // Sensing
  private keyStates: Map<string, boolean> = new Map();

  mockKeyState(key: string, pressed: boolean) {
    this.keyStates.set(key, pressed);
  }

  isKeyPressed(key: string) {
    const pressed = this.keyStates.get(key) || false;
    // Don't log every frame to reduce noise
    return pressed;
  }
  isMouseDown() { return false; }
  getMouseX() { return 0; }
  getMouseY() { return 0; }
  isTouching(spriteId: string, targetId: string) { return false; }
  distanceTo(spriteId: string, targetId: string) { return 0; }
  getSprite(id: string) { return null; }

  // Camera
  cameraFollowSprite(spriteId: string) { this.log('cameraFollowSprite', spriteId); }
  cameraStopFollow() { this.log('cameraStopFollow'); }
  cameraGoTo(x: number, y: number) { this.log('cameraGoTo', x, y); }
  cameraShake(duration: number) { this.log('cameraShake', duration); }
  cameraZoom(zoom: number) { this.log('cameraZoom', zoom); }
  cameraFadeIn(duration: number) { this.log('cameraFadeIn', duration); }
  cameraFadeOut(duration: number) { this.log('cameraFadeOut', duration); }

  // Sound
  playSound(sound: string) { this.log('playSound', sound); }
  playSoundUntilDone(sound: string) { this.log('playSoundUntilDone', sound); return Promise.resolve(); }
  stopAllSounds() { this.log('stopAllSounds'); }
  setVolume(volume: number) { this.log('setVolume', volume); }
  changeVolume(delta: number) { this.log('changeVolume', delta); }

  // Variables
  getVariable(name: string, spriteId?: string) { return 0; }
  setVariable(name: string, value: any, spriteId?: string) { this.log('setVariable', name, value); }
  changeVariable(name: string, delta: number, spriteId?: string) { this.log('changeVariable', name, delta); }

  // Simulate starting the game
  async simulateStart() {
    console.log('  [Simulating game start...]');
    for (const handler of this.registeredHandlers.onStart) {
      await handler();
    }
  }

  // Simulate key press
  async simulateKeyPress(key: string) {
    console.log(`  [Simulating key press: ${key}...]`);
    const handlers = this.registeredHandlers.onKeyPressed.get(key) || [];
    for (const handler of handlers) {
      await handler();
    }
  }

  // Simulate one frame of forever loop
  simulateForeverFrame() {
    for (const handler of this.registeredHandlers.forever) {
      handler();
    }
  }
}

interface ExecutionTest {
  name: string;
  xml: string;
  simulate: (runtime: MockRuntime, sprite: MockSprite) => Promise<void>;
  verify: (runtime: MockRuntime, sprite: MockSprite) => boolean;
}

const executionTests: ExecutionTest[] = [
  {
    name: 'forever with if key pressed -> change y',
    xml: `
      <xml>
        <block type="event_forever">
          <statement name="DO">
            <block type="controls_if">
              <value name="IF0">
                <block type="sensing_key_pressed">
                  <field name="KEY">SPACE</field>
                </block>
              </value>
              <statement name="DO0">
                <block type="motion_change_y">
                  <value name="VALUE">
                    <block type="math_number"><field name="NUM">4</field></block>
                  </value>
                </block>
              </statement>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime, sprite) => {
      // Frame 1: no key pressed
      runtime.simulateForeverFrame();
      console.log(`    After frame 1 (no key): y=${sprite.y}`);

      // Press space
      (runtime as any).mockKeyState('SPACE', true);

      // Frame 2: space pressed
      runtime.simulateForeverFrame();
      console.log(`    After frame 2 (space pressed): y=${sprite.y}`);

      // Frame 3: space still pressed
      runtime.simulateForeverFrame();
      console.log(`    After frame 3 (space pressed): y=${sprite.y}`);
    },
    verify: (runtime, sprite) => {
      // Should have changed Y by 4 twice (frames 2 and 3)
      return sprite.y === 8;
    },
  },
  {
    name: 'when game starts -> change x by 10',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="motion_change_x">
              <value name="VALUE">
                <block type="math_number"><field name="NUM">10</field></block>
              </value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateStart();
    },
    verify: (runtime, sprite) => {
      return sprite.x === 10 && sprite.calls.some(c => c.method === 'changeX' && c.args[0] === 10);
    },
  },
  {
    name: 'when space pressed -> set x to 100',
    xml: `
      <xml>
        <block type="event_key_pressed">
          <field name="KEY">SPACE</field>
          <statement name="NEXT">
            <block type="motion_set_x">
              <value name="VALUE">
                <block type="math_number"><field name="NUM">100</field></block>
              </value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateKeyPress('SPACE');
    },
    verify: (runtime, sprite) => {
      return sprite.x === 100;
    },
  },
  {
    name: 'when game starts -> go to x:50 y:75',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="motion_go_to">
              <value name="X"><block type="math_number"><field name="NUM">50</field></block></value>
              <value name="Y"><block type="math_number"><field name="NUM">75</field></block></value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateStart();
    },
    verify: (runtime, sprite) => {
      return sprite.x === 50 && sprite.y === 75;
    },
  },
  {
    name: 'when game starts -> hide',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="looks_hide"></block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateStart();
    },
    verify: (runtime, sprite) => {
      return sprite.visible === false;
    },
  },
  {
    name: 'when game starts -> set velocity x:100 y:-50',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="physics_set_velocity">
              <value name="VX"><block type="math_number"><field name="NUM">100</field></block></value>
              <value name="VY"><block type="math_number"><field name="NUM">-50</field></block></value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateStart();
    },
    verify: (runtime, sprite) => {
      return sprite.velocityX === 100 && sprite.velocityY === -50;
    },
  },
  {
    name: 'when game starts -> camera follow me',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="camera_follow_me"></block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateStart();
    },
    verify: (runtime, sprite) => {
      return runtime.calls.some(c => c.method === 'cameraFollowSprite');
    },
  },
  {
    name: 'forever -> move 5 steps (runs each frame)',
    xml: `
      <xml>
        <block type="event_forever">
          <statement name="DO">
            <block type="motion_move_steps">
              <value name="STEPS"><block type="math_number"><field name="NUM">5</field></block></value>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      // Simulate 3 frames
      runtime.simulateForeverFrame();
      runtime.simulateForeverFrame();
      runtime.simulateForeverFrame();
    },
    verify: (runtime, sprite) => {
      // Should have moved 5 steps * 3 frames = 15
      return sprite.x === 15;
    },
  },
  {
    name: 'when game starts -> multiple blocks chained',
    xml: `
      <xml>
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="motion_set_x">
              <value name="VALUE"><block type="math_number"><field name="NUM">100</field></block></value>
              <next>
                <block type="motion_set_y">
                  <value name="VALUE"><block type="math_number"><field name="NUM">200</field></block></value>
                  <next>
                    <block type="looks_show"></block>
                  </next>
                </block>
              </next>
            </block>
          </statement>
        </block>
      </xml>
    `,
    simulate: async (runtime) => {
      await runtime.simulateStart();
    },
    verify: (runtime, sprite) => {
      return sprite.x === 100 && sprite.y === 200 && sprite.visible === true &&
             sprite.calls.length === 3;
    },
  },
];

function generateAndExecute(xml: string): { code: string; runtime: MockRuntime; sprite: MockSprite } {
  // Create workspace and load XML
  const workspace = new Blockly.Workspace();
  const dom = Blockly.utils.xml.textToDom(xml);
  Blockly.Xml.domToWorkspace(dom, workspace);

  // Generate code
  const rawCode = javascriptGenerator.workspaceToCode(workspace);
  workspace.dispose();

  // Wrap code like PhaserCanvas does
  // IMPORTANT: No leading newline, or `return ${wrappedCode}` will fail due to ASI
  const wrappedCode = `(function(runtime, spriteId, sprite) {
${rawCode}
})`;

  // Create mocks
  const runtime = new MockRuntime();
  const sprite = new MockSprite();
  const spriteId = 'test-sprite';

  // Execute the code (this registers handlers)
  try {
    const execFunction = new Function('runtime', 'spriteId', 'sprite', `return ${wrappedCode};`);
    const registerFunc = execFunction(runtime, spriteId, sprite);
    if (typeof registerFunc === 'function') {
      registerFunc(runtime, spriteId, sprite);
    }
  } catch (e) {
    console.error('Execution error:', e);
  }

  return { code: rawCode, runtime, sprite };
}

async function runTests(): Promise<void> {
  console.log('=== Block Execution Tests ===\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const test of executionTests) {
    console.log(`Testing: ${test.name}`);

    try {
      const { code, runtime, sprite } = generateAndExecute(test.xml);

      console.log('  Generated code:');
      code.split('\n').filter(l => l.trim()).forEach(l => console.log(`    ${l}`));

      console.log('  Registered handlers:');
      console.log(`    onStart: ${runtime.registeredHandlers.onStart.length}`);
      console.log(`    onKeyPressed: ${Array.from(runtime.registeredHandlers.onKeyPressed.keys()).join(', ') || 'none'}`);
      console.log(`    forever: ${runtime.registeredHandlers.forever.length}`);

      // Run simulation
      await test.simulate(runtime, sprite);

      // Verify
      const success = test.verify(runtime, sprite);

      if (success) {
        console.log(`  Result: PASS`);
        console.log(`  Sprite state: x=${sprite.x}, y=${sprite.y}, visible=${sprite.visible}\n`);
        passed++;
      } else {
        console.log(`  Result: FAIL`);
        console.log(`  Sprite state: x=${sprite.x}, y=${sprite.y}, visible=${sprite.visible}`);
        console.log(`  Sprite calls: ${JSON.stringify(sprite.calls)}`);
        console.log(`  Runtime calls: ${JSON.stringify(runtime.calls)}\n`);
        failed++;
        failures.push(test.name);
      }
    } catch (error) {
      console.log(`  Result: ERROR - ${error}\n`);
      failed++;
      failures.push(`${test.name} (ERROR)`);
    }
  }

  console.log('=== Summary ===');
  console.log(`Passed: ${passed}/${executionTests.length}`);
  console.log(`Failed: ${failed}/${executionTests.length}`);

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\nAll execution tests passed!');
    process.exit(0);
  }
}

runTests();

import { expect, test } from '@playwright/test';
import {
  summarizeToolArgs,
  summarizeToolDiagnostics,
} from '../src/lib/assistant/toolDiagnostics';

const MALFORMED_BLOCKLY_XML = `
  <xml xmlns="https://developers.google.com/blockly/xml">
    <block type="event_game_start">
      <statement name="NEXT">
        <block type="event_forever">
          <statement name="DO">
            <block type="controls_if">
              <value name="IF0">
                <block type="keyboard_keyPressed">
                  <field name="KEY">a</field>
                </block>
              </value>
            </block>
          </statement>
        </block>
      </statement>
  </xml>
`.trim();

test.describe('assistant tool diagnostics', () => {
  test('summarizeToolArgs surfaces Blockly structure and unsupported block diagnostics', () => {
    const summary = summarizeToolArgs({
      sceneId: 'scene_1',
      objectId: 'object_1',
      blocklyXml: MALFORMED_BLOCKLY_XML,
    });

    expect(summary).toContain('sceneId="scene_1"');
    expect(summary).toContain('objectId="object_1"');
    expect(summary).toContain('Blockly XML');
    expect(summary).toContain('blocks=event_game_start,event_forever,controls_if,keyboard_keyPressed');
    expect(summary).toContain('rawInvalid=');
    expect(summary).toContain('unsupported=keyboard_keyPressed');
  });

  test('summarizeToolDiagnostics surfaces structured tool errors', () => {
    const summary = summarizeToolDiagnostics({
      ok: false,
      error: {
        code: 'validation_failed',
        details: {
          issues: [
            {
              code: 'object.invalid_blockly_xml',
              message: 'Object logic is malformed.',
            },
          ],
        },
      },
    });

    expect(summary).toContain('code=validation_failed');
    expect(summary).toContain('object.invalid_blockly_xml');
  });
});

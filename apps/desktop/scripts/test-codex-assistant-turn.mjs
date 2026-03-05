#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../src/main/codexTurnOutput.schema.json');

function buildPrompt() {
  const envelope = {
    task: 'Classify and handle Blockly assistant turn',
    outputContract: {
      mode: 'chat|edit',
      chat: 'Provide answer',
      edit: 'Provide proposedEditsJson stringified JSON with intentSummary, assumptions[], semanticOps[], projectOps[]',
    },
    rules: [
      'If the user is asking a question or clarification, choose mode=chat.',
      'If the user is asking for Blockly or project changes, choose mode=edit.',
      'If the user is discussing capabilities/planning/tooling (not requesting concrete project changes now), choose mode=chat.',
      'Use capabilities as strict source of truth for available blocks/actions.',
      'Do not use deprecated blocks. If unsupported, explain with mode=chat.',
      'When mode=edit, proposedEditsJson must be valid JSON and include BOTH semanticOps and projectOps arrays.',
      'Never output placeholder/template operations. Do not emit empty strings for required IDs/names.',
      'If required scene/object/costume references are not available, choose mode=chat and ask a concise follow-up.',
      'Allowed projectOps: rename_project, create_scene, rename_scene, reorder_scenes, create_object, rename_object, set_object_property, set_object_physics, set_object_collider_type, create_folder, rename_folder, move_object_to_folder, add_costume_from_image_url, add_costume_text_circle, rename_costume, reorder_costumes, set_current_costume, validate_project.',
      'When mode=chat, put your response in answer and set proposedEditsJson=null.',
      'When mode=edit, set answer=null and put JSON string in proposedEditsJson.',
      'Do not include markdown fences in any field.',
    ],
    userIntent: 'Is there an is touching ground block or should I use touching with ground collider?',
    chatHistory: [
      { role: 'user', content: 'I asked about touching ground.' },
      { role: 'assistant', content: 'Use capabilities as source of truth.' },
    ],
    context: {
      scope: 'object',
      object: { id: 'obj-1', name: 'Player', physics: { enabled: true } },
      scene: { id: 'scene-1', name: 'Main Scene' },
    },
    programRead: {
      hasGameStart: true,
      hasGroundCollider: true,
      summary: 'Player object with physics enabled.',
    },
    capabilities: {
      blocks: {
        sensing_touching_value: { type: 'sensing_touching_value', isValue: true },
        target_ground: { type: 'target_ground', isValue: true },
        event_key_pressed: { type: 'event_key_pressed', isStatement: true },
        motion_set_velocity_y: { type: 'motion_set_velocity_y', isStatement: true },
      },
      limits: {
        maxOpsPerRequest: 12,
        maxActionDepth: 6,
        maxBlocksPerMutation: 80,
      },
    },
    threadContext: {
      threadId: 'thread-e2e-smoke',
      scopeKey: 'object:scene-1:obj-1',
    },
  };

  return [
    'You are PochaCoding Blockly assistant.',
    'Return a JSON object matching the output schema.',
    JSON.stringify(envelope, null, 2),
  ].join('\n\n');
}

function spawnAsync(cmd, args, options = {}) {
  const { input, timeoutMs = 90000, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, spawnOptions);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });

    if (typeof input === 'string') {
      child.stdin?.end(input, 'utf8');
    } else {
      child.stdin?.end();
    }
  });
}

async function main() {
  const codexExecutable = process.env.POCHACODING_CODEX_BIN?.trim() || 'codex';
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pochacoding-codex-turn-test-'));
  const outputPath = path.join(tmpDir, 'out.json');

  try {
    const result = await spawnAsync(
      codexExecutable,
      [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        'ask_for_approval=never',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '--cd',
        process.cwd(),
        '-',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        input: buildPrompt(),
        timeoutMs: 90000,
      },
    );

    if (result.timedOut) {
      throw new Error('codex assistant-turn smoke timed out after 90s');
    }

    let output = '';
    try {
      output = (await fs.readFile(outputPath, 'utf8')).trim();
    } catch {
      output = '';
    }

    if (result.code !== 0 || !output) {
      const details = (result.stderr || result.stdout || 'no codex output').slice(-2000);
      throw new Error(`codex assistant-turn smoke failed (exit ${result.code}): ${details}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      throw new Error(`codex assistant-turn smoke returned invalid JSON: ${String(error)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('codex assistant-turn smoke returned non-object payload');
    }

    if (parsed.mode === 'chat') {
      if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
        throw new Error(`chat mode missing non-empty answer: ${output}`);
      }
      if (parsed.proposedEditsJson !== null) {
        throw new Error(`chat mode expected proposedEditsJson=null: ${output}`);
      }
      process.stdout.write('[codex-turn] assistant turn smoke passed (chat mode)\n');
      return;
    }

    if (parsed.mode === 'edit') {
      if (typeof parsed.proposedEditsJson !== 'string' || !parsed.proposedEditsJson.trim()) {
        throw new Error(`edit mode missing proposedEditsJson string: ${output}`);
      }
      let proposedEdits;
      try {
        proposedEdits = JSON.parse(parsed.proposedEditsJson);
      } catch (error) {
        throw new Error(`edit mode proposedEditsJson is not valid JSON: ${String(error)}`);
      }

      if (!proposedEdits || typeof proposedEdits !== 'object') {
        throw new Error(`edit mode proposedEditsJson must decode to an object: ${parsed.proposedEditsJson}`);
      }

      process.stdout.write('[codex-turn] assistant turn smoke passed (edit mode)\n');
      return;
    }

    throw new Error(`unsupported mode from codex assistant-turn smoke: ${JSON.stringify(parsed)}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

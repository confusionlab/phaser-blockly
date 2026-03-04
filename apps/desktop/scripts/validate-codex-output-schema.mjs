#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../src/main/codexTurnOutput.schema.json');

function validateSchema(schema) {
  const errors = [];
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return ['schema must be an object'];
  }
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    errors.push('schema.properties must be an object');
    return errors;
  }
  const propertyKeys = Object.keys(properties);
  if (propertyKeys.length === 0) {
    errors.push('schema.properties must declare at least one key');
  }
  const required = schema.required;
  if (!Array.isArray(required)) {
    errors.push('schema.required must be an array');
    return errors;
  }
  if (!required.every((value) => typeof value === 'string')) {
    errors.push('schema.required must contain only strings');
    return errors;
  }

  const requiredSet = new Set(required);
  const missingRequired = propertyKeys.filter((key) => !requiredSet.has(key));
  if (missingRequired.length > 0) {
    errors.push(`schema.required is missing property keys: ${missingRequired.join(', ')}`);
  }

  const unknownRequired = required.filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
  if (unknownRequired.length > 0) {
    errors.push(`schema.required has unknown keys: ${unknownRequired.join(', ')}`);
  }

  return errors;
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

async function runCodexSmokeTest() {
  const codexExecutable = process.env.POCHACODING_CODEX_BIN?.trim() || 'codex';
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pochacoding-codex-schema-test-'));
  const outputPath = path.join(tmpDir, 'out.json');
  const prompt = 'Return strict JSON: {"mode":"chat","answer":"ok","proposedEditsJson":null}';

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
      { stdio: ['pipe', 'pipe', 'pipe'], input: prompt, timeoutMs: 90000 },
    );

    let output = '';
    try {
      output = (await fs.readFile(outputPath, 'utf8')).trim();
    } catch {
      output = '';
    }

    if (result.timedOut) {
      throw new Error('codex exec smoke timed out after 90s');
    }

    if (result.code !== 0 || !output) {
      const details = (result.stderr || result.stdout || 'no codex output').slice(-2000);
      throw new Error(`codex exec smoke failed (exit ${result.code}): ${details}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      throw new Error(`codex exec smoke returned invalid JSON: ${String(error)}`);
    }

    if (!parsed || parsed.mode !== 'chat' || typeof parsed.answer !== 'string' || parsed.proposedEditsJson !== null) {
      throw new Error(`codex exec smoke returned unexpected payload: ${output}`);
    }

    process.stdout.write('[codex-schema] live codex smoke passed\n');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
const schemaErrors = validateSchema(schema);
if (schemaErrors.length > 0) {
  process.stderr.write(`[codex-schema] invalid schema: ${schemaErrors.join('; ')}\n`);
  process.exit(1);
}

process.stdout.write('[codex-schema] schema structure passed\n');

if (process.env.CODEX_SMOKE === '1') {
  await runCodexSmokeTest();
}

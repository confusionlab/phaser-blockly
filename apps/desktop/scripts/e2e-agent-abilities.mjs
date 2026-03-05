#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from '@playwright/test';

const ROOT = '/Users/kihaahn/code/0040-pochacoding';
const WEB_PORT = Number(process.env.AI_E2E_WEB_PORT || 5476);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const DESKTOP_MAIN_PATH = path.join(ROOT, 'apps/desktop/out/main/index.js');
const DESKTOP_CWD = path.join(ROOT, 'apps/desktop');
const DESKTOP_USER_DATA_DIR =
  process.env.AI_E2E_USER_DATA_DIR
  || '/Users/kihaahn/Library/Application Support/@pochacoding/desktop';
const RESULTS_PATH = path.join(ROOT, 'docs/ai-agent-ability-e2e-results.json');
const KEEP_OPEN_MS = Number(process.env.AI_E2E_KEEP_OPEN_MS || 0);
let didWriteResults = false;

function isDialogShutdownRace(error) {
  const text = error instanceof Error ? (error.stack || error.message) : String(error);
  return text.includes('Page.handleJavaScriptDialog') && text.includes('No dialog is showing');
}

function installDialogRaceGuard() {
  const bail = (errorLike) => {
    if (didWriteResults && isDialogShutdownRace(errorLike)) {
      process.stderr.write('Ignoring Playwright dialog shutdown race after results were written.\n');
      process.exit(0);
    }
    process.stderr.write(`${errorLike instanceof Error ? (errorLike.stack || errorLike.message) : String(errorLike)}\n`);
    process.exit(1);
  };
  process.on('uncaughtException', bail);
  process.on('unhandledRejection', bail);
}

const groundingCases = [
  { id: 'list_scenes', prompt: 'Chat mode only: list scene names currently in this project.' },
  { id: 'get_scene', prompt: 'Chat mode only: describe the first scene, including how many objects and folders it has.' },
  { id: 'list_scene_folders', prompt: 'Chat mode only: list folder names in the first scene.' },
  { id: 'list_scene_objects', prompt: 'Chat mode only: list object names in the first scene.' },
  { id: 'get_object', prompt: 'Chat mode only: describe the first object in the first scene (position, visibility, costumes count).' },
  { id: 'list_object_costumes', prompt: 'Chat mode only: list costume names of the first object in the first scene.' },
  { id: 'list_components', prompt: 'Chat mode only: list available component types in this project.' },
  { id: 'get_component', prompt: 'Chat mode only: if a component exists, describe the first component; otherwise say none.' },
  { id: 'list_messages', prompt: 'Chat mode only: list broadcast message names currently defined.' },
  { id: 'list_global_variables', prompt: 'Chat mode only: list global variable names currently defined.' },
  { id: 'search_blocks', prompt: 'Chat mode only: based on capabilities, suggest blocks related to movement and collision.' },
  { id: 'get_block_type', prompt: 'Chat mode only: explain the purpose of block type event_game_start if available in capabilities.' },
];

function buildProjectCases(refs) {
  return [
    { id: 'rename_project', prompt: 'Return edit mode with projectOps containing rename_project using name "AI Test Ability Suite".' },
    { id: 'create_scene', prompt: 'Return edit mode with projectOps containing create_scene using name "Ability Scene Alpha".' },
    { id: 'rename_scene', prompt: `Return edit mode with projectOps containing rename_scene using sceneId "${refs.sceneId}" and name "Ability Scene Renamed".` },
    { id: 'reorder_scenes', prompt: `Return edit mode with projectOps containing reorder_scenes where sceneIds includes "${refs.sceneId}".` },
    { id: 'create_object', prompt: `Return edit mode with projectOps containing create_object using sceneId "${refs.sceneId}", name "Ability Object Alpha", x 120, y 180.` },
    { id: 'rename_object', prompt: `Return edit mode with projectOps containing rename_object using sceneId "${refs.sceneId}", objectId "${refs.objectId}", name "Ability Object Renamed".` },
    { id: 'set_object_property', prompt: `Return edit mode with projectOps containing set_object_property using sceneId "${refs.sceneId}", objectId "${refs.objectId}", property "visible", value false.` },
    { id: 'set_object_physics', prompt: `Return edit mode with projectOps containing set_object_physics using sceneId "${refs.sceneId}", objectId "${refs.objectId}", physics.enabled true, physics.bodyType dynamic, physics.gravityY 1.` },
    { id: 'set_object_collider_type', prompt: `Return edit mode with projectOps containing set_object_collider_type using sceneId "${refs.sceneId}", objectId "${refs.objectId}", colliderType "circle".` },
    { id: 'create_folder', prompt: `Return edit mode with projectOps containing create_folder using sceneId "${refs.sceneId}", name "Ability Folder Alpha", parentId null.` },
    { id: 'rename_folder', prompt: `Return edit mode with projectOps containing rename_folder using sceneId "${refs.sceneId}", folderId "${refs.folderId}", name "Ability Folder Renamed".` },
    { id: 'move_object_to_folder', prompt: `Return edit mode with projectOps containing move_object_to_folder using sceneId "${refs.sceneId}", objectId "${refs.objectId}", folderId "${refs.folderId}".` },
    { id: 'add_costume_from_image_url', prompt: `Return edit mode with projectOps containing add_costume_from_image_url using sceneId "${refs.sceneId}", objectId "${refs.objectId}", name "Ability Image Costume", imageUrl "https://picsum.photos/seed/ability/64/64".` },
    { id: 'add_costume_text_circle', prompt: `Return edit mode with projectOps containing add_costume_text_circle using sceneId "${refs.sceneId}", objectId "${refs.objectId}", name "Ability Text Costume", text "GO".` },
    { id: 'rename_costume', prompt: `Return edit mode with projectOps containing rename_costume using sceneId "${refs.sceneId}", objectId "${refs.objectId}", costumeId "${refs.costumeId}", name "Ability Costume Renamed".` },
    { id: 'reorder_costumes', prompt: `Return edit mode with projectOps containing reorder_costumes using sceneId "${refs.sceneId}", objectId "${refs.objectId}", costumeIds ["${refs.altCostumeId}", "${refs.costumeId}"].` },
    { id: 'set_current_costume', prompt: `Return edit mode with projectOps containing set_current_costume using sceneId "${refs.sceneId}", objectId "${refs.objectId}", costumeId "${refs.costumeId}".` },
    { id: 'validate_project', prompt: 'Return edit mode with projectOps containing validate_project.' },
  ];
}

function buildSemanticCases(refs) {
  return [
    { id: 'create_event_flow', prompt: 'Return edit mode with semanticOps containing create_event_flow using event "event_game_start" and one action motion_change_x VALUE 10.' },
    { id: 'append_actions', prompt: `Return edit mode with semanticOps containing append_actions targeting eventBlockId "${refs.eventBlockId}" and append action motion_change_y VALUE -5.` },
    { id: 'replace_action', prompt: `Return edit mode with semanticOps containing replace_action targeting block "${refs.actionBlockId}" with action motion_set_x VALUE 20.` },
    { id: 'set_block_field', prompt: `Return edit mode with semanticOps containing set_block_field targeting block "${refs.keyEventBlockId}" field "KEY" value "SPACE".` },
    { id: 'ensure_variable', prompt: 'Return edit mode with semanticOps containing ensure_variable with scope "global", name "score", variableType "integer", defaultValue 0.' },
    { id: 'ensure_message', prompt: 'Return edit mode with semanticOps containing ensure_message with name "spawn_enemy".' },
    { id: 'retarget_reference', prompt: 'Return edit mode with semanticOps containing retarget_reference with referenceKind "object", from "old_target", to "new_target".' },
    { id: 'delete_subtree', prompt: `Return edit mode with semanticOps containing delete_subtree targeting block "${refs.actionBlockId}".` },
  ];
}

function startWebServer() {
  const child = spawn(
    'pnpm',
    ['--filter', '@pochacoding/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  );

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  return child;
}

async function waitForWebServerReady(proc, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let output = '';

  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('ready in') || output.includes(WEB_URL)) {
        cleanup();
        resolve();
      }
    };
    const onErr = (chunk) => {
      output += chunk.toString();
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Web server exited early with code ${code}\n${output.slice(-2000)}`));
    };
    const timer = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        reject(new Error(`Timed out waiting for web server readiness\n${output.slice(-2000)}`));
      }
    }, 250);

    const cleanup = () => {
      clearInterval(timer);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onErr);
      proc.off('exit', onExit);
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onErr);
    proc.on('exit', onExit);
  });
}

async function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), timeoutMs);
    }),
  ]);
}

async function terminateChildProcess(child, killTimeoutMs = 2000) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    const finish = () => {
      child.removeListener('exit', onExit);
      clearTimeout(timer);
      resolve();
    };
    const onExit = () => finish();
    const timer = setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        // no-op
      }
      finish();
    }, killTimeoutMs);

    child.once('exit', onExit);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
    }
  });
}

function isDevtoolsUrl(url) {
  return typeof url === 'string' && url.startsWith('devtools://');
}

async function getMainAppWindow(electronApp) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  let appWindow = electronApp.windows().find((candidate) => !isDevtoolsUrl(candidate.url()));
  if (!appWindow) {
    appWindow = await electronApp.waitForEvent('window', {
      predicate: (candidate) => !isDevtoolsUrl(candidate.url()),
      timeout: 30_000,
    });
  }
  return appWindow;
}

async function waitForRuntimeUserId(page, timeoutMs = 60_000) {
  const userId = await withTimeout(
    page.evaluate(async ({ timeoutMs: maxWaitMs }) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < maxWaitMs) {
        const uid = window.Clerk?.user?.id;
        if (typeof uid === 'string' && uid.trim()) {
          return uid;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      return null;
    }, { timeoutMs }),
    timeoutMs + 1000,
    'wait_runtime_user_id_timeout',
  );

  if (typeof userId !== 'string' || !userId.trim()) {
    throw new Error('runtime_user_id_missing');
  }
  return userId;
}

async function waitForCodexReady(page, userId, timeoutMs = 60_000) {
  const status = await withTimeout(
    page.evaluate(async ({ userId: uid, timeoutMs: maxWaitMs }) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < maxWaitMs) {
        const provider = window.desktopAssistant?.provider;
        if (!provider) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          continue;
        }

        try {
          let currentStatus = await provider.status(uid);
          if (currentStatus.mode !== 'codex_oauth') {
            currentStatus = await provider.setMode('codex_oauth', uid);
          }
          if (currentStatus.hasCodexToken && currentStatus.codexAvailable) {
            return currentStatus;
          }
        } catch {
          // Provider may still be initializing; retry.
        }

        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      return null;
    }, { userId, timeoutMs }),
    timeoutMs + 1000,
    'wait_codex_ready_timeout',
  );

  if (!status || typeof status !== 'object') {
    throw new Error('codex_status_not_ready');
  }
  return status;
}

async function openAiTestProject(page) {
  const signInHeading = page.getByRole('heading', { name: /sign in to storycode/i });
  if (await signInHeading.isVisible({ timeout: 2000 }).catch(() => false)) {
    throw new Error('Desktop runtime is on sign-in screen. Please sign in once, then rerun.');
  }

  const loadedProjectName = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const store = useProjectStore.getState();
    if (!store.project) {
      store.newProject('AI Test');
    }
    return useProjectStore.getState().project?.name || null;
  });

  if (typeof loadedProjectName !== 'string' || !loadedProjectName.trim()) {
    throw new Error('Failed to bootstrap AI Test project in store.');
  }
}

async function seedAbilityPlayground(page) {
  return page.evaluate(async () => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    const projectStore = useProjectStore.getState();
    if (!projectStore.project) {
      throw new Error('No project loaded.');
    }

    let project = projectStore.project;
    if (project.scenes.length === 0) {
      projectStore.addScene('Ability Seed Scene');
      project = useProjectStore.getState().project;
    }

    const scene = project.scenes[0];
    if (scene.objects.length === 0) {
      projectStore.addObject(scene.id, 'Ability Seed Object');
      project = useProjectStore.getState().project;
    }

    let nextScene = useProjectStore.getState().project.scenes.find((entry) => entry.id === scene.id);
    let nextObject = nextScene?.objects[0];
    if (!nextScene || !nextObject) {
      throw new Error('Failed to resolve seeded scene/object.');
    }

    if ((nextScene.objectFolders || []).length === 0) {
      const seededFolder = {
        id: crypto.randomUUID(),
        name: 'Ability Seed Folder',
        parentId: null,
        order: 0,
      };
      projectStore.updateScene(nextScene.id, {
        objectFolders: [...(nextScene.objectFolders || []), seededFolder],
      });
      nextScene = useProjectStore.getState().project.scenes.find((entry) => entry.id === nextScene.id) || nextScene;
    }

    if ((nextObject.costumes || []).length < 2) {
      const baseCostume = nextObject.costumes[0];
      if (baseCostume) {
        const clone = {
          ...baseCostume,
          id: crypto.randomUUID(),
          name: `${baseCostume.name || 'costume'}-seed-copy`,
        };
        projectStore.updateObject(nextScene.id, nextObject.id, {
          costumes: [...(nextObject.costumes || []), clone],
        });
      }
      nextScene = useProjectStore.getState().project.scenes.find((entry) => entry.id === nextScene.id) || nextScene;
      nextObject = nextScene.objects.find((entry) => entry.id === nextObject.id) || nextObject;
    }

    const seedXml = `<xml xmlns="https://developers.google.com/blockly/xml"><block type="event_game_start" id="ability_event_seed" x="20" y="20"><statement name="DO"><block type="motion_change_x" id="ability_action_seed"><value name="VALUE"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block></statement></block><block type="event_key_pressed" id="ability_key_event_seed" x="260" y="20"><field name="KEY">SPACE</field><statement name="DO"><block type="motion_change_y" id="ability_key_action_seed"><value name="VALUE"><shadow type="math_number"><field name="NUM">5</field></shadow></value></block></statement></block></xml>`;
    projectStore.updateObject(nextScene.id, nextObject.id, { blocklyXml: seedXml });

    useEditorStore.getState().selectScene(nextScene.id);
    useEditorStore.getState().selectObject(nextObject.id);

    const hydratedProject = useProjectStore.getState().project;
    const hydratedScene = hydratedProject.scenes.find((entry) => entry.id === nextScene.id) || nextScene;
    const hydratedObject = hydratedScene.objects.find((entry) => entry.id === nextObject.id) || nextObject;
    const firstFolder = (hydratedScene.objectFolders || [])[0] || null;
    const firstCostume = (hydratedObject.costumes || [])[0] || null;
    const secondCostume = (hydratedObject.costumes || [])[1] || firstCostume;

    if (!firstFolder || !firstCostume || !secondCostume) {
      throw new Error('Failed to seed folder/costume references.');
    }

    return {
      sceneId: hydratedScene.id,
      objectId: hydratedObject.id,
      folderId: firstFolder.id,
      costumeId: firstCostume.id,
      altCostumeId: secondCostume.id,
      eventBlockId: 'ability_event_seed',
      keyEventBlockId: 'ability_key_event_seed',
      actionBlockId: 'ability_action_seed',
    };
  });
}

async function runAssistantCase(page, testCase, runtimeUserId) {
  return page.evaluate(async ({ prompt, expectedOp, category, userId }) => {
    const [
      { useProjectStore },
      { useEditorStore },
      { getLlmExposedBlocklyCapabilities },
      { buildProgramContext, readProgramSummary },
      { buildAssistantProjectSnapshot },
      { validateSemanticOpsPayload },
    ] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
      import('/src/lib/llm/capabilities.ts'),
      import('/src/lib/llm/context.ts'),
      import('/src/lib/llm/projectSnapshot.ts'),
      import('/src/lib/llm/semanticOps.ts'),
    ]);

    if (typeof userId !== 'string' || !userId.trim()) {
      return { ok: false, reason: 'missing_user_id' };
    }
    if (!window.desktopAssistant) {
      return { ok: false, reason: 'missing_desktop_assistant' };
    }

    let project = useProjectStore.getState().project;
    if (!project) {
      return { ok: false, reason: 'missing_project' };
    }

    const fallbackScene = project.scenes[0] || null;
    const fallbackObject = fallbackScene?.objects[0] || null;
    if (!fallbackScene || !fallbackObject) {
      return { ok: false, reason: 'missing_scene_or_object' };
    }

    useEditorStore.getState().selectScene(fallbackScene.id);
    useEditorStore.getState().selectObject(fallbackObject.id);

    project = useProjectStore.getState().project;
    const scene = project?.scenes[0] || fallbackScene;
    const object = scene?.objects[0] || fallbackObject;

    const scope = {
      scope: 'object',
      sceneId: scene.id,
      objectId: object.id,
      componentId: object.componentId ?? undefined,
    };
    const capabilities = getLlmExposedBlocklyCapabilities();
    const context = buildProgramContext(project, scope);
    const programRead = readProgramSummary(context);
    const projectSnapshot = buildAssistantProjectSnapshot(project);

    const turn = await Promise.race([
      window.desktopAssistant.provider.assistantTurn(
        {
          userIntent: prompt,
          chatHistory: [],
          capabilities,
          context,
          programRead,
          projectSnapshot,
          threadContext: {
            threadId: `ability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            scopeKey: `object:${scene.id}:${object.id}`,
          },
        },
        userId,
      ),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('assistant_turn_timeout')), 120_000);
      }),
    ]);

    const output = {
      ok: true,
      mode: turn.mode,
      provider: turn.provider,
      model: turn.model,
      errorCode: typeof turn.errorCode === 'string' ? turn.errorCode : '',
      answer: turn.mode === 'chat' ? (turn.answer || '') : '',
      semanticOps: [],
      projectOps: [],
      parseErrors: [],
      debugTrace: turn.debugTrace ?? null,
    };

    if (turn.mode === 'edit') {
      const parsed = validateSemanticOpsPayload(turn.proposedEdits);
      if (!parsed.ok) {
        output.parseErrors = parsed.errors;
      } else {
        output.semanticOps = parsed.value.semanticOps.map((op) => op.op);
        output.projectOps = parsed.value.projectOps.map((op) => op.op);
      }
    }

    const opList = category === 'project' ? output.projectOps : output.semanticOps;
    const validationErrors = Array.isArray(output.debugTrace?.validationErrors)
      ? output.debugTrace.validationErrors.filter((value) => typeof value === 'string')
      : [];
    const fallbackReasonCode =
      output.debugTrace && typeof output.debugTrace === 'object' && typeof output.debugTrace.fallbackReasonCode === 'string'
        ? output.debugTrace.fallbackReasonCode
        : '';
    const transportFailed =
      output.errorCode === 'assistant_transport_error'
      || fallbackReasonCode === 'assistant_transport_error'
      || validationErrors.some((value) => value.startsWith('transport:'));
    const hasExpectedOp = category === 'grounding'
      ? turn.mode === 'chat' && !transportFailed
      : !transportFailed && opList.includes(expectedOp);

    return {
      ...output,
      hasExpectedOp,
      expectedOp,
      category,
    };
  }, {
    prompt: testCase.prompt,
    expectedOp: testCase.id,
    category: testCase.category,
    userId: runtimeUserId,
  });
}

async function main() {
  installDialogRaceGuard();
  const webServer = startWebServer();
  let electronApp = null;

  try {
    process.stdout.write('phase:web_server_wait\n');
    await waitForWebServerReady(webServer);
    process.stdout.write('phase:web_server_ready\n');

    process.stdout.write('phase:electron_launch\n');
    electronApp = await electron.launch({
      args: [DESKTOP_MAIN_PATH, `--user-data-dir=${DESKTOP_USER_DATA_DIR}`],
      cwd: DESKTOP_CWD,
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: WEB_URL,
        DESKTOP_APP_BRANCH: 'main',
      },
      timeout: 60_000,
    });
    process.stdout.write('phase:electron_launched\n');

    process.stdout.write('phase:get_window\n');
    const page = await getMainAppWindow(electronApp);
    await page.waitForLoadState('domcontentloaded');
    process.stdout.write('phase:open_project\n');
    await withTimeout(openAiTestProject(page), 60_000, 'open_project_timeout');
    process.stdout.write('phase:project_opened\n');

    process.stdout.write('phase:seed_playground\n');
    const refs = await withTimeout(seedAbilityPlayground(page), 30_000, 'seed_playground_timeout');
    process.stdout.write('phase:playground_seeded\n');
    process.stdout.write('phase:wait_runtime_user\n');
    const runtimeUserId = await waitForRuntimeUserId(page);
    process.stdout.write('phase:wait_codex_ready\n');
    const codexStatus = await waitForCodexReady(page, runtimeUserId);
    process.stdout.write(
      `phase:codex_ready mode=${codexStatus.mode} hasToken=${String(codexStatus.hasCodexToken)} available=${String(codexStatus.codexAvailable)}\n`,
    );
    const allCases = [
      ...buildProjectCases(refs).map((item) => ({ ...item, category: 'project' })),
      ...buildSemanticCases(refs).map((item) => ({ ...item, category: 'semantic' })),
      ...groundingCases.map((item) => ({ ...item, category: 'grounding' })),
    ];

    const results = [];
    for (const testCase of allCases) {
      const startedAt = new Date().toISOString();
      let outcome;
      process.stdout.write(`running ${testCase.category}:${testCase.id}...\n`);
      try {
        outcome = await runAssistantCase(page, testCase, runtimeUserId);
      } catch (error) {
        outcome = {
          ok: false,
          hasExpectedOp: false,
          mode: null,
          provider: null,
          model: null,
          answer: '',
          semanticOps: [],
          projectOps: [],
          parseErrors: [],
          debugTrace: null,
          fatalError: error instanceof Error ? error.message : String(error),
        };
      }

      results.push({
        id: testCase.id,
        category: testCase.category,
        prompt: testCase.prompt,
        startedAt,
        completedAt: new Date().toISOString(),
        ...outcome,
      });

      process.stdout.write(
        `${testCase.category}:${testCase.id} -> ${outcome.hasExpectedOp ? 'PASS' : 'FAIL'} (mode=${outcome.mode || 'n/a'})\n`,
      );
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      webUrl: WEB_URL,
      desktopMainPath: DESKTOP_MAIN_PATH,
      userDataDir: DESKTOP_USER_DATA_DIR,
      totals: {
        all: results.length,
        passed: results.filter((item) => item.hasExpectedOp).length,
        failed: results.filter((item) => !item.hasExpectedOp).length,
      },
      results,
    };

    await fs.writeFile(RESULTS_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    didWriteResults = true;
    process.stdout.write(`\nResults written to ${RESULTS_PATH}\n`);

    if (KEEP_OPEN_MS > 0) {
      process.stdout.write(`Keeping Electron open for ${KEEP_OPEN_MS}ms...\n`);
      await page.waitForTimeout(KEEP_OPEN_MS);
    }
  } finally {
    if (electronApp) {
      // Force-kill to avoid Playwright dialog close races on app shutdown.
      try {
        const proc = electronApp.process();
        await terminateChildProcess(proc);
      } catch {
        // no-op
      }
    }
    await terminateChildProcess(webServer);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});

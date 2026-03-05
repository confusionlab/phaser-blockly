#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const DEFAULT_CONFIG_PATH = 'platform/unified.config.json';
const SUPPORTED_SERVICES = ['local', 'convex', 'vercel', 'clerk'];

function parseArgs(argv) {
  const options = {
    mode: 'plan',
    configPath: DEFAULT_CONFIG_PATH,
    target: 'all',
    services: null,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      options.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--target') {
      options.target = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--services') {
      options.services = argv[i + 1]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    positional.push(arg);
  }

  if (positional[0]) {
    options.mode = positional[0];
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/platform-sync.mjs [plan|apply] [options]

Options:
  --config <path>     Path to unified config JSON file (default: ${DEFAULT_CONFIG_PATH})
  --target <env>      Target environment: dev | prod | all (default: all)
  --services <list>   Comma-separated subset: local,convex,vercel,clerk
  -h, --help          Show help
`);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function resolveTemplate(value, vars, contextPath = 'config') {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, key) => {
      if (!(key in vars)) {
        throw new Error(`Missing variable "${key}" while resolving ${contextPath}`);
      }
      const resolved = vars[key];
      if (typeof resolved !== 'string') {
        throw new Error(`Variable "${key}" must resolve to a string`);
      }
      return resolved;
    });
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveTemplate(entry, vars, `${contextPath}[${index}]`));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = resolveTemplate(entry, vars, `${contextPath}.${key}`);
    }
    return result;
  }

  return value;
}

function normalizeEnvEntry(entry, keyPath) {
  if (typeof entry === 'string') {
    return { value: entry, sensitive: false };
  }
  if (entry && typeof entry === 'object' && typeof entry.value === 'string') {
    return { value: entry.value, sensitive: Boolean(entry.sensitive) };
  }
  throw new Error(`Invalid env entry at ${keyPath}; expected string or { value, sensitive }`);
}

function encodeEnvValue(value) {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function commandToString(command, args) {
  return [command, ...args].join(' ');
}

function runCommand(command, args, options = {}) {
  const { cwd = process.cwd(), env = {}, input } = options;
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const rendered = commandToString(command, args);
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    throw new Error(
      [
        `Command failed (${result.status}): ${rendered}`,
        stdout ? `stdout:\n${stdout}` : null,
        stderr ? `stderr:\n${stderr}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
}

function shouldRunTarget(name, target) {
  if (target === 'all') return true;
  if (target === 'dev') return name === 'dev';
  if (target === 'prod') return name === 'prod';
  return true;
}

function shouldRunVercelEnvironment(name, target) {
  if (target === 'all') return true;
  if (target === 'dev') return name === 'development';
  if (target === 'prod') return name === 'production' || name === 'preview';
  return true;
}

function appliesToTarget(manualItem, target) {
  const appliesTo = manualItem.appliesTo;
  if (!Array.isArray(appliesTo) || appliesTo.length === 0) {
    return true;
  }
  if (target === 'all') {
    return true;
  }
  return appliesTo.includes(target);
}

function printManualChecklist(config, target) {
  const manualItems = Array.isArray(config.manualRequired) ? config.manualRequired : [];
  const pending = manualItems.filter((item) => !item.done && appliesToTarget(item, target));
  const blocking = pending.filter((item) => item.blocking);

  if (pending.length === 0) {
    console.log('[manual] No pending manual tasks.');
    return { pendingCount: 0, blockingCount: 0 };
  }

  console.log(`[manual] Pending manual tasks: ${pending.length}`);
  for (const item of pending) {
    const service = item.service ?? 'unknown';
    const title = item.title ?? item.id ?? 'manual-step';
    const why = item.why ?? 'No rationale provided.';
    const instructions = item.instructions ?? 'No instructions provided.';
    const severity = item.blocking ? 'BLOCKING' : 'NON-BLOCKING';
    console.log(`- [${severity}] (${service}) ${title}`);
    console.log(`  Why: ${why}`);
    console.log(`  Do: ${instructions}`);
  }

  return { pendingCount: pending.length, blockingCount: blocking.length };
}

function syncLocalEnvFiles(config, mode, summary) {
  const localEnvFiles = Array.isArray(config.localEnvFiles) ? config.localEnvFiles : [];
  for (const localFile of localEnvFiles) {
    const targetPath = path.resolve(process.cwd(), localFile.path);
    const values = localFile.values ?? {};

    const normalized = Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => [name, normalizeEnvEntry(entry, `localEnvFiles.${localFile.path}.${name}`)]);

    const lines = [
      '# Generated by scripts/platform-sync.mjs',
      '# Source of truth: platform/unified.config.json',
      '',
      ...normalized.map(([name, entry]) => `${name}=${encodeEnvValue(entry.value)}`),
      '',
    ];

    console.log(`[local] ${mode === 'apply' ? 'Writing' : 'Would write'} ${targetPath} (${normalized.length} vars)`);
    if (mode === 'apply') {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, `${lines.join('\n')}`, 'utf8');
    }

    summary.localFiles += 1;
    summary.localVars += normalized.length;
  }
}

function convexFlagsFromSelector(selector) {
  if (!selector || selector.kind === 'default') {
    return [];
  }

  if (selector.kind === 'prod') {
    return ['--prod'];
  }

  if (selector.kind === 'preview-name') {
    if (!selector.value) {
      throw new Error('Convex selector.kind "preview-name" requires selector.value');
    }
    return ['--preview-name', selector.value];
  }

  if (selector.kind === 'deployment-name') {
    if (!selector.value) {
      throw new Error('Convex selector.kind "deployment-name" requires selector.value');
    }
    return ['--deployment-name', selector.value];
  }

  throw new Error(`Unsupported Convex selector.kind: ${selector.kind}`);
}

function syncConvex(config, mode, target, summary) {
  const convex = config.providers?.convex;
  if (!convex) {
    return;
  }

  const environments = convex.environments ?? {};
  for (const [envName, envConfig] of Object.entries(environments)) {
    if (!shouldRunTarget(envName, target)) {
      continue;
    }

    const flags = convexFlagsFromSelector(envConfig.selector);
    const envVars = envConfig.env ?? {};

    for (const [key, rawEntry] of Object.entries(envVars)) {
      const entry = normalizeEnvEntry(rawEntry, `providers.convex.environments.${envName}.env.${key}`);
      const args = ['exec', 'convex', 'env', 'set', key, entry.value, ...flags];
      console.log(`[convex:${envName}] ${mode === 'apply' ? 'Setting' : 'Would set'} ${key}`);
      if (mode === 'apply') {
        runCommand('pnpm', args);
      }
      summary.convexVars += 1;
    }
  }
}

function syncVercel(config, mode, target, summary) {
  const vercel = config.providers?.vercel;
  if (!vercel) {
    return;
  }

  const cwd = path.resolve(process.cwd(), vercel.cwd ?? '.');
  const environments = vercel.environments ?? {};
  const token = typeof vercel.token === 'string' && vercel.token.trim().length > 0 ? vercel.token.trim() : null;

  for (const [environment, envMap] of Object.entries(environments)) {
    if (!shouldRunVercelEnvironment(environment, target)) {
      continue;
    }

    for (const [key, rawEntry] of Object.entries(envMap ?? {})) {
      const entry = normalizeEnvEntry(rawEntry, `providers.vercel.environments.${environment}.${key}`);
      const args = ['--yes', 'vercel', 'env', 'add', key, environment, '--force'];
      if (entry.sensitive) {
        args.push('--sensitive');
      }
      if (vercel.scope) {
        args.push('--scope', vercel.scope);
      }
      if (token) {
        args.push('--token', token);
      }

      console.log(`[vercel:${environment}] ${mode === 'apply' ? 'Setting' : 'Would set'} ${key}`);
      if (mode === 'apply') {
        runCommand('npx', args, { cwd, input: `${entry.value}\n` });
      }
      summary.vercelVars += 1;
    }
  }
}

async function syncClerk(config, mode, summary) {
  const clerk = config.providers?.clerk;
  if (!clerk) {
    return;
  }

  const secretKey =
    (typeof clerk.secretKey === 'string' && clerk.secretKey.trim())
    || (clerk.secretKeyEnvVar && process.env[clerk.secretKeyEnvVar]);

  if (!secretKey) {
    throw new Error('Clerk sync requires providers.clerk.secretKey or providers.clerk.secretKeyEnvVar');
  }

  const { createClerkClient } = await import('@clerk/backend');
  const clerkClient = createClerkClient({ secretKey });

  if (clerk.instance && Object.keys(clerk.instance).length > 0) {
    console.log(`[clerk] ${mode === 'apply' ? 'Updating' : 'Would update'} instance settings`);
    if (mode === 'apply') {
      await clerkClient.instance.update(clerk.instance);
    }
    summary.clerkInstanceUpdates += 1;
  }

  if (Array.isArray(clerk.redirectUrls)) {
    console.log(`[clerk] ${mode === 'apply' ? 'Reconciling' : 'Would reconcile'} redirect URLs (${clerk.redirectUrls.length} desired)`);
    if (mode === 'apply') {
      const existingResponse = await clerkClient.redirectUrls.getRedirectUrlList();
      const existing = existingResponse?.data ?? [];
      const existingByUrl = new Map(existing.map((redirectUrl) => [redirectUrl.url, redirectUrl]));
      const desiredSet = new Set(clerk.redirectUrls);

      for (const url of clerk.redirectUrls) {
        if (!existingByUrl.has(url)) {
          await clerkClient.redirectUrls.createRedirectUrl({ url });
          summary.clerkRedirectUrlsCreated += 1;
        }
      }

      if (clerk.redirectUrlsPrune) {
        for (const redirectUrl of existing) {
          if (!desiredSet.has(redirectUrl.url)) {
            await clerkClient.redirectUrls.deleteRedirectUrl(redirectUrl.id);
            summary.clerkRedirectUrlsDeleted += 1;
          }
        }
      }
    }
  }

  if (Array.isArray(clerk.domains)) {
    console.log(`[clerk] ${mode === 'apply' ? 'Reconciling' : 'Would reconcile'} domains (${clerk.domains.length} desired)`);
    if (mode === 'apply') {
      const existingResponse = await clerkClient.domains.list();
      const existing = existingResponse?.data ?? [];
      const existingByName = new Map(existing.map((domain) => [domain.name, domain]));
      const desiredNames = new Set(clerk.domains.map((domain) => domain.name));

      for (const desired of clerk.domains) {
        const existingDomain = existingByName.get(desired.name);
        if (!existingDomain) {
          await clerkClient.domains.add({
            name: desired.name,
            is_satellite: desired.isSatellite ?? true,
            proxy_url: desired.proxyUrl ?? null,
          });
          summary.clerkDomainsCreated += 1;
          continue;
        }

        const proxyChanged = (desired.proxyUrl ?? null) !== (existingDomain.proxyUrl ?? null);
        if (proxyChanged) {
          await clerkClient.domains.update({
            domainId: existingDomain.id,
            proxy_url: desired.proxyUrl ?? null,
            is_secondary: desired.isSecondary ?? null,
          });
          summary.clerkDomainsUpdated += 1;
        }
      }

      if (clerk.domainsPruneMissingSatellites) {
        for (const domain of existing) {
          if (domain.isSatellite && !desiredNames.has(domain.name)) {
            await clerkClient.domains.delete(domain.id);
            summary.clerkDomainsDeleted += 1;
          }
        }
      }
    }
  }

  if (Array.isArray(clerk.jwtTemplates)) {
    console.log(`[clerk] ${mode === 'apply' ? 'Reconciling' : 'Would reconcile'} JWT templates (${clerk.jwtTemplates.length} desired)`);
    if (mode === 'apply') {
      const existingResponse = await clerkClient.jwtTemplates.list({ limit: 500 });
      const existing = existingResponse?.data ?? [];
      const existingByName = new Map(existing.map((template) => [template.name, template]));
      const desiredNames = new Set(clerk.jwtTemplates.map((template) => template.name));

      for (const desired of clerk.jwtTemplates) {
        const payload = {
          name: desired.name,
          claims: desired.claims,
          lifetime: desired.lifetime,
          allowedClockSkew: desired.allowedClockSkew,
          customSigningKey: desired.customSigningKey,
          signingAlgorithm: desired.signingAlgorithm,
          signingKey: desired.signingKey,
        };

        const existingTemplate = existingByName.get(desired.name);
        if (!existingTemplate) {
          await clerkClient.jwtTemplates.create(payload);
          summary.clerkJwtTemplatesCreated += 1;
          continue;
        }

        await clerkClient.jwtTemplates.update({
          templateId: existingTemplate.id,
          ...payload,
        });
        summary.clerkJwtTemplatesUpdated += 1;
      }

      if (clerk.jwtTemplatesPrune) {
        for (const template of existing) {
          if (!desiredNames.has(template.name)) {
            await clerkClient.jwtTemplates.delete(template.id);
            summary.clerkJwtTemplatesDeleted += 1;
          }
        }
      }
    }
  }
}

function validateTarget(target) {
  if (!['dev', 'prod', 'all'].includes(target)) {
    throw new Error(`Invalid --target value: ${target}. Expected dev | prod | all`);
  }
}

function resolveServices(servicesOption) {
  if (!servicesOption || servicesOption.length === 0) {
    return new Set(SUPPORTED_SERVICES);
  }

  const resolved = new Set();
  for (const service of servicesOption) {
    if (!SUPPORTED_SERVICES.includes(service)) {
      throw new Error(`Unsupported service in --services: ${service}`);
    }
    resolved.add(service);
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!['plan', 'apply'].includes(args.mode)) {
    printUsage();
    throw new Error(`Unsupported mode: ${args.mode}`);
  }

  validateTarget(args.target);
  const selectedServices = resolveServices(args.services);

  const configPath = path.resolve(process.cwd(), args.configPath);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const rawConfig = readJson(configPath);
  const vars = rawConfig.values ?? {};
  if (rawConfig.version !== 1) {
    throw new Error(`Unsupported config version: ${rawConfig.version}. Expected 1.`);
  }

  const config = resolveTemplate(rawConfig, vars);

  console.log(`[platform-sync] Mode: ${args.mode}`);
  console.log(`[platform-sync] Config: ${configPath}`);
  console.log(`[platform-sync] Target: ${args.target}`);
  console.log(`[platform-sync] Services: ${Array.from(selectedServices).join(', ')}`);

  const manualSummary = printManualChecklist(config, args.target);
  if (args.mode === 'apply' && manualSummary.blockingCount > 0) {
    throw new Error('Blocking manual tasks are still pending. Mark them done in unified config before apply.');
  }

  const summary = {
    localFiles: 0,
    localVars: 0,
    convexVars: 0,
    vercelVars: 0,
    clerkInstanceUpdates: 0,
    clerkRedirectUrlsCreated: 0,
    clerkRedirectUrlsDeleted: 0,
    clerkDomainsCreated: 0,
    clerkDomainsUpdated: 0,
    clerkDomainsDeleted: 0,
    clerkJwtTemplatesCreated: 0,
    clerkJwtTemplatesUpdated: 0,
    clerkJwtTemplatesDeleted: 0,
  };

  if (selectedServices.has('local')) {
    syncLocalEnvFiles(config, args.mode, summary);
  }

  if (selectedServices.has('convex')) {
    syncConvex(config, args.mode, args.target, summary);
  }

  if (selectedServices.has('vercel')) {
    syncVercel(config, args.mode, args.target, summary);
  }

  if (selectedServices.has('clerk')) {
    await syncClerk(config, args.mode, summary);
  }

  console.log('[platform-sync] Summary');
  console.log(`- local env files: ${summary.localFiles} (${summary.localVars} vars)`);
  console.log(`- convex vars: ${summary.convexVars}`);
  console.log(`- vercel vars: ${summary.vercelVars}`);
  console.log(`- clerk instance updates: ${summary.clerkInstanceUpdates}`);
  console.log(`- clerk redirect URLs: +${summary.clerkRedirectUrlsCreated} / -${summary.clerkRedirectUrlsDeleted}`);
  console.log(`- clerk domains: +${summary.clerkDomainsCreated} / ~${summary.clerkDomainsUpdated} / -${summary.clerkDomainsDeleted}`);
  console.log(`- clerk JWT templates: +${summary.clerkJwtTemplatesCreated} / ~${summary.clerkJwtTemplatesUpdated} / -${summary.clerkJwtTemplatesDeleted}`);
}

main().catch((error) => {
  console.error(`[platform-sync] ${error.message}`);
  process.exit(1);
});

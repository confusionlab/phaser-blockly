import { buildProgramContext, getScopeLabel, readProgramSummary } from '@/lib/llm/context';
import { getLlmExposedBlocklyCapabilities } from '@/lib/llm/capabilities';
import { buildCandidateFromSemanticOps } from '@/lib/llm/compiler';
import { validateCandidate } from '@/lib/llm/validation';
import type { OrchestratedCandidate, OrchestratorArgs } from '@/lib/llm/types';

export async function runLlmBlocklyOrchestration(args: OrchestratorArgs): Promise<OrchestratedCandidate> {
  const requestStartedAt = new Date().toISOString();
  const capabilities = getLlmExposedBlocklyCapabilities();
  const context = buildProgramContext(args.project, args.scope);
  const programRead = readProgramSummary(context);

  const proposedEdits = await args.provider.proposeEdits({
    userIntent: args.userIntent,
    capabilities,
    context,
    programRead,
  });

  const build = buildCandidateFromSemanticOps({
    capabilities,
    context,
    semanticOps: proposedEdits.semanticOps,
  });

  const validation = validateCandidate({
    project: args.project,
    scope: args.scope,
    context,
    capabilities,
    candidateXml: build.candidateXml,
    pendingMessages: build.pendingEnsures.messages,
    pendingVariables: build.pendingEnsures.variables,
  });

  const requestCompletedAt = new Date().toISOString();
  console.info('[LLM][orchestrator]', {
    provider: args.provider.name,
    model: args.provider.model,
    scope: getScopeLabel(args.project, args.scope),
    blockCount: context.blockCount,
    semanticOpCount: proposedEdits.semanticOps.length,
    validationPass: validation.pass,
    durationMs: new Date(requestCompletedAt).getTime() - new Date(requestStartedAt).getTime(),
  });

  return {
    providerName: args.provider.name,
    model: args.provider.model,
    requestStartedAt,
    requestCompletedAt,
    scope: args.scope,
    context,
    capabilities,
    programRead,
    proposedEdits,
    build,
    validation,
  };
}

export { getBlocklyCapabilities, getLlmExposedBlocklyCapabilities } from '@/lib/llm/capabilities';
export { buildProgramContext, readProgramSummary } from '@/lib/llm/context';
export { runLlmBlocklyOrchestration } from '@/lib/llm/orchestrator';
export { applyOrchestratedCandidate } from '@/lib/llm/apply';
export { validateSemanticOpsPayload } from '@/lib/llm/semanticOps';
export type {
  BlocklyCapabilities,
  BlocklyEditScope,
  BuildCandidateResult,
  CandidateDiff,
  CandidateValidationResult,
  LLMProvider,
  OrchestratedCandidate,
  ProgramContext,
  ProgramReadSummary,
  ProposedEdits,
  SemanticOp,
} from '@/lib/llm/types';

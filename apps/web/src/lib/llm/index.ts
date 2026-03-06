export { getBlocklyCapabilities, getLlmExposedBlocklyCapabilities } from '@/lib/llm/capabilities';
export { buildProgramContext, readProgramSummary } from '@/lib/llm/context';
export { buildAssistantProjectSnapshot } from '@/lib/llm/projectSnapshot';
export { runLlmBlocklyOrchestration } from '@/lib/llm/orchestrator';
export { applyOrchestratedCandidate } from '@/lib/llm/apply';
export { validateSemanticOpsPayload } from '@/lib/llm/semanticOps';
export { applyProjectOps, previewProjectOps, summarizeProjectOps } from '@/lib/llm/projectOps';
export type {
  BlocklyCapabilities,
  BlocklyEditScope,
  BuildCandidateResult,
  CandidateDiff,
  CandidateValidationResult,
  LLMProvider,
  OrchestratedCandidate,
  ProjectOp,
  ProgramContext,
  ProgramReadSummary,
  ProposedEdits,
  SemanticOp,
} from '@/lib/llm/types';

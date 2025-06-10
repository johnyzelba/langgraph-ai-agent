import { z } from 'zod';
import { BaseMessage } from '@langchain/core/messages';
import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';

// From orchestrator.ts
// -----------------------------------------------------------------------------
export const AgentRequestSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  message: z.string().min(1).max(10000),
  context: z.object({
    role: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).optional(),
  stream: z.boolean().default(false),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export interface AgentResponse {
  message: string;
  toolsUsed?: string[];
  memoryContext?: {
    shortTerm: number;
    longTerm: number;
  };
  metadata?: Record<string, unknown>;
  chartData?: any; 
  clarificationNeeded?: ClarificationRequest;
}

export interface OrchestratorConfig {
  systemPrompt?: string;
  maxToolCalls?: number;
  enableMemory?: boolean;
  enableRAG?: boolean;
  minConfidenceThreshold?: number;
  enableChartGeneration?: boolean;
}


// From chart-state-machine.ts
// -----------------------------------------------------------------------------
export type ChartType = 
  | 'line' | 'bar' | 'pie' | 'scatter' | 'heatmap' 
  | 'radar' | 'sankey' | 'treemap' | 'funnel' 
  | 'calendar' | 'choropleth' | 'network';

export interface DataRequirement {
  name: string;
  description: string;
  sqlHint?: string;
  required: boolean;
  dataType: 'numeric' | 'categorical' | 'datetime' | 'text';
}

export interface QueryInstruction {
  step: number;
  description: string;
  tables?: string[];
  expectedOutput: string;
  dependsOn?: number[];
}

export interface SQLQuery {
  query: string;
  explanation?: string;
  optimizationHints?: string[];
  estimatedRows?: number;
  schemaValidationIssues?: string[];
}

export interface QueryResult {
  data: any[];
  rowCount: number;
  executionTime: number;
  error?: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues?: string[];
  suggestions?: string[];
}

export interface SchemaValidationResult {
  isValid: boolean;
  issues: string[];
  tablesFound: string[];
  columnsChecked: number;
}

export interface ClarificationRequest {
  question: string;
  options?: string[];
  context?: string;
}

export interface ChartData {
  type: ChartType;
  data: any;
  config?: any;
  title?: string;
  description?: string;
}

export interface AgentState {
  userRequest: string;
  userId: string;
  sessionId: string;
  intent?: 'chart' | 'chat' | 'clarify';
  chartType?: ChartType;
  dataRequirements?: DataRequirement[];
  queryPlan?: QueryInstruction[];
  currentStep: number;
  maxRetries: number;
  retryCount: number;
  sqlQueries: SQLQuery[];
  queryResults: QueryResult[];
  validationResults: ValidationResult[];
  finalChartData?: ChartData;
  chatResponse?: string;
  errors: string[];
  clarificationNeeded?: ClarificationRequest;
  progress: {
    currentState: AgentStateName;
    percentage: number;
    message: string;
  };
  messages: BaseMessage[];
  schemaContext?: string;
  currentResults?: unknown[];
  friendlyErrorMessage?: string;
}

export type AgentStateName = 
  | 'routing'
  | 'planning'
  | 'understanding_schema'
  | 'generating_query'
  | 'executing_query'
  | 'validating_results'
  | 'clarifying'
  | 'chatting'
  | 'transforming_data'
  | 'completed'
  | 'failed'
  | 'retrying';

export type ProgressCallback = (progress: AgentState['progress']) => void;


// From dependent files (graph, streaming)
// -----------------------------------------------------------------------------
export interface OperationDependencies {
  llmGateway: LLMGateway;
  toolManager: ToolManager;
  memoryManager: MemoryManager;
}

export interface GraphDependencies extends OperationDependencies {
  progressCallback?: ProgressCallback;
}

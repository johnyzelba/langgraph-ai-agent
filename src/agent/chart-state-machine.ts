import { BaseMessage } from '@langchain/core/messages';
import { StateGraphArgs } from '@langchain/langgraph';
import { 
  AgentState,
  AgentStateName,
  ChartType,
  DataRequirement,
  QueryInstruction,
  SQLQuery,
  QueryResult,
  ValidationResult,
  ClarificationRequest,
  ChartData,
  ProgressCallback,
} from './types';

// State graph configuration
export const agentGraphConfig: StateGraphArgs<AgentState>['channels'] = {
  userRequest: {
    value: (x: string, y?: string) => y !== undefined ? y : x,
    default: () => '',
  },
  userId: {
    value: (x: string) => x,
    default: () => '',
  },
  sessionId: {
    value: (x: string) => x,
    default: () => '',
  },
  intent: {
    value: (x?: 'chart' | 'chat' | 'clarify') => x,
    default: () => undefined,
  },
  chartType: {
    value: (x?: ChartType) => x,
    default: () => undefined,
  },
  dataRequirements: {
    value: (x?: DataRequirement[]) => x,
    default: () => undefined,
  },
  queryPlan: {
    value: (x?: QueryInstruction[]) => x,
    default: () => undefined,
  },
  currentStep: {
    value: (x: number, y?: number) => y !== undefined ? y : x,
    default: () => 0,
  },
  maxRetries: {
    value: (x: number, y?: number) => y !== undefined ? y : x,
    default: () => 3,
  },
  retryCount: {
    value: (x: number, y?: number) => y !== undefined ? y : x,
    default: () => 0,
  },
  sqlQueries: {
    value: (x: SQLQuery[], y?: SQLQuery[]) => y !== undefined ? y : x,
    default: () => [],
  },
  queryResults: {
    value: (x: QueryResult[], y?: QueryResult[]) => y !== undefined ? y : x,
    default: () => [],
  },
  validationResults: {
    value: (x: ValidationResult[], y?: ValidationResult[]) => y !== undefined ? y : x,
    default: () => [],
  },
  finalChartData: {
    value: (x?: ChartData) => x,
    default: () => undefined,
  },
  chatResponse: {
    value: (x?: string) => x,
    default: () => undefined,
  },
  errors: {
    value: (x: string[], y?: string[]) => y !== undefined ? y : x,
    default: () => [],
  },
  clarificationNeeded: {
    value: (x?: ClarificationRequest) => x,
    default: () => undefined,
  },
  progress: {
    value: (x: AgentState['progress']) => x,
    default: () => ({ 
      currentState: 'routing' as AgentStateName, 
      percentage: 0, 
      message: 'Starting...' 
    }),
  },
  messages: {
    value: (x: BaseMessage[], y?: BaseMessage[]) => y !== undefined ? y : x,
    default: () => [],
  },
  schemaContext: {
    value: (x?: string) => x,
    default: () => undefined,
  },
};

// Utility function to calculate progress percentage
export function calculateProgress(state: AgentStateName): number {
  const progressMap: Record<AgentStateName, number> = {
    routing: 5,
    planning: 10,
    understanding_schema: 20,
    generating_query: 30,
    executing_query: 50,
    validating_results: 70,
    clarifying: 40,
    chatting: 90,
    transforming_data: 90,
    completed: 100,
    failed: 100,
    retrying: 0,
  };
  return progressMap[state] || 0;
} 
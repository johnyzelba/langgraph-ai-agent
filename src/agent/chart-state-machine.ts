import { BaseMessage } from '@langchain/core/messages';
import { StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { z } from 'zod';

// Chart types supported (based on Nivo)
export type ChartType = 
  | 'line' | 'bar' | 'pie' | 'scatter' | 'heatmap' 
  | 'radar' | 'sankey' | 'treemap' | 'funnel' 
  | 'calendar' | 'choropleth' | 'network';

// Data requirement for a chart
export interface DataRequirement {
  name: string;
  description: string;
  sqlHint?: string;
  required: boolean;
  dataType: 'numeric' | 'categorical' | 'datetime' | 'text';
}

// SQL Query instruction
export interface QueryInstruction {
  step: number;
  description: string;
  tables?: string[];
  expectedOutput: string;
  dependsOn?: number[]; // Previous step numbers
}

// SQL Query and result
export interface SQLQuery {
  query: string;
  explanation?: string;
  optimizationHints?: string[];
  estimatedRows?: number;
}

export interface QueryResult {
  data: any[];
  rowCount: number;
  executionTime: number;
  error?: string;
}

// Validation result
export interface ValidationResult {
  isValid: boolean;
  issues?: string[];
  suggestions?: string[];
}

// Clarification request
export interface ClarificationRequest {
  question: string;
  options?: string[];
  context?: string;
}

// Chart data output (Nivo format)
export interface ChartData {
  type: ChartType;
  data: any; // Specific to each chart type
  config?: any; // Additional Nivo configuration
  title?: string;
  description?: string;
}

// State machine state
export interface ChartGenerationState {
  // Input
  userRequest: string;
  userId: string;
  sessionId: string;
  
  // Planning phase
  chartType?: ChartType;
  dataRequirements?: DataRequirement[];
  queryPlan?: QueryInstruction[];
  
  // Execution phase
  currentStep: number;
  maxRetries: number;
  retryCount: number;
  sqlQueries: SQLQuery[];
  queryResults: QueryResult[];
  validationResults: ValidationResult[];
  
  // Output
  finalChartData?: ChartData;
  errors: string[];
  clarificationNeeded?: ClarificationRequest;
  
  // Progress tracking
  progress: {
    currentState: ChartGenerationStateName;
    percentage: number;
    message: string;
  };
  
  // Context for LLM
  messages: BaseMessage[];
  schemaContext?: string; // RAG retrieved schema information
}

// State names
export type ChartGenerationStateName = 
  | 'planning'
  | 'understanding_schema'
  | 'generating_query'
  | 'executing_query'
  | 'validating_results'
  | 'clarifying'
  | 'retry_query'
  | 'transforming_data'
  | 'completed'
  | 'failed';

// Progress update callback
export type ProgressCallback = (progress: ChartGenerationState['progress']) => void;

// State graph configuration
export const chartStateGraphConfig: StateGraphArgs<ChartGenerationState>['channels'] = {
  userRequest: {
    value: (x: string) => x,
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
    value: (x: number) => x,
    default: () => 0,
  },
  maxRetries: {
    value: (x: number) => x,
    default: () => 3,
  },
  retryCount: {
    value: (x: number) => x,
    default: () => 0,
  },
  sqlQueries: {
    value: (x: SQLQuery[]) => x,
    default: () => [],
  },
  queryResults: {
    value: (x: QueryResult[]) => x,
    default: () => [],
  },
  validationResults: {
    value: (x: ValidationResult[]) => x,
    default: () => [],
  },
  finalChartData: {
    value: (x?: ChartData) => x,
    default: () => undefined,
  },
  errors: {
    value: (x: string[]) => x,
    default: () => [],
  },
  clarificationNeeded: {
    value: (x?: ClarificationRequest) => x,
    default: () => undefined,
  },
  progress: {
    value: (x: ChartGenerationState['progress']) => x,
    default: () => ({ 
      currentState: 'planning' as ChartGenerationStateName, 
      percentage: 0, 
      message: 'Starting...' 
    }),
  },
  messages: {
    value: (x: BaseMessage[]) => x,
    default: () => [],
  },
  schemaContext: {
    value: (x?: string) => x,
    default: () => undefined,
  },
};

// Utility function to calculate progress percentage
export function calculateProgress(state: ChartGenerationStateName): number {
  const progressMap: Record<ChartGenerationStateName, number> = {
    planning: 10,
    understanding_schema: 20,
    generating_query: 30,
    executing_query: 50,
    validating_results: 70,
    clarifying: 40,
    retry_query: 35,
    transforming_data: 90,
    completed: 100,
    failed: 100,
  };
  return progressMap[state] || 0;
} 
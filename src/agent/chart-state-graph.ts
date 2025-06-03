import { StateGraph, END } from '@langchain/langgraph';
import { 
  ChartGenerationState, 
  ChartGenerationStateName,
  chartStateGraphConfig 
} from './chart-state-machine';
import {
  planningNode,
  understandingSchemaNode,
  generatingQueryNode,
  executingQueryNode,
  validatingResultsNode,
  transformingDataNode,
  clarifyingNode,
} from './chart-state-nodes';
import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';
import { createLogger } from '../utils/logger';

const logger = createLogger('chart-state-graph');

interface GraphDependencies {
  llmGateway: LLMGateway;
  toolManager: ToolManager;
  memoryManager: MemoryManager;
  progressCallback?: (progress: ChartGenerationState['progress']) => void;
}

export function createChartStateGraph(deps: GraphDependencies) {
  logger.info('Creating chart state graph');

  // Create the graph with proper type
  const workflow = new StateGraph<ChartGenerationState>({
    channels: chartStateGraphConfig,
  }) as any; // Type assertion to work around LangGraph type issues

  // Define nodes
  workflow.addNode('planning', async (state: ChartGenerationState) => 
    await planningNode(state, deps)
  );
  
  workflow.addNode('understanding_schema', async (state: ChartGenerationState) => 
    await understandingSchemaNode(state, deps)
  );
  
  workflow.addNode('generating_query', async (state: ChartGenerationState) => 
    await generatingQueryNode(state, deps)
  );
  
  workflow.addNode('executing_query', async (state: ChartGenerationState) => 
    await executingQueryNode(state, deps)
  );
  
  workflow.addNode('validating_results', async (state: ChartGenerationState) => 
    await validatingResultsNode(state, deps)
  );
  
  workflow.addNode('transforming_data', async (state: ChartGenerationState) => 
    await transformingDataNode(state, deps)
  );
  
  workflow.addNode('clarifying', async (state: ChartGenerationState) => 
    await clarifyingNode(state, deps)
  );

  // Add state updater nodes
  workflow.addNode('next_step_updater', async (state: ChartGenerationState) => {
    return {
      currentStep: state.currentStep + 1,
      retryCount: 0, // Reset retry count for new step
    };
  });

  workflow.addNode('retry_updater', async (state: ChartGenerationState) => {
    return {
      retryCount: state.retryCount + 1,
    };
  });

  // Set entry point - connect __start__ to planning
  workflow.addEdge('__start__', 'planning');

  // Define edges

  // From planning
  workflow.addConditionalEdges(
    'planning',
    (state: ChartGenerationState) => {
      if (state.clarificationNeeded) {
        return 'clarifying';
      }
      if (state.errors.length > 0) {
        return '__end__';
      }
      return 'understanding_schema';
    },
    {
      clarifying: 'clarifying',
      understanding_schema: 'understanding_schema',
      __end__: '__end__',
    }
  );

  // From understanding schema
  workflow.addEdge('understanding_schema', 'generating_query');

  // From generating query
  workflow.addConditionalEdges(
    'generating_query',
    (state: ChartGenerationState) => {
      if (state.errors.length > 0) {
        return '__end__';
      }
      return 'executing_query';
    },
    {
      executing_query: 'executing_query',
      __end__: '__end__',
    }
  );

  // From executing query
  workflow.addEdge('executing_query', 'validating_results');

  // From validating results
  workflow.addConditionalEdges(
    'validating_results',
    (state: ChartGenerationState) => {
      const currentValidation = state.validationResults[state.currentStep];
      
      if (currentValidation?.isValid) {
        if (state.queryPlan && state.currentStep < state.queryPlan.length - 1) {
          return 'next_step_updater';
        }
        return 'transforming_data';
      }
      
      if (state.retryCount < state.maxRetries) {
        return 'retry_updater';
      }
      
      return '__end__';
    },
    {
      next_step_updater: 'next_step_updater',
      transforming_data: 'transforming_data',
      retry_updater: 'retry_updater',
      __end__: '__end__',
    }
  );

  // Connect updater nodes
  workflow.addEdge('next_step_updater', 'generating_query');
  workflow.addEdge('retry_updater', 'generating_query');

  // From transforming data
  workflow.addConditionalEdges(
    'transforming_data',
    (state: ChartGenerationState) => {
      if (state.finalChartData) {
        return '__end__';
      }
      return '__end__'; // Even on failure, end the flow
    },
    {
      __end__: '__end__',
    }
  );

  // From clarifying - this ends the flow and returns clarification to user
  workflow.addEdge('clarifying', '__end__');

  return workflow.compile();
}

// Helper function to run the graph with progress updates
export async function runChartGeneration(
  userRequest: string,
  userId: string,
  sessionId: string,
  deps: GraphDependencies
): Promise<ChartGenerationState> {
  const graph = createChartStateGraph(deps);
  
  const initialState: ChartGenerationState = {
    userRequest,
    userId,
    sessionId,
    currentStep: 0,
    maxRetries: 3,
    retryCount: 0,
    sqlQueries: [],
    queryResults: [],
    validationResults: [],
    errors: [],
    progress: {
      currentState: 'planning',
      percentage: 0,
      message: 'Starting chart generation...',
    },
    messages: [],
  };

  try {
    const result = await graph.invoke(initialState);
    // The result from LangGraph needs to be cast to our state type
    return result as ChartGenerationState;
  } catch (error) {
    logger.error('Chart generation failed', { error });
    return {
      ...initialState,
      errors: [`Chart generation failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        currentState: 'failed',
        percentage: 100,
        message: 'Chart generation failed',
      },
    };
  }
} 
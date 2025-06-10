import { StateGraph } from '@langchain/langgraph';
import {
  planningNode,
  understandingSchemaNode,
  generatingQueryNode,
  executingQueryNode,
  validatingResultsNode,
  transformingDataNode,
  clarifyingNode,
  routingNode,
  chattingNode,
} from './chart-state-nodes';
import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';
import { createLogger } from '../utils/logger';
import { 
  AgentState, 
  GraphDependencies
} from './types';
import { agentGraphConfig } from './chart-state-machine';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

const logger = createLogger('agent-graph');

export async function createAgentGraph(deps: GraphDependencies) {
  logger.info('Creating agent state graph');

  // Create the graph with proper type
  const workflow = new StateGraph<AgentState>({
    channels: agentGraphConfig,
  }) as any; // Type assertion to work around LangGraph type issues

  // Define nodes
  workflow.addNode('routing', async (state: AgentState) => 
    await routingNode(state, deps)
  );
  workflow.addNode('planning', async (state: AgentState) => 
    await planningNode(state, deps)
  );
  workflow.addNode('chatting', async (state: AgentState) =>
    await chattingNode(state, deps)
  );
  workflow.addNode('understanding_schema', async (state: AgentState) => 
    await understandingSchemaNode(state, deps)
  );
  workflow.addNode('generating_query', async (state: AgentState) => 
    await generatingQueryNode(state, deps)
  );
  workflow.addNode('executing_query', async (state: AgentState) => 
    await executingQueryNode(state, deps)
  );
  workflow.addNode('validating_results', async (state: AgentState) => 
    await validatingResultsNode(state, deps)
  );
  workflow.addNode('transforming_data', async (state: AgentState) => 
    await transformingDataNode(state, deps)
  );
  workflow.addNode('clarifying', async (state: AgentState) => 
    await clarifyingNode(state, deps)
  );

  // Add state updater nodes
  workflow.addNode('next_step_updater', async (state: AgentState) => {
    const newStep = state.currentStep + 1;
    
    return {
      currentStep: newStep,
      retryCount: 0, // Reset retry count for new step
    };
  });

  workflow.addNode('retry_updater', async (state: AgentState) => {
    return {
      retryCount: state.retryCount + 1,
    };
  });

  // Set entry point
  workflow.addEdge('__start__', 'routing');

  // Define edges

  // From routing
  workflow.addConditionalEdges(
    'routing',
    (state: AgentState) => {
      if (state.errors.length > 0) return '__end__';
      
      switch (state.intent) {
        case 'chart':
          return 'planning';
        case 'chat':
        default:
          return 'chatting';
      }
    },
    {
      planning: 'planning',
      chatting: 'chatting',
      __end__: '__end__',
    }
  );

  // From planning
  workflow.addConditionalEdges(
    'planning',
    (state: AgentState) => {
      
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
    (state: AgentState) => {
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
    (state: AgentState) => {
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

  // The finalizer node now ends the flow
  workflow.addConditionalEdges(
    'transforming_data',
    (state: AgentState) => {
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

  // From chatting - this also ends the flow
  workflow.addEdge('chatting', '__end__');

  return workflow.compile();
}

// Helper function to run the graph with progress updates
export async function runAgentFlow(
  userRequest: string,
  userId: string,
  sessionId: string,
  deps: GraphDependencies
): Promise<AgentState> {
  const graph = await createAgentGraph(deps);
  
  const recentMessages: BaseMessage[] = [];
  try {
    const history = await deps.memoryManager.getRecentMessages(userId, sessionId, 5);
    for (const msg of history) {
      recentMessages.push(new HumanMessage(msg.userMessage));
      recentMessages.push(new AIMessage(msg.assistantResponse));
    }
  } catch (e) {
    logger.error("Failed to retrieve message history", { error: e });
  }

  recentMessages.push(new HumanMessage(userRequest));
  
  const initialState: AgentState = {
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
      currentState: 'routing',
      percentage: 0,
      message: 'Starting agent...',
    },
    messages: recentMessages,
  };

  try {
    const result = await graph.invoke(initialState);
    
    logger.info('Graph invocation completed', {
      resultUserRequest: (result as AgentState).userRequest,
      resultUserRequestLength: (result as AgentState).userRequest?.length || 0,
    });
    
    // The result from LangGraph needs to be cast to our state type
    return result as AgentState;
  } catch (error) {
    logger.error('Agent flow failed', { error });
    return {
      ...initialState,
      errors: [`Agent flow failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        currentState: 'failed',
        percentage: 100,
        message: 'Agent flow failed',
      },
    };
  }
} 
import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { createLogger } from '../../utils/logger';

const logger = createLogger('chatting-node');

// This is a simplified version of what's in orchestrator.ts
async function buildChatContext(state: AgentState, deps: NodeDependencies): Promise<BaseMessage[]> {
    const messages: BaseMessage[] = [
      new SystemMessage('You are a helpful AI assistant. You have access to tools and memory.'),
    ];

    // This is a placeholder for memory management
    const recentMessages = await deps.memoryManager.getRecentMessages(
      state.userId,
      state.sessionId,
      5
    );

    for (const msg of recentMessages) {
      messages.push(new HumanMessage(msg.userMessage));
      messages.push(new AIMessage(msg.assistantResponse));
    }

    messages.push(new HumanMessage(state.userRequest));
    return messages;
}

export async function chattingNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Chatting node executing');

  const updatedState = updateProgress(
    state,
    'chatting',
    'Generating response...',
    deps.progressCallback
  );

  try {
    // This node will essentially replace `processNormalRequest`
    // For now, it will be a simple LLM call.
    // The logic from orchestrator for tools can be re-integrated here.

    const messages = await buildChatContext(state, deps);

    const response = await deps.llmGateway.generateCompletion(messages);

    return {
      ...updatedState,
      chatResponse: response,
      messages: [...state.messages, ...messages, new AIMessage(response)],
       progress: {
        currentState: 'completed',
        percentage: 100,
        message: 'Response ready!',
      },
    };
  } catch (error) {
    logger.error('Chatting failed', { error });
    return {
      ...updatedState,
      errors: [...state.errors, `Chatting failed: ${error instanceof Error ? error.message : String(error)}`],
       progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }
} 
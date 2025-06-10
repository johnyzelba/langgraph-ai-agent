import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { parseLLMResponse, validateLLMResponseStructure } from '../../utils/llm-parser';
import { createLogger } from '../../utils/logger';

const logger = createLogger('routing-node');

export async function routingNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Routing node executing');

  const updatedState = updateProgress(
    state,
    'routing',
    'Classifying your request...',
    deps.progressCallback
  );

  const routingPrompt = `
You are an expert at understanding user requests. Look at the user's latest message in the context of the conversation history. Classify the user's intent for the LATEST message into one of two categories: "chart" or "chat".

Your response must be a valid JSON object with the following structure:
{
  "intent": "chart" | "chat",
  "reasoning": "A brief explanation for your choice."
}

Guidelines:
- "chart": Use for any request that involves creating a chart, graph, or visualization. Even if it's a short follow-up like "make it a line chart".
- "chat": Use for general conversation, questions, or requests that don't involve creating a chart.

If the last message was a question from you (the assistant) asking about a chart, and the user's reply seems to be an answer, classify the intent as "chart".
`;

  const llmMessages: BaseMessage[] = [
    new SystemMessage(routingPrompt),
    ...state.messages,
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(llmMessages, {
      temperature: 0,
    });

    const classification = parseLLMResponse<{ intent: 'chart' | 'chat', reasoning: string }>(response, 'routing node');
    validateLLMResponseStructure(classification, ['intent'], 'routing node');

    return {
      ...updatedState,
      intent: classification.intent,
      messages: [...state.messages, new AIMessage(response)],
    };

  } catch (error) {
    logger.error('Routing failed', { error });
    return {
      ...updatedState,
      errors: [...state.errors, `Routing failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }
} 
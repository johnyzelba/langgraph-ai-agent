import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { parseLLMResponse, validateLLMResponseStructure } from '../../utils/llm-parser';
import { createLogger } from '../../utils/logger';

const logger = createLogger('finalizing-data-node');

export async function finalizingDataNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Finalizing data node executing');

  const updatedState = updateProgress(
    state,
    'transforming_data', // Keep the state as transforming for progress UI
    'Finalizing and validating chart data structure...',
    deps.progressCallback
  );

  const finalizationPrompt = `
You are a data structure expert. Your task is to inspect the provided chart data and ensure it is correctly formatted for the specified chart type. Fix any structural issues.

**User's Goal:** "${state.userRequest}"
**Chart Type:** "${state.chartType}"
**Current Data:**
\`\`\`json
${JSON.stringify(state.finalChartData?.data, null, 2)}
\`\`\`

**Problem to solve:**
For a simple time-series line chart, the data should be a SINGLE series object in an array. The current data might be incorrectly structured as an array of series, each with only one data point.

**Correct Structure for a Line Chart:**
\`\`\`json
[
  {
    "id": "Descriptive Series Name",
    "data": [
      { "x": "2022-01", "y": 115 },
      { "x": "2022-02", "y": 103 },
      { "x": "2022-03", "y": 118 }
    ]
  }
]
\`\`\`

**Instructions:**
1.  **Inspect the "Current Data"**.
2.  If it's a line chart and the data is an array of single-point series, **restructure it** into a single series object as shown in the "Correct Structure" example.
3.  **Create a descriptive "id"** for the series based on the user's goal (e.g., "Number of Purchases", "Total Sales"). Do not use a date as the id.
4.  Your response MUST be a valid JSON object containing only the corrected data array. Do not include any other text or explanations.

**JSON Output Format:**
{
  "corrected_data": [ ...the corrected data array... ]
}
`;

  const llmMessages: BaseMessage[] = [new SystemMessage(finalizationPrompt)];

  try {
    const response = await deps.llmGateway.generateCompletion(llmMessages, {
      temperature: 0,
    });

    const parsed = parseLLMResponse<{ corrected_data: any[] }>(response, 'finalizing node');
    validateLLMResponseStructure(parsed, ['corrected_data'], 'finalizing node');

    const finalChartData = {
        ...(state.finalChartData || {}),
        type: state.chartType!,
        data: parsed.corrected_data,
    };

    return {
      ...updatedState,
      finalChartData,
      messages: [...state.messages, new AIMessage(response)],
      progress: {
        currentState: 'completed',
        percentage: 100,
        message: 'Chart data ready!',
      },
    };
  } catch (error) {
    logger.error('Data finalization failed', { error });
    // If finalization fails, just return the data as-is to avoid a crash.
    // The data might still be renderable.
    return {
      ...updatedState,
      errors: [...state.errors, `Data finalization failed: ${error instanceof Error ? error.message : String(error)}`],
       progress: {
        currentState: 'completed',
        percentage: 100,
        message: 'Chart data ready (with potential formatting issues).',
      },
    };
  }
} 
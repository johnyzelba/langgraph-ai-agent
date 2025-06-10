import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { AgentState, ChartType, DataRequirement, QueryInstruction } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { parseLLMResponse, validateLLMResponseStructure } from '../../utils/llm-parser';
import { createLogger } from '../../utils/logger';

const logger = createLogger('planning-node');

// Planning node - generates the execution plan
export async function planningNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Planning node executing', { userRequest: state.userRequest });
  
  const updatedState = updateProgress(
    state, 
    'planning', 
    'Analyzing your request and creating execution plan...',
    deps.progressCallback
  );

  const planningPrompt = `
You are a data visualization expert. Analyze the user's request from the conversation history and create a detailed plan for generating the requested chart.

The user's latest request may be a short follow-up to a previous clarification.

Your response must be a valid JSON object with the following structure:
{
  "chartType": "line|bar|pie|scatter|heatmap|radar|sankey|treemap|funnel|calendar|choropleth|network",
  "dataRequirements": [
    {
      "name": "requirement name",
      "description": "what data is needed",
      "sqlHint": "hint for SQL generation",
      "required": true/false,
      "dataType": "numeric|categorical|datetime|text"
    }
  ],
  "queryPlan": [
    {
      "step": 1,
      "description": "what this query does",
      "tables": ["table1", "table2"],
      "expectedOutput": "description of expected result",
      "dependsOn": []
    }
  ],
  "clarificationNeeded": null or {
    "question": "clarification question",
    "options": ["option1", "option2", "option3"] or null,
    "context": "why we need clarification"
  }
}

Guidelines:
1. Base your plan on the full conversation. The user may have provided details in earlier messages.
2. Choose the most appropriate chart type for the data and use case.
3. For requests involving "top N" items with time series data, PREFER single comprehensive queries when possible.
4. Only use 2 steps if the query becomes too complex or has dependencies.
5. Identify all data requirements clearly.
6. If the request is still ambiguous after reviewing the history, set clarificationNeeded.

**CRITICAL VALIDATION: WHEN TO CLARIFY**
You MUST set "clarificationNeeded" if the user's request for a chart is missing any of the following critical pieces of information:

1.  **A clear metric to plot (the Y-axis)**: What is being measured? (e.g., "number of users", "total sales amount", "average response time"). "Purchases" is ambiguous; clarify if it means count or value.
2.  **A clear dimension for the X-axis**: How should the data be grouped? (e.g., "over time by month", "by product category", "per country"). A time-based chart *requires* a time dimension.
3.  **A specific timeframe (for time-series)**: If the request is about a period, is it defined? (e.g., "in the last year", "for the month of June").

**Example of Ambiguity:**
- User Request: "Show me a line graph of purchases."
- This is AMBIGUOUS. You must ask for clarification on the metric (count vs. value) and the time dimension.

**HOW TO ASK FOR CLARIFICATION:**
When you set "clarificationNeeded", the "question" you provide MUST be specific and helpful. Do not just say "Please clarify". Instead:
1.  **Acknowledge what you understood**: Start by confirming the parts of the request you did understand (e.g., "I can create a line chart of sales for you...").
2.  **State what is missing**: Clearly list the specific information you need (e.g., "...but I need to know the time period you're interested in.").
3.  **Suggest options if possible**: If there are common choices, provide them in the "options" array.

**Good Clarification Example:**
- User Request: "Show me a line graph of purchases."
- clarificationNeeded: A JSON object where the 'question' might be 'I can create a line chart for you, but is that by number of purchases or total value?', 'options' could be '["Number of purchases", "Value of purchases"]', and 'context' explains the ambiguity.

CLARIFICATION GUIDELINES:
• For CLOSED-ENDED questions (limited choices), provide "options" array with 2-5 specific choices.
• For OPEN-ENDED questions (free text needed), set "options" to null.

IMPORTANT: Most "top N with time series" requests can be satisfied with a single well-designed query using subqueries.
`;

  const llmMessages: BaseMessage[] = [
    new SystemMessage(planningPrompt),
    ...state.messages,
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(llmMessages, {
      temperature: 0.3,
    });

    // The plan can have two valid shapes: a full plan or a clarification request.
    const plan = parseLLMResponse<any>(response, 'planning node');
    
    // Prioritize clarification if the model asks for it.
    if (plan.clarificationNeeded) {
      return {
        ...updatedState,
        clarificationNeeded: plan.clarificationNeeded,
        progress: {
          ...updatedState.progress,
          currentState: 'clarifying',
        },
        messages: [...state.messages, new AIMessage(response)],
      };
    }
    
    // If no clarification is needed, it must be a valid plan.
    validateLLMResponseStructure(plan, ['chartType', 'queryPlan'], 'planning node');

    return {
      ...updatedState,
      chartType: plan.chartType as ChartType,
      dataRequirements: plan.dataRequirements as DataRequirement[],
      queryPlan: plan.queryPlan as QueryInstruction[],
      messages: [...state.messages, new AIMessage(response)],
    };
  } catch (error) {
    logger.error('Planning failed', { error });
    // If parsing or validation fails, ask the user to rephrase.
    return {
      ...updatedState,
      clarificationNeeded: {
          question: "I'm having a little trouble understanding your request. Could you please rephrase it or provide more details?",
          context: error instanceof Error ? error.message : String(error),
      },
      progress: {
        ...updatedState.progress,
        currentState: 'clarifying',
      },
    };
  }
} 
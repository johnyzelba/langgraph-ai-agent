import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { AgentState, ValidationResult } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { parseLLMResponse, validateLLMResponseStructure } from '../../utils/llm-parser';
import { createLogger } from '../../utils/logger';

const logger = createLogger('validating-results-node');

// Validating results node - checks if the query results are valid
export async function validatingResultsNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Validating results node', { currentStep: state.currentStep });
  
  const updatedState = updateProgress(
    state, 
    'validating_results', 
    'Validating query results...',
    deps.progressCallback
  );

  const queryResult = state.queryResults[state.currentStep];
  const currentInstruction = state.queryPlan?.[state.currentStep];
  
  if (!queryResult || !currentInstruction) {
    logger.error('Validation failed - Missing data', {
      hasQueryResult: !!queryResult,
      hasCurrentInstruction: !!currentInstruction,
      currentStep: state.currentStep,
      queryResultsLength: state.queryResults.length,
      queryPlanLength: state.queryPlan?.length || 0
    });
    
    return {
      ...updatedState,
      errors: [...state.errors, 'No results to validate'],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }

  const validationPrompt = `
Validate the SQL query results for chart generation:

Chart Type: ${state.chartType}
Expected Output: ${currentInstruction.expectedOutput}
Query Result Summary:
- Row Count: ${queryResult.rowCount}
- Execution Time: ${queryResult.executionTime}ms
- Error: ${queryResult.error || 'None'}
- Sample Data (first 5 rows): ${JSON.stringify(queryResult.data.slice(0, 5), null, 2)}

Database Schema Context:
${state.schemaContext ? state.schemaContext.substring(0, 2000) + '...' : 'No schema available'}

Your response must be a valid JSON object:
{
  "isValid": true/false,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1", "suggestion2"]
}

Validation criteria:
1. Check if data structure matches chart requirements
2. Verify sufficient data points
3. Check for null/missing values
4. Validate data types
5. Ensure proper aggregation
6. 🚨 CRITICAL: If error contains "no such table" or "no such column", mark as invalid
7. 🚨 CRITICAL: Check if query used only tables/columns from the provided schema
8. If schema-related errors detected, suggest using actual schema table/column names

SCHEMA VALIDATION RULES:
- If error mentions missing tables/columns, the query violated schema adherence
- Suggest specific table/column names from the provided schema
- For "no such table" errors, recommend actual table names from schema
- For "no such column" errors, recommend actual column names from schema
`;

  const messages: BaseMessage[] = [
    new SystemMessage(validationPrompt),
    new HumanMessage('Validate the query results'),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.1,
    });

    const validation = parseLLMResponse<ValidationResult>(response, 'result validation');
    
    // Validate the validation result structure
    validateLLMResponseStructure(validation, ['isValid'], 'result validation');
    
    const newValidations = [...state.validationResults];
    newValidations[state.currentStep] = validation;

    return {
      ...updatedState,
      validationResults: newValidations,
      messages: [...state.messages, ...messages, new AIMessage(response)],
    };
  } catch (error) {
    logger.error('Validation failed', { error });
    
    // Default to invalid if validation fails
    const validation: ValidationResult = {
      isValid: false,
      issues: ['Validation process failed'],
      suggestions: ['Retry query generation'],
    };
    
    const newValidations = [...state.validationResults];
    newValidations[state.currentStep] = validation;

    return {
      ...updatedState,
      validationResults: newValidations,
    };
  }
} 
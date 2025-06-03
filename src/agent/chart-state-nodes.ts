import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { 
  ChartGenerationState, 
  ChartGenerationStateName,
  calculateProgress,
  ChartType,
  DataRequirement,
  QueryInstruction,
  SQLQuery,
  ValidationResult,
  ClarificationRequest
} from './chart-state-machine';
import { LLMGateway } from '../services/llm-gateway';
import { ToolManager } from '../tools/tool-manager';
import { MemoryManager } from '../memory/memory-manager';
import { createLogger } from '../utils/logger';

const logger = createLogger('chart-state-nodes');

interface NodeDependencies {
  llmGateway: LLMGateway;
  toolManager: ToolManager;
  memoryManager: MemoryManager;
  progressCallback?: (progress: ChartGenerationState['progress']) => void;
}

// Helper function to update progress
function updateProgress(
  state: ChartGenerationState, 
  newState: ChartGenerationStateName, 
  message: string,
  callback?: (progress: ChartGenerationState['progress']) => void
): ChartGenerationState {
  const progress = {
    currentState: newState,
    percentage: calculateProgress(newState),
    message,
  };
  
  if (callback) {
    callback(progress);
  }
  
  return { ...state, progress };
}

// Planning node - generates the execution plan
export async function planningNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
  logger.info('Planning node executing', { userRequest: state.userRequest });
  
  const updatedState = updateProgress(
    state, 
    'planning', 
    'Analyzing your request and creating execution plan...',
    deps.progressCallback
  );

  const planningPrompt = `
You are a data visualization expert. Analyze the user's request and create a detailed plan for generating the requested chart.

User Request: "${state.userRequest}"

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
    "options": ["option1", "option2"],
    "context": "why we need clarification"
  }
}

Guidelines:
1. Choose the most appropriate chart type for the data and use case
2. Prefer single complex queries over multiple simple ones
3. Identify all data requirements clearly
4. If the request is ambiguous, set clarificationNeeded
5. Make the query plan specific and actionable
`;

  const messages: BaseMessage[] = [
    new SystemMessage(planningPrompt),
    new HumanMessage(state.userRequest),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.3,
    });

    const plan = JSON.parse(response);
    
    if (plan.clarificationNeeded) {
      return {
        ...updatedState,
        clarificationNeeded: plan.clarificationNeeded,
        progress: {
          ...updatedState.progress,
          currentState: 'clarifying',
        },
      };
    }

    return {
      ...updatedState,
      chartType: plan.chartType as ChartType,
      dataRequirements: plan.dataRequirements as DataRequirement[],
      queryPlan: plan.queryPlan as QueryInstruction[],
      messages: [...state.messages, ...messages, new AIMessage(response)],
    };
  } catch (error) {
    logger.error('Planning failed', { error });
    return {
      ...updatedState,
      errors: [...state.errors, `Planning failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }
}

// Understanding schema node - uses RAG to get relevant schema information
export async function understandingSchemaNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
  logger.info('Understanding schema node executing');
  
  const updatedState = updateProgress(
    state, 
    'understanding_schema', 
    'Retrieving relevant database schema information...',
    deps.progressCallback
  );

  try {
    // Query vector memory for relevant schema information
    const relevantTables = state.queryPlan?.flatMap(q => q.tables || []) || [];
    const schemaQuery = `Database schema for tables: ${relevantTables.join(', ')} ${state.userRequest}`;
    
    const schemaContext = await deps.memoryManager.queryVectorMemory(schemaQuery, {
      filter: { type: 'schema' },
      limit: 5,
    });

    const schemaText = schemaContext.map(doc => doc.pageContent).join('\n\n');

    return {
      ...updatedState,
      schemaContext: schemaText,
    };
  } catch (error) {
    logger.error('Schema understanding failed', { error });
    // Continue without schema context - not critical
    return {
      ...updatedState,
      schemaContext: '',
    };
  }
}

// Generating query node - creates SQL queries based on the plan
export async function generatingQueryNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
  logger.info('Generating query node executing', { currentStep: state.currentStep });
  
  const updatedState = updateProgress(
    state, 
    'generating_query', 
    `Generating SQL query (step ${state.currentStep + 1}/${state.queryPlan?.length || 1})...`,
    deps.progressCallback
  );

  const currentInstruction = state.queryPlan?.[state.currentStep];
  if (!currentInstruction) {
    return {
      ...updatedState,
      errors: [...state.errors, 'No query instruction found'],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }

  const queryPrompt = `
You are an expert SQL query writer. Generate an optimized SQL query based on the following:

Chart Type: ${state.chartType}
Data Requirements: ${JSON.stringify(state.dataRequirements, null, 2)}
Current Instruction: ${JSON.stringify(currentInstruction, null, 2)}
${state.schemaContext ? `\nDatabase Schema:\n${state.schemaContext}` : ''}
${state.retryCount > 0 ? `\nPrevious attempt failed. Issues: ${JSON.stringify(state.validationResults[state.currentStep]?.issues)}` : ''}

Your response must be a valid JSON object:
{
  "query": "SELECT ...",
  "explanation": "what this query does",
  "optimizationHints": ["hint1", "hint2"],
  "estimatedRows": 1000
}

Guidelines:
1. Use appropriate aggregations for the chart type
2. Include proper GROUP BY and ORDER BY clauses
3. Optimize for performance with indexes
4. Limit results appropriately (use data sampling if needed)
5. Ensure column names are clear and meaningful
6. For time series data, ensure proper date formatting
7. Avoid SELECT * - be specific about columns
`;

  const messages: BaseMessage[] = [
    new SystemMessage(queryPrompt),
    new HumanMessage(`Generate SQL for: ${currentInstruction.description}`),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.2,
    });

    const sqlQuery = JSON.parse(response) as SQLQuery;
    
    const newQueries = [...state.sqlQueries];
    newQueries[state.currentStep] = sqlQuery;

    return {
      ...updatedState,
      sqlQueries: newQueries,
      messages: [...state.messages, ...messages, new AIMessage(response)],
    };
  } catch (error) {
    logger.error('Query generation failed', { error });
    return {
      ...updatedState,
      errors: [...state.errors, `Query generation failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }
}

// Executing query node - runs the SQL query using MCP tool
export async function executingQueryNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
  logger.info('Executing query node', { currentStep: state.currentStep });
  
  const updatedState = updateProgress(
    state, 
    'executing_query', 
    `Executing SQL query (step ${state.currentStep + 1}/${state.queryPlan?.length || 1})...`,
    deps.progressCallback
  );

  const sqlQuery = state.sqlQueries[state.currentStep];
  if (!sqlQuery) {
    return {
      ...updatedState,
      errors: [...state.errors, 'No SQL query to execute'],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }

  try {
    const startTime = Date.now();
    
    // Execute SQL using the MCP tool
    const sqlTool = deps.toolManager.getTool('sql_query');
    if (!sqlTool) {
      throw new Error('SQL query tool not available');
    }

    const result = await sqlTool.invoke(sqlQuery.query);
    const executionTime = Date.now() - startTime;

    const queryResult = {
      data: Array.isArray(result) ? result : [],
      rowCount: Array.isArray(result) ? result.length : 0,
      executionTime,
    };

    const newResults = [...state.queryResults];
    newResults[state.currentStep] = queryResult;

    logger.info('Query executed successfully', { 
      rowCount: queryResult.rowCount,
      executionTime,
    });

    return {
      ...updatedState,
      queryResults: newResults,
    };
  } catch (error) {
    logger.error('Query execution failed', { error });
    
    const queryResult = {
      data: [],
      rowCount: 0,
      executionTime: 0,
      error: error instanceof Error ? error.message : String(error),
    };

    const newResults = [...state.queryResults];
    newResults[state.currentStep] = queryResult;

    return {
      ...updatedState,
      queryResults: newResults,
    };
  }
}

// Validating results node - checks if the query results are valid
export async function validatingResultsNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
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
`;

  const messages: BaseMessage[] = [
    new SystemMessage(validationPrompt),
    new HumanMessage('Validate the query results'),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.1,
    });

    const validation = JSON.parse(response) as ValidationResult;
    
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

// Transforming data node - converts query results to chart format
export async function transformingDataNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
  logger.info('Transforming data node executing');
  
  const updatedState = updateProgress(
    state, 
    'transforming_data', 
    'Transforming data to chart format...',
    deps.progressCallback
  );

  const transformPrompt = `
Transform the SQL query results into the appropriate Nivo chart format:

Chart Type: ${state.chartType}
Data Requirements: ${JSON.stringify(state.dataRequirements, null, 2)}
Query Results: ${JSON.stringify(state.queryResults.map((r, i) => ({
  step: i + 1,
  rowCount: r.rowCount,
  sampleData: r.data.slice(0, 10),
})), null, 2)}

Your response must be a valid JSON object matching the Nivo ${state.chartType} chart data format.
Include any necessary configuration options for the chart.

The response structure should be:
{
  "type": "${state.chartType}",
  "data": <Nivo-specific data format>,
  "config": <optional Nivo configuration>,
  "title": "Chart title",
  "description": "Brief description"
}
`;

  const messages: BaseMessage[] = [
    new SystemMessage(transformPrompt),
    new HumanMessage('Transform the data for the chart'),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.1,
    });

    const chartData = JSON.parse(response);

    return {
      ...updatedState,
      finalChartData: chartData,
      messages: [...state.messages, ...messages, new AIMessage(response)],
      progress: {
        currentState: 'completed',
        percentage: 100,
        message: 'Chart data ready!',
      },
    };
  } catch (error) {
    logger.error('Data transformation failed', { error });
    return {
      ...updatedState,
      errors: [...state.errors, `Data transformation failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }
}

// Clarifying node - handles user clarification
export async function clarifyingNode(
  state: ChartGenerationState,
  deps: NodeDependencies
): Promise<Partial<ChartGenerationState>> {
  logger.info('Clarifying node executing');
  
  // This node just sets the clarification state
  // The actual clarification will be handled by returning to the user
  return updateProgress(
    state,
    'clarifying',
    'Need clarification from user...',
    deps.progressCallback
  );
} 
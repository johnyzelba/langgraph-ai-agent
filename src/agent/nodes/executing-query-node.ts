import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { createLogger } from '../../utils/logger';

const logger = createLogger('executing-query-node');

// Executing query node - runs the SQL query using MCP tool
export async function executingQueryNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Executing query node', { currentStep: state.currentStep });
  
  const updatedState = updateProgress(
    state, 
    'executing_query', 
    `Executing SQL query (step ${state.currentStep + 1}/${state.queryPlan?.length || 1})...`,
    deps.progressCallback
  );

  logger.debug('Executing query node state check', {
    currentStep: state.currentStep,
    sqlQueriesLength: state.sqlQueries.length,
    sqlQueriesArray: state.sqlQueries.map((q, i) => ({ step: i, hasQuery: !!q, query: q?.query?.substring(0, 50) + '...' }))
  });

  const sqlQuery = state.sqlQueries[state.currentStep];
  if (!sqlQuery) {
    logger.error('No SQL query found for execution', {
      currentStep: state.currentStep,
      totalQueries: state.sqlQueries.length,
      availableSteps: state.sqlQueries.map((q, i) => ({ step: i, exists: !!q }))
    });
    
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

    logger.debug('Invoking SQL tool', { 
      query: sqlQuery.query,
      toolName: sqlTool.name,
      queryLength: sqlQuery.query.length,
      currentStep: state.currentStep
    });
    
    // Format the input for the SQL tool (expects JSON with query and optional database)
    const toolInput = JSON.stringify({
      query: sqlQuery.query,
      database: undefined // Use default database
    });
    
    const result = await sqlTool.invoke(toolInput);
    const executionTime = Date.now() - startTime;
    
    logger.debug('SQL tool response', { 
      result: typeof result === 'string' ? result.substring(0, 200) + '...' : result,
      resultType: typeof result,
      executionTime 
    });

    // Parse the JSON response from the SQL tool
    let parsedResult;
    try {
      parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    } catch (parseError) {
      logger.error('Failed to parse SQL tool response', { 
        result, 
        parseError,
        resultType: typeof result 
      });
      throw new Error(`Invalid response from SQL tool: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

    // Check if the response contains an error
    if (parsedResult.error) {
      logger.error('SQL tool returned error', {
        error: parsedResult.error,
        query: sqlQuery.query,
        currentStep: state.currentStep,
        fullResult: parsedResult
      });
      throw new Error(`SQL execution failed: ${parsedResult.error}`);
    }

    // Extract the data from the response
    const data = parsedResult.data || parsedResult.results || parsedResult || [];
    
    const queryResult = {
      data: Array.isArray(data) ? data : [],
      rowCount: Array.isArray(data) ? data.length : 0,
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
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { AgentState, SQLQuery } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { parseLLMResponse, extractJSONFromResponse, validateLLMResponseStructure } from '../../utils/llm-parser';
import { createLogger } from '../../utils/logger';

const logger = createLogger('generating-query-node');

interface SchemaValidationResult {
  isValid: boolean;
  issues: string[];
  tablesFound: string[];
  columnsChecked: number;
}

/**
 * Extract column names from a SQL query
 * This handles both table.column format and bare column names
 */
function extractColumnsFromQuery(query: string): Set<string> {
  const queryColumns = new Set<string>();
  
  // Extract columns in table.column format
  const tableColumnMatches = query.match(/[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/gi);
  if (tableColumnMatches && Array.isArray(tableColumnMatches)) {
    tableColumnMatches.forEach(fullCol => {
      if (typeof fullCol === 'string') {
        const parts = fullCol.split('.');
        if (parts.length === 2) {
          queryColumns.add(parts[1]?.toLowerCase() ?? '');
        }
      }
    });
  }
  
  // Extract bare column names from SELECT, WHERE, etc. clauses
  const clauseRegex = /\b(?:SELECT|WHERE|GROUP BY|ORDER BY|HAVING|ON)\s+(?!FROM|AS)[a-zA-Z_][a-zA-Z0-9_]*/gi;
  const bareColumnMatches = query.match(clauseRegex);
  if (bareColumnMatches && Array.isArray(bareColumnMatches)) {
    bareColumnMatches.forEach(match => {
      if (typeof match === 'string') {
        const columnMatch = match.match(/\b(?:SELECT|WHERE|GROUP BY|ORDER BY|HAVING|ON)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
        if (columnMatch && columnMatch[1]) {
          queryColumns.add(columnMatch[1].toLowerCase());
        }
      }
    });
  }
  
  return queryColumns;
}

/**
 * Validates a SQL query against the provided schema context
 * This is a generic function that works with any database schema
 */
function validateQueryAgainstSchema(query: string, schemaContext: string): SchemaValidationResult {
  const issues: string[] = [];
  const tablesFound: string[] = [];
  let columnsChecked = 0;

  try {
    // Extract table names from schema context
    const tableMatches = schemaContext.match(/##\s+([^#\n]+)\s+Table/gi);
    const schemaTables = tableMatches ?
      tableMatches.map(match => match.replace(/##\s+/, '').replace(/\s+Table/i, '').trim()) : [];

    // Also look for table names in different formats
    const tableNameMatches = schemaContext.match(/Table Name.*?`([^`]+)`/gi);
    if (tableNameMatches) {
      schemaTables.push(...tableNameMatches.map(match => {
        const nameMatch = match.match(/`([^`]+)`/);
        return nameMatch && nameMatch[1] ? nameMatch[1] : '';
      }).filter(Boolean));
    }

    // Extract table references from the query (improved parsing)
    const queryTables: string[] = [];

    // Match FROM clauses - handle quoted table names and aliases
    const fromMatches = query.match(/FROM\s+(["`]?[a-zA-Z_][a-zA-Z0-9_\s]*["`]?)(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
    if (fromMatches) {
      fromMatches.forEach(match => {
        const tableMatch = match.match(/FROM\s+(["`]?[a-zA-Z_][a-zA-Z0-9_\s]*["`]?)/i);
        if (tableMatch && tableMatch[1]) {
          // Clean the table name - remove quotes and extract just the table name (no WHERE clause)
          const rawTableName = tableMatch[1].replace(/["`]/g, '').trim();
          // Extract just the table name (before any WHERE or other clauses)
          let tableName = rawTableName;
          try {
            const parts = rawTableName.split(/\s+WHERE|\s+GROUP|\s+ORDER|\s+HAVING|\s+LIMIT/i);
            if (parts && parts.length > 0) {
              tableName = parts[0]?.trim() || rawTableName;
            }
          } catch (error) {
            // If there's an error parsing, just use the raw table name
            logger.warn('Error parsing table name', { rawTableName, error });
          }
          
          if (tableName && tableName.length > 0 && !tableName.includes('(')) {
            queryTables.push(tableName);
          }
        }
      });
    }

    // Match JOIN clauses - handle quoted table names and aliases
    const joinMatches = query.match(/JOIN\s+(["`]?[a-zA-Z_][a-zA-Z0-9_\s]*["`]?)(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
    if (joinMatches) {
      joinMatches.forEach(match => {
        const tableMatch = match.match(/JOIN\s+(["`]?[a-zA-Z_][a-zA-Z0-9_\s]*["`]?)/i);
        if (tableMatch && tableMatch[1]) {
          const tableName = tableMatch[1].replace(/["`]/g, '').trim();
          if (tableName && tableName.length > 0 && !tableName.includes('(')) {
            queryTables.push(tableName);
          }
        }
      });
    }

    // Debug logging for table extraction
    logger.debug('Schema validation debug', {
      extractedTables: queryTables,
      schemaTables: schemaTables.slice(0, 10),
      queryPreview: query.substring(0, 200)
    });

    // Check if query tables exist in schema
    for (const queryTable of queryTables) {
      const tableExists = schemaTables.some(schemaTable =>
        schemaTable.toLowerCase() === queryTable.toLowerCase() ||
        schemaTable.toLowerCase().includes(queryTable.toLowerCase()) ||
        queryTable.toLowerCase().includes(schemaTable.toLowerCase())
      );

      if (tableExists) {
        tablesFound.push(queryTable);
      } else {
        issues.push(`Table '${queryTable}' not found in schema. Available tables: ${schemaTables.slice(0, 5).join(', ')}`);
      }
    }

    // Extract column information from schema
    const schemaColumns: Set<string> = new Set();
    
    // Extract columns from schema context - look for column listings
    const columnSectionMatches = schemaContext.match(/Columns:[\s\S]*?(?=##|$)/gi);
    if (columnSectionMatches) {
      columnSectionMatches.forEach(section => {
        // Match patterns like "- name: column_name" or "| column_name |"
        const columnMatches = section.match(/(?:[-|]\s*(?:name:|)[^-|\n]*?|`)[a-zA-Z_][a-zA-Z0-9_]*(?:`|\s*[|-])/gi);
        if (columnMatches) {
          columnMatches.forEach(colMatch => {
            // Clean up the match to extract just the column name
            const cleanedCol = colMatch.replace(/[-|]\s*(?:name:|)/g, '').replace(/[`\s|-]/g, '').trim();
            if (cleanedCol && cleanedCol.length > 0) {
              schemaColumns.add(cleanedCol.toLowerCase());
            }
          });
        }
      });
    }
    
    // Extract and check columns from the query using our utility function
    const queryColumns = extractColumnsFromQuery(query);
    columnsChecked = queryColumns.size;
    
    // If we have schema columns, validate query columns against them
    if (schemaColumns.size > 0) {
      // Convert Set to Array for iteration to avoid TypeScript downlevel iteration issues
      Array.from(queryColumns).forEach(queryColumn => {
        // Skip common SQL functions and aggregates
        if (['count', 'sum', 'avg', 'min', 'max', 'strftime', 'date'].includes(queryColumn.toLowerCase())) {
          return;
        }
        
        if (!schemaColumns.has(queryColumn.toLowerCase())) {
          issues.push(`Column '${queryColumn}' not found in schema.`);
        }
      });
    } else {
      // If we couldn't extract columns from schema, add a warning
      logger.warn('Could not extract columns from schema for validation');
    }

    return {
      isValid: issues.length === 0,
      issues,
      tablesFound,
      columnsChecked
    };
  } catch (error) {
    return {
      isValid: false,
      issues: [`Schema validation error: ${error instanceof Error ? error.message : String(error)}`],
      tablesFound: [],
      columnsChecked: 0
    };
  }
}

// Extracted prompt constants for better maintainability
const DATE_FORMATTING_RULES = `
🗓️ DATE FORMATTING (choose based on user request):
• YEARLY: strftime('%Y', date_column) AS year
• MONTHLY: strftime('%Y-%m', date_column) AS month_year  
• WEEKLY: date(date_column, 'weekday 0', '-6 days') AS week_start_date
• DAILY: strftime('%Y-%m-%d', date_column) AS date
• QUARTERLY: strftime('%Y-Q', date_column) || CASE WHEN CAST(strftime('%m', date_column) AS INTEGER) <= 3 THEN '1' WHEN CAST(strftime('%m', date_column) AS INTEGER) <= 6 THEN '2' WHEN CAST(strftime('%m', date_column) AS INTEGER) <= 9 THEN '3' ELSE '4' END AS quarter

⚠️ WEEKLY DATA CRITICAL: 
❌ NEVER use strftime('%W') or strftime('%U') - creates invalid dates like "2020-15"
✅ ALWAYS use date(date_column, 'weekday 0', '-6 days') AS week_start_date`;

const SQLITE_CONSTRAINTS = `
📊 SQLite3 REQUIREMENTS:
• Use LIMIT instead of TOP
• Use double quotes for table names with spaces: "Order Details"
• Use SQLite date functions: date(), datetime(), strftime(), julianday()
• NO "WITH" keyword - use subqueries instead
• NO CTEs (Common Table Expressions)
• NO MySQL/PostgreSQL/SQL Server syntax`;

const SCHEMA_ADHERENCE_RULES = `
🔍 SCHEMA ADHERENCE:
• ONLY use table/column names from the provided schema
• NEVER invent or assume table names like 'purchases', 'users', 'orders' unless they are in the schema
• NEVER invent or assume column names
• Use exact table names (with quotes if they contain spaces)
• Follow schema's foreign key relationships for JOINs
• Verify every table and column exists before using`;

const JSON_RESPONSE_FORMAT = `
🚨 RESPONSE FORMAT: ONLY valid JSON - NO explanatory text!

{
  "tablesUsed": ["table1", "table2"],
  "columnsUsed": ["table1.column1", "table2.column2"], 
  "schemaValidation": "Confirmed all tables and columns exist in provided schema",
  "query": "SELECT ...",
  "explanation": "what this query does",
  "optimizationHints": ["hint1", "hint2"],
  "estimatedRows": 1000
}`;

const SQLITE_EXAMPLES = `
📝 EXAMPLES:
• Monthly time series: SELECT strftime('%Y-%m', OrderDate) AS month_year, SUM(amount) FROM Orders GROUP BY strftime('%Y-%m', OrderDate)
• Weekly aggregation: SELECT date(OrderDate, 'weekday 0', '-6 days') AS week_start, COUNT(*) FROM Orders GROUP BY date(OrderDate, 'weekday 0', '-6 days')
• Top N with subquery: WHERE ProductID IN (SELECT ProductID FROM Products ORDER BY Price DESC LIMIT 10)
• Table with spaces: SELECT * FROM "Order Details" WHERE Quantity > 5`;

/**
 * Creates a user-friendly error message based on validation issues
 */
function createUserFriendlyErrorMessage(issues: string[], schemaContext?: string): string {
  // If there are no issues, return a generic message
  if (!issues || issues.length === 0) {
    return "I encountered an error with the SQL query generation.";
  }

  // Filter issues to focus on the most relevant ones
  const relevantIssues = issues.filter(issue => 
    !issue.includes('Schema validation error:') && 
    !issue.includes('Could not extract columns')
  );

  // Handle table not found errors specifically - this is likely the most common issue
  const tableIssues = relevantIssues.filter(issue => issue.includes("Table '") && issue.includes("not found in schema"));
  if (tableIssues.length > 0) {
    const tableNames = tableIssues
      .map(issue => issue.match(/Table '([^']+)'/)?.[1] || "")
      .filter(Boolean)
      .join(", ");
    
    // Get available tables from schema context to provide helpful suggestions
    let availableTables = "";
    if (schemaContext) {
      const tableMatches = schemaContext.match(/##\s+([^#\n]+)\s+Table/gi);
      const schemaTables = tableMatches ?
        tableMatches.map(match => match.replace(/##\s+/, '').replace(/\s+Table/i, '').trim()) : [];
      
      if (schemaTables.length > 0) {
        availableTables = ` Available tables are: ${schemaTables.join(", ")}.`;
      }
    }
    
    return `I couldn't find the table "${tableNames}" in your database schema.${availableTables} Please verify the table name or provide additional schema information.`;
  }

  // Handle column not found errors specifically
  const columnIssues = relevantIssues.filter(issue => issue.includes("Column '") && issue.includes("not found in schema"));
  if (columnIssues.length > 0) {
    const columnNames = columnIssues
      .map(issue => issue.match(/Column '([^']+)'/)?.[1] || "")
      .filter(Boolean)
      .join(", ");
    
    return `I couldn't find these columns in your database schema: ${columnNames}. Please verify the column names or provide additional schema information.`;
  }

  // Handle other issues with a more generic message
  return `I encountered an error with the SQL query: ${relevantIssues.join(", ")}`;
}

// Generating query node - creates SQL queries based on the plan
export async function generatingQueryNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
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

  // LOG SCHEMA CONTEXT BEING USED IN QUERY GENERATION
  logger.debug('Query generation - Schema context check', {
    hasSchemaContext: !!state.schemaContext,
    schemaContextLength: state.schemaContext?.length || 0,
    schemaContextPreview: state.schemaContext ? state.schemaContext.substring(0, 500) + '...' : 'NO SCHEMA CONTEXT',
    chartType: state.chartType,
    currentStep: state.currentStep
  });

  // Build retry guidance if needed
  const retryGuidance = state.retryCount > 0 ? `
🔄 RETRY CONTEXT:
Previous attempt failed: ${JSON.stringify(state.validationResults[state.currentStep]?.issues)}
${state.validationResults[state.currentStep]?.issues?.some(issue =>
    issue.includes('week') || issue.includes('%W') || issue.includes('%U')
  ) ? '⚠️ Fix weekly formatting: Use date(date_column, \'weekday 0\', \'-6 days\') only!' : ''}` : '';

  const queryPrompt = `You are an expert SQL query writer. Generate an optimized SQL query.

📋 CONTEXT:
Chart Type: ${state.chartType}
Data Requirements: ${JSON.stringify(state.dataRequirements, null, 2)}
Current Instruction: ${JSON.stringify(currentInstruction, null, 2)}
${state.schemaContext ? `\nDatabase Schema:\n${state.schemaContext}` : ''}
${retryGuidance}

${SQLITE_CONSTRAINTS}

${DATE_FORMATTING_RULES}

🎯 TIME SERIES CHARTS (line, scatter):
• Use SINGLE combined time field for x-axis (not separate year/month columns)
• Time field must be directly usable as chart coordinate
• Example: strftime('%Y-%m', date) AS month_year (not separate Year, Month columns)

${SCHEMA_ADHERENCE_RULES}

⚠️ CRITICAL TABLE CHECK:
• You MUST only use tables explicitly defined in the schema above
• Never invent or assume tables like "purchases", "sales", "users", etc.
• First verify tables exist, then check their columns
• Always check if requested data can be represented using existing tables

${JSON_RESPONSE_FORMAT}

${SQLITE_EXAMPLES}

🚨 CRITICAL VALIDATIONS:
1. Verify all tables/columns exist in schema before using
2. Use appropriate date granularity based on user request  
3. For time series: single combined time field, not separate columns
4. Weekly data: ONLY use date(date_column, 'weekday 0', '-6 days')
5. No CTEs or "WITH" clauses - use subqueries instead

Generate SQL for: ${currentInstruction.description}`;

  const messages: BaseMessage[] = [
    new SystemMessage(queryPrompt),
    new HumanMessage(`Generate SQL for: ${currentInstruction.description}`),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.1,
    });

    // Try to extract JSON from response (handles mixed content with explanatory text)
    const sqlQuery = extractJSONFromResponse<SQLQuery>(response, 'query generation');

    if (!sqlQuery) {
      logger.error('Failed to extract valid JSON from LLM response', {
        responsePreview: response.substring(0, 300),
        currentStep: state.currentStep,
        retryCount: state.retryCount
      });

      return {
        ...updatedState,
        errors: [...state.errors, `Failed to parse JSON from LLM response. The LLM returned explanatory text instead of JSON format.`],
        progress: {
          ...updatedState.progress,
          currentState: 'failed',
        },
      };
    }

    // Validate the SQL query structure
    validateLLMResponseStructure(sqlQuery, ['query'], 'query generation');

    // 🚨 CRITICAL: Check for CTE usage and reject immediately
    if (sqlQuery.query.toUpperCase().includes('WITH ')) {
      logger.error('Rejected query - Contains CTE (WITH clause)', {
        query: sqlQuery.query,
        currentStep: state.currentStep,
        retryCount: state.retryCount
      });

      return {
        ...updatedState,
        errors: [...state.errors, `Query contains forbidden WITH clause (CTE). Only simple SELECT statements allowed.`],
        progress: {
          ...updatedState.progress,
          currentState: 'failed',
        },
      };
    }

    // 🗓️ INTELLIGENT DATE FORMATTING VALIDATION
    const userRequest = state.userRequest.toLowerCase();
    const instructionDesc = currentInstruction.description.toLowerCase();

    // Determine expected granularity from user request
    const isYearlyRequest = userRequest.includes('per year') ||
      userRequest.includes('yearly') ||
      userRequest.includes('each year') ||
      userRequest.includes('by year') ||
      instructionDesc.includes('year') && !instructionDesc.includes('month');

    const isMonthlyRequest = userRequest.includes('per month') ||
      userRequest.includes('monthly') ||
      userRequest.includes('each month') ||
      userRequest.includes('by month') ||
      instructionDesc.includes('month');

    const isWeeklyRequest = userRequest.includes('per week') ||
      userRequest.includes('weekly') ||
      userRequest.includes('each week') ||
      userRequest.includes('by week') ||
      instructionDesc.includes('week');

    const isDailyRequest = userRequest.includes('per day') ||
      userRequest.includes('daily') ||
      userRequest.includes('each day') ||
      userRequest.includes('by day');

    // Check for date formatting patterns
    const hasYearFormatting = sqlQuery.query.includes("strftime('%Y',") &&
      !sqlQuery.query.includes("strftime('%Y-%m");
    const hasMonthFormatting = sqlQuery.query.includes("strftime('%Y-%m'");
    const hasWeekFormatting = sqlQuery.query.includes("date(") &&
      sqlQuery.query.includes("'weekday 0'") &&
      sqlQuery.query.includes("'-6 days'");
    const hasInvalidWeekFormatting = sqlQuery.query.includes("strftime('%W'") ||
      sqlQuery.query.includes("strftime('%U'");
    const hasDayFormatting = sqlQuery.query.includes("strftime('%Y-%m-%d'");

    // Check for separate year and month columns (problematic for time series)
    const hasSeparateYearMonth = sqlQuery.query.includes("strftime('%Y',") &&
      sqlQuery.query.includes("strftime('%m',");

    // 🚨 CRITICAL: Check for invalid week formatting first
    if (hasInvalidWeekFormatting) {
      logger.error('Rejected query - Uses invalid week formatting', {
        query: sqlQuery.query,
        currentStep: state.currentStep,
        userRequest: state.userRequest,
        reason: 'Week numbers (strftime %W or %U) create invalid dates like "2020-15". Use proper week start dates instead.'
      });

      return {
        ...updatedState,
        errors: [...state.errors, `Query uses invalid week formatting (strftime '%W' or '%U') which creates invalid dates like "2020-15". For weekly data, use: date(date_column, 'weekday 0', '-6 days') AS week_start_date`],
        progress: {
          ...updatedState.progress,
          currentState: 'failed',
        },
      };
    }

    // Validation logic
    if (isWeeklyRequest && !hasWeekFormatting && !hasInvalidWeekFormatting) {
      logger.error('Rejected query - Weekly data requested but no proper week formatting found', {
        query: sqlQuery.query,
        currentStep: state.currentStep,
        userRequest: state.userRequest,
        reason: 'Weekly data requested but query does not use proper week start date formatting'
      });

      return {
        ...updatedState,
        errors: [...state.errors, `Weekly data requested but query does not use proper week formatting. Use: date(date_column, 'weekday 0', '-6 days') AS week_start_date`],
        progress: {
          ...updatedState.progress,
          currentState: 'failed',
        },
      };
    }

    if (isMonthlyRequest) {
      if (hasSeparateYearMonth) {
        logger.error('Rejected query - Uses separate Year and Month columns for monthly time series', {
          query: sqlQuery.query,
          currentStep: state.currentStep,
          userRequest: state.userRequest,
          reason: 'Time series charts need combined month_year field, not separate Year and Month columns'
        });

        return {
          ...updatedState,
          errors: [...state.errors, `Query uses separate Year and Month columns. For time series charts, use strftime('%Y-%m', date_column) AS month_year instead.`],
          progress: {
            ...updatedState.progress,
            currentState: 'failed',
          },
        };
      }

      if (hasYearFormatting && !hasMonthFormatting && !hasSeparateYearMonth) {
        logger.error('Rejected query - Uses year formatting for monthly request', {
          query: sqlQuery.query,
          currentStep: state.currentStep,
          userRequest: state.userRequest,
          reason: 'Monthly data requested but query uses year-only formatting'
        });

        return {
          ...updatedState,
          errors: [...state.errors, `Query uses year-only date formatting but monthly data was requested. Use strftime('%Y-%m',...) for monthly data.`],
          progress: {
            ...updatedState.progress,
            currentState: 'failed',
          },
        };
      }
    }

    if (isYearlyRequest && hasMonthFormatting && !hasYearFormatting) {
      logger.warn('Query uses monthly formatting for yearly request - may create too many data points', {
        query: sqlQuery.query,
        currentStep: state.currentStep,
        userRequest: state.userRequest
      });
    }

    // 🔍 GENERIC SCHEMA VALIDATION: Check if query uses only schema-defined tables/columns
    if (state.schemaContext && state.schemaContext.length > 0) {
      const schemaValidationResult = validateQueryAgainstSchema(sqlQuery.query, state.schemaContext);

      if (!schemaValidationResult.isValid) {
        // Log the validation issues for debugging
        logger.warn('Schema validation issues detected', {
          query: sqlQuery.query,
          issues: schemaValidationResult.issues,
          currentStep: state.currentStep,
          userRequest: state.userRequest,
          reason: 'Query may use tables or columns not found in the provided schema'
        });

        // Add schema validation issues to the query object instead of failing immediately
        sqlQuery.schemaValidationIssues = schemaValidationResult.issues;
        
        // Check for table validation issues - these are more serious than column issues
        const hasTableIssues = schemaValidationResult.issues.some(issue => 
          issue.includes("Table '") && issue.includes("not found in schema")
        );
        
        // If there are table issues, fail immediately with user-friendly error
        if (hasTableIssues) {
          const userFriendlyError = createUserFriendlyErrorMessage(schemaValidationResult.issues, state.schemaContext);
          
          return {
            ...updatedState,
            errors: [...state.errors, userFriendlyError],
            progress: {
              ...updatedState.progress,
              currentState: 'failed',
              message: userFriendlyError
            },
            friendlyErrorMessage: userFriendlyError
          };
        }
        
        // Only fail if retry count is high or we have serious issues
        const hasSuspiciousPatterns = schemaValidationResult.issues.some(issue =>
          issue.includes('Table') && schemaValidationResult.issues.length > 1
        );

        if (state.retryCount >= 2 && hasSuspiciousPatterns) {
          // Create user-friendly error message
          const userFriendlyError = createUserFriendlyErrorMessage(schemaValidationResult.issues, state.schemaContext);
          
          return {
            ...updatedState,
            errors: [...state.errors, userFriendlyError],
            progress: {
              ...updatedState.progress,
              currentState: 'failed',
              message: userFriendlyError
            },
            friendlyErrorMessage: userFriendlyError
          };
        }
        
        // If this is the first attempt with column issues, add feedback and try again
        if (state.retryCount < 2 && schemaValidationResult.issues.some(issue => issue.includes('Column'))) {
          // Add the current validation results to state for feedback in next attempt
          const validationResults = [...(state.validationResults || [])];
          validationResults[state.currentStep] = schemaValidationResult;
          
          // Create user-friendly error message for retry
          const userFriendlyError = createUserFriendlyErrorMessage(schemaValidationResult.issues, state.schemaContext);
          
          return {
            ...updatedState,
            retryCount: (state.retryCount || 0) + 1,
            validationResults,
            errors: [...state.errors, userFriendlyError],
            progress: {
              ...updatedState.progress,
              currentState: 'retrying',
              message: `Retrying query generation with schema feedback (${state.retryCount + 1}/${state.maxRetries})`
            },
          };
        }
      } else {
        logger.debug('Schema validation passed', {
          tablesFound: schemaValidationResult.tablesFound,
          columnsChecked: schemaValidationResult.columnsChecked
        });
      }
    }

    logger.debug('Query validation passed', {
      query: sqlQuery.query.substring(0, 100) + '...',
      currentStep: state.currentStep,
      detectedGranularity: {
        yearly: isYearlyRequest,
        monthly: isMonthlyRequest,
        weekly: isWeeklyRequest,
        daily: isDailyRequest
      },
      queryFormatting: {
        hasYearFormatting,
        hasMonthFormatting,
        hasWeekFormatting,
        hasInvalidWeekFormatting,
        hasDayFormatting,
        hasSeparateYearMonth
      }
    });

    const newQueries = [...state.sqlQueries];
    newQueries[state.currentStep] = sqlQuery;

    logger.debug('Generated SQL query', {
      currentStep: state.currentStep,
      query: sqlQuery.query,
      newQueriesLength: newQueries.length,
      explanation: sqlQuery.explanation
    });

    const result = {
      ...updatedState,
      sqlQueries: newQueries,
      messages: [...state.messages, ...messages, new AIMessage(response)],
      // Reset retry count on success
      retryCount: 0
    };

    logger.debug('Returning from generating query node', {
      currentStep: state.currentStep,
      sqlQueriesInResult: result.sqlQueries.length,
      resultSqlQueries: result.sqlQueries.map((q: SQLQuery, i: number) => ({ step: i, hasQuery: !!q }))
    });

    return result;
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
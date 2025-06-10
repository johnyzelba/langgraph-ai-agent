# Chart Generation with State Machine

The AI agent now includes an advanced chart generation capability powered by a sophisticated state machine built with LangGraph. This feature enables the agent to intelligently generate charts from SQL databases by understanding user requests, planning execution, generating optimized queries, and transforming data into Nivo-compatible chart formats.

## Overview

The chart generation system uses a multi-state workflow that:
1. Analyzes user requests to understand chart requirements
2. Retrieves relevant database schema information using RAG
3. Generates optimized SQL queries
4. Executes queries and validates results
5. Transforms data into Nivo chart format
6. Handles errors and retries intelligently

## Supported Chart Types

All Nivo chart types are supported:
- Line charts
- Bar charts
- Pie charts
- Scatter plots
- Heatmaps
- Radar charts
- Sankey diagrams
- Treemaps
- Funnel charts
- Calendar heatmaps
- Choropleth maps
- Network graphs

## State Machine Architecture

### States

1. **Planning** - Analyzes the user request and creates an execution plan
2. **Understanding Schema** - Retrieves relevant database schema using RAG
3. **Generating Query** - Creates optimized SQL queries based on requirements
4. **Executing Query** - Runs queries using the SQL MCP tool
5. **Validating Results** - Checks if query results match expectations
6. **Retry Query** - Regenerates queries if validation fails (max 3 retries)
7. **Transforming Data** - Converts results to Nivo chart format
8. **Clarifying** - Asks user for clarification when request is ambiguous
9. **Completed/Failed** - Terminal states

### Progress Tracking

The state machine provides real-time progress updates:
- Current state name
- Completion percentage
- Descriptive message

## Usage

### Basic Chart Request

```typescript
const response = await orchestrator.processRequest({
  userId: "user123",
  sessionId: "session456",
  message: "Show me a bar chart of sales by region for Q4 2023"
});

// Response includes:
// - message: Description of the chart
// - chartData: Nivo-compatible chart data
// - metadata: Progress updates, query details, etc.
```

### Handling Clarifications

When the request is ambiguous, the system will ask for clarification:

```typescript
const response = await orchestrator.processRequest({
  userId: "user123",
  sessionId: "session456",
  message: "Show me sales data"
});

// If clarification needed:
// response.clarificationNeeded = {
//   question: "What type of chart would you like?",
//   options: ["bar", "line", "pie"],
//   context: "Multiple chart types could work for sales data"
// }
```

### With Context

```typescript
const response = await orchestrator.processRequest({
  userId: "user123",
  sessionId: "session456",
  message: "Create a line chart showing monthly revenue trends",
  context: {
    role: "sales_analyst",
    metadata: {
      department: "sales",
      region: "north_america"
    }
  }
});
```

## Features

### Intelligent Query Planning

The system prefers single complex queries over multiple simple ones, leveraging SQL's capabilities for:
- Aggregations
- Joins
- Window functions
- Data sampling for large datasets

### Query Optimization

Each generated query includes:
- Optimization hints (index usage, etc.)
- Estimated row counts
- Clear column naming
- Appropriate result limiting

### Automatic Retries

If validation fails, the system will:
1. Analyze what went wrong
2. Regenerate the query with improvements
3. Retry up to 3 times
4. Provide clear error messages if all retries fail

### Data Validation

The validation step checks for:
- Correct data structure for chart type
- Sufficient data points
- Null/missing value handling
- Data type compatibility
- Proper aggregation levels

### Schema Context

The system uses RAG to retrieve relevant database schema information, including:
- Table structures
- Column types
- Relationships
- Indexes
- Common query patterns

## Configuration

Enable chart generation in the orchestrator:

```typescript
const orchestrator = new AgentOrchestrator(
  llmGateway,
  toolManager,
  memoryManager,
  {
    enableChartGeneration: true,
    // Other config...
  }
);
```

## Progress Callbacks

Monitor chart generation progress:

```typescript
const result = await runChartGeneration(
  userRequest,
  userId,
  sessionId,
  {
    llmGateway,
    toolManager,
    memoryManager,
    progressCallback: (progress) => {
      
    },
  }
);
```

## Error Handling

The system provides detailed error information:
- Query generation failures
- SQL execution errors
- Validation issues
- Timeout handling
- Network failures

## Best Practices

1. **Provide Clear Requests**: Include specific time ranges, metrics, and dimensions
2. **Use Schema Documentation**: Store schema descriptions in vector memory for better RAG retrieval
3. **Set Appropriate Timeouts**: Configure query timeouts based on your database performance
4. **Handle Large Datasets**: The system automatically applies sampling for performance
5. **Monitor Progress**: Use progress callbacks for user feedback in long-running operations

## Example Scenarios

### Sales Dashboard
```
"Create a bar chart showing top 10 products by revenue this month"
```

### Trend Analysis
```
"Show me a line chart of user growth over the last 12 months"
```

### Distribution Analysis
```
"Generate a pie chart of customer segments by region"
```

### Performance Metrics
```
"Display a heatmap of server response times by hour and day of week"
```

## Technical Details

The implementation uses:
- **LangGraph** for state machine orchestration
- **Zod** for runtime type validation
- **SQL MCP Tool** for database access
- **Nivo** chart format for visualization compatibility

The state machine ensures reliable execution with proper error handling, retries, and user feedback throughout the process. 
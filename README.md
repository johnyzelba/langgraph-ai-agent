# LangGraph AI Agent Server

A secure, modular monolithic Node.js server using LangChain.js to orchestrate a state-driven AI agent with Gemini 2.5 as its LLM. The server leverages LangGraph for advanced state management, supporting MCP-based tool use, short-term and long-term memory, RAG, role-based access control, robust telemetry and guardrails, and advanced chart generation with state machines.

## 🚀 Key Features

### Advanced State Machine Architecture with LangGraph
The server implements a sophisticated state machine architecture using LangGraph:
- **Declarative State Nodes**: Each node represents a specific processing step with clear inputs/outputs
- **Conditional Edge Routing**: Dynamic flow control based on request intent and processing results
- **State Persistence**: Complete state tracking across the entire request lifecycle
- **Error Recovery**: Built-in retry mechanisms with fallback paths
- **Progress Tracking**: Real-time updates as requests flow through the system

See [LangGraph Documentation](docs/langgraph-implementation.md) for details.

### AI-Based Intent Classification
The server uses advanced AI-powered intent classification instead of simple keyword matching:
- **Contextual Understanding**: Understands queries like "What's happening in tech today?" without explicit "search" keywords
- **Confidence Scoring**: Each decision includes a confidence score (0.0-1.0)
- **Smart Clarification**: Asks for clarification when intent is unclear
- **Prompt Enhancement**: Can suggest improved versions of user queries
- **Intelligent Routing**: Automatically determines whether to use tools, memory, or direct LLM response

See [Intent Classification Documentation](docs/intent-classification.md) for details.

### Advanced Chart Generation with State Machines
The server includes a sophisticated chart generation system powered by LangGraph state machines:
- **Multi-Step Workflow**: Intelligent planning, query generation, execution, validation, and data transformation
- **All Nivo Chart Types**: Support for line, bar, pie, scatter, heatmap, radar, sankey, and more
- **Automatic Retries**: Smart retry logic with query regeneration on validation failures
- **Progress Tracking**: Real-time progress updates throughout the generation process
- **Schema-Aware**: Uses RAG to understand database structure and optimize queries
- **Query Optimization**: Generates efficient SQL with proper indexing and aggregations

See [Chart Generation Documentation](docs/chart-generation.md) for details.

### Real-Time Streaming Response Architecture
The server implements a robust streaming architecture:
- **Server-Sent Events**: Efficient unidirectional streaming from server to client
- **Typed Event System**: Structured event format with progress, content, done, and error types
- **Node-Level Granularity**: Detailed progress updates from individual state machine nodes
- **Resilient Connections**: Automatic reconnection and error handling
- **Non-Blocking Operations**: Concurrent processing with non-interrupting updates

See [Streaming Architecture Documentation](docs/streaming-architecture.md) for details.

## 🏗️ Architecture Overview

### Core Components

1. **Agent Orchestrator** (`src/agent/orchestrator.ts`)
   - Central coordination engine
   - Intent classification and routing
   - Context building from memory and RAG
   - Request validation with Zod
   - Real-time streaming with SSE

2. **LangGraph State Machine** (`src/agent/chart-state-graph.ts`)
   - Declarative state node definitions
   - Conditional edge routing
   - State persistence and management
   - Progress tracking

3. **LLM Gateway** (`src/services/llm-gateway.ts`)
   - Primary: Google Gemini 2.5
   - Fallback: OpenAI GPT-4
   - Input sanitization to prevent prompt injection
   - Output filtering for hallucinations and sensitive data
   - Retry logic and streaming support

4. **State Machine Nodes** (`src/agent/nodes/`)
   - `routingNode`: Initial intent classification
   - `chattingNode`: Direct chat response generation
   - `planningNode`: Chart planning and requirement analysis
   - `understandingSchemaNode`: Database schema analysis
   - `generatingQueryNode`: SQL query generation
   - `executingQueryNode`: Safe query execution
   - `validatingResultsNode`: Result validation and retry decisions
   - `transformingDataNode`: Data transformation for visualization

5. **Tools System** (`src/tools/tool-manager.ts`)
   - MCP-compatible tool integration
   - Browser search tool
   - SQL query tool (read-only, sanitized)
   - Rate limiting per tool
   - Extensible tool registration

6. **Memory System** (`src/memory/memory-manager.ts`)
   - **Short-term**: Redis-based session memory
   - **Long-term**: Qdrant vector database with OpenAI embeddings
   - Role-based access filtering
   - TTL-based expiration

7. **Security**
   - JWT authentication with Auth0 support
   - Role-based access control (RBAC)
   - Rate limiting with Redis backend
   - Helmet.js security headers
   - CORS configuration

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- Redis 6+
- Qdrant (optional, for vector memory)
- Google Gemini API key
- OpenAI API key (optional, for fallback and embeddings)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd langgraph-ai-agent
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp env.example .env
```

4. Configure your `.env` file with required API keys and settings.

### Running the Server

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm run build
npm start
```

### Docker Setup (Optional)

```bash
# Start Redis and Qdrant
docker-compose up -d redis qdrant

# Build and run the application
docker build -t langgraph-agent .
docker run -p 3000:3000 --env-file .env langgraph-agent
```

## 📡 API Documentation

### Authentication

All endpoints (except `/health`) require JWT authentication:

```
Authorization: Bearer <jwt-token>
```

### Endpoints

#### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "development"
}
```

#### Chat with Agent
```http
POST /api/v1/agent/chat
Content-Type: application/json
X-Session-ID: <optional-session-id>

{
  "message": "Search for the latest AI news",
  "context": {
    "role": "developer",
    "metadata": {}
  },
  "stream": false
}
```

Response (non-streaming):
```json
{
  "message": "Here are the latest AI news...",
  "toolsUsed": ["browser_search"],
  "memoryContext": {
    "shortTerm": 5,
    "longTerm": 3
  },
  "metadata": {
    "duration": 1234,
    "decision": "tools"
  }
}
```

Response (streaming):
```
data: {"type":"progress","data":{"operation":"agent_flow","message":"Classifying your request...","currentState":"routing","percentage":5}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Building context...","currentState":"understanding_schema","percentage":20}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Generating SQL query...","currentState":"generating_query","percentage":30}}
data: {"type":"content","data":{"operation":"agent_flow","content":"Here are"}}
data: {"type":"content","data":{"operation":"agent_flow","content":" the latest"}}
data: {"type":"done","data":{"operation":"agent_flow","message":"Request completed"}}
```

#### Chart Generation Example
```http
POST /api/v1/agent/chat
Content-Type: application/json

{
  "message": "Create a bar chart showing top 10 products by revenue this month",
  "context": {
    "role": "analyst"
  },
  "stream": true
}
```

Response (streaming):
```
data: {"type":"progress","data":{"operation":"agent_flow","message":"Analyzing request...","currentState":"planning","percentage":10}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Understanding schema...","currentState":"understanding_schema","percentage":20}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Generating query...","currentState":"generating_query","percentage":40}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Executing query...","currentState":"executing_query","percentage":60}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Validating results...","currentState":"validating_results","percentage":80}}
data: {"type":"progress","data":{"operation":"agent_flow","message":"Transforming data...","currentState":"transforming_data","percentage":90}}
data: {"type":"done","data":{"operation":"agent_flow","message":"Chart ready","chartData":{"type":"bar","data":[...]}}}
```

#### Memory Statistics
```http
GET /api/v1/agent/memory/stats
```

Response:
```json
{
  "totalSessions": 5,
  "totalMessages": 123,
  "vectorDocuments": 456
}
```

#### Clear Session Memory
```http
DELETE /api/v1/agent/memory/session/:sessionId
```

#### Store Vector Document (Admin Only)
```http
POST /api/v1/agent/memory/vector
Content-Type: application/json

{
  "content": "Document content to store...",
  "metadata": {
    "type": "policy",
    "category": "security"
  }
}
```

#### List Available Tools
```http
GET /api/v1/agent/tools
```

Response:
```json
{
  "tools": [
    {
      "name": "browser_search",
      "description": "Search the web for information"
    },
    {
      "name": "sql_query",
      "description": "Execute read-only SQL queries"
    }
  ]
}
```

## 🔧 Configuration

### Environment Variables

See `env.example` for all available configuration options. Key variables:

- `GOOGLE_GENAI_API_KEY`: Required for Gemini 2.5
- `OPENAI_API_KEY`: Optional, for fallback and embeddings
- `REDIS_*`: Redis connection settings
- `QDRANT_*`: Qdrant vector database settings
- `AUTH0_*`: Auth0 configuration
- `JWT_SECRET`: Secret for JWT signing
- `MCP_*_URL`: URLs for MCP tool servers

### Extending the System

#### Adding New State Nodes

1. Create a new node in `src/agent/nodes/`:
```typescript
export async function myCustomNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  // Implementation
  return {
    // Updated state properties
  };
}
```

2. Register in `chart-state-graph.ts`:
```typescript
workflow.addNode('my_custom', async (state: AgentState) => 
  await myCustomNode(state, deps)
);
```

3. Add edge routing:
```typescript
workflow.addConditionalEdges(
  'previous_node',
  (state: AgentState) => {
    if (condition) return 'my_custom';
    return 'other_node';
  },
  {
    my_custom: 'my_custom',
    other_node: 'other_node',
  }
);
```

#### Adding New Tools

1. Create a new tool class extending `MCPTool`:
```typescript
class MyCustomTool extends MCPTool {
  name = 'my_tool';
  description = 'My custom tool';
  
  async _call(input: string): Promise<string> {
    // Implementation
  }
}
```

2. Register in `ToolManager`:
```typescript
toolManager.registerTool('my_tool', new MyCustomTool());
```

#### Custom Memory Stores

Implement the memory interface and inject into `MemoryManager`.

#### Adding Guardrails

Extend `LLMGateway.sanitizeInput()` and `filterResponse()` methods.

## 🔒 Security Considerations

1. **Input Sanitization**: All user inputs are sanitized before LLM processing
2. **SQL Injection Prevention**: Only SELECT queries allowed, dangerous patterns blocked
3. **Rate Limiting**: Per-user and per-IP rate limiting
4. **Authentication**: JWT-based with optional Auth0 integration
5. **RBAC**: Role-based access control for sensitive operations
6. **Output Filtering**: Sensitive data patterns are redacted from responses

## 📊 Monitoring & Observability

The server includes comprehensive logging using Winston:

- Structured JSON logs
- Request/response tracking
- Performance metrics
- Error tracking with stack traces
- State machine progress tracking

To enable telemetry, set `ENABLE_TELEMETRY=true` and configure `TELEMETRY_ENDPOINT`.

## 🧪 Testing

```bash
# Run tests
npm test

# Run linting
npm run lint

# Type checking
npm run typecheck
```

## 📝 License

[Your License Here]

## 🤝 Contributing

[Contributing Guidelines] 
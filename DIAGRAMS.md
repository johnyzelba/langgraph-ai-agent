# LangGraph AI Agent Server - Architecture Diagrams

This document describes the system architecture and request flow diagrams for the LangGraph AI Agent Server.

## 📊 Diagram Files

Three draw.io (diagrams.net) files have been created:

1. **system-architecture.drawio** - Shows the overall system architecture with LangGraph integration
2. **request-flow.drawio** - Shows how a chat request flows through the system
3. **chart-generation-flow.drawio** - Details the state machine flow for chart generation

## 🖼️ How to View the Diagrams

### Online (Recommended)
1. Go to [diagrams.net](https://app.diagrams.net/)
2. Click "Open Existing Diagram"
3. Select the `.drawio` file from your local system
4. The diagram will open in the browser editor

### VS Code
1. Install the "Draw.io Integration" extension
2. Open the `.drawio` file directly in VS Code
3. Edit and export as needed

## 🏗️ System Architecture Diagram

The system architecture diagram illustrates the complete structure of the LangGraph AI Agent Server:

### Layers

1. **Client Layer**
   - External client applications that interact with the API

2. **API Gateway**
   - Express server handling all HTTP requests

3. **Middleware Layer**
   - **Auth Middleware**: JWT/Auth0 authentication
   - **Rate Limiter**: Redis-backed rate limiting
   - **CORS**: Cross-origin resource sharing
   - **Helmet**: Security headers
   - **Winston Logger**: Structured logging

4. **Agent Orchestrator**
   - Central coordinator for request processing
   - Handles streaming responses (SSE)
   - Manages message history and state

5. **LangGraph State Machine**
   - Implements a directed graph of processing nodes
   - Routing node: Determines request intent
   - Planning node: Analyzes chart requirements
   - Query generation: Creates SQL queries
   - Validation: Ensures result quality
   - Transformation: Converts to visualization formats

6. **Core Services**
   - **LLM Gateway**: Manages LLM connections
   - **Tool Manager**: Handles MCP tools
   - **Memory Manager**: Manages short and long-term memory

7. **External Services**
   - **Google Gemini 2.5**: Primary LLM
   - **OpenAI GPT-4**: Fallback LLM
   - **Redis**: Short-term memory & rate limiting
   - **Qdrant**: Vector database for long-term memory
   - **MCP Tools**: Browser search and SQL query tools

### Key Connections
- The orchestrator triggers the LangGraph state machine
- Each state node can interact with core services
- Streaming architecture provides real-time updates throughout processing
- The state machine maintains complete state context

## 🔄 Request Flow Diagram

The request flow diagram shows the detailed journey of a chat request through the system using swimlanes:

### Swimlanes

1. **Client**: User interactions
2. **API Layer**: Express server and response handling
3. **Middleware**: Authentication and rate limiting
4. **Orchestrator**: Core business logic and state machine
5. **Services**: Internal service calls
6. **State Machine Nodes**: Individual processing nodes

### Flow Stages

1. **Request Reception**
   - Client sends chat request
   - Express server receives it

2. **Security Checks**
   - JWT verification (401 if invalid)
   - Rate limit check (429 if exceeded)

3. **Intent Classification**
   - First state node determines request intent (chat vs. chart)
   - Routes to appropriate processing path

4. **Processing Paths**
   - **Chat Path**: Direct LLM response with context
   - **Chart Path**: Multi-step state machine processing

5. **Chart Generation Process**
   - Planning: Analyze request and determine chart type
   - Schema Analysis: Understand data structure
   - Query Generation: Create SQL queries
   - Execution: Run queries with safety constraints
   - Validation: Verify results quality
   - Transformation: Convert to visualization format

6. **Response Handling**
   - Store exchange in memory
   - Determine response format:
     - **Streaming**: Server-Sent Events (SSE) with progress updates
     - **Standard**: JSON response

### Error Paths
- Authentication failures (401)
- Rate limit exceeded (429)
- LLM errors with fallback
- Query validation failures with retry logic

## 📊 Chart Generation State Machine Diagram

The chart generation diagram shows the detailed state machine for generating chart visualizations:

### States

1. **Planning State**
   - Analyzes user request
   - Determines chart type and requirements
   - Checks if clarification is needed

2. **Schema Understanding State**
   - Retrieves database schema information
   - Identifies relevant tables and relationships
   - Builds context for query generation

3. **Query Generation State**
   - Creates optimized SQL queries
   - Handles aggregations and filtering
   - Manages multi-step query plans

4. **Execution State**
   - Runs queries with safety constraints
   - Captures execution metrics
   - Handles errors gracefully

5. **Validation State**
   - Checks result structure and quality
   - Verifies against requirements
   - Determines if retry is needed

6. **Transformation State**
   - Converts data to visualization format
   - Applies styling and configuration
   - Prepares final response

### Control Flow

- **Decision Points**: Validation, retry checks, clarification needs
- **Retry Logic**: Automatically improves queries on failure
- **Progress Tracking**: Each state reports progress percentage
- **Error Handling**: Graceful degradation and user-friendly messages

## 🎨 Color Coding

### System Architecture
- **Gray**: Client layer
- **Blue**: API/Core infrastructure
- **Yellow**: Middleware
- **Purple**: Core business logic
- **Green**: Internal services
- **Red**: External dependencies
- **Light Blue**: LangGraph components

### Request Flow
- **Green circles**: Start/End points
- **Red boxes**: Error states
- **Diamonds**: Decision points
- **Light Blue**: LangGraph state nodes
- **Dashed lines**: Optional/fallback paths

### Chart Generation Flow
- **Light Blue**: Processing states
- **Yellow**: Decision points
- **Green**: Terminal success states
- **Red**: Terminal error states

## 📝 Diagram Customization

All diagrams can be edited in draw.io to:
- Add new components or services
- Modify the flow for different use cases
- Export to various formats (PNG, SVG, PDF)
- Embed in documentation

## 🔧 Updating Diagrams

When the system architecture changes:
1. Open the relevant `.drawio` file
2. Make necessary modifications
3. Update this documentation if needed
4. Export updated images for documentation

## 📤 Exporting

To export diagrams for documentation:
1. Open in draw.io
2. File → Export As
3. Choose format (PNG recommended for docs)
4. Set export settings:
   - Border: 10
   - Transparent background: No
   - Resolution: 300 DPI for print, 150 DPI for web 
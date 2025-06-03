# LangGraph AI Agent Server - Architecture Diagrams

This document describes the system architecture and request flow diagrams for the LangGraph AI Agent Server.

## 📊 Diagram Files

Two draw.io (diagrams.net) files have been created:

1. **system-architecture.drawio** - Shows the overall system architecture
2. **request-flow.drawio** - Shows how a chat request flows through the system

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

4. **Core Components**
   - **Agent Orchestrator**: Central coordinator
   - **LLM Gateway**: Manages LLM connections
   - **Tool Manager**: Handles MCP tools
   - **Memory Manager**: Manages short and long-term memory
   - **API Routes**: RESTful endpoints

5. **External Services**
   - **Google Gemini 2.5**: Primary LLM
   - **OpenAI GPT-4**: Fallback LLM
   - **Redis**: Short-term memory & rate limiting
   - **Qdrant**: Vector database for long-term memory
   - **MCP Tools**: Browser search and SQL query tools

### Key Connections
- The orchestrator is the central hub connecting all services
- Fallback paths (dashed lines) show resilience patterns
- Rate limiter shares Redis with memory manager

## 🔄 Request Flow Diagram

The request flow diagram shows the detailed journey of a chat request through the system using swimlanes:

### Swimlanes

1. **Client**: User interactions
2. **API Layer**: Express server and response handling
3. **Middleware**: Authentication and rate limiting
4. **Orchestrator**: Core business logic
5. **Services**: Internal service calls
6. **External**: Third-party API calls

### Flow Stages

1. **Request Reception**
   - Client sends chat request
   - Express server receives it

2. **Security Checks**
   - JWT verification (401 if invalid)
   - Rate limit check (429 if exceeded)

3. **Request Processing**
   - Request validation
   - Context building from memory
   - Query short-term memory (Redis)
   - Query vector memory (Qdrant) if needed

4. **Decision Making**
   - Decision engine determines path:
     - **Tools Path**: Execute MCP tools (browser/SQL)
     - **LLM Path**: Direct LLM query

5. **LLM Processing**
   - Prepare prompt with context
   - Call Gemini 2.5
   - Fallback to OpenAI if needed
   - Filter response for safety

6. **Response Handling**
   - Store exchange in memory
   - Determine response format:
     - **Streaming**: Server-Sent Events (SSE)
     - **Standard**: JSON response

### Error Paths
- Red paths show error flows (401, 429)
- Dashed lines indicate fallback options

## 🎨 Color Coding

### System Architecture
- **Gray**: Client layer
- **Blue**: API/Core infrastructure
- **Yellow**: Middleware
- **Purple**: Core business logic
- **Green**: Internal services
- **Red**: External dependencies
- **Orange**: Supporting services

### Request Flow
- **Green circles**: Start/End points
- **Red boxes**: Error states
- **Diamonds**: Decision points
- **Dashed lines**: Optional/fallback paths

## 📝 Diagram Customization

Both diagrams can be edited in draw.io to:
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
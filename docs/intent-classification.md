# AI-Based Intent Classification

## Overview

The LangGraph AI Agent Server now uses an advanced AI-based intent classification system instead of simple keyword matching. This provides more accurate and context-aware decision making.

## How It Works

### 1. **AI-Powered Classification**

The `IntentClassifier` uses the LLM to analyze user messages and determine:
- **Action Type**: `tools`, `memory`, `direct`, or `clarify`
- **Required Tools**: Which specific tools are needed
- **Confidence Score**: How certain the system is (0.0 to 1.0)
- **Reasoning**: Why this decision was made
- **Prompt Enhancement**: Suggested improvements to the query

### 2. **Few-Shot Learning**

The classifier uses examples to guide its decisions:
```typescript
{
  input: "Search for the latest news about AI",
  output: {
    action: "tools",
    tools: ["browser"],
    reasoning: "User explicitly wants to search for current information",
    confidence: 0.95
  }
}
```

### 3. **Contextual Understanding**

The classifier considers:
- Previous conversation context
- Available tools
- User role
- Conversation length

## Improvements Over Keyword Matching

### Old Approach (Keyword-Based)
```typescript
// Simple keyword detection
if (message.includes('search') || message.includes('web')) {
  return { action: 'tools', tools: ['browser'] };
}
```

**Limitations:**
- ❌ Misses queries like "What's happening in tech today?"
- ❌ Can't understand context or nuance
- ❌ No confidence scoring
- ❌ Can't ask for clarification

### New Approach (AI-Based)

**Example Classifications:**

| User Message | Classification | Confidence | Reasoning |
|--------------|----------------|------------|-----------|
| "What's happening in tech today?" | `tools: browser` | 0.88 | Temporal indicator "today" suggests current information needed |
| "Show me customer data" | `tools: sql` | 0.85 | Implicit database query without SQL keywords |
| "That thing we talked about earlier" | `memory` | 0.82 | Reference to previous conversation |
| "Help" | `clarify` | 0.45 | Too vague to determine intent |
| "Explain how DNS works" | `direct` | 0.92 | General knowledge question |

## Features

### 1. **Confidence Thresholds**
```typescript
minConfidenceThreshold: 0.7 // Configurable
```
- High confidence (>0.7): Execute the classified action
- Low confidence (<0.7): Ask for clarification

### 2. **Intelligent Clarification**
When confidence is low:
```
User: "Do the thing"
Assistant: "I'm not quite sure what you'd like me to do (confidence: 0.42). 
Could you please clarify? For example:
- Search for something specific on the web?
- Query data from the database?
- Discuss something from our previous conversation?"
```

### 3. **Prompt Enhancement**
The classifier can suggest improved queries:
```json
{
  "action": "tools",
  "tools": ["browser"],
  "suggestedPromptEnhancement": "Search for the latest AI news and developments from the past week",
  "confidence": 0.91
}
```

### 4. **Caching**
- Results are cached for 1 hour
- LRU cache with 1000 entry limit
- Reduces API calls for repeated queries

### 5. **Fallback Mechanism**
If AI classification fails, the system falls back to rule-based classification with lower confidence scores.

## Configuration

### In Orchestrator
```typescript
const orchestrator = new AgentOrchestrator(
  llmGateway,
  toolManager,
  memoryManager,
  {
    minConfidenceThreshold: 0.7, // Adjust based on needs
  }
);
```

### Custom Examples
You can modify `CLASSIFICATION_EXAMPLES` in `intent-classifier.ts` to add domain-specific examples.

## Monitoring

The system logs detailed classification results:
```
INFO: Intent classification result {
  message: "Find recent papers on...",
  action: "tools",
  tools: ["browser"],
  confidence: 0.88,
  reasoning: "Requires searching for recent information and analysis"
}
```

## Benefits

1. **Better User Experience**: Understands natural language without requiring specific keywords
2. **Reduced Errors**: Confidence scoring prevents incorrect actions
3. **Learning Capability**: Can be improved by adding more examples
4. **Transparency**: Provides reasoning for decisions
5. **Flexibility**: Handles ambiguous requests gracefully

## Future Enhancements

1. **User Feedback Loop**: Learn from user corrections
2. **Domain-Specific Models**: Fine-tuned classifiers for specific use cases
3. **Multi-Language Support**: Classification in multiple languages
4. **Intent Chaining**: Detect multiple intents in one message
5. **Personalization**: Learn user preferences over time 
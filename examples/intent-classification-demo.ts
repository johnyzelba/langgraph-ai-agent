/**
 * Intent Classification Demo
 * 
 * This file demonstrates the improvements of AI-based intent classification
 * over simple keyword matching.
 */

// Example user messages that would have failed with keyword matching
// but work correctly with AI-based classification:

const testCases = [
  {
    message: "What's happening in the tech world today?",
    oldResult: {
      action: "direct", // No "search" keyword found
      confidence: "N/A"
    },
    newResult: {
      action: "tools",
      tools: ["browser"],
      confidence: 0.88,
      reasoning: "Temporal indicator 'today' and topic 'tech world' suggest need for current information"
    }
  },
  
  {
    message: "I need information about our top customers",
    oldResult: {
      action: "direct", // No "query" or "database" keyword
      confidence: "N/A"
    },
    newResult: {
      action: "tools",
      tools: ["sql"],
      confidence: 0.85,
      reasoning: "Request for customer information implies database query"
    }
  },
  
  {
    message: "Can you help me with that thing we discussed?",
    oldResult: {
      action: "direct", // No "earlier" or "previous" keyword
      confidence: "N/A"
    },
    newResult: {
      action: "memory",
      confidence: 0.82,
      reasoning: "Reference to 'that thing we discussed' indicates need for conversation history"
    }
  },
  
  {
    message: "Show me the latest AI developments and analyze their impact",
    oldResult: {
      action: "tools",
      tools: ["browser"], // Only catches "latest", misses analysis need
      confidence: "N/A"
    },
    newResult: {
      action: "tools",
      tools: ["browser"],
      confidence: 0.91,
      reasoning: "Requires both searching for recent information and analytical processing",
      suggestedPromptEnhancement: "Search for the latest AI developments from the past week and provide an analysis of their potential impact on the industry"
    }
  },
  
  {
    message: "Help",
    oldResult: {
      action: "direct", // Too short, defaults to direct
      confidence: "N/A"
    },
    newResult: {
      action: "clarify",
      confidence: 0.45,
      reasoning: "Message is too vague to determine specific intent"
    }
  },
  
  {
    message: "What are the sales figures?",
    oldResult: {
      action: "direct", // No SQL keywords
      confidence: "N/A"
    },
    newResult: {
      action: "clarify",
      confidence: 0.68,
      reasoning: "Unclear whether this requires database query or general discussion. Need time period and specifics."
    }
  }
];

// Example API response with the new system
const exampleApiResponse = {
  message: "Here are the latest AI developments from the past week...",
  toolsUsed: ["browser"],
  memoryContext: {
    shortTerm: 2,
    longTerm: 5
  },
  metadata: {
    duration: 1234,
    decision: "tools",
    confidence: 0.91,
    reasoning: "Requires both searching for recent information and analytical processing"
  }
};

// Configuration example
const configExample = {
  minConfidenceThreshold: 0.7, // Below this triggers clarification
  
  // Can be adjusted based on use case:
  // - Higher (0.8+) for critical operations
  // - Lower (0.6) for more flexible interactions
};




testCases.forEach((test, index) => {
  
  
  
  
});






 
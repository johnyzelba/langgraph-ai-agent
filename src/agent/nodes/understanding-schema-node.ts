import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { createLogger } from '../../utils/logger';

const logger = createLogger('understanding-schema-node');

// Understanding schema node - uses RAG to get relevant schema information
export async function understandingSchemaNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Understanding schema node executing');
  
  const updatedState = updateProgress(
    state, 
    'understanding_schema', 
    'Retrieving relevant database schema information...',
    deps.progressCallback
  );

  try {
    // Extract relevant tables from query plan
    const relevantTables = state.queryPlan?.flatMap(q => q.tables || []) || [];
    logger.debug('Schema query details', { 
      relevantTables, 
      userRequest: state.userRequest,
      hasQueryPlan: !!state.queryPlan 
    });

    let schemaContext: any[] = [];

    // Strategy 1: Query with specific tables if available
    if (relevantTables.length > 0) {
      const tableQuery = `Database schema tables: ${relevantTables.join(', ')}`;
      logger.debug('Trying table-specific query', { query: tableQuery });
      
      schemaContext = await deps.memoryManager.queryVectorMemory(tableQuery, {
        filter: { type: 'technical_documentation' },
        limit: 5,
      });
      
      logger.debug('Table-specific query results', { resultCount: schemaContext.length });
    }

    // Strategy 2: Fallback to broader schema query if no results
    if (schemaContext.length === 0) {
      const broadQuery = `Database schema documentation tables columns relationships ${state.userRequest}`;
      logger.debug('Trying broad schema query', { query: broadQuery });
      
      schemaContext = await deps.memoryManager.queryVectorMemory(broadQuery, {
        filter: { type: 'technical_documentation' },
        limit: 5,
      });
      
      logger.debug('Broad schema query results', { resultCount: schemaContext.length });
    }

    // Strategy 3: Try without filter if still no results
    if (schemaContext.length === 0) {
      const noFilterQuery = `database schema tables columns`;
      logger.debug('Trying query without filter', { query: noFilterQuery });
      
      schemaContext = await deps.memoryManager.queryVectorMemory(noFilterQuery, {
        limit: 10,
      });
      
      logger.debug('No-filter query results', { resultCount: schemaContext.length });
      
      // Filter results manually to find schema-related content
      schemaContext = schemaContext.filter(doc => 
        doc.pageContent?.toLowerCase().includes('table') ||
        doc.pageContent?.toLowerCase().includes('schema') ||
        doc.pageContent?.toLowerCase().includes('column')
      );
      
      logger.debug('Filtered schema results', { resultCount: schemaContext.length });
    }

    // Strategy 4: Try with different metadata filters
    if (schemaContext.length === 0) {
      logger.debug('Trying alternative metadata filters');
      
      // Try common schema metadata variations
      const metadataVariations = [
        { type: 'technical_documentation' },
        { category: 'system_documentation' },
        { tags: 'schema' },
        {}  // No filter as final fallback
      ];

      for (const metadata of metadataVariations) {
        const query = 'database schema documentation';
        logger.debug('Trying metadata variation', { metadata, query });
        
        const results = await deps.memoryManager.queryVectorMemory(query, {
          filter: Object.keys(metadata).length > 0 ? metadata : undefined,
          limit: 5,
        });
        
        if (results.length > 0) {
          schemaContext = results;
          logger.debug('Found results with metadata variation', { 
            metadata, 
            resultCount: results.length 
          });
          break;
        }
      }
    }

    const schemaText = schemaContext.map(doc => doc.pageContent).join('\n\n');
    
    logger.debug('Final schema context', { 
      contextLength: schemaText.length,
      hasContext: schemaText.length > 0,
      documentCount: schemaContext.length
    });

    // DETAILED SCHEMA RETRIEVAL LOGGING
    if (schemaContext.length > 0) {
      logger.debug('Schema documents retrieved', {
        documentCount: schemaContext.length,
        documents: schemaContext.map((doc, i) => ({
          index: i,
          contentLength: doc.pageContent.length,
          contentPreview: doc.pageContent.substring(0, 500) + '...',
          metadata: doc.metadata,
          hasOrderDetails: doc.pageContent.includes('Order Details'),
          hasEntityID: doc.pageContent.includes('ID'),
          hasOrders: doc.pageContent.includes('Orders'),
          hasProducts: doc.pageContent.includes('Products')
        }))
      });
      
      logger.debug('Full schema text being passed to LLM', {
        fullSchemaText: schemaText.substring(0, 2000) + (schemaText.length > 2000 ? '... (truncated)' : ''),
        totalLength: schemaText.length
      });
    } else {
      logger.warn('No schema context found despite multiple query strategies');
    }

    return {
      ...updatedState,
      userRequest: state.userRequest,
      schemaContext: schemaText,
    };
  } catch (error) {
    logger.error('Schema understanding failed', { error });
    // Continue without schema context - not critical
    return {
      ...updatedState,
      userRequest: state.userRequest,
      schemaContext: '',
    };
  }
} 
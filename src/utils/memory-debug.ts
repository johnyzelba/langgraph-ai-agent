import { createLogger } from './logger';

const logger = createLogger('memory-debug');

/**
 * Debug utility to inspect what documents are stored in vector memory
 * This helps troubleshoot why queries might not be finding expected documents
 */
export class MemoryDebugger {
  /**
   * Attempts to find documents using various query strategies
   * @param memoryManager - The memory manager instance
   * @param searchTerm - The term to search for
   * @returns Debug information about the search results
   */
  static async debugVectorSearch(memoryManager: any, searchTerm: string) {
    logger.info('Starting vector search debug', { searchTerm });

    const debugResults = {
      searchTerm,
      strategies: [] as any[],
      totalDocumentsFound: 0,
      recommendations: [] as string[]
    };

    // Strategy 1: Basic search without filters
    try {
      const basicResults = await memoryManager.queryVectorMemory(searchTerm, { limit: 10 });
      debugResults.strategies.push({
        name: 'Basic search (no filter)',
        query: searchTerm,
        filter: null,
        resultCount: basicResults.length,
        sampleContent: basicResults.slice(0, 2).map((doc: any) => ({
          preview: doc.pageContent?.substring(0, 200) + '...',
          metadata: doc.metadata
        }))
      });
      debugResults.totalDocumentsFound += basicResults.length;
    } catch (error) {
      debugResults.strategies.push({
        name: 'Basic search (no filter)',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Strategy 2: Search with common metadata filters
    const commonFilters = [
      { type: 'schema' },
      { category: 'schema' },
      { docType: 'schema' },
      { source: 'database' },
      { type: 'document' }
    ];

    for (const filter of commonFilters) {
      try {
        const results = await memoryManager.queryVectorMemory(searchTerm, { 
          filter, 
          limit: 5 
        });
        
        debugResults.strategies.push({
          name: `Filtered search`,
          query: searchTerm,
          filter,
          resultCount: results.length,
          sampleContent: results.slice(0, 1).map((doc: any) => ({
            preview: doc.pageContent?.substring(0, 200) + '...',
            metadata: doc.metadata
          }))
        });
        
        if (results.length > 0) {
          debugResults.totalDocumentsFound += results.length;
        }
      } catch (error) {
        debugResults.strategies.push({
          name: `Filtered search (${JSON.stringify(filter)})`,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Strategy 3: Try different query terms
    const alternativeQueries = [
      'database',
      'table',
      'schema',
      'documentation',
      'columns',
      'relationships'
    ];

    for (const altQuery of alternativeQueries) {
      try {
        const results = await memoryManager.queryVectorMemory(altQuery, { limit: 3 });
        if (results.length > 0) {
          debugResults.strategies.push({
            name: `Alternative query`,
            query: altQuery,
            filter: null,
            resultCount: results.length,
            sampleContent: results.slice(0, 1).map((doc: any) => ({
              preview: doc.pageContent?.substring(0, 200) + '...',
              metadata: doc.metadata
            }))
          });
        }
      } catch (error) {
        // Ignore errors for alternative queries
      }
    }

    // Generate recommendations
    if (debugResults.totalDocumentsFound === 0) {
      debugResults.recommendations.push(
        'No documents found with any strategy. Check if documents are properly stored.',
        'Verify the memory manager is connected to the correct vector store.',
        'Check if the embedding model is working correctly.'
      );
    } else {
      const successfulStrategies = debugResults.strategies.filter(s => s.resultCount > 0);
      if (successfulStrategies.length > 0) {
        debugResults.recommendations.push(
          `Found documents with: ${successfulStrategies.map(s => s.name).join(', ')}`,
          'Check the metadata structure of successful results to optimize queries.'
        );
      }
    }

    logger.info('Vector search debug completed', debugResults);
    return debugResults;
  }

  /**
   * Analyzes the metadata structure of stored documents
   * @param memoryManager - The memory manager instance
   * @returns Analysis of document metadata patterns
   */
  static async analyzeDocumentMetadata(memoryManager: any) {
    logger.info('Starting document metadata analysis');

    try {
      // Get a sample of documents without any filters
      const sampleDocs = await memoryManager.queryVectorMemory('', { limit: 20 });
      
      const metadataAnalysis = {
        totalSampled: sampleDocs.length,
        metadataKeys: new Set<string>(),
        metadataPatterns: {} as Record<string, any[]>,
        recommendations: [] as string[]
      };

      // Analyze metadata patterns
      sampleDocs.forEach((doc: any) => {
        if (doc.metadata) {
          Object.keys(doc.metadata).forEach(key => {
            metadataAnalysis.metadataKeys.add(key);
            
            if (!metadataAnalysis.metadataPatterns[key]) {
              metadataAnalysis.metadataPatterns[key] = [];
            }
            
            const value = doc.metadata[key];
            if (!metadataAnalysis.metadataPatterns[key].includes(value)) {
              metadataAnalysis.metadataPatterns[key].push(value);
            }
          });
        }
      });

      // Generate recommendations
      if (metadataAnalysis.metadataKeys.size === 0) {
        metadataAnalysis.recommendations.push(
          'No metadata found in documents. Consider adding metadata when storing documents.'
        );
      } else {
        metadataAnalysis.recommendations.push(
          `Found metadata keys: ${Array.from(metadataAnalysis.metadataKeys).join(', ')}`,
          'Use these keys for filtering in vector queries.'
        );
      }

      logger.info('Document metadata analysis completed', {
        totalKeys: metadataAnalysis.metadataKeys.size,
        patterns: metadataAnalysis.metadataPatterns
      });

      return metadataAnalysis;
    } catch (error) {
      logger.error('Failed to analyze document metadata', { error });
      return {
        error: error instanceof Error ? error.message : String(error),
        recommendations: ['Check if the memory manager is properly initialized.']
      };
    }
  }
} 
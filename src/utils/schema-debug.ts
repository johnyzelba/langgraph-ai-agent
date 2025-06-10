import { MemoryManager } from '../memory/memory-manager';
import { createLogger } from './logger';

const logger = createLogger('schema-debug');

/**
 * Debug utility to check and fix schema document metadata
 */
export class SchemaDebugger {
  /**
   * Check what documents exist and their metadata
   */
  static async inspectStoredDocuments(memoryManager: MemoryManager) {
    logger.info('Inspecting stored documents...');
    
    try {
      // Query without any filters to get all documents
      const allDocs = await memoryManager.queryVectorMemory('', { limit: 20 });
      
      logger.info('Found documents', { count: allDocs.length });
      
      allDocs.forEach((doc, index) => {
        logger.info(`Document ${index + 1}`, {
          contentPreview: doc.pageContent.substring(0, 100) + '...',
          contentLength: doc.pageContent.length,
          metadata: doc.metadata
        });
      });
      
      // Look for schema-like documents
      const schemaDocs = allDocs.filter(doc => 
        doc.pageContent.toLowerCase().includes('table') ||
        doc.pageContent.toLowerCase().includes('schema') ||
        doc.pageContent.toLowerCase().includes('database')
      );
      
      logger.info('Schema-like documents found', { count: schemaDocs.length });
      
      return {
        totalDocuments: allDocs.length,
        schemaDocuments: schemaDocs.length,
        documents: allDocs.map(doc => ({
          contentLength: doc.pageContent.length,
          metadata: doc.metadata,
          hasSchemaKeywords: doc.pageContent.toLowerCase().includes('table')
        }))
      };
    } catch (error) {
      logger.error('Failed to inspect documents', { error });
      return null;
    }
  }
  
  /**
   * Re-store the schema document with correct metadata
   */
  static async fixSchemaMetadata(
    memoryManager: MemoryManager, 
    schemaContent: string
  ) {
    logger.info('Storing schema document with correct metadata...');
    
    try {
      await memoryManager.storeVectorMemory(schemaContent, {
        type: 'schema',
        category: 'database',
        source: 'schema_documentation',
        timestamp: Date.now(),
        description: 'Database schema documentation with table structures and relationships'
      });
      
      logger.info('Schema document stored successfully with metadata');
      
      // Verify it can be found with filters
      const testQuery = await memoryManager.queryVectorMemory('database schema', {
        filter: { type: 'schema' },
        limit: 1
      });
      
      logger.info('Verification query result', { 
        found: testQuery.length > 0,
        resultCount: testQuery.length 
      });
      
      return testQuery.length > 0;
    } catch (error) {
      logger.error('Failed to fix schema metadata', { error });
      return false;
    }
  }
} 
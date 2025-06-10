import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { analyzeDataStructure } from '../utils/chart-data-analysis';
import { generateTransformationInstructions, executeTransformation } from '../utils/chart-transformation';
import { preprocessChartData } from '../../utils/chart-data-processor';
import { createLogger } from '../../utils/logger';

const logger = createLogger('transforming-data-node');

// Transforming data node - converts query results to chart format using instruction-based approach
export async function transformingDataNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Transforming data node executing with instruction-based approach');
  
  const updatedState = updateProgress(
    state, 
    'transforming_data', 
    'Analyzing data structure and generating transformation instructions...',
    deps.progressCallback
  );

  try {
    // Step 1: Use existing preprocessChartData to get processedData
    const { analysis, template, processedData } = preprocessChartData(state.queryResults, state.chartType ?? '');
    
    logger.debug('Preprocessed data analysis', {
      dataStructure: analysis.dataStructure,
      totalRows: analysis.totalRows,
      uniqueEntities: analysis.uniqueEntities,
      processedDataType: processedData.type,
      hasSeriesData: !!processedData.seriesData
    });

    // Step 2: Analyze the data structure generically
    const dataMetadata = analyzeDataStructure(processedData);
    
    logger.debug('Generic data structure analysis', {
      type: dataMetadata.type,
      totalRows: dataMetadata.totalRows,
      fieldsCount: dataMetadata.fields.length,
      fields: dataMetadata.fields.map(f => ({ name: f.name, type: f.type, role: f.role })),
      relationshipsCount: dataMetadata.relationships.length
    });

    // Step 3: Generate transformation instructions using LLM (with sample data only)
    const instructions = await generateTransformationInstructions(
      dataMetadata,
      state.chartType ?? '',
      deps
    );
    
    logger.debug('Transformation instructions', {
      fieldMappings: instructions.fieldMappings,
      aggregationsCount: instructions.aggregations.length,
      groupingsCount: instructions.groupings.length,
      filtersCount: instructions.filters.length,
      sortingCount: instructions.sorting.length
    });

    // Step 4: Execute transformation using the full dataset
    const chartData = executeTransformation(dataMetadata, instructions, state.chartType ?? '');
    
    logger.info('Transformation completed', {
      chartType: chartData.type,
      dataLength: Array.isArray(chartData.data) ? chartData.data.length : 'non-array',
      title: chartData.title
    });

    return {
      ...updatedState,
      finalChartData: chartData,
      messages: [...state.messages],
    };
  } catch (error) {
    logger.error('Data transformation failed', { error });
    return {
      ...updatedState,
      errors: [...state.errors, `Data transformation failed: ${error instanceof Error ? error.message : String(error)}`],
      progress: {
        ...updatedState.progress,
        currentState: 'failed',
      },
    };
  }
} 
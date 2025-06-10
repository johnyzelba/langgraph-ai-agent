export interface DataAnalysis {
  totalRows: number;
  columns: string[];
  uniqueEntities: any[];
  entityColumn: string;
  timeColumn?: string;
  valueColumns: string[];
  dataStructure: 'single-entity' | 'multi-entity' | 'time-series' | 'multi-entity-time-series';
  groupedData?: { [key: string]: any[] };
}

export interface ChartDataTemplate {
  type: string;
  requiresGrouping: boolean;
  entityField: string;
  timeField?: string;
  valueField: string;
}

/**
 * Analyzes the structure of query results to understand how to transform them
 */
export function analyzeDataStructure(queryResults: any[]): DataAnalysis {
  if (!queryResults || queryResults.length === 0) {
    return {
      totalRows: 0,
      columns: [],
      uniqueEntities: [],
      entityColumn: '',
      valueColumns: [],
      dataStructure: 'single-entity'
    };
  }

  const allData = queryResults.flatMap(r => r.data || []);
  if (allData.length === 0) {
    return {
      totalRows: 0,
      columns: [],
      uniqueEntities: [],
      entityColumn: '',
      valueColumns: [],
      dataStructure: 'single-entity'
    };
  }

  const columns = Object.keys(allData[0]);
  
  // Identify entity column (usually first column or one with 'id' in name)
  const entityColumn = columns.find(col => 
    col.toLowerCase().includes('id') && !col.toLowerCase().includes('order')
  ) || columns[0] || '';

  // Identify time column (date, month, year patterns)
  const timeColumn = columns.find(col => 
    col.toLowerCase().includes('date') || 
    col.toLowerCase().includes('month') || 
    col.toLowerCase().includes('year') ||
    col.toLowerCase().includes('time')
  );

  // Identify value columns (numeric columns that aren't IDs)
  const valueColumns = columns.filter(col => {
    const sampleValue = allData[0]?.[col];
    return typeof sampleValue === 'number' && 
           !col.toLowerCase().includes('id') &&
           col !== entityColumn;
  });

  // Get unique entities
  const uniqueEntities = [...new Set(allData.map(row => row[entityColumn]))];

  // Determine data structure
  let dataStructure: DataAnalysis['dataStructure'] = 'single-entity';
  if (uniqueEntities.length > 1) {
    if (timeColumn) {
      dataStructure = 'multi-entity-time-series';
    } else {
      dataStructure = 'multi-entity';
    }
  } else if (timeColumn) {
    dataStructure = 'time-series';
  }

  // Group data by entity if multi-entity
  let groupedData: { [key: string]: any[] } | undefined;
  if (uniqueEntities.length > 1) {
    groupedData = {};
    for (const entity of uniqueEntities) {
      groupedData[String(entity)] = allData.filter(row => row[entityColumn] === entity);
    }
  }

  return {
    totalRows: allData.length,
    columns,
    uniqueEntities,
    entityColumn,
    timeColumn,
    valueColumns,
    dataStructure,
    groupedData
  };
}

/**
 * Gets the appropriate chart template based on chart type and data structure
 */
export function getChartTemplate(chartType: string, dataAnalysis: DataAnalysis): ChartDataTemplate {
  const defaultTemplate: ChartDataTemplate = {
    type: 'line',
    requiresGrouping: dataAnalysis.dataStructure.includes('multi-entity'),
    entityField: dataAnalysis.entityColumn || 'id',
    timeField: dataAnalysis.timeColumn,
    valueField: dataAnalysis.valueColumns[0] || 'value'
  };

  const templates: { [key: string]: ChartDataTemplate } = {
    line: defaultTemplate,
    bar: {
      type: 'bar',
      requiresGrouping: dataAnalysis.dataStructure.includes('multi-entity'),
      entityField: dataAnalysis.entityColumn || 'id',
      timeField: dataAnalysis.timeColumn,
      valueField: dataAnalysis.valueColumns[0] || 'value'
    },
    pie: {
      type: 'pie',
      requiresGrouping: false,
      entityField: dataAnalysis.entityColumn || 'id',
      valueField: dataAnalysis.valueColumns[0] || 'value'
    }
  };

  return templates[chartType] || defaultTemplate;
}

/**
 * Pre-processes data into the correct structure for the chart type
 */
export function preprocessChartData(
  queryResults: any[], 
  chartType: string
): { analysis: DataAnalysis; template: ChartDataTemplate; processedData: any } {
  const analysis = analyzeDataStructure(queryResults);
  const template = getChartTemplate(chartType, analysis);
  
  const allData = queryResults.flatMap(r => r.data || []);
  
  let processedData: any;

  if (template.requiresGrouping && analysis.groupedData) {
    // Multi-entity charts (line, bar with multiple series)
    processedData = {
      type: 'multi-series',
      entities: analysis.uniqueEntities,
      seriesData: analysis.groupedData,
      structure: {
        entityField: template.entityField,
        timeField: template.timeField,
        valueField: template.valueField
      }
    };
  } else {
    // Single entity or aggregated charts
    processedData = {
      type: 'single-series',
      data: allData,
      structure: {
        entityField: template.entityField,
        timeField: template.timeField,
        valueField: template.valueField
      }
    };
  }

  return {
    analysis,
    template,
    processedData
  };
}

/**
 * Generates a focused, data-structure-aware prompt for the LLM
 */
export function generateTransformationPrompt(
  chartType: string,
  processedData: any,
  dataRequirements: any[]
): string {
  const basePrompt = `
Transform the pre-processed data into Nivo ${chartType} chart format.

Chart Type: ${chartType}
Data Requirements: ${JSON.stringify(dataRequirements, null, 2)}
`;

  if (processedData.type === 'multi-series') {
    return basePrompt + `
Data Structure: MULTI-SERIES (${processedData.entities.length} entities)
Entities: ${JSON.stringify(processedData.entities)}
Entity Field: ${processedData.structure.entityField}
Time Field: ${processedData.structure.timeField || 'N/A'}
Value Field: ${processedData.structure.valueField}

REQUIRED OUTPUT: Create ${processedData.entities.length} series objects, one for each entity.

Sample data for each entity:
${Object.entries(processedData.seriesData).map(([entity, data]: [string, any]) => 
  `Entity "${entity}": ${JSON.stringify((data as any[]).slice(0, 3), null, 2)}`
).join('\n')}

CRITICAL: You MUST create exactly ${processedData.entities.length} series objects in the data array.
Each series must have:
- "id": entity identifier
- "data": array of {x: ${processedData.structure.timeField || 'category'}, y: ${processedData.structure.valueField}} objects
`;
  } else {
    return basePrompt + `
Data Structure: SINGLE-SERIES
Sample Data: ${JSON.stringify(processedData.data.slice(0, 5), null, 2)}
Entity Field: ${processedData.structure.entityField}
Time Field: ${processedData.structure.timeField || 'N/A'}
Value Field: ${processedData.structure.valueField}

Create a single series or direct data array as appropriate for ${chartType} charts.
`;
  }
} 
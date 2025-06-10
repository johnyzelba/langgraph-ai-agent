import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLogger } from '../../utils/logger';
import { parseLLMResponse, validateLLMResponseStructure } from '../../utils/llm-parser';
import { 
  DataStructureMetadata, 
  TransformationInstruction, 
  ChartRequirement,
  CHART_REQUIREMENTS,
  NodeDependencies
} from '../types/chart-nodes';
import { groupBy } from './chart-data-analysis';

const logger = createLogger('chart-transformation');

// Generate Transformation Instructions using LLM
export async function generateTransformationInstructions(
  dataMetadata: DataStructureMetadata,
  chartType: string,
  deps: NodeDependencies
): Promise<TransformationInstruction> {
  const chartRequirement = CHART_REQUIREMENTS[chartType];
  if (!chartRequirement) {
    throw new Error(`Unsupported chart type: ${chartType}`);
  }
  
  const instructionPrompt = `
You are a data transformation expert. Analyze the data structure and generate transformation instructions to convert it to the required chart format.

DATA STRUCTURE ANALYSIS:
- Type: ${dataMetadata.type}
- Total Rows: ${dataMetadata.totalRows}
- Fields: ${JSON.stringify(dataMetadata.fields, null, 2)}
- Relationships: ${JSON.stringify(dataMetadata.relationships, null, 2)}
- Sample Data: ${JSON.stringify(dataMetadata.sampleData, null, 2)}

CHART REQUIREMENTS:
- Chart Type: ${chartType}
- Required Structure: ${chartRequirement.requiredStructure}
- Required Fields: ${chartRequirement.requiredFields.join(', ')}
- Example Output: ${JSON.stringify(chartRequirement.exampleStructure, null, 2)}

🚨 CRITICAL: Your response MUST be ONLY a valid JSON object - no explanatory text!

 Generate transformation instructions as JSON:
 {
   "fieldMappings": {
     "sourceField1": "targetField1",
     "sourceField2": "targetField2"
   },
  "aggregations": [
    {
      "field": "fieldToAggregate",
      "operation": "sum|avg|count|min|max|first|last",
      "groupBy": ["groupField1", "groupField2"]
    }
  ],
  "filters": [
    {
      "field": "fieldName",
      "operation": "equals|contains|greaterThan|lessThan|in|notNull",
      "value": "filterValue"
    }
  ],
  "groupings": [
    {
      "field": "groupingField",
      "createSeries": true|false,
      "seriesNameField": "fieldForSeriesName"
    }
  ],
  "sorting": [
    {
      "field": "sortField",
      "direction": "asc|desc"
    }
  ]
}

Guidelines:
1. Analyze the data structure type and plan appropriate transformations
2. Map source fields to target chart requirements
3. Include necessary aggregations, groupings, and sorting
4. Ensure the output will match the required Nivo chart structure
5. Be specific about field mappings and transformation steps
6. Consider data relationships when planning transformations
`;

  const messages: BaseMessage[] = [
    new SystemMessage(instructionPrompt),
    new HumanMessage(`Generate transformation instructions for ${chartType} chart`),
  ];

  try {
    const response = await deps.llmGateway.generateCompletion(messages, {
      temperature: 0.1,
    });

    const instructions = parseLLMResponse<TransformationInstruction>(response, 'transformation instructions');
    
    // Validate instruction structure
    validateLLMResponseStructure(instructions, ['fieldMappings'], 'transformation instructions');
    
    return instructions;
  } catch (error) {
    logger.error('Failed to generate transformation instructions', { error });
    
    // Provide fallback instructions
    return generateFallbackInstructions(dataMetadata, chartType);
  }
}

export function generateFallbackInstructions(dataMetadata: DataStructureMetadata, chartType: string): TransformationInstruction {
  // Generate basic fallback instructions based on data type and chart type
  const measureFields = dataMetadata.fields.filter(f => f.role === 'measure');
  const dimensionFields = dataMetadata.fields.filter(f => f.role === 'dimension' || f.role === 'grouping');
  const temporalFields = dataMetadata.fields.filter(f => f.role === 'temporal');
  
  let instructions: TransformationInstruction = {
    fieldMappings: {},
    aggregations: [],
    filters: [],
    groupings: [],
    sorting: []
  };
  
  // Basic field mappings based on chart type
  if (chartType === 'pie' && measureFields.length > 0 && dimensionFields.length > 0 && measureFields[0] && dimensionFields[0]) {
    instructions.fieldMappings = {
      [dimensionFields[0].name]: 'id',
      [measureFields[0].name]: 'value'
    };
  } else if (chartType === 'treemap' && measureFields.length > 0 && dimensionFields.length > 0 && measureFields[0] && dimensionFields[0]) {
    instructions.fieldMappings = {
      [dimensionFields[0].name]: 'name',
      [measureFields[0].name]: 'value'
    };
    // Add grouping for hierarchical structure if multiple dimensions available
    if (dimensionFields.length > 1 && dimensionFields[1]) {
      instructions.groupings = [{
        field: dimensionFields[1].name,
        createSeries: false,
        seriesNameField: dimensionFields[1].name
      }];
    }
  } else if ((chartType === 'line' || chartType === 'bar') && measureFields.length > 0 && measureFields[0]) {
    if (temporalFields.length > 0 && temporalFields[0]) {
      instructions.fieldMappings = {
        [temporalFields[0].name]: 'x',
        [measureFields[0].name]: 'y'
      };
    } else if (dimensionFields.length > 0 && dimensionFields[0]) {
      instructions.fieldMappings = {
        [dimensionFields[0].name]: 'x',
        [measureFields[0].name]: 'y'
      };
    }
  }
  
  return instructions;
}

// Execute Transformation Instructions
export function executeTransformation(
  dataMetadata: DataStructureMetadata,
  instructions: TransformationInstruction,
  chartType: string
): any {
  logger.debug('Executing transformation', {
    dataType: dataMetadata.type,
    chartType,
    hasFieldMappings: Object.keys(instructions.fieldMappings).length > 0
  });
  
  try {
    let transformedData: any;
    
    // Execute transformation based on data structure type
    switch (dataMetadata.type) {
      case 'series':
        transformedData = transformSeriesData(dataMetadata, instructions, chartType);
        break;
      case 'flat':
        transformedData = transformFlatData(dataMetadata, instructions, chartType);
        break;
      case 'hierarchical':
        transformedData = transformHierarchicalData(dataMetadata, instructions, chartType);
        break;
      default:
        transformedData = transformFlatData(dataMetadata, instructions, chartType);
    }
    
    // Validate output structure and check for date formatting issues
    const chartRequirement = CHART_REQUIREMENTS[chartType];
    if (chartRequirement && !validateChartData(transformedData, chartRequirement)) {
      logger.warn('Transformed data does not match chart requirements, applying corrections');
      transformedData = correctChartData(transformedData, chartRequirement);
    }
    
    // Additional validation for time series data
    if (chartType === 'line' || chartType === 'scatter') {
      validateTimeSeriesData(transformedData, chartType);
    }
    
    return {
      type: chartType,
      data: transformedData,
      title: generateChartTitle(dataMetadata, instructions),
      description: generateChartDescription(dataMetadata, instructions)
    };
  } catch (error) {
    logger.error('Transformation execution failed', { error });
    throw new Error(`Transformation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Validate time series data for common issues
function validateTimeSeriesData(data: any, chartType: string): void {
  if (!Array.isArray(data)) return;
  
  for (const series of data) {
    if (series.data && Array.isArray(series.data)) {
      const xValues = series.data.map((point: any) => point.x);
      const uniqueXValues = new Set(xValues);
      
      if (xValues.length !== uniqueXValues.size) {
        const duplicates = xValues.filter((x: any, index: number) => xValues.indexOf(x) !== index);
        
        // Check if x-values look like years only AND we have many duplicates
        const yearOnlyPattern = /^\d{4}$/;
        const hasYearOnlyValues = xValues.some((x: any) => yearOnlyPattern.test(String(x)));
        const duplicateRatio = (xValues.length - uniqueXValues.size) / xValues.length;
        
        // Only flag as error if we have year-only values AND high duplicate ratio (>30%)
        // This suggests the query should have used monthly formatting
        if (hasYearOnlyValues && duplicateRatio > 0.3) {
          logger.error('Time series data contains year-only x-values with high duplicate ratio', {
            seriesId: series.id,
            sampleXValues: xValues.slice(0, 10),
            duplicateRatio: Math.round(duplicateRatio * 100) + '%',
            totalPoints: xValues.length,
            uniquePoints: uniqueXValues.size,
            suggestion: 'Consider using strftime(\'%Y-%m\', date_column) for monthly data if more granularity is needed'
          });
        } else {
          // Just warn for other duplicate cases (might be legitimate yearly aggregation)
          logger.debug('Detected duplicate x-values in time series data', {
            seriesId: series.id,
            duplicateXValues: [...new Set(duplicates)].slice(0, 5),
            totalPoints: xValues.length,
            uniquePoints: uniqueXValues.size,
            duplicateRatio: Math.round(duplicateRatio * 100) + '%',
            note: 'This may be normal for yearly aggregated data'
          });
        }
      }
    }
  }
}

function transformSeriesData(
  dataMetadata: DataStructureMetadata,
  instructions: TransformationInstruction,
  chartType: string
): any {
  const seriesData = dataMetadata.structure.seriesData;
  const seriesKeys = Object.keys(seriesData);
  
  if (chartType === 'line' || chartType === 'scatter') {
    // Transform to series format for line/scatter charts
    return seriesKeys.map(seriesKey => {
      const seriesArray = seriesData[seriesKey];
      const dataPoints = seriesArray.map((row: any) => {
        const point: any = {};
        Object.keys(instructions.fieldMappings).forEach(sourceField => {
          const targetField = instructions.fieldMappings[sourceField];
          if (targetField) {
            point[targetField] = row[sourceField];
          }
        });
        return point;
      });
      
      return {
        id: seriesKey,
        data: dataPoints
      };
    });
  } else if (chartType === 'treemap') {
    // Transform series data to treemap format
    const nameField = Object.keys(instructions.fieldMappings).find(key => instructions.fieldMappings[key] === 'name');
    const valueField = Object.keys(instructions.fieldMappings).find(key => instructions.fieldMappings[key] === 'value');
    
    if (!nameField || !valueField) {
      throw new Error('Treemap requires name and value field mappings');
    }
    
    const children = seriesKeys.map(seriesKey => {
      const seriesArray = seriesData[seriesKey];
      
      // Calculate total value for this series
      let totalValue = 0;
      if (instructions.aggregations.length > 0) {
        const agg = instructions.aggregations[0];
        if (agg) {
          const values = seriesArray.map((row: any) => row[agg.field]).filter((v: any) => typeof v === 'number');
          
          switch (agg.operation) {
            case 'sum':
              totalValue = values.reduce((sum: number, v: number) => sum + v, 0);
              break;
            case 'avg':
              totalValue = values.length > 0 ? values.reduce((sum: number, v: number) => sum + v, 0) / values.length : 0;
              break;
            case 'max':
              totalValue = Math.max(...values);
              break;
            case 'min':
              totalValue = Math.min(...values);
              break;
            default:
              totalValue = values.length;
          }
        }
      } else {
        totalValue = seriesArray.length; // Default to count
      }
      
      return {
        name: seriesKey,
        value: totalValue,
        loc: totalValue
      };
    });
    
    const grandTotal = children.reduce((sum, child) => sum + child.value, 0);
    
    return {
      name: 'root',
      value: grandTotal,
      loc: grandTotal,
      children: children
    };
  } else if (chartType === 'bar' || chartType === 'pie') {
    // Aggregate series data for bar/pie charts
    const aggregatedData: any[] = [];
    
    seriesKeys.forEach(seriesKey => {
      const seriesArray = seriesData[seriesKey];
      
      // Apply aggregations if specified
      let value = seriesArray.length; // Default to count
      if (instructions.aggregations.length > 0) {
        const agg = instructions.aggregations[0];
        if (agg) {
          const values = seriesArray.map((row: any) => row[agg.field]).filter((v: any) => typeof v === 'number');
          
          switch (agg.operation) {
            case 'sum':
              value = values.reduce((sum: number, v: number) => sum + v, 0);
              break;
            case 'avg':
              value = values.length > 0 ? values.reduce((sum: number, v: number) => sum + v, 0) / values.length : 0;
              break;
            case 'max':
              value = Math.max(...values);
              break;
            case 'min':
              value = Math.min(...values);
              break;
            default:
              value = values.length;
          }
        }
      }
      
      aggregatedData.push({
        id: seriesKey,
        label: seriesKey,
        value: value
      });
    });
    
    return aggregatedData;
  }
  
  return [];
}

function transformFlatData(
  dataMetadata: DataStructureMetadata,
  instructions: TransformationInstruction,
  chartType: string
): any {
  const data = dataMetadata.structure.data || [];
  
  // Apply filters
  let filteredData = data;
  instructions.filters.forEach(filter => {
    filteredData = filteredData.filter((row: any) => {
      const value = row[filter.field];
      switch (filter.operation) {
        case 'equals':
          return value === filter.value;
        case 'contains':
          return String(value).includes(String(filter.value));
        case 'greaterThan':
          return Number(value) > Number(filter.value);
        case 'lessThan':
          return Number(value) < Number(filter.value);
        case 'notNull':
          return value !== null && value !== undefined;
        default:
          return true;
      }
    });
  });
  
  // Special handling for treemap charts
  if (chartType === 'treemap') {
    return transformToTreemapData(filteredData, instructions);
  }
  
  // Apply groupings if needed
  if (instructions.groupings.length > 0 && (chartType === 'line' || chartType === 'scatter')) {
    const grouping = instructions.groupings[0];
    if (grouping) {
      const grouped = groupBy(filteredData, grouping.field);
      
      return Object.keys(grouped).map(groupKey => {
        const groupData = grouped[groupKey];
        if (groupData) {
          const dataPoints = groupData.map((row: any) => {
            const point: any = {};
            Object.keys(instructions.fieldMappings).forEach(sourceField => {
              const targetField = instructions.fieldMappings[sourceField];
              if (sourceField !== grouping.field && targetField) {
                point[targetField] = row[sourceField];
              }
            });
            return point;
          });
          
          return {
            id: groupKey,
            data: dataPoints
          };
        }
        return { id: groupKey, data: [] };
      });
    }
  }
  
  // Direct mapping for simple charts
  const transformedData = filteredData.map((row: any) => {
    const transformedRow: any = {};
    Object.keys(instructions.fieldMappings).forEach(sourceField => {
      const targetField = instructions.fieldMappings[sourceField];
      if (targetField) {
        transformedRow[targetField] = row[sourceField];
      }
    });
    return transformedRow;
  });
  
  // Apply sorting
  if (instructions.sorting.length > 0) {
    const sort = instructions.sorting[0];
    if (sort) {
      transformedData.sort((a: any, b: any) => {
        const aVal = a[sort.field];
        const bVal = b[sort.field];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sort.direction === 'desc' ? -comparison : comparison;
      });
    }
  }
  
  return transformedData;
}

// Transform flat data to treemap hierarchical structure
function transformToTreemapData(data: any[], instructions: TransformationInstruction): any {
  const nameField = Object.keys(instructions.fieldMappings).find(key => instructions.fieldMappings[key] === 'name');
  const valueField = Object.keys(instructions.fieldMappings).find(key => instructions.fieldMappings[key] === 'value');
  
  if (!nameField || !valueField) {
    throw new Error('Treemap requires name and value field mappings');
  }
  
  // Check if we have grouping instructions for hierarchical structure
  if (instructions.groupings.length > 0) {
    const grouping = instructions.groupings[0];
    if (grouping) {
      // Create hierarchical structure with grouping
      const grouped = groupBy(data, grouping.field);
      
      const children = Object.keys(grouped).map(groupKey => {
        const groupData = grouped[groupKey];
        if (groupData) {
          // If group has multiple items, create sub-children
          if (groupData.length > 1) {
            const subChildren = groupData.map((row: any) => ({
              name: String(row[nameField]),
              value: Number(row[valueField]) || 0,
              loc: Number(row[valueField]) || 0
            }));
            
            const totalValue = subChildren.reduce((sum, child) => sum + child.value, 0);
            
            return {
              name: String(groupKey),
              value: totalValue,
              loc: totalValue,
              children: subChildren
            };
          } else {
            // Single item in group
            const row = groupData[0];
            return {
              name: String(row[nameField]),
              value: Number(row[valueField]) || 0,
              loc: Number(row[valueField]) || 0
            };
          }
        }
        return {
          name: String(groupKey),
          value: 0,
          loc: 0
        };
      });
      
      const totalValue = children.reduce((sum, child) => sum + child.value, 0);
      
      return {
        name: 'root',
        value: totalValue,
        loc: totalValue,
        children: children
      };
    }
  }
  
  // Simple flat treemap structure
  const children = data.map((row: any) => ({
    name: String(row[nameField]),
    value: Number(row[valueField]) || 0,
    loc: Number(row[valueField]) || 0
  }));
  
  const totalValue = children.reduce((sum, child) => sum + child.value, 0);
  
  return {
    name: 'root',
    value: totalValue,
    loc: totalValue,
    children: children
  };
}

function transformHierarchicalData(
  dataMetadata: DataStructureMetadata,
  instructions: TransformationInstruction,
  chartType: string
): any {
  // Basic hierarchical transformation - can be extended
  return dataMetadata.sampleData;
}

function validateChartData(data: any, requirement: ChartRequirement): boolean {
  // Special validation for treemap
  if (requirement.chartType === 'treemap') {
    if (!data || typeof data !== 'object') return false;
    
    // Check if it has required root structure
    if (!data.name || typeof data.value !== 'number') return false;
    
    // If it has children, validate them too
    if (data.children && Array.isArray(data.children)) {
      return data.children.every((child: any) => 
        child.name && typeof child.value === 'number'
      );
    }
    
    return true;
  }
  
  // Standard validation for array-based charts
  if (!Array.isArray(data)) return false;
  
  // Check if required fields are present
  if (data.length > 0) {
    const firstItem = data[0];
    return requirement.requiredFields.every(field => field in firstItem);
  }
  
  return true;
}

function correctChartData(data: any, requirement: ChartRequirement): any {
  // Special correction for treemap
  if (requirement.chartType === 'treemap') {
    if (!data || typeof data !== 'object') {
      return {
        name: 'root',
        value: 0,
        loc: 0,
        children: []
      };
    }
    
    // Ensure required fields exist
    const correctedData = { ...data };
    if (!correctedData.name) correctedData.name = 'root';
    if (typeof correctedData.value !== 'number') correctedData.value = 0;
    if (typeof correctedData.loc !== 'number') correctedData.loc = correctedData.value;
    
    // Correct children if they exist
    if (correctedData.children && Array.isArray(correctedData.children)) {
      correctedData.children = correctedData.children.map((child: any) => ({
        name: child.name || 'Unknown',
        value: typeof child.value === 'number' ? child.value : 0,
        loc: typeof child.loc === 'number' ? child.loc : (typeof child.value === 'number' ? child.value : 0),
        ...(child.children && Array.isArray(child.children) ? { children: child.children } : {})
      }));
    }
    
    return correctedData;
  }
  
  // Basic correction for array-based charts - ensure required fields exist
  if (Array.isArray(data) && data.length > 0) {
    return data.map(item => {
      const correctedItem = { ...item };
      requirement.requiredFields.forEach(field => {
        if (!(field in correctedItem)) {
          // Provide default values
          if (field === 'id') correctedItem[field] = `item_${Math.random().toString(36).substr(2, 9)}`;
          else if (field === 'value') correctedItem[field] = 0;
          else if (field === 'label') correctedItem[field] = correctedItem.id || 'Unknown';
          else correctedItem[field] = null;
        }
      });
      return correctedItem;
    });
  }
  
  return data;
}

function generateChartTitle(dataMetadata: DataStructureMetadata, instructions: TransformationInstruction): string {
  const measureFields = dataMetadata.fields.filter(f => f.role === 'measure');
  const dimensionFields = dataMetadata.fields.filter(f => f.role === 'dimension' || f.role === 'grouping');
  
  if (measureFields.length > 0 && measureFields[0] && dimensionFields.length > 0 && dimensionFields[0]) {
    return `${measureFields[0].name} by ${dimensionFields[0].name}`;
  } else if (measureFields.length > 0 && measureFields[0]) {
    return measureFields[0].name;
  } else if (dimensionFields.length > 0 && dimensionFields[0]) {
    return dimensionFields[0].name;
  }
  
  return 'Data Visualization';
}

function generateChartDescription(dataMetadata: DataStructureMetadata, instructions: TransformationInstruction): string {
  const mappingCount = Object.keys(instructions.fieldMappings).length;
  return `Chart showing ${dataMetadata.totalRows} data points with ${mappingCount} field mappings`;
} 
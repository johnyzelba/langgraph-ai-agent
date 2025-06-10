import { createLogger } from '../../utils/logger';
import { 
  DataStructureMetadata, 
  FieldMetadata, 
  RelationshipMetadata 
} from '../types/chart-nodes';

const logger = createLogger('chart-data-analysis');

// Generic Data Structure Analyzer
export function analyzeDataStructure(processedData: any): DataStructureMetadata {
  logger.debug('Analyzing data structure', { 
    processedDataType: typeof processedData,
    hasSeriesData: !!processedData.seriesData,
    hasData: !!processedData.data,
    keys: Object.keys(processedData || {})
  });

  // Handle series data (multiple arrays)
  if (processedData.seriesData && typeof processedData.seriesData === 'object') {
    return analyzeSeriesStructure(processedData);
  }
  
  // Handle flat array data
  if (processedData.data && Array.isArray(processedData.data)) {
    return analyzeFlatStructure(processedData);
  }
  
  // Handle direct array
  if (Array.isArray(processedData)) {
    return analyzeFlatStructure({ data: processedData });
  }
  
  // Handle hierarchical/nested data
  if (typeof processedData === 'object' && processedData !== null) {
    return analyzeHierarchicalStructure(processedData);
  }
  
  // Fallback to empty structure
  logger.warn('Unknown data structure, using fallback');
  return {
    type: 'flat',
    fields: [],
    relationships: [],
    sampleData: [],
    totalRows: 0,
    structure: processedData
  };
}

export function analyzeSeriesStructure(processedData: any): DataStructureMetadata {
  const seriesData = processedData.seriesData;
  const seriesKeys = Object.keys(seriesData);
  const firstSeriesKey = seriesKeys[0];
  const firstSeries = firstSeriesKey ? seriesData[firstSeriesKey] || [] : [];
  const sampleSize = Math.min(3, firstSeries.length);
  
  // Analyze fields from first series
  const fields: FieldMetadata[] = [];
  if (firstSeries.length > 0) {
    const sampleRow = firstSeries[0];
    Object.keys(sampleRow).forEach(fieldName => {
      const samples = firstSeries.slice(0, sampleSize).map((row: any) => row[fieldName]);
      fields.push(analyzeField(fieldName, samples, firstSeries));
    });
  }
  
  // Add series key as a field
  fields.push({
    name: 'seriesKey',
    type: 'categorical',
    role: 'grouping',
    samples: seriesKeys.slice(0, 3),
    uniqueValues: seriesKeys.length
  });
  
  // Create sample data
  const sampleData: any = {};
  seriesKeys.slice(0, 3).forEach(key => {
    sampleData[key] = seriesData[key].slice(0, sampleSize);
  });
  
  const totalRows = seriesKeys.reduce((sum, key) => sum + (seriesData[key]?.length || 0), 0);
  
  return {
    type: 'series',
    fields,
    relationships: [{
      type: 'grouping',
      sourceField: 'seriesKey',
      description: `Data grouped by ${seriesKeys.length} series`
    }],
    sampleData,
    totalRows,
    structure: processedData
  };
}

export function analyzeFlatStructure(processedData: any): DataStructureMetadata {
  const data = processedData.data || [];
  const sampleSize = Math.min(5, data.length);
  const sampleData = data.slice(0, sampleSize);
  
  const fields: FieldMetadata[] = [];
  if (data.length > 0) {
    const sampleRow = data[0];
    Object.keys(sampleRow).forEach(fieldName => {
      const samples = sampleData.map((row: any) => row[fieldName]);
      fields.push(analyzeField(fieldName, samples, data));
    });
  }
  
  return {
    type: 'flat',
    fields,
    relationships: [],
    sampleData,
    totalRows: data.length,
    structure: processedData
  };
}

export function analyzeHierarchicalStructure(processedData: any): DataStructureMetadata {
  // Basic hierarchical analysis - can be extended
  const sampleData = JSON.parse(JSON.stringify(processedData));
  
  // Try to flatten for field analysis
  const flattenedSample = flattenObject(sampleData);
  const fields: FieldMetadata[] = [];
  
  Object.keys(flattenedSample).forEach(fieldName => {
    const value = flattenedSample[fieldName];
    fields.push(analyzeField(fieldName, [value], [sampleData]));
  });
  
  return {
    type: 'hierarchical',
    fields,
    relationships: [],
    sampleData,
    totalRows: 1,
    structure: processedData
  };
}

export function analyzeField(fieldName: string, samples: any[], fullData: any[]): FieldMetadata {
  const nonNullSamples = samples.filter(s => s !== null && s !== undefined);
  const uniqueValues = new Set(nonNullSamples).size;
  const nullCount = samples.length - nonNullSamples.length;
  
  // Determine field type
  let type: FieldMetadata['type'] = 'text';
  if (nonNullSamples.length > 0) {
    const firstValue = nonNullSamples[0];
    if (typeof firstValue === 'number') {
      type = 'numeric';
    } else if (typeof firstValue === 'boolean') {
      type = 'boolean';
    } else if (typeof firstValue === 'string') {
      // Check if it's a date
      if (isDateString(firstValue)) {
        type = 'temporal';
      } else if (uniqueValues < samples.length * 0.5) {
        type = 'categorical';
      } else {
        type = 'text';
      }
    }
  }
  
  // Determine field role
  let role: FieldMetadata['role'] = 'dimension';
  if (type === 'numeric') {
    role = 'measure';
  } else if (type === 'temporal') {
    role = 'temporal';
  } else if (fieldName.toLowerCase().includes('id')) {
    role = 'identifier';
  } else if (uniqueValues < 20 && type === 'categorical') {
    role = 'grouping';
  }
  
  // Special handling for time fields that might have duplicate years
  // Only warn if we have a high duplicate ratio AND it looks like monthly data was expected
  if (type === 'temporal' || fieldName.toLowerCase().includes('year') || fieldName.toLowerCase().includes('month')) {
    const duplicateCount = samples.length - uniqueValues;
    const duplicateRatio = duplicateCount / samples.length;
    
    // Only warn if duplicate ratio is high (>50%) and field name suggests monthly data
    if (duplicateCount > 0 && duplicateRatio > 0.5 && fieldName.toLowerCase().includes('month')) {
      logger.warn('Detected high duplicate ratio in time field - possible granularity mismatch', {
        fieldName,
        samples: nonNullSamples.slice(0, 5),
        uniqueValues,
        totalSamples: samples.length,
        duplicateRatio: Math.round(duplicateRatio * 100) + '%',
        note: 'This might indicate year-only formatting when monthly was expected'
      });
    } else if (duplicateCount > 0) {
      logger.debug('Detected some duplicate time values', {
        fieldName,
        uniqueValues,
        totalSamples: samples.length,
        duplicateRatio: Math.round(duplicateRatio * 100) + '%',
        note: 'This may be normal for aggregated time data'
      });
    }
  }
  
  return {
    name: fieldName,
    type,
    role,
    samples: nonNullSamples.slice(0, 3),
    uniqueValues,
    nullCount
  };
}

export function isDateString(value: string): boolean {
  // Enhanced date detection with better year-month format recognition
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}/, // MM/DD/YYYY
    /^\d{4}-\d{2}$/, // YYYY-MM (year-month format)
    /^\d{4}$/, // YYYY (year only - should be flagged)
  ];
  
  const isValidDate = datePatterns.some(pattern => pattern.test(value)) && !isNaN(Date.parse(value));
  
  // Special check for year-only format which might cause issues
  if (/^\d{4}$/.test(value) && isValidDate) {
    logger.debug('Detected year-only date format', { value });
  }
  
  return isValidDate;
}

export function flattenObject(obj: any, prefix = ''): any {
  const flattened: any = {};
  
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value, newKey));
    } else {
      flattened[newKey] = value;
    }
  });
  
  return flattened;
}

export function groupBy(array: any[], key: string): Record<string, any[]> {
  return array.reduce((groups, item) => {
    const group = item[key];
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(item);
    return groups;
  }, {});
} 
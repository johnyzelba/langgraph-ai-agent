import { 
  AgentState, 
  ChartType,
  DataRequirement,
  QueryInstruction,
  SQLQuery,
  ValidationResult,
  ClarificationRequest
} from '../types';
import { LLMGateway } from '../../services/llm-gateway';
import { ToolManager } from '../../tools/tool-manager';
import { MemoryManager } from '../../memory/memory-manager';

export interface NodeDependencies {
  llmGateway: LLMGateway;
  toolManager: ToolManager;
  memoryManager: MemoryManager;
  progressCallback?: (progress: AgentState['progress']) => void;
}

// Generic Data Transformation System Interfaces
export interface DataStructureMetadata {
  type: 'flat' | 'series' | 'hierarchical' | 'timeSeries' | 'relational' | 'grouped';
  fields: FieldMetadata[];
  relationships: RelationshipMetadata[];
  sampleData: any;
  totalRows: number;
  structure: any; // Original structure for reference
}

export interface FieldMetadata {
  name: string;
  type: 'numeric' | 'categorical' | 'temporal' | 'text' | 'boolean';
  role: 'dimension' | 'measure' | 'identifier' | 'grouping' | 'temporal';
  samples: any[];
  uniqueValues?: number;
  nullCount?: number;
}

export interface RelationshipMetadata {
  type: 'oneToMany' | 'manyToOne' | 'manyToMany' | 'grouping';
  sourceField: string;
  targetField?: string;
  description: string;
}

export interface ChartRequirement {
  chartType: string;
  requiredStructure: string; // Description of required Nivo structure
  requiredFields: string[];
  optionalFields: string[];
  exampleStructure: any; // Example of expected output
  validationRules: string[];
}

export interface TransformationInstruction {
  fieldMappings: Record<string, string>;
  aggregations: AggregationInstruction[];
  filters: FilterInstruction[];
  groupings: GroupingInstruction[];
  sorting: SortingInstruction[];
}

export interface AggregationInstruction {
  field: string;
  operation: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'first' | 'last';
  groupBy?: string[];
}

export interface FilterInstruction {
  field: string;
  operation: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'in' | 'notNull';
  value: any;
}

export interface GroupingInstruction {
  field: string;
  createSeries: boolean;
  seriesNameField?: string;
}

export interface SortingInstruction {
  field: string;
  direction: 'asc' | 'desc';
}

// Chart Requirements Registry
export const CHART_REQUIREMENTS: Record<string, ChartRequirement> = {
  line: {
    chartType: 'line',
    requiredStructure: 'Array of series objects with id and data array',
    requiredFields: ['id', 'data'],
    optionalFields: ['color'],
    exampleStructure: [{ id: 'series1', data: [{ x: 'A', y: 10 }] }],
    validationRules: ['Each series must have id and data array', 'Data points must have x and y values']
  },
  bar: {
    chartType: 'bar',
    requiredStructure: 'Array of objects with category and value fields',
    requiredFields: ['id', 'value'],
    optionalFields: ['color', 'label'],
    exampleStructure: [{ id: 'A', value: 10, label: 'Category A' }],
    validationRules: ['Each item must have id and numeric value']
  },
  pie: {
    chartType: 'pie',
    requiredStructure: 'Array of objects with id, label, and value',
    requiredFields: ['id', 'value'],
    optionalFields: ['label', 'color'],
    exampleStructure: [{ id: 'slice1', label: 'Slice 1', value: 25 }],
    validationRules: ['Each slice must have id and numeric value', 'Values should sum to meaningful total']
  },
  scatter: {
    chartType: 'scatter',
    requiredStructure: 'Array of series with data points having x, y coordinates',
    requiredFields: ['id', 'data'],
    optionalFields: ['color', 'size'],
    exampleStructure: [{ id: 'series1', data: [{ x: 10, y: 20 }] }],
    validationRules: ['Data points must have numeric x and y values']
  },
  heatmap: {
    chartType: 'heatmap',
    requiredStructure: 'Array of objects with x, y, and value properties',
    requiredFields: ['x', 'y', 'v'],
    optionalFields: ['color'],
    exampleStructure: [{ x: 'A', y: 'B', v: 10 }],
    validationRules: ['Each cell must have x, y coordinates and numeric value']
  },
  treemap: {
    chartType: 'treemap',
    requiredStructure: 'Hierarchical object with name, value, and optional children',
    requiredFields: ['name', 'value'],
    optionalFields: ['children', 'color', 'loc'],
    exampleStructure: { name: 'root', children: [{ name: 'A', value: 100 }, { name: 'B', value: 200 }] },
    validationRules: ['Root must have name and children array', 'Leaf nodes must have name and numeric value', 'Can have nested children for hierarchical data']
  }
}; 
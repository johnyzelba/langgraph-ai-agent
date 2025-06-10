import { AgentState } from '../types';
import { NodeDependencies } from '../types/chart-nodes';
import { updateProgress } from '../utils/chart-node-utils';
import { createLogger } from '../../utils/logger';

const logger = createLogger('clarifying-node');

// Clarifying node - handles user clarification
export async function clarifyingNode(
  state: AgentState,
  deps: NodeDependencies
): Promise<Partial<AgentState>> {
  logger.info('Clarifying node executing');
  
  // This node just sets the clarification state
  // The actual clarification will be handled by returning to the user
  return updateProgress(
    state,
    'clarifying',
    'Need clarification from user...',
    deps.progressCallback
  );
} 
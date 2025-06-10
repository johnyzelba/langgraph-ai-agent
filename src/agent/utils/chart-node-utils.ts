import { 
  AgentState, 
  AgentStateName,
} from '../types';
import { calculateProgress } from '../chart-state-machine';

// Helper function to update progress
export function updateProgress(
  state: AgentState, 
  newState: AgentStateName, 
  message: string,
  callback?: (progress: AgentState['progress']) => void
): AgentState {
  const progress = {
    currentState: newState,
    percentage: calculateProgress(newState),
    message,
  };
  
  if (callback) {
    callback(progress);
  }
  
  return { ...state, progress };
} 
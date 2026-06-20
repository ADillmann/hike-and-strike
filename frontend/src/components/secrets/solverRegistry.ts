import type { ComponentType } from 'react';
import { CodewordSolverModal } from './CodewordSolverModal';
import { NumberLockSolverModal } from './NumberLockSolverModal';

export interface SolverModalProps {
  itemName: string;
  hints: Record<string, unknown>;
  onSubmit: (guess: string) => void;
  onClose: () => void;
  busy?: boolean;
}

export const SOLVER_MODALS: Record<string, ComponentType<SolverModalProps>> = {
  codeword: CodewordSolverModal,
  number_lock: NumberLockSolverModal,
};

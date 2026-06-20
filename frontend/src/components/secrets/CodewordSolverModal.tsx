import { useState } from 'react';
import type { SolverModalProps } from './solverRegistry';

export function CodewordSolverModal({ itemName, onSubmit, onClose, busy }: SolverModalProps) {
  const [guess, setGuess] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card w-full max-w-md space-y-3">
        <h3 className="font-semibold text-dungeon-300">Solve: {itemName}</h3>
        <p className="text-sm text-stone-400">Enter the codeword to unlock this secret.</p>
        <input
          className="input"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="Codeword"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && guess.trim() && onSubmit(guess.trim())}
        />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={!guess.trim() || busy} onClick={() => onSubmit(guess.trim())}>
            Submit
          </button>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

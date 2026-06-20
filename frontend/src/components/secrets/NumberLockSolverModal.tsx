import { useState } from 'react';
import type { SolverModalProps } from './solverRegistry';

export function NumberLockSolverModal({ itemName, hints, onSubmit, onClose, busy }: SolverModalProps) {
  const length = typeof hints.length === 'number' ? hints.length : 5;
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ''));

  const setDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < length - 1) {
      const el = document.getElementById(`lock-digit-${index + 1}`);
      el?.focus();
    }
  };

  const guess = digits.join('');
  const complete = guess.length === length && digits.every((d) => d !== '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card w-full max-w-md space-y-3">
        <h3 className="font-semibold text-dungeon-300">Unlock: {itemName}</h3>
        <p className="text-sm text-stone-400">Enter the {length}-digit combination.</p>
        <div className="flex justify-center gap-2">
          {digits.map((d, i) => (
            <input
              key={i}
              id={`lock-digit-${i}`}
              className="input w-12 text-center text-lg tracking-widest"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !d && i > 0) {
                  document.getElementById(`lock-digit-${i - 1}`)?.focus();
                }
                if (e.key === 'Enter' && complete) onSubmit(guess);
              }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={!complete || busy} onClick={() => onSubmit(guess)}>
            Unlock
          </button>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

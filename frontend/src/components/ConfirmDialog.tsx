export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card max-w-sm w-full">
        <h3 className="mb-2 font-semibold text-dungeon-300">{title}</h3>
        <p className="mb-4 text-sm text-stone-400">{message}</p>
        <div className="flex gap-2">
          <button className="btn-danger" onClick={onConfirm}>{confirmLabel}</button>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

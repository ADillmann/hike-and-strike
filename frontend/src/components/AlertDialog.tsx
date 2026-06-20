export function AlertDialog({
  title,
  message,
  children,
  confirmLabel = 'OK',
  onClose,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card max-w-sm w-full">
        <h3 className="mb-2 font-semibold text-dungeon-300">{title}</h3>
        {message && <p className="mb-3 text-sm text-stone-400">{message}</p>}
        {children}
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={onClose}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

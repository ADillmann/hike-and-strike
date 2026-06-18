import { useRef } from 'react';

export function ImageUpload({
  label,
  currentUrl,
  onUpload,
}: {
  label?: string;
  currentUrl?: string | null;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onUpload(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      {label && <label className="label">{label}</label>}
      {currentUrl && (
        <img src={currentUrl} alt="" className="mb-2 h-24 w-24 rounded object-cover" />
      )}
      <input ref={inputRef} type="file" accept="image/*" className="input text-sm" onChange={handleChange} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImageUpload } from '../../components/ImageUpload';
import { Layout } from '../../components/Layout';

interface EventTemplate {
  id: number;
  name: string;
  description: string;
  event_type: string;
  is_generic: boolean;
  images: string[];
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventTemplate[]>([]);
  const [form, setForm] = useState({ name: '', description: '', event_type: 'story' });
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [editing, setEditing] = useState<EventTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = () => api.get<EventTemplate[]>('/events').then(setEvents);

  useEffect(() => { load(); }, []);

  const uploadImage = async (eventId: number, file: File) => {
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const updated = await api.post<EventTemplate>(`/events/${eventId}/images`, fd);
      await load();
      if (editing?.id === eventId) {
        setEditing(updated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed';
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const addPendingImage = (file: File) => {
    setPendingImages((prev) => [...prev, file]);
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const created = await api.post<EventTemplate>('/events', form);
      for (const file of pendingImages) {
        await uploadImage(created.id, file);
      }
      setForm({ name: '', description: '', event_type: 'story' });
      setPendingImages([]);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError('');
    try {
      await api.patch(`/events/${editing.id}`, {
        name: editing.name,
        description: editing.description,
        event_type: editing.event_type,
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
    }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/events/${deleteId}`);
    setDeleteId(null);
    load();
  };

  return (
    <Layout title="Event Templates">
      {error && <p className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-red-400">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">New Event</h2>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <textarea className="input min-h-24" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select className="input" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
            <option value="story">Story</option>
            <option value="puzzle">Puzzle</option>
            <option value="rest">Rest</option>
            <option value="generic">Generic</option>
            <option value="battle_hook">Battle Hook</option>
          </select>
          <div>
            <label className="label">Images (optional)</label>
            <input
              type="file"
              accept="image/*"
              className="input text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addPendingImage(file);
                e.target.value = '';
              }}
            />
            {pendingImages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pendingImages.map((file, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(file)} alt="" className="h-16 w-16 rounded object-cover" />
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 rounded-full bg-red-800 px-1 text-xs"
                      onClick={() => removePendingImage(i)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-stone-500">Images upload when you save the event.</p>
          </div>
          <button className="btn-primary" type="submit" disabled={uploading}>
            {uploading ? 'Uploading...' : 'Save Event'}
          </button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Event Library</h2>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {events.map((ev) => (
              <div key={ev.id} className="rounded border border-dungeon-600 p-3">
                <div className="flex justify-between">
                  <span className="font-medium">{ev.name}</span>
                  <span className="text-xs text-stone-500">{ev.event_type}{ev.is_generic ? ' (generic)' : ''}</span>
                </div>
                <p className="mt-1 text-sm text-stone-400">{ev.description}</p>
                {ev.images?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ev.images.map((img, i) => (
                      <img key={i} src={img} alt="" className="h-16 w-16 rounded border border-dungeon-600 object-cover" />
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-1">
                  <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setEditing({ ...ev, images: ev.images || [] })}>Edit</button>
                  {!ev.is_generic && (
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(ev.id)}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto space-y-3">
            <h3 className="font-semibold">
              Edit Event
              {editing.is_generic && <span className="ml-2 text-sm font-normal text-dungeon-400">(base event)</span>}
            </h3>
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <textarea className="input min-h-24" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <select className="input" value={editing.event_type} onChange={(e) => setEditing({ ...editing, event_type: e.target.value })}>
              {['story', 'puzzle', 'rest', 'generic', 'battle_hook'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {editing.images?.length > 0 ? (
              <div>
                <label className="label">Attached images</label>
                <div className="flex flex-wrap gap-2">
                  {editing.images.map((img, i) => (
                    <img key={i} src={img} alt="" className="h-20 w-20 rounded border border-dungeon-600 object-cover" />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-stone-500">No images yet.</p>
            )}
            <ImageUpload label={uploading ? 'Uploading...' : 'Add image'} onUpload={(file) => uploadImage(editing.id, file)} />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit} disabled={uploading}>Save</button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Event"
          message="Delete this custom event? Campaigns referencing it may break."
          onConfirm={doDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </Layout>
  );
}

import { FlaskConical, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';

/** Mock mode only: make the camera "see" a sample plate. Hidden in production adapters. */
export function DevPanel({ camera }: { camera: 'entry' | 'exit' }) {
  const [plates, setPlates] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    api
      .get<{ mock: boolean; samplePlates: string[] }>('/api/dev')
      .then((d) => setPlates(d.samplePlates))
      .catch(() => setPlates(null));
  }, []);

  if (!plates) return null;
  const see = (plate: string) => {
    void api.post('/api/dev/lpr', { camera, plate });
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        aria-label="Test tools"
        onClick={() => setOpen(true)}
        className="fixed bottom-2 left-2 z-40 flex items-center gap-1 rounded-lg bg-purple-700 px-2 py-1 text-sm font-semibold text-white opacity-70"
      >
        <FlaskConical className="size-4" /> Test
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-panel p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Test: {camera} camera sees…</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="size-7" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {plates.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => see(p)}
                  className="rounded-lg bg-slate-200 px-3 py-3 font-mono text-lg font-bold active:bg-slate-300"
                >
                  {p}
                </button>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) see(custom.trim());
              }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Other plate"
                className="min-w-0 flex-1 rounded-lg border-2 border-slate-300 px-3 py-2 font-mono text-lg"
              />
              <button type="submit" className="rounded-lg bg-purple-700 px-4 font-bold text-white">
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

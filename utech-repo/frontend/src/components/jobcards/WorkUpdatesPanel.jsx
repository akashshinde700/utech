import { useEffect, useState } from 'react';
import { Send, MessageSquare, ClipboardEdit, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { datetime } from '../../lib/format';
import EmptyState from '../ui/EmptyState';
import { styles } from '../../lib/formStyles';
import toast from 'react-hot-toast';

const KINDS = [
  { key: 'WORK_UPDATE', label: 'Work Update', icon: ClipboardEdit },
  { key: 'COMMENT', label: 'Comment', icon: MessageSquare },
];

export default function WorkUpdatesPanel({ jobcardId, editable }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('WORK_UPDATE');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/jobcards/${jobcardId}/notes`);
      setNotes(r.data);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [jobcardId]);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/jobcards/${jobcardId}/notes`, { kind, body: body.trim() });
      setBody('');
      toast.success('Added');
      load();
    } catch {} finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {editable && (
        <form onSubmit={submit} className="mb-4 space-y-2">
          <div className="flex gap-1">
            {KINDS.map((k) => (
              <button
                key={k.key} type="button"
                onClick={() => setKind(k.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${kind === k.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className={styles.input}
              placeholder={kind === 'WORK_UPDATE' ? 'e.g. Login module completed' : 'e.g. Waiting for client confirmation'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <button className={`${styles.primaryBtn} !px-3 shrink-0`} disabled={busy || !body.trim()} aria-label="Add update">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
        </form>
      )}
      <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No updates yet"
            description="Work updates and comments posted here will show on the jobcard timeline."
            className="py-8"
          />
        ) : notes.map((n) => {
          const K = KINDS.find((k) => k.key === n.kind) || KINDS[0];
          const Icon = K.icon;
          return (
            <div key={n.id} className="flex items-start gap-2 text-sm bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              <Icon className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-slate-700">{n.body}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{n.author?.name || 'Unknown'} • {datetime(n.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

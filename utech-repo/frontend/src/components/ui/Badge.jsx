import { STATUS_COLORS } from '../../lib/format';

const STATUS_ICONS = {};

// Fallback tone for statuses that have no explicit mapping — keeps the badge
// readable instead of invisible. Checked after STATUS_COLORS so any key added
// to format.js always wins.
const FALLBACK_TONE = 'bg-slate-100 text-slate-600';

// format.js still stores some tones with raw tailwind palettes that this app's
// config aliases or that the wave-D palette contract forbids (blue/indigo/
// purple render near-violet, emerald renders VIOLET via config alias, teal
// renders ORANGE, cyan renders PINK). Badge is the single shared renderer for
// every status chip, so the translation happens here once: each status keeps
// its semantic hue, expressed with the real brand/success/danger/warning/slate
// tokens. Unmapped tones pass through unchanged (e.g. the slate + success
// entries format.js already defines with tokens).
const TONE_TOKENS = {
  'bg-blue-100 text-blue-700': 'bg-brand-100 text-brand-700',
  'bg-indigo-100 text-indigo-700': 'bg-brand-100 text-brand-700',
  'bg-purple-100 text-purple-700': 'bg-brand-100 text-brand-700',
  'bg-cyan-100 text-cyan-700': 'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700': 'bg-success-100 text-success-700',
  'bg-red-100 text-red-700': 'bg-danger-100 text-danger-700',
  'bg-amber-100 text-amber-700': 'bg-warning-100 text-warning-700',
  'bg-orange-100 text-orange-700': 'bg-warning-100 text-warning-700',
  'bg-teal-100 text-teal-700': 'bg-warning-100 text-warning-700',
};
const tokenTone = (tone) => TONE_TOKENS[tone] || tone;

// "PARTIALLY_PAID" → "Partially Paid" — used only when the caller passes no
// children; every page that formats its own label keeps working unchanged.
const prettify = (s) =>
  String(s || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());

export default function Badge({ status, children }) {
  const colorClass = tokenTone(STATUS_COLORS[status] || FALLBACK_TONE);
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${colorClass}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {children || prettify(status)}
    </span>
  );
}

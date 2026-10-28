import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Decimal from 'decimal.js';
import {
  Calculator, Circle, CircleDot, Square, Frame, RectangleHorizontal, Hexagon,
  Layers, CornerDownLeft, Columns3, Container, Type, Ruler, Scale, Copy,
  RotateCcw, Save, History, Info, Loader2, Trash2, Search,
} from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { inr } from '../../lib/format';

// Metal weight & price calculator, ported from "Metal Calculator" v11.2
// (com.pixelsdo.metalweightcalculator). The maths lives on the server
// (backend/src/services/metalCalculator.js) so the same numbers are available
// to any future document integration; this page only collects input, calls
// POST /api/metal-calculator/calculate and renders the answer.
//
// Read-only by design: nothing here touches stock, invoices or quotations. A
// user copies the numbers into the document they are actually preparing.

const SHAPE_ICONS = {
  roundbar: Circle,
  pipe: CircleDot,
  squarebar: Square,
  squaretube: Frame,
  flatbar: RectangleHorizontal,
  hexagon: Hexagon,
  sheet: Layers,
  angle: CornerDownLeft,
  beam: Columns3,
  channel: Container,
  tprofile: Type,
};

const HISTORY_KEY = 'utech.metalCalc.history';
const HISTORY_LIMIT = 15;

const fmt = (n, digits = 3) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtInt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(rows) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, HISTORY_LIMIT)));
  } catch {
    // storage disabled/full — history is a convenience, never a source of truth
  }
}

export default function MetalCalculatorPage({ embedded = false, initialMetal = '', onApply }) {
  const [catalog, setCatalog] = useState(null);
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [shapeId, setShapeId] = useState('roundbar');
  const [mode, setMode] = useState('weight');
  const [system, setSystem] = useState('metric');
  const [unit, setUnit] = useState('mm');
  const [weightUnit, setWeightUnit] = useState('kg');
  const [metalName, setMetalName] = useState(initialMetal || 'Steel');
  const [customDensity, setCustomDensity] = useState('');
  const [values, setValues] = useState({});
  const [pieces, setPieces] = useState('1');
  const [rate, setRate] = useState('');
  const [totalWeight, setTotalWeight] = useState('');
  const [errors, setErrors] = useState({});

  const [profileRegion, setProfileRegion] = useState('');
  const [profileFamily, setProfileFamily] = useState('');
  const [profileName, setProfileName] = useState('');
  const [manualKgm, setManualKgm] = useState('');

  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(readHistory);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cat, prof] = await Promise.all([
          api.get('/metal-calculator/catalog'),
          api.get('/metal-calculator/profiles'),
        ]);
        if (!alive) return;
        setCatalog(cat.data);
        setFamilies(prof.data.families || []);
      } catch (err) {
        if (alive) setLoadError(err.response?.data?.message || 'Could not load the metal calculator');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shapes = useMemo(() => catalog?.shapes || [], [catalog]);
  const metals = useMemo(() => catalog?.metals || [], [catalog]);
  const shape = useMemo(() => shapes.find((s) => s.id === shapeId) || null, [shapes, shapeId]);
  const metal = useMemo(() => metals.find((m) => m.name === metalName) || null, [metals, metalName]);

  const units = system === 'metric' ? catalog?.units?.metric || ['mm'] : catalog?.units?.imperial || ['in'];
  const density = customDensity.trim() === '' ? metal?.density ?? null : Number(customDensity);

  const profileFamilies = useMemo(
    () => (shape?.profileShape ? families.filter((f) => f.shape === shape.profileShape) : []),
    [families, shape]
  );
  const regions = useMemo(
    () => [...new Set(profileFamilies.map((f) => f.region))],
    [profileFamilies]
  );
  const familyNames = useMemo(
    () => [...new Set(profileFamilies.filter((f) => f.region === profileRegion).map((f) => f.family))],
    [profileFamilies, profileRegion]
  );
  const designations = useMemo(() => {
    const family = profileFamilies.find((f) => f.region === profileRegion && f.family === profileFamily);
    return family?.profiles || [];
  }, [profileFamilies, profileRegion, profileFamily]);
  const selectedProfile = useMemo(
    () => designations.find((p) => p.name === profileName) || null,
    [designations, profileName]
  );

  const tableKgm = manualKgm.trim() !== '' ? Number(manualKgm) : selectedProfile?.kgm ?? null;
  const usingTable = !!shape?.standard && Number.isFinite(tableKgm) && tableKgm > 0;
  const canUseLengthMode = !!shape?.supportsLengthMode;

  function resetProfile() {
    setProfileRegion('');
    setProfileFamily('');
    setProfileName('');
    setManualKgm('');
  }

  function chooseShape(nextId) {
    setShapeId(nextId);
    setValues({});
    setErrors({});
    setResult(null);
    resetProfile();
    const next = shapes.find((s) => s.id === nextId);
    if (mode === 'length' && !next?.supportsLengthMode) setMode('weight');
  }

  function switchSystem(next) {
    setSystem(next);
    setUnit(next === 'metric' ? 'mm' : 'in');
    setWeightUnit(next === 'metric' ? 'kg' : 'lb');
    setValues({});
    setErrors({});
    setResult(null);
  }

  function setField(key, value) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    // a result computed from the previous numbers must never look like the
    // answer to the numbers currently on screen
    setResult(null);
  }

  function isFieldRequired(field) {
    if (usingTable && !field.isLength) return false;
    if (mode === 'length' && field.isLength) return false;
    return true;
  }

  function validate() {
    if (!shape) return false;
    const next = {};
    shape.fields.filter(isFieldRequired).forEach((f) => {
      const n = Number(values[f.id]);
      if (!Number.isFinite(n) || n <= 0) next[f.id] = `${f.label} must be greater than 0`;
    });
    if (mode === 'length') {
      const w = Number(totalWeight);
      if (!Number.isFinite(w) || w <= 0) next.totalWeight = 'Enter the weight to convert';
    }
    if (customDensity.trim() !== '') {
      const d = Number(customDensity);
      if (!Number.isFinite(d) || d <= 0 || d > 30) next.density = 'Density must be between 0 and 30 g/cm³';
    }
    if (manualKgm.trim() !== '') {
      const k = Number(manualKgm);
      if (!Number.isFinite(k) || k <= 0) next.manualKgm = 'kg/m must be greater than 0';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function calculate() {
    if (!shape || !density) {
      toast.error('Pick a metal or enter a density');
      return;
    }
    if (!validate()) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const payload = {
        mode,
        shape: shape.id,
        unit,
        weightUnit,
        metal: metal?.name,
        density: customDensity.trim() === '' ? undefined : Number(customDensity),
        values: Object.fromEntries(
          shape.fields
            .filter((f) => values[f.id] !== '' && values[f.id] != null)
            .map((f) => [f.id, Number(values[f.id])])
        ),
        pieces: Math.max(1, parseInt(pieces, 10) || 1),
        rate: rate === '' ? null : Number(rate),
      };
      if (mode === 'length') payload.totalWeight = Number(totalWeight);
      if (usingTable) payload.standardProfile = { name: manualKgm.trim() !== '' ? `Manual — ${tableKgm} kg/m` : selectedProfile?.name || 'Table value', kgm: tableKgm };

      const res = await api.post('/metal-calculator/calculate', payload);
      setResult(res.data);
    } catch (err) {
      // api.js already toasted the server message; keep the page state intact
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function applyToItem(includeRate = false) {
    if (!result || !onApply) return;
    const itemMetal = metals.find((m) => m.name === result.metal?.name);
    if (!itemMetal || Math.abs(itemMetal.density - result.density) > 1e-9 || result.standardProfile) {
      toast.error('Item weight needs catalogue metal and dimensions. Custom density and profile table weights cannot be saved on an item.');
      return;
    }
    const fields = result.dimensions.map((d) => {
      const n = result.mode === 'length' && d.isLength ? result.lengthMm : d.value;
      const u = result.mode === 'length' && d.isLength ? 'mm' : d.unit;
      // The persisted size uses plain decimal notation, not scientific notation.
      const text = String(n);
      return Number.isFinite(n) && n > 0 && /^\d+(?:\.\d+)?$/.test(text) ? `${text} ${u}` : null;
    });
    if (fields.some((v) => !v)) {
      toast.error('Dimensions or calculated length cannot be saved at this precision.');
      return;
    }
    const size = `Calculator ${result.shape.id}: ${fields.join(' X ')}`;
    if (size.length > 191) { toast.error('Dimensions are too long to save as a material size.'); return; }
    setApplying(true);
    try {
      const preview = await api.post('/items/weight-preview', { size, metal: itemMetal.name });
      if (preview.data.weightKg == null) {
        toast.error('This size cannot be calculated as an item. Check the dimensions.');
        return;
      }
      // The item stores INR/kg at two decimal places, regardless of the
      // calculator's selected output weight unit. Do not overwrite an existing
      // item rate unless the user explicitly requests it.
      const ratePerKg = includeRate && result.rate != null
        ? new Decimal(result.rate).times(result.rateUnit === 'lb' ? catalog.constants.kgToLb : 1).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
        : null;
      onApply(size, itemMetal.name, ratePerKg);
      toast.success('Material size and metal applied. Save the item to keep them.');
    } catch {
      toast.error('Could not verify item weight. Please try again.');
    } finally { setApplying(false); }
  }

  function resultText(r) {
    const lines = [
      `${r.shape.label} — ${r.metal?.name || 'custom'} (ρ ${r.density} g/cm³)`,
      `Dimensions: ${r.dimensions.map((d) => `${d.symbol} ${d.value ?? '—'} ${d.unit}`).join(' × ')}`,
      r.standardProfile ? `Table: ${r.standardProfile.name || 'profile'} @ ${r.standardProfile.kgm} kg/m` : null,
      r.pieces > 1 ? `Pieces: ${r.pieces}` : null,
      r.pieceWeight != null ? `Piece weight: ${fmt(r.pieceWeight)} ${r.weightUnit}` : null,
      `Total weight: ${fmt(r.totalWeight)} ${r.weightUnit}`,
      r.totalLength != null ? `Length: ${fmt(r.totalLength)} ${r.lengthUnit}` : null,
      r.totalPrice != null ? `Total price: ${inr(r.totalPrice)}` : null,
      `Formula: ${r.shape.formula}`,
    ];
    return lines.filter(Boolean).join('\n');
  }

  async function copyResult() {
    if (!result) return;
    const text = resultText(result);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success('Copied');
      } else {
        toast.error('Clipboard is not available in this browser');
      }
    } catch {
      toast.error('Could not copy');
    }
  }

  function saveResult() {
    if (!result) return;
    const row = {
      at: new Date().toISOString(),
      shape: result.shape.label,
      metal: result.metal?.name || 'Custom',
      dimensions: result.dimensions.map((d) => `${d.symbol} ${d.value ?? '—'}`).join(' × ') + ` ${result.unit}`,
      totalWeight: result.totalWeight,
      totalWeightKg: result.totalWeightKg,
      weightUnit: result.weightUnit,
      totalPrice: result.totalPrice,
      totalLength: result.totalLength,
      lengthUnit: result.lengthUnit,
      payload: {
        mode, shape: shapeId, unit, weightUnit, metal: metal?.name, density: customDensity,
        values, pieces, rate, totalWeight, manualKgm, profileName, profileRegion, profileFamily,
      },
    };
    const next = [row, ...history].slice(0, HISTORY_LIMIT);
    setHistory(next);
    writeHistory(next);
    toast.success('Saved to this browser');
  }

  function restore(row) {
    const p = row.payload || {};
    setShapeId(p.shape || 'roundbar');
    setMode(p.mode || 'weight');
    setUnit(p.unit || 'mm');
    setSystem(['mm', 'cm', 'm'].includes(p.unit) ? 'metric' : 'imperial');
    setWeightUnit(p.weightUnit || 'kg');
    setMetalName(p.metal || 'Steel');
    setCustomDensity(p.density || '');
    setValues(p.values || {});
    setPieces(p.pieces || '1');
    setRate(p.rate ?? '');
    setTotalWeight(p.totalWeight ?? '');
    setManualKgm(p.manualKgm || '');
    setProfileRegion(p.profileRegion || '');
    setProfileFamily(p.profileFamily || '');
    setProfileName(p.profileName || '');
    setResult(null);
    toast.success('Loaded from history — press Calculate');
  }

  function clearHistory() {
    setHistory([]);
    writeHistory([]);
  }

  function resetAll() {
    setValues({});
    setPieces('1');
    setRate('');
    setTotalWeight('');
    setCustomDensity('');
    setErrors({});
    setResult(null);
    resetProfile();
    toast.success('Cleared');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading calculator…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <div className="mb-2 text-lg font-semibold text-slate-900">Calculator unavailable</div>
        <p className="text-sm text-slate-500">{loadError}</p>
      </div>
    );
  }

  const isLengthMode = mode === 'length';

  return (
    <div>
      {!embedded && <PageHeader
        title="Metal Calculator"
        subtitle="Weight and price from shape + metal density — ported from the Metal Calculator APK"
        icon={Calculator}
        actions={(
          <div className="flex items-center gap-2">
            <button type="button" className={styles.secondaryBtn} onClick={resetAll}>
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
          </div>
        )}
      />}
      {embedded && <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-slate-600">Full Metal Calculator — apply dimensions and catalogue metal to one item piece.</p><button type="button" className={styles.secondaryBtn} disabled={busy || applying} onClick={resetAll}>Reset</button></div>}

      <div className="grid items-start gap-4 lg:grid-cols-5">
        {/* ---------------- inputs ---------------- */}
        <section className="card p-4 sm:p-5 lg:col-span-3">
          <fieldset disabled={busy}>
          {embedded && <div className="mb-3"><label className={styles.label} htmlFor="mc-shape">Material shape</label><select id="mc-shape" className={styles.input} value={shapeId} onChange={(e) => chooseShape(e.target.value)}>{shapes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>}
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shapes.map((s) => {
              const Icon = SHAPE_ICONS[s.id] || Calculator;
              const active = s.id === shapeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseShape(s.id)}
                  className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center text-[11px] font-medium transition ${
                    active
                      ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-600'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <span className={styles.label}>Calculate</span>
              {embedded && <select aria-label="Calculate" className={`${styles.input} mb-2`} value={mode} onChange={(e) => { setMode(e.target.value); setResult(null); }}><option value="weight">Weight (enter length)</option><option value="length" disabled={!canUseLengthMode}>Length (enter weight)</option></select>}
              <div className="flex gap-2">
                {[
                  { id: 'weight', label: 'By weight' },
                  { id: 'length', label: 'By length', disabled: !canUseLengthMode },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={m.disabled}
                    onClick={() => { setMode(m.id); setResult(null); }}
                    className={`h-10 flex-1 rounded-lg border text-sm font-medium transition ${
                      mode === m.id
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    } ${m.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {isLengthMode && (
                <p className="mt-1 text-[11px] text-slate-400">Enter the weight you have; length is calculated.</p>
              )}
            </div>
            <div>
              <span className={styles.label}>Unit system</span>
              {embedded && <select aria-label="Unit system" className={`${styles.input} mb-2`} value={system} onChange={(e) => switchSystem(e.target.value)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select>}
              <div className="flex gap-2">
                {[
                  { id: 'metric', label: 'Metric' },
                  { id: 'imperial', label: 'Imperial' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => switchSystem(s.id)}
                    className={`h-10 flex-1 rounded-lg border text-sm font-medium transition ${
                      system === s.id
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={styles.label} htmlFor="mc-unit">Dimension unit</label>
              <select id="mc-unit" className={styles.input} value={unit} onChange={(e) => { setUnit(e.target.value); setResult(null); }}>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="mc-metal">Metal</label>
              <SearchableSelect
                id="mc-metal"
                value={metalName}
                onChange={(v) => { setMetalName(v); setResult(null); }}
                options={metals.map((m) => ({ value: m.name, label: m.name, subtitle: `${m.density} g/cm³ · ${m.group}` }))}
                allowClear={false}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={styles.label} htmlFor="mc-density">
                Density <span className="normal-case text-slate-400">(g/cm³)</span>
              </label>
              <input
                id="mc-density"
                type="number"
                min="0"
                step="0.01"
                className={`${styles.input} ${errors.density ? styles.inputError : ''}`}
                placeholder={metal ? String(metal.density) : '7.85'}
                value={customDensity}
                onChange={(e) => { setCustomDensity(e.target.value); setResult(null); }}
              />
              {errors.density && <p className={styles.errorText}>{errors.density}</p>}
            </div>
            <div>
              <label className={styles.label} htmlFor="mc-pieces">Pieces</label>
              <input
                id="mc-pieces"
                type="number"
                min="1"
                step="1"
                className={styles.input}
                value={isLengthMode ? '1' : pieces}
                disabled={isLengthMode}
                onChange={(e) => { setPieces(e.target.value); setResult(null); }}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="mc-rate">
                Rate <span className="normal-case text-slate-400">(₹ per {weightUnit})</span>
              </label>
              <input
                id="mc-rate"
                type="number"
                min="0"
                step="0.01"
                className={styles.input}
                placeholder="optional"
                value={rate}
                onChange={(e) => { setRate(e.target.value); setResult(null); }}
              />
            </div>
          </div>

          {/* standard profile picker */}
          {shape?.standard && (
            <div className="mt-4 rounded-xl border border-dashed border-brand-300 bg-brand-50/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-700">
                  <Search className="h-3.5 w-3.5" /> Standard profile table
                </span>
                {(profileName || manualKgm) && (
                  <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => { resetProfile(); setResult(null); }}>
                    Clear
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  aria-label="Region"
                  className={styles.input}
                  value={profileRegion}
                  onChange={(e) => { setProfileRegion(e.target.value); setProfileFamily(''); setProfileName(''); setResult(null); }}
                >
                  <option value="">Region / standard</option>
                  {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select
                  aria-label="Series"
                  className={styles.input}
                  value={profileFamily}
                  disabled={!profileRegion}
                  onChange={(e) => { setProfileFamily(e.target.value); setProfileName(''); setResult(null); }}
                >
                  <option value="">Series</option>
                  {familyNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  aria-label="Designation"
                  className={styles.input}
                  value={profileName}
                  disabled={!profileFamily}
                  onChange={(e) => { setProfileName(e.target.value); setResult(null); }}
                >
                  <option value="">Designation…</option>
                  {designations.map((p) => <option key={p.name} value={p.name}>{p.name} — {p.kgm} kg/m</option>)}
                </select>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className={styles.label} htmlFor="mc-manual-kgm">Or type kg/m from your steel table</label>
                  <input
                    id="mc-manual-kgm"
                    type="number"
                    min="0"
                    step="0.001"
                    className={`${styles.input} ${errors.manualKgm ? styles.inputError : ''}`}
                    placeholder={selectedProfile ? String(selectedProfile.kgm) : 'e.g. 22.4'}
                    value={manualKgm}
                    onChange={(e) => { setManualKgm(e.target.value); setResult(null); }}
                  />
                  {errors.manualKgm && <p className={styles.errorText}>{errors.manualKgm}</p>}
                </div>
                <p className="self-end text-[11px] leading-snug text-slate-500">
                  Table values are the APK&apos;s own numbers. Always verify a series against your
                  standard before quoting — see the known-limitations note in the docs.
                </p>
              </div>
              {usingTable && (
                <p className="mt-2 rounded-lg bg-white px-2 py-1.5 text-[11px] font-medium text-brand-700">
                  Using {tableKgm} kg/m{selectedProfile && manualKgm.trim() === '' ? ` (${selectedProfile.name})` : ''} — section dimensions are not needed, only the length.
                </p>
              )}
            </div>
          )}

          {/* dimensions */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Ruler className="h-3.5 w-3.5" /> Dimensions ({unit})
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {shape?.fields?.map((f) => {
                const disabled = (usingTable && !f.isLength) || (isLengthMode && f.isLength);
                const req = isFieldRequired(f);
                return (
                  <div key={f.id}>
                    <label className={styles.label} htmlFor={`mc-${f.id}`}>
                      {f.label}
                      {!req && <span className="ml-1 normal-case text-slate-400">(not needed)</span>}
                    </label>
                    <input
                      id={`mc-${f.id}`}
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      className={`${styles.input} ${errors[f.id] ? styles.inputError : ''}`}
                      value={values[f.id] ?? ''}
                      disabled={disabled}
                      placeholder={disabled ? '—' : '0'}
                      onChange={(e) => setField(f.id, e.target.value)}
                    />
                    {errors[f.id] && <p className={styles.errorText}>{errors[f.id]}</p>}
                  </div>
                );
              })}
              {isLengthMode && (
                <div>
                  <label className={styles.label} htmlFor="mc-total-weight">
                    Weight available ({weightUnit})
                  </label>
                  <input
                    id="mc-total-weight"
                    type="number"
                    min="0"
                    step="0.001"
                    className={`${styles.input} ${errors.totalWeight ? styles.inputError : ''}`}
                    value={totalWeight}
                    onChange={(e) => { setTotalWeight(e.target.value); setResult(null); }}
                  />
                  {errors.totalWeight && <p className={styles.errorText}>{errors.totalWeight}</p>}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" className={styles.primaryBtn} onClick={calculate} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
              Calculate
            </button>
            {embedded && <div><label className="sr-only" htmlFor="mc-weight-unit">Weight unit</label><select id="mc-weight-unit" className={styles.input} value={weightUnit} onChange={(e) => { setWeightUnit(e.target.value); setResult(null); }}>{catalog?.weightUnits?.map((w) => <option key={w} value={w}>{w}</option>)}</select></div>}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
              {catalog?.weightUnits?.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => { setWeightUnit(w); setResult(null); }}
                  className={`h-8 rounded-md px-3 text-xs font-semibold uppercase transition ${
                    weightUnit === w ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400">{shape?.formula}</span>
          </div>
          </fieldset>
        </section>

        {/* ---------------- result ---------------- */}
        <aside className="space-y-4 lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Calculator className="h-4 w-4 text-brand-600" /> Result
              </div>
              {result && (
                <div className="flex items-center gap-1">
                  <button type="button" className="btn-icon" title="Copy result" onClick={copyResult}>
                    <Copy className="h-4 w-4" />
                  </button>
                  <button type="button" className="btn-icon" title="Save to history" onClick={saveResult}>
                    <Save className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {!result ? (
              <div className="px-4 py-12 text-center text-sm text-slate-400">
                <Scale className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                Fill in the dimensions and press <span className="font-medium text-slate-600">Calculate</span>.
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="badge bg-brand-50 text-brand-700">{result.shape.label}</span>
                  <span className="badge bg-slate-100 text-slate-600">{result.metal?.name || 'Custom density'}</span>
                  <span className="badge bg-slate-100 text-slate-600">ρ {result.density} g/cm³</span>
                  {result.standardProfile && (
                    <span className="badge bg-warning-100 text-warning-700">table {result.standardProfile.kgm} kg/m</span>
                  )}
                </div>

                <div className="rounded-xl bg-slate-900 px-4 py-3 text-white">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Total weight</div>
                  <div className="text-3xl font-extrabold tracking-tight">
                    {fmt(result.totalWeight)} <span className="text-base font-semibold text-slate-300">{result.weightUnit}</span>
                  </div>
                  {result.totalPrice != null && (
                    <div className="mt-1 text-sm font-semibold text-emerald-300">{inr(result.totalPrice)}</div>
                  )}
                </div>

                {embedded && <div className="mt-3 rounded-lg bg-brand-50 p-3 text-xs text-slate-600">
                  <p>Apply saves size and catalogue metal for one piece. Item weight is recalculated in kg; quantity is not applied. Calculated length is rounded to 0.01 mm. You can optionally apply the rate per kg (rounded to ₹0.01).</p>
                  {(result.standardProfile || !result.metal || Math.abs((metals.find((m) => m.name === result.metal?.name)?.density ?? -1) - result.density) > 1e-9) ? <p className="mt-2 text-amber-700">Custom density or standard profile results cannot be saved as item weight. Use catalogue density and dimensions to apply.</p> : <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={styles.secondaryBtn} disabled={applying} onClick={() => applyToItem(false)}>{applying ? 'Checking…' : 'Use this material size'}</button>{result.rate != null && <button type="button" className={styles.secondaryBtn} disabled={applying} onClick={() => applyToItem(true)}>Use size and rate per kg</button>}</div>}
                </div>}
                <dl className="mt-3 space-y-1.5 text-sm">
                  {result.pieceWeight != null && (
                    <Row label="Piece weight" value={`${fmt(result.pieceWeight)} ${result.weightUnit}`} />
                  )}
                  <Row label={`Weight per metre`} value={result.kgPerMeter != null ? `${fmt(result.kgPerMeter)} kg/m` : '—'} />
                  {result.lbPerFoot != null && <Row label="Weight per foot" value={`${fmt(result.lbPerFoot)} lb/ft`} />}
                  {result.areaMm2 != null && <Row label="Section area" value={`${fmt(result.areaMm2, 2)} mm²`} />}
                  {result.totalLength != null && (
                    <Row label={result.mode === 'length' ? 'Length' : 'Total length'} value={`${fmt(result.totalLength)} ${result.lengthUnit}`} />
                  )}
                  {result.mode === 'weight' && result.pieces > 1 && <Row label="Pieces" value={fmtInt(result.pieces)} />}
                  {result.rate != null && <Row label={`Rate`} value={`${inr(result.rate)} / ${result.rateUnit}`} />}
                </dl>

                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  <span className="font-semibold text-slate-600">Formula:</span> {result.shape.formula}
                  <br />
                  {result.dimensions
                    .filter((d) => d.value != null)
                    .map((d) => `${d.symbol} ${d.value} ${d.unit}`)
                    .join(' × ')}
                </div>

                {result.notes?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.notes.map((n) => (
                      <li key={n} className="flex items-start gap-1 text-[11px] text-slate-500">
                        <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" /> {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* history */}
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <History className="h-4 w-4 text-brand-600" /> Recent (this browser)
              </div>
              {history.length > 0 && (
                <button type="button" className="text-xs font-medium text-slate-400 hover:text-danger-600" onClick={clearHistory}>
                  <Trash2 className="mr-1 inline h-3 w-3" /> Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">Saved calculations appear here.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {history.map((h) => (
                  <li key={h.at}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 py-2 text-left text-xs hover:text-brand-700"
                      disabled={busy || applying}
                      onClick={() => restore(h)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-700">{h.shape} · {h.metal}</span>
                        <span className="block truncate text-[11px] text-slate-400">{h.dimensions}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-slate-700">{fmt(h.totalWeight, 2)} {h.weightUnit}</span>
                        <span className="block text-[11px] text-slate-400">
                          {h.totalPrice != null ? inr(h.totalPrice) : '—'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              History is stored in this browser only. It is not a ledger and is not shared with other users.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

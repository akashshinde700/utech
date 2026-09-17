// Client-side GSTIN derivations — instant form auto-fill, no round trip.
// GSTIN = <2 state code><10 PAN><1 entity><1 'Z'><1 checksum>.
// Kept in sync with backend/src/utils/gstin.js.

export const GST_STATE_BY_CODE = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function deriveFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return {};
  const stateCode = g.slice(0, 2);
  return { stateCode, state: GST_STATE_BY_CODE[stateCode] || '', pan: g.slice(2, 12) };
}

// A short nickname suggestion from a party name: first word (or first two if the
// first is very short), cleaned up. e.g. "Sheetal Dies & Tools Pvt Ltd" -> "Sheetal".
export function suggestNickName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = words[0].replace(/[^A-Za-z0-9&.-]/g, '');
  if (first.length <= 3 && words[1]) return `${first} ${words[1]}`.slice(0, 24);
  return first.slice(0, 24);
}

'use strict';

// Everything that can be derived from a GSTIN with no external lookup.
// A GSTIN is: <2 state code><10 PAN><1 entity no><1 'Z'><1 checksum>.

const STATE_BY_CODE = {
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

// Returns { stateCode, state, pan } for a well-formed GSTIN, else {}.
function deriveFromGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return {};
  const stateCode = g.slice(0, 2);
  return {
    stateCode,
    state: STATE_BY_CODE[stateCode] || null,
    pan: g.slice(2, 12),
  };
}

module.exports = { STATE_BY_CODE, GSTIN_RE, deriveFromGstin };

'use strict';

// Amount → Indian-English words (crore / lakh / thousand). Kept byte-for-byte in
// sync with the frontend copy at frontend/src/lib/numberToWords.js so the screen
// invoice and the printed PDF read identically.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

function threeDigits(n) {
  if (n < 100) return twoDigits(n);
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
}

function amountInWordsINR(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 'Zero Rupees Only';

  const prefix = value < 0 ? 'Minus ' : '';
  const abs = Math.abs(value);

  const totalPaise = Math.round(abs * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  if (rupees === 0 && paise === 0) return prefix + 'Zero Rupees Only';

  const parts = [];
  if (rupees > 0) {
    let n = rupees;
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    const hundred = n;

    if (crore) parts.push(threeDigits(crore) + ' Crore');
    if (lakh) parts.push(threeDigits(lakh) + ' Lakh');
    if (thousand) parts.push(threeDigits(thousand) + ' Thousand');
    if (hundred) parts.push(threeDigits(hundred));
  }

  let words = (parts.length ? parts.join(' ') + ' Rupees' : 'Zero Rupees');
  if (paise) words += ' and ' + twoDigits(paise) + ' Paise';
  return prefix + words + ' Only';
}

module.exports = { amountInWordsINR };

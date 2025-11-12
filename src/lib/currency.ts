const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function formatStripeAmount(
  amountInMinor: number,
  currency: string,
  locale: string = 'ja-JP'
): string {
  const upperCurrency = currency?.toUpperCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(upperCurrency);

  const value = isZeroDecimal ? amountInMinor : amountInMinor / 100;
  const minimumFractionDigits = isZeroDecimal ? 0 : 2;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: upperCurrency,
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits,
  }).format(value);
}

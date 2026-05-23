/**
 * Conservative charge simulator — matches typical Indian discount-broker charges as of 2024.
 * Numbers are approximate; production should reconcile against actual broker contract notes.
 */
export function simulateBrokerage(
  exchange: string,
  qty: number,
  price: number,
  side: 'BUY' | 'SELL',
): number {
  const turnover = qty * price;
  let brokerage = 0;
  let stt = 0;
  const exchTxn = turnover * (exchange === 'NSE' || exchange === 'BSE' ? 0.0000345 : 0.0005);
  let sebi = turnover * 0.000001;
  const gst = (brokerage + exchTxn + sebi) * 0.18;
  let stamp = turnover * (side === 'BUY' ? 0.00003 : 0);

  if (exchange === 'NSE' || exchange === 'BSE') {
    brokerage = Math.min(20, turnover * 0.0003);
    stt = side === 'SELL' ? turnover * 0.001 : 0;
  } else if (exchange === 'NFO' || exchange === 'BFO') {
    brokerage = 20;
    stt = side === 'SELL' ? turnover * 0.0005 : 0;
    sebi = turnover * 0.000001;
    stamp = side === 'BUY' ? turnover * 0.00003 : 0;
  } else if (exchange === 'MCX') {
    brokerage = 20;
    stt = side === 'SELL' ? turnover * 0.0001 : 0;
  }

  return Math.round((brokerage + stt + exchTxn + sebi + gst + stamp) * 100) / 100;
}

export const EXPECTED_PAYMENT_AMOUNT_HEADER = "X-Crux-Expected-Amount-Atomic";

interface HeaderReader {
  get(name: string): string | null;
}

export function expectedPaymentAmountMismatch(
  headers: HeaderReader,
  actualAmountAtomic: string,
) {
  const expectedAmountAtomic = headers.get(EXPECTED_PAYMENT_AMOUNT_HEADER);
  return expectedAmountAtomic !== null && expectedAmountAtomic !== actualAmountAtomic;
}

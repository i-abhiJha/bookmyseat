import { randomUUID } from 'crypto';

// Mock payment gateway. Deterministic for tests: method 'declined-card' (or a
// non-positive amount) fails, everything else succeeds. Swap this for a real
// PSP call later.
export async function charge({ amount, method = 'card' }) {
  if (amount <= 0) {
    return { success: false, reason: 'invalid_amount' };
  }
  if (method === 'declined-card') {
    return { success: false, reason: 'card_declined' };
  }
  return { success: true, reference: `pay_${randomUUID()}` };
}

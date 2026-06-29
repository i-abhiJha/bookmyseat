import { useEffect, useState } from 'react';

// Counts down to `expiresAt` (ISO string); calls onExpire once when it hits 0.
export default function CountdownTimer({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt));

  useEffect(() => {
    const id = setInterval(() => {
      const left = msLeft(expiresAt);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 500);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const total = Math.max(0, Math.ceil(remaining / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  const urgent = total <= 30;

  return (
    <span className={`countdown ${urgent ? 'urgent' : ''}`}>
      ⏳ {mm}:{ss}
    </span>
  );
}

const msLeft = (iso) => new Date(iso).getTime() - Date.now();

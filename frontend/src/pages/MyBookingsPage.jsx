import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const inr = (n) => '₹' + n.toLocaleString('en-IN');

const STATUS_CLASS = {
  CONFIRMED: 'ok',
  PENDING: 'warn',
  CANCELLED: 'muted',
  EXPIRED: 'muted',
};

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/bookings/me')
      .then(({ data }) => setBookings(data.bookings))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="container">Loading…</div>;

  return (
    <div className="container">
      <h1>My Bookings</h1>
      {bookings.length === 0 && <p className="muted">No bookings yet.</p>}
      <div className="booking-list">
        {bookings.map((b) => (
          <div key={b._id} className="booking-row">
            <div>
              <span className={`pill ${STATUS_CLASS[b.status] || ''}`}>{b.status}</span>
              <span className="muted"> · {new Date(b.createdAt).toLocaleString()}</span>
            </div>
            <div className="seats-line">
              {b.seats.map((s) => (typeof s === 'object' ? `${s.section} ${s.label}` : s)).join(', ')}
            </div>
            <div className="total">{inr(b.totalAmount)}</div>
            {b.paymentRef && <div className="muted small">Ref: {b.paymentRef}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

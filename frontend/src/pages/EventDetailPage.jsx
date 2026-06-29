import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import SeatMap from '../components/SeatMap.jsx';
import CountdownTimer from '../components/CountdownTimer.jsx';

const inr = (n) => '₹' + n.toLocaleString('en-IN');

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [event, setEvent] = useState(null);
  const [seats, setSeats] = useState([]);
  const [selected, setSelected] = useState(new Map()); // id -> seat
  const [booking, setBooking] = useState(null); // active hold
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(null);

  const loadSeatMap = useCallback(async () => {
    const [{ data: evData }, { data: mapData }] = await Promise.all([
      api(`/events/${id}`, { auth: false }),
      api(`/events/${id}/seats`, { auth: false }),
    ]);
    setEvent(evData.event);
    setSeats(mapData.seats);
  }, [id]);

  useEffect(() => {
    loadSeatMap().catch((e) => setError(e.message));
  }, [loadSeatMap]);

  function toggle(seat) {
    const next = new Map(selected);
    if (next.has(seat._id)) next.delete(seat._id);
    else next.set(seat._id, seat);
    setSelected(next);
  }

  const selectedSeats = [...selected.values()];
  const total = selectedSeats.reduce((s, x) => s + x.price, 0);

  async function hold() {
    if (!user) return navigate('/login');
    setError(null);
    setBusy(true);
    try {
      const { data } = await api('/bookings/hold', {
        method: 'POST',
        body: { eventId: id, seatIds: selectedSeats.map((s) => s._id) },
      });
      setBooking(data.booking);
      setSelected(new Map());
      await loadSeatMap(); // reflect HELD seats for everyone
    } catch (e) {
      setError(e.message + (e.status === 409 ? ' — someone grabbed a seat first.' : ''));
      await loadSeatMap();
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      const { data } = await api(`/bookings/${booking._id}/confirm`, {
        method: 'POST',
        body: { paymentMethod: 'card' },
      });
      setConfirmed(data.booking);
      setBooking(null);
      await loadSeatMap();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) {
        setBooking(null); // hold expired
        await loadSeatMap();
      }
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold() {
    if (!booking) return;
    await api(`/bookings/${booking._id}/release`, { method: 'POST' }).catch(() => {});
    setBooking(null);
    await loadSeatMap();
  }

  if (error && !event) return <div className="container error">{error}</div>;
  if (!event) return <div className="container">Loading…</div>;

  return (
    <div className="container">
      <button className="link" onClick={() => navigate('/')}>← All events</button>
      <h1>{event.title}</h1>
      <p className="muted">{event.venue} · {new Date(event.startsAt).toLocaleString()}</p>

      {confirmed && (
        <div className="banner success">
          ✅ Booking confirmed! Ref: <code>{confirmed.paymentRef}</code> ·{' '}
          <button className="link" onClick={() => navigate('/bookings')}>View my bookings</button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <div className="detail-layout">
        <SeatMap seats={seats} selected={new Set(selected.keys())} onToggle={toggle} locked={!!booking} />

        <aside className="summary-panel">
          {booking ? (
            <>
              <h3>Hold active</h3>
              <p>Complete payment before the timer runs out:</p>
              <CountdownTimer
                expiresAt={booking.expiresAt}
                onExpire={() => { setBooking(null); setError('Your hold expired.'); loadSeatMap(); }}
              />
              <p className="total">Total: {inr(booking.totalAmount)}</p>
              <button className="btn btn-primary" disabled={busy} onClick={pay}>
                {busy ? 'Processing…' : 'Pay now'}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={releaseHold}>
                Cancel hold
              </button>
            </>
          ) : (
            <>
              <h3>Your selection</h3>
              {selectedSeats.length === 0 ? (
                <p className="muted">Pick seats from the map.</p>
              ) : (
                <ul className="sel-list">
                  {selectedSeats.map((s) => (
                    <li key={s._id}>{s.section} {s.label} <span className="muted">{inr(s.price)}</span></li>
                  ))}
                </ul>
              )}
              <p className="total">Total: {inr(total)}</p>
              <button className="btn btn-primary" disabled={busy || selectedSeats.length === 0} onClick={hold}>
                {user ? `Hold ${selectedSeats.length || ''} seat(s)` : 'Login to book'}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

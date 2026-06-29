import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

const inr = (n) => '₹' + n.toLocaleString('en-IN');

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/events', { auth: false })
      .then(({ data }) => setEvents(data.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="container">Loading events…</div>;
  if (error) return <div className="container error">{error}</div>;

  return (
    <div className="container">
      <h1>Upcoming Events</h1>
      {events.length === 0 && (
        <p className="muted">No events yet. Run <code>npm run seed</code> in the backend.</p>
      )}
      <div className="event-grid">
        {events.map((ev) => (
          <Link to={`/events/${ev._id}`} key={ev._id} className="event-card">
            <h3>{ev.title}</h3>
            <p className="muted">{ev.venue}</p>
            <p className="muted">{new Date(ev.startsAt).toLocaleString()}</p>
            <div className="event-card-foot">
              <span className="badge">{ev.availableSeats} / {ev.totalSeats} seats left</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export { inr };

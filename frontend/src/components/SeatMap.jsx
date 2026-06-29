// Renders seats grouped by section. Available seats are clickable to toggle
// selection; held/booked seats are disabled. `selected` is a Set of seat ids.
const inr = (n) => '₹' + n.toLocaleString('en-IN');

export default function SeatMap({ seats, selected, onToggle, locked }) {
  const sections = groupBy(seats, 'section');

  return (
    <div className="seatmap">
      <div className="stage">STAGE</div>
      {Object.entries(sections).map(([section, secSeats]) => (
        <div key={section} className="section">
          <div className="section-head">
            <strong>{section}</strong>
            <span className="muted"> · {inr(secSeats[0].price)}</span>
          </div>
          <div className="rows">
            {Object.entries(groupBy(secSeats, (s) => s.label[0])).map(([row, rowSeats]) => (
              <div key={row} className="row">
                <span className="row-label">{row}</span>
                {rowSeats
                  .slice()
                  .sort((a, b) => num(a.label) - num(b.label))
                  .map((seat) => {
                    const isSel = selected.has(seat._id);
                    const cls = isSel ? 'selected' : seat.status.toLowerCase();
                    const clickable = !locked && (seat.status === 'AVAILABLE' || isSel);
                    return (
                      <button
                        key={seat._id}
                        className={`seat ${cls}`}
                        disabled={!clickable}
                        title={`${seat.label} · ${inr(seat.price)}`}
                        onClick={() => clickable && onToggle(seat)}
                      >
                        {num(seat.label)}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="legend">
        <span><i className="seat available" /> Available</span>
        <span><i className="seat selected" /> Selected</span>
        <span><i className="seat held" /> Held</span>
        <span><i className="seat booked" /> Booked</span>
      </div>
    </div>
  );
}

const num = (label) => parseInt(label.slice(1), 10);

function groupBy(arr, key) {
  const fn = typeof key === 'function' ? key : (x) => x[key];
  return arr.reduce((acc, item) => {
    const k = fn(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

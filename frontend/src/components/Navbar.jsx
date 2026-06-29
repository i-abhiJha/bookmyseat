import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="navbar">
      <Link to="/" className="brand">🎟️ BookMySeat</Link>
      <div className="nav-links">
        <Link to="/">Events</Link>
        {user && <Link to="/bookings">My Bookings</Link>}
        {user ? (
          <>
            <span className="nav-user">{user.name}</span>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Logout
            </button>
          </>
        ) : (
          <Link to="/login" className="btn btn-primary">Login</Link>
        )}
      </div>
    </nav>
  );
}

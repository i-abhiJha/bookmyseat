import { createContext, useContext, useEffect, useState } from 'react';
import { api, setTokens, clearTokens, getTokens } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On load, if we have tokens, fetch the current user.
  useEffect(() => {
    const { accessToken } = getTokens();
    if (!accessToken) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { data } = await api('/auth/login', { method: 'POST', auth: false, body: { email, password } });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser(data.user);
  }

  async function register(name, email, password) {
    const { data } = await api('/auth/register', {
      method: 'POST',
      auth: false,
      body: { name, email, password },
    });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser(data.user);
  }

  async function logout() {
    const { refreshToken } = getTokens();
    if (refreshToken) {
      await api('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } }).catch(() => {});
    }
    clearTokens();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

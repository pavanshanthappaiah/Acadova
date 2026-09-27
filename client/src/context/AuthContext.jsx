import React, { createContext, useContext, useState, useEffect } from 'react';
import API from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('studentos_token') || null);
  const [loading, setLoading] = useState(true);

  // Check existing token on initial render
  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = localStorage.getItem('studentos_token');
      if (!storedToken) {
        setLoading(false);
        return;
      }
      try {
        const res = await API.get('/auth/me');
        if (res.data && res.data.success) {
          setUser(res.data.user);
        } else {
          localStorage.removeItem('studentos_token');
          localStorage.removeItem('studentos_user');
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.warn('Session validation failed, clearing token:', err.message);
        localStorage.removeItem('studentos_token');
        localStorage.removeItem('studentos_user');
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    const res = await API.post('/auth/login', { email, password });
    if (res.data && res.data.success) {
      const { token: newToken, user: userData } = res.data;
      localStorage.setItem('studentos_token', newToken);
      localStorage.setItem('studentos_user', JSON.stringify(userData));
      setToken(newToken);
      setUser(userData);
      return userData;
    }
    throw new Error(res.data?.message || 'Login failed');
  };

  /* Single sign-on returns the same token + user payload through the OIDC
     exchange, so the session state is identical to a password login. */
  const loginWithToken = async (newToken, userData) => {
    if (!newToken || !userData) throw new Error('Sign-in response was incomplete.');
    localStorage.setItem('studentos_token', newToken);
    localStorage.setItem('studentos_user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
    return userData;
  };

  const register = async (userData) => {
    const res = await API.post('/auth/register', userData);
    if (res.data && res.data.success) {
      const { token: newToken, user: newUser } = res.data;
      localStorage.setItem('studentos_token', newToken);
      localStorage.setItem('studentos_user', JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      return newUser;
    }
    throw new Error(res.data?.message || 'Registration failed');
  };

  const logout = () => {
    localStorage.removeItem('studentos_token');
    localStorage.removeItem('studentos_user');
    setToken(null);
    setUser(null);
  };

  const updateUser = (updatedData) => {
    setUser((prev) => {
      const next = { ...prev, ...updatedData };
      localStorage.setItem('studentos_user', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!token && !!user,
        login,
        loginWithToken,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to attach JWT token and the browser's timezone.
// The backend runs in its own timezone (Render uses UTC), so every lock/gate
// decision ("can I mark this routine yet?") must be evaluated against the
// student's wall clock. getTimezoneOffset() is minutes BEHIND UTC (IST = -330).
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('studentos_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const isPlainBody =
      config.data == null || (typeof config.data === 'object' && config.data.constructor === Object);
    if (config.method === 'get') {
      config.params = { ...config.params, tzOffsetMinutes };
    } else if (isPlainBody) {
      // Body spread last: an explicit value in the payload wins.
      config.data = { tzOffsetMinutes, ...(config.data || {}) };
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor to handle expired tokens
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token if unauthorized and not on login/register
      if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
        localStorage.removeItem('studentos_token');
        localStorage.removeItem('studentos_user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default API;

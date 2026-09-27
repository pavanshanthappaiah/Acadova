import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from '../components/common/Icons';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/common/AuthShell';
import { Button, Input, Field } from '../components/common/ui';
import API from '../services/api';

export const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sso, setSso] = useState({ configured: false, checked: false });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  /* Single sign-on is offered only when the server reports it configured;
     failures carried back from the provider appear as a normal error. */
  useEffect(() => {
    let cancelled = false;
    API.get('/auth/oidc/providers')
      .then((res) => {
        if (!cancelled) setSso({ configured: !!res.data?.configured, checked: true });
      })
      .catch(() => {
        if (!cancelled) setSso({ configured: false, checked: true });
      });
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get('sso_error');
    if (ssoError) {
      setError(ssoError);
      window.history.replaceState(null, '', window.location.pathname);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthShell
      title="Sign in to Acadova"
      subtitle="Your semester, timetable, attendance, and routines in one place."
      footer={
        <>
          New to Acadova?{' '}
          <Link to="/register" className="font-medium text-accent-strong hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-5 p-3 rounded-md bg-danger-soft border border-danger/25 text-danger text-xs flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@college.edu"
          />
        </Field>

        <Field label="Password">
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 px-3 text-2xs font-medium text-ink-400 hover:text-ink-600"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>

        <Button type="submit" disabled={loading} className="w-full !h-10">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {sso.configured && (
        <>
          <div className="my-5 flex items-center gap-3" role="separator" aria-label="or">
            <span className="h-px flex-1 bg-line" />
            <span className="text-2xs uppercase tracking-wide2 text-ink-400">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <a href="/api/auth/oidc/start" className="block">
            <Button variant="secondary" className="w-full !h-10" type="button">
              Continue with single sign-on
            </Button>
          </a>
          <p className="mt-2 text-center text-2xs text-ink-400">
            Uses your institution or company account.
          </p>
        </>
      )}
    </AuthShell>
  );
};

export default Login;

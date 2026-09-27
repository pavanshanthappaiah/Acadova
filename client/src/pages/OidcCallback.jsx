import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/common/AuthShell';
import { StateNote, Button } from '../components/common/ui';

/* The identity provider lands back on this route with a one-time token in
   the URL fragment (#token=...). Fragments are not sent to servers, logged
   in history, or leaked via referers — safer than a query parameter. The
   token is redeemed exactly once for the standard JWT + user payload. */
export const OidcCallback = () => {
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return undefined;
    ran.current = true;

    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    // The fragment has served its purpose; remove it from the address bar.
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setError('No sign-in token was provided. Please start again from the sign-in page.');
      return undefined;
    }

    (async () => {
      try {
        const res = await API.post('/auth/oidc/exchange', { token });
        if (res.data?.success) {
          await loginWithToken(res.data.token, res.data.user);
          navigate('/', { replace: true });
          return;
        }
        setError(res.data?.message || 'Single sign-on could not be completed.');
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Single sign-on could not be completed.');
      }
    })();
    return undefined;
  }, [navigate, loginWithToken]);

  return (
    <AuthShell
      title="Completing sign in"
      subtitle="Finishing your single sign-on."
      footer={
        <Link to="/login" className="font-medium text-accent-strong hover:underline">
          Back to sign in
        </Link>
      }
    >
      {error ? (
        <div className="space-y-4">
          <StateNote tone="error">{error}</StateNote>
          <Link to="/login" className="block">
            <Button variant="secondary" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-500" role="status">
          Signing you in…
        </p>
      )}
    </AuthShell>
  );
};

export default OidcCallback;

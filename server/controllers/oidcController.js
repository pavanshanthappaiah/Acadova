/* ------------------------------------------------------------------ */
/* OpenID Connect endpoints                                             */
/*                                                                      */
/* GET  /api/auth/oidc/providers  -> { configured, issuer? }            */
/* GET  /api/auth/oidc/start      -> 302 to the provider (PKCE+state)   */
/* GET  /api/auth/oidc/callback   -> verifies code + id_token, links or */
/*                                   creates the user, 302 back to the  */
/*                                   SPA with a one-time token          */
/* POST /api/auth/oidc/exchange   -> swaps the one-time token for the   */
/*                                   standard JWT + user payload        */
/*                                                                      */
/* The callback redirects to /#/oidc (hash route) so the SPA never sees */
/* the code in history; the fragment is stripped by the browser. The    */
/* one-time token is stored hashed in memory for 60 seconds and can be  */
/* redeemed exactly once.                                               */
/* ------------------------------------------------------------------ */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { oidcConfig, isOidcConfigured, buildAuthorizationUrl, exchangeCodeForClaims, OidcError } from '../services/oidcService.js';

const JWT_SECRET = () => process.env.JWT_SECRET || 'fallback_secret_for_development_only';

/* --- one-time exchange tokens (in-memory; single-process dev server) --- */
const pendingTokens = new Map(); // token -> { userId, expiresAt }
const PENDING_TTL_MS = 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingTokens) if (v.expiresAt < now) pendingTokens.delete(k);
}, PENDING_TTL_MS).unref?.();

const appOrigin = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
const callbackRedirectUri = () =>
  process.env.OIDC_REDIRECT_URI ||
  (process.env.SERVER_URL ? process.env.SERVER_URL.replace(/\/$/, '') + '/api/auth/oidc/callback' : '');

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  branch: user.branch,
  semester: user.semester,
  targetAttendance: user.targetAttendance,
  college: user.college,
  sso: Boolean(user.oidc?.providerId),
});

export const getOidcProviders = (req, res) => {
  const configured = isOidcConfigured();
  const c = oidcConfig();
  return res.json({ success: true, providers: configured ? [{ id: 'oidc', issuer: c.issuer }] : [], configured });
};

export const startOidc = async (req, res) => {
  try {
    if (!isOidcConfigured()) {
      return res.status(400).json({ success: false, message: 'Single sign-on is not configured on this server.' });
    }
    const redirectUri = callbackRedirectUri();
    if (!redirectUri) {
      return res.status(500).json({ success: false, message: 'OIDC redirect URI is not configured.' });
    }
    const { url, session } = await buildAuthorizationUrl(redirectUri);

    // The state/PKCE/nonce triple rides in a signed, HttpOnly cookie and is
    // bound to the browser that started the flow.
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const mac = crypto.createHmac('sha256', JWT_SECRET()).update(payload).digest('base64url');

    res.setHeader('Set-Cookie', [
      `oidc_session=${payload}.${mac}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=600',
      process.env.NODE_ENV === 'production' ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; '));
    return res.redirect(url);
  } catch (error) {
    if (error instanceof OidcError) {
      return res.redirect(`${appOrigin()}/login?sso_error=${encodeURIComponent(error.message)}`);
    }
    console.error('OIDC start error:', error);
    return res.redirect(`${appOrigin()}/login?sso_error=${encodeURIComponent('Could not start single sign-on.')}`);
  }
};

const readSessionCookie = (req) => {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('oidc_session='));
  if (!raw) return null;
  const [payload, mac] = raw.slice('oidc_session='.length).split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET()).update(payload).digest('base64url');
  if (mac !== expected) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const findOrLinkUser = async ({ issuer, subject, email, name, picture }) => {
  // 1) exact identity match (provider + subject) — the stable link
  let user = await User.findOne({ 'oidc.issuer': issuer, 'oidc.providerId': subject });
  if (user) return user;

  // 2) same email: link the OIDC identity onto the existing local account
  if (email) {
    user = await User.findOne({ email });
    if (user) {
      user.oidc = { issuer, providerId: subject, picture: picture || user.oidc?.picture || '' };
      await user.save();
      return user;
    }
  }

  // 3) brand new SSO-only account: random password the user can never use
  const randomPassword = crypto.randomBytes(32).toString('hex');
  user = await User.create({
    name: name || email.split('@')[0],
    email,
    password: randomPassword,
    oidc: { issuer, providerId: subject, picture: picture || '' },
  });
  return user;
};

export const oidcCallback = async (req, res) => {
  const fail = (message) => res.redirect(`${appOrigin()}/login?sso_error=${encodeURIComponent(message)}`);
  try {
    const { code, state, error: providerError, error_description: providerDesc } = req.query;
    if (providerError) return fail(providerDesc || providerError);
    if (!code || !state) return fail('The identity provider response is missing required parameters.');

    const session = readSessionCookie(req);
    if (!session) return fail('Single sign-on session expired or is invalid. Please try again.');
    if (session.state !== state) return fail('Single sign-on state mismatch. Please try again.');

    const claims = await exchangeCodeForClaims(code, session, callbackRedirectUri());
    if (!claims.email) return fail('Your identity provider did not share an email address, which Acadova requires.');

    const user = await findOrLinkUser({
      issuer: oidcConfig().issuer,
      subject: claims.subject,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
    });

    // Hand the SPA a one-time token (not the JWT itself) via the URL fragment,
    // which browsers do not put in history or referers.
    const oneTime = crypto.randomBytes(24).toString('base64url');
    pendingTokens.set(oneTime, { userId: user._id.toString(), expiresAt: Date.now() + PENDING_TTL_MS });

    res.clearCookie?.('oidc_session');
    res.setHeader('Set-Cookie', 'oidc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.redirect(`${appOrigin()}/oidc/callback#token=${oneTime}`);
  } catch (error) {
    if (error instanceof OidcError) return fail(error.message);
    console.error('OIDC callback error:', error);
    return fail('Single sign-on failed. Please try again or sign in with your password.');
  }
};

export const exchangeOidcToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    const entry = token && pendingTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(400).json({ success: false, message: 'This sign-in link has expired. Please sign in again.' });
    }
    pendingTokens.delete(token); // exactly one redemption

    const user = await User.findById(entry.userId);
    if (!user) return res.status(401).json({ success: false, message: 'Account no longer exists.' });

    const jwtToken = jwt.sign({ id: user._id }, JWT_SECRET(), { expiresIn: '7d' });
    return res.json({ success: true, token: jwtToken, user: sanitizeUser(user) });
  } catch (error) {
    console.error('OIDC exchange error:', error);
    return res.status(500).json({ success: false, message: 'Could not complete single sign-on.' });
  }
};

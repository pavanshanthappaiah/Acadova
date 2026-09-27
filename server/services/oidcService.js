/* ------------------------------------------------------------------ */
/* Minimal OpenID Connect relying party (no external OIDC library)      */
/*                                                                      */
/* Provider-agnostic: everything is derived from the provider's         */
/* discovery document (issuer + authorization_endpoint +                */
/* token_endpoint + jwks_uri + userinfo_endpoint). Adding Google,       */
/* Microsoft Entra ID or any compliant IdP is configuration only.       */
/*                                                                      */
/* Security properties:                                                 */
/*  - authorization-code flow with PKCE (S256) and state               */
/*  - id_token signature verified against the provider's JWKS          */
/*  - iss, aud, exp, nonce validated; alg restricted to RS/ES/PS family */
/*  - userinfo fetched from the discovery-declared endpoint and the     */
/*    returned subject must match the id_token subject                 */
/*                                                                      */
/* Environment (all optional; SSO is disabled until configured):        */
/*   OIDC_ISSUER              e.g. https://accounts.google.com          */
/*   OIDC_CLIENT_ID           client id from the provider               */
/*   OIDC_CLIENT_SECRET       client secret (confidential client)       */
/*   OIDC_REDIRECT_URI        defaults to <origin>/api/auth/oidc/callback */
/*   OIDC_SCOPES              defaults to "openid profile email"        */
/* ------------------------------------------------------------------ */
import crypto from 'crypto';

const DISCOVERY_CACHE_MS = 60 * 60 * 1000; // re-discover hourly
let discoveryCache = null; // { at, doc }

export class OidcError extends Error {
  constructor(message, code = 'oidc_error') {
    super(message);
    this.code = code;
  }
}

export const oidcConfig = () => ({
  issuer: process.env.OIDC_ISSUER || '',
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  redirectUri:
    process.env.OIDC_REDIRECT_URI ||
    (process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, '') + '/api/auth/oidc/callback' : ''),
  scopes: process.env.OIDC_SCOPES || 'openid profile email',
});

/** SSO is offered on the UI only when the environment fully configures it. */
export const isOidcConfigured = () => {
  const c = oidcConfig();
  return Boolean(c.issuer && c.clientId);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch (and cache) the provider's discovery document. */
export const getDiscovery = async () => {
  const c = oidcConfig();
  if (!c.issuer) throw new OidcError('OpenID Connect is not configured', 'oidc_not_configured');
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_CACHE_MS) return discoveryCache.doc;

  const url = c.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new OidcError(`Could not reach the identity provider discovery document (${url})`, 'oidc_discovery_unreachable');
  }
  if (!res.ok) {
    throw new OidcError(`Identity provider discovery failed with HTTP ${res.status}`, 'oidc_discovery_failed');
  }
  const doc = await res.json();
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint']) {
    if (!doc[key]) throw new OidcError(`Discovery document is missing "${key}"`, 'oidc_discovery_invalid');
  }
  if (doc.id_token_signing_alg_values_supported) {
    const ok = doc.id_token_signing_alg_values_supported.some((alg) =>
      /^(RS|ES|PS)\d{3}$/.test(alg)
    );
    if (!ok) throw new OidcError('Provider supports no acceptable id_token signing algorithm', 'oidc_discovery_invalid');
  }
  discoveryCache = { at: Date.now(), doc };
  return doc;
};

export const clearDiscoveryCache = () => {
  discoveryCache = null;
};

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Build the authorization redirect: PKCE + state + nonce, all bound client-side. */
export const buildAuthorizationUrl = async (redirectUri) => {
  const doc = await getDiscovery();
  const c = oidcConfig();

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const nonce = base64url(crypto.randomBytes(16));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: redirectUri,
    scope: c.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${doc.authorization_endpoint}?${params.toString()}`,
    session: { codeVerifier, state, nonce, createdAt: Date.now() },
  };
};

const jwksCache = new Map(); // jwksUri -> { at, keys }
const JWKS_CACHE_MS = 60 * 60 * 1000;

const getJwks = async (jwksUri, kid) => {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.at < JWKS_CACHE_MS) return cached.keys;

  const res = await fetchWithTimeout(jwksUri, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new OidcError(`Could not fetch the provider's signing keys (HTTP ${res.status})`, 'oidc_jwks_failed');
  const doc = await res.json();
  if (!Array.isArray(doc.keys) || doc.keys.length === 0) {
    throw new OidcError("Provider's signing key set is empty", 'oidc_jwks_invalid');
  }
  jwksCache.set(jwksUri, { at: Date.now(), keys: doc.keys });
  return doc.keys;
};

/* --- JWT signature verification with Web Crypto (Node >= 15 has it) --- */
const importPublicKey = async (jwk) => {
  if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') {
    throw new OidcError(`Unsupported signing key type "${jwk.kty}"`, 'oidc_jwks_invalid');
  }
  const algo =
    jwk.kty === 'RSA'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: jwk.crv };
  return crypto.subtle.importKey('jwk', jwk, algo, false, ['verify']);
};

const verifyJwtSignature = async (idToken, keys) => {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('id_token is malformed', 'oidc_token_invalid');
  const header = JSON.parse(fromBase64url(parts[0]).toString('utf8'));
  if (!/^(RS|ES|PS)\d{3}$/.test(header.alg || '')) {
    throw new OidcError(`Refusing id_token with algorithm "${header.alg}"`, 'oidc_token_invalid');
  }

  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
  if (candidates.length === 0) {
    // Key may have rotated; refresh once before giving up.
    const [jwksUri] = keys.__jwksUri ? [keys.__jwksUri] : [];
    throw new OidcError('No signing key matches the id_token "kid"', 'oidc_token_invalid');
  }

  const data = fromBase64url(parts[2]);
  const signingInput = new Uint8Array(Buffer.from(`${parts[0]}.${parts[1]}`));
  for (const jwk of candidates) {
    try {
      const key = await importPublicKey({ ...jwk });
      let sig = new Uint8Array(data);
      // ES256 signatures arrive as raw r||s; Web Crypto expects ASN.1 DER.
      if ((jwk.kty === 'EC' || header.alg.startsWith('ES')) && sig.length === 64) {
        const r = sig.slice(0, 32);
        const s = sig.slice(32);
        sig = crypto.subtle ? derEncodeEcdsa(r, s) : sig;
      }
      const ok = await crypto.subtle.verify({ name: jwk.kty === 'RSA' ? 'RSASSA-PKCS1-v1_5' : 'ECDSA' }, key, sig, signingInput);
      if (ok) return JSON.parse(fromBase64url(parts[1]).toString('utf8'));
    } catch {
      /* try the next candidate key */
    }
  }
  throw new OidcError('id_token signature verification failed', 'oidc_token_invalid');
};

// Minimal DER encoding for a 64-byte raw ECDSA r||s signature.
const derEncodeEcdsa = (r, s) => {
  const pad = (n) => (n[0] & 0x80 ? [0, ...n] : n);
  const wrap = (n) => {
    const v = pad([...n]);
    return [0x02, v.length, ...v];
  };
  const inner = [...wrap(r), ...wrap(s)];
  return new Uint8Array([0x30, inner.length, ...inner]).buffer;
};

/** Exchange the authorization code and return verified claims. */
export const exchangeCodeForClaims = async (code, session, redirectUri) => {
  const doc = await getDiscovery();
  const c = oidcConfig();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: c.clientId,
    code_verifier: session.codeVerifier,
  });
  if (c.clientSecret) body.set('client_secret', c.clientSecret);

  const tokenRes = await fetchWithTimeout(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '');
    throw new OidcError(`Token exchange failed (HTTP ${tokenRes.status})`, 'oidc_exchange_failed');
  }
  const tokens = await tokenRes.json();
  if (!tokens.id_token) throw new OidcError('Provider returned no id_token', 'oidc_token_invalid');

  const keys = await getJwks(doc.jwks_uri);
  const claims = await verifyJwtSignature(tokens.id_token, keys);

  const now = Math.floor(Date.now() / 1000);
  const leeway = 60; // seconds of clock skew tolerated
  if (claims.iss !== doc.issuer) throw new OidcError('id_token issuer mismatch', 'oidc_token_invalid');
  if (claims.aud !== c.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(c.clientId))) {
    throw new OidcError('id_token audience mismatch', 'oidc_token_invalid');
  }
  if (!claims.exp || claims.exp < now - leeway) throw new OidcError('id_token has expired', 'oidc_token_invalid');
  if (claims.nbf && claims.nbf > now + leeway) throw new OidcError('id_token not yet valid', 'oidc_token_invalid');
  if (session.nonce && claims.nonce !== session.nonce) {
    throw new OidcError('id_token nonce mismatch', 'oidc_token_invalid');
  }

  // Prefer the userinfo endpoint when the id_token lacks identity fields.
  let userinfo = null;
  try {
    const uiRes = await fetchWithTimeout(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (uiRes.ok) {
      userinfo = await uiRes.json();
      if (userinfo.sub && claims.sub && userinfo.sub !== claims.sub) {
        throw new OidcError('userinfo subject does not match id_token', 'oidc_token_invalid');
      }
    }
  } catch (e) {
    if (e instanceof OidcError) throw e;
    /* userinfo is optional when the id_token carries the claims */
  }

  return {
    subject: claims.sub,
    email: (userinfo?.email || claims.email || '').toLowerCase(),
    emailVerified: Boolean(userinfo?.email_verified ?? claims.email_verified),
    name: userinfo?.name || claims.name || claims.email || 'SSO user',
    picture: userinfo?.picture || claims.picture || '',
  };
};

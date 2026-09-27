import express from 'express';
import { register, login, getMe, updateProfile } from '../controllers/authController.js';
import {
  getOidcProviders,
  startOidc,
  oidcCallback,
  exchangeOidcToken,
} from '../controllers/oidcController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

/* OpenID Connect single sign-on (public; configured via environment) */
router.get('/oidc/providers', getOidcProviders);
router.get('/oidc/start', startOidc);
router.get('/oidc/callback', oidcCallback);
router.post('/oidc/exchange', exchangeOidcToken);

export default router;

import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { validate } from '../utils/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Brute-force guard: 5 login attempts per IP per 15 minutes.
const loginLimiter = rateLimit({ keyPrefix: 'login', max: 5, windowSeconds: 900 });

router.post('/register', validate(auth.registerSchema), auth.register);
router.post('/login', loginLimiter, validate(auth.loginSchema), auth.login);
router.post('/refresh', validate(auth.refreshSchema), auth.refresh);
router.post('/logout', validate(auth.refreshSchema), auth.logout);

router.get('/me', requireAuth, auth.me);

export default router;

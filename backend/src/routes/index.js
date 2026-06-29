import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import eventRoutes from './event.routes.js';
import bookingRoutes from './booking.routes.js';

const router = Router();

router.use('/', healthRoutes);

router.use('/v1/auth', authRoutes);
router.use('/v1/events', eventRoutes);
router.use('/v1/bookings', bookingRoutes);

router.get('/v1', (_req, res) => {
  res.json({ name: 'BookMySeat API', version: 'v1', status: 'ok' });
});

export default router;

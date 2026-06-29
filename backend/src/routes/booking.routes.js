import { Router } from 'express';
import * as booking from '../controllers/booking.controller.js';
import { validate } from '../utils/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All booking actions require an authenticated user.
router.use(requireAuth);

router.post('/hold', validate(booking.holdSchema), booking.hold);
router.post('/:id/confirm', validate(booking.confirmSchema), booking.confirm);
router.post('/:id/release', booking.release);
router.get('/me', booking.myBookings);

export default router;

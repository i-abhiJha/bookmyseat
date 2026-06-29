import { Router } from 'express';
import * as event from '../controllers/event.controller.js';
import { validate } from '../utils/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// public reads
router.get('/', validate(event.listQuerySchema, 'query'), event.listEvents);
router.get('/:id', event.getEvent);
router.get('/:id/seats', event.getSeatMap);

// admin only
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  validate(event.createEventSchema),
  event.createEvent
);
router.patch('/:id/publish', requireAuth, requireRole('admin'), event.publishEvent);

export default router;

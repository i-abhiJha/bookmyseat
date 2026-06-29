import mongoose from 'mongoose';

// Groups the seats a user is purchasing.
// Status flow: PENDING -> CONFIRMED, or PENDING -> CANCELLED/EXPIRED.
const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    seats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Seat', required: true }],

    totalAmount: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },

    idempotencyKey: { type: String, required: true },

    expiresAt: { type: Date, required: true },
    paymentRef: { type: String, default: null },
  },
  { timestamps: true }
);

// a user can use a given idempotency key only once
bookingSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true });

bookingSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const Booking = mongoose.model('Booking', bookingSchema);

import mongoose from 'mongoose';

// One document per seat so a reservation is a single atomic update.
// Status flow: AVAILABLE -> HELD -> BOOKED (HELD reverts to AVAILABLE on
// expiry or cancel).
const seatSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },

    label: { type: String, required: true }, // e.g. "A12"
    section: { type: String, default: 'GENERAL' },
    tier: { type: String, enum: ['STANDARD', 'PREMIUM', 'VIP'], default: 'STANDARD' },
    price: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ['AVAILABLE', 'HELD', 'BOOKED'],
      default: 'AVAILABLE',
      index: true,
    },

    heldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    holdExpiresAt: { type: Date, default: null },
    bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

seatSchema.index({ event: 1, section: 1, label: 1 }, { unique: true });
seatSchema.index({ event: 1, status: 1 });
seatSchema.index({ status: 1, holdExpiresAt: 1 }); // for the expiry sweep

seatSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const Seat = mongoose.model('Seat', seatSchema);

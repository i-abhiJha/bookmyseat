import mongoose from 'mongoose';

// A single show. Seats live in their own collection (see Seat.js), not
// embedded, so individual seats can be updated without rewriting the event.
const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    venue: { type: String, required: true, trim: true },
    startsAt: { type: Date, required: true, index: true },

    // denormalised counters; source of truth is the Seat collection
    totalSeats: { type: Number, required: true, min: 1 },
    availableSeats: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'SOLD_OUT'],
      default: 'DRAFT',
      index: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

eventSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const Event = mongoose.model('Event', eventSchema);

import Counter from '../models/Counter.js';

export default async function getNextSequence(name) {
  const updated = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return updated.seq;
}
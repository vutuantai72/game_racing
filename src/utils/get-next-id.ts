import { Model } from 'mongoose';
import { CounterDocument } from '../schemas/counter.schema';

export async function getNextSequenceValue(
  counterModel: Model<CounterDocument>,
  sequenceName: string,
): Promise<number> {
  const updatedCounter = await counterModel.findOneAndUpdate(
    { id: sequenceName },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return updatedCounter.seq;
}

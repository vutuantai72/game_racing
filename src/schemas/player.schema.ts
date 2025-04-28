import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlayerDocument = Player & Document;

export enum PlayerStatus {
  Waiting = 0,
  Ready = 1,
}

export enum ItemBuffType {
  Nitro = 0,
  Power = 1,
  Acceleration = 2,
}

class StatCarEntry {
  @Prop({ required: true })
  power: number;

  @Prop({ required: true })
  acceleration: number;

  @Prop({ required: true })
  nitro: number;
}

export class PlayerRaceRecordEntry {
  @Prop({ required: true })
  rank: number;

  @Prop({ required: true })
  gameMode: string;

  @Prop({ required: true })
  createdAt: string;

  @Prop({ required: true })
  rewardCoin: number;
}

export class PlayerCarEntry {
  @Prop({ required: true })
  id: number;

  @Prop({ required: true })
  model: string;

  @Prop({ required: true })
  brand: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  star: number;

  @Prop({ required: true })
  color: string;

  @Prop({ type: StatCarEntry, default: {} })
  stats: StatCarEntry;

  @Prop({ required: true })
  expired: number;

  @Prop({ required: true })
  isPay: boolean;

  @Prop({ required: true })
  canMarket: boolean;

  @Prop({ required: true })
  isMarket: boolean;

  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  isExported: boolean;

  @Prop({ required: true })
  from: number;

  @Prop({ required: true })
  createdAt: string;

  @Prop({ required: true })
  updatedAt: string;
}

export interface Item {
  ItemID: string;
  Name: string;
  BuffDuration: number;
  BuffType: ItemBuffType;
  BuffTime: number;
  BuffAmount: number;
}

@Schema({ collection: 'player' })
export class Player {
  @Prop({ required: true })
  _id: string;

  @Prop({ required: true })
  telegramId: string;

  @Prop()
  socketId: string;

  @Prop({ required: true })
  gpoint: number;

  @Prop({ required: true })
  gpointClaimed: number;

  @Prop({ required: true })
  gpointEarned: number;

  @Prop({ required: true })
  isLock: boolean;

  @Prop({ required: true })
  mainCar: number;

  @Prop({ type: [Object], default: [] })
  refReward: any[];

  @Prop({ required: true })
  playerAvatar: string;

  @Prop({ required: true })
  playerName: string;

  @Prop({ required: true })
  freeTurn: number;

  @Prop({ required: true })
  isUsed: boolean;

  @Prop({ required: true })
  isHost: boolean;

  @Prop({ required: true, enum: PlayerStatus })
  status: PlayerStatus;

  @Prop({ type: [PlayerCarEntry], default: [] })
  ownerCars: PlayerCarEntry[];

  @Prop({ type: [PlayerRaceRecordEntry], default: [] })
  records: PlayerRaceRecordEntry[];

  @Prop({ type: Object, default: {} })
  playerInventory: Record<string, Item[]>;
}

export const PlayerSchema = SchemaFactory.createForClass(Player);

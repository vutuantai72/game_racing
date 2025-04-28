import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

export enum RoomStatus {
  WAITING = 'Waiting',
  RUNNING = 'Playing',
  FINISHED = 'Finished',
}

@Schema({ collection: 'room' })
export class Room {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  value: number;

  @Prop()
  password: string;

  @Prop({ required: true, enum: RoomStatus })
  status: RoomStatus;

  @Prop({ required: true })
  players: string[];
}

export const RoomSchema = SchemaFactory.createForClass(Room);

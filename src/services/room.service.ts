import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room, RoomDocument, RoomStatus } from '../schemas/room.schema';
import { Counter, CounterDocument } from '../schemas/counter.schema';
import { getNextSequenceValue } from '../utils/get-next-id';

@Injectable()
export class RoomService {
  constructor(
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
  ) {}

  async getRoomWithId(id: string): Promise<Room | null> {
    return await this.roomModel.findById(id).exec();
  }

  async createRoom(data: Partial<Room>): Promise<Room> {
    const nextId = await getNextSequenceValue(this.counterModel, 'room');

    const newRoom = new this.roomModel({
      ...data,
      id: nextId,
    });

    return newRoom.save();
  }

  async getAllRooms(): Promise<Room[]> {
    return this.roomModel.find().exec();
  }

  async addPlayerToRoom(
    roomId: string,
    playerId: string,
  ): Promise<Room | null> {
    const updatedRoom = await this.roomModel
      .findOneAndUpdate(
        { id: roomId },
        { $addToSet: { players: playerId } },
        { new: true },
      )
      .exec();

    return updatedRoom;
  }

  async leaveRoom(roomId: string, playerId: string): Promise<void> {
    const room = await this.roomModel
      .findOneAndUpdate(
        { id: roomId },
        { $pull: { players: playerId } },
        { new: true },
      )
      .exec();

    if (!room) {
      throw new Error('Room not found');
    }
    console.log(`Player ${playerId} has left room ${roomId}`);
  }

  async updateRoomStatus(
    roomId: string,
    status: RoomStatus,
  ): Promise<Room | null> {
    const updatedRoom = await this.roomModel
      .findOneAndUpdate(
        { id: roomId },
        { $set: { status: status } },
        { new: true },
      )
      .exec();

    return updatedRoom;
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    const result = await this.roomModel.deleteOne({ id: roomId }).exec();

    return result.deletedCount > 0;
  }
}

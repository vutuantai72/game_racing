import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Player,
  PlayerDocument,
  PlayerRaceRecordEntry,
  PlayerStatus,
  Item,
} from '../schemas/player.schema';

@Injectable()
export class PlayerService {
  constructor(
    @InjectModel(Player.name) private playerModel: Model<PlayerDocument>,
  ) {}

  async getUnusedPlayer(): Promise<Player | null> {
    const player = await this.playerModel
      .findOneAndUpdate(
        { isUsed: false },
        { $set: { isUsed: true } },
        { new: true },
      )
      .exec();
    console.log(player);
    return player;
  }

  async activateAllPlayers(): Promise<{ modifiedCount: number }> {
    const result = await this.playerModel.updateMany(
      {},
      { $set: { isUsed: false } },
    );
    return { modifiedCount: result.modifiedCount };
  }

  async getPlayerWithId(id: string): Promise<Player | null> {
    return await this.playerModel.findById(id).exec();
  }

  async getPlayerWithSocketId(socketId: string): Promise<Player | null> {
    return await this.playerModel.findOne({ socketId: socketId }).exec();
  }

  async updatePlayerSocket(
    id: string,
    socketId: string,
    isHost: boolean,
  ): Promise<Player | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate(
        { _id: id },
        { $set: { socketId: socketId, isHost: isHost } },
        { new: true },
      )
      .exec();

    return updatedPlayer;
  }

  async updatePlayerStatus(
    id: string,
    status: PlayerStatus,
  ): Promise<Player | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate(
        { _id: id },
        { $set: { status: status } },
        { new: true },
      )
      .exec();

    return updatedPlayer;
  }

  async updateFreeTurn(id: string): Promise<number | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate({ _id: id }, { $inc: { freeTurn: -1 } }, { new: true })
      .exec();

    return updatedPlayer?.freeTurn ?? null;
  }

  async updateGPoint(id: string, gpoint: number): Promise<number | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate(
        { _id: id },
        { $inc: { gpoint: -gpoint } },
        { new: true },
      )
      .exec();

    return updatedPlayer?.gpoint ?? null;
  }

  async updateAddGPoint(id: string, gpoint: number): Promise<number | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate(
        { _id: id },
        { $inc: { gpoint: +gpoint } },
        { new: true },
      )
      .exec();

    return updatedPlayer?.gpoint ?? null;
  }

  async addRaceRecord(
    playerId: string,
    record: PlayerRaceRecordEntry,
  ): Promise<Player | null> {
    return await this.playerModel
      .findOneAndUpdate(
        { _id: playerId },
        { $push: { records: record } },
        { new: true },
      )
      .exec();
  }

  async updatePlayerInventory(
    playerId: string,
    playerInventory: Record<string, Item[]>,
  ): Promise<Record<string, Item[]> | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate(
        { _id: playerId },
        { $set: { playerInventory } },
        { new: true },
      )
      .exec();

    return updatedPlayer?.playerInventory ?? null;
  }

  async deleteOneItemInInventory(
    playerId: string,
    key: string,
  ): Promise<Record<string, any[]> | null> {
    const player = await this.playerModel.findById(playerId).exec();
    if (!player) return null;

    if (
      !player.playerInventory ||
      !player.playerInventory[key] ||
      player.playerInventory[key].length === 0
    ) {
      return player.playerInventory;
    }

    player.playerInventory[key].pop();
    player.markModified('playerInventory');

    await player.save();
    return player.playerInventory;
  }

  async updateMainCar(id: string, mainCar: number): Promise<number | null> {
    const updatedPlayer = await this.playerModel
      .findOneAndUpdate(
        { _id: id },
        { $set: { mainCar: mainCar } },
        { new: true },
      )
      .exec();

    return updatedPlayer?.mainCar ?? null;
  }
}

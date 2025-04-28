import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { PlayerService } from '../services/player.service';
import { Item, Player, PlayerRaceRecordEntry } from '../schemas/player.schema';

@Controller('players')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Get('unused')
  async getUnusedPlayer(): Promise<{ player: Player | null }> {
    const player = await this.playerService.getUnusedPlayer();
    return { player };
  }

  @Get(':id')
  async getPlayerWithId(
    @Param('id') id: string,
  ): Promise<{ player: Player | null }> {
    const player = await this.playerService.getPlayerWithId(id);
    if (!player) {
      throw new Error('Player not found'); // Nếu không tìm thấy player, trả lỗi
    }
    return { player };
  }

  @Post(':id/records')
  async addRecord(
    @Param('id') playerId: string,
    @Body() record: PlayerRaceRecordEntry,
  ): Promise<{ player: Player | null }> {
    const updatedPlayer = await this.playerService.addRaceRecord(
      playerId,
      record,
    );
    return { player: updatedPlayer };
  }

  @Post(':id/freeturn')
  async decrementFreeTurn(@Param('id') id: string) {
    const freeTurn = await this.playerService.updateFreeTurn(id);
    return { freeTurn: freeTurn };
  }

  @Post(':id/gpoint')
  async updateGPoint(
    @Param('id') playerId: string,
    @Query('gpoint') gpoint: number, // <-- lấy gpoint từ query params
  ): Promise<{ gpoint: number | null }> {
    const updatedGPoint = await this.playerService.updateGPoint(
      playerId,
      Number(gpoint),
    );
    return { gpoint: updatedGPoint };
  }

  @Post(':id/gpoint/reward')
  async updateAddGPoint(
    @Param('id') playerId: string,
    @Query('gpoint') gpoint: number, // <-- lấy gpoint từ query params
  ): Promise<{ gpoint: number | null }> {
    const updatedGPoint = await this.playerService.updateAddGPoint(
      playerId,
      Number(gpoint),
    );
    return { gpoint: updatedGPoint };
  }

  @Post(':id/maincar')
  async updateMainCar(
    @Param('id') playerId: string,
    @Query('carId') carId: number,
  ): Promise<{ mainCar: number | null }> {
    const updatedMainCar = await this.playerService.updateMainCar(
      playerId,
      Number(carId),
    );
    return { mainCar: updatedMainCar };
  }

  @Post(':id/inventory')
  async updateInventory(
    @Param('id') playerId: string,
    @Body() body: { playerInventory: Record<string, Item[]> },
  ): Promise<{ playerInventory: Record<string, Item[]> | null }> {
    const playerInventory = await this.playerService.updatePlayerInventory(
      playerId,
      body.playerInventory,
    );
    return { playerInventory };
  }

  @Get(':id/inventory/:key')
  async deleteOneItemInInventory(
    @Param('id') playerId: string,
    @Param('key') key: string,
  ): Promise<{ playerInventory: Record<string, any[]> | null }> {
    const updatedInventory = await this.playerService.deleteOneItemInInventory(
      playerId,
      key,
    );
    return { playerInventory: updatedInventory };
  }
}

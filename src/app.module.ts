import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RacingGateway } from './racing/racing.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { Player, PlayerSchema } from './schemas/player.schema';
import { PlayerController } from './controllers/player.controller';
import { PlayerService } from './services/player.service';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomService } from './services/room.service';
import { Counter, CounterSchema } from './schemas/counter.schema';

@Module({
  imports: [
    MongooseModule.forRoot(
      'mongodb+srv://taivutuan:J36tB75QhQtkSpei@cluster0.wzilg1s.mongodb.net/game_racing?retryWrites=true&w=majority&appName=Cluster0',
    ),
    MongooseModule.forFeature([{ name: Player.name, schema: PlayerSchema }]),
    MongooseModule.forFeature([{ name: Room.name, schema: RoomSchema }]),
    MongooseModule.forFeature([{ name: Counter.name, schema: CounterSchema }]),
  ],
  controllers: [AppController, PlayerController],
  providers: [AppService, RacingGateway, PlayerService, RoomService],
})
export class AppModule {}

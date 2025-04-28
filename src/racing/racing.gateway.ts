import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

import { Socket, Server } from 'socket.io';
import { RoomService } from '../services/room.service';
import { RoomStatus } from '../schemas/room.schema';
import { PlayerService } from 'src/services/player.service';
import { PlayerCarEntry, PlayerStatus } from '../schemas/player.schema';

interface PlayerData {
  socketId: string;
  playerName: string;
  mainCar: number;
  ownerCars: PlayerCarEntry[];
  _id: string;
  telegramId: string;
  isHost: boolean;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  speed: number;
  status: PlayerStatus;
  distance: number;
}

interface CreateRoomDto {
  value: number;
  password: string;
  playerId: string;
}

interface JoinRoomDto {
  roomID: string;
  playerId: string;
  password?: string;
}

interface KickPlayerDto {
  roomID: string;
  targetSocketID: string;
}

interface RoomData {
  id: string;
  value?: number;
  password?: string | null;
  status: RoomStatus;
  players: Record<string, PlayerData>;
}

interface StartGameDto {
  roomID: string;
  map: number;
}

interface PlayerReadyDto {
  roomID: string;
  playerID: string;
}

interface PlayerChangeCarDto {
  roomID: string;
  playerID: string;
  mainCar: number;
}

interface PositionSyncDto {
  roomID: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  speed: number;
  distance: number;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class RacingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private rooms: Record<string, RoomData> = {};

  constructor(
    private readonly roomService: RoomService,
    private readonly playerService: PlayerService,
  ) {}

  private io: Server;

  afterInit(server: Server) {
    this.io = server;
  }
  async handleConnection(socket: Socket) {
    console.log(`Player connected: ${socket.id}`);
    await this.loadRoomsFromDb();
    this.broadcastRoomList();
  }

  async handleDisconnect(socket: Socket) {
    console.log(`Player disconnected: ${socket.id}`);
    for (const roomID in this.rooms) {
      const room = this.rooms[roomID];
      const player = room.players[socket.id];

      if (player) {
        const isHost = player.isHost;

        delete room.players[socket.id];

        if (isHost) {
          delete this.rooms[roomID];
          await this.roomService.deleteRoom(roomID);
          console.log(`Host left, room ${roomID} deleted`);

          socket.to(roomID).emit('roomClosed');
        } else {
          socket.to(roomID).emit('updatePlayers', {
            players: Object.values(room.players),
          });
        }

        this.broadcastRoomList();
        break;
      }
    }
  }

  private async loadRoomsFromDb() {
    const roomListFromDb = await this.roomService.getAllRooms();

    console.log(roomListFromDb);

    this.rooms = {};
    for (const room of roomListFromDb) {
      const players: Record<string, PlayerData> = {};

      for (const playerId of room.players) {
        const p = await this.playerService.getPlayerWithId(playerId);
        if (p) {
          players[p.socketId] = {
            _id: p._id,
            socketId: p.socketId,
            telegramId: p.telegramId,
            playerName: p.playerName,
            mainCar: p.mainCar,
            isHost: p.isHost,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            speed: 0,
            status: p.status,
            ownerCars: p.ownerCars,
            distance: 0,
          };
        }
      }

      this.rooms[room.id] = {
        id: room.id,
        value: Number(room.value),
        password: room.password || null,
        status: room.status,
        players,
      };

      console.log(this.rooms[room.id]);
    }
  }

  private getPublicRoomList() {
    return Object.entries(this.rooms).map(([roomID, room]) => ({
      id: roomID,
      status: room.status,
      value: room.value,
      isPassword: !!room.password,
      playerCount: Object.keys(room.players).length,
    }));
  }

  private broadcastRoomList() {
    const roomList = this.getPublicRoomList();
    this.io?.emit('roomListUpdated', { rooms: roomList });
  }

  @SubscribeMessage('ping_check')
  handlePingCheck(client: Socket) {
    client.emit('ping_response');
  }

  @SubscribeMessage('createRoom')
  async createRoom(
    @MessageBody() rawData: string | CreateRoomDto,
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      const data: CreateRoomDto =
        typeof rawData === 'string'
          ? (JSON.parse(rawData) as CreateRoomDto)
          : rawData;

      const p = await this.playerService.getPlayerWithId(data.playerId);

      if (!p) {
        socket.emit('error', { message: 'Invalid playerData' });
        return;
      }

      console.log('Parsed Data:', data);

      const createdRoom = await this.roomService.createRoom({
        value: data.value || 0,
        password: data.password || '',
        players: [data.playerId],
        status: RoomStatus.WAITING,
      });

      const updatedPlayer = await this.playerService.updatePlayerSocket(
        p._id,
        socket.id,
        true,
      );

      if (!updatedPlayer) {
        socket.emit('error', { message: 'Invalid playerData' });
        return;
      }

      this.rooms[createdRoom.id] = {
        id: createdRoom.id,
        value: createdRoom.value,
        password: createdRoom.password,
        status: createdRoom.status,
        players: {},
      };

      await socket.join(createdRoom.id);

      this.rooms[createdRoom.id].players[updatedPlayer?.socketId] = {
        _id: updatedPlayer._id,
        socketId: updatedPlayer.socketId,
        telegramId: updatedPlayer.telegramId,
        playerName: updatedPlayer.playerName,
        mainCar: updatedPlayer.mainCar,
        isHost: updatedPlayer.isHost,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        speed: 0,
        status: updatedPlayer.status,
        ownerCars: updatedPlayer.ownerCars,
        distance: 0,
      };

      this.broadcastRoomList();

      socket.emit('roomDetails', {
        id: createdRoom.id,
        status: this.rooms[createdRoom.id].status,
        value: this.rooms[createdRoom.id].value,
        playerCount: Object.keys(this.rooms[createdRoom.id].players).length,
        players: Object.values(this.rooms[createdRoom.id].players),
      });
    } catch (error) {
      console.error('Error parsing createRoom data:', error);
      socket.emit('error', { message: 'Invalid data format' });
    }
  }

  @SubscribeMessage('joinRoom')
  async joinRoom(
    @MessageBody() rawData: string | JoinRoomDto,
    @ConnectedSocket() socket: Socket,
  ) {
    let data: JoinRoomDto;

    try {
      data =
        typeof rawData === 'string'
          ? (JSON.parse(rawData) as JoinRoomDto)
          : rawData;
    } catch (error) {
      console.error('Error parsing joinRoom data:', error);
      socket.emit('error', { message: 'Invalid data format' });
      return;
    }

    const { roomID, playerId, password } = data;

    if (!this.rooms[roomID]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (
      this.rooms[roomID].password &&
      this.rooms[roomID].password !== password
    ) {
      socket.emit('error', { message: 'Incorrect password' });
      return;
    }

    await this.roomService.addPlayerToRoom(roomID, playerId);

    const updatedPlayer = await this.playerService.updatePlayerSocket(
      playerId,
      socket.id,
      false,
    );

    if (!updatedPlayer) {
      socket.emit('error', { message: 'Invalid playerData' });
      return;
    }

    await socket.join(roomID);

    const newPlayerData = {
      _id: updatedPlayer._id,
      socketId: updatedPlayer.socketId,
      telegramId: updatedPlayer.telegramId,
      playerName: updatedPlayer.playerName,
      mainCar: updatedPlayer.mainCar,
      isHost: updatedPlayer.isHost,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      speed: 0,
      status: updatedPlayer.status,
      ownerCars: updatedPlayer.ownerCars,
      distance: 0,
    };

    this.rooms[roomID].players[socket.id] = newPlayerData;
    socket.to(roomID).emit('updatePlayers', {
      players: Object.values(this.rooms[roomID].players),
    });

    console.log(`Player ${socket.id} joined room ${roomID}`);

    this.broadcastRoomList();

    socket.emit('roomDetails', {
      id: roomID,
      status: this.rooms[roomID].status,
      value: this.rooms[roomID].value,
      playerCount: Object.keys(this.rooms[roomID].players).length,
      players: Object.values(this.rooms[roomID].players),
    });
  }

  @SubscribeMessage('leaveRoom')
  async leaveRoom(@ConnectedSocket() socket: Socket) {
    for (const roomID in this.rooms) {
      const room = this.rooms[roomID];
      const player = room.players[socket.id];

      if (player) {
        const isHost = player.isHost;

        delete room.players[socket.id];
        await this.roomService.leaveRoom(roomID, player._id);
        await socket.leave(roomID);
        console.log(`Player ${socket.id} left room ${roomID}`);

        if (isHost) {
          delete this.rooms[roomID];
          await this.roomService.deleteRoom(roomID);
          console.log(`Host left, room ${roomID} deleted`);
          socket.to(roomID).emit('roomClosed');
        } else {
          socket.to(roomID).emit('updatePlayers', {
            players: Object.values(room.players),
          });

          this.io.to(roomID).emit('playerKicked', {
            socketID: socket.id,
          });
        }

        this.broadcastRoomList();
        break;
      }
    }
  }

  @SubscribeMessage('playerReady')
  async playerReady(
    @MessageBody() rawData: string | PlayerReadyDto,
    @ConnectedSocket() socket: Socket,
  ) {
    const data: PlayerReadyDto =
      typeof rawData === 'string'
        ? (JSON.parse(rawData) as PlayerReadyDto)
        : rawData;

    const { roomID, playerID } = data;

    if (!this.rooms[roomID]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const readyPlayers = Object.values(this.rooms[roomID].players).find(
      (player) => player.socketId === playerID,
    );

    if (readyPlayers) {
      readyPlayers.status = PlayerStatus.Ready;
      await this.playerService.updatePlayerStatus(playerID, PlayerStatus.Ready);

      this.io.to(playerID).emit('ready', { roomID: roomID });
    }

    this.io.to(roomID).emit('updatePlayers', {
      players: Object.values(this.rooms[roomID].players),
    });

    this.io.to(roomID).emit('playerIsReady', {
      socketID: playerID,
    });
  }

  @SubscribeMessage('playerChangeCar')
  playerChangeCar(
    @MessageBody() rawData: string | PlayerChangeCarDto,
    @ConnectedSocket() socket: Socket,
  ) {
    const data: PlayerChangeCarDto =
      typeof rawData === 'string'
        ? (JSON.parse(rawData) as PlayerChangeCarDto)
        : rawData;

    const { roomID, playerID, mainCar } = data;

    if (!this.rooms[roomID]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = Object.values(this.rooms[roomID].players).find(
      (player) => player.socketId === playerID,
    );

    if (player) player.mainCar = mainCar;

    this.io.to(roomID).emit('updatePlayers', {
      players: Object.values(this.rooms[roomID].players),
    });
  }

  @SubscribeMessage('kickPlayer')
  async kickPlayer(
    @MessageBody() rawData: string | KickPlayerDto,
    @ConnectedSocket() socket: Socket,
  ) {
    try {
      const data: KickPlayerDto =
        typeof rawData === 'string'
          ? (JSON.parse(rawData) as KickPlayerDto)
          : rawData;

      const { roomID, targetSocketID } = data;

      if (!this.rooms[roomID]) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      if (!this.rooms[roomID].players[targetSocketID]) {
        socket.emit('error', { message: 'Player not found in room' });
        return;
      }

      delete this.rooms[roomID].players[targetSocketID];

      await this.roomService.leaveRoom(roomID, targetSocketID);

      this.io.to(targetSocketID).socketsLeave(roomID);

      this.io.to(targetSocketID).emit('kicked', { roomID });

      this.io.to(roomID).emit('updatePlayers', {
        players: Object.values(this.rooms[roomID].players),
      });

      this.io.to(roomID).emit('playerKicked', {
        socketID: targetSocketID,
      });

      this.broadcastRoomList();

      console.log(`Player ${targetSocketID} was kicked from room ${roomID}`);
    } catch (error) {
      console.error('Error parsing kickPlayer data:', error);
      socket.emit('error', { message: 'Invalid data format' });
    }
  }

  @SubscribeMessage('startGame')
  async startGame(
    @MessageBody() rawData: string | StartGameDto,
    @ConnectedSocket() socket: Socket,
  ) {
    let data: StartGameDto;

    try {
      data =
        typeof rawData === 'string'
          ? (JSON.parse(rawData) as StartGameDto)
          : rawData;
    } catch (error) {
      console.error('Error parsing startGame data:', error);
      socket.emit('error', { message: 'Invalid data format' });
      return;
    }

    const { roomID, map } = data;

    if (!this.rooms[roomID]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Check player gửi request có phải host không
    const hostPlayer = Object.values(this.rooms[roomID].players).find(
      (player) => player.isHost,
    );
    if (!hostPlayer || socket.id !== hostPlayer.socketId) {
      socket.emit('error', { message: 'Only the host can start the game' });
      return;
    }

    this.rooms[roomID].status = RoomStatus.RUNNING;

    await this.roomService.updateRoomStatus(roomID, RoomStatus.RUNNING);

    this.io.to(roomID).emit('gameStarted', {
      roomID: roomID,
      map: map,
      status: this.rooms[roomID].status,
    });

    console.log(`Game in room ${roomID} has started.`);

    this.broadcastRoomList();
  }

  @SubscribeMessage('syncPosition')
  syncPosition(
    @MessageBody() rawData: string | PositionSyncDto,
    @ConnectedSocket() socket: Socket,
  ) {
    let data: PositionSyncDto;

    try {
      data =
        typeof rawData === 'string'
          ? (JSON.parse(rawData) as PositionSyncDto)
          : rawData;
    } catch (error) {
      console.error('Error parsing syncPosition data:', error);
      socket.emit('error', { message: 'Invalid data format' });
      return;
    }

    const { roomID, position, rotation, speed, distance } = data;

    if (!this.rooms[roomID]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const currentPlayer = this.rooms[roomID].players[socket.id];

    const newPlayerData = {
      ...currentPlayer,
      position: position,
      rotation: rotation,
      speed: speed,
      distance: distance,
    };

    this.rooms[roomID].players[socket.id] = newPlayerData;

    this.io.to(roomID).emit('playerPosition', {
      socketID: socket.id,
      position: newPlayerData.position,
      rotation: newPlayerData.rotation,
      distance: newPlayerData.distance,
    });
  }

  @SubscribeMessage('syncCarPosition')
  syncCarPosition(
    @MessageBody() rawData: string | PositionSyncDto,
    @ConnectedSocket() socket: Socket,
  ) {
    let data: PositionSyncDto;

    try {
      data =
        typeof rawData === 'string'
          ? (JSON.parse(rawData) as PositionSyncDto)
          : rawData;
    } catch (error) {
      console.error('Error parsing syncPosition data:', error);
      socket.emit('error', { message: 'Invalid data format' });
      return;
    }

    const { roomID, position, rotation, speed } = data;

    if (!this.rooms[roomID]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    this.io.to(roomID).emit('carPosition', {
      socketID: socket.id,
      position: position,
      rotation: rotation,
      speed: speed,
    });
  }
}

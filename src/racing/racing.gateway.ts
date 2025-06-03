import { Injectable, OnModuleInit } from '@nestjs/common';
import { Server, WebSocket } from 'ws'; // Import WebSocket and Server from 'ws'
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../services/room.service';
import { RoomStatus } from '../schemas/room.schema';
import { PlayerService } from 'src/services/player.service';
import { PlayerCarEntry, PlayerStatus } from '../schemas/player.schema';
import { getHttpServer } from '../utils/http-server.provider';

// --- Interfaces (remain largely the same) ---

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
  isLoaded: boolean;
}

interface CreateRoomDto {
  value: number;
  password?: string; // Make password optional as it might not always be provided
  playerId: string;
}

interface JoinRoomDto {
  roomID: string;
  playerId: string;
  password?: string;
}

interface KickPlayerDto {
  roomID: string;
  targetSocketID: string; // Use the socket ID for targeting kicks
}

interface RoomData {
  id: string;
  value?: number;
  password?: string | null;
  status: RoomStatus;
  players: Record<string, PlayerData>; // Maps socketId to PlayerData
}

interface StartGameDto {
  roomID: string;
  map: number;
}

interface WaitingRoomDto {
  roomID: string;
}

interface LoadingGameDto {
  roomID: string;
  playerID: string; // Use player _id for identification
}

interface PlayerReadyDto {
  roomID: string;
  playerID: string; // Use player _id for identification
}

interface PlayerChangeCarDto {
  roomID: string;
  playerID: string; // Use player _id for identification
  mainCar: number;
}

interface PositionSyncDto {
  roomID: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  speed: number;
  distance?: number; // Distance might not be in all syncs
}

// --- Message Structure ---
// Define a standard structure for messages sent over WebSocket
interface WebSocketMessage {
  event: string; // The event name (e.g., 'createRoom', 'joinRoom')
  data: any; // The payload for the event
}

@Injectable() // Use Injectable instead of WebSocketGateway
export class RacingGateway implements OnModuleInit {
  private server: Server;
  // Map socketId to WebSocket instance
  private clients: Map<string, WebSocket> = new Map();
  // Map socketId to player _id (useful for reverse lookup)
  private clientPlayerMap: Map<string, string> = new Map();
  // In-memory store for rooms
  private rooms: Record<string, RoomData> = {}; // Maps roomID to RoomData

  constructor(
    private readonly roomService: RoomService,
    private readonly playerService: PlayerService,
  ) {}

  // Initialize the WebSocket server when the module starts
  async onModuleInit() {
    const httpServer = getHttpServer();
    if (!httpServer) throw new Error('HTTP server not found');
    this.server = new Server({ server: httpServer });
    console.log(`WebSocket server started`);

    // Load existing rooms from DB on startup
    await this.loadRoomsFromDb();

    this.server.on('connection', (socket: WebSocket) => {
      // Generate a unique ID for the connected socket
      const socketId = uuidv4();
      console.log(`Client connected: ${socketId}`);
      this.clients.set(socketId, socket);

      // Send the initial list of rooms to the newly connected client
      this.sendToClient(socket, 'roomListUpdated', {
        rooms: this.getPublicRoomList(),
      });
      // Send the client its unique socket ID
      this.sendToClient(socket, 'yourSocketId', { socketID: socketId });

      // Handle messages from this client
      socket.on('message', (messageBuffer) => {
        let messageString: string | undefined; // Define messageString here to be accessible in catch
        try {
          // Messages are expected to be JSON strings
          if (Buffer.isBuffer(messageBuffer)) {
            messageString = messageBuffer.toString(); // Chuyển buffer thành chuỗi
          } else {
            // Nếu không phải là Buffer, hãy cố gắng stringify nó
            messageString = JSON.stringify(messageBuffer);
          }

          if (
            typeof messageString === 'string' &&
            messageString.trim() !== ''
          ) {
            const message: WebSocketMessage = JSON.parse(
              messageString,
            ) as WebSocketMessage;

            // Routing the message based on the event name
            this.handleMessage(socket, socketId, message);
          } else {
            throw new Error(
              'Invalid message format: Empty or non-string message',
            );
          }
        } catch (error) {
          // Use messageString if available, otherwise indicate raw buffer couldn't be stringified well
          const receivedContent =
            messageString !== undefined
              ? messageString
              : `(Raw buffer: ${messageBuffer.constructor.name})`; // Provide buffer type if string fails early

          console.error(
            `Failed to parse message or invalid message format from ${socketId}:`,
            receivedContent, // Log the string content that failed parsing
            error,
          );
          this.sendError(socket, 'Invalid message format');
        }
      });

      // Handle client disconnection
      socket.on('close', () => {
        console.log(`Client disconnected: ${socketId}`);
        this.handleDisconnect(socketId);
        // No need to delete from maps here, handleDisconnect does it
      });

      // Handle WebSocket errors
      socket.on('error', (error) => {
        console.error(`WebSocket error for client ${socketId}:`, error);
        // Attempt to clean up resources similar to 'close'
        this.handleDisconnect(socketId);
        // No need to delete from maps here, handleDisconnect does it
      });
    });

    // Periodically broadcast room list updates (optional, but good for keeping clients synced)
    // setInterval(() => this.broadcastRoomList(), 30000); // e.g., every 30 seconds
  }

  // --- Core Message Handling ---

  // Central handler to route incoming messages
  private handleMessage(
    socket: WebSocket,
    socketId: string,
    message: WebSocketMessage,
  ) {
    // Basic validation of the message structure
    if (!message || typeof message.event !== 'string') {
      console.warn(
        `Received malformed message structure from ${socketId}:`,
        message,
      );
      this.sendError(
        socket,
        'Malformed message structure. Expecting { event: string, data: any }',
      );
      return;
    }

    console.log(`Received message from ${socketId}: Event: ${message.event}`); // Avoid logging potentially large data by default
    const { event, data } = message;

    // Route based on the event name
    switch (event) {
      case 'createRoom':
        // Add type validation for data if possible/needed
        this.createRoom(socket, socketId, data as CreateRoomDto);
        break;
      case 'joinRoom':
        this.joinRoom(socket, socketId, data as JoinRoomDto);
        break;
      case 'leaveRoom':
        // leaveRoom doesn't need extra data, it acts on the leaving socket
        this.leaveRoom(socket, socketId);
        break;
      case 'kickPlayer':
        this.kickPlayer(socket, socketId, data as KickPlayerDto);
        break;
      case 'startGame':
        this.startGame(socket, socketId, data as StartGameDto);
        break;
      case 'loadingGame':
        this.loadingGame(socket, socketId, data as LoadingGameDto);
        break;
      case 'playerReady':
        this.playerReady(socket, socketId, data as PlayerReadyDto);
        break;
      case 'playerChangeCar':
        this.playerChangeCar(socket, socketId, data as PlayerChangeCarDto);
        break;
      case 'syncPosition':
        this.syncPosition(socket, socketId, data as PositionSyncDto);
        break;
      case 'syncCarPosition': // Assuming this is different from general sync
        this.syncCarPosition(socket, socketId, data as PositionSyncDto);
        break;
      case 'ping_check': // Handle ping
        this.sendToClient(socket, 'ping_response', {});
        break;
      case 'waitingRoom':
        this.updateStatusWaitingRoom(socket, socketId, data as WaitingRoomDto);
        break;
      // Add other event handlers here
      default:
        console.warn(`Unhandled event type from ${socketId}: ${event}`);
        this.sendError(socket, `Unknown event type: ${event}`);
    }
  }

  // --- Connection & Disconnection Logic ---

  // Handles cleanup when a player disconnects
  private async handleDisconnect(socketId: string) {
    // Prevent duplicate disconnect processing if called multiple times (e.g., from close and error)
    if (!this.clients.has(socketId)) {
      console.log(
        `Disconnect already processed or client not found for socketId: ${socketId}`,
      );
      return;
    }
    console.log(`Processing disconnect for: ${socketId}`);

    // Find which room the player was in
    let roomIDToUpdate: string | null = null;
    let wasHost = false;
    let disconnectedPlayerId: string | undefined;

    // Safely iterate over rooms
    for (const roomID of Object.keys(this.rooms)) {
      const room = this.rooms[roomID];
      // Check if room still exists (might be deleted by another process)
      if (!room) continue;

      const player = room.players[socketId];
      if (player) {
        roomIDToUpdate = roomID;
        wasHost = player.isHost;
        disconnectedPlayerId = player._id; // Get the MongoDB _id

        console.log(
          `Player ${socketId} (${disconnectedPlayerId}) found in room ${roomID}. Was host: ${wasHost}`,
        );

        // Remove player from the in-memory room data
        delete room.players[socketId];

        // --- Database Operations ---
        if (disconnectedPlayerId) {
          // Update player status in DB (optional, e.g., set to Offline)
          // await this.playerService.updatePlayerStatus(disconnectedPlayerId, PlayerStatus.Offline);

          // Remove player from the room in the database
          try {
            await this.roomService.leaveRoom(roomID, disconnectedPlayerId);
            console.log(
              `Player ${disconnectedPlayerId} removed from room ${roomID} in DB.`,
            );
          } catch (dbError) {
            console.error(
              `Error removing player ${disconnectedPlayerId} from room ${roomID} in DB:`,
              dbError,
            );
          }
        }
        // --- End Database Operations ---

        break; // Player can only be in one room
      }
    }

    // If the player was in a room, handle the consequences
    if (roomIDToUpdate) {
      const currentRoomState = this.rooms[roomIDToUpdate]; // Re-fetch state in case it changed

      if (wasHost) {
        console.log(
          `Host ${socketId} left room ${roomIDToUpdate}. Deleting room.`,
        );
        // Notify remaining players the room is closed *before* deleting it
        // Check if room still exists before broadcasting/deleting
        if (currentRoomState) {
          this.broadcastToRoom(
            roomIDToUpdate,
            'roomClosed',
            { reason: 'Host disconnected' },
            null,
          ); // Exclude no one

          // Delete the room from memory and DB
          delete this.rooms[roomIDToUpdate]; // Delete from memory
          try {
            await this.roomService.deleteRoom(roomIDToUpdate);
            console.log(`Room ${roomIDToUpdate} deleted from DB.`);
          } catch (dbError) {
            console.error(
              `Error deleting room ${roomIDToUpdate} from DB:`,
              dbError,
            );
          }
        } else {
          console.warn(
            `Room ${roomIDToUpdate} was already deleted before host disconnect processing finished.`,
          );
        }
      } else if (currentRoomState) {
        // Check if room still exists for non-host leave
        // If a regular player left, update the remaining players
        console.log(
          `Player ${socketId} left room ${roomIDToUpdate}. Updating remaining players.`,
        );
        const remainingPlayers = Object.values(currentRoomState.players || {}); // Use current state
        this.broadcastToRoom(
          roomIDToUpdate,
          'updatePlayers',
          { players: remainingPlayers },
          null,
        ); // Exclude no one
        this.broadcastToRoom(
          roomIDToUpdate,
          'playerLeft',
          { socketID: socketId, playerId: disconnectedPlayerId },
          null,
        ); // Notify about the specific player leaving
      }
      // After handling room logic, update the global room list
      this.broadcastRoomList();
    } else {
      console.log(
        `Disconnected client ${socketId} was not in any active room.`,
      );
    }

    // Clean up client tracking - always do this last
    this.clients.delete(socketId);
    this.clientPlayerMap.delete(socketId);
    console.log(
      `Finished cleanup for disconnected client ${socketId}. Client count: ${this.clients.size}`,
    );
  }

  // --- Database Interaction ---

  // Load rooms from the database and populate the in-memory store
  private async loadRoomsFromDb() {
    try {
      console.log('Loading rooms from database...');
      const roomListFromDb = await this.roomService.getAllRooms();
      const newRoomsData: Record<string, RoomData> = {};

      for (const room of roomListFromDb) {
        // Ensure room has an ID
        if (!room || !room.id) {
          console.warn('Skipping room from DB without ID:', room);
          continue;
        }
        // Basic room structure
        newRoomsData[room.id] = {
          id: room.id,
          value: Number(room.value) || 0,
          password: room.password || null,
          status: room.status || RoomStatus.WAITING, // Default status if missing
          players: {}, // Player details will be added if they reconnect
        };
        // Note: We don't pre-populate players here. Players will be added
        // when they connect/reconnect and join/create a room.
        // The DB state reflects persistence, while the 'rooms' object reflects active connections.
      }

      this.rooms = newRoomsData; // Replace in-memory rooms with DB state
      console.log(
        `Loaded ${Object.keys(this.rooms).length} rooms from DB (structure only).`,
      );
      // Don't broadcast here, broadcast happens after server is fully ready in onModuleInit
    } catch (error) {
      console.error('Error loading rooms from database:', error);
      // Decide how to handle this - maybe retry or start with an empty set
      this.rooms = {};
    }
  }

  // --- Broadcasting and Sending Helpers ---

  // Send a message to a specific client
  private sendToClient(client: WebSocket | string, event: string, data: any) {
    let targetSocketId: string | undefined;
    let targetClient: WebSocket | undefined;

    if (typeof client === 'string') {
      targetSocketId = client;
      targetClient = this.clients.get(client);
    } else {
      // Find socketId associated with the WebSocket object (less efficient)
      for (const [id, ws] of this.clients.entries()) {
        if (ws === client) {
          targetSocketId = id;
          targetClient = ws;
          break;
        }
      }
    }

    if (targetClient && targetClient.readyState === WebSocket.OPEN) {
      try {
        targetClient.send(JSON.stringify({ event, data }));
      } catch (error) {
        console.error(
          `Failed to send message to client ${targetSocketId ?? '[WebSocket Object]'}:`,
          error,
        );
        // Consider closing the socket if sending fails persistently
        // targetClient.close();
        // this.handleDisconnect(targetSocketId); // Trigger cleanup
      }
    } else {
      console.warn(
        `Attempted to send message to closed or unknown client: ${targetSocketId ?? '[WebSocket Object]'}`,
      );
    }
  }

  // Send an error message to a specific client
  private sendError(
    client: WebSocket | string,
    message: string,
    details?: any,
  ) {
    // Avoid sending detailed internal errors to the client unless necessary
    const errorData: { message: string; details?: any } = { message };
    if (process.env.NODE_ENV !== 'production' && details) {
      // Only send details in non-prod environments
      errorData.details = details instanceof Error ? details.message : details;
    }
    this.sendToClient(client, 'error', errorData);
  }

  // Broadcast a message to all connected clients
  private broadcastToAll(
    event: string,
    data: any,
    excludeSocketId?: string | null,
  ) {
    if (this.clients.size === 0) return; // No clients to broadcast to
    console.log(
      `Broadcasting '${event}' to all (${this.clients.size}) clients` +
        (excludeSocketId ? ` excluding ${excludeSocketId}` : ''),
    );
    const message = JSON.stringify({ event, data });
    this.clients.forEach((client, socketId) => {
      if (
        socketId !== excludeSocketId &&
        client.readyState === WebSocket.OPEN
      ) {
        try {
          client.send(message);
        } catch (error) {
          console.error(
            `Failed to broadcast message to client ${socketId}:`,
            error,
          );
          // Consider closing/cleaning up persistently failing clients
          // client.close();
          // this.handleDisconnect(socketId);
        }
      }
    });
  }

  // Broadcast a message to all clients in a specific room
  private broadcastToRoom(
    roomID: string,
    event: string,
    data: any,
    excludeSocketId?: string | null,
  ) {
    const room = this.rooms[roomID];
    if (!room) {
      console.warn(`Attempted to broadcast to non-existent room: ${roomID}`);
      return;
    }
    if (Object.keys(room.players).length === 0) {
      // console.log(`Skipping broadcast to empty room: ${roomID}`);
      return; // No players in the room
    }

    const message = JSON.stringify({ event, data });
    let recipientCount = 0;
    Object.keys(room.players).forEach((socketId) => {
      if (socketId !== excludeSocketId) {
        const client = this.clients.get(socketId);
        if (client && client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
            recipientCount++;
          } catch (error) {
            console.error(
              `Failed to send room message to client ${socketId} in room ${roomID}:`,
              error,
            );
            // Consider closing/cleaning up
            // client.close();
            // this.handleDisconnect(socketId);
          }
        } else {
          // This might happen if a client disconnects but hasn't been fully removed from the room yet
          console.warn(
            `Client ${socketId} in room ${roomID} not found or not open during broadcast.`,
          );
        }
      }
    });
    // console.log(`Broadcasted '${event}' to ${recipientCount} players in room ${roomID}`);
  }

  // Get a simplified list of rooms for broadcasting
  private getPublicRoomList() {
    // Filter out potentially empty or invalid room entries before mapping
    return Object.values(this.rooms)
      .filter((room) => room && room.id && room.status) // Basic validity check
      .map((room) => ({
        id: room.id,
        status: room.status,
        value: room.value,
        isPassword: !!room.password, // Convert password presence to boolean
        playerCount: Object.keys(room.players || {}).length, // Handle case where players might be undefined briefly
        // Add other relevant public info if needed
        // Example: hostName: Object.values(room.players || {}).find(p => p.isHost)?.playerName
      }));
  }

  // Broadcast the current list of rooms to all clients
  private broadcastRoomList() {
    // Debounce or throttle this if it gets called too frequently in rapid succession
    console.log('Broadcasting updated room list...');
    const roomList = this.getPublicRoomList();
    this.broadcastToAll('roomListUpdated', { rooms: roomList });
  }

  // --- Event Handlers (Refactored from @SubscribeMessage) ---

  async createRoom(socket: WebSocket, socketId: string, data: CreateRoomDto) {
    // Validate incoming data
    if (!data || typeof data.playerId !== 'string') {
      this.sendError(
        socket,
        'Invalid data for createRoom. `playerId` is required.',
      );
      return;
    }
    console.log(
      `Attempting to create room for player ${data.playerId} by socket ${socketId}`,
    );

    try {
      // Fetch player details using the provided playerId
      const p = await this.playerService.getPlayerWithId(data.playerId);
      if (!p) {
        this.sendError(socket, 'Player not found.');
        return;
      }
      // Map DB player schema to PlayerData if necessary, or ensure service returns compatible type
      // player = mapPlayerSchemaToPlayerData(p); // Example mapping function

      // Check if player is already in an active room (in memory)
      const existingRoomId = Object.keys(this.rooms).find(
        (roomId) =>
          this.rooms[roomId]?.players &&
          Object.values(this.rooms[roomId].players).some(
            (pl) => pl._id === data.playerId,
          ),
      );
      if (existingRoomId) {
        this.sendError(socket, `Player is already in room ${existingRoomId}.`);
        return;
      }

      // Create room in the database
      const createdRoom = await this.roomService.createRoom({
        value: data.value || 0,
        password: data.password || '', // Store null if no password
        players: [p._id], // Store player's MongoDB ID
        status: RoomStatus.WAITING,
      });

      // Update player's host status in DB (important!)
      await this.playerService.updatePlayerSocket(p._id, socketId, true);

      // Add room to in-memory store
      this.rooms[createdRoom.id] = {
        id: createdRoom.id,
        value: createdRoom.value,
        password: createdRoom.password,
        status: createdRoom.status,
        players: {}, // Initialize players object
      };

      // Create player data for the room (using fetched player 'p')
      const hostPlayerData: PlayerData = {
        _id: p._id,
        socketId: socketId, // Use the current WebSocket connection ID
        telegramId: p.telegramId,
        playerName: p.playerName,
        mainCar: p.mainCar,
        ownerCars: p.ownerCars,
        isHost: true, // This player is the host
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        speed: 0,
        status: PlayerStatus.Ready, // Initial status
        distance: 0,
        isLoaded: false,
      };

      // Add host to the in-memory room
      this.rooms[createdRoom.id].players[socketId] = hostPlayerData;
      // Map socketId to player _id for easy lookup on disconnect
      this.clientPlayerMap.set(socketId, p._id);

      console.log(
        `Player ${socketId} (${p._id}) added as host to room ${createdRoom.id}`,
      );

      // Notify the creator about the room details
      this.sendToClient(socket, 'roomDetails', {
        id: createdRoom.id,
        status: this.rooms[createdRoom.id].status,
        value: this.rooms[createdRoom.id].value,
        playerCount: 1,
        players: [hostPlayerData], // Send array of players
      });

      // Update the global room list for everyone
      this.broadcastRoomList();
    } catch (error) {
      console.error(`Error creating room for player ${data.playerId}:`, error);
      this.sendError(
        socket,
        'Failed to create room.',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async joinRoom(socket: WebSocket, socketId: string, data: JoinRoomDto) {
    // Validate data
    if (
      !data ||
      typeof data.roomID !== 'string' ||
      typeof data.playerId !== 'string'
    ) {
      this.sendError(
        socket,
        'Invalid data for joinRoom. `roomID` and `playerId` are required.',
      );
      return;
    }
    console.log(
      `Attempting join room ${data.roomID} for player ${data.playerId} by socket ${socketId}`,
    );
    const { roomID, playerId, password } = data;

    try {
      const room = this.rooms[roomID];
      if (!room) {
        // Check DB potentially? Or rely on in-memory state primarily.
        // For simplicity, we rely on in-memory state reflecting active/joinable rooms.
        this.sendError(socket, 'Room not found or is not active.');
        return;
      }

      if (room.status !== RoomStatus.WAITING) {
        this.sendError(
          socket,
          'Room is not waiting for players (already running or finished).',
        );
        return;
      }

      // Check password if required
      if (room.password && room.password !== password) {
        this.sendError(socket, 'Incorrect password.');
        return;
      }

      // --- Player Checks ---
      const player = await this.playerService.getPlayerWithId(playerId);
      if (!player) {
        this.sendError(socket, 'Player not found.');
        return;
      }

      const MAX_PLAYERS = 5;
      if (Object.keys(room.players).length >= MAX_PLAYERS) {
        this.sendError(socket, 'Room is full.');
        return;
      }

      // Check if player (by _id) is already in *this* or *another* active room (in memory)
      const existingRoomId = Object.keys(this.rooms).find(
        (rId) =>
          this.rooms[rId]?.players &&
          Object.values(this.rooms[rId].players).some(
            (p) => p._id === playerId,
          ),
      );
      if (existingRoomId) {
        if (existingRoomId === roomID) {
          this.sendError(socket, 'You are already in this room.');
        } else {
          this.sendError(
            socket,
            `Player is already in another room (${existingRoomId}).`,
          );
        }
        return;
      }
      // --- End Player Checks ---

      // Add player to the room in the database
      await this.roomService.addPlayerToRoom(roomID, player._id);
      // Update player's host status (ensure they are not marked as host)
      await this.playerService.updatePlayerSocket(player._id, socketId, false);

      // Create player data for the room
      const newPlayerData: PlayerData = {
        _id: player._id,
        socketId: socketId,
        telegramId: player.telegramId,
        playerName: player.playerName,
        mainCar: player.mainCar,
        ownerCars: player.ownerCars,
        isHost: false, // Joining players are not hosts
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        speed: 0,
        status: PlayerStatus.Waiting,
        distance: 0,
        isLoaded: false,
      };

      // Add player to the in-memory room
      room.players[socketId] = newPlayerData;
      this.clientPlayerMap.set(socketId, player._id);

      console.log(`Player ${socketId} (${player._id}) joined room ${roomID}`);

      // Notify the joining player about the room details
      this.sendToClient(socket, 'roomDetails', {
        id: roomID,
        status: room.status,
        value: room.value,
        playerCount: Object.keys(room.players).length,
        players: Object.values(room.players), // Send updated player list
      });

      // Notify *other* players in the room about the new player
      this.broadcastToRoom(
        roomID,
        'updatePlayers',
        { players: Object.values(room.players) },
        socketId,
      ); // Exclude the joining player
      this.broadcastToRoom(
        roomID,
        'playerJoined',
        { player: newPlayerData },
        socketId,
      ); // Send specific join event

      // Update the global room list for everyone
      this.broadcastRoomList();
    } catch (error) {
      console.error(
        `Error joining room ${roomID} for player ${playerId}:`,
        error,
      );
      this.sendError(
        socket,
        'Failed to join room.',
        error instanceof Error ? error.message : 'Unknown error',
      );
      // Attempt cleanup if DB update succeeded but memory update failed
      try {
        // Check if player was actually added to DB before trying to remove
        const roomInDb = await this.roomService.getRoomWithId(roomID);
        if (roomInDb && roomInDb.players.includes(playerId)) {
          await this.roomService.leaveRoom(roomID, playerId);
          console.log(
            `Cleaned up player ${playerId} from room ${roomID} in DB after join error.`,
          );
        }
      } catch (cleanupError) {
        console.error(
          `Failed to cleanup player ${playerId} from room ${roomID} after join error:`,
          cleanupError,
        );
      }
    }
  }

  async leaveRoom(socket: WebSocket, socketId: string) {
    console.log(`Attempting leave room for socket ${socketId}`);
    const playerId = this.clientPlayerMap.get(socketId);
    let roomIDToLeave: string | null = null;
    let wasHost = false;

    // Find the room the player is in (using the map for efficiency)
    for (const roomID in this.rooms) {
      // Check room and players object existence
      if (this.rooms[roomID]?.players && this.rooms[roomID].players[socketId]) {
        roomIDToLeave = roomID;
        wasHost = this.rooms[roomID].players[socketId].isHost;
        break;
      }
    }

    if (!roomIDToLeave) {
      // Don't send error, client might just be disconnected without being in a room
      console.warn(
        `Socket ${socketId} tried to leave but was not found in any active room.`,
      );
      return;
    }

    // Player ID is crucial for DB operations
    if (!playerId) {
      console.error(
        `Cannot process leave for socket ${socketId}: Player ID not found in map.`,
      );
      // Attempt to remove from room memory anyway, but DB state might become inconsistent
      delete this.rooms[roomIDToLeave].players[socketId];
      this.clientPlayerMap.delete(socketId); // Clean up map
      this.broadcastRoomList(); // Update counts
      return;
    }

    const room = this.rooms[roomIDToLeave]; // Get the room object

    // Check if room still exists (might have been deleted concurrently)
    if (!room) {
      console.warn(
        `Room ${roomIDToLeave} not found during leave processing for socket ${socketId}. Cleaning up maps.`,
      );
      this.clientPlayerMap.delete(socketId);
      return;
    }

    try {
      console.log(
        `Player ${socketId} (${playerId}) leaving room ${roomIDToLeave}. Was host: ${wasHost}`,
      );

      // --- Actions before potential room deletion ---
      // Notify the player they have left (do this early)
      this.sendToClient(socket, 'leftRoom', { roomID: roomIDToLeave });
      // ---

      // Remove player from in-memory room *first*
      delete room.players[socketId];
      this.clientPlayerMap.delete(socketId); // Remove mapping

      // Remove player from DB room
      await this.roomService.leaveRoom(roomIDToLeave, playerId);
      // Optionally reset host status if they were host (though room deletion handles this too)
      // if (wasHost) await this.playerService.updatePlayerHostStatus(playerId, false); // Might be redundant if room is deleted

      if (wasHost) {
        console.log(
          `Host ${socketId} left room ${roomIDToLeave}. Deleting room.`,
        );
        // Notify remaining players *immediately*
        this.broadcastToRoom(
          roomIDToLeave,
          'roomClosed',
          { reason: 'Host left' },
          null,
        ); // Send to all remaining players in the room object (which now excludes the host)

        // Delete room from memory and DB
        delete this.rooms[roomIDToLeave]; // Delete from memory *after* notifying
        await this.roomService.deleteRoom(roomIDToLeave);
        console.log(`Room ${roomIDToLeave} deleted.`);
      } else {
        // If room still exists after non-host leaves
        if (this.rooms[roomIDToLeave]) {
          // Notify remaining players about the departure and update list
          const remainingPlayers = Object.values(room.players); // Get current players in the room object
          this.broadcastToRoom(
            roomIDToLeave,
            'updatePlayers',
            { players: remainingPlayers },
            null,
          );
          this.broadcastToRoom(
            roomIDToLeave,
            'playerLeft',
            { socketId: socketId, playerId: playerId },
            null,
          );
          console.log(
            `Notified room ${roomIDToLeave} about player ${socketId} leaving.`,
          );
        } else {
          console.warn(
            `Room ${roomIDToLeave} was deleted concurrently while processing non-host leave for ${socketId}.`,
          );
        }
      }

      // Update global room list (player count changed or room removed)
      this.broadcastRoomList();
    } catch (error) {
      console.error(
        `Error processing leaveRoom for socket ${socketId} in room ${roomIDToLeave}:`,
        error,
      );
      // Don't send error to the leaving client usually, they might be disconnected
      // Log the error for server monitoring. State might be inconsistent.
      // Consider manual cleanup or reconciliation logic if this happens frequently.
    }
  }

  async kickPlayer(socket: WebSocket, socketId: string, data: KickPlayerDto) {
    // Validate data
    if (
      !data ||
      typeof data.roomID !== 'string' ||
      typeof data.targetSocketID !== 'string'
    ) {
      this.sendError(
        socket,
        'Invalid data for kickPlayer. `roomID` and `targetSocketID` are required.',
      );
      return;
    }
    console.log(
      `Attempting kick by host ${socketId} in room ${data.roomID} targeting ${data.targetSocketID}`,
    );
    const { roomID, targetSocketID } = data;

    // Prevent self-kick
    if (socketId === targetSocketID) {
      this.sendError(socket, 'You cannot kick yourself.');
      return;
    }

    try {
      const room = this.rooms[roomID];
      if (!room) {
        this.sendError(socket, 'Room not found.');
        return;
      }

      // Check if the kicker is the host of *this* room
      const kickerPlayer = room.players[socketId];
      if (!kickerPlayer || !kickerPlayer.isHost) {
        this.sendError(socket, 'Only the host can kick players.');
        return;
      }

      // Find the player to be kicked in *this* room
      const targetPlayer = room.players[targetSocketID];
      if (!targetPlayer) {
        this.sendError(socket, 'Target player not found in this room.');
        return;
      }

      // Cannot kick the host (should be redundant with self-kick check, but good safeguard)
      // if (targetPlayer.isHost) {
      //      this.sendError(socket, 'Cannot kick the host.');
      //      return;
      // }

      const targetPlayerId = targetPlayer._id; // Get the MongoDB ID
      const targetClient = this.clients.get(targetSocketID); // Get the WebSocket object

      console.log(
        `Host ${socketId} kicking player ${targetSocketID} (${targetPlayerId}) from room ${roomID}`,
      );

      // --- Perform Kick ---
      // 1. Notify the kicked player *first*
      if (targetClient) {
        this.sendToClient(targetClient, 'kicked', {
          roomID,
          reason: 'Kicked by host',
        });
        // Optionally close their connection after sending the message? Depends on client handling.
        // Consider a short delay before closing if needed: setTimeout(() => targetClient?.close(), 500);
      } else {
        console.warn(
          `Could not find WebSocket for kicked player ${targetSocketID} to send notification.`,
        );
      }

      // 2. Remove player from memory
      delete room.players[targetSocketID];
      this.clientPlayerMap.delete(targetSocketID);

      // 3. Remove player from DB room
      await this.roomService.leaveRoom(roomID, targetPlayerId);
      // --- End Kick ---

      // Notify remaining players in the room
      const remainingPlayers = Object.values(room.players);
      this.broadcastToRoom(
        roomID,
        'updatePlayers',
        { players: remainingPlayers },
        null,
      );
      this.broadcastToRoom(
        roomID,
        'playerKicked',
        { socketID: targetSocketID, playerId: targetPlayerId },
        null,
      );

      // Update global room list (player count changed)
      this.broadcastRoomList();
    } catch (error) {
      console.error(
        `Error processing kickPlayer by ${socketId} for target ${targetSocketID} in room ${roomID}:`,
        error,
      );
      this.sendError(
        socket,
        'Failed to kick player.',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async playerReady(socket: WebSocket, socketId: string, data: PlayerReadyDto) {
    // Validate data
    if (
      !data ||
      typeof data.roomID !== 'string' ||
      typeof data.playerID !== 'string'
    ) {
      this.sendError(
        socket,
        'Invalid data for playerReady. `roomID` and `playerID` are required.',
      );
      return;
    }
    const { roomID, playerID } = data; // playerID here is the MongoDB _id
    // console.log(`Player ${playerID} (socket: ${socketId}) sending ready status for room ${roomID}`); // Less verbose logging

    try {
      const room = this.rooms[roomID];
      if (!room) {
        // Don't send error, client might be lagging / room closed
        console.warn(
          `Received playerReady for non-existent room ${roomID} from socket ${socketId}`,
        );
        return;
      }

      // Cannot set ready if game is not waiting
      if (room.status !== RoomStatus.WAITING) {
        console.warn(
          `Received playerReady for room ${roomID} not in WAITING state from ${socketId}.`,
        );
        this.sendError(socket, 'Cannot change ready status now.');
        return;
      }

      // Find the player in the room using socketId (more reliable for active connection)
      const player = room.players[socketId];

      // Verify the player _id matches the one associated with the socketId AND the one sent in data
      if (
        !player ||
        player._id !== playerID ||
        this.clientPlayerMap.get(socketId) !== playerID
      ) {
        console.warn(
          `Player ready mismatch/not found: socket ${socketId} ${this.clientPlayerMap.get(socketId)} sent ready for player ${playerID}, but map/room data inconsistent.`,
        );
        this.sendError(socket, 'Player mismatch or not found in room.');
        return;
      }

      // Avoid redundant updates and broadcasts
      if (player.status === PlayerStatus.Ready) {
        // console.log(`Player ${playerID} (socket: ${socketId}) is already ready.`);
        // Optionally send confirmation back or just ignore
        // this.sendToClient(socket, 'alreadyReady', { roomID });
        return;
      }

      // Update player status in memory
      player.status = PlayerStatus.Ready;
      console.log(
        `Player ${playerID} (socket: ${socketId}) marked as Ready in room ${roomID}`,
      );

      // Update player status in DB
      await this.playerService.updatePlayerStatus(
        player._id,
        PlayerStatus.Ready,
      );

      // Notify the player themselves (optional confirmation)
      // this.sendToClient(socket, 'youAreReady', { roomID });

      // Notify everyone in the room about the updated player list and the specific ready event
      this.broadcastToRoom(
        roomID,
        'updatePlayers',
        { players: Object.values(room.players) },
        null,
      );
      this.broadcastToRoom(
        roomID,
        'playerIsReady',
        { socketID: socketId, playerId: player._id },
        null,
      );
    } catch (error) {
      console.error(
        `Error setting player ${playerID} (socket: ${socketId}) to ready in room ${roomID}:`,
        error,
      );
      this.sendError(
        socket,
        'Failed to set ready status.',
        error instanceof Error ? error.message : 'Unknown error',
      );
      // Attempt to revert in-memory status if DB update failed? Or log inconsistency.
      const room = this.rooms[roomID];
      if (room && room.players[socketId]) {
        room.players[socketId].status = PlayerStatus.Ready; // Revert optimistic update
        // Consider re-broadcasting the reverted state
        this.broadcastToRoom(
          roomID,
          'updatePlayers',
          { players: Object.values(room.players) },
          null,
        );
      }
    }
  }

  async playerChangeCar(
    socket: WebSocket,
    socketId: string,
    data: PlayerChangeCarDto,
  ) {
    // Validate data
    if (
      !data ||
      typeof data.roomID !== 'string' ||
      typeof data.playerID !== 'string' ||
      typeof data.mainCar !== 'number'
    ) {
      this.sendError(
        socket,
        'Invalid data for playerChangeCar. `roomID`, `playerID`, and `mainCar` (number) are required.',
      );
      return;
    }
    const { roomID, playerID, mainCar } = data; // playerID is likely MongoDB _id
    // console.log(`Player ${playerID} (socket: ${socketId}) changing car to ${mainCar} in room ${roomID}`);

    try {
      const room = this.rooms[roomID];
      if (!room) {
        console.warn(
          `Received playerChangeCar for non-existent room ${roomID} from socket ${socketId}`,
        );
        return;
      }

      // Cannot change car if game is not waiting
      if (room.status !== RoomStatus.WAITING) {
        console.warn(
          `Received playerChangeCar for room ${roomID} not in WAITING state from ${socketId}.`,
        );
        this.sendError(socket, 'Cannot change car now.');
        return;
      }

      // Find player by socketId
      const player = room.players[socketId];
      if (
        !player ||
        player._id !== playerID ||
        this.clientPlayerMap.get(socketId) !== playerID
      ) {
        console.warn(
          `Player change car mismatch/not found: socket ${socketId} sent for player ${playerID}, but map/room data inconsistent.`,
        );
        this.sendError(socket, 'Player mismatch or not found in room.');
        return;
      }

      // Avoid redundant updates
      if (player.mainCar === mainCar) {
        return;
      }

      // Validate if the player owns the car (using player.ownerCars)
      // Ensure ownerCars is an array before checking
      if (
        !Array.isArray(player.ownerCars) ||
        !player.ownerCars.some(
          (carEntry) => carEntry && carEntry.id === mainCar,
        )
      ) {
        this.sendError(socket, 'You do not own this car.');
        console.warn(
          `Player ${playerID} (socket: ${socketId}) attempted to select unowned car ${mainCar}`,
        );
        return;
      }

      // Update main car in memory
      player.mainCar = mainCar;
      // If changing car un-readies the player:
      // player.status = PlayerStatus.Connected;
      console.log(
        `Player ${playerID} (socket: ${socketId}) car changed to ${mainCar} in memory.`,
      );

      // Update main car in DB (important for persistence)
      // This might require a specific service method like updatePlayerPreferences or similar
      await this.playerService.updateMainCar(player._id, mainCar); // Assuming such a method exists
      // If changing car un-readies:
      // await this.playerService.updatePlayerStatus(player._id, PlayerStatus.Connected);

      // Notify everyone in the room about the updated player list
      this.broadcastToRoom(
        roomID,
        'updatePlayers',
        { players: Object.values(room.players) },
        null,
      );
      // Optionally send a specific event for car change
      // this.broadcastToRoom(roomID, 'playerChangedCar', { socketId: socketId, playerId: player._id, newCarId: mainCar }, null);
    } catch (error) {
      console.error(
        `Error changing car for player ${playerID} (socket: ${socketId}) in room ${roomID}:`,
        error,
      );
      this.sendError(
        socket,
        'Failed to change car.',
        error instanceof Error ? error.message : 'Unknown error',
      );
      // Revert in-memory change if DB failed?
      const room = this.rooms[roomID];
      if (room && room.players[socketId]) {
        // Fetch original car ID maybe? Or just log inconsistency.
      }
    }
  }

  async updateStatusWaitingRoom(
    socket: WebSocket,
    socketId: string,
    data: WaitingRoomDto,
  ) {
    if (!data || typeof data.roomID !== 'string') {
      this.sendError(
        socket,
        'Invalid data for waiting room. `roomID` are required.',
      );
      return;
    }
    const { roomID } = data;
    console.log(`Attempting to status waiting room `);

    try {
      const room = this.rooms[roomID];

      if (!room) {
        this.sendError(socket, 'Room not found.');
        return;
      }

      // Check if the requester is the host
      const player = room.players[socketId];
      if (!player || !player.isHost) {
        this.sendError(socket, 'Only the host can change status in the game.');
        return;
      }

      room.status = RoomStatus.WAITING;
      await this.roomService.updateRoomStatus(roomID, RoomStatus.WAITING);

      for (const p of Object.values(room.players)) {
        if (!p.isHost) {
          p.status = PlayerStatus.Waiting;
          await this.playerService.updatePlayerStatus(p._id, p.status);
        }
      }

      console.log(`Room ${roomID} status updated to WAITING.`);

      this.broadcastToRoom(
        roomID,
        'updateWaitingRoom',
        {
          roomID: roomID,
          status: room.status,
        },
        null,
      );

      this.broadcastToRoom(
        roomID,
        'updatePlayers',
        { players: Object.values(room.players) },
        null,
      );

      this.broadcastRoomList();
    } catch (error) {
      console.error(
        `Error starting game in room ${roomID} by host ${socketId}:`,
        error,
      );
    }
  }

  async startGame(socket: WebSocket, socketId: string, data: StartGameDto) {
    // Validate data
    if (
      !data ||
      typeof data.roomID !== 'string' ||
      typeof data.map !== 'number'
    ) {
      this.sendError(
        socket,
        'Invalid data for startGame. `roomID` and `map` (number) are required.',
      );
      return;
    }
    const { roomID, map } = data;
    console.log(
      `Attempting to start game in room ${roomID} with map ${map} by socket ${socketId}`,
    );

    try {
      const room = this.rooms[roomID];
      if (!room) {
        this.sendError(socket, 'Room not found.');
        return;
      }

      // Check if the requester is the host
      const player = room.players[socketId];
      if (!player || !player.isHost) {
        this.sendError(socket, 'Only the host can start the game.');
        return;
      }

      if (room.status !== RoomStatus.WAITING) {
        this.sendError(
          socket,
          'Game cannot be started (not in WAITING state).',
        );
        return;
      }

      // Require minimum players?
      const MIN_PLAYERS = 1; // Or 2?
      if (Object.keys(room.players).length < MIN_PLAYERS) {
        this.sendError(
          socket,
          `Need at least ${MIN_PLAYERS} player(s) to start.`,
        );
        return;
      }

      // Optional: Check if all players are ready
      const allReady = Object.values(room.players).every(
        (p) => p.status === PlayerStatus.Ready,
      );
      const forceStart = false; // Add a flag if you want to allow host to force start
      if (!allReady && !forceStart) {
        this.sendError(socket, 'Not all players are ready.');
        // Optionally list not-ready players
        const notReady = Object.values(room.players)
          .filter((p) => p.status !== PlayerStatus.Ready)
          .map((p) => p.playerName);
        this.sendToClient(socket, 'playersNotReady', { players: notReady });
        return;
        // console.warn(`Starting game in room ${roomID} even though not all players are ready.`);
      }

      // --- Start Game Sequence ---
      // 1. Update room status in memory and DB
      room.status = RoomStatus.RUNNING; // Or STARTING if there's a countdown phase
      await this.roomService.updateRoomStatus(roomID, RoomStatus.RUNNING);
      console.log(`Room ${roomID} status updated to RUNNING.`);

      // 2. Reset player game state for the new game
      Object.values(room.players).forEach((p) => {
        p.isLoaded = false;
        p.distance = 0; // Reset distance
        p.position = { x: 0, y: 0, z: 0 }; // Reset position
        p.rotation = { x: 0, y: 0, z: 0 }; // Reset rotation
        p.speed = 0;
      });
      // Persist status change if needed (e.g., PlayerStatus.Loading)
      // const playerIds = Object.values(room.players).map(p => p._id);
      // await this.playerService.updateMultiplePlayerStatuses(playerIds, PlayerStatus.Loading);

      // 3. Notify all players in the room that the game has started
      this.broadcastToRoom(
        roomID,
        'gameStarted',
        {
          roomID: roomID,
          map: map, // Send the chosen map ID
          status: room.status,
          // Send initial player state for the game start
          players: Object.values(room.players).map((p) => ({
            socketId: p.socketId,
            playerId: p._id,
            playerName: p.playerName,
            mainCar: p.mainCar,
            isHost: p.isHost,
            // Initial position/rotation might be set based on map spawn points later
            position: p.position,
            rotation: p.rotation,
          })),
        },
        null,
      );

      console.log(`Game started in room ${roomID} on map ${map}.`);

      // 4. Update the global room list (status changed)
      this.broadcastRoomList();
      // --- End Game Sequence ---
    } catch (error) {
      console.error(
        `Error starting game in room ${roomID} by host ${socketId}:`,
        error,
      );
      this.sendError(
        socket,
        'Failed to start game.',
        error instanceof Error ? error.message : 'Unknown error',
      );
      // Revert status if DB update failed or other error occurred mid-sequence
      const room = this.rooms[roomID];
      if (room && room.status === RoomStatus.RUNNING) {
        // Only revert if it was changed
        room.status = RoomStatus.WAITING;
        // Also revert player statuses if they were changed
        Object.values(room.players).forEach((p) => {
          p.status = PlayerStatus.Ready; // Or Ready if they were ready before
        });
        // Attempt to revert DB status
        try {
          await this.roomService.updateRoomStatus(roomID, RoomStatus.WAITING);
          // await this.playerService.updateMultiplePlayerStatuses(...) // Revert player statuses in DB
          this.broadcastRoomList(); // Broadcast reverted status
          this.broadcastToRoom(roomID, 'gameStartFailed', {}, null); // Notify players
        } catch (revertError) {
          console.error(
            `Failed to revert room ${roomID} status after startGame error:`,
            revertError,
          );
        }
      }
    }
  }

  loadingGame(socket: WebSocket, socketId: string, data: LoadingGameDto) {
    // Validate data
    if (
      !data ||
      typeof data.roomID !== 'string' ||
      typeof data.playerID !== 'string'
    ) {
      // Don't send error for potentially stale messages
      console.warn(`Received invalid loadingGame data from ${socketId}.`);
      return;
    }
    const { roomID, playerID } = data; // playerID is MongoDB _id
    // console.log(`Player ${playerID} (socket: ${socketId}) reported loading finished for room ${roomID}`);

    try {
      const room = this.rooms[roomID];
      if (!room) {
        // Don't send error, client might be lagging behind room closure/deletion
        // console.warn(`Received loadingGame for non-existent room ${roomID} from socket ${socketId}`);
        return;
      }

      // Game must be running (or starting) to accept loading confirmations
      if (
        room.status !==
        RoomStatus.RUNNING /* && room.status !== RoomStatus.STARTING */
      ) {
        console.warn(
          `Received loadingGame for room ${roomID} not in RUNNING state from socket ${socketId}`,
        );
        // Optionally ignore or send an error if unexpected
        // this.sendError(socket, 'Game is not in a state expecting loading confirmation.');
        return;
      }

      const player = room.players[socketId];
      // Verify player exists and IDs match
      if (
        !player ||
        player._id !== playerID ||
        this.clientPlayerMap.get(socketId) !== playerID
      ) {
        console.warn(
          `Received loadingGame from socket ${socketId} for player ${playerID}, but mismatch/not found.`,
        );
        // Don't send error usually, could be race condition on disconnect/reconnect
        return;
      }

      // Avoid redundant processing
      if (player.isLoaded) {
        // console.log(`Player ${playerID} (socket: ${socketId}) already marked as loaded.`);
        return; // Already processed
      }

      // Mark player as loaded in memory
      player.isLoaded = true;
      player.status = PlayerStatus.Ready; // Update status to InGame now they are loaded
      console.log(
        `Player ${playerID} (socket: ${socketId}) marked as loaded and InGame in room ${roomID}.`,
      );

      // Persist InGame status (optional, depends if needed elsewhere)
      // await this.playerService.updatePlayerStatus(player._id, PlayerStatus.InGame);

      // Notify others that this player is loaded (optional, for loading screens)
      // this.broadcastToRoom(roomID, 'playerFinishedLoading', { socketId: socketId, playerId: player._id }, socketId);
      // More useful: Broadcast updated player list with new status
      this.broadcastToRoom(
        roomID,
        'updatePlayers',
        { players: Object.values(room.players) },
        null,
      );

      // Check if all *currently connected* players in the room are loaded
      const allPlayersInRoom = Object.values(room.players);
      const allPlayersLoaded =
        allPlayersInRoom.length > 0 &&
        allPlayersInRoom.every((p) => p.isLoaded);

      if (allPlayersLoaded) {
        console.log(
          `All players in room ${roomID} are loaded. Broadcasting allPlayersLoaded.`,
        );
        // Notify everyone the game can visually start or countdown can begin
        this.broadcastToRoom(
          roomID,
          'allPlayersLoaded',
          { roomID: roomID },
          null,
        );

        // Optional: Reset isLoaded flag if needed for subsequent rounds/reloads within the same room instance
        // Object.values(room.players).forEach(p => p.isLoaded = false);
      } else {
        const loadedCount = allPlayersInRoom.filter((p) => p.isLoaded).length;
        const totalCount = allPlayersInRoom.length;
        console.log(
          `Room ${roomID}: ${loadedCount}/${totalCount} players loaded.`,
        );
        // Optionally broadcast progress:
        // this.broadcastToRoom(roomID, 'loadingProgress', { loaded: loadedCount, total: totalCount }, null);
      }
    } catch (error) {
      // Should generally not have errors here unless accessing room/player fails unexpectedly
      console.error(
        `Error processing loadingGame for player ${playerID} (socket: ${socketId}) in room ${roomID}:`,
        error,
      );
    }
  }

  syncPosition(socket: WebSocket, socketId: string, data: PositionSyncDto) {
    const { roomID, position, rotation, speed, distance } = data;

    // Basic validation to prevent excessive logging/processing
    // Add more specific checks for position/rotation object structure if needed
    if (
      !roomID ||
      !position ||
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      typeof position.z !== 'number' ||
      !rotation ||
      typeof rotation.x !== 'number' ||
      typeof rotation.y !== 'number' ||
      typeof rotation.z !== 'number' ||
      typeof speed !== 'number'
    ) {
      // console.warn(`Received incomplete/invalid syncPosition from ${socketId} for room ${roomID}`);
      // Avoid sending errors for high-frequency events
      return;
    }

    const room = this.rooms[roomID];
    // Don't send error if room doesn't exist, client might be lagging / sending to closed room
    if (!room || room.status !== RoomStatus.RUNNING) {
      // console.warn(`Received syncPosition for non-existent or non-running room ${roomID} from ${socketId}`);
      return;
    }

    const player = room.players[socketId];
    // Don't send error if player isn't in the room (e.g., just left/kicked/disconnected)
    if (!player) {
      // console.warn(`Received syncPosition from unknown socket ${socketId} in room ${roomID}`);
      return;
    }

    // --- Update player state in memory ---
    // Avoid creating new objects frequently if possible for performance
    player.position.x = position.x;
    player.position.y = position.y;
    player.position.z = position.z;
    player.rotation.x = rotation.x;
    player.rotation.y = rotation.y;
    player.rotation.z = rotation.z;
    player.speed = speed;
    // Only update distance if provided and is a number
    if (typeof distance === 'number') {
      player.distance = distance;
    }
    // --- End update player state ---

    // --- Broadcast position update ---
    // Throttle or debounce broadcasting if updates are too frequent?
    // For real-time games, usually broadcast immediately but consider client-side interpolation.
    this.broadcastToRoom(
      roomID,
      'playerPositionUpdate',
      {
        socketID: socketId, // Identify which player moved
        // playerId: player._id, // Usually not needed if client maps socketId
        position: player.position, // Send the updated state
        rotation: player.rotation,
        speed: player.speed,
        distance: player.distance, // Include distance if relevant for UI/ranking
      },
      socketId,
    ); // Exclude the sender
    // --- End broadcast ---
  }

  syncCarPosition(socket: WebSocket, socketId: string, data: PositionSyncDto) {
    // This seems very similar to syncPosition.
    // If the data and purpose are identical, REMOVE this handler and use syncPosition.
    // If it's *only* for broadcasting visual transform *without* updating server state (like distance), keep it distinct.
    // Assuming it's for purely visual broadcast:

    const { roomID, position, rotation, speed } = data;

    // Validate data (similar to syncPosition)
    if (
      !roomID ||
      !position ||
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      typeof position.z !== 'number' ||
      !rotation ||
      typeof rotation.x !== 'number' ||
      typeof rotation.y !== 'number' ||
      typeof rotation.z !== 'number' ||
      typeof speed !== 'number'
    ) {
      // console.warn(`Received incomplete/invalid syncCarPosition from ${socketId} for room ${roomID}`);
      return;
    }

    const room = this.rooms[roomID];
    // Check room exists and is running
    if (!room || room.status !== RoomStatus.RUNNING) {
      // console.warn(`Received syncCarPosition for non-existent or non-running room ${roomID} from ${socketId}`);
      return;
    }

    // Check if the player exists just to ensure the sender is valid, but don't update memory here
    const player = room.players[socketId];
    if (!player) {
      // console.warn(`Received syncCarPosition from unknown socket ${socketId} in room ${roomID}`);
      return;
    }

    // Broadcast the raw car transform data to others
    this.broadcastToRoom(
      roomID,
      'carPositionUpdate',
      {
        // Use a distinct event name
        socketID: socketId,
        // playerId: player._id, // Optional: include if needed by client
        position: position, // Send the data received directly
        rotation: rotation,
        speed: speed,
      },
      socketId,
    ); // Exclude the sender
  }

  // --- Add other event handlers as needed ---
  // Example: finishRace, chatMessage, etc.
}

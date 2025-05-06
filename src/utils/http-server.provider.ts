import { Server as HttpServer } from 'http';

let _httpServer: HttpServer | null = null;

export function setHttpServer(server: HttpServer) {
  _httpServer = server;
}

export function getHttpServer(): HttpServer {
  if (!_httpServer) throw new Error('HTTP server has not been set yet');
  return _httpServer;
}

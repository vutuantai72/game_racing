// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { createServer } from 'http';
import { setHttpServer } from './utils/http-server.provider'; // ✅ bạn cần tạo file này (xem bên dưới)

async function bootstrap() {
  const expressApp = express();

  const httpServer = createServer(expressApp);
  setHttpServer(httpServer); // ✅ lưu lại để WebSocketService truy cập được

  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );
  app.setGlobalPrefix('api');
  app.enableCors();

  await app.init();

  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    console.log(`HTTP/WebSocket server listening on port ${port}`);
  });
}

bootstrap();

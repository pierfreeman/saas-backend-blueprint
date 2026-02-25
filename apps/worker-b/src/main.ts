import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const logger = new Logger("Worker-Compute-B");

  // Create microservice (no HTTP server)
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
      },
    },
  );

  await app.listen();
  logger.log("Worker-Compute-B started and listening to Redis events");
}

bootstrap().catch((error) => {
  console.error("Worker-Compute-B failed to start:", error);
  process.exit(1);
});

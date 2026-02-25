import { Module } from "@nestjs/common";
import { PubSubService } from "./services/pubsub.service";
import { CacheService } from "./services/cache.service";

/**
 * Redis Module
 * Provides Pub/Sub and Cache services for the application
 */
@Module({
  providers: [PubSubService, CacheService],
  exports: [PubSubService, CacheService],
})
export class RedisModule {}

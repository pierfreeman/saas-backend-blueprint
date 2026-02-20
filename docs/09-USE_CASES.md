# Real-World Use Cases Examples

Esempi pratici di integrazione del sistema notifiche in scenari reali.

## 📋 Use Cases

### 1. Notifica Nuovo Membro nel Team

Quando un admin invita un nuovo membro, notificare tutti i membri esistenti.

```typescript
// src/modules/teams/teams.service.ts
import { NotificationsService } from '../notifications/services/notifications.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    // ... altri servizi
  ) {}

  async addMemberToTeam(teamId: string, userId: string): Promise<void> {
    const team = await this.getTeam(teamId);
    const newMember = await this.getUser(userId);

    // Aggiungi membro al team
    await this.prisma.teamMember.create({
      data: { teamId, userId },
    });

    // Notifica tutti i membri esistenti (escluso il nuovo)
    const existingMembers = await this.getTeamMembers(teamId);
    const memberIds = existingMembers.filter((m) => m.userId !== userId).map((m) => m.userId);

    await this.notificationsService.notifyManyUsers(memberIds, {
      type: 'team_member_added',
      title: `Nuovo membro in ${team.name}`,
      body: `${newMember.email} è stato aggiunto al team.`,
      metadata: {
        teamId,
        newUserId: userId,
        action: 'view_team',
      },
    });
  }
}
```

---

### 2. Notifica Scadenza Subscription

Automatic reminder system for expiring subscriptions.

```typescript
// src/modules/subscriptions/subscription-reminder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/services/notifications.service';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class SubscriptionReminderService {
  private readonly logger = new Logger(SubscriptionReminderService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  // Cron job eseguito ogni giorno alle 9:00
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendExpiringReminders(): Promise<void> {
    this.logger.log('Checking for expiring subscriptions...');

    // Find subscriptions expiring in 7 days
    const expiringSubscriptions = await this.subscriptionsService.findExpiringInDays(7);

    for (const subscription of expiringSubscriptions) {
      const org = subscription.organization;
      const owners = await this.getOrganizationOwners(org.id);

      await this.notificationsService.notifyManyUsers(
        owners.map((o) => o.userId),
        {
          type: 'subscription_expiring',
          title: '⚠️ Subscription Expiring',
          body: `Your ${subscription.plan} subscription expires in 7 days. Renew now to continue using all features.`,
          metadata: {
            subscriptionId: subscription.id,
            expirationDate: subscription.currentPeriodEnd?.toISOString(),
            plan: subscription.plan,
            action: 'renew_subscription',
          },
        },
      );
    }

    this.logger.log(`Sent ${expiringSubscriptions.length} expiration reminders`);
  }
}
```

---

### 3. Notifica Eventi Audit Critici

Notificare admin quando succedono eventi critici (es. cambio ruolo, eliminazione dati).

```typescript
// src/modules/audit/audit.service.ts
import { NotificationsService } from '../notifications/services/notifications.service';
import { AdminService } from '../admin/admin.service';

@Injectable()
export class AuditService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly adminService: AdminService,
  ) {}

  async logCriticalEvent(event: {
    type: string;
    userId: string;
    orgId: string;
    action: string;
    details: any;
  }): Promise<void> {
    // Log su database
    await this.createAuditEvent(event);

    // Se evento critico, notifica admin
    const criticalEvents = [
      'role_changed',
      'organization_deleted',
      'data_exported',
      'billing_failed',
    ];

    if (criticalEvents.includes(event.type)) {
      const admins = await this.adminService.getSuperAdmins();
      const user = await this.getUser(event.userId);

      await this.notificationsService.notifyManyUsers(
        admins.map((a) => a.id),
        {
          type: 'audit_alert',
          title: `🔴 Alert: ${event.action}`,
          body: `User ${user.email} performed: ${event.action} on organization ${event.orgId}`,
          metadata: {
            eventType: event.type,
            userId: event.userId,
            orgId: event.orgId,
            timestamp: new Date().toISOString(),
            details: event.details,
          },
        },
      );
    }
  }
}
```

---

### 4. Notifica Welcome Post-Registration

Mandare notifica di benvenuto quando utente si registra.

```typescript
// src/modules/auth/auth.service.ts
import { NotificationsService } from '../notifications/services/notifications.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly notificationsService: NotificationsService,
    // ...
  ) {}

  async syncUser(auth0Id: string, email: string): Promise<User> {
    let user = await this.findUserByAuth0Id(auth0Id);

    if (!user) {
      // Nuovo utente - crea e invia welcome
      user = await this.createUser(auth0Id, email);

      // Invia notifica di benvenuto
      await this.notificationsService.createNotification(user.id, {
        type: 'welcome',
        title: '👋 Welcome to Multi-tenant SaaS Backend Blueprint!',
        body: 'Thanks for joining. Start with creating your first team.',
        metadata: {
          action: 'onboarding_tour',
          tourSteps: ['create_organization', 'add_team', 'invite_members'],
        },
      });
    }

    return user;
  }
}
```

---

### 5. Notifica Real-time su Aggiornamento Dati

Notificare utenti quando dati che stanno visualizzando vengono modificati.

```typescript
// src/modules/players/players.service.ts
import { NotificationsService } from '../notifications/services/notifications.service';

@Injectable()
export class PlayersService {
  constructor(
    private readonly notificationsService: NotificationsService,
    // ...
  ) {}

  async updatePlayerStats(
    playerId: string,
    stats: UpdateStatsDto,
    updatedBy: string,
  ): Promise<Player> {
    const player = await this.getPlayer(playerId);

    // Aggiorna stats
    const updated = await this.prisma.player.update({
      where: { id: playerId },
      data: { stats },
    });

    // Notifica membri del team
    const teamMembers = await this.getTeamMembers(player.teamId);
    const memberIds = teamMembers.filter((m) => m.userId !== updatedBy).map((m) => m.userId);

    await this.notificationsService.notifyManyUsers(memberIds, {
      type: 'player_stats_updated',
      title: `📊 Stats aggiornate: ${player.name}`,
      body: `Le statistiche di ${player.name} sono state aggiornate.`,
      metadata: {
        playerId,
        teamId: player.teamId,
        updatedBy,
        action: 'view_player',
      },
    });

    return updated;
  }
}
```

---

### 6. Notifica Commenti/Menzioni

Sistema di notifica per commenti e menzioni in stile social.

```typescript
// src/modules/comments/comments.service.ts
import { NotificationsService } from '../notifications/services/notifications.service';

@Injectable()
export class CommentsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    // ...
  ) {}

  async createComment(postId: string, userId: string, content: string): Promise<Comment> {
    const comment = await this.prisma.comment.create({
      data: { postId, userId, content },
    });

    // Estrai menzioni (@username)
    const mentions = this.extractMentions(content);

    if (mentions.length > 0) {
      const mentionedUsers = await this.findUsersByUsername(mentions);

      await this.notificationsService.notifyManyUsers(
        mentionedUsers.map((u) => u.id),
        {
          type: 'mention',
          title: '💬 Sei stato menzionato',
          body: `${this.getUserDisplayName(userId)} ti ha menzionato in un commento.`,
          metadata: {
            commentId: comment.id,
            postId,
            mentionedBy: userId,
            action: 'view_comment',
          },
        },
      );
    }

    // Notifica autore originale del post (se diverso)
    const post = await this.getPost(postId);
    if (post.authorId !== userId) {
      await this.notificationsService.createNotification(post.authorId, {
        type: 'comment_reply',
        title: '💬 Nuovo commento',
        body: `${this.getUserDisplayName(userId)} ha commentato il tuo post.`,
        metadata: {
          commentId: comment.id,
          postId,
          commentBy: userId,
          action: 'view_post',
        },
      });
    }

    return comment;
  }

  private extractMentions(text: string): string[] {
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const matches = text.match(mentionRegex);
    return matches ? matches.map((m) => m.substring(1)) : [];
  }
}
```

---

### 7. Batch Notifications con Rate Limiting

Evitare spam raggruppando notifiche simili.

```typescript
// src/modules/notifications/batch-notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RedisService } from '../../redis/redis.service';

interface BatchNotification {
  userId: string;
  type: string;
  items: any[];
}

@Injectable()
export class BatchNotificationService {
  private readonly logger = new Logger(BatchNotificationService.name);
  private readonly BATCH_KEY_PREFIX = 'notif-batch:';
  private readonly BATCH_INTERVAL_MS = 60000; // 1 minuto

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  async addToBatch(userId: string, type: string, item: any): Promise<void> {
    const key = `${this.BATCH_KEY_PREFIX}${userId}:${type}`;

    // Aggiungi item alla lista Redis
    const client = this.redis.getClient();
    await client.rpush(key, JSON.stringify(item));
    await client.expire(key, 120); // 2 minuti TTL

    // Schedule flush se primo item
    const count = await client.llen(key);
    if (count === 1) {
      setTimeout(() => this.flushBatch(userId, type), this.BATCH_INTERVAL_MS);
    }
  }

  private async flushBatch(userId: string, type: string): Promise<void> {
    const key = `${this.BATCH_KEY_PREFIX}${userId}:${type}`;
    const client = this.redis.getClient();

    // Recupera tutti gli items
    const items = await client.lrange(key, 0, -1);
    if (items.length === 0) return;

    // Pulisci batch
    await client.del(key);

    // Crea notifica aggregata
    const parsedItems = items.map((i) => JSON.parse(i));

    await this.notificationsService.createNotification(userId, {
      type: `${type}_batch`,
      title: this.getBatchTitle(type, parsedItems.length),
      body: this.getBatchBody(type, parsedItems),
      metadata: {
        batchType: type,
        count: parsedItems.length,
        items: parsedItems,
      },
    });

    this.logger.log(`Flushed batch for ${userId}:${type} (${items.length} items)`);
  }

  private getBatchTitle(type: string, count: number): string {
    const titles: Record<string, string> = {
      team_update: `${count} aggiornamenti del team`,
      comment: `${count} nuovi commenti`,
      like: `${count} persone hanno messo mi piace`,
    };
    return titles[type] || `${count} nuove notifiche`;
  }

  private getBatchBody(type: string, items: any[]): string {
    // Crea corpo messaggio aggregato
    if (type === 'like') {
      const names = items.slice(0, 3).map((i) => i.userName);
      const others = items.length - 3;
      const nameList = names.join(', ');
      return others > 0
        ? `${nameList} e altre ${others} persone hanno messo mi piace`
        : `${nameList} hanno messo mi piace`;
    }
    return `Hai ${items.length} nuovi aggiornamenti`;
  }
}

// Uso
/*
// Invece di mandare notifica immediata:
await batchNotificationService.addToBatch(userId, 'like', {
  postId: '123',
  userName: 'Mario Rossi',
});
*/
```

---

### 8. Sistema di Preferenze Utente

Permettere utenti di disabilitare certi tipi di notifiche.

```typescript
// src/modules/notifications/notification-preferences.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Aggiungi al schema Prisma:
/*
model NotificationPreference {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @unique @map("user_id") @db.Uuid
  settings  Json     // { "welcome": true, "team_update": false, ... }
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notification_preferences")
}
*/

interface NotificationSettings {
  [notificationType: string]: boolean;
}

@Injectable()
export class NotificationPreferencesService {
  private readonly DEFAULT_SETTINGS: NotificationSettings = {
    welcome: true,
    team_member_added: true,
    team_update: true,
    subscription_expiring: true,
    audit_alert: true,
    player_stats_updated: true,
    mention: true,
    comment_reply: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(userId: string): Promise<NotificationSettings> {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });

    return prefs ? (prefs.settings as NotificationSettings) : this.DEFAULT_SETTINGS;
  }

  async updatePreferences(
    userId: string,
    settings: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const current = await this.getPreferences(userId);
    const updated = { ...current, ...settings };

    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        settings: updated as any,
      },
      update: {
        settings: updated as any,
      },
    });

    return updated;
  }

  async shouldNotify(userId: string, type: string): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    return prefs[type] !== false; // Default true if not set
  }
}

// Modify NotificationsService to use preferences:
/*
async createNotification(userId: string, dto: CreateNotificationDto) {
  // Check preferences
  const shouldSend = await this.preferencesService.shouldNotify(userId, dto.type);
  if (!shouldSend) {
    this.logger.debug(`Notification blocked by user preferences: ${userId}:${dto.type}`);
    return;
  }

  // Proceed with normal creation...
}
*/
```

---

## 📊 Performance Tips

### Notifiche Massive

Quando mandi notifiche a **migliaia di utenti**, usa chunking:

```typescript
async notifyManyUsersChunked(
  userIds: string[],
  dto: CreateNotificationDto,
  chunkSize: number = 100,
): Promise<void> {
  const chunks = this.chunkArray(userIds, chunkSize);

  for (const chunk of chunks) {
    await this.notifyManyUsers(chunk, dto);
    // Pausa per evitare sovraccarico
    await this.sleep(100);
  }
}

private chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## 🔍 Debugging

### Log events per troubleshooting

```typescript
// Aggiungi logger custom
import { Logger } from '@nestjs/common';

const logger = new Logger('NotificationFlow');

// Log quando crei notifica
logger.debug(`Creating notification for user ${userId}, type: ${dto.type}`);

// Log quando pubblichi su Redis
logger.debug(`Published to Redis channel: notifications:user:${userId}`);

// Log quando gateway riceve da Redis
logger.debug(`Gateway received from Redis for user ${userId}`);

// Log quando consegnata al socket
logger.debug(`Delivered to socket ${socketId} for user ${userId}`);
```

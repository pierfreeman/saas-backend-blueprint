/**
 * EXAMPLE FILE - NOT COMPILED
 * 
 * Angular Service example for integrating real-time notifications
 * with sports-intelligence-backend using socket.io-client.
 * 
 * Copy this file to your Angular frontend project:
 * src/app/services/notifications.service.ts
 * 
 * Install dependencies in your frontend:
 * npm install socket.io-client
 * npm install --save-dev @types/socket.io-client
 */

// Example Angular Service for Notifications WebSocket
// Place in: src/app/services/notifications.service.ts

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, any> | null;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationsService {
  private socket: Socket | null = null;
  private apiUrl = 'http://localhost:3000';

  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  private unreadCountSubject = new BehaviorSubject<number>(0);
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);

  public notifications$: Observable<Notification[]> = this.notificationsSubject.asObservable();
  public unreadCount$: Observable<number> = this.unreadCountSubject.asObservable();
  public isConnected$: Observable<boolean> = this.connectionStatusSubject.asObservable();

  constructor() {}

  connect(token: string): void {
    if (this.socket?.connected) {
      console.warn('Already connected to notifications');
      return;
    }

    this.socket = io(`${this.apiUrl}/notifications`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Connected to notifications');
      this.connectionStatusSubject.next(true);
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from notifications');
      this.connectionStatusSubject.next(false);
    });

    this.socket.on('notification:new', (notification: Notification) => {
      console.log('📩 New notification:', notification);
      const current = this.notificationsSubject.value;
      this.notificationsSubject.next([notification, ...current]);
      this.unreadCountSubject.next(this.unreadCountSubject.value + 1);
    });

    this.socket.on('notification:read', (notification: Notification) => {
      console.log('✅ Notification marked as read:', notification.id);
      const current = this.notificationsSubject.value;
      const updated = current.map((n) =>
        n.id === notification.id ? notification : n
      );
      this.notificationsSubject.next(updated);
      this.unreadCountSubject.next(Math.max(0, this.unreadCountSubject.value - 1));
    });

    this.socket.on('notification:bulk-read', (data: { count: number }) => {
      console.log(`✅ ${data.count} notifications marked as read`);
      const current = this.notificationsSubject.value;
      const updated = current.map((n) => ({
        ...n,
        readAt: n.readAt || new Date(),
      }));
      this.notificationsSubject.next(updated);
      this.unreadCountSubject.next(0);
    });

    this.socket.on('notification:unread-count', (data: { count: number }) => {
      console.log('🔢 Unread count updated:', data.count);
      this.unreadCountSubject.next(data.count);
    });

    this.socket.on('notification:list', (notifications: Notification[]) => {
      console.log('📋 Notifications list received:', notifications.length);
      this.notificationsSubject.next(notifications);
    });

    this.socket.on('notification:error', (error: { message: string }) => {
      console.error('❌ Notification error:', error.message);
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.connectionStatusSubject.next(false);
  }

  fetchNotifications(options?: {
    unreadOnly?: boolean;
    limit?: number;
    skip?: number;
  }): void {
    this.socket?.emit('notification:get-all', {
      unreadOnly: options?.unreadOnly || false,
      limit: options?.limit || 50,
      skip: options?.skip || 0,
    });
  }

  markAsRead(notificationId: string): void {
    this.socket?.emit('notification:mark-read', { notificationId });
  }

  markAllAsRead(): void {
    this.socket?.emit('notification:mark-all-read');
  }
}

// Example Usage in Component:
/*
import { Component, OnInit, OnDestroy } from '@angular/core';
import { NotificationsService, Notification } from './services/notifications.service';
import { AuthService } from './services/auth.service'; // Your auth service
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-notification-bell',
  template: `
    <div class="notification-bell">
      <button (click)="toggleDropdown()">
        🔔
        <span *ngIf="unreadCount > 0" class="badge">{{ unreadCount }}</span>
      </button>

      <div *ngIf="showDropdown" class="dropdown">
        <div class="header">
          <h3>Notifications</h3>
          <button (click)="markAllAsRead()">Mark all as read</button>
        </div>

        <div class="list">
          <div
            *ngFor="let notif of notifications"
            [class.unread]="!notif.readAt"
            (click)="markAsRead(notif.id)"
          >
            <h4>{{ notif.title }}</h4>
            <p>{{ notif.body }}</p>
            <small>{{ notif.createdAt | date: 'short' }}</small>
          </div>

          <p *ngIf="notifications.length === 0">No notifications</p>
        </div>
      </div>

      <div *ngIf="!isConnected" class="status">
        ⚠️ Disconnected
      </div>
    </div>
  `,
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  notifications: Notification[] = [];
  unreadCount = 0;
  isConnected = false;
  showDropdown = false;

  private destroy$ = new Subject<void>();

  constructor(
    private notificationsService: NotificationsService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Connect to notifications
    const token = this.authService.getToken();
    if (token) {
      this.notificationsService.connect(token);
    }

    // Subscribe to notifications
    this.notificationsService.notifications$
      .pipe(takeUntil(this.destroy$))
      .subscribe((notifications) => {
        this.notifications = notifications;
      });

    // Subscribe to unread count
    this.notificationsService.unreadCount$
      .pipe(takeUntil(this.destroy$))
      .subscribe((count) => {
        this.unreadCount = count;
      });

    // Subscribe to connection status
    this.notificationsService.isConnected$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.isConnected = status;
        if (status) {
          this.notificationsService.fetchNotifications({ unreadOnly: true });
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.notificationsService.disconnect();
  }

  toggleDropdown(): void {
    this.showDropdown = !this.showDropdown;
    if (this.showDropdown) {
      this.notificationsService.fetchNotifications();
    }
  }

  markAsRead(notificationId: string): void {
    this.notificationsService.markAsRead(notificationId);
  }

  markAllAsRead(): void {
    this.notificationsService.markAllAsRead();
  }
}
*/

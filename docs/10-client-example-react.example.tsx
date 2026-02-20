/**
 * EXAMPLE FILE - NOT COMPILED
 * 
 * React Hook example for integrating real-time notifications
 * with sports-intelligence-backend using socket.io-client.
 * 
 * Copy this file to your React/Next.js frontend project:
 * src/hooks/useNotifications.ts
 * 
 * Install dependencies in your frontend:
 * npm install socket.io-client
 */

// Example React Hook for Notifications WebSocket
// Place in: src/hooks/useNotifications.ts

import { useEffect, useState, useCallback, useRef } from 'react';
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

interface UseNotificationsOptions {
  token: string;
  apiUrl?: string;
  autoConnect?: boolean;
  onNotification?: (notification: Notification) => void;
}

export const useNotifications = ({
  token,
  apiUrl = 'http://localhost:3000',
  autoConnect = true,
  onNotification,
}: UseNotificationsOptions) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io(`${apiUrl}/notifications`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('✅ Connected to notifications');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from notifications');
      setIsConnected(false);
    });

    socket.on('notification:new', (notification: Notification) => {
      console.log('📩 New notification:', notification);
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);
      onNotification?.(notification);
    });

    socket.on('notification:read', (notification: Notification) => {
      console.log('✅ Notification marked as read:', notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? notification : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    });

    socket.on('notification:bulk-read', (data: { count: number }) => {
      console.log(`✅ ${data.count} notifications marked as read`);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date() }))
      );
      setUnreadCount(0);
    });

    socket.on('notification:unread-count', (data: { count: number }) => {
      console.log('🔢 Unread count updated:', data.count);
      setUnreadCount(data.count);
    });

    socket.on('notification:list', (notificationList: Notification[]) => {
      console.log('📋 Notifications list received:', notificationList.length);
      setNotifications(notificationList);
    });

    socket.on('notification:error', (error: { message: string }) => {
      console.error('❌ Notification error:', error.message);
    });

    socketRef.current = socket;
  }, [token, apiUrl, onNotification]);

  // Disconnect
  const disconnect = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setIsConnected(false);
  }, []);

  // Fetch all notifications
  const fetchNotifications = useCallback(
    (options?: { unreadOnly?: boolean; limit?: number; skip?: number }) => {
      socketRef.current?.emit('notification:get-all', {
        unreadOnly: options?.unreadOnly || false,
        limit: options?.limit || 50,
        skip: options?.skip || 0,
      });
    },
    []
  );

  // Mark single notification as read
  const markAsRead = useCallback((notificationId: string) => {
    socketRef.current?.emit('notification:mark-read', { notificationId });
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    socketRef.current?.emit('notification:mark-all-read');
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && token) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, token, connect, disconnect]);

  return {
    notifications,
    unreadCount,
    isConnected,
    connect,
    disconnect,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  };
};

// Example Usage in Component:
/*
import { useNotifications } from './hooks/useNotifications';
import { useAuth } from './hooks/useAuth'; // Your auth hook

function NotificationBell() {
  const { token } = useAuth();
  
  const {
    notifications,
    unreadCount,
    isConnected,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications({
    token,
    onNotification: (notification) => {
      // Show toast/popup
      toast.info(notification.title);
    },
  });

  useEffect(() => {
    if (isConnected) {
      fetchNotifications({ unreadOnly: true });
    }
  }, [isConnected]);

  return (
    <div>
      <button onClick={() => setShowDropdown(!showDropdown)}>
        🔔 {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
      </button>

      {showDropdown && (
        <div className="dropdown">
          <button onClick={markAllAsRead}>Mark all as read</button>
          
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={notif.readAt ? 'read' : 'unread'}
              onClick={() => markAsRead(notif.id)}
            >
              <h4>{notif.title}</h4>
              <p>{notif.body}</p>
              <small>{new Date(notif.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
*/

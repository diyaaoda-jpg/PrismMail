import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

interface WebSocketMessage {
  type: 'connected' | 'emailReceived' | 'emailSynced' | 'error' | 'pong';
  data?: any;
  message?: string;
  userId?: string;
  accountCount?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  error: string | null;
  sendMessage: (message: any) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reconnectAttempts = useRef<number>(0);
  const maxReconnectAttempts = 5;
  const pingInterval = useRef<NodeJS.Timeout | null>(null);

  // Get current user for authentication
  const { data: user } = useQuery<{data: {id: string; email: string}}>({
    queryKey: ['/api/auth/user']
  });

  // Send message to WebSocket server
  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  }, []);

  // Debounced reconnection logic
  const scheduleReconnect = useCallback(() => {
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      console.log('Max WebSocket reconnection attempts reached');
      setError('Unable to maintain WebSocket connection. Please refresh the page.');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000); // Max 10 seconds
    reconnectAttempts.current++;
    
    console.log(`Scheduling WebSocket reconnect attempt ${reconnectAttempts.current}/${maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      connect();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!user?.data?.id) {
      console.log('WebSocket connection skipped: User not authenticated');
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // SECURITY FIX: Remove spoofable userId parameter - use session cookies instead
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('Connecting to WebSocket with session authentication...');
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('WebSocket connected for real-time email updates');
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0; // Reset reconnection attempts on successful connection

        // Send a heartbeat ping every 30 seconds to keep connection alive
        pingInterval.current = setInterval(() => {
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            sendMessage({ type: 'ping', timestamp: Date.now() });
          } else {
            if (pingInterval.current) {
              clearInterval(pingInterval.current);
            }
          }
        }, 30000);
      };

      ws.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('WebSocket message received:', message);
          
          // Handle different message types
          if (message.type === 'error') {
            setError(message.message || 'WebSocket error');
            return;
          }
          
          if (message.type === 'connected') {
            console.log(`WebSocket authenticated: ${message.userId} with ${message.accountCount} accounts`);
          }
          
          setLastMessage(message);
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.current.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        
        // Clear ping interval
        if (pingInterval.current) {
          clearInterval(pingInterval.current);
          pingInterval.current = null;
        }
        
        // Only attempt to reconnect if not a normal closure or authentication failure
        if (event.code !== 1000 && event.code !== 1008) {
          scheduleReconnect();
        } else if (event.code === 1008) {
          setError('WebSocket authentication failed. Please log in again.');
        }
      };

      ws.current.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('WebSocket connection error');
        setIsConnected(false);
      };

    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setError('Failed to create WebSocket connection');
      scheduleReconnect();
    }
  }, [user?.data?.id, sendMessage, scheduleReconnect]);

  useEffect(() => {
    if (user?.data?.id) {
      connect();
    }

    // Cleanup on unmount or user change
    return () => {
      if (ws.current) {
        ws.current.close(1000, 'Component unmounting');
      }
      if (pingInterval.current) {
        clearInterval(pingInterval.current);
      }
    };
  }, [connect]);

  return {
    isConnected,
    lastMessage,
    error,
    sendMessage
  };
}
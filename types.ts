export interface TranscriptionSegment {
  id: string;
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

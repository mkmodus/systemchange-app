
export interface TextBlock {
  id: string;
  original: string;
  refined: string;
  timestamp: number;
}

export enum StorageKeys {
  BLOCKS = 'interpretation_blocks',
  IS_RECORDING = 'is_recording_active'
}

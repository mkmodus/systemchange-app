
import React, { useState, useEffect, useRef } from 'react';
import { StorageKeys, TextBlock } from '../types';

const PresentationPage: React.FC = () => {
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateBlocks = () => {
      const saved = localStorage.getItem(StorageKeys.BLOCKS);
      if (saved) {
        setBlocks(JSON.parse(saved));
      }
    };

    // Initial load
    updateBlocks();

    // Listen for storage events (updates from admin tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === StorageKeys.BLOCKS) {
        updateBlocks();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Poll as fallback for some environments
    const interval = setInterval(updateBlocks, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    // Keep latest content visible at top, but usually users want to see the sequence.
    // Given blocks are [newest, ..., oldest], they will appear at the top.
  }, [blocks]);

  return (
    <div className="min-h-screen pt-12 max-w-5xl mx-auto">
      <div className="flex flex-col space-y-12 pb-32">
        {blocks.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center space-y-4 opacity-50">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-2xl font-light">통역이 시작되기를 기다리고 있습니다...</p>
          </div>
        ) : (
          blocks.map((block, index) => (
            <div 
              key={block.id} 
              className={`transition-all duration-700 ${index === 0 ? 'opacity-100 scale-100' : 'opacity-40 scale-95'}`}
            >
              <div className="relative">
                {index === 0 && (
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-2 h-12 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
                )}
                <p className={`text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.3] md:leading-[1.4] tracking-tight`}>
                  {block.refined}
                </p>
                <div className="mt-4 flex items-center gap-4 text-zinc-500">
                   <div className="h-px flex-grow bg-zinc-800" />
                   <span className="text-sm font-mono">{new Date(block.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* Sticky Bottom Indicator */}
      <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black via-black/90 to-transparent">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-zinc-500 text-xs uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${blocks.length > 0 ? 'bg-green-500' : 'bg-zinc-700 animate-pulse'}`} />
            실시간 문자 통역 서비스 연결됨
          </div>
          <div>BLOCK-BASED CONTEXTUAL INTERPRETATION</div>
        </div>
      </div>
    </div>
  );
};

export default PresentationPage;

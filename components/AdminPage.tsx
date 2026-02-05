import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [displayInterim, setDisplayInterim] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const timerRef = useRef<any>(null);
  const fullContentRef = useRef(''); 
  const offsetRef = useRef(0); 

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = useCallback((updatedBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), updatedBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(updatedBlocks));
  }, []);

  const handleEditBlock = (id: string, newRefined: string) => {
    setBlocks(prev => {
      const updated = prev.map(block => block.id === id ? { ...block, refined: newRefined } : block);
      syncData(updated);
      return updated;
    });
  };

  const processBuffer = useCallback(async (manualText?: string) => {
    const textToSend = (manualText || fullContentRef.current.substring(offsetRef.current)).trim();
    if (isProcessingRef.current || textToSend.length < 1) return;

    isProcessingRef.current = true;
    offsetRef.current = fullContentRef.current.length;
    setDisplayInterim(''); 
    setStatusMessage('⚡ AI SYNC');

    try {
      const refined = await refineTranscription(textToSend);
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: textToSend,
        refined: refined,
        timestamp: Date.now(),
      };

      setBlocks(prev => {
        const updated = [newBlock, ...prev].slice(0, 500);
        syncData(updated);
        return updated;
      });
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
    }
  }, [syncData]);

  useEffect(() => {
    const unsent = fullContentRef.current.substring(offsetRef.current).trim();
    if (unsent && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => processBuffer(), 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const handleManualSend = () => {
    if (displayInterim.trim()) {
      const textToForce = displayInterim.trim();
      fullContentRef.current = fullContentRef.current.substring(0, offsetRef.current) + textToForce;
      processBuffer(textToForce);
      setDisplayInterim('');
      offsetRef.current = fullContentRef.current.length;
    }
  };

  const startRecording = async () => {
    try {
      setStatusMessage('MIC...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());

      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechRecognition) return;

      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch(e) {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('LIVE');
        fullContentRef.current = '';
        offsetRef.current = 0;
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalized = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalized += event.results[i][0].transcript;
          else if (i >= event.resultIndex) interim += event.results[i][0].transcript;
        }
        fullContentRef.current = finalized;
        setDisplayInterim(finalized.substring(offsetRef.current) + interim);
        if (finalized.substring(offsetRef.current).length > 40) processBuffer();
      };

      recognition.onend = () => { if (isRecording) recognition.start(); };
      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      setStatusMessage('MIC BLOCKED');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setStatusMessage('READY');
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
  };

  return (
    <div className="p-3 bg-zinc-950 min-h-screen text-zinc-100 font-sans flex flex-col antialiased">
      {/* 🛠️ Compact Header */}
      <header className="max-w-full mx-auto w-full flex justify-between items-center mb-4 py-2 px-4 border-b border-white/5 sticky top-0 bg-zinc-950/80 backdrop-blur-sm z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-zinc-800'}`} />
            <span className="text-[10px] font-bold tracking-widest uppercase">{statusMessage}</span>
          </div>
          <div className="h-3 w-[1px] bg-white/10" />
          <span className="text-[9px] font-bold text-zinc-600 tracking-tighter uppercase">STATION v2.0 • COMPACT MODE</span>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={isRecording ? stopRecording : startRecording} 
            className={`text-[10px] font-black px-4 py-1.5 rounded transition-all ${isRecording ? 'bg-red-600/20 text-red-500 border border-red-500/30' : 'bg-blue-600 text-white'}`}
          >
            {isRecording ? 'STOP SESSION' : 'START SESSION'}
          </button>
          <button onClick={() => confirm("Reset?") && syncData([])} className="text-[9px] font-bold text-zinc-600 hover:text-white transition-colors">RESET</button>
        </div>
      </header>

      {/* 🚀 Wide Workspace */}
      <main className="max-w-full w-full grid grid-cols-12 gap-6 flex-grow overflow-hidden px-4">
        
        {/* Left: Monitoring Stream (Reduced Size) */}
        <section className="col-span-12 lg:col-span-4 flex flex-col h-[calc(100vh-80px)]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[9px] text-zinc-500 font-bold tracking-widest uppercase">01. Raw Input</span>
            {displayInterim.trim() && (
              <button onClick={handleManualSend} className="text-[8px] font-black text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded hover:bg-blue-400 hover:text-white transition-all">FLUSH</button>
            )}
          </div>
          <div className="flex-grow bg-zinc-900/40 rounded-xl p-4 border border-white/5 overflow-y-auto">
            <div className="text-lg md:text-xl font-medium leading-relaxed text-white/20 break-keep">
              {displayInterim || <span className="text-zinc-900 italic text-sm">Waiting for signal...</span>}
            </div>
          </div>
        </section>

        {/* Right: Editable Presentation (Reduced Size & High Density) */}
        <section className="col-span-12 lg:col-span-8 flex flex-col h-[calc(100vh-80px)] border-l border-white/5 pl-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[9px] text-blue-500 font-bold tracking-widest uppercase">02. Refined Stream (Editable List)</span>
            <span className="text-[8px] text-zinc-600 font-medium italic uppercase">Real-time sync to all participants</span>
          </div>
          
          <div className="flex-grow overflow-y-auto space-y-1 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`group flex gap-3 p-1 rounded-md transition-all ${i === 0 ? 'bg-white/5' : 'opacity-60 hover:opacity-100 hover:bg-white/[0.02]'}`}>
                <div className="flex flex-col items-center pt-2">
                  <div className={`w-1 h-1 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-zinc-800 group-hover:bg-zinc-600'}`} />
                </div>
                <textarea
                  value={block.refined}
                  onChange={(e) => handleEditBlock(block.id, e.target.value)}
                  className="flex-grow bg-transparent text-sm md:text-base font-medium leading-snug text-white/90 border-none outline-none focus:text-blue-400 py-1 transition-all resize-none overflow-hidden"
                  rows={Math.max(1, Math.ceil(block.refined.length / 50))}
                  spellCheck={false}
                />
                <button 
                  onClick={() => handleEditBlock(block.id, block.original)} 
                  className="opacity-0 group-hover:opacity-100 text-[8px] text-zinc-700 hover:text-zinc-400 px-2 transition-all uppercase font-bold"
                  title="Undo to Original"
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* 🔘 Compact Footer */}
      <footer className="w-full py-1 px-4 flex justify-between border-t border-white/5 mt-2">
        <div className="flex gap-4 text-[8px] font-mono text-zinc-700 uppercase tracking-[0.2em]">
          <span>Sync: Firebase Cloud</span>
          <span>Buffer: {blocks.length}</span>
        </div>
        <div className="text-[8px] font-mono text-zinc-700 italic">
          Press 'Enter' on focused block is not mapped yet (Use mouse).
        </div>
      </footer>
    </div>
  );
};

export default AdminPage;

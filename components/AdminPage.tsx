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
    setStatusMessage('⚡ AI SYNCING');

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
      setStatusMessage('MIC ACCESS...');
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
        const currentUnsent = finalized.substring(offsetRef.current) + interim;
        setDisplayInterim(currentUnsent);
        if (finalized.substring(offsetRef.current).length > 35) processBuffer();
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
    <div className="p-6 bg-zinc-950 min-h-screen text-zinc-100 font-sans overflow-hidden flex flex-col">
      {/* 🖥️ Wide Desktop Header */}
      <header className="max-w-[98%] mx-auto w-full flex justify-between items-center mb-8 py-4 border-b border-white/5 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.7)]' : 'bg-zinc-800'}`} />
            <span className="text-xs font-black tracking-[0.3em] uppercase">{statusMessage}</span>
          </div>
          <div className="h-4 w-[1px] bg-white/10" />
          <span className="text-[10px] font-bold text-zinc-500 tracking-tighter uppercase">2026 System Change Forum • Admin Workstation</span>
        </div>
        
        <div className="flex items-center gap-8">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black px-8 py-2.5 rounded-md transition-all active:scale-95 shadow-lg shadow-blue-900/20">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 hover:bg-red-500 text-white text-[11px] font-black px-8 py-2.5 rounded-md transition-all active:scale-95 shadow-lg shadow-red-900/20">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("초기화하시겠습니까?")) { syncData([]); setBlocks([]); } }} className="text-[11px] font-black opacity-30 hover:opacity-100 text-zinc-400 hover:text-white transition-all">CLEAR ALL</button>
        </div>
      </header>

      {/* 🚀 Main Workspace Layout */}
      <main className="max-w-[98%] mx-auto w-full grid grid-cols-12 gap-12 flex-grow overflow-hidden">
        
        {/* Left Section (4 columns): Live Monitoring */}
        <section className="col-span-12 lg:col-span-5 flex flex-col h-[calc(100vh-140px)] relative">
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-2">
               <span className="text-[10px] text-zinc-500 font-black tracking-widest uppercase italic">01. Live Input Stream</span>
               {isProcessingRef.current && <span className="text-[10px] text-blue-500 animate-pulse font-bold tracking-widest uppercase px-2 py-0.5 bg-blue-500/10 rounded">AI Processing</span>}
             </div>
             {displayInterim.trim() && (
               <button onClick={handleManualSend} className="bg-blue-600/10 border border-blue-500/20 text-blue-400 text-[10px] font-black px-4 py-1.5 rounded-full hover:bg-blue-600 hover:text-white transition-all">
                 FLUSH STREAM (즉시 전송)
               </button>
             )}
          </div>
          <div className="flex-grow bg-zinc-900/20 rounded-3xl p-8 border border-white/5 overflow-y-auto scrollbar-hide">
            <div className="text-4xl md:text-5xl font-black leading-[1.15] text-white/20 break-keep select-none">
              {displayInterim || <span className="text-zinc-900">Listening for audio signals...</span>}
            </div>
          </div>
        </section>

        {/* Right Section (7 columns): Refined & Editable Presentation */}
        <section className="col-span-12 lg:col-span-7 flex flex-col h-[calc(100vh-140px)] border-l border-white/5 pl-12">
          <div className="flex justify-between items-center mb-6">
            <span className="text-[10px] text-blue-500 font-black tracking-widest uppercase italic">02. Refined Presentation (Editable)</span>
            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-tighter">Click text to manual edit • Auto-sync to Audience</span>
          </div>
          
          <div className="flex-grow overflow-y-auto space-y-10 scrollbar-hide pb-32">
            {blocks.length === 0 ? (
              <div className="h-full flex items-center justify-center border-2 border-dashed border-white/5 rounded-3xl">
                <span className="text-zinc-800 text-4xl font-black uppercase tracking-tighter">Empty Feed</span>
              </div>
            ) : (
              blocks.map((block, i) => (
                <div key={block.id} className={`group relative transition-all duration-700 ${i === 0 ? 'opacity-100 scale-100' : 'opacity-40 hover:opacity-100 scale-[0.98]'}`}>
                  <textarea
                    value={block.refined}
                    onChange={(e) => handleEditBlock(block.id, e.target.value)}
                    className="w-full bg-transparent text-3xl md:text-4xl font-bold leading-snug tracking-tighter text-white border-none outline-none focus:text-blue-400 focus:bg-white/[0.02] rounded-2xl p-4 transition-all resize-none overflow-hidden"
                    rows={Math.max(1, Math.ceil(block.refined.length / 30))}
                    spellCheck={false}
                  />
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span className="text-[8px] font-black text-zinc-600 rotate-90">LIVE</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      
      {/* 🔘 Footer Stats */}
      <footer className="max-w-[98%] mx-auto w-full py-3 flex justify-end">
        <div className="flex gap-6 text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
          <span>Latency: ~1.2s</span>
          <span>Engine: Gemini 1.5 Flash</span>
          <span>Buffer: {blocks.length} blocks</span>
        </div>
      </footer>
    </div>
  );
};

export default AdminPage;

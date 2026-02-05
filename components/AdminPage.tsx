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

  // 📝 송출된 블록 실시간 수정 함수
  const handleEditBlock = (id: string, newRefined: string) => {
    setBlocks(prev => {
      const updated = prev.map(block => 
        block.id === id ? { ...block, refined: newRefined } : block
      );
      syncData(updated);
      return updated;
    });
  };

  const processBuffer = useCallback(async () => {
    const textToSend = fullContentRef.current.substring(offsetRef.current).trim();
    if (isProcessingRef.current || textToSend.length < 2) return;

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
    const currentUnsent = fullContentRef.current.substring(offsetRef.current).trim();
    if (currentUnsent && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const startRecording = async () => {
    try {
      setStatusMessage('MIC REQUESTING...');
      // 권한 강제 팝업 트리거
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

      recognition.onerror = (e: any) => {
        if (e.error === 'not-allowed') setStatusMessage('MIC BLOCKED');
        setIsRecording(false);
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

  const handleManualSend = () => {
    if (displayInterim.trim()) {
      fullContentRef.current += (fullContentRef.current ? ' ' : '') + displayInterim.trim();
      processBuffer();
    }
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) { syncData([]); setBlocks([]); } }} className="text-[10px] font-black opacity-20 hover:opacity-100">RESET</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-140px)]">
        {/* 왼쪽: 모니터링 (연사가 99나 구구라고 말하는 것을 볼 수 있음) */}
        <div className="flex flex-col relative overflow-hidden">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase italic">Monitoring Stream</span>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/20 break-keep">
            {displayInterim || <span>...</span>}
          </div>
          {displayInterim.trim() && (
            <button onClick={handleManualSend} className="mt-4 w-fit bg-zinc-800 text-[9px] font-black px-4 py-2 rounded-full border border-white/10 hover:bg-zinc-700">즉시 전송</button>
          )}
        </div>

        {/* 오른쪽: 결과 및 수동 편집 (AI가 '99'를 '극우'로 바꾼 결과가 나타남) */}
        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-blue-500 font-bold mb-4 tracking-widest uppercase">Refined (Click to Edit)</span>
          <div className="flex-grow overflow-y-auto space-y-8 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`group relative transition-all duration-500 ${i === 0 ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
                <textarea
                  value={block.refined}
                  onChange={(e) => handleEditBlock(block.id, e.target.value)}
                  className="w-full bg-transparent text-2xl md:text-3xl font-bold leading-tight tracking-tighter text-white border-none outline-none focus:text-blue-400 focus:bg-white/5 rounded-lg p-2 transition-all resize-none"
                  rows={2}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

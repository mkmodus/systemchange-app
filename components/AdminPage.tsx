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
  
  // 🛡️ 누락 방지 핵심 Refs
  const accumulatedFinalRef = useRef(''); // 이번 세션 전체 확정 텍스트
  const lastSentLengthRef = useRef(0); // AI에게 전송 완료된 텍스트의 누적 길이

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

  // ⚡ [누락 방지] 보정 및 전송 함수
  const processBuffer = useCallback(async (forcedText?: string) => {
    // 1. 전송할 텍스트 추출 (누락을 막기 위해 현재까지의 전체에서 이미 보낸 길이를 뺀 나머지를 정확히 계산)
    const currentFull = accumulatedFinalRef.current;
    const textToSend = (forcedText || currentFull.substring(lastSentLengthRef.current)).trim();
    
    if (isProcessingRef.current || textToSend.length < 1) return;

    isProcessingRef.current = true;
    
    // 2. 전송 지점 즉시 갱신 (중복 전송 방지)
    const newSentLength = forcedText ? currentFull.length + manualExtraRef.current : currentFull.length;
    lastSentLengthRef.current = newSentLength;
    
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

  const manualExtraRef = useRef(0);

  // 🕒 자동 전송 (0.8초 침묵 시)
  useEffect(() => {
    const unsent = accumulatedFinalRef.current.substring(lastSentLengthRef.current).trim();
    if (unsent && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => processBuffer(), 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());

      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechRecognition) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('LIVE');
        accumulatedFinalRef.current = '';
        lastSentLengthRef.current = 0;
      };

      recognition.onresult = (event: any) => {
        let allFinalized = '';
        let interim = '';

        // [핵심] 0번 인덱스부터 현재까지 모든 결과를 다시 합산하여 정합성 유지
        for (let i = 0; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            allFinalized += (allFinalized ? ' ' : '') + transcript;
          } else {
            interim += transcript;
          }
        }

        accumulatedFinalRef.current = allFinalized;
        
        // 화면 표시: 이미 보낸 길이를 정확히 제외하고 출력
        const currentUnsent = allFinalized.substring(lastSentLengthRef.current) + interim;
        setDisplayInterim(currentUnsent.trim());

        // 40자 도달 시 자동 전송
        if (allFinalized.substring(lastSentLengthRef.current).length > 40) {
          processBuffer();
        }
      };

      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => { if (isRecording) try { recognition.start(); } catch(e) {} };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      setStatusMessage('MIC ERROR');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
  };

  const handleManualSend = () => {
    if (displayInterim.trim()) {
      processBuffer(displayInterim.trim());
    }
  };

  return (
    <div className="p-3 bg-zinc-950 min-h-screen text-zinc-100 font-sans flex flex-col antialiased">
      <header className="max-w-full w-full flex justify-between items-center mb-4 py-2 px-4 border-b border-white/5 sticky top-0 bg-zinc-950 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-zinc-800'}`} />
            <span className="text-[10px] font-bold tracking-widest uppercase">{statusMessage}</span>
          </div>
          <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">COMPACT WORKSTATION</span>
        </div>
        <div className="flex gap-4">
          <button onClick={isRecording ? stopRecording : startRecording} className={`text-[10px] font-black px-4 py-1.5 rounded transition-all ${isRecording ? 'bg-red-600/20 text-red-500 border border-red-500/30' : 'bg-blue-600 text-white'}`}>{isRecording ? 'STOP' : 'START'}</button>
          <button onClick={() => confirm("Reset?") && syncData([])} className="text-[9px] font-bold text-zinc-600">RESET</button>
        </div>
      </header>

      <main className="max-w-full w-full grid grid-cols-12 gap-6 px-4">
        <section className="col-span-4 flex flex-col h-[calc(100vh-100px)]">
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest italic">Live Feed</span>
            {displayInterim.trim() && (
              <button onClick={handleManualSend} className="text-[8px] font-black text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded hover:bg-blue-400 hover:text-white">FLUSH</button>
            )}
          </div>
          <div className="flex-grow bg-zinc-900/30 rounded-xl p-4 border border-white/5 overflow-y-auto">
            <div className="text-lg font-medium leading-relaxed text-white/20 break-keep">
              {displayInterim || <span className="text-zinc-900">...</span>}
            </div>
          </div>
        </section>

        <section className="col-span-8 flex flex-col h-[calc(100vh-100px)] border-l border-white/5 pl-6">
          <span className="text-[9px] text-blue-500 font-bold mb-2 px-1 uppercase tracking-widest italic">Refined Presentation (Click to edit)</span>
          <div className="flex-grow overflow-y-auto space-y-1 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`group flex gap-3 p-1 rounded transition-all ${i === 0 ? 'bg-white/5' : 'opacity-50 hover:opacity-100'}`}>
                <div className="pt-2"><div className={`w-1 h-1 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-zinc-800'}`} /></div>
                <textarea
                  value={block.refined}
                  onChange={(e) => handleEditBlock(block.id, e.target.value)}
                  className="flex-grow bg-transparent text-sm md:text-base font-medium leading-snug text-white/90 outline-none focus:text-blue-400 py-1 transition-all resize-none overflow-hidden"
                  rows={Math.max(1, Math.ceil(block.refined.length / 60))}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default AdminPage;

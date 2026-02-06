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

  // 🛡️ [절대 유실 방지] 브라우저 엔진과 독립적으로 텍스트를 저장하는 금고
  const finalHistoryRef = useRef(''); // 이번 전송 턴에서 확정된 모든 텍스트
  const lastProcessedResultIndexRef = useRef(0); // 브라우저 엔진의 결과 인덱스 추적

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

  // ⚡ 보정 및 전송 (전송 후 금고를 비우고 다음 턴 준비)
  const processBuffer = useCallback(async (manualText?: string) => {
    const textToSend = (manualText || finalHistoryRef.current).trim();
    
    if (isProcessingRef.current || textToSend.length < 1) return;

    isProcessingRef.current = true;
    
    // [보존 핵심] AI 전송 직후에만 비움. 엔진 오류 시에는 비우지 않음.
    finalHistoryRef.current = ''; 
    lastProcessedResultIndexRef.current = 0; // 인덱스 초기화
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

  // 자동 전송 타이머 (0.8초 침묵 시)
  useEffect(() => {
    if (finalHistoryRef.current.trim() && !isProcessingRef.current) {
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
        // 엔진 재시작 시에도 finalHistoryRef는 초기화하지 않음 (이어가기 핵심)
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        
        // 브라우저가 준 새로운 결과들을 안전 금고(finalHistoryRef)에 옮겨 담기
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            // 엔진이 확정 지은 단어만 금고에 영구 보관
            finalHistoryRef.current += (finalHistoryRef.current ? ' ' : '') + transcript;
          } else {
            interim = transcript;
          }
        }

        // 화면에는 [금고에 든 확정 텍스트] + [지금 들리는 임시 텍스트]를 합쳐서 표시
        setDisplayInterim(finalHistoryRef.current + (interim ? ` ${interim}` : ''));

        if (finalHistoryRef.current.length > 40) {
          processBuffer();
        }
      };

      recognition.onerror = (e: any) => {
        console.error("STT Error:", e.error);
        if (e.error === 'network') setStatusMessage('NETWORK ERROR');
      };

      recognition.onend = () => {
        // 엔진이 멎더라도 finalHistoryRef는 살아있음. 
        // 다시 시작하면 그 뒤에 글자가 붙음.
        if (isRecording) {
          try { recognition.start(); } catch(err) {}
        }
      };

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
          <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-tighter tracking-[0.2em]">Live Monitoring Station</span>
        </div>
        <div className="flex gap-4">
          <button onClick={isRecording ? stopRecording : startRecording} className={`text-[10px] font-black px-4 py-1.5 rounded transition-all ${isRecording ? 'bg-red-600/20 text-red-500 border border-red-500/30' : 'bg-blue-600 text-white'}`}>
            {isRecording ? 'STOP SESSION' : 'START SESSION'}
          </button>
          <button onClick={() => confirm("Reset?") && syncData([])} className="text-[9px] font-bold text-zinc-600">RESET</button>
        </div>
      </header>

      <main className="max-w-full w-full grid grid-cols-12 gap-6 px-4">
        {/* 좌측: 실시간 음성 스트림 (유실 방지 로직 적용됨) */}
        <section className="col-span-12 lg:col-span-4 flex flex-col h-[calc(100vh-100px)]">
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest italic">01. Live Input (Safe Buffer)</span>
            {displayInterim.trim() && (
              <button onClick={handleManualSend} className="text-[8px] font-black text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded hover:bg-blue-400 hover:text-white transition-all">FLUSH NOW</button>
            )}
          </div>
          <div className="flex-grow bg-zinc-900/30 rounded-xl p-6 border border-white/5 overflow-y-auto">
            <div className="text-lg md:text-xl font-medium leading-relaxed text-white/20 break-keep selection:bg-blue-500/30">
              {displayInterim || <span className="text-zinc-900 italic">Waiting for audio signal...</span>}
            </div>
          </div>
        </section>

        {/* 우측: 송출 결과 (편집 가능) */}
        <section className="col-span-12 lg:col-span-8 flex flex-col h-[calc(100vh-100px)] border-l border-white/5 pl-6">
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-[9px] text-blue-500 font-bold uppercase tracking-widest italic">02. Refined Presentation (Click to edit)</span>
            <span className="text-[8px] text-zinc-600 font-medium italic">Auto-syncs with participant screens</span>
          </div>
          <div className="flex-grow overflow-y-auto space-y-1 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`group flex gap-3 p-1 rounded transition-all ${i === 0 ? 'bg-white/5' : 'opacity-40 hover:opacity-100 hover:bg-white/[0.02]'}`}>
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

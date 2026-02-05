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
  
  // 🛡️ 잔상 방지 및 데이터 관리를 위한 핵심 Ref
  const lastProcessedIndexRef = useRef(0); // 이미 전송 완료된 결과의 인덱스
  const currentFinalizedTextRef = useRef(''); // 현재 세션에서 아직 안 보낸 확정 텍스트

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // ⚡ 보정 및 전송 함수 (엔진을 끄지 않고 인덱스만 갱신)
  const processBuffer = useCallback(async (text: string, nextIndex: number) => {
    if (isProcessingRef.current || text.trim().length < 2) return;

    isProcessingRef.current = true;
    
    // [중요] 즉시 화면 비우기: 다음 결과는 nextIndex 이후부터만 읽음
    lastProcessedIndexRef.current = nextIndex;
    currentFinalizedTextRef.current = '';
    setDisplayInterim('');
    setStatusMessage('⚡ AI');

    try {
      const refined = await refineTranscription(text);
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: text,
        refined: refined,
        timestamp: Date.now(),
      };

      setBlocks(prev => {
        const updated = [newBlock, ...prev].slice(0, 500);
        syncData(updated);
        return updated;
      });
    } catch (e) {
      const fallback = { id: `err-${Date.now()}`, original: text, refined: text, timestamp: Date.now() };
      setBlocks(prev => { const up = [fallback, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
    }
  }, []);

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onstart = () => {
      setIsRecording(true);
      setStatusMessage('LIVE');
      lastProcessedIndexRef.current = 0;
    };

    recognition.onresult = (event: any) => {
      let interimContent = '';
      let finalizedSinceLast = '';
      const totalResults = event.results.length;

      // [핵심] 이미 처리한 인덱스(lastProcessedIndexRef) 이후의 결과만 처리
      for (let i = lastProcessedIndexRef.current; i < totalResults; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalizedSinceLast += transcript;
        } else {
          interimContent += transcript;
        }
      }

      currentFinalizedTextRef.current = finalizedSinceLast;
      setDisplayInterim(finalizedSinceLast + interimContent);

      // 정확도와 속도의 균형: 25자 도달 시 혹은 0.5초 침묵 시 전송
      if (finalizedSinceLast.length > 25) {
        processBuffer(finalizedSinceLast, totalResults);
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      if (finalizedSinceLast.trim()) {
        timerRef.current = setTimeout(() => {
          processBuffer(finalizedSinceLast, totalResults);
        }, 500);
      }
    };

    // 엔진 끊김 방지 (자동 재시작)
    recognition.onend = () => {
      if (isRecording) {
        lastProcessedIndexRef.current = 0; // 세션 재시작 시 인덱스 초기화
        try { recognition.start(); } catch(e) {}
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
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
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500">START</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("Clear?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black tracking-widest opacity-20">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-120px)]">
        <div className="flex flex-col relative group">
          <div className="flex justify-between items-center mb-4">
             <span className="text-[9px] text-zinc-600 font-bold tracking-widest uppercase">Live Input</span>
             {displayInterim.trim() && (
               <button 
                onClick={() => processBuffer(displayInterim, recognitionRef.current ? recognitionRef.current.historyLength || 0 : 0)} 
                className="bg-blue-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full"
               >
                 즉시 전송
               </button>
             )}
          </div>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/90 break-keep">
            {displayInterim || <span className="text-zinc-900">...</span>}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Refined Stream</span>
          <div className="flex-grow overflow-y-auto space-y-12 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-700 ${i === 0 ? 'opacity-100' : 'opacity-10 blur-[1px]'}`}>
                <p className="text-2xl md:text-4xl font-bold leading-tight tracking-tighter">{block.refined}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

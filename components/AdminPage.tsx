import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [displayInterim, setDisplayInterim] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  
  const finalizedBufferRef = useRef(''); 
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const timerRef = useRef<any>(null);
  
  // 🚨 좀비 감시용 Refs
  const lastResultTimeRef = useRef(Date.now());
  const watchdogIntervalRef = useRef<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // ⚡ [핵심] 보정 및 전송 함수 (수동/자동 공용)
  const processBuffer = useCallback(async () => {
    const textToSend = finalizedBufferRef.current.trim();
    
    // 이미 처리 중이거나 내용이 없으면 중단
    if (isProcessingRef.current || textToSend.length < 1) return;

    isProcessingRef.current = true;
    finalizedBufferRef.current = ''; 
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
    } catch (e) {
      const fallback = { id: `err-${Date.now()}`, original: textToSend, refined: textToSend, timestamp: Date.now() };
      setBlocks(prev => { const up = [fallback, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
      lastResultTimeRef.current = Date.now(); // 전송 후 시간 리셋
    }
  }, []);

  // 🕒 0.3초 침묵 시 자동 전송 타이머
  useEffect(() => {
    const currentText = finalizedBufferRef.current.trim();
    if (currentText && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 300);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [displayInterim, processBuffer]);

  // 🚨 [좀비 방지] 3초 워치독 로직
  useEffect(() => {
    if (isRecording) {
      watchdogIntervalRef.current = setInterval(() => {
        const silentTime = Date.now() - lastResultTimeRef.current;
        if (silentTime > 3000 && isRecording && !isProcessingRef.current) {
          console.warn("좀비 상태 감지: 엔진 재시작");
          setStatusMessage('🔄 RESTARTING');
          restartRecognition();
        }
      }, 1000);
    } else {
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
    }
    return () => { if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current); };
  }, [isRecording]);

  const restartRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    setTimeout(startRecording, 100);
  };

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
      lastResultTimeRef.current = Date.now();
    };

    recognition.onresult = (event: any) => {
      lastResultTimeRef.current = Date.now(); // 신호 들어올 때마다 시간 갱신
      let interimContent = '';
      
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalizedBufferRef.current += (finalizedBufferRef.current ? ' ' : '') + transcript;
        } else {
          interimContent += transcript;
        }
      }
      setDisplayInterim(finalizedBufferRef.current + interimContent);
    };

    recognition.onend = () => {
      if (isRecording) restartRecognition();
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    setIsRecording(false);
    setStatusMessage('READY');
    if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
  };

  // 🔴 인위적 조작: 현재 글자가 있다면 즉시 전송
  const handleManualSend = () => {
    if (displayInterim.trim()) {
      // interim(임시) 결과까지 모두 finalized로 강제 이동 후 전송
      finalizedBufferRef.current = displayInterim;
      processBuffer();
    }
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">
            {isRecording ? `DETECTING (${Math.max(0, 3 - Math.floor((Date.now() - lastResultTimeRef.current)/1000))}s)` : statusMessage}
          </span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500">SESSION START</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">SESSION STOP</button>
          )}
          <button onClick={() => { if(confirm("전체 초기화?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-120px)]">
        {/* 왼쪽: 입력 창 + 즉시 전송 버튼 */}
        <div className="flex flex-col relative overflow-hidden group">
          <div className="flex justify-between items-center mb-4">
             <span className="text-[9px] text-zinc-600 font-bold tracking-widest uppercase">Live Input</span>
             {displayInterim.trim() && (
               <button 
                 onClick={handleManualSend}
                 className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black px-3 py-1 rounded-full animate-bounce shadow-lg shadow-blue-500/20"
               >
                 즉시 전송 (MANUAL SEND)
               </button>
             )}
          </div>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/90 break-keep flex-grow">
            {displayInterim || <span className="text-zinc-900">Waiting for speech...</span>}
          </div>
          <div className="mt-4 text-[9px] font-mono opacity-20 uppercase tracking-tighter">
            * 3s Inactivity Watchdog Active
          </div>
        </div>

        {/* 오른쪽: 결과 창 */}
        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">AI Refined Stream</span>
          <div className="flex-grow overflow-y-auto space-y-10 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-500 ${i === 0 ? 'opacity-100' : 'opacity-10 blur-[1px]'}`}>
                <p className="text-2xl md:text-4xl font-bold leading-tight tracking-tighter">
                  {block.refined}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

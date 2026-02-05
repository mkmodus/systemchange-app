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

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // ⚡ [핵심] 고속 프로세스: 딜레이를 최소화한 전송 로직
  const processBuffer = useCallback(async () => {
    const textToSend = finalizedBufferRef.current.trim();
    
    // AI 연산 중이거나 너무 짧으면(1자 이하) 대기
    if (isProcessingRef.current || textToSend.length < 2) return;

    // 즉시 버퍼 비우기 (중복/누적 방지)
    isProcessingRef.current = true;
    finalizedBufferRef.current = ''; 
    setDisplayInterim(''); 
    setStatusMessage('⚡ AI');

    try {
      // 1.5-flash 모델을 통해 1~1.5초 내에 보정 완료 유도
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
    }
  }, []);

  // 🕒 [조정] 침묵 감지 시간을 0.3초로 단축 (호흡이 끊기면 바로 전송)
  useEffect(() => {
    const currentText = finalizedBufferRef.current.trim();
    if (currentText && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 300); // 0.3초 대기
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [displayInterim, processBuffer]);

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
    };

    recognition.onresult = (event: any) => {
      let interimContent = '';
      
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalizedBufferRef.current += (finalizedBufferRef.current ? ' ' : '') + transcript;
          // [중요] 확정 데이터가 들어오면 0.3초 기다리지 않고 바로 전송 시도
          processBuffer(); 
        } else {
          interimContent += transcript;
        }
      }
      
      setDisplayInterim(finalizedBufferRef.current + interimContent);

      // 🚀 [조정] 임계치를 18자로 하향 (단어 3~4개만 모여도 전송)
      if (finalizedBufferRef.current.length > 18) {
        processBuffer();
      }
    };

    recognition.onend = () => { if (isRecording) try { recognition.start(); } catch(e) {} };
    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    if (finalizedBufferRef.current.trim()) processBuffer();
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
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500">START</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-100px)]">
        <div className="flex flex-col relative overflow-hidden">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Live Input</span>
          <div className="text-3xl md:text-4xl font-black leading-tight text-white/90 break-keep">
            {displayInterim || <span className="text-zinc-900">...</span>}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Refined Presentation</span>
          <div className="flex-grow overflow-y-auto space-y-10 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-500 ${i === 0 ? 'opacity-100' : 'opacity-10 blur-[1px]'}`}>
                <p className="text-2xl md:text-3xl font-bold leading-tight tracking-tighter">
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

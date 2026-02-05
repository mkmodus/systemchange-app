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
  const lastResultTimeRef = useRef(Date.now());

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // 🔄 엔진 완전 리셋 (잔상 제거 핵심)
  const resetEngine = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    setTimeout(() => {
      if (isRecording) startRecording();
    }, 50); // 아주 짧은 찰나에 재시작
  }, [isRecording]);

  // ⚡ 보정 프로세스
  const processBuffer = useCallback(async (forcedText?: string) => {
    const textToSend = (forcedText || finalizedBufferRef.current).trim();
    if (isProcessingRef.current || textToSend.length < 2) return;

    isProcessingRef.current = true;
    
    // [즉시 초기화] 전송 시작과 동시에 화면과 버퍼를 비움
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
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
      lastResultTimeRef.current = Date.now();
    }
  }, []);

  // 🔴 수동/자동 전송 시 엔진 리셋 병행
  const handleSend = (text?: string) => {
    processBuffer(text);
    resetEngine();
  };

  // 타이머: 0.5초 침묵 시 자동 전송 (정확도를 위해 대기시간 소폭 상향)
  useEffect(() => {
    const currentText = finalizedBufferRef.current.trim();
    if (currentText && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => handleSend(), 500);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim]);

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
      lastResultTimeRef.current = Date.now();
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalizedBufferRef.current += (finalizedBufferRef.current ? ' ' : '') + event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setDisplayInterim(finalizedBufferRef.current + interim);

      // 🚀 정확도를 위한 적정 임계치: 30자
      if (finalizedBufferRef.current.length > 30) {
        handleSend();
      }
    };

    recognition.onend = () => { if (isRecording) startRecording(); };
    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
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
            <button onClick={startRecording} className="text-[10px] font-black text-blue-500">START</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black text-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black opacity-20">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-120px)]">
        <div className="flex flex-col relative overflow-hidden group">
          <div className="flex justify-between items-center mb-4">
             <span className="text-[9px] text-zinc-600 font-bold tracking-widest uppercase">Live Input</span>
             {displayInterim.trim() && (
               <button onClick={() => handleSend(displayInterim)} className="bg-blue-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full">즉시 전송</button>
             )}
          </div>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/90 break-keep">
            {displayInterim || <span className="text-zinc-900">...</span>}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Presentation Stream</span>
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

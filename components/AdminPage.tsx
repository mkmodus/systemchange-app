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

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // ⚡ 보정 프로세스 (정확도 우선)
  const processBuffer = useCallback(async () => {
    const textToSend = fullContentRef.current.substring(offsetRef.current).trim();
    if (isProcessingRef.current || textToSend.length < 2) return;

    isProcessingRef.current = true;
    offsetRef.current = fullContentRef.current.length; // 전송 지점 즉시 갱신
    setDisplayInterim(''); 
    setStatusMessage('⚡ AI REFINING');

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
  }, []);

  // 🕒 정확도를 위해 0.8초 침묵 시 전송 (문장이 어느 정도 완성된 후 보정)
  useEffect(() => {
    const unsentText = fullContentRef.current.substring(offsetRef.current).trim();
    if (unsentText && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const startRecording = async () => {
    try {
      // 마이크 권한 선제적 요청
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

        // 🚀 정확도 향상을 위해 40자 이상일 때 전송 (더 풍부한 문맥 제공)
        if (finalized.substring(offsetRef.current).length > 40) {
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

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-8 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 text-white text-[10px] font-black px-6 py-2 rounded-full shadow-lg shadow-blue-900/40 transition-all hover:bg-blue-500">START</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all hover:bg-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("Clear?")) syncData([]); }} className="text-[10px] font-black opacity-20 hover:opacity-100">RESET</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 h-[calc(100vh-140px)]">
        <div className="flex flex-col relative">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Live Speech Input</span>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/90 break-keep">
            {displayInterim || <span className="text-zinc-900 italic">Waiting...</span>}
          </div>
          {displayInterim.trim() && (
            <button 
              onClick={() => { fullContentRef.current += (fullContentRef.current ? ' ' : '') + displayInterim; processBuffer(); }}
              className="mt-6 w-fit bg-zinc-800 text-white text-[9px] font-black px-4 py-2 rounded-full border border-white/10 hover:bg-zinc-700"
            >
              즉시 전송 (FORCE SEND)
            </button>
          )}
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Presentation View</span>
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

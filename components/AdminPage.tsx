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
  
  // 데이터 관리를 위한 Refs
  const fullContentRef = useRef(''); // 엔진에서 받은 전체 확정 텍스트
  const offsetRef = useRef(0); // 화면에 보여주지 않을(이미 보낸) 텍스트의 끝 지점

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = useCallback((updatedBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), updatedBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(updatedBlocks));
  }, []);

  // 📝 송출 블록 수동 수정
  const handleEditBlock = (id: string, newRefined: string) => {
    setBlocks(prev => {
      const updated = prev.map(block => block.id === id ? { ...block, refined: newRefined } : block);
      syncData(updated);
      return updated;
    });
  };

  // ⚡ 보정 및 전송 (보낸 후 즉시 화면을 비우기 위해 offset 이동)
  const processBuffer = useCallback(async (manualText?: string) => {
    const textToSend = (manualText || fullContentRef.current.substring(offsetRef.current)).trim();
    if (isProcessingRef.current || textToSend.length < 1) return;

    isProcessingRef.current = true;
    
    // [핵심] 전송 시작 즉시 기준점(offset)을 현재 끝으로 밀어서 왼쪽 창 비우기
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

  // 🕒 자동 전송 (0.8초 침묵 시)
  useEffect(() => {
    const unsent = fullContentRef.current.substring(offsetRef.current).trim();
    if (unsent && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => processBuffer(), 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  // 🔴 즉시 전송 버튼 클릭 시
  const handleManualSend = () => {
    if (displayInterim.trim()) {
      const textToForce = displayInterim.trim();
      // 현재까지의 전체 기록에 수동 전송할 텍스트를 반영하고 기준점을 끝으로 이동
      fullContentRef.current = fullContentRef.current.substring(0, offsetRef.current) + textToForce;
      processBuffer(textToForce);
      
      // 버튼 누르는 즉시 화면을 비우기 위한 강제 업데이트
      setDisplayInterim('');
      offsetRef.current = fullContentRef.current.length;
    }
  };

  const startRecording = async () => {
    try {
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
        
        // 화면 표시: 전송 완료된 지점(offset) 이후만 출력
        const currentUnsent = finalized.substring(offsetRef.current) + interim;
        setDisplayInterim(currentUnsent);

        // 35자 도달 시 자동 전송 시도
        if (finalized.substring(offsetRef.current).length > 35) {
          processBuffer();
        }
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
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95">START</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95">STOP</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) { syncData([]); setBlocks([]); } }} className="text-[10px] font-black opacity-20 hover:opacity-100 px-2">RESET</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-140px)]">
        <div className="flex flex-col relative">
          <div className="flex justify-between items-center mb-4">
             <span className="text-[9px] text-zinc-600 font-bold tracking-widest uppercase italic">Monitoring Stream</span>
             {displayInterim.trim() && (
               <button onClick={handleManualSend} className="bg-blue-600 text-white text-[9px] font-black px-4 py-2 rounded-full shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-all">즉시 전송 (FLUSH)</button>
             )}
          </div>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/30 break-keep">
            {displayInterim || <span>...</span>}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-blue-500 font-bold mb-4 tracking-widest uppercase">Presentation Stream (Edit Enabled)</span>
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

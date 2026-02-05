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
    return () => {
      stopRecording();
    };
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  const processBuffer = useCallback(async () => {
    const textToSend = fullContentRef.current.substring(offsetRef.current).trim();
    if (isProcessingRef.current || textToSend.length < 2) return;

    isProcessingRef.current = true;
    offsetRef.current = fullContentRef.current.length;
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
  }, []);

  useEffect(() => {
    const currentUnsent = fullContentRef.current.substring(offsetRef.current).trim();
    if (currentUnsent && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 600);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  // 🚀 [해결책] 마이크 엔진 초기화 및 시작
  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      alert("크롬 브라우저를 사용해 주세요.");
      return;
    }

    // 1. 기존 인스턴스가 있다면 완전히 정리
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch (e) { console.error(e); }
      recognitionRef.current = null;
    }

    // 2. 새 인스턴스 생성
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onstart = () => {
      setIsRecording(true);
      setStatusMessage('LIVE');
      fullContentRef.current = '';
      offsetRef.current = 0;
      setDisplayInterim('');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalized = '';

      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalized += event.results[i][0].transcript;
        } else if (i >= event.resultIndex) {
          interim += event.results[i][0].transcript;
        }
      }

      fullContentRef.current = finalized;
      const currentUnsent = finalized.substring(offsetRef.current) + interim;
      setDisplayInterim(currentUnsent);

      if (finalized.substring(offsetRef.current).length > 30) {
        processBuffer();
      }
    };

    recognition.onerror = (event: any) => {
      console.error("STT Error:", event.error);
      if (event.error === 'not-allowed') {
        setStatusMessage('MIC BLOCKED');
        alert("마이크 권한이 차단되었습니다. 주소창 왼쪽의 자물쇠 아이콘을 눌러 허용해 주세요.");
      } else if (event.error === 'aborted') {
        console.log("인식이 중단되었습니다.");
      } else {
        setStatusMessage(`ERROR: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      // 예상치 못하게 끊겼을 때만 재시작
      if (isRecording) {
        setTimeout(() => {
          try { recognition.start(); } catch(e) {}
        }, 100);
      }
    };

    // 3. 브라우저가 이전 세션을 완전히 닫을 시간을 준 뒤 시작
    setTimeout(() => {
      try {
        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        console.error("Recognition Start Failed:", e);
      }
    }, 200);
  };

  const stopRecording = () => {
    setIsRecording(false);
    setStatusMessage('READY');
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const handleManualSend = () => {
    const text = displayInterim.trim();
    if (text) {
      fullContentRef.current += (fullContentRef.current ? ' ' : '') + text;
      processBuffer();
    }
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_15px_red]' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 hover:bg-red-500 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all active:scale-95">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("Clear?")) { syncData([]); setBlocks([]); } }} className="text-[10px] font-black opacity-20 hover:opacity-100 px-2">RESET</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-140px)]">
        <div className="flex flex-col relative group">
          <div className="flex justify-between items-center mb-4">
             <span className="text-[9px] text-zinc-600 font-bold tracking-widest uppercase">Live Input</span>
             {displayInterim.trim() && (
               <button onClick={handleManualSend} className="bg-zinc-800 hover:bg-zinc-700 text-white text-[9px] font-black px-4 py-1.5 rounded-full border border-white/10">
                 즉시 전송 (ENTER)
               </button>
             )}
          </div>
          <div className="text-3xl md:text-5xl font-black leading-tight text-white/90 break-keep">
            {displayInterim || <span className="text-zinc-900 italic">Waiting...</span>}
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

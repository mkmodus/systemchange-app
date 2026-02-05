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
  const fullContentRef = useRef(''); 
  const offsetRef = useRef(0); 

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => {
      // 컴포넌트 언마운트 시 모든 리소스 해제
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

  // ⚡ 보정 및 전송 (엔진은 건드리지 않고 기준점만 이동)
  const processBuffer = useCallback(async () => {
    const textToSend = fullContentRef.current.substring(offsetRef.current).trim();
    
    if (isProcessingRef.current || textToSend.length < 2) return;

    isProcessingRef.current = true;
    
    // [즉시 실행] 기준점을 현재 전체 길이로 이동시켜 화면을 비움
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

  // 🕒 자동 전송 타이머 (0.6초 침묵 시)
  useEffect(() => {
    const currentUnsent = fullContentRef.current.substring(offsetRef.current).trim();
    if (currentUnsent && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 600);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  // 🚀 시작 버튼 먹통 해결을 위한 강도 높은 초기화 로직
  const startRecording = () => {
    try {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechRecognition) {
        alert("이 브라우저는 음성 인식을 지원하지 않습니다. 크롬을 사용해주세요.");
        return;
      }

      // 1. 기존 엔진이 있다면 완전히 파괴
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onresult = null;
        try { recognitionRef.current.stop(); } catch(e) {}
      }

      // 2. 새 엔진 인스턴스 생성
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';

      // 3. 내부 데이터 초기화
      fullContentRef.current = '';
      offsetRef.current = 0;
      setDisplayInterim('');

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('LIVE');
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
        
        // 화면 표시: 전송 완료된 지점(offset) 이후만 출력
        const currentUnsent = finalized.substring(offsetRef.current) + interim;
        setDisplayInterim(currentUnsent);

        // 30자 도달 시 자동 전송 시도
        if (finalized.substring(offsetRef.current).length > 30) {
          processBuffer();
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech Recognition Error:", event.error);
        if (event.error === 'not-allowed') setStatusMessage('MIC BLOCKED');
        setIsRecording(false);
      };

      recognition.onend = () => {
        if (isRecording) {
          try { recognition.start(); } catch(e) {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;

    } catch (error) {
      console.error("Start Recording Failed:", error);
      setIsRecording(false);
    }
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
      // 수동 전송 시 interim까지 포함하기 위해 전체 길이를 가짜로 늘려 슬라이스 유도
      fullContentRef.current += (fullContentRef.current ? ' ' : '') + text;
      processBuffer();
    }
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_15px_red]' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 hover:bg-red-500 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) { syncData([]); setBlocks([]); } }} className="text-[10px] font-black opacity-20 hover:opacity-100 px-2">CLEAR</button>
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
            {displayInterim || <span className="text-zinc-900 italic">Waiting for speech...</span>}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Presentation Stream</span>
          <div className="flex-grow overflow-y-auto space-y-12 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-700 ${i === 0 ? 'opacity-100' : 'opacity-10 blur-[1.5px]'}`}>
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

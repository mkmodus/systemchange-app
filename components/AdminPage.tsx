import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [displayInterim, setDisplayInterim] = useState(''); // 이제 직접 편집 가능
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

  // ⚡ 보정 프로세스
  const processBuffer = useCallback(async (manualText?: string) => {
    // 수동 편집 내용이 있으면 우선순위로 사용, 없으면 버퍼에서 추출
    const textToSend = (manualText || fullContentRef.current.substring(offsetRef.current)).trim();
    
    if (isProcessingRef.current || textToSend.length < 1) return;

    isProcessingRef.current = true;
    
    // 즉시 상태 초기화 (잔상 방지)
    offsetRef.current = fullContentRef.current.length; 
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

  // 수동 입력 핸들러: 관리자가 직접 타이핑할 때 호출
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDisplayInterim(val);
    
    // [중요] 관리자가 수동으로 고친 내용을 버퍼에 반영
    // 이렇게 하면 자동 전송 타이머가 돌 때 수동으로 고친 내용이 나갑니다.
    const baseText = fullContentRef.current.substring(0, offsetRef.current);
    fullContentRef.current = baseText + val;
  };

  // 자동 전송 타이머 (0.8초 침묵 시)
  useEffect(() => {
    if (displayInterim.trim() && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const startRecording = async () => {
    try {
      setStatusMessage('MIC CHECK...');
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
        // 관리자가 편집 중(커서 포커스)일 때는 자동 업데이트를 최소화하고 싶다면 
        // 추가 로직이 필요하지만, 여기서는 최신 음성을 계속 덧붙이는 방식을 유지합니다.
        let interim = '';
        let finalized = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalized += event.results[i][0].transcript;
          else if (i >= event.resultIndex) interim += event.results[i][0].transcript;
        }

        fullContentRef.current = finalized;
        const currentUnsent = finalized.substring(offsetRef.current) + interim;
        setDisplayInterim(currentUnsent);

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
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="bg-blue-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all hover:bg-blue-500">START</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white text-[10px] font-black px-6 py-2 rounded-full transition-all hover:bg-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) { syncData([]); setBlocks([]); } }} className="text-[10px] font-black opacity-20">RESET</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-120px)]">
        <div className="flex flex-col relative">
          <div className="flex justify-between items-center mb-4">
             <span className="text-[9px] text-zinc-600 font-bold tracking-widest uppercase">Live Speech (Editable)</span>
             {displayInterim.trim() && (
               <button 
                 onClick={() => processBuffer()} 
                 className="bg-zinc-800 text-white text-[9px] font-black px-4 py-1.5 rounded-full border border-white/10 hover:bg-zinc-700 transition-colors"
               >
                 수정본 전송 (FORCE SEND)
               </button>
             )}
          </div>
          
          {/* 수동 편집이 가능한 Textarea */}
          <textarea
            value={displayInterim}
            onChange={handleInputChange}
            placeholder="음성 인식 대기 중..."
            className="flex-grow bg-transparent text-3xl md:text-5xl font-black leading-tight text-white/90 break-keep resize-none outline-none focus:text-blue-400 transition-colors"
          />
          <div className="mt-4 text-[9px] text-blue-500/50 font-medium">
            * 오타가 보이면 클릭하여 직접 수정할 수 있습니다. 수정한 내용은 0.8초 후 자동 전송됩니다.
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Refined Presentation</span>
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

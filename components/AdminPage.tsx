import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [displayPendingText, setDisplayPendingText] = useState(''); // UI 표시용
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  
  // 핵심 참조 변수 (상태 지연 방지)
  const pendingTextRef = useRef(''); 
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const isComponentMounted = useRef(true);
  const watchdogRef = useRef<any>(null);
  const lastResultTimeRef = useRef(Date.now());

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => { isComponentMounted.current = false; stopRecording(); };
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    const blocksRef = ref(db, 'interpretation/blocks');
    set(blocksRef, newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  const processText = useCallback(async () => {
    const textToProcess = pendingTextRef.current.trim();
    if (isProcessingRef.current || textToProcess.length < 2) return;

    // 1. 즉시 버퍼 비우기 (누락 방지)
    isProcessingRef.current = true;
    pendingTextRef.current = '';
    setDisplayPendingText('');
    setStatusMessage('⚡ SYNC');

    try {
      const refined = await refineTranscription(textToProcess);
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: textToProcess,
        refined: refined,
        timestamp: Date.now(),
      };

      if (isComponentMounted.current) {
        setBlocks(prev => {
          const updated = [newBlock, ...prev].slice(0, 500);
          syncData(updated);
          return updated;
        });
      }
    } catch (error) {
      console.error("AI Error:", error);
      const errBlock = { id: `err-${Date.now()}`, original: textToProcess, refined: textToProcess, timestamp: Date.now() };
      setBlocks(prev => { const up = [errBlock, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setStatusMessage(isRecording ? 'LIVE' : 'READY');
    }
  }, [isRecording]);

  // 워치독: 음성 인식이 멈췄는지 감시하고 강제 가동
  useEffect(() => {
    if (isRecording) {
      watchdogRef.current = setInterval(() => {
        const timeSinceLastResult = Date.now() - lastResultTimeRef.current;
        
        // 1. 말이 있는데 전송이 안 된 경우 (강제 전송)
        if (pendingTextRef.current.length > 0 && timeSinceLastResult > 1500) {
          processText();
        }
        
        // 2. 엔진이 멈춘 것 같을 때 (강제 재시작)
        if (timeSinceLastResult > 10000) { // 10초간 침묵 시
          console.log("Watchdog: Restarting engine...");
          startRecording();
        }
      }, 2000);
    } else {
      clearInterval(watchdogRef.current);
    }
    return () => clearInterval(watchdogRef.current);
  }, [isRecording, processText]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }

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
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // 메모리에 직접 기록 (상태 업데이트보다 빠름)
      if (finalTranscript) {
        pendingTextRef.current += (pendingTextRef.current ? ' ' : '') + finalTranscript;
        // 문장이 확정되면 즉시 전송 시도
        processText();
      }
      
      // UI에는 중간 결과도 보여줌 (실시간성 확보)
      setDisplayPendingText(pendingTextRef.current + interimTranscript);

      // 너무 길어지면 강제 전송 (25자)
      if (pendingTextRef.current.length > 25) {
        processText();
      }
    };

    recognition.onend = () => {
      if (isComponentMounted.current && isRecording) {
        recognition.start();
      }
    };

    recognition.onerror = (e: any) => {
      console.error("STT Error:", e.error);
      if (e.error === 'network') setStatusMessage('NETWORK ERROR');
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
    if (pendingTextRef.current.trim()) processText();
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_15px_red]' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-[0.4em] uppercase opacity-40">System {statusMessage}</span>
        </div>
        <div className="flex items-center gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500 hover:text-white transition-colors">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("Clear?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100">RESET</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 h-[calc(100vh-120px)]">
        <div className="flex flex-col relative">
          <textarea
            readOnly
            value={displayPendingText}
            className="flex-grow bg-transparent text-4xl md:text-5xl font-black leading-tight resize-none outline-none placeholder-zinc-900 border-none"
            placeholder="..."
          />
          <div className="absolute bottom-0 left-0 text-[10px] font-mono opacity-20 uppercase tracking-tighter">
            Hardware Accelerated STT Stream
          </div>
        </div>

        <div className="flex flex-col overflow-hidden">
          <div className="flex-grow overflow-y-auto space-y-12 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-700 ${i === 0 ? 'opacity-100 scale-100' : 'opacity-10 blur-[2px] scale-95 translate-y-4'}`}>
                <p className="text-3xl md:text-4xl font-bold leading-tight tracking-tighter">
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

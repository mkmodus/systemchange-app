import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [pendingText, setPendingText] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [processingSnapshot, setProcessingSnapshot] = useState(''); 
  
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const shouldRecordRef = useRef(false); // 녹화 의지를 저장하는 Ref (상태 업데이트 지연 방지)

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    const blocksRef = ref(db, 'interpretation/blocks');
    set(blocksRef, newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  const processPendingText = useCallback(async () => {
    if (isProcessingRef.current || !pendingText.trim()) return;

    const textToProcess = pendingText.trim();
    if (textToProcess.length < 2) return;

    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    isProcessingRef.current = true;
    setStatusMessage('⚡ SYNC');

    try {
      const refined = await refineTranscription(textToProcess);
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: textToProcess,
        refined: refined,
        timestamp: Date.now(),
      };

      setBlocks(prev => {
        const updated = [newBlock, ...prev].slice(0, 500);
        syncData(updated);
        return updated;
      });
    } catch (error) {
      const errBlock = { id: `err-${Date.now()}`, original: textToProcess, refined: textToProcess, timestamp: Date.now() };
      setBlocks(prev => { const up = [errBlock, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setProcessingSnapshot('');
      setStatusMessage(shouldRecordRef.current ? 'LIVE' : 'READY');
    }
  }, [pendingText]);

  // 자동 전송 타이머 (0.3초 침묵 시 전송)
  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processPendingText, 300);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [pendingText, processPendingText]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. (Chrome 권장)");
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onstart = () => {
      setIsRecording(true);
      shouldRecordRef.current = true;
      setStatusMessage('LIVE');
    };

    recognition.onresult = (event: any) => {
      let finalBatch = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalBatch += event.results[i][0].transcript;
      }
      if (finalBatch) {
        setPendingText(prev => prev + (prev ? ' ' : '') + finalBatch);
      }
    };

    // [핵심] 멎는 현상 해결: 인식이 끝나면 의지에 따라 즉시 재시작
    recognition.onend = () => {
      if (shouldRecordRef.current) {
        try { recognition.start(); } catch (e) {
          console.log("Restarting recognition...");
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error("STT Error:", event.error);
      if (event.error === 'not-allowed') shouldRecordRef.current = false;
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    shouldRecordRef.current = false;
    setIsRecording(false);
    setStatusMessage('READY');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (pendingText.trim()) processPendingText();
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_15px_red]' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-[0.4em] uppercase opacity-40">{statusMessage}</span>
        </div>
        <div className="flex items-center gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500 hover:text-white transition-colors">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("Clear?")) syncData([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100 transition-opacity">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-120px)]">
        <div className="flex flex-col relative">
          <textarea
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            className="flex-grow bg-transparent text-4xl md:text-5xl font-black leading-tight resize-none outline-none placeholder-zinc-900"
            placeholder="..."
          />
          {processingSnapshot && (
            <div className="absolute inset-x-0 bottom-4 p-4 bg-blue-600/5 border border-blue-500/10 rounded-3xl animate-pulse">
              <p className="text-[9px] text-blue-500 font-bold mb-1 tracking-widest">AI SYNCING</p>
              <p className="text-xl text-white/20 italic font-medium line-clamp-1">{processingSnapshot}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col overflow-hidden">
          <div className="flex-grow overflow-y-auto space-y-10 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-700 ${i === 0 ? 'opacity-100 scale-100' : 'opacity-10 blur-[1.5px] scale-95'}`}>
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

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
  
  // 🛡️ 누락 방지를 위한 '확정 바구니' 로직
  const confirmedTextBufferRef = useRef(''); // 아직 AI에게 보내지 않은 확정 텍스트들
  const lastProcessedIndexRef = useRef(0); // 브라우저 엔진 결과 리스트의 처리 위치

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = useCallback((updatedBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), updatedBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(updatedBlocks));
  }, []);

  const handleEditBlock = (id: string, newRefined: string) => {
    setBlocks(prev => {
      const updated = prev.map(block => block.id === id ? { ...block, refined: newRefined } : block);
      syncData(updated);
      return updated;
    });
  };

  // ⚡ [필살기] 보정 및 전송 함수
  const processBuffer = useCallback(async (manualExtraText?: string) => {
    // 확정 버퍼에 쌓인 텍스트와 수동 추가 텍스트를 합침
    const textToSend = (confirmedTextBufferRef.current + (manualExtraText || '')).trim();
    
    if (isProcessingRef.current || textToSend.length < 1) return;

    // 1. 전송 시작 즉시 바구니 비우기 (누락/중복 방지 핵심)
    isProcessingRef.current = true;
    confirmedTextBufferRef.current = ''; 
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
      console.error("AI Sync Error:", e);
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
    }
  }, [syncData]);

  // 🕒 자동 전송 (0.8초 침묵 시)
  useEffect(() => {
    if (confirmedTextBufferRef.current.trim() && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => processBuffer(), 800);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());

      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechRecognition) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('LIVE');
        confirmedTextBufferRef.current = '';
        lastProcessedIndexRef.current = 0;
      };

      recognition.onresult = (event: any) => {
        let interimContent = '';
        
        // [수정] event.resultIndex부터 시작하여 "새롭게 확정된" 단어들만 바구니(Buffer)에 담음
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            // 이미 처리한 인덱스가 아니라면 바구니에 추가
            if (i >= lastProcessedIndexRef.current) {
              confirmedTextBufferRef.current += (confirmedTextBufferRef.current ? ' ' : '') + transcript;
              lastProcessedIndexRef.current = i + 1;
            }
          } else {
            interimContent += transcript;
          }
        }

        // 화면 표시: 바구니에 든 확정 텍스트 + 현재 들리고 있는 임시 텍스트
        setDisplayInterim(confirmedTextBufferRef.current + interimContent);

        // 바구니가 40자를 넘으면 자동 전송 시도
        if (confirmedTextBufferRef.current.length > 40) {
          processBuffer();
        }
      };

      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => { 
        if (isRecording) {
          // 엔진이 종료될 때 바구니에 남은 게 있다면 털어내기
          if (confirmedTextBufferRef.current.trim()) processBuffer();
          try { recognition.start(); } catch(e) {}
        } 
      };

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

  const handleManualSend = () => {
    if (displayInterim.trim()) {
      // 현재 화면에 보이는 모든 내용(Interim 포함)을 강제로 보냄
      const extra = displayInterim.replace(confirmedTextBufferRef.current, '');
      processBuffer(extra);
    }
  };

  return (
    <div className="p-3 bg-zinc-950 min-h-screen text-zinc-100 font-sans flex flex-col antialiased">
      <header className="max-w-full w-full flex justify-between items-center mb-4 py-2 px-4 border-b border-white/5 sticky top-0 bg-zinc-950 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-zinc-800'}`} />
            <span className="text-[10px] font-bold tracking-widest uppercase">{statusMessage}</span>
          </div>
          <span className="text-[9px] font-bold text-zinc-600 uppercase">STATION v2.1</span>
        </div>
        <div className="flex gap-4">
          <button onClick={isRecording ? stopRecording : startRecording} className={`text-[10px] font-black px-4 py-1.5 rounded transition-all ${isRecording ? 'bg-red-600/20 text-red-500 border border-red-500/30' : 'bg-blue-600 text-white'}`}>{isRecording ? 'STOP' : 'START'}</button>
          <button onClick={() => confirm("Reset?") && syncData([])} className="text-[9px] font-bold text-zinc-600">RESET</button>
        </div>
      </header>

      <main className="max-w-full w-full grid grid-cols-12 gap-6 px-4">
        <section className="col-span-4 flex flex-col h-[calc(100vh-100px)]">
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Live Feed</span>
            {displayInterim.trim() && (
              <button onClick={handleManualSend} className="text-[8px] font-black text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded hover:bg-blue-400">FLUSH</button>
            )}
          </div>
          <div className="flex-grow bg-zinc-900/30 rounded-xl p-4 border border-white/5 overflow-y-auto">
            <div className="text-lg font-medium leading-relaxed text-white/20 break-keep">
              {displayInterim || <span className="text-zinc-900">...</span>}
            </div>
          </div>
        </section>

        <section className="col-span-8 flex flex-col h-[calc(100vh-100px)] border-l border-white/5 pl-6">
          <span className="text-[9px] text-blue-500 font-bold mb-2 px-1 uppercase tracking-widest">Refined (Click to edit)</span>
          <div className="flex-grow overflow-y-auto space-y-1 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`group flex gap-3 p-1 rounded transition-all ${i === 0 ? 'bg-white/5' : 'opacity-50 hover:opacity-100'}`}>
                <div className="pt-2"><div className={`w-1 h-1 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-zinc-800'}`} /></div>
                <textarea
                  value={block.refined}
                  onChange={(e) => handleEditBlock(block.id, e.target.value)}
                  className="flex-grow bg-transparent text-sm md:text-base font-medium leading-snug text-white/90 outline-none focus:text-blue-400 py-1 transition-all resize-none overflow-hidden"
                  rows={Math.max(1, Math.ceil(block.refined.length / 60))}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default AdminPage;

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

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    setBlocks(newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
    set(ref(db, 'interpretation/blocks'), newBlocks);
  };

  const processPendingText = useCallback(async () => {
    // 텍스트가 2자 미만이면 무시 (불필요한 API 호출 방지)
    if (isProcessingRef.current || pendingText.trim().length < 2) return;

    const textToProcess = pendingText.trim();
    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    
    isProcessingRef.current = true;
    setStatusMessage('⚡ NEXT');

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
      console.error("AI Error:", error);
      const errBlock = { id: 'err-'+Date.now(), original: textToProcess, refined: textToProcess, timestamp: Date.now() };
      setBlocks(prev => { const up = [errBlock, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setProcessingSnapshot('');
      setStatusMessage(isRecording ? 'LIVE' : 'READY');
    }
  }, [pendingText, isRecording]);

  // 🚀 극단적 단문 트리거: 8자 도달 시 또는 0.1초 침묵 시 전송
  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      // 단어 한두 개(8자)만 되어도 바로 전송
      if (trimmed.length > 8) { 
        processPendingText(); 
        return; 
      }

      if (timerRef.current) clearInterval(timerRef.current);
      
      // 침묵 대기 시간 0.1초 (기다림 없음)
      timerRef.current = setTimeout(() => {
        processPendingText();
      }, 100);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [pendingText, processPendingText]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event: any) => {
      let currentFinal = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) currentFinal += event.results[i][0].transcript;
      }
      
      if (currentFinal) {
        setPendingText(prev => prev + (prev ? ' ' : '') + currentFinal);
        // 확정 데이터가 오면 0.01초의 지체 없이 즉시 처리 함수 호출
        processPendingText(); 
      }
    };
    recognition.onend = () => { if (isRecording) try { recognition.start(); } catch(e) {} };
    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsRecording(false);
  };

  return (
    <div className="p-4 bg-black min-h-screen text-white font-sans overflow-hidden">
      {/* 초슬림 헤더 */}
      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest">{statusMessage}</span>
        </div>
        <div className="flex gap-4">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black bg-white text-black px-4 py-1 rounded-full">REC</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black bg-red-600 px-4 py-1 rounded-full">STOP</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-100px)]">
        {/* Input 영역: 글자를 크게 하여 시인성 확보 */}
        <div className="flex flex-col relative group">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-[0.3em] uppercase">Raw Input</span>
          <textarea
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            className="flex-grow bg-transparent text-5xl font-black leading-tight resize-none outline-none placeholder-zinc-900 transition-all focus:text-blue-500"
            placeholder="..."
            autoFocus
          />
          {processingSnapshot && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-zinc-900/50 rounded-2xl border border-white/5 animate-pulse">
              <p className="text-[9px] text-zinc-500 font-bold mb-1">AI PROCESSING</p>
              <p className="text-xl font-bold text-white/50">{processingSnapshot}</p>
            </div>
          )}
        </div>

        {/* Output 영역: 최신 글자가 가장 크게 */}
        <div className="flex flex-col overflow-hidden">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-[0.3em] uppercase">Refined Presentation</span>
          <div className="flex-grow overflow-y-auto space-y-8 scrollbar-hide">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-500 ${i === 0 ? 'opacity-100' : 'opacity-10 blur-[1px]'}`}>
                <p className={`${i === 0 ? 'text-4xl md:text-5xl' : 'text-xl'} font-bold leading-tight`}>
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

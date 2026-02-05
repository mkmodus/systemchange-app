import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [pendingText, setPendingText] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [countdown, setCountdown] = useState(0); 
  const [processingSnapshot, setProcessingSnapshot] = useState(''); 
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInput, setAuthInput] = useState('');
  
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

  // ⚡ AI Processing 시간을 줄이는 핵심 로직
  const processPendingText = useCallback(async () => {
    if (isProcessingRef.current || !pendingText.trim()) return;

    const textToProcess = pendingText.trim();
    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    
    isProcessingRef.current = true;
    setStatusMessage('⚡ AI'); // 상태 메시지도 최소화하여 렌더링 부하 감소
    setCountdown(0);

    try {
      // 1.5-flash 모델을 사용한다고 가정하며, 
      // 서비스 레이어에서 불필요한 프롬프트를 제거했을 때 가장 빠른 속도가 나옵니다.
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

  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      // 🚀 더 작게 쪼개기: 12자 도달 시 즉시 전송
      if (trimmed.length > 12) { 
        processPendingText(); 
        return; 
      }

      if (timerRef.current) clearInterval(timerRef.current);
      
      // 🚀 침묵 대기 시간 0.2초로 극단적 단축
      let timeLeft = 2; 
      setCountdown(2);

      timerRef.current = setInterval(() => {
        timeLeft -= 1;
        setCountdown(timeLeft);
        if (timeLeft <= 0) {
          clearInterval(timerRef.current);
          processPendingText();
        }
      }, 100);
    } else {
      setCountdown(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
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
        // 확정 결과가 나오면 타이머 무시하고 즉시 실행
        processPendingText(); 
      }
    };
    recognition.onend = () => { if (isRecording) try { recognition.start(); } catch(e) {} };
    recognition.start();
    recognitionRef.current = recognition;
  };

  return (
    <div className="p-4 bg-black min-h-screen text-white font-sans selection:bg-blue-500">
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl">
          <div className="w-full max-w-xs space-y-4">
            <input 
              type="password" value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (authInput === '830411' && (setShowAuthModal(false), startRecording()))}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center text-2xl outline-none focus:border-blue-500"
              placeholder="PASS" autoFocus
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-4 opacity-80">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-zinc-700'}`} />
          <span className="text-[10px] font-black tracking-[0.3em]">{statusMessage}</span>
        </div>
        {!isRecording ? (
          <button onClick={() => setShowAuthModal(true)} className="text-[10px] font-black border border-white/20 px-3 py-1 rounded-full">START</button>
        ) : (
          <button onClick={() => {if(recognitionRef.current) recognitionRef.current.stop(); setIsRecording(false);}} className="text-[10px] font-black text-red-500 border border-red-500/20 px-3 py-1 rounded-full">STOP</button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 h-[calc(100vh-80px)]">
        {/* Input & Output Stacked or Split */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="relative bg-zinc-900/20 rounded-[2rem] p-8 border border-white/5 flex flex-col">
            <textarea
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              className="flex-grow bg-transparent text-4xl font-black leading-tight resize-none outline-none placeholder-zinc-800"
              placeholder="..."
            />
            {processingSnapshot && (
              <div className="text-blue-500 text-sm font-bold animate-pulse mt-2">
                ⚡ {processingSnapshot}
              </div>
            )}
          </div>

          <div className="bg-zinc-900/20 rounded-[2rem] p-8 border border-white/5 overflow-y-auto custom-scrollbar">
            <div className="space-y-6">
              {blocks.map((block, i) => (
                <div key={block.id} className={`transition-all duration-300 ${i === 0 ? 'opacity-100' : 'opacity-20 blur-[0.5px]'}`}>
                  <p className="text-2xl font-bold leading-tight">{block.refined}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

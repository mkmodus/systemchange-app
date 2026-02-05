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

  // 초기 데이터 로드
  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
  }, []);

  // Firebase 실시간 동기화
  const syncToFirebase = (updatedBlocks: TextBlock[]) => {
    const blocksRef = ref(db, 'interpretation/blocks');
    set(blocksRef, updatedBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(updatedBlocks));
  };

  // ⚡ AI 보정 및 전송 (초저지연 파이프라인)
  const processPendingText = useCallback(async () => {
    const textToProcess = pendingText.trim();
    if (isProcessingRef.current || textToProcess.length < 2) return;

    // 1. Snapshot 생성 후 즉시 버퍼 비우기 (중요: 이 직후에 들어오는 음성은 새롭게 쌓임)
    isProcessingRef.current = true;
    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    setCountdown(0);
    setStatusMessage('⚡ AI');

    try {
      // 2. AI 호출 (geminiService.ts의 REST API 버전 사용 시 1~2초 내 응답)
      const refined = await refineTranscription(textToProcess);
      
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: textToProcess,
        refined: refined,
        timestamp: Date.now(),
      };

      // 3. 즉시 전송 및 화면 업데이트
      setBlocks(prev => {
        const updated = [newBlock, ...prev].slice(0, 500);
        syncToFirebase(updated);
        return updated;
      });
    } catch (error) {
      console.error("AI Sync Error:", error);
      // 에러 시 딜레이 없이 원문이라도 강제 노출
      const fallback = { id: `err-${Date.now()}`, original: textToProcess, refined: textToProcess, timestamp: Date.now() };
      setBlocks(prev => {
        const updated = [fallback, ...prev];
        syncToFirebase(updated);
        return updated;
      });
    } finally {
      isProcessingRef.current = false;
      setProcessingSnapshot('');
      setStatusMessage(isRecording ? 'LIVE' : 'READY');
    }
  }, [pendingText, isRecording]);

  // 🚀 하이퍼 타이머: 10자 초과 시 즉시, 혹은 0.3초 침묵 시 자동 전송
  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      if (trimmed.length > 10) { 
        processPendingText(); 
        return; 
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      
      let timeLeft = 3; // 0.3초 카운트다운
      setCountdown(3);

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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [pendingText, processPendingText]);

  const verifyAuth = () => {
    if (authInput === '830411') {
      setShowAuthModal(false);
      startRecording();
    } else {
      setAuthInput('');
    }
  };

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event: any) => {
      let finalBatch = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalBatch += event.results[i][0].transcript;
      }
      
      if (finalBatch) {
        setPendingText(prev => prev + (prev ? ' ' : '') + finalBatch);
        // 확정 음성 발생 시 타이머 무시하고 즉시 실행
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
    if (pendingText.trim()) processPendingText();
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-xs p-8 bg-zinc-900 rounded-[2.5rem] border border-white/5">
            <h2 className="text-center text-[10px] font-black tracking-[0.4em] mb-6 opacity-40 uppercase">Admin</h2>
            <input 
              type="password" value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyAuth()}
              className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-center text-2xl outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6 px-2">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-[0.3em] uppercase opacity-50">{statusMessage}</span>
        </div>
        <div className="flex items-center gap-6">
          {!isRecording ? (
            <button onClick={() => setShowAuthModal(true)} className="text-[10px] font-black tracking-widest hover:text-blue-500">START</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("Clear?")) syncToFirebase([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-120px)]">
        {/* Left: Raw Input Stream */}
        <div className="bg-zinc-900/40 rounded-[2rem] border border-white/5 p-8 flex flex-col relative overflow-hidden">
          <textarea
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            className="flex-grow bg-transparent text-4xl md:text-5xl font-black leading-tight resize-none outline-none placeholder-zinc-800"
            placeholder="..."
          />
          {processingSnapshot && (
            <div className="absolute inset-x-8 bottom-12 p-4 bg-blue-600/10 border border-blue-500/20 rounded-2xl backdrop-blur-md animate-pulse">
              <p className="text-[9px] text-blue-400 font-black mb-1 uppercase tracking-widest">AI Syncing</p>
              <p className="text-lg text-white/30 italic font-medium line-clamp-1">{processingSnapshot}</p>
            </div>
          )}
          <div className="h-1 bg-zinc-800/50 w-full mt-6 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-75" style={{ width: `${(countdown / 3) * 100}%` }} />
          </div>
        </div>

        {/* Right: AI Refined Results */}
        <div className="bg-zinc-900/40 rounded-[2rem] border border-white/5 p-8 flex flex-col overflow-hidden shadow-2xl">
          <div className="flex-grow overflow-y-auto space-y-8 scrollbar-hide">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-500 ${i === 0 ? 'opacity-100 translate-y-0' : 'opacity-10 blur-[1px] translate-y-2'}`}>
                <p className="text-2xl md:text-3xl font-bold leading-tight tracking-tight">
                  {block.refined}
                </p>
                {i === 0 && <div className="mt-2 w-4 h-0.5 bg-blue-500/50 rounded-full" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

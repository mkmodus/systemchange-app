import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('대기 중');
  const [pendingText, setPendingText] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [countdown, setCountdown] = useState(0); 
  const [processingSnapshot, setProcessingSnapshot] = useState(''); // 현재 보정 중인 텍스트 임시 표시용
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [authError, setAuthError] = useState(false);
  
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
    if (isProcessingRef.current || !pendingText.trim()) return;

    // 1. 현재 입력을 스냅샷으로 찍고 즉시 비움 (새 입력 유실 방지)
    const textToProcess = pendingText.trim();
    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    
    isProcessingRef.current = true;
    setStatusMessage('AI 보정 중...');
    setCountdown(0);

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
      // 에러 시 원문 보존 전송
      const errBlock = { id: 'err-'+Date.now(), original: textToProcess, refined: textToProcess, timestamp: Date.now() };
      setBlocks(prev => { const up = [errBlock, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setProcessingSnapshot('');
      setStatusMessage(isRecording ? '음성 수신 중...' : '대기 중');
    }
  }, [pendingText, isRecording]);

  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      if (trimmed.length > 80) { processPendingText(); return; }
      if (timerRef.current) clearInterval(timerRef.current);
      let timeLeft = 15; 
      setCountdown(15);
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

  const verifyAuth = () => {
    if (authInput === '830411') { setShowAuthModal(false); startRecording(); }
    else { setAuthError(true); setAuthInput(''); }
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
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      }
      if (finalTranscript) {
        setPendingText(prev => prev + (prev ? ' ' : '') + finalTranscript);
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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 w-full max-w-md text-center space-y-4">
            <h2 className="text-xl font-bold text-white">관리자 인증</h2>
            <input 
              type="password" value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyAuth()}
              className="w-full bg-black border border-zinc-700 rounded-xl p-4 text-center text-3xl text-white outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setShowAuthModal(false)} className="flex-1 p-3 text-zinc-400">취소</button>
              <button onClick={verifyAuth} className="flex-1 p-3 bg-blue-600 rounded-xl text-white font-bold">확인</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center bg-zinc-900 p-6 rounded-2xl border border-zinc-800 shadow-xl">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-zinc-700'}`} />
          <h1 className="text-xl font-bold text-white uppercase tracking-tight">2026 Forum Admin</h1>
          <span className="text-zinc-500 text-xs font-mono bg-black/50 px-2 py-1 rounded">{statusMessage}</span>
        </div>
        <div className="flex gap-2">
          {!isRecording ? (
            <button onClick={() => setShowAuthModal(true)} className="bg-white text-black px-6 py-2 rounded-full font-bold hover:bg-zinc-200 transition-all">통역 시작</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white px-6 py-2 rounded-full font-bold hover:bg-red-700 transition-all">중지</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) syncData([]); }} className="border border-zinc-700 text-zinc-400 px-4 py-2 rounded-full text-sm">초기화</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 h-[600px] flex flex-col shadow-inner">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] text-blue-500 font-black uppercase tracking-[0.2em]">STT Input Stream</span>
            {pendingText.trim() && (
              <button onClick={() => processPendingText()} className="text-[10px] bg-blue-600 text-white px-3 py-1 rounded-full font-bold animate-pulse">즉시 전송</button>
            )}
          </div>
          
          <div className="flex-grow flex flex-col relative">
            <textarea
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              className="flex-grow bg-black/40 rounded-xl p-5 text-white text-2xl leading-relaxed resize-none outline-none border border-zinc-800 focus:border-blue-500/50 transition-all"
              placeholder="음성 수신 대기 중..."
            />
            {processingSnapshot && (
              <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] pointer-events-none flex flex-col justify-end p-5">
                <div className="bg-blue-900/40 p-3 rounded-lg border border-blue-500/30 animate-pulse">
                  <p className="text-xs text-blue-300 font-bold mb-1">AI 보정 중인 문장:</p>
                  <p className="text-sm text-white/60 line-clamp-2">{processingSnapshot}</p>
                </div>
              </div>
            )}
          </div>

          <div className="h-1.5 bg-zinc-800 w-full mt-4 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-100 ease-linear" style={{ width: `${(countdown / 15) * 100}%` }} />
          </div>
        </div>

        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 h-[600px] flex flex-col">
          <span className="text-[10px] text-green-500 font-black uppercase tracking-[0.2em] mb-4">AI Refined Results</span>
          <div className="flex-grow overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {blocks.map(block => (
              <div key={block.id} className="bg-black/30 p-5 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors">
                <p className="text-white text-xl font-medium leading-relaxed">{block.refined}</p>
                <p className="text-[9px] text-zinc-600 mt-3 font-mono border-t border-zinc-800/30 pt-2">{new Date(block.timestamp).toLocaleTimeString()}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

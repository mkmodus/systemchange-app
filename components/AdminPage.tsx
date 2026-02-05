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
    // 이미 처리 중이거나 텍스트가 없으면 리턴
    if (isProcessingRef.current || !pendingText.trim()) return;

    const textToProcess = pendingText.trim();
    setProcessingSnapshot(textToProcess);
    setPendingText(''); // 큐를 즉시 비워 다음 음성 수신 보장
    
    isProcessingRef.current = true;
    setStatusMessage('⚡ SENDING');
    setCountdown(0);

    try {
      // Gemini API 호출 시점을 가장 앞당김
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
      // 지연 방지를 위해 에러 발생 시 원문 즉시 노출
      const errBlock = { id: 'err-'+Date.now(), original: textToProcess, refined: textToProcess, timestamp: Date.now() };
      setBlocks(prev => { const up = [errBlock, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setProcessingSnapshot('');
      setStatusMessage(isRecording ? 'LIVE' : 'READY');
    }
  }, [pendingText, isRecording]);

  // ⚡ 초저지연 타이머: 0.5초 침묵 또는 30자 도달 시 실행
  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      // 문장이 조금만 길어져도(30자) 바로 쏨
      if (trimmed.length > 30) { 
        processPendingText(); 
        return; 
      }

      if (timerRef.current) clearInterval(timerRef.current);
      
      // 침묵 대기 시간 0.5초 (인간 인지 한계 수준)
      let timeLeft = 5; 
      setCountdown(5);

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
      let currentFinal = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
        }
      }
      
      if (currentFinal) {
        setPendingText(prev => prev + (prev ? ' ' : '') + currentFinal);
        // [핵심] 브라우저가 문장을 확정(isFinal)하는 순간 타이머 무시하고 즉시 AI에게 전송
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
    <div className="p-4 bg-black min-h-screen space-y-4">
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl">
          <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 w-full max-w-sm text-center space-y-6">
            <h2 className="text-xl font-bold text-white tracking-tighter">ADMIN AUTH</h2>
            <input 
              type="password" value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyAuth()}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl p-4 text-center text-4xl text-white outline-none focus:border-blue-500 transition-all"
              autoFocus
            />
            <button onClick={verifyAuth} className="w-full p-4 bg-blue-600 rounded-2xl text-white font-black hover:bg-blue-500 transition-all">ENTER</button>
          </div>
        </div>
      )}

      {/* Header Stat Bar */}
      <div className="flex justify-between items-center bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_10px_red]' : 'bg-zinc-700'}`} />
          <h1 className="text-sm font-black text-white tracking-widest uppercase">2026 Forum Live</h1>
          <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${isProcessingRef.current ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
            {statusMessage}
          </span>
        </div>
        <div className="flex gap-2">
          {!isRecording ? (
            <button onClick={() => setShowAuthModal(true)} className="bg-white text-black px-4 py-1.5 rounded-full text-xs font-black">START</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white px-4 py-1.5 rounded-full text-xs font-black">STOP</button>
          )}
          <button onClick={() => syncData([])} className="text-zinc-600 text-[10px] font-bold hover:text-red-500 transition-colors">CLEAR</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-120px)]">
        {/* Left: Instant Input */}
        <div className="bg-zinc-900/30 rounded-3xl border border-zinc-800 p-6 flex flex-col relative overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] text-blue-500 font-black tracking-widest">CAPTURE STREAM</span>
            <span className="text-[10px] text-zinc-700 font-mono">{pendingText.length}/30</span>
          </div>
          
          <textarea
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            className="flex-grow bg-transparent text-white text-3xl font-bold leading-tight resize-none outline-none placeholder-zinc-800"
            placeholder="Listening..."
          />
          
          {processingSnapshot && (
            <div className="absolute inset-x-6 bottom-16 p-4 bg-blue-600/10 border border-blue-500/20 rounded-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2">
              <p className="text-[10px] text-blue-400 font-black mb-1 uppercase tracking-tighter">AI Processing</p>
              <p className="text-lg text-white/40 italic font-medium line-clamp-1">{processingSnapshot}</p>
            </div>
          )}

          <div className="h-1 bg-zinc-800 w-full mt-6 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-75 ease-linear" style={{ width: `${(countdown / 5) * 100}%` }} />
          </div>
        </div>

        {/* Right: Refined Output */}
        <div className="bg-zinc-900/30 rounded-3xl border border-zinc-800 p-6 flex flex-col overflow-hidden">
          <span className="text-[10px] text-green-500 font-black tracking-widest mb-4 uppercase">Refined Stream</span>
          <div className="flex-grow overflow-y-auto space-y-4 pr-2 scrollbar-hide">
            {blocks.map((block, i) => (
              <div key={block.id} className={`p-5 rounded-2xl border ${i === 0 ? 'bg-zinc-800/50 border-zinc-700' : 'bg-transparent border-zinc-800/50 opacity-40'}`}>
                <p className="text-white text-xl font-bold leading-snug">{block.refined}</p>
                <p className="text-[9px] text-zinc-600 mt-3 font-mono uppercase tracking-tighter">{new Date(block.timestamp).toLocaleTimeString()}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

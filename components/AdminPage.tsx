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
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [authError, setAuthError] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) {
      setBlocks(JSON.parse(saved));
    }
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    setBlocks(newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
    set(ref(db, 'interpretation/blocks'), newBlocks);
  };

  const processPendingText = useCallback(async (textOverride?: string) => {
    const textToProcess = (textOverride || pendingText).trim();
    if (!textToProcess || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setStatusMessage('AI 보정 및 전송 중...');
    setCountdown(0);
    // 즉시 전송 시 현재 pendingText를 비워 다음 입력을 대기함
    if (!textOverride) setPendingText(''); 

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
      console.error("AI 보정 실패:", error);
    } finally {
      setStatusMessage(isRecording ? '음성 수신 중...' : '대기 중');
      isProcessingRef.current = false;
    }
  }, [pendingText, isRecording]);

  // --- [수정된 타이머 로직] ---
  useEffect(() => {
    const trimmedText = pendingText.trim();
    
    if (trimmedText && !isProcessingRef.current) {
      // 1. 글자 수가 80자를 넘어가면 pause 상관없이 즉시 전송 (40초 딜레이 방지)
      if (trimmedText.length > 80) {
        processPendingText();
        return;
      }

      // 2. 일시 정지 감지 타이머 (1.5초 대기)
      if (timerRef.current) clearInterval(timerRef.current);
      
      let timeLeft = 15; // 1.5초
      setCountdown(15);
      
      timerRef.current = setInterval(() => {
        timeLeft -= 1; 
        setCountdown(timeLeft);
        
        if (timeLeft <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          processPendingText();
        }
      }, 100); 
    } else {
      setCountdown(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [pendingText, processPendingText]);
  // -------------------------

  const verifyAuth = () => {
    if (authInput === '830411') {
      setShowAuthModal(false);
      startRecording();
    } else {
      setAuthError(true);
      setAuthInput('');
    }
  };

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setStatusMessage("인식 지원 불가");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true; // 중간 결과 수신 활성화
      recognition.lang = 'ko-KR';

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('음성 수신 중...');
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setPendingText(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognition.onerror = () => stopRecording();
      recognition.onend = () => { if (isRecording) { try { recognition.start(); } catch(e) {} } };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      setStatusMessage("초기화 실패");
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setStatusMessage('대기 중');
    if (pendingText.trim()) {
      processPendingText();
    }
  };

  const clearHistory = () => {
    if (confirm("모든 통역 기록을 삭제하시겠습니까?")) {
      syncData([]);
      setPendingText('');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 w-full max-w-md text-center space-y-4">
            <h2 className="text-xl font-bold text-white">관리자 인증</h2>
            <input 
              type="password" 
              value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyAuth()}
              className="w-full bg-black border border-zinc-700 rounded-xl p-4 text-center text-2xl text-white"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setShowAuthModal(false)} className="flex-1 p-3 text-zinc-400">취소</button>
              <button onClick={verifyAuth} className="flex-1 p-3 bg-blue-600 rounded-xl text-white font-bold">확인</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-zinc-700'}`} />
          <div>
            <h1 className="text-xl font-bold text-white leading-none">포럼 통역 관리자</h1>
            <p className="text-zinc-400 text-xs mt-1">{statusMessage}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!isRecording ? (
            <button onClick={() => setShowAuthModal(true)} className="bg-white text-black px-6 py-2 rounded-full font-bold">통역 시작</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white px-6 py-2 rounded-full font-bold">중지</button>
          )}
          <button onClick={clearHistory} className="border border-zinc-700 text-zinc-400 px-4 py-2 rounded-full text-sm font-bold">초기화</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 h-[500px] flex flex-col">
          <div className="flex justify-between mb-3 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
            <span>STT Input (Auto-send at 80 chars)</span>
            <span>{pendingText.length} / 80</span>
          </div>
          <textarea
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            className="flex-grow bg-black/30 rounded-xl p-4 text-white text-xl resize-none outline-none border border-zinc-800"
            placeholder="음성을 기다리고 있습니다..."
          />
          <div className="h-1.5 bg-zinc-800 w-full mt-4 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-100 ease-linear" style={{ width: `${(countdown / 15) * 100}%` }} />
          </div>
        </div>

        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 h-[500px] flex flex-col">
          <div className="mb-3 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">AI Refined Stream</div>
          <div className="flex-grow overflow-y-auto space-y-4 pr-2">
            {blocks.map(block => (
              <div key={block.id} className="bg-black/30 p-5 rounded-xl border border-zinc-800">
                <p className="text-white text-lg font-medium leading-relaxed">{block.refined}</p>
                <p className="text-[9px] text-zinc-600 mt-3 font-mono">{new Date(block.timestamp).toLocaleTimeString()}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

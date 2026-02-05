import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
// [추가] Firebase 관련 임포트
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

  // 로컬 저장소 동기화
  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) {
      setBlocks(JSON.parse(saved));
    }
  }, []);

  // [수정] 모든 기기에 데이터를 전송하는 통합 저장 함수
  const syncData = (newBlocks: TextBlock[]) => {
    setBlocks(newBlocks);
    // 1. 내 브라우저에 저장
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
    // 2. Firebase 실시간 데이터베이스에 전송 (참가자 화면 동기화)
    set(ref(db, 'interpretation/blocks'), newBlocks);
  };

  const processPendingText = useCallback(async (textOverride?: string) => {
    const textToProcess = (textOverride || pendingText).trim();
    if (!textToProcess || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setStatusMessage('AI 보정 및 전송 중...');
    setCountdown(0);
    if (!textOverride) setPendingText(''); 

    const refined = await refineTranscription(textToProcess);
    
    const newBlock: TextBlock = {
      id: Math.random().toString(36).substring(7),
      original: textToProcess,
      refined: refined,
      timestamp: Date.now(),
    };

    // [수정] 상태 업데이트 시 Firebase와 동기화
    setBlocks(prev => {
      const updated = [newBlock, ...prev].slice(0, 500);
      syncData(updated); // Firebase 전송
      return updated;
    });

    setStatusMessage(isRecording ? '2026 포럼 현장 음성 수신 중...' : '대기 중');
    isProcessingRef.current = false;
  }, [pendingText, isRecording]);

  useEffect(() => {
    if (pendingText.trim() && !isProcessingRef.current) {
      if (timerRef.current) clearInterval(timerRef.current);
      
      let timeLeft = 70;
      setCountdown(70);
      
      timerRef.current = setInterval(() => {
        timeLeft -= 1.25; 
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

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pendingText, processPendingText]);

  const handleStartRequest = () => {
    setShowAuthModal(true);
    setAuthInput('');
    setAuthError(false);
  };

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
      setStatusMessage("브라우저가 음성 인식을 지원하지 않습니다.");
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. 크롬 브라우저를 권장합니다.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';

      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('2026 포럼 현장 음성 수신 중...');
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

      recognition.onerror = (event: any) => {
        console.error("Recognition error", event.error);
        stopRecording();
      };

      recognition.onend = () => {
        if (isRecording) {
          try { recognition.start(); } catch(e) {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      setStatusMessage("인식기 초기화 실패");
      console.error(e);
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
      const textToSave = pendingText;
      setPendingText('');
      processPendingText(textToSave);
    }
  };

  // [수정] 초기화 시 Firebase 데이터도 함께 삭제
  const clearHistory = () => {
    if (confirm("모든 통역 기록을 삭제하시겠습니까? (참가자 화면에서도 삭제됩니다)")) {
      syncData([]); // 빈 배열을 전송하여 전체 초기화
      setPendingText('');
    }
  };

  const downloadInterpretation = () => {
    if (blocks.length === 0) {
      alert("저장할 기록이 없습니다.");
      return;
    }
    
    const content = blocks
      .slice()
      .reverse()
      .map(b => {
        const timeStr = new Date(b.timestamp).toLocaleTimeString('ko-KR', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
        return `[${timeStr}] ${b.refined}`;
      })
      .join('\n\n');
      
    const now = new Date();
    const dateTitle = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. ${now.toLocaleTimeString('ko-KR', { hour12: true })}`;
      
    const blob = new Blob([`2026 체제전환운동포럼 문자 통역 기록 (${dateTitle})\n\n${content}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `interpretation_2026_forum_${now.toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    /* UI 부분은 기존과 동일하므로 생략하거나 기존 코드를 그대로 유지하시면 됩니다. */
    <div className="space-y-8 pb-20">
      {/* ... 기존 UI 코드 ... */}
      {/* 팁: 기존 UI 코드를 그대로 붙여넣으셔도 위의 로직 수정사항과 잘 연결됩니다. */}
      {/* (생략된 UI 코드는 사용자가 제공한 원본과 동일하게 유지) */}
      
      {/* Auth Modal UI */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-black/60 transition-all">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md p-8 rounded-3xl shadow-2xl">
             {/* ... 인증 모달 내용 ... */}
             <div className="text-center space-y-4">
              <h2 className="text-2xl font-bold text-white">관리자 인증</h2>
              <input 
                type="password" 
                maxLength={6} 
                value={authInput}
                onChange={(e) => setAuthInput(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-4 text-center text-4xl"
                onKeyDown={(e) => e.key === 'Enter' && verifyAuth()}
              />
              <div className="flex gap-3">
                <button onClick={() => setShowAuthModal(false)} className="flex-1 px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400">취소</button>
                <button onClick={verifyAuth} className="flex-1 px-6 py-3 rounded-xl bg-blue-600 text-white font-bold">확인</button>
              </div>
             </div>
          </div>
        </div>
      )}

      {/* Main Admin UI */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 shadow-xl">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-zinc-700'}`} />
          <h1 className="text-2xl font-bold text-zinc-100">2026 체제전환운동포럼 관리자</h1>
        </div>
        <div className="flex gap-3">
          {!isRecording ? (
            <button onClick={handleStartRequest} className="bg-white text-black px-6 py-3 rounded-full font-bold">통역 시작</button>
          ) : (
            <button onClick={stopRecording} className="bg-red-600 text-white px-6 py-3 rounded-full font-bold">통역 중지</button>
          )}
          <button onClick={clearHistory} className="border border-zinc-700 text-zinc-300 px-6 py-3 rounded-full font-bold">초기화</button>
        </div>
      </div>

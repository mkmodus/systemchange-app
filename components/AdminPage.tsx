
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('대기 중');
  const [pendingText, setPendingText] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [countdown, setCountdown] = useState(0); 
  
  // Auth state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [authError, setAuthError] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const isProcessingRef = useRef(false);

  // Sync with localStorage
  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) {
      setBlocks(JSON.parse(saved));
    }
  }, []);

  const saveBlocksToStorage = (newBlocks: TextBlock[]) => {
    setBlocks(newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
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

    setBlocks(prev => {
      const updated = [newBlock, ...prev].slice(0, 500); 
      localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(updated));
      return updated;
    });

    setStatusMessage(isRecording ? '2026 포럼 현장 음성 수신 중...' : '대기 중');
    isProcessingRef.current = false;
  }, [pendingText, isRecording]);

  useEffect(() => {
    if (pendingText.trim() && !isProcessingRef.current) {
      if (timerRef.current) clearInterval(timerRef.current);
      
      let timeLeft = 100;
      setCountdown(100);
      
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
        localStorage.setItem(StorageKeys.IS_RECORDING, 'true');
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
    localStorage.setItem(StorageKeys.IS_RECORDING, 'false');
    
    if (pendingText.trim()) {
      const textToSave = pendingText;
      setPendingText('');
      processPendingText(textToSave);
    }
  };

  const clearHistory = () => {
    if (confirm("모든 통역 기록을 삭제하시겠습니까?")) {
      saveBlocksToStorage([]);
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
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
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
    <div className="space-y-8 pb-20">
      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-black/60 transition-all">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md p-8 rounded-3xl shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-2">
                <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white">관리자 인증</h2>
              <p className="text-zinc-400 text-sm">실시간 통역을 시작하려면 인증번호 6자리를 입력하세요.</p>
              
              <div className="pt-4">
                <input 
                  type="password"
                  maxLength={6}
                  value={authInput}
                  onChange={(e) => {
                    setAuthInput(e.target.value.replace(/[^0-9]/g, ''));
                    if (authError) setAuthError(false);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && verifyAuth()}
                  autoFocus
                  className={`w-full bg-black border ${authError ? 'border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-zinc-700'} rounded-xl px-4 py-4 text-center text-4xl tracking-[0.5em] font-mono focus:outline-none focus:border-blue-500 transition-all`}
                  placeholder="••••••"
                />
                {authError && <p className="text-red-500 text-xs mt-3 font-medium">인증번호가 올바르지 않습니다.</p>}
              </div>

              <div className="flex gap-3 pt-6">
                <button 
                  onClick={() => setShowAuthModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold hover:bg-zinc-800 transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={verifyAuth}
                  className="flex-1 px-6 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20 active:scale-95"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 shadow-xl">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-600 animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.5)]' : 'bg-zinc-700'}`} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">2026 체제전환운동포럼 관리자</h1>
            <p className="text-zinc-400 text-sm font-medium">{statusMessage}</p>
          </div>
        </div>
        <div className="flex gap-3">
          {!isRecording ? (
            <button 
              onClick={handleStartRequest}
              className="bg-white text-black px-6 py-3 rounded-full font-bold hover:bg-zinc-200 transition-all active:scale-95 shadow-lg"
            >
              실시간 통역 시작
            </button>
          ) : (
            <button 
              onClick={stopRecording}
              className="bg-red-600 text-white px-6 py-3 rounded-full font-bold hover:bg-red-700 transition-all active:scale-95 shadow-lg"
            >
              통역 중지
            </button>
          )}
          <button 
            onClick={clearHistory}
            className="border border-zinc-700 text-zinc-300 px-6 py-3 rounded-full font-bold hover:bg-zinc-800 transition-colors"
          >
            초기화
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 h-[650px] flex flex-col shadow-2xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-zinc-500 font-bold uppercase text-xs tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Live STT Input (Edit enabled)
            </h3>
            {pendingText && (
               <button 
                onClick={() => processPendingText()}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full font-bold transition-all shadow-md active:scale-95"
               >
                 즉시 전송
               </button>
            )}
          </div>
          
          <div className="relative flex-grow flex flex-col">
            <textarea
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              placeholder={isRecording ? "포럼 연사의 음성을 기다리는 중... (이곳에서 즉시 수정이 가능합니다)" : "상단의 [통역 시작] 버튼을 클릭하세요."}
              className="w-full flex-grow bg-black/40 border border-zinc-800 rounded-xl p-6 text-2xl leading-relaxed focus:outline-none focus:border-blue-500 transition-colors resize-none mb-4 font-medium text-white placeholder-zinc-700"
            />
            
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-100 ease-linear"
                style={{ width: `${countdown}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-2 px-1">
              <p className="text-[10px] text-zinc-500 uppercase tracking-tighter font-mono">
                Auto-Correction Cycle
              </p>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-tighter font-mono">
                {countdown > 0 ? "Editing Buffer Active" : "Waiting for speech"}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 h-[650px] flex flex-col shadow-2xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-zinc-500 font-bold uppercase text-xs tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              AI Refined Stream
            </h3>
            {blocks.length > 0 && (
              <button 
                onClick={downloadInterpretation}
                className="text-xs border border-zinc-700 hover:bg-zinc-800 text-zinc-300 px-4 py-1.5 rounded-full font-bold transition-colors flex items-center gap-2"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                기록 저장 (.txt)
              </button>
            )}
          </div>
          <div className="flex-grow overflow-y-auto space-y-6 pr-2 scroll-smooth">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center px-10">
                <p className="text-lg font-medium">정제된 통역 메시지가 없습니다.</p>
                <p className="text-sm opacity-60 mt-2">입력된 음성은 2026 포럼 자료집 기반의 지식으로<br/>AI가 실시간 보정하여 전송됩니다.</p>
              </div>
            ) : (
              blocks.map((block) => (
                <div key={block.id} className="group bg-zinc-800/30 p-6 rounded-xl border border-zinc-700/50 hover:border-blue-500/30 transition-all shadow-sm">
                  <p className="text-2xl leading-relaxed text-zinc-100 font-semibold">{block.refined}</p>
                  <div className="flex justify-between items-center mt-4 border-t border-zinc-800/50 pt-4">
                    <span className="text-xs font-mono text-zinc-500 bg-black/30 px-2 py-1 rounded">
                      {new Date(block.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                      2026 Forum Context Matched
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

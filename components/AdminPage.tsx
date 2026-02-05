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
    // 2자 미만은 무시하여 불필요한 API 호출 차단
    if (isProcessingRef.current || pendingText.trim().length < 2) return;

    const textToProcess = pendingText.trim();
    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    
    isProcessingRef.current = true;
    setStatusMessage('⚡ AI'); // 상태 메시지도 짧게 변경하여 렌더링 최적화

    try {
      // 🚀 Gemini 1.5 Flash 모델 사용 시 이 부분에서 약 0.5~1초 내외로 결과가 나옵니다.
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

  // ⚡ 초단문 트리거 (8자 이상 시 즉시 전송)
  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      if (trimmed.length > 8) { 
        processPendingText(); 
        return; 
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      // 침묵 대기 시간 0.2초 (거의 즉시)
      timerRef.current = setTimeout(() => {
        processPendingText();
      }, 200);
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
        // 확정 데이터가 들어오면 대기시간 없이 즉시 처리
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
      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest">{statusMessage}</span>
        </div>
        {!isRecording ? (
          <button onClick={startRecording} className="text-[10px] font-black bg-white text-black px-4 py-1 rounded-full">START REC</button>
        ) : (
          <button onClick={stopRecording} className="text-[10px] font-black bg-red-600 px-4 py-1 rounded-full">STOP</button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-120px)]">
        <div className="flex flex-col relative">
          <textarea
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            className="flex-grow bg-transparent text-5xl font-black leading-tight resize-none outline-none placeholder-zinc-900"
            placeholder="..."
          />
          {processingSnapshot && (
            <div className="text-blue-500 text-xs font-bold animate-pulse">
              SYNCING: {processingSnapshot}
            </div>
          )}
        </div>

        <div className="flex flex-col overflow-hidden">
          <div className="flex-grow overflow-y-auto space-y-6 scrollbar-hide">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-300 ${i === 0 ? 'opacity-100' : 'opacity-10'}`}>
                <p className={`${i === 0 ? 'text-4xl' : 'text-xl'} font-bold leading-tight`}>
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

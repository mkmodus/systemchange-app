import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [displayInterim, setDisplayInterim] = useState(''); // 화면 표시용 (임시)
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  
  const finalizedBufferRef = useRef(''); // 확정된 텍스트만 모으는 버퍼
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // ⚡ 보정 및 전송 (중복 방지 로직 강화)
  const processBuffer = useCallback(async () => {
    const textToSend = finalizedBufferRef.current.trim();
    
    // 이미 처리 중이거나 보낼 내용이 너무 짧으면 중단
    if (isProcessingRef.current || textToSend.length < 2) return;

    // [핵심] 전송 시작 즉시 버퍼를 완전히 비워 중복 전송 차단
    isProcessingRef.current = true;
    finalizedBufferRef.current = ''; 
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
      // 에러 시 원문이라도 전송하여 데이터 유실 방지
      const fallback = { id: `err-${Date.now()}`, original: textToSend, refined: textToSend, timestamp: Date.now() };
      setBlocks(prev => { const up = [fallback, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
    }
  }, []);

  // 🕒 침묵 감지 타이머 (0.5초간 확정된 내용이 추가되지 않으면 전송)
  useEffect(() => {
    if (finalizedBufferRef.current.trim() && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(processBuffer, 500);
    }
    return () => clearTimeout(timerRef.current);
  }, [displayInterim, processBuffer]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // 실시간 피드백을 위해 활성화
    recognition.lang = 'ko-KR';

    recognition.onstart = () => {
      setIsRecording(true);
      setStatusMessage('LIVE');
    };

    recognition.onresult = (event: any) => {
      let interimContent = '';
      
      // event.resultIndex부터 시작하여 "새로 들어온" 결과만 처리
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          // [핵심] 확정된 텍스트만 버퍼에 추가 (중복 방지)
          finalizedBufferRef.current += (finalizedBufferRef.current ? ' ' : '') + transcript;
        } else {
          interimContent += transcript;
        }
      }
      
      // 현재 버퍼와 중간 결과를 합쳐서 화면에 표시 (사용자 확인용)
      setDisplayInterim(finalizedBufferRef.current + interimContent);

      // [속도 최적화] 확정된 텍스트가 30자를 넘으면 타이머 기다리지 않고 즉시 전송
      if (finalizedBufferRef.current.length > 30) {
        processBuffer();
      }
    };

    // 브라우저가 인식을 중단하면 자동으로 재시작
    recognition.onend = () => {
      if (isRecording) {
        try { recognition.start(); } catch(e) {}
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    if (finalizedBufferRef.current.trim()) processBuffer();
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      {/* 헤더 */}
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-8 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-widest opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500 hover:text-white transition-all">START</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500">STOP</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100 transition-opacity">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 h-[calc(100vh-120px)]">
        {/* 왼쪽: 현재 인식 중인 텍스트 (누적 현상 해결됨) */}
        <div className="flex flex-col relative overflow-hidden">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Live Speech Input</span>
          <div className="text-4xl md:text-5xl font-black leading-tight text-white/90 break-keep">
            {displayInterim || <span className="text-zinc-900">...</span>}
          </div>
        </div>

        {/* 오른쪽: 완성된 프리젠테이션 뷰 */}
        <div className="flex flex-col overflow-hidden border-l border-white/5 pl-8">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">AI Refined View</span>
          <div className="flex-grow overflow-y-auto space-y-12 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-700 ${i === 0 ? 'opacity-100 translate-y-0' : 'opacity-10 blur-[1px] translate-y-4'}`}>
                <p className="text-3xl md:text-4xl font-bold leading-tight tracking-tighter">
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

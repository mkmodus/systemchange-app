import React, { useState, useEffect, useRef, useCallback } from 'react';
import { refineTranscription } from '../services/geminiService';
import { StorageKeys, TextBlock } from '../types';
import { db, ref, set } from '../services/firebase';

const AdminPage: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('READY');
  const [displayPending, setDisplayPending] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  
  const pendingRef = useRef(''); // 유실 방지용 고속 버퍼
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const timerRef = useRef<any>(null);

  // 초기 로드: 로컬 스토리지 데이터 복구
  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
    return () => stopRecording();
  }, []);

  // Firebase 및 로컬 스토리지 동기화
  const syncData = (newBlocks: TextBlock[]) => {
    set(ref(db, 'interpretation/blocks'), newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
  };

  // ⚡ 지능형 텍스트 보정 및 전송 함수
  const smartProcess = useCallback(async () => {
    const text = pendingRef.current.trim();
    
    // AI가 문맥을 파악하기 위한 최소 글자수(2자) 체크
    if (isProcessingRef.current || text.length < 2) return;

    // 1. 버퍼 즉시 격리 (보정 중 들어오는 음성과 분리)
    isProcessingRef.current = true;
    const snapshotText = text;
    pendingRef.current = '';
    setDisplayPending('');
    setStatusMessage('⚡ AI SYNC');

    try {
      // 2. AI 보정 호출 (25자 내외의 적정 문맥 전달)
      const refined = await refineTranscription(snapshotText);
      
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: snapshotText,
        refined: refined,
        timestamp: Date.now(),
      };

      setBlocks(prev => {
        const updated = [newBlock, ...prev].slice(0, 500);
        syncData(updated);
        return updated;
      });
    } catch (e) {
      // API 오류 시 흐름 끊김 방지를 위해 원문 즉시 전송
      const fallbackBlock = { id: `err-${Date.now()}`, original: snapshotText, refined: snapshotText, timestamp: Date.now() };
      setBlocks(prev => { const up = [fallbackBlock, ...prev]; syncData(up); return up; });
    } finally {
      isProcessingRef.current = false;
      setStatusMessage('LIVE');
    }
  }, []);

  // 🕒 최적의 타이머: 0.4초 침묵 시 "문장 마디"로 판단하여 전송
  useEffect(() => {
    if (displayPending && !isProcessingRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(smartProcess, 400); 
    }
    return () => clearTimeout(timerRef.current);
  }, [displayPending, smartProcess]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; 
    recognition.lang = 'ko-KR';

    recognition.onstart = () => {
      setIsRecording(true);
      setStatusMessage('LIVE');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          pendingRef.current += (pendingRef.current ? ' ' : '') + transcript;
          // 확정된 구절이 들어오면 대기 없이 즉시 전송
          smartProcess();
        } else {
          interim = transcript;
        }
      }
      
      const currentFullText = pendingRef.current + interim;
      setDisplayPending(currentFullText);

      // 🚀 컨텍스트 트리거: 25자 도달 시 AI에게 문맥 보정 요청 (정확도 향상 포인트)
      if (currentFullText.length > 25 && !isProcessingRef.current) {
        pendingRef.current = currentFullText;
        smartProcess();
      }
    };

    recognition.onend = () => { if (isRecording) try { recognition.start(); } catch(e) {} };
    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) recognitionRef.current.stop();
    if (pendingRef.current.trim()) smartProcess();
  };

  return (
    <div className="p-4 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
      {/* 고정 헤더 */}
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-8 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-black tracking-[0.2em] opacity-40 uppercase">{statusMessage}</span>
        </div>
        <div className="flex gap-6">
          {!isRecording ? (
            <button onClick={startRecording} className="text-[10px] font-black tracking-widest text-blue-500 hover:text-white transition-all">START SESSION</button>
          ) : (
            <button onClick={stopRecording} className="text-[10px] font-black tracking-widest text-red-500 hover:text-white transition-all">STOP SESSION</button>
          )}
          <button onClick={() => { if(confirm("초기화?")) syncData([]); setBlocks([]); }} className="text-[10px] font-black tracking-widest opacity-20 hover:opacity-100 transition-opacity">CLEAR</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 h-[calc(100vh-120px)]">
        {/* 왼쪽: 실시간 음성 수신 창 */}
        <div className="flex flex-col relative">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Raw STT Stream</span>
          <textarea
            readOnly
            value={displayPending}
            className="flex-grow bg-transparent text-4xl md:text-5xl font-black leading-tight resize-none outline-none placeholder-zinc-900 border-none scrollbar-hide"
            placeholder="..."
          />
          <div className="h-0.5 bg-zinc-900 w-full mt-4 rounded-full overflow-hidden">
             {/* 상태바를 통해 보정 주기 시각화 */}
            <div className={`h-full bg-blue-600 transition-all duration-300 ${displayPending ? 'w-full' : 'w-0'}`} />
          </div>
        </div>

        {/* 오른쪽: AI 보정 결과 창 (프리젠테이션 뷰) */}
        <div className="flex flex-col overflow-hidden">
          <span className="text-[9px] text-zinc-600 font-bold mb-4 tracking-widest uppercase">Refined Presentation</span>
          <div className="flex-grow overflow-y-auto space-y-12 scrollbar-hide pb-20">
            {blocks.map((block, i) => (
              <div key={block.id} className={`transition-all duration-700 ${i === 0 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-10 blur-[1px] translate-y-4 scale-95'}`}>
                <p className="text-3xl md:text-4xl font-bold leading-tight tracking-tighter">
                  {block.refined}
                </p>
                {i === 0 && <div className="mt-4 w-6 h-1 bg-blue-600/30 rounded-full" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

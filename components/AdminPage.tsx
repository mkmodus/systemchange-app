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
              className="w-full bg-black border border-zinc-800 rounded-2xl p-4 text-center text-

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
      syncData(updated);
      return updated;
    });

    setStatusMessage(isRecording ? '음성 수신 중...' : '대기 중');
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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [pendingText, processPendingText]);

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
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';
      recognition.onstart = () => {
        setIsRecording(true);
        setStatusMessage('음성 수신 중...');
      };
      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        }
        if (finalTranscript) setPendingText(prev => prev + (prev ? ' ' : '') + finalTranscript);
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
      const textToSave = pendingText;
      setPendingText('');
      processPendingText(textToSave);
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
              <button onClick={verifyAuth} className="flex-1 p-3 bg-blue-600 rounded-xl text-white">확인</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center bg-zinc-900 p-6

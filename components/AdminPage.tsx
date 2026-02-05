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

  // [핵심] 음성 누락 방지 로직: 전송 시작 전 데이터를 즉시 비우고 처리합니다.
  const processPendingText = useCallback(async () => {
    if (isProcessingRef.current) return;
    
    const textToProcess = pendingText.trim();
    if (!textToProcess) return;

    // 1. AI 처리 시작 전 즉시 비우기 (중요: 이 찰나에 들어오는 음성은 차곡차곡 쌓임)
    setPendingText(''); 
    isProcessingRef.current = true;
    setStatusMessage('AI 보정 및 전송 중...');
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
      // 에러 발생 시 데이터 손실을 막기 위해 원문이라도 강제 전송
      const fallbackBlock: TextBlock = {
        id: 'err-' + Date.now(),
        original: textToProcess,
        refined: textToProcess,
        timestamp: Date.now(),
      };
      setBlocks(prev => {
        const updated = [fallbackBlock, ...prev].slice(0, 500);
        syncData(updated);
        return updated;
      });
    } finally {
      setStatusMessage(isRecording ? '음성 수신 중...' : '대기 중');
      isProcessingRef.current = false;
    }
  }, [pendingText, isRecording]);

  useEffect(() => {
    const trimmedText = pendingText.trim();
    if (trimmedText && !isProcessingRef.current) {
      if (trimmedText.length > 80) {
        processPendingText();
        return;
      }

      if (timerRef.current) clearInterval(timerRef.current);
      let timeLeft = 15; // 1.5초 대기
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

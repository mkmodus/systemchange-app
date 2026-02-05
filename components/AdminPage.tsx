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

  // [개선] 음성 누락 방지를 위한 전송 로직
  const processPendingText = useCallback(async () => {
    if (isProcessingRef.current) return;
    
    const textToProcess = pendingText.trim();
    if (!textToProcess) return;

    // 1. 전송 시작 시 즉시 입력을 비움 (보정 중 들어오는 음성을 새로 받기 위함)
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
      console.error("AI 보정 오류:", error);
      // 에러 발생 시 기록 손실 방지를 위해 원문이라도 보냄 (선택 사항)
      const errorBlock: TextBlock = {
        id: 'err-' + Date.now(),
        original: textToProcess,
        refined: textToProcess,
        timestamp: Date.now(),
      };
      setBlocks(prev => {
        const updated = [errorBlock, ...prev].slice(0, 500);
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
      // 글자 수 임계치 도달 시 즉시 전송
      if (trimmedText.length > 80) {
        processPendingText();
        return;
      }

      if (timerRef.current) clearInterval(timerRef.current);
      
      let timeLeft = 15; // 약 1.5초 대기
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
    if (!SpeechRecognition) {
      setStatusMessage("인식 지원 불가");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true

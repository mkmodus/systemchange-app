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

  // 로컬 저장소 초기 데이터 로드
  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) {
      setBlocks(JSON.parse(saved));
    }
  }, []);

  // 모든 기기에 실시간 데이터를 전송하는 함수
  const syncData = (newBlocks: TextBlock[]) => {
    setBlocks(newBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(newBlocks));
    set(ref(db, 'interpretation/blocks'), newBlocks);
  };

  // [개선] 음성 누락 방지 및 보정 전송 로직
  const processPendingText = useCallback(async () => {
    if (isProcessingRef.current) return;
    
    const textToProcess = pendingText.trim();
    if (!textToProcess) return;

    // 1. AI에게 보내기 직전에 입력창을 먼저 비웁니다.
    // 이렇게 해야 AI가 연산하는 수 초 동안 들어오는 음성이 지워지지 않고 새롭게 쌓입니다.
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
      // 에러가 나더라도 기록 손실을 막기 위해 원문을 그대로 전송합니다.
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

  // 타이머 로직: 1.5초간 침묵하거나 80자가 넘으면 자동 전송
  useEffect(() => {
    const trimmedText = pendingText.trim();
    if (trimmedText && !isProcessingRef.current) {
      if (trimmedText.length > 80) {
        processPendingText();
        return;
      }

      if (timerRef.current) clearInterval(timerRef.current);
      
      let timeLeft = 15; 
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

  const verifyAuth =

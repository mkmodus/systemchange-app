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

  // 초기 로드
  useEffect(() => {
    const saved = localStorage.getItem(StorageKeys.BLOCKS);
    if (saved) setBlocks(JSON.parse(saved));
  }, []);

  // Firebase 실시간 동기화 (최적화: 직접 호출)
  const syncToFirebase = (updatedBlocks: TextBlock[]) => {
    const blocksRef = ref(db, 'interpretation/blocks');
    set(blocksRef, updatedBlocks);
    localStorage.setItem(StorageKeys.BLOCKS, JSON.stringify(updatedBlocks));
  };

  // ⚡ AI 보정 및 전송 (Express Pipeline)
  const processPendingText = useCallback(async () => {
    const textToProcess = pendingText.trim();
    if (isProcessingRef.current || textToProcess.length < 2) return;

    // 1. Snapshot 생성 후 즉시 버퍼 비우기 (음성 누락 방지 핵심)
    isProcessingRef.current = true;
    setProcessingSnapshot(textToProcess);
    setPendingText(''); 
    setCountdown(0);
    setStatusMessage('⚡ AI');

    try {
      // 2. 초저지연 AI 호출
      const refined = await refineTranscription(textToProcess);
      
      const newBlock: TextBlock = {
        id: Math.random().toString(36).substring(7),
        original: textToProcess,
        refined: refined,
        timestamp: Date.now(),
      };

      // 3. 상태 업데이트 및 전송
      setBlocks(prev => {
        const updated = [newBlock, ...prev].slice(0, 500);
        syncToFirebase(updated);
        return updated;
      });
    } catch (error) {
      console.error("Sync Error:", error);
      // 에러 발생 시 딜레이 없이 원문 노출
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

  // ⚡ 마이크로 타이머: 10자 초과 시 즉시, 0.3초 침묵 시 자동 전송
  useEffect(() => {
    const trimmed = pendingText.trim();
    if (trimmed && !isProcessingRef.current) {
      if (trimmed.length > 10) { 
        processPendingText(); 
        return; 
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      
      let timeLeft = 3


import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, Square, AlertCircle, Loader2 } from 'lucide-react';

import { ConnectionStatus, TranscriptionSegment } from './types';
import { createPcmBlob, getAudioStream, PCM_SAMPLE_RATE } from './utils/audioUtils';
import { TranscriptionList } from './components/TranscriptionList';
import { downloadCsv } from './utils/csvUtils';

const API_KEY = SYSTEMCHANGE_APP_API_KEY || '';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [segments, _setSegments] = useState<TranscriptionSegment[]>([]);
  const [currentText, setCurrentText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const segmentsRef = useRef<TranscriptionSegment[]>([]);
  const accumulatedBufferRef = useRef<string>(''); 
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const setSegments = (newSegments: TranscriptionSegment[]) => {
    segmentsRef.current = newSegments;
    _setSegments(newSegments);
  };

  const finalizeSegment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 5) return;
    
    const newSeg: TranscriptionSegment = {
      id: `seg-${Date.now()}`,
      text: trimmed,
      timestamp: new Date(),
      isFinal: true
    };
    setSegments([...segmentsRef.current, newSeg]);
  }, []);

  const stopSession = useCallback(() => {
    const finalLeftover = accumulatedBufferRef.current.trim();
    if (finalLeftover) {
      finalizeSegment(finalLeftover);
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }

    if (segmentsRef.current.length > 0) {
      downloadCsv(segmentsRef.current);
    }

    setStatus(ConnectionStatus.DISCONNECTED);
    setCurrentText('');
    accumulatedBufferRef.current = '';
  }, [finalizeSegment]);

  const startSession = async () => {
    if (!API_KEY) {
      setErrorMsg("API Key가 설정되지 않았습니다.");
      return;
    }

    setErrorMsg(null);
    setStatus(ConnectionStatus.CONNECTING);
    setSegments([]);
    setCurrentText('');
    accumulatedBufferRef.current = '';

    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const stream = await getAudioStream();
      mediaStreamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE,
      });
      await audioContext.resume();
      audioContextRef.current = audioContext;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025', 
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: `당신은 '2026 체제전환운동포럼'의 지능형 실시간 속기사입니다. 정책 비판 및 시민사회 성명을 실시간으로 텍스트화합니다.

          핵심 교정 및 표기 지침:
          1. 고위험 오인식 단어 강제 교정: 
             - '규율(discipline/rule)' (교율 X)
             - '가늠하게(measure/estimate)' (간음 X)
             - '방기하고(neglect/abandon)' (반기 X)
             - '제고(enhance/improve)' (재고 X)
             - '졸속(hasty/crude)' (졸속 O)
          
          2. 용어 및 문장 부호:
             - 주요 개념어인 ‘영향받는 자’는 반드시 홑따옴표(‘ ’)를 사용하십시오.
             - 나열되는 항목이나 문장 중간의 휴지기에는 쉼표(,)를 적극적으로 사용하여 실제 낭독의 호흡을 살리십시오.
             - '국가인공지능전략위원회', '인공지능 행동계획' 등 고유명사는 띄어쓰기를 포함하여 정확히 표기하십시오.
          
          3. 형태 및 정제:
             - 모든 문장은 "~다.", "~요."와 같이 완결된 문장으로 끝맺으십시오.
             - '어', '그', '음' 등 의미 없는 소리는 완벽히 제거하십시오.
             - 정책/법률 용어가 포함된 전문적인 톤을 유지하십시오.`,
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            const source = audioContext.createMediaStreamSource(stream);
            const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(console.error);
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text || '';
              
              if (text) {
                const combined = accumulatedBufferRef.current + text;
                const sentenceEndRegex = /[.!?](\s|$)|([다요])(\s|$)/g;
                const matches = Array.from(combined.matchAll(sentenceEndRegex)) as RegExpExecArray[];

                if (matches.length > 0) {
                  const lastMatch = matches[matches.length - 1];
                  const splitIndex = lastMatch.index + lastMatch[0].trim().length;
                  
                  const toFinalize = combined.substring(0, splitIndex).trim();
                  const remaining = combined.substring(splitIndex);

                  if (toFinalize.length >= 15) {
                    finalizeSegment(toFinalize);
                    accumulatedBufferRef.current = remaining;
                    setCurrentText(remaining.trim());
                  } else {
                    accumulatedBufferRef.current = combined;
                    setCurrentText(combined.trim());
                  }
                } else if (combined.length > 120) {
                  const lastSpaceIdx = combined.lastIndexOf(' ');
                  const splitIdx = lastSpaceIdx > 80 ? lastSpaceIdx : 110;
                  
                  finalizeSegment(combined.substring(0, splitIdx));
                  const rest = combined.substring(splitIdx);
                  accumulatedBufferRef.current = rest;
                  setCurrentText(rest.trim());
                } else {
                  accumulatedBufferRef.current = combined;
                  setCurrentText(combined.trim());
                }
              }
            }

            if (message.serverContent?.turnComplete) {
              const leftover = accumulatedBufferRef.current.trim();
              if (leftover.length >= 5) {
                finalizeSegment(leftover);
              }
              accumulatedBufferRef.current = '';
              setCurrentText('');
            }
          },
          onclose: () => {
            if (status === ConnectionStatus.CONNECTED) setStatus(ConnectionStatus.DISCONNECTED);
          },
          onerror: (err) => {
            console.error("API Error:", err);
            setErrorMsg("음성 인식 연결이 원활하지 않습니다.");
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err) {
      console.error("Init Error:", err);
      setErrorMsg("마이크 접근 권한을 확인해주세요.");
      setStatus(ConnectionStatus.ERROR);
    }
  };

  const handleToggle = () => {
    if (status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING) {
      stopSession();
    } else {
      startSession();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#040A1D] text-slate-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      <header className="flex-none p-5 border-b border-slate-800/50 bg-[#040A1D]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="bg-white p-2 rounded shadow-lg">
            <img 
              src="https://cdn.prod.website-files.com/6560be4e64c0b2220d95cecc/6560c9eba1fb7d6fee624fdd_img_logo_top_120px.svg" 
              alt="Logo" 
              className="h-6 w-auto object-contain"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black tracking-tight border transition-all ${
              status === ConnectionStatus.CONNECTED 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-slate-800 text-slate-500 border-slate-700'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                status === ConnectionStatus.CONNECTED ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'
              }`} />
              {status === ConnectionStatus.CONNECTED ? '문자통역 중' : '대기 중'}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative w-full mx-auto overflow-hidden">
        {errorMsg && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-red-600 text-white rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in zoom-in-95">
            <AlertCircle className="w-5 h-5" />
            <span className="font-bold text-sm">{errorMsg}</span>
          </div>
        )}
        <TranscriptionList segments={segments} currentText={currentText} />
      </main>

      <footer className="flex-none p-5 bg-[#040A1D]/98 backdrop-blur-3xl border-t border-slate-800/50 z-40">
        <div className="max-w-5xl mx-auto flex flex-col items-center gap-2">
          <button
            onClick={handleToggle}
            disabled={status === ConnectionStatus.CONNECTING}
            className={`
              relative group flex items-center justify-center gap-2 px-10 py-3.5 rounded-full font-black text-lg transition-all transform active:scale-95 shadow-xl
              ${status === ConnectionStatus.CONNECTED
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                : 'bg-white text-slate-900 hover:bg-slate-100 shadow-white/5'
              }
              ${status === ConnectionStatus.CONNECTING ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            {status === ConnectionStatus.CONNECTING ? (
               <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            ) : status === ConnectionStatus.CONNECTED ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>통역 중지</span>
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                <span>문자통역 시작</span>
              </>
            )}
          </button>
          <p className="text-slate-600 text-[10px] font-bold tracking-widest uppercase">
             2026 체제전환운동포럼 지능형 문자통역 시스템
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;

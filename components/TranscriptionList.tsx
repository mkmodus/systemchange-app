
import React, { useEffect, useRef } from 'react';
import { TranscriptionSegment } from '../types';

interface TranscriptionListProps {
  segments: TranscriptionSegment[];
  currentText: string;
}

export const TranscriptionList: React.FC<TranscriptionListProps> = ({ segments, currentText }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [segments, currentText]);

  return (
    <div 
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-6 scrollbar-hide flex flex-col"
    >
      <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col justify-center py-10 space-y-6">
        
        {/* 대기 화면 */}
        {segments.length === 0 && !currentText && (
          <div className="flex flex-col items-center justify-center space-y-5 animate-in fade-in duration-1000">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-[2.5px] border-slate-800 border-t-blue-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-ping" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-black text-slate-200 tracking-tighter">
                2026 체제전환운동포럼
              </h2>
              <p className="text-sm font-bold text-slate-500 animate-pulse">
                현장의 발언을 기다리고 있습니다.
              </p>
            </div>
          </div>
        )}

        {/* 확정된 문장 (절반 크기 조정: text-xl ~ text-2xl) */}
        <div className="flex flex-col space-y-6">
          {segments.map((segment) => (
            <div 
              key={segment.id} 
              className="animate-in fade-in slide-in-from-bottom-6 duration-1000 ease-out flex justify-center"
            >
              <div className="w-full bg-slate-800/25 p-6 md:p-10 rounded-[2rem] border border-slate-700/30 hover:border-slate-700/50 hover:bg-slate-800/40 transition-all group shadow-xl">
                <p className="text-slate-100 text-xl md:text-2xl leading-[1.5] font-black break-keep tracking-tight text-center">
                  {segment.text}
                </p>
                <div className="flex justify-center mt-4 opacity-0 group-hover:opacity-30 transition-opacity">
                  <span className="px-3 py-1 bg-slate-700/50 rounded-full text-[10px] font-mono font-bold tracking-wider text-slate-400">
                    {segment.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 실시간 조합 중인 문장 (글자 크기 축소: text-lg) */}
        {currentText && currentText.length >= 10 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 w-full py-10 flex flex-col items-center justify-center">
            <div className="flex items-center gap-3 mb-6 opacity-30">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
              </div>
              <p className="text-[10px] text-blue-400 font-black uppercase tracking-[0.4em]">문장 분석 중</p>
            </div>
            <p className="text-blue-200/40 text-lg md:text-xl leading-[1.6] font-bold tracking-tight break-keep text-center italic max-w-2xl">
              {currentText}
            </p>
          </div>
        )}
      </div>
      
      <div className="h-[25vh] flex-none" />
    </div>
  );
};

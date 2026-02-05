import React, { useState, useEffect } from 'react';
import { TextBlock } from '../types';
// [추가] Firebase 연결 도구 가져오기
import { db, ref, onValue } from '../services/firebase';

const PresentationPage: React.FC = () => {
  const [blocks, setBlocks] = useState<TextBlock[]>([]);

  useEffect(() => {
    // 1. Firebase 데이터베이스에서 통역 데이터가 저장된 경로('interpretation/blocks')를 지정합니다.
    const blocksRef = ref(db, 'interpretation/blocks');

    // 2. onValue 함수는 데이터베이스의 값이 변경될 때마다 실시간으로 실행됩니다.
    // 이전의 localStorage나 setInterval(폴링) 방식보다 훨씬 빠르고 효율적입니다.
    const unsubscribe = onValue(blocksRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // 데이터가 있으면 상태를 업데이트합니다.
        setBlocks(data);
      } else {
        // 데이터가 비어있으면(초기화 등) 빈 배열로 설정합니다.
        setBlocks([]);
      }
    });

    // 3. 컴포넌트가 사라질 때(언마운트) 실시간 감시를 중단하여 메모리 낭비를 방지합니다.
    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen pt-12 max-w-5xl mx-auto px-6">
      <div className="flex flex-col space-y-12 pb-32">
        {blocks.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center space-y-6 opacity-50">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-2xl font-light text-center">
              2026 체제전환운동포럼<br/>
              <span className="text-lg opacity-70">실시간 통역이 시작되기를 기다리고 있습니다...</span>
            </p>
          </div>
        ) : (
          blocks.map((block, index) => (
            <div 
              key={block.id} 
              className={`transition-all duration-1000 ease-out ${
                index === 0 ? 'opacity-100 scale-100' : 'opacity-30 scale-95 blur-[1px]'
              }`}
            >
              <div className="relative">
                {index === 0 && (
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-2 h-16 bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.6)] animate-pulse" />
                )}
                <p className={`text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.3] md:leading-[1.4] tracking-tight`}>
                  {block.refined}
                </p>
                <div className="mt-6 flex items-center gap-4 text-zinc-600">
                   <div className="h-px flex-grow bg-zinc-900" />
                   <span className="text-sm font-mono tracking-widest">
                     {new Date(block.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                   </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* 하단 상태 표시바 */}
      <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black via-black/95 to-transparent z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-zinc-500 text-[10px] md:text-xs uppercase tracking-[0.2em] font-medium">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${blocks.length > 0 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-zinc-800 animate-pulse'}`} />
            <span className={blocks.length > 0 ? 'text-zinc-300' : ''}>
              {blocks.length > 0 ? 'LIVE STREAM CONNECTED' : 'WAITING FOR CONNECTION'}
            </span>
          </div>
          <div className="hidden sm:block">2026 SYSTEM CHANGE FORUM • TEXT INTERPRETATION</div>
        </div>
      </div>
    </div>
  );
};

export default PresentationPage;

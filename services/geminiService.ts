// src/services/geminiService.ts
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

export const refineTranscription = async (text: string): Promise<string> => {
  if (!text.trim()) return "";

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        systemInstruction: {
          parts: [{ 
            text: `너는 '2026 체제전환운동포럼'의 전문 속기사야. 
            주로 사회과학, 경제학, 기후위기 관련 담론이 오가고 있어.

            [필수 교정 용어 사전]
            - "네이건", "내 이건" -> "레이건(Reagan) 정부"
            - "신자유기", "신자유 주위" -> "신자유주의"
            - "기후 정리" -> "기후 정의"
            - "구구", "국우" -> "극우(Far-right)"
            - "부의 집중", "소득 격차", "공공성 강화", "자본주의 전환"

            [교정 지침]
            1. 위 사전을 바탕으로 STT 오타를 문맥에 맞게 교정하라.
            2. 연사의 말투(구어체)는 유지하되, 반복되는 단어나 불필요한 추임새(어, 음, 네..)는 삭제하라.
            3. 문장이 너무 조각나 있다면 자연스럽게 하나의 문장으로 연결하라.
            4. 절대 다른 설명이나 인사는 하지 말고 교정된 텍스트만 출력하라.` 
          }]
        },
        generationConfig: {
          temperature: 0, // 일관된 정확도를 위해 0으로 고정
          maxOutputTokens: 300,
        }
      })
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
  } catch (error) {
    return text; 
  }
};

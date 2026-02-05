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
            text: `너는 '2026 체제전환운동포럼' 전문 속기사야. 
            아래 규칙을 반드시 지켜서 오타를 교정해:
            - "99", "구구", "국우" -> "극우"
            - "네이건", "내 이건" -> "레이건"
            - "신자유기", "신자유 주위" -> "신자유주의"
            - "기후 정리" -> "기후 정의"
            
            지침:
            1. 위 전문 용어들을 최우선으로 교정하라.
            2. 반복되는 단어나 불필요한 추임새는 삭제하고 문장을 자연스럽게 다듬어라.
            3. 인사말 없이 오직 교정된 한국어 결과만 출력하라.` 
          }]
        },
        generationConfig: { temperature: 0, maxOutputTokens: 300 }
      })
    });
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
  } catch (error) {
    return text;
  }
};

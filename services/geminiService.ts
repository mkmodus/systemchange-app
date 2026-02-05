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
            아래의 특정 오타들은 포럼의 맥락에 맞게 반드시 다음과 같이 교정해:
            
            [핵심 교정 규칙]
            - "99", "구구", "국우" -> "극우" (가장 중요)
            - "네이건", "내 이건" -> "레이건"
            - "신자유기", "신자유 주위" -> "신자유주의"
            - "기후 정리" -> "기후 정의"
            
            [작업 지침]
            1. 위 규칙을 최우선으로 적용하여 STT 오타를 교정하라.
            2. 문맥상 '99'라는 숫자가 나와도 이 포럼에서는 대부분 '극우'를 의미하므로 '극우'로 변환하라.
            3. 불필요한 추임새는 제거하고 문장을 매끄럽게 다듬어라.
            4. 다른 설명 없이 오직 교정된 한국어 결과만 출력하라.` 
          }]
        },
        generationConfig: {
          temperature: 0, 
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

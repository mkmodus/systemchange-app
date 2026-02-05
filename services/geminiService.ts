// src/services/geminiService.ts

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// 속도가 가장 빠른 gemini-1.5-flash 모델을 사용합니다.
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

export const refineTranscription = async (text: string): Promise<string> => {
  if (!text.trim()) return "";

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: text }]
          }
        ],
        // 시스템 지침을 최소화하여 AI의 생각 시간을 줄입니다.
        systemInstruction: {
          parts: [{ 
            text: "너는 실시간 문자통역 오타 교정기야. 설명, 인사, 따옴표 없이 오직 교정된 한국어 결과만 출력해. 원문이 완벽하면 그대로 출력해." 
          }]
        },
        generationConfig: {
          temperature: 0,       // 창의성을 0으로 설정하여 즉각적인 응답 유도
          maxOutputTokens: 150, // 응답 길이를 제한하여 전송 속도 향상
          topP: 1,
          topK: 1
        }
      })
    });

    if (!response.ok) {
      throw new Error(`API response error: ${response.status}`);
    }

    const data = await response.json();
    
    // API 응답 구조에서 텍스트 데이터 추출
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      return data.candidates[0].content.parts[0].text.trim();
    }
    
    return text; // 응답 형식이 예상과 다를 경우 원본 반환
  } catch (error) {
    console.error("Gemini API Error:", error);
    // 에러 발생 시 대기 시간을 없애기 위해 원문을 즉시 반환하여 흐름을 유지합니다.
    return text; 
  }
};

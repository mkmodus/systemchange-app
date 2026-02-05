// src/services/geminiService.ts

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// 속도가 가장 빠른 1.5-flash 모델을 사용합니다.
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

export const refineTranscription = async (text: string) => {
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
        // 시스템 지침을 메시지 안에 포함하여 처리 속도를 극대화합니다.
        systemInstruction: {
          parts: [{ text: "너는 실시간 문자통역 오타 교정기야. 설명, 인사, 따옴표 없이 오직 교정된 한국어 결과만 출력해. 원문이 완벽하면 그대로 출력해." }]
        },
        generationConfig: {
          temperature: 0,       // AI의 고민 시간을 0으로 설정
          maxOutputTokens: 100, // 응답 길이를 제한하여 전송 속도 향상
          topP: 1,
          topK: 1
        }
      })
    });

    if (!response.ok) {
      throw new Error(`API call failed with status ${response.status}`);
    }

    const data = await response.json();
    
    // API 응답에서 정제된 텍스트 추출
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text.trim();
    }
    
    return text; // 형식이 예외적일 경우 원문 반환
  } catch (error) {
    console.error("Gemini REST API Error:", error);
    return text; // 에러 발생 시 딜레이 방지를 위해 원문을 즉시 반환
  }
};

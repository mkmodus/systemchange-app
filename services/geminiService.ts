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
            아래 핵심 용어들을 참고해 오타를 정확히 교정해:
            [레이건 정부, 신자유주의, 기후정의, 공공성, 부의 격차, 소득 집중, 자본주의].
            말투는 정중한 평어체로 다듬고, 불필요한 추임새(네, 어...)는 삭제해.
            결과만 한국어로 출력하고 설명은 하지 마.` 
          }]
        },
        generationConfig: {
          temperature: 0, // 정확도와 일관성을 위해 0으로 고정
          maxOutputTokens: 150,
          topP: 1,
          topK: 1
        }
      })
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
  } catch (error) {
    return text; // 에러 시 원문 유지
  }
};

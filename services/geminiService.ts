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
            [핵심 용어: 체제전환, 신자유주의, 레이건 정부, 기후정의, 공공성, 부의 격차, 소득 집중]. 
            위 용어들과 문맥을 고려하여 STT 오타를 교정해줘. 
            인사말이나 설명 없이 오직 교정된 한국어 결과만 출력하고, 문장이 자연스럽게 이어지도록 다듬어.` 
          }]
        },
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 200,
          topP: 1,
          topK: 1
        }
      })
    });

    const data = await response.json();
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      return data.candidates[0].content.parts[0].text.trim();
    }
    return text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return text; 
  }
};

// src/services/geminiService.ts 수정

import { GoogleGenerativeAI } from "@google/genai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

// 1.5 Flash 모델 사용 (Pro보다 훨씬 빠름)
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  // 시스템 지침을 극한으로 압축 (AI의 읽기 시간 단축)
  systemInstruction: "너는 실시간 문자통역 오타 교정기야. 설명, 인사, 따옴표 없이 오직 교정된 한국어 결과만 출력해. 원문이 완벽하면 그대로 출력해.",
});

export const refineTranscription = async (text: string) => {
  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        temperature: 0.0, // 창의성 제거 (속도 향상)
        topP: 1,
        topK: 1,
        maxOutputTokens: 60, // 응답 길이를 제한하여 연산량 감소
        candidateCount: 1,
      },
    });
    
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Gemini Error:", error);
    return text; // 에러 시 원문 즉시 반환 (딜레이 방지)
  }
};

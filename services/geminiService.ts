
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

export const refineTranscription = async (rawText: string): Promise<string> => {
  if (!rawText.trim()) return "";
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `원문: ${rawText}`,
      config: {
        systemInstruction: `당신은 '2024 체제전환운동포럼: 우리의 대안을 조직하자'의 전문 문자 통역사입니다. 
입력되는 텍스트는 실시간 음성 인식(STT) 결과물로, 포럼의 맥락에 맞는 전문 용어 교정이 필수적입니다.

[포럼 핵심 맥락 및 용어 교정 지침]
1. 주제어 교정: 
   - '최대 전환', '체제 전환' -> '체제전환'으로 통일.
   - '주거권', '가족구성권', '공공임대', '공공선매권', '젠트리피케이션', '홈리스', '쪽방'.
   - '기후정의', '공공재생에너지', '탄소중립', '농생태학', '식량주권', '스마트팜'.
   - '불안정노동', '플랫폼노동', '신자유주의', '능력주의', '성별분업', '사회재생산', '생명정치'.
   - '반전평화', '탈냉전', '비핵지대화', '나토(NATO)', '캠프 데이비드'.
2. 문체 정제: 
   - 학술적이고 분석적인 포럼의 톤앤매너를 유지하십시오.
   - 청각장애인이 맥락을 놓치지 않도록 비문이나 끊긴 문장을 자연스럽게 연결하십시오.
3. 제약 사항:
   - 한 블록은 최대 3문장 이내의 완성된 문태로 만드십시오.
   - 원문의 의도를 왜곡하지 마십시오.
   - 결과물에는 정제된 텍스트만 포함하십시오 (설명이나 인사말 절대 금지).`,
        temperature: 0.1,
      },
    });

    return response.text?.trim() || rawText;
  } catch (error) {
    console.error("Gemini refinement failed:", error);
    return rawText; 
  }
};

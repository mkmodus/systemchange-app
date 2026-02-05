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
            text: `너는 '2026 체제전환운동포럼'의 전문 기록사야. 
            문맥상 다음 용어들이 STT 오타로 들어오면 아래와 같이 반드시 교정해:
            - "네이건", "내 이건" -> "레이건 (Reagan)"
            - "신자유기", "신자유 주위" -> "신자유주의"
            - "기후 정리" -> "기후 정의"
            - "부의 격차", "소득 집중", "공공성", "자본주의 전환"
            
            지침:
            1. 입력된 텍스트의 오타를 위 용어 중심으로 교정해.
            2. 구어체(추임새, 반복어)를 자연스러운 문장으로 정돈해.
            3. 인사말이나 "교정 결과입니다" 같은 부연 설명은 절대 하지 마.
            4. 오직 교정된 한국어 결과값만 출력해.` 
          }]
        },
        generationConfig: {
          temperature: 0.1, // 약간의 유연성을 주어 문맥 파악 능력 향상
          maxOutputTokens: 250,
          topP: 0.9,
          topK: 40
        }
      })
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
  } catch (error) {
    return text;
  }
};

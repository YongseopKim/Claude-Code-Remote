# AskUserQuestion Escape+Inject Design

**Goal:** Telegram에서 AskUserQuestion에 응답하면, Escape로 TUI를 dismiss하고 답변을 prompt에 inject하여 Claude에 전달

**Architecture:** Escape dismiss (tmux send-keys Escape) -> wait -> text inject (tmux send-keys 'text' Enter)

## Background

- AskUserQuestion TUI는 자체 입력 핸들러로 tmux send-keys 직접 상호작용 불가
- tmux send-keys Escape는 TUI의 "Esc to cancel"을 트리거하여 dismiss 가능 (실험 검증)
- Dismiss 후 prompt가 깨끗한 상태로 복귀, 텍스트 inject 가능 (기존 검증)

## Tasks

1. controller-injector.js - dismissAndInject 메서드 추가
2. build-permission-data.js - questionOptions 데이터 추출
3. telegram.js - 세션에 질문 데이터 저장 + 다중 질문 표시
4. parse-question-reply.js - 옵션 번호->라벨 변환, dismiss-inject 타입
5. webhook.js - dismissAndInject 사용
6. 전체 테스트 통과 확인

Project Specification: Virtual DOM & Diff Algorithm 학습용 구현

1. 프로젝트 개요 및 목적
   이 프로젝트의 핵심은 React의 Virtual DOM(VDOM)과 Diff 알고리즘의 동작 원리를 Vanilla JS로 직접 구현하며 깊이 있게 학습하는 것입니다.
   - 최종 목표: 구현된 코드를 바탕으로 Top-down 방식의 학습을 수행하며, 기술 면접에서 Virtual DOM의 메커니즘을 완벽하게 설명할 수 있는 수준에 도달함.
   - 에이전트의 역할: \* 단순히 작동하는 코드를 주는 것을 넘어, '왜(Why)' 이 방식을 선택했는지, '작동 원리', **'장단점'**을 코드 내 주석과 설명으로 상세히 제공할 것.
     - 내가 나중에 직접 구현할 수 있도록 논리적 흐름이 명확한 코드를 작성할 것.

2. 시스템 가이드라인 (에이전트 필수 준수 사항)
   - 상세 주석 (Deep Documentation): 모든 핵심 함수와 로직에 다음 내용을 주석으로 포함하세요.
     - @description: 이 함수/로직이 해결하려는 문제.
     - @logic: 내부 작동 원리 (단계별 설명).
     - @performance: 이 방식이 실제 DOM 조작보다 왜 유리한지(혹은 불리한지), Reflow/Repaint 관점에서 설명.
     - @interview_tip: 이 부분과 관련해 면접에서 나올 수 있는 질문과 답변 포인트.
   - 기술 스택: 외부 라이브러리 없이 Vanilla Javascript, HTML, CSS만 사용합니다.
   - 코드 품질: 가독성을 최우선으로 하며, 실제 포트폴리오에 활용 가능한 수준의 정갈한 코드를 유지합니다.

3. 구현 상세 요구사항
   3-1. Core logic
   3-1-1. DOM to VDOM Converter (vdom.js):
   - 실제 브라우저 DOM 트리(Element, Text Node 등)를 읽어 Javascript 객체 형태의 Virtual DOM으로 변환하는 함수를 구현합니다.

   3-1-2. Diff Algorithm (diff.js):
   - 이전 VDOM과 새로운 VDOM을 비교하여 변경 사항(Patch)의 리스트를 생성합니다.
   - 5가지 핵심 케이스 처리:
     - 노드 타입이 바뀐 경우 (태그 교체)
     - 속성(Attribute)이 변경되거나 추가/삭제된 경우
     - 텍스트 내용이 변경된 경우
     - 자식 노드가 추가된 경우
     - 자식 노드가 삭제된 경우

   3-1-3. Patch & Render:
   - Diff 결과를 바탕으로 최소한의 실제 DOM 조작만 수행하여 화면을 업데이트합니다.

   3-2. Web UI & Features
   3-2-1. Dual Viewport: "실제 영역(Live View)"과 사용자가 코드를 수정할 수 있는 "테스트 영역(Edit View)"을 구분합니다.
   3-2-2. Patch Mechanism: 'Patch' 버튼 클릭 시 Edit View -> New VDOM -> Diff -> Patch to Live View 프로세스가 실행되어야 합니다.
   3-2-3. State History (Time Travel): \* 변경될 때마다 VDOM 상태를 스택에 저장합니다.
   - '뒤로가기/앞으로가기'버튼으로 과거 상태를 복구하며, 이때 "실제 영역"과 "테스트 영역"이 동기화되어야 합니다.

4. 중점 학습 및 인터뷰 체크리스트
   에이전트는 아래 개념들이 코드 구현에 어떻게 녹아있는지 명확히 설명해야 합니다.
   - 브라우저에서 DOM을 다루는 방법(Document, Window)
   - 실제 DOM의 변화를 감지 하기 위한 브라우저 API
   - 실제 DOM이 느린 이유 (Reflow / Repaint 관점)
   - Virtual DOM의 구조와 필요한 이유
   - Diff 알고리즘의 동작방식, 최소 변경을 찾기 위한 5가지 핵심 케이스, 실제 DOM에 반영하는 방법
   - React에서 실제 DOM을 변경할 때, Virtual DOM과 Diff 알고리즘의 동작 방식
   - Virtual DOM의 본질: VDOM이 단순히 '빠른' 것이 아니라 'UI를 상태로 관리하게 해주는 추상화'라는 점
   - Heuristic Diffing: React가 O(n^3) 알고리즘을 어떻게 O(n)에 가깝게 해결했는지에 대한 통찰

5. 단계별 실행 계획 (Action Plan)
   Step 1: 프로젝트 폴더 구조 설계 및 index.html, style.css 기본 레이아웃 작성.
   Step 2: vdom.js 구현 (DOM -> 객체화 로직).
   Step 3: diff.js 구현 (가장 중요한 비교 로직 및 주석 작성).
   Step 4: app.js에서 전체 흐름 제어 및 History 기능 구현.
   Step 5: 엣지 케이스 테스트 및 최종 리팩토링.

# 가상 DOM 비교 실습장

Vanilla JavaScript로 Virtual DOM, Diff, Patch, Snapshot Flow를 직접 따라가며 학습하는 프로젝트입니다.  
브라우저의 실제 DOM을 바로 수정하지 않고, 먼저 자바스크립트 객체 형태의 VDOM 스냅샷을 만든 뒤 비교하고, 마지막에 필요한 DOM 조작만 실행하는 흐름을 눈으로 확인할 수 있게 구성했습니다.

## 프로젝트 목표

- 실제 DOM과 Virtual DOM의 차이를 코드 수준에서 이해하기
- `DOM -> VNode -> diff -> patch` 흐름을 직접 구현해 보기
- "스냅샷 방식" 상태 관리가 왜 중요한지 체감하기
- 면접에서 Virtual DOM, Reflow/Repaint, 최소 DOM 업데이트를 설명할 수 있는 수준까지 가기

## Web demo flow diagram
graph TD
    subgraph "UI & State"
        E[편집 영역<br/>Edit View HTML]
        L[라이브 영역<br/>Live View DOM]
        H[(히스토리 스택<br/>VNode Snapshots)]
    end

    subgraph "app.js (Core Controller)"
        Start(사용자: '패치 적용' 클릭) --> Read[1. 편집 영역 HTML 읽기]
    end

    subgraph "src/core/vdom.js"
        Read --> ToVNode[2. vdom.js<br/>HTML -> newVNode 변환]
    end

    subgraph "src/core/diff.js"
        ToVNode --> Diff[3. diff.js<br/>diff(oldVNode, newVNode)<br/>비교 및 패치 목록 생성]
    end

    subgraph "src/core/patch.js"
        Diff --> Patch[4. patch.js<br/>applyPatches(RealDOM, patches)<br/>실제 DOM 업데이트]
    end

    Patch --> L
    Patch --> Save[5. 새 스냅샷 히스토리 저장]
    Save --> H

## 현재 구현 범위

- `vdom.js`
  - HTML 문자열을 단일 루트 `VNode` 트리로 변환
  - 공백 전용 text node와 comment node는 무시
- `diff.js`
  - `REPLACE`, `PROPS`, `TEXT`, `INSERT`, `REMOVE` 5가지 patch 생성
  - 재귀 기반 자식 노드 비교
- `patch.js`
  - path 기반 실제 DOM 탐색
  - patch 타입별 브라우저 DOM API 호출
  - `VNode -> 실제 DOM` 복원 헬퍼 포함
- `app.js`
  - 초기 렌더링
  - Patch 버튼 기반 snapshot flow 실행
  - Patch Log 출력
  - Undo / Redo 시간 여행
  - Reset으로 초기 상태 복구

## 핵심 개념

### 1. VDOM은 무엇인가?

브라우저의 복잡한 실제 DOM 노드를 바로 다루지 않고, 비교하기 쉬운 자바스크립트 객체로 옮긴 "설계도"입니다.

예시:

```html
<section class="card">
  <h1>안녕</h1>
</section>
```

```js
{
  type: "element",
  tagName: "section",
  props: { class: "card" },
  children: [
    {
      type: "element",
      tagName: "h1",
      props: {},
      children: [{ type: "text", value: "안녕" }]
    }
  ]
}
```

### 2. Snapshot Flow

이 프로젝트의 핵심 흐름은 아래 순서입니다.

1. Edit View의 HTML을 읽는다.
2. 새 HTML을 `newVNode`로 만든다.
3. 이전 `oldVNode`와 비교해 `patches`를 만든다.
4. `patches`를 실제 DOM에 적용한다.
5. 성공한 상태를 history 스택에 저장한다.

즉, 비싼 실제 DOM 공사 전에 메모리 안에서 먼저 "설계도 비교"를 하는 방식입니다.

## 실행 방법

빌드 도구 없이 브라우저에서 바로 열 수 있습니다.

1. 프로젝트 루트의 `index.html`을 브라우저로 엽니다.
2. 오른쪽 편집 영역의 HTML을 수정합니다.
3. 상단 `패치 적용` 버튼을 눌러 비교 결과를 확인합니다.
4. `되돌리기`, `다시 실행`, `초기화`로 상태 변화를 실험합니다.

## 사용 방법

### 패치 적용

- 편집 영역의 HTML을 수정합니다.
- `패치 적용`을 누르면:
  - 새 VDOM 생성
  - 이전 VDOM과 diff
  - 실제 DOM patch
  - Patch Log 기록
  - History 저장
  순서로 실행됩니다.

### 시간 여행

- `되돌리기`: 이전 스냅샷으로 복구
- `다시 실행`: 다음 스냅샷으로 복구
- 복구 시 `Live View`와 `Edit View`가 함께 되돌아갑니다.

## 폴더 구조

```text
.
├── index.html
├── style.css
├── specification.md
└── src
    ├── app.js
    └── core
        ├── vdom.js
        ├── diff.js
        └── patch.js
```

## 파일 역할

- `src/core/vdom.js`
  - 실제 DOM/HTML을 VDOM 객체로 변환
- `src/core/diff.js`
  - old/new VDOM 비교 후 patch 목록 생성
- `src/core/patch.js`
  - patch 목록을 실제 DOM 조작으로 실행
- `src/app.js`
  - 전체 앱 흐름 제어
  - 초기화, 상태 저장, 패치 실행, 히스토리 복구 담당

## 학습 포인트

- 왜 실제 DOM 조작은 비싼가?
  - Reflow / Repaint 가능성 때문
- 왜 VDOM이 필요한가?
  - UI를 비교 가능한 데이터로 바꿀 수 있기 때문
- 왜 상태 관리가 중요한가?
  - 이전 상태를 저장해야 undo/redo와 디버깅이 가능하기 때문
- 왜 path가 중요한가?
  - 실제 DOM 트리에서 수정할 정확한 위치를 찾기 위해서

## 현재 제한 사항

- key 기반 고급 diff는 구현하지 않았습니다.
- 자식 비교는 학습용 단순 인덱스 기반입니다.
- Edit View는 반드시 단일 루트 HTML을 유지해야 합니다.
- 자동 테스트는 아직 없고, 현재는 브라우저 수동 확인 중심입니다.

## 추천 실험

아래 순서대로 바꿔 보면 patch 타입이 잘 보입니다.

1. 텍스트만 바꾸기 -> `TEXT`
2. `class`, `data-*` 속성 바꾸기 -> `PROPS`
3. 태그 이름 바꾸기 -> `REPLACE`
4. 리스트 항목 추가하기 -> `INSERT`
5. 리스트 항목 삭제하기 -> `REMOVE`

## 참고

- 상세 요구사항은 `specification.md`에 정리되어 있습니다.
- 각 핵심 함수에는 `@description`, `@logic`, `@performance`, `@interview_tip` 주석을 달아 학습용 가이드를 남겨 두었습니다.

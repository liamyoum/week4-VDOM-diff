// vdom.js 파일은 "무겁고 복잡한 실제 DOM 노드를, 가볍고 단순한 JS 객체로 변환하는 번역기"
// HTML 코드를 input으로 받고, Diffing을 위해 필요한 스냅샷(Vnode, JS 객체) 2개로 변환해서 return

// 우리가 만들 결과물(Vnode)은 어떤 모양이어야 하는지 에디터에게 알려주는 친절한 설명서
/**
 * @typedef {Object} VNode "내가 지금부터 VNode라는 이름의 객체(Object) 도면을 정의(typedef)할게!"
 * @property {"element" | "text"} type "이 객체 안에는 type이라는 속성(property)이 들어가야 해. 그리고 그 값은 무조건 'element' 아니면 'text' 둘 중 하나만 올 수 있어."
 * @property {string} [tagName] 여기서 대괄호 [ ]가 핵심입니다. "이 속성은 있을 수도 있고 없을 수도 있어(선택적)"*라는 뜻
 * @property {Record<string, string>} [props] { "class": "btn", "id": "box" }처럼 "키(Key)도 문자(string)이고, 값(Value)도 문자(string)인 객체
 * @property {VNode[]} [children] children은 VNode 객체들이 여러개 담겨 있는 상자임. 실제 객체 생김새를 보면 이해감
 * @property {string} [value] 이 객체가 글자(Text Node)일 때만 사용됨. 글자는 자기 밑에 자식이 없으니, children 대신 자기의 내용인 value를 가지는 것
 */

/**
 * 1. 작동 원리: 브라우저가 발급하는 '신분증 번호' 🪪
 * 우리가 브라우저에게 <div id="box">안녕 </div>라는 HTML을 주면, 브라우저는 이 문자열을 분석해서 트리 구조(DOM)를 만듭니다.
 * 이때 브라우저는 각 요소가 '어떤 종류인지' 구분하기 위해 노드마다 고유한 신분증 번호(nodeType)를 부여합니다.
 * 이 번호는 웹 표준으로 전 세계 모든 브라우저에 똑같이 약속되어 있습니다.
 * 1 (ELEMENT_NODE): HTML 태그들입니다. (<div>, <h1>, <p>, <span> 등)
 * 3 (TEXT_NODE): 태그 안에 들어있는 순수한 글자들입니다. ("안녕", 공백, 엔터키 등)
 * 8 (COMMENT_NODE): 개발자가 남겨둔 주석입니다. (``)
 * 즉, 브라우저는 내부적으로 <div>를 보면 "아, 너는 1번 타입이구나!", "안녕"을 보면 "너는 3번 타입이구나!" 하고 꼬리표를 붙여두는 것이죠.
 *
 * 만약 이 변수들이 없었다면, 우리 코드의 핵심 엔진 부분은 이렇게 생겼을 겁니다
 * // 변수를 안 썼을 때 (나쁜 예)
  if (domNode.nodeType === 3) { 
    return { type: "text", value: ... }; 
  }
  if (domNode.nodeType === 1) { 
    return { type: "element", ... }; 
  }
 * 매직 넘버 피하고자 정의해준 것
 */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

/**
 * @description
 * 편집 가능한 HTML 문자열을 순수 데이터 트리로 변환하는 진입 함수입니다.
 * 이렇게 만들어진 결과는 실제 브라우저 DOM을 직접 건드리지 않고도 `diff.js`에서
 * 비교할 수 있습니다.
 *
 * @logic
 * 1. 입력 HTML을 `<template>` 요소로 파싱합니다.
 * 2. 루트 노드가 정확히 하나인지 검증합니다.
 * 3. DOM 트리를 재귀적으로 순회하며 각 노드를 `VNode` 객체로 정규화합니다.
 * 4. DOM 참조가 없는 순수 객체 그래프를 반환합니다.
 *
 * @performance
 * DOM을 가상화하면 비용이 큰 명령형 트리를 일반 객체로 바꿔 다룰 수 있습니다.
 * 객체 생성 자체에도 비용은 있지만, 실제 DOM을 반복적으로 수정하면서 reflow나
 * repaint를 자주 일으키는 것보다 유리할 수 있습니다.
 *
 * @interview_tip
 * 면접에서는 VDOM이 단순히 DOM 쓰기를 줄일 수 있어서가 아니라, UI를 비교 가능하고
 * 테스트 가능하며 추론 가능한 "데이터"로 표현하게 해준다는 점이 더 본질적이라고
 * 설명하는 것이 좋습니다.
 *
 * @param {string} html
 * @returns {VNode}
 */
export function createVNodeFromHTML(html) {
	if (typeof html !== 'string') {
		throw new TypeError('VDOM 변환 대상은 문자열 HTML이어야 합니다.');
	}
	// 1. 빈 <template> 태그를 가상으로 하나 만듭니다. (일종의 작업용 도마)
	const template = document.createElement('template');

	/**
	 * `trim()`을 먼저 하는 이유:
	 * - 사용자가 textarea에서 맨 앞뒤에 실수로 넣은 공백/개행 때문에
	 *   루트 바깥의 불필요한 text node가 생기는 일을 줄이기 위해서입니다.
	 * - 내부 텍스트는 그대로 유지되므로, 실제 콘텐츠 의미는 훼손하지 않습니다.
	 */
	// 2. 그 도마 위에 우리가 받은 HTML 글자를 올려놓습니다.
	template.innerHTML = html.trim();
	// 3. 도마 위에 올려진 HTML 중 "가장 바깥쪽에 있는 부모 요소 1개"만 딱 집어옵니다
	const rootNode = extractSingleRootElement(template.content);
	// 4. 집어온 그 요소를 본격적으로 가상돔 객체로 바꾸는 함수로 넘깁니다.
	return createVNodeFromDOMNode(rootNode);
}

/**
 * @description
 * 단일 DOM 노드를 diff 알고리즘이 사용하는 공통 `VNode` 스키마로 변환하는
 * 재귀 헬퍼 함수입니다.
 *
 * @logic
 * 1. 현재 노드가 element인지 text node인지 판별합니다.
 * 2. element라면 태그 이름과 속성을 수집합니다.
 * 3. DOM 순서를 유지하며 자식 노드를 재귀적으로 변환합니다.
 * 4. 정규화된 `VNode` 객체를 반환합니다.
 *
 * @performance
 * 재귀 순회는 서브트리의 DOM 노드 수를 n이라 할 때 O(n)입니다.
 * 이 선행 비용은 이후 비교 단계에서 DOM read와 write를 뒤섞지 않고 처리하게 해주므로
 * 학습용 구현에서는 충분히 수용 가능한 편입니다.
 *
 * @interview_tip
 * 면접에서는 왜 text node를 별도 모델링해야 하는지 자주 묻습니다. 텍스트 변경은
 * 가장 흔한 저비용 diff 중 하나이므로, element 내부 부가 정보처럼 숨기지 말고
 * 독립적인 노드로 표현해야 한다고 설명하면 됩니다.
 *
 * @param {Node} domNode
 * @returns {VNode}
 */
export function createVNodeFromDOMNode(domNode) {
	// 1. 만약 이 노드가 그냥 '글자(TEXT_NODE)'라면?
	if (domNode.nodeType === TEXT_NODE) {
		// 모양, 속성 다 필요 없고 그냥 "글자"라는 타입과 "내용"만 담아서 객체로 돌려줍니다.
		return {
			type: 'text',
			value: domNode.textContent ?? '' // ?? 는 Null 병합 연산자, 왼쪽 값 쓰는데 없으면 ''
		};
	}
	// 2. 만약 이 노드가 'HTML 태그(ELEMENT_NODE, 예: div, h1)'라면?
	if (domNode.nodeType === ELEMENT_NODE) {
		const element = /** @type {Element} */ (domNode); // 맨 위에 있는 주석과 마찬가지로 타입스크립트(JSDoc)를 위한 힌트 (Type Assertion)
		// "방금 들어온 domNode를 이제부터 확실한 'HTML 태그(Element)' 취급할 테니, 에디터 너도 에러 띄우지 말고 도와줘!"
		// 1. Element는 갑자기 어디서 튀어나왔을까? (작동 원리)
		// 자바스크립트가 브라우저의 DOM을 다룰 때 사용하는 **'계급(분류)'**을 알면 이해하기 쉽습니다.
		// Node (동물): 가장 큰 범주입니다. 태그(<div>), 글자("안녕"), 주석(``) 모두 일단은 '노드'라고 부릅니다.
		// Element (강아지): 노드 중에서도 **HTML 태그(<div>, <span> 등)**만 콕 집어서 부르는 세부 범주입니다.
		// Text (고양이): 노드 중에서도 순수한 글자만 부르는 이름입니다.
		// 우리 함수인 createVNodeFromDOMNode(domNode)를 볼까요? 처음에 들어오는 domNode라는 녀석은 그냥 "동물(Node)이 한 마리 들어왔다!" 상태입니다. 이 동물이 강아지인지 고양이인지는 아직 모르는 거죠.
		// 그래서 우리가 위쪽 코드에서 if (domNode.nodeType === ELEMENT_NODE)라는 검사소를 거치게 했습니다. "너 태그(강아지) 맞지?" 하고 확인한 거예요
		return {
			type: 'element', // "이건 태그야!"
			tagName: element.tagName.toLowerCase(), // 태그 이름 (DIV -> div 소문자로)
			props: collectProps(element), // 태그에 달린 속성(class, id)들을 모아오고
			children: collectVNodeChildren(element) // 자식들도 똑같이 가상돔으로 바꿔서 배열([ ])에 담아!
		};
	}
	// "이건 내가 예상한 상황이 아니야! 프로그램 당장 멈추고 빨간색 경고창 띄워!"라는 뜻입니다.
	// (예를 들어, 태그나 글자가 아니라 이상한 데이터가 들어오면 더 이상 진행하지 않고 멈추게 합니다.)
	throw new Error( // 백틱 쓰면 파이썬 f-string처럼 변수를 중간에 쏙 끼워넣는게 가능
		`지원하지 않는 DOM 노드 타입입니다: ${domNode.nodeType}. element 또는 text node만 VNode로 변환할 수 있습니다.`
	);
}

/**
 * @description
 * HTML 파싱 결과에서 "학습용으로 의미 있는 루트 요소 하나"를 뽑아내는 헬퍼입니다.
 * 이 프로젝트는 단일 루트 요소를 전제로 diff를 진행하므로, 여기서 입력 형식을
 * 엄격하게 잡아 두면 이후 단계가 훨씬 단순해집니다.
 *
 * @logic
 * 1. `DocumentFragment`의 직계 자식 노드를 모두 확인합니다.
 * 2. 주석 노드와 포매팅용 공백 텍스트 노드는 제거합니다.
 * 3. 남은 노드가 0개면 "루트 없음", 2개 이상이면 "루트 과다" 에러를 냅니다.
 * 4. 남은 노드가 element인지 확인한 뒤 반환합니다.
 *
 * @performance
 * 루트 검사는 fragment의 직계 자식만 한 번 훑는 O(n) 작업입니다. 이 작은 사전
 * 검증 덕분에 이후 재귀 변환과 diff 단계에서 예외 상황을 반복 처리하지 않아도 됩니다.
 *
 * @interview_tip
 * 면접에서 "왜 단일 루트를 강제하나요?"라고 물으면, 트리 비교 시작점을 하나로
 * 고정하면 path 계산과 patch 적용이 단순해지고 학습 난이도도 낮아진다고 답할 수 있습니다.
 *
 * @param {DocumentFragment} fragment
 * @returns {Element}
 */
function extractSingleRootElement(fragment) {
	const meaningfulRootNodes = getMeaningfulChildNodes(fragment);

	if (meaningfulRootNodes.length === 0) {
		throw new Error(
			'편집 영역 HTML에서 루트 요소를 찾지 못했습니다.'
		);
	}

	if (meaningfulRootNodes.length > 1) {
		throw new Error(
			'편집 영역 HTML은 루트 요소를 하나만 가져야 합니다. 여러 형제 요소를 하나의 부모로 감싸 주세요.'
		);
	}

	const rootNode = meaningfulRootNodes[0];

	if (rootNode.nodeType !== ELEMENT_NODE) {
		throw new Error(
			'루트 노드는 텍스트가 아니라 HTML 요소여야 합니다.'
		);
	}

	return /** @type {Element} */ (rootNode);
}

/**
 * @description
 * element의 attribute 목록을 일반 자바스크립트 객체로 복사합니다.
 * 이 단계에서 실제 DOM의 `NamedNodeMap`을 끊어 내야 diff 단계가 순수 데이터만
 * 비교할 수 있습니다.
 *
 * @logic
 * 1. element의 모든 attribute를 순회합니다.
 * 2. `name`을 key로, `value`를 value로 저장합니다.
 * 3. 나중에 diff가 쉽게 비교할 수 있도록 평범한 객체를 반환합니다.
 *
 * @performance
 * attribute 수를 m이라 하면 O(m)입니다. 실제 DOM attribute를 나중에 반복 조회하는
 * 것보다, 한 번 평탄한 객체로 옮겨 두는 편이 비교 로직을 단순하게 만듭니다.
 *
 * @interview_tip
 * "왜 props를 객체로 만드나요?"라는 질문에는, DOM API에 직접 의존하지 않고
 * 자바스크립트 레벨에서 동일한 방식으로 비교하려면 key-value 구조가 가장 단순하다고
 * 답하면 좋습니다.
 *
 * @param {Element} element
 * @returns {Record<string, string>}
 */
// [속성 줍기] <div id="box" class="red"> -> { id: "box", class: "red" } 로 바꿔줍니다.
function collectProps(element) {
	const props = {};
	// 태그에 달린 속성들을 하나씩 돌면서
	for (const attribute of element.attributes) {
		// JS 객체 주머니에 예쁘게 담습니다.
		props[attribute.name] = attribute.value;
	}

	return props;
}

/**
 * @description
 * element의 자식 DOM 노드 중에서 실제 diff에 의미 있는 노드만 골라 VNode 배열로
 * 바꿉니다.
 *
 * @logic
 * 1. 자식 노드를 순회합니다.
 * 2. 주석 노드와 포매팅 전용 공백 텍스트 노드는 제외합니다.
 * 3. 남은 노드 각각을 `createVNodeFromDOMNode()`로 재귀 변환합니다.
 * 4. 원래 DOM 순서를 유지한 VNode 배열을 반환합니다.
 *
 * @performance
 * 자식 수를 k라고 하면 O(k) 순회 뒤 필요한 노드만 재귀 호출합니다. 이렇게 미리
 * 의미 없는 노드를 걸러 두면 이후 diff 대상 트리가 더 작아져 비교 비용도 줄어듭니다.
 *
 * @interview_tip
 * 면접에서는 "왜 공백 text node를 무시하나요?"라고 물을 수 있습니다. 사람이 보기 좋게
 * 들여쓴 HTML의 개행/들여쓰기가 그대로 text node가 되면, 실제 의미 없는 변경까지 diff에
 * 잡혀 학습용 결과가 지나치게 시끄러워진다고 설명하면 됩니다.
 *
 * @param {Element} element
 * @returns {VNode[]}
 */
// [자식 줍기] 태그 안에 있는 자식들을 싹 다 가상돔으로 바꿉니다.
function collectVNodeChildren(element) {
	// 의미 있는 자식들만 골라낸 다음 (.map을 써서) 전부 가상돔 객체로 변환시킵니다.
	return getMeaningfulChildNodes(element).map((childNode) =>
		createVNodeFromDOMNode(childNode)
	);
}

/**
 * @description
 * 부모 노드 아래의 자식 중 "VDOM 비교에 포함할 가치가 있는 노드"만 추려냅니다.
 * 주석 노드는 학습 범위 밖이므로 버리고, 들여쓰기 때문에 생긴 공백 전용 text node도
 * 함께 제거합니다.
 *
 * @logic
 * 1. `childNodes`를 배열로 바꿉니다.
 * 2. 주석 노드는 제거합니다.
 * 3. 포매팅용 공백 text node는 제거합니다.
 * 4. 나머지 노드를 원래 순서 그대로 반환합니다.
 *
 * @performance
 * 부모의 직계 자식만 한 번 순회하므로 O(n)입니다. 이 필터링 덕분에 이후 재귀에서
 * 의미 없는 노드까지 모두 방문하지 않아도 됩니다.
 *
 * @interview_tip
 * 브라우저는 "보이는 요소"만 노드로 갖는 것이 아니라, 공백 text node와 comment node도
 * DOM 트리에 포함합니다. 이 점을 알고 있으면 DOM 디버깅에서 훨씬 덜 헷갈립니다.
 *
 * @param {ParentNode} parentNode
 * @returns {Node[]}
 */
function getMeaningfulChildNodes(parentNode) {
	return Array.from(parentNode.childNodes).filter(
		(childNode) => !isIgnorableNode(childNode)
	);
}

/**
 * @description
 * 특정 노드가 학습용 VDOM에서 무시 가능한지 판별합니다.
 * 여기서는 comment node와 "들여쓰기 때문에 생긴 공백-only text node"를 제외합니다.
 *
 * @logic
 * 1. comment node면 무조건 무시합니다.
 * 2. text node라면 내용이 공백뿐인지 확인합니다.
 * 3. 그 공백이 개행/탭을 포함한 포매팅 흔적인지 검사합니다.
 * 4. 조건에 맞으면 무시 대상으로 판단합니다.
 *
 * @performance
 * 노드 하나당 매우 작은 문자열 검사만 수행합니다. 이 미세한 비용으로 이후 diff
 * 노이즈를 크게 줄일 수 있으므로 학습용 구현에서 충분히 이득입니다.
 *
 * @interview_tip
 * HTML의 공백은 렌더링에서 축약되기도 하지만, DOM 레벨에서는 별도 text node일 수
 * 있습니다. "렌더링 결과"와 "DOM 구조"가 완전히 같지 않다는 점이 여기서 드러납니다.
 *
 * @param {Node} node
 * @returns {boolean}
 */
// 노드가 "무시해도 되는 애"인지 판별하는 필터기입니다.
function isIgnorableNode(node) {
	if (node.nodeType === COMMENT_NODE) {
		return true; // 주석()이면 버려!
	}

	if (node.nodeType !== TEXT_NODE) {
		return false; // 글자가 아니면(태그면) 살려둬!
	}
	// 글자이긴 한데...
	const textContent = node.textContent ?? '';
	const isWhitespaceOnly = textContent.trim() === ''; // 빈칸밖에 없니?
	const looksLikeFormattingWhitespace = /[\n\r\t]/.test(textContent); // 엔터나 탭이니?
	// 빈칸이면서 엔터/탭이면 버려! (true 반환)
	return isWhitespaceOnly && looksLikeFormattingWhitespace;
}

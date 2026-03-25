/**
 * @typedef {import("./vdom.js").VNode} VNode
 */

/**
 * @typedef {import("./diff.js").Patch} Patch
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

/**
 * @description
 * 추상적인 patch 객체를 Live View 컨테이너의 실제 DOM 갱신으로 연결하는 함수입니다.
 *
 * @logic
 * 1. path 기반 patch 목록을 순회합니다.
 * 2. 현재 Live View 루트에서 대상 DOM 노드를 찾습니다.
 * 3. text, prop, insert, remove, replace 연산을 적용합니다.
 * 4. 이후 history 스냅샷과 구조가 어긋나지 않도록 DOM 구조를 유지합니다.
 *
 * @performance
 * patching의 핵심은 일부 노드만 바뀌었을 때 전체 서브트리를 갈아끼우지 않는 데
 * 있습니다. 실제 DOM 쓰기 횟수가 줄면 보통 layout과 paint 비용도 줄어들지만,
 * diff 계산 자체가 공짜는 아니라는 점도 함께 이해해야 합니다.
 *
 * @interview_tip
 * 왜 diff 이후에 patch 단계가 또 필요한지 묻는다면, diff는 "무엇이 바뀌었는지"
 * 찾는 단계이고 patch는 그 결과를 실제 DOM에 실행하는 단계라고 설명하면 됩니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch[]} patches
 * @returns {void}
 */
export function applyPatches(liveRoot, patches) {
	// 1. 방어 코드: "공사할 진짜 땅(liveRoot)과 지시서(patches)가 맞는지 확인해!"
	if (!(liveRoot instanceof HTMLElement)) {
		throw new TypeError(
			'실제 DOM을 갱신하려면 유효한 HTMLElement 루트가 필요합니다.'
		);
	}

	if (!Array.isArray(patches)) {
		throw new TypeError('patches는 배열이어야 합니다.');
	}

	// 2. 💡 핵심: 지시서의 실행 순서를 아주 전략적으로 다시 줄 세웁니다!
	/**
	 * patch 적용 순서를 따로 정리하는 이유:
	 * - REMOVE는 뒤쪽 형제부터 지워야 index가 당겨지지 않습니다. 주소 꼬임 방지
	 * - INSERT는 앞쪽부터 넣어야 같은 부모 안에서 순서가 자연스럽게 맞습니다.
	 * - PROPS / TEXT / REPLACE는 구조를 크게 흔들지 않으므로 먼저 처리해도 안전합니다.
	 */
	const orderedPatches = [
		// 1순위: 속성(PROPS)이나 글자(TEXT) 바꾸기. (가장 가벼운 작업이니까 먼저 쓱싹!)
		...patches.filter(
			(patch) => patch.type === 'PROPS' || patch.type === 'TEXT'
		),
		// 2순위: 통째로 교체하기(REPLACE). (구조가 바뀌니까 그 다음에)
		...patches.filter((patch) => patch.type === 'REPLACE'),
		// 3순위: 삭제하기(REMOVE). ⭐️ 단, "뒤에서부터(내림차순)" 지웁니다!
		...patches
			.filter((patch) => patch.type === 'REMOVE')
			.sort((left, right) =>
				comparePathsDescending(left.path, right.path)
			),
		// 4순위: 새로 넣기(INSERT). ⭐️ 단, "앞에서부터(오름차순)" 넣습니다!
		...patches
			.filter((patch) => patch.type === 'INSERT')
			.sort((left, right) =>
				comparePathsAscending(left.path, right.path)
			)
	];

	// 3. 줄 세운 순서대로 작업자(applySinglePatch)에게 하나씩 던져줍니다.
	for (const patch of orderedPatches) {
		applySinglePatch(liveRoot, patch);
	}
}

// 만약 지시서에 "버튼을 새로 추가해!(INSERT)"나 "아예 통째로 새 걸로 갈아 끼워!(REPLACE)"라는 명령이 있다면,
// 공사반장은 창고에서 진짜 DOM 노드를 새로 하나 만들어 와야 함. 그 역할을 하는 공장.
// vdom.js에서 우리가 브라우저의 진짜 DOM을 가벼운 VNode 객체로 바꿨던 것 기억나시나요?
// 지금 보는 이 함수는 정확히 그 과정을 거꾸로 되감기하고 있는 것입니다!
// VNode 설계도를 보고 브라우저가 알아듣는 진짜 DOM 요소(document.createElement 등)를 다시 창조해 내는 마법
/**
 * @description
 * insert 또는 replace patch가 새 실제 노드를 요구할 때, `VNode`로부터 구체적인
 * DOM 노드를 다시 만드는 헬퍼 함수입니다.
 *
 * @logic
 * 1. `VNode`의 타입을 확인합니다.
 * 2. Text node 또는 Element node를 생성합니다.
 * 3. element라면 props를 적용합니다.
 * 4. 자식 노드를 재귀적으로 붙입니다.
 *
 * @performance
 * 새 노드 생성은 기존 노드 재사용보다 일반적으로 비용이 큽니다.
 * 따라서 이 헬퍼는 diff 단계가 재사용이 불가능하다고 판단했을 때만 써야 합니다.
 *
 * @interview_tip
 * "최소 DOM 업데이트"는 노드를 절대 새로 만들지 않는다는 뜻이 아닙니다.
 * 구조적 재사용이 더 이상 타당하지 않을 때만 새로 만든다는 뜻이라고 설명하면 좋습니다.
 *
 * @param {VNode} vnode
 * @returns {Node}
 */
export function createRealNode(vnode) {
	// 1. 만약 가짜 객체가 "글자(text)"라면?
	if (vnode.type === 'text') {
		/**
		 * 브라우저 API: document.createTextNode()
		 * - 순수 텍스트 노드를 생성합니다.
		 * - `<span>` 같은 wrapper를 억지로 만들지 않기 때문에, VDOM 구조를 가장 정확하게
		 *   실제 DOM으로 복원할 수 있습니다.
		 */
		// 브라우저의 진짜 기능(createTextNode)을 써서 "진짜 글자 노드"를 찍어냅니다!
		return document.createTextNode(vnode.value ?? '');
	}
	// 2. 만약 가짜 객체가 "HTML 태그(element)"라면?
	if (vnode.type === 'element') {
		/**
		 * 브라우저 API: document.createElement()
		 * - 태그 이름을 받아 실제 HTML 요소를 만듭니다.
		 * - 아직 화면에 붙은 상태는 아니고, 메모리 안에 존재하는 새 노드입니다.
		 */
		// 1) 뼈대 만들기: 진짜 태그(div 등)를 메모리상에 생성합니다. (아직 화면엔 안 보임)
		const element = document.createElement(vnode.tagName ?? 'div');
		// 2) 옷 입히기: 그 태그에 class나 id 같은 속성을 발라줍니다.
		applyPropChanges(element, vnode.props ?? {});
		// 3) 자식들 품기 (⭐️ 재귀 등장!)
		for (const childVNode of vnode.children ?? []) {
			/**
			 * 브라우저 API: appendChild()
			 * - 부모 요소의 맨 뒤에 자식을 붙입니다.
			 * - createRealNode()를 재귀 호출하므로, VNode 트리 전체가 아래로 내려가며
			 *   실제 DOM 트리로 복원됩니다.
			 */
			// 내 자식들도 전부 이 공장(createRealNode)에 다시 넣어서 진짜로 만든 다음,
			// 내 뱃속(appendChild)에 차곡차곡 집어넣습니다!
			element.appendChild(createRealNode(childVNode));
		}

		return element;
	}

	throw new Error(`지원하지 않는 VNode 타입입니다: ${vnode.type}`);
}

/**
 * @description
 * patch 하나를 받아 해당 타입에 맞는 브라우저 DOM API를 호출합니다.
 * 이 함수는 patch 배열을 실제 실행 가능한 DOM 명령으로 번역하는 스위치 역할입니다.
 *
 * @logic
 * 1. patch.type을 확인합니다.
 * 2. 타입별 전용 처리 함수로 분기합니다.
 * 3. 각 함수는 path를 따라 target DOM을 찾은 뒤 필요한 DOM API를 호출합니다.
 *
 * @performance
 * 타입별 로직을 분리해 두면 매 분기에서 필요한 최소 작업만 수행합니다.
 * 예를 들어 TEXT patch는 textContent만 바꾸고 끝나므로 element 전체를 다시 만들 필요가 없습니다.
 *
 * @interview_tip
 * diff 단계가 "변경 탐지"라면, patch 단계는 "변경 실행"입니다. 둘을 분리하면 비교 로직과
 * DOM 조작 로직을 독립적으로 이해하고 테스트하기 쉬워집니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch} patch
 * @returns {void}
 */
function applySinglePatch(liveRoot, patch) {
	// 지시서(patch)에 적힌 작업 타입(type)이 뭔지 확인!
	// type에 맞는 전담 함수를 호출
	switch (patch.type) {
		case 'REPLACE':
			applyReplacePatch(liveRoot, patch);
			return;
		case 'PROPS':
			applyPropsPatch(liveRoot, patch);
			return;
		case 'TEXT':
			applyTextPatch(liveRoot, patch);
			return;
		case 'INSERT':
			applyInsertPatch(liveRoot, patch);
			return;
		case 'REMOVE':
			applyRemovePatch(liveRoot, patch);
			return;
		default:
			throw new Error(
				`지원하지 않는 patch 타입입니다: ${patch.type}`
			);
	}
}

/**
 * @description
 * REPLACE patch를 처리합니다. 기존 DOM 노드 하나를 새 DOM 노드 하나로 교체합니다.
 *
 * @logic
 * 1. path로 기존 target 노드를 찾습니다.
 * 2. payload의 VNode를 새 실제 DOM 노드로 변환합니다.
 * 3. root면 `liveRoot.replaceChild()`, 그 외에는 `parentNode.replaceChild()`로 교체합니다.
 *
 * @performance
 * 타입이나 태그가 달라진 노드는 부분 수정으로 맞추려는 것보다 통째 교체가 더 단순하고
 * 안전합니다. 불필요한 세부 비교를 건너뛰므로 코드와 실행 흐름이 깔끔해집니다.
 *
 * @interview_tip
 * "왜 replace가 필요하죠?"라는 질문에는, `<p>`를 `<div>`로 바꾸는 건 속성 몇 개 수정으로
 * 해결할 수 없는 "노드 정체성 변경"이기 때문이라고 설명하면 됩니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch} patch
 * @returns {void}
 */
function applyReplacePatch(liveRoot, patch) {
	// 1. 새 부품 준비: payload 검증 후 진짜 DOM 노드로 만들기
	const nextVNode = expectVNodePayload(patch.payload, 'REPLACE');
	const replacementNode = createRealNode(nextVNode);
	const targetNode = getNodeByPath(liveRoot, patch.path);
	// 2. 특수 케이스: 교체할 녀석이 '루트(최상위 부모)' 본인이라면? (path가 비어있음)
	if (patch.path.length === 0) {
		// 땅에 기존 건물(targetNode)이 버티고 있다면?
		if (targetNode) {
			/**
			 * 브라우저 API: replaceChild(newNode, oldNode)
			 * - 부모 기준으로 기존 자식을 새 자식으로 교체합니다.
			 * - 여기서는 liveRoot가 "관리 컨테이너"이고, 실제 화면 루트는 그 자식 1개이므로
			 *   liveRoot의 첫 루트 자식을 갈아끼우는 방식으로 처리합니다.
			 */
			// 땅(liveRoot)에서 예전 건물을 새 건물(replacementNode)로 밀어내고 교체해!
			liveRoot.replaceChild(replacementNode, targetNode);
			return;
		}
		// if문을 통과하지 못하고 아래로 내려옴 (즉, targetNode가 없음)
		liveRoot.appendChild(replacementNode);
		return;
	}
	// 3. 일반 케이스: 일반 자식들을 교체할 때
	if (!targetNode || !targetNode.parentNode) {
		throw new Error(
			`REPLACE 대상 노드를 찾지 못했습니다. path=${formatPath(patch.path)}`
		);
	}

	targetNode.parentNode.replaceChild(replacementNode, targetNode);
}

/**
 * @description
 * PROPS patch를 처리합니다. 같은 element를 유지한 채 attribute만 수정합니다.
 *
 * @logic
 * 1. path로 target DOM 노드를 찾습니다.
 * 2. payload의 속성 변경 맵을 읽습니다.
 * 3. 값이 null이면 removeAttribute(), 값이 있으면 setAttribute()를 호출합니다.
 *
 * @performance
 * 같은 태그를 재사용하면서 필요한 attribute만 바꾸면, element 전체를 새로 만들지 않아도 됩니다.
 * 이 방식은 DOM 노드 재사용 측면에서 더 경제적입니다.
 *
 * @interview_tip
 * React가 Virtual DOM을 쓰는 이유 중 하나도 "모든 것을 다시 그리기"보다 "바뀐 부분만 갱신"
 * 하려는 데 있습니다. PROPS patch는 그 철학이 가장 잘 보이는 케이스입니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch} patch
 * @returns {void}
 */
function applyPropsPatch(liveRoot, patch) {
	const targetNode = getNodeByPath(liveRoot, patch.path);

	if (!(targetNode instanceof Element)) {
		throw new Error(
			`PROPS 대상은 Element여야 합니다. path=${formatPath(patch.path)}`
		);
	}

	const propChanges = expectPropsPayload(patch.payload, patch.type); // 예: { class: "red", disabled: null }

	applyPropChanges(targetNode, propChanges);
}

/**
 * @description
 * TEXT patch를 처리합니다. text node의 문자열 값만 교체합니다.
 *
 * @logic
 * 1. path로 text node를 찾습니다.
 * 2. payload의 새 문자열을 읽습니다.
 * 3. 해당 노드의 `textContent`를 교체합니다.
 *
 * @performance
 * 텍스트만 바뀐 경우 element를 통째로 교체하면 너무 과한 작업입니다.
 * `textContent` 한 번으로 끝내는 편이 훨씬 직접적이고 저렴합니다.
 *
 * @interview_tip
 * text node를 별도 patch 타입으로 두는 이유는, 텍스트 변경이 UI에서 매우 흔하고
 * 비용도 작기 때문입니다. 작은 변화를 작은 명령으로 표현하는 것이 핵심입니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch} patch
 * @returns {void}
 */
function applyTextPatch(liveRoot, patch) {
	const targetNode = getNodeByPath(liveRoot, patch.path); // 타겟 찾기

	if (!targetNode || targetNode.nodeType !== TEXT_NODE) {
		throw new Error(
			`TEXT 대상 text node를 찾지 못했습니다. path=${formatPath(patch.path)}`
		);
	}

	/**
	 * 브라우저 API: textContent
	 * - 텍스트 노드의 내용을 읽거나 교체하는 가장 직관적인 속성입니다.
	 * - innerHTML처럼 다시 파싱하지 않기 때문에, 순수 텍스트 변경에는 더 적합합니다.
	 */
	targetNode.textContent = expectTextPayload(
		patch.payload,
		patch.type
	);
}

/**
 * @description
 * INSERT patch를 처리합니다. 부모 노드 안의 특정 인덱스 위치에 새 DOM 노드를 넣습니다.
 *
 * @logic
 * 1. path의 마지막 숫자를 "삽입 인덱스"로 해석합니다.
 * 2. path의 부모 위치까지 따라가 부모 DOM을 찾습니다.
 * 3. 같은 규칙으로 계산한 형제 목록에서 reference node를 구합니다.
 * 4. `insertBefore()`를 사용해 원하는 위치에 새 노드를 삽입합니다.
 *
 * @performance
 * 전체 부모를 다시 렌더링하지 않고 필요한 자식 하나만 넣을 수 있습니다.
 * `insertBefore()`는 기준 노드만 알면 정확한 위치 삽입이 가능해 학습용 patch 구조와 잘 맞습니다.
 *
 * @interview_tip
 * 삽입에서 path가 중요한 이유는, "무엇을 넣을지"와 "어디에 넣을지"를 분리해서 표현하기 위해서입니다.
 * payload는 새 노드 자체를, path는 위치 정보를 담당합니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch} patch
 * @returns {void}
 */
function applyInsertPatch(liveRoot, patch) {
	// 1. 새 부품 준비
	const nextVNode = expectVNodePayload(patch.payload, 'INSERT');
	const newNode = createRealNode(nextVNode);
	// 2. 💡 INSERT만의 특수 내비게이션 사용!
	// 추가할 때는 타겟 본인이 아니라, "어떤 부모(parentNode)의 몇 번째 자리(childIndex)에 넣을지"가 필요함
	const { parentNode, childIndex } = getParentContextByPath(
		liveRoot,
		patch.path
	);
	// 3. 내 바로 뒤에 서 있는 녀석(referenceNode) 찾기
	const referenceNode =
		getMeaningfulChildNodes(parentNode)[childIndex] ?? null;

	/**
	 * 브라우저 API: insertBefore(newNode, referenceNode)
	 * - referenceNode 앞에 새 노드를 삽입합니다.
	 * - 두 번째 인자로 null을 주면 appendChild처럼 맨 뒤에 붙습니다.
	 * - 이 API 하나로 "중간 삽입"과 "맨 뒤 추가"를 모두 처리할 수 있습니다.
	 */
	// 4. 진짜 망치질: 그 녀석 앞으로 새치기해서 들어가기!
	parentNode.insertBefore(newNode, referenceNode);
}

/**
 * @description
 * REMOVE patch를 처리합니다. path가 가리키는 기존 DOM 노드를 화면에서 제거합니다.
 *
 * @logic
 * 1. path로 대상 노드를 찾습니다.
 * 2. 부모 노드를 확인합니다.
 * 3. `removeChild()`로 부모-자식 관계에서 해당 노드를 분리합니다.
 *
 * @performance
 * 삭제는 payload 없이 path만으로 충분합니다. "어디를 지울지"만 알면 되므로 patch 표현도 작고,
 * 실제 DOM 연산도 한 번이면 끝납니다.
 *
 * @interview_tip
 * 여러 형제 삭제에서 뒤쪽부터 지우는 이유는 배열 index와 비슷합니다. 앞쪽을 먼저 지우면
 * 뒤쪽 인덱스가 당겨져 path가 틀어질 수 있습니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {Patch} patch
 * @returns {void}
 */
function applyRemovePatch(liveRoot, patch) {
	const targetNode = getNodeByPath(liveRoot, patch.path);
	// 1. 지울 놈이 안 보이면 에러!
	if (!targetNode) {
		throw new Error(
			`REMOVE 대상 노드를 찾지 못했습니다. path=${formatPath(patch.path)}`
		);
	}
	// 2. 지울 놈의 부모님이 안 계시면 에러! (고아를 호적에서 팔 수는 없으니까요)
	if (!targetNode.parentNode) {
		throw new Error(
			`REMOVE 대상 노드의 부모를 찾지 못했습니다. path=${formatPath(patch.path)}`
		);
	}

	/**
	 * 브라우저 API: removeChild(node)
	 * - 부모 기준으로 특정 자식을 제거합니다.
	 * - "누가 누구를 지우는지"가 코드상에 명확히 드러나서 학습용으로 읽기 좋습니다.
	 */
	// 3. 진짜 망치질: 부모님한테 찾아가서 떼어내기
	targetNode.parentNode.removeChild(targetNode);
}

/**
 * @description
 * patch의 path를 따라 실제 DOM 트리에서 목표 노드를 찾습니다.
 * 이 파일에서 가장 중요한 "Node Traversal" 함수입니다.
 *
 * @logic
 * 1. liveRoot 안의 실제 관리 루트 노드 1개를 찾습니다.
 * 2. path가 빈 배열이면 그 루트 노드를 그대로 반환합니다.
 * 3. path의 각 숫자를 child index로 해석해 아래로 내려갑니다.
 * 4. 내려갈 때는 `childNodes` 전체가 아니라, VDOM 규칙과 동일한 "의미 있는 자식들"만 사용합니다.
 *
 * @performance
 * path 기반 탐색은 루트부터 목표까지 필요한 깊이만 따라가므로 O(depth)입니다.
 * 트리 전체를 다시 찾는 것보다 훨씬 직접적입니다.
 *
 * @interview_tip
 * 이 함수의 핵심은 "VDOM이 만든 path 규칙과 실제 DOM 탐색 규칙이 반드시 같아야 한다"는 점입니다.
 * 한쪽은 공백 text node를 무시하고 다른 쪽은 포함하면 path가 즉시 틀어집니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {number[]} path
 * @returns {Node | null}
 */
// 5명의 작업자가 공통으로 쓰는 가장 중요한 GPS 장치입니다.
// 지시서에 적힌 path: [0, 1]을 보고 실제 브라우저 화면에서 그 녀석을 정확히 끄집어냅니다.
// 공사반장이 망치질을 해야 하는 바로 그 타겟까지만 빠르고 정확하게 안내하고 쿨하게 퇴근
function getNodeByPath(liveRoot, path) {
	// 1. 공사 현장(liveRoot)의 진짜 시작점(맨 위 부모)을 찾습니다.
	const managedRootNode = getManagedRootNode(liveRoot);

	if (!managedRootNode) {
		return null;
	}

	if (path.length === 0) {
		return managedRootNode;
	}

	let currentNode = managedRootNode;
	// 2. 주소(path) 배열을 순서대로 하나씩 읽으면서 밑으로 파고듭니다.
	for (const childIndex of path) {
		if (!canContainChildren(currentNode)) {
			return null;
		}
		// 현재 노드의 "의미 있는 자식들(빈칸, 주석 제외)"을 쫙 가져옵니다.
		const meaningfulChildren = getMeaningfulChildNodes(currentNode);
		// 주소에 적힌 번호(childIndex)에 해당하는 자식을 다음 목적지로 설정!
		currentNode = meaningfulChildren[childIndex];

		if (!currentNode) {
			return null;
		}
	}

	return currentNode;
}

/**
 * @description
 * INSERT처럼 "대상 노드 자체"보다 "대상 부모 + 끼워 넣을 인덱스"가 필요한 patch를 위해
 * 부모 컨텍스트를 계산합니다.
 *
 * @logic
 * 1. path가 빈 배열이면 부모는 liveRoot이고 인덱스는 0입니다.
 * 2. 마지막 인덱스를 제외한 parent path로 부모 노드를 찾습니다.
 * 3. 마지막 숫자를 childIndex로 반환합니다.
 *
 * @performance
 * 부모를 한 번만 계산해 두면 insert 로직이 reference node를 바로 찾을 수 있어 깔끔합니다.
 *
 * @interview_tip
 * insert와 replace의 차이를 물으면, replace는 "현재 노드"가 필요하고 insert는 "부모와 위치"가
 * 필요하다고 구분해 설명하면 좋습니다.
 *
 * @param {HTMLElement} liveRoot
 * @param {number[]} path
 * @returns {{ parentNode: ParentNode, childIndex: number }}
 */
function getParentContextByPath(liveRoot, path) {
	if (path.length === 0) {
		return {
			parentNode: liveRoot,
			childIndex: 0
		};
	}

	const parentPath = path.slice(0, -1);
	const childIndex = path[path.length - 1];
	const parentNode =
		parentPath.length === 0
			? getManagedRootNode(liveRoot)
			: getNodeByPath(liveRoot, parentPath);

	if (!parentNode || !canContainChildren(parentNode)) {
		throw new Error(
			`INSERT 대상 부모를 찾지 못했습니다. path=${formatPath(path)}`
		);
	}

	return {
		parentNode,
		childIndex
	};
}

/**
 * @description
 * liveRoot 안에서 patch 대상이 되는 "실제 관리 루트 노드 1개"를 반환합니다.
 * liveRoot는 컨테이너이고, patch path의 시작점은 그 안쪽의 첫 루트 노드입니다.
 *
 * @logic
 * 1. liveRoot의 의미 있는 자식들을 모읍니다.
 * 2. 0개면 아직 렌더링된 루트가 없는 상태로 보고 null을 반환합니다.
 * 3. 2개 이상이면 학습용 단일 루트 규칙이 깨진 것이므로 에러를 냅니다.
 *
 * @performance
 * root 확인은 컨테이너의 직계 자식만 보기 때문에 매우 가볍습니다.
 *
 * @interview_tip
 * React도 루트 컨테이너와 실제 렌더 트리를 구분합니다. 여기서도 `liveRoot`는 컨테이너이고,
 * patch는 그 안의 실제 앱 루트에 적용된다고 이해하면 됩니다.
 *
 * @param {HTMLElement} liveRoot
 * @returns {Node | null}
 */
function getManagedRootNode(liveRoot) {
	const rootCandidates = getMeaningfulChildNodes(liveRoot);

	if (rootCandidates.length === 0) {
		return null;
	}

	if (rootCandidates.length > 1) {
		throw new Error(
			'실제 영역에는 patch 대상 루트 노드가 하나만 있어야 합니다.'
		);
	}

	return rootCandidates[0];
}

/**
 * @description
 * element에 props 변경 사항을 실제 attribute 조작으로 반영합니다.
 *
 * @logic
 * 1. 변경 맵의 key를 순회합니다.
 * 2. 값이 null이면 removeAttribute()를 호출합니다.
 * 3. 값이 문자열이면 setAttribute()를 호출합니다.
 *
 * @performance
 * 변경된 속성만 적용하므로, 이미 같은 값인 attribute까지 무조건 다시 쓰는 낭비를 피할 수 있습니다.
 *
 * @interview_tip
 * attribute diff는 "무조건 전체 rerender"와 대비해서 설명하기 좋습니다. 브라우저 API는 싸지 않으니,
 * 정말 바뀐 부분만 건드리는 게 중요합니다.
 *
 * @param {Element} element
 * @param {Record<string, string | null>} propChanges
 * @returns {void}
 */
function applyPropChanges(element, propChanges) {
	for (const [propName, propValue] of Object.entries(propChanges)) {
		if (propValue === null) {
			/**
			 * 브라우저 API: removeAttribute(name)
			 * - 해당 이름의 attribute를 요소에서 제거합니다.
			 * - diff 결과가 "삭제"를 명시했을 때 가장 직접적인 API입니다.
			 */
			element.removeAttribute(propName);
			continue;
		}

		/**
		 * 브라우저 API: setAttribute(name, value)
		 * - attribute 값을 추가하거나 갱신합니다.
		 * - props를 key-value 맵으로 만든 이유가 여기서 드러납니다. 그대로 루프 돌며 적용하면 됩니다.
		 */
		element.setAttribute(propName, propValue);
	}
}

/**
 * @description
 * path 정렬에 쓰이는 오름차순 비교 함수입니다.
 * 주로 INSERT patch를 "앞에서 뒤" 순서로 적용하기 위해 사용합니다.
 *
 * @param {number[]} leftPath
 * @param {number[]} rightPath
 * @returns {number}
 */
function comparePathsAscending(leftPath, rightPath) {
	const maxLength = Math.max(leftPath.length, rightPath.length);

	for (let index = 0; index < maxLength; index += 1) {
		const leftValue = leftPath[index] ?? -1;
		const rightValue = rightPath[index] ?? -1;

		if (leftValue !== rightValue) {
			return leftValue - rightValue;
		}
	}

	return leftPath.length - rightPath.length;
}

/**
 * @description
 * path 정렬에 쓰이는 내림차순 비교 함수입니다.
 * 주로 REMOVE patch를 "뒤에서 앞" 순서로 적용해 index 밀림을 막기 위해 사용합니다.
 *
 * @param {number[]} leftPath
 * @param {number[]} rightPath
 * @returns {number}
 */
function comparePathsDescending(leftPath, rightPath) {
	return comparePathsAscending(rightPath, leftPath);
}

/**
 * @description
 * 부모 노드의 자식 중에서 VDOM path 계산에 포함되는 노드만 반환합니다.
 * 이 규칙은 반드시 `vdom.js`와 같아야 합니다.
 *
 * @param {Node} parentNode
 * @returns {Node[]}
 */
function getMeaningfulChildNodes(parentNode) {
	return Array.from(parentNode.childNodes).filter(
		(childNode) => !isIgnorableNode(childNode)
	);
}

/**
 * @description
 * patch path 계산에서 무시해야 할 노드인지 판별합니다.
 * 주석 노드와 포매팅 전용 공백 text node는 VDOM에도 포함되지 않았으므로 여기서도 제외합니다.
 *
 * @param {Node} node
 * @returns {boolean}
 */
function isIgnorableNode(node) {
	if (node.nodeType === COMMENT_NODE) {
		return true;
	}

	if (node.nodeType !== TEXT_NODE) {
		return false;
	}

	const textContent = node.textContent ?? '';
	const isWhitespaceOnly = textContent.trim() === '';
	const looksLikeFormattingWhitespace = /[\n\r\t]/.test(textContent);

	return isWhitespaceOnly && looksLikeFormattingWhitespace;
}

/**
 * @description
 * patch payload가 VNode여야 하는 케이스에서 타입을 확인합니다.
 *
 * @param {Patch["payload"]} payload
 * @param {Patch["type"]} patchType
 * @returns {VNode}
 */
function expectVNodePayload(payload, patchType) {
	if (
		!payload ||
		typeof payload !== 'object' ||
		!('type' in payload)
	) {
		throw new Error(
			`${patchType} patch에는 VNode payload가 필요합니다.`
		);
	}

	return /** @type {VNode} */ (payload);
}

/**
 * @description
 * patch payload가 속성 변경 맵이어야 하는 케이스에서 타입을 확인합니다.
 *
 * @param {Patch["payload"]} payload
 * @param {Patch["type"]} patchType
 * @returns {Record<string, string | null>}
 */
function expectPropsPayload(payload, patchType) {
	if (
		!payload ||
		typeof payload !== 'object' ||
		Array.isArray(payload)
	) {
		throw new Error(
			`${patchType} patch에는 props 변경 맵 payload가 필요합니다.`
		);
	}

	return /** @type {Record<string, string | null>} */ (payload);
}

/**
 * @description
 * patch payload가 문자열이어야 하는 케이스에서 타입을 확인합니다.
 *
 * @param {Patch["payload"]} payload
 * @param {Patch["type"]} patchType
 * @returns {string}
 */
function expectTextPayload(payload, patchType) {
	if (typeof payload !== 'string') {
		throw new Error(
			`${patchType} patch에는 문자열 payload가 필요합니다.`
		);
	}

	return payload;
}

/**
 * @description
 * 디버깅과 에러 메시지에서 path를 읽기 쉽게 보여 주는 포맷터입니다.
 *
 * @param {number[]} path
 * @returns {string}
 */
function formatPath(path) {
	return path.length === 0 ? 'root([])' : `[${path.join(', ')}]`;
}

/**
 * @description
 * 현재 노드가 자식을 가질 수 있는 종류인지 판별합니다.
 *
 * @param {Node} node
 * @returns {boolean}
 */
function canContainChildren(node) {
	return (
		node.nodeType === ELEMENT_NODE ||
		node.nodeType === DOCUMENT_NODE ||
		node.nodeType === DOCUMENT_FRAGMENT_NODE
	);
}

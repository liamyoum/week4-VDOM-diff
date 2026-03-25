/**
 * @typedef {import("./vdom.js").VNode} VNode
 */

/** JSDoc 메모장, Patch 설명서
 * @typedef {Object} Patch Patch 타입 정의
 * @property {"REPLACE" | "PROPS" | "TEXT" | "INSERT" | "REMOVE"} type 무슨 작업 해야하는지 5가지 중 하나로 적기 (아예 교체, 속성 변경, 글자 변경, 새로 추가, 삭제)
 * @property {number[]} path 주소, [0, 1] 이라고 젹혀있으면 첫 번째 자식의 두 번째 자식을 찾아가라는 뜻. 이 주소 덕분에 나중에 진짜 DOM 고칠 수 있음
 * @property {VNode | Record<string, string | null> | string | null} payload 작업에 필요한 내용물
 */

/**
 * @description
 * 두 개의 `VNode` 트리를 비교해 학습용 patch 목록을 만드는 순수 함수입니다.
 * 목적은 의미 있는 최소 변경 집합을 계산하는 것입니다.
 *
 * @logic
 * 1. 먼저 노드 존재 여부를 비교해 insert/remove 케이스를 판별합니다.
 * 2. 노드 종류와 태그 이름을 비교해 replace 여부를 판단합니다.
 * 3. text node의 값이 바뀌었는지 비교합니다.
 * 4. element의 속성을 비교해 prop patch를 만듭니다.
 * 5. 자식 노드를 순서대로 재귀 비교하며 path 기반 patch를 수집합니다.
 *
 * @performance
 * 이 단순화된 트리 순회는 React 수준의 휴리스틱보다 명확성을 우선합니다.
 * 그래도 무엇이 바뀌었는지 먼저 메모리에서 계산한 뒤 필요한 patch만 만드는 편이,
 * 변화 이해 없이 실제 DOM을 무작정 많이 수정하는 것보다 낫습니다.
 *
 * @interview_tip
 * 학습용 diff는 의도적으로 production 휴리스틱보다 단순하다는 점을 설명할 수
 * 있어야 합니다. React는 stable key 같은 추가 가정을 이용해 일반 트리 diff의
 * 이론적 O(n^3) 비용을 실전에서는 O(n)에 가깝게 줄입니다.
 *
 * @param {VNode} oldTree
 * @param {VNode} newTree
 * @returns {Patch[]}
 */
export function diffTrees(oldTree, newTree) {
	return diffNode(oldTree, newTree, []); // 두 개의 커다란 트리(객체)를 받아서, 맨 꼭대기(주소 [])부터 탐색을 시작
}

/**
 * @description
 * element의 속성을 비교해 변경, 추가, 삭제된 항목만 `PROPS` patch payload로
 * 추출하는 헬퍼 함수입니다.
 *
 * @logic
 * 1. 이전 props와 다음 props를 읽습니다.
 * 2. 삭제된 속성은 명시적으로 표시합니다.
 * 3. 새로 추가되었거나 값이 바뀐 속성은 다음 값을 기록합니다.
 * 4. patch 단계에서 바로 쓸 수 있는 compact payload를 반환합니다.
 *
 * @performance
 * 작은 props 맵을 자바스크립트 메모리에서 비교하는 작업은, 실제 변경이 없는데도
 * 모든 DOM attribute를 무조건 다시 쓰는 것보다 대체로 저렴합니다.
 *
 * @interview_tip
 * 속성 변경은 스타일 재계산을 유발할 수 있으므로, 단순한 데모에서도 no-op 변경을
 * 걸러내는 일이 의미 있다고 설명하면 좋은 답변이 됩니다.
 *
 * @param {Record<string, string>} oldProps
 * @param {Record<string, string>} newProps
 * @returns {Record<string, string | null>}
 */
export function diffProps(oldProps, newProps) {
	const propChanges = {};
	const oldPropEntries = Object.keys(oldProps ?? {});
	const newPropEntries = Object.keys(newProps ?? {});

	// 1. 옛날엔 있었는데 지금은 없어진 속성 찾기 -> "null(없음)로 표시해!"
	for (const propName of oldPropEntries) {
		if (!(propName in (newProps ?? {}))) {
			propChanges[propName] = null;
		}
	}
	// 2. 새로 생겼거나, 값이 바뀐 속성 찾기 -> "새로운 값을 적어놔!"
	for (const propName of newPropEntries) {
		if ((oldProps ?? {})[propName] !== newProps[propName]) {
			propChanges[propName] = newProps[propName];
		}
	}

	// 예시는 아래처럼 생김
	//   const propChanges = {
	//   class: "btn red",     // btn blue -> btn red로 변경 됐음!
	//   title: "클릭하세요!",   // title 없었는데 새로 추가 됐음!
	//   disabled: null        // 이 속성은 이제 지워!
	// };

	return propChanges; // 딱 "바뀐 것들만" 모은 알짜배기 객체를 반환
}

/**
 * @description
 * 현재 위치의 old/new 노드 한 쌍만 비교한 뒤, 필요하면 같은 규칙을 자식 노드에게
 * 다시 적용하는 재귀 diff 함수입니다.
 *
 * @logic
 * 1. 노드가 없는 경우를 먼저 처리해 INSERT / REMOVE를 빠르게 결정합니다.
 * 2. 타입이나 태그가 다르면 더 깊이 내려가지 않고 REPLACE를 만듭니다.
 * 3. 둘 다 text node면 값만 비교해 TEXT patch를 만듭니다.
 * 4. 둘 다 같은 element면 props를 비교해 PROPS patch를 만듭니다.
 * 5. 마지막으로 자식 배열을 재귀적으로 비교해 하위 patch를 수집합니다.
 *
 * @performance
 * REPLACE가 필요한 순간 바로 종료하는 이유는, 어차피 부모 노드 자체를 갈아끼울 예정이면
 * 그 아래 자식들을 더 비교해도 실제 이득이 거의 없기 때문입니다. 이 early return이
 * 불필요한 재귀를 줄여 줍니다.
 *
 * @interview_tip
 * 재귀를 설명할 때는 "큰 트리를 한 번에 비교하지 않고, 현재 노드 한 쌍의 문제로 쪼갠 뒤
 * 같은 함수를 더 작은 자식 트리에 다시 적용한다"라고 말하면 이해시키기 쉽습니다.
 *
 * @param {VNode | undefined} oldNode
 * @param {VNode | undefined} newNode
 * @param {number[]} currentPath
 * @returns {Patch[]}
 */
function diffNode(oldNode, newNode, currentPath) {
	/**
	 * 1. INSERT
	 * old에는 없고 new에만 있다면 "새로 생긴 노드"입니다.
	 * path만 알면 어디에 넣을지 결정할 수 있고, payload에는 새 VNode만 담으면 됩니다.
	 */
	// 1. 과거엔 없었는데 지금은 있다? -> "새로 생겼네! (INSERT)"
	if (!oldNode && newNode) {
		return [
			{
				type: 'INSERT',
				path: currentPath,
				payload: newNode
			}
		];
	}

	/**
	 * 2. REMOVE
	 * old에는 있었는데 new에는 없다면 "삭제된 노드"입니다.
	 * 삭제는 대상을 path로 이미 찾을 수 있으므로 payload를 굳이 크게 담지 않아도 됩니다.
	 * 이것이 메모리 면에서도 가장 단순하고 효율적인 표현입니다.
	 */
	// 2. 과거엔 있었는데 지금은 없다? -> "삭제됐네! (REMOVE)"
	if (oldNode && !newNode) {
		return [
			{
				type: 'REMOVE',
				path: currentPath,
				payload: null
			}
		];
	}

	// 둘다 없으면 작업 할 일 없음
	if (!oldNode || !newNode) {
		return [];
	}

	/**
	 * 3. REPLACE
	 * 타입이 다르거나, element인데 태그가 다르면 부분 수정보다 통째 교체가 더 명확합니다.
	 * 예: <p> -> <div> 는 속성 몇 개 바꿔서 해결할 수 있는 문제가 아니라 "정체성"이
	 * 달라진 상황이므로, 자식까지 깊게 비교하는 것보다 교체가 효율적입니다.
	 */
	if (shouldReplaceNode(oldNode, newNode)) {
		return [
			{
				type: 'REPLACE',
				path: currentPath,
				payload: newNode
			}
		];
	}

	/**
	 * 4. TEXT
	 * 둘 다 text node라면 비교 포인트는 문자열 값 하나뿐입니다.
	 * 텍스트만 바뀐 경우 전체 노드를 교체하지 않고 텍스트 값만 갱신하면 되므로 더 저렴합니다.
	 */
	if (oldNode.type === 'text' && newNode.type === 'text') {
		if (oldNode.value !== newNode.value) {
			return [
				{
					type: 'TEXT',
					path: currentPath,
					payload: newNode.value ?? ''
				}
			];
		}

		return [];
	}

	const patches = [];
	const oldProps = oldNode.props ?? {};
	const newProps = newNode.props ?? {};
	// 5. 같은 태그(예: div -> div)라면, 속성(class, id 등)이 바뀌었는지 확인합니다.
	const propChanges = diffProps(oldProps, newProps);

	/**
	 * 5. PROPS
	 * 같은 태그라면 굳이 element 전체를 갈아끼울 필요가 없습니다.
	 * 바뀐 속성만 따로 뽑아 두면 실제 DOM 단계에서 필요한 attribute만 최소로 갱신할 수 있습니다.
	 */
	// 바뀐 속성이 하나라도 있다면?
	if (hasOwnKeys(propChanges)) {
		patches.push({
			type: 'PROPS',
			path: currentPath,
			payload: propChanges
		});
	}

	/**
	 * 재귀 핵심 설명:
	 * 지금까지는 "현재 부모 노드"만 비교했습니다.
	 * 부모가 같은 태그로 유지된다는 것이 확인되었으니, 이제 똑같은 규칙을 자식에게도
	 * 적용하면 됩니다. 이때 함수가 자기 자신을 다시 호출하는 것이 바로 재귀입니다.
	 *
	 * 즉,
	 * - 부모 1쌍 비교
	 * - 자식 1쌍 비교
	 * - 손자 1쌍 비교
	 * 를 다른 함수로 따로 만들지 않고, 같은 함수 `diffNode()`가 더 작은 트리에 대해
	 * 반복해서 자기 자신을 호출하는 구조입니다.
	 */
	// 자식들도 똑같은 5단계 체크리스트로 검사해!
	const childPatches = diffChildren(
		oldNode.children ?? [],
		newNode.children ?? [],
		currentPath
	);
	// 자식 쪽에서 나온 지시서들도 내 지시서 뭉치에 합쳐!
	patches.push(...childPatches);

	return patches;
}

/**
 * @description
 * 현재 노드가 부분 수정 가능한지, 아니면 통째 교체해야 하는지 판단합니다.
 *
 * @logic
 * 1. node type이 다르면 교체가 필요합니다.
 * 2. 둘 다 element인데 tagName이 다르면 교체가 필요합니다.
 * 3. 그 외에는 같은 뼈대를 공유하므로 부분 diff를 계속 진행합니다.
 *
 * @performance
 * 교체 여부를 먼저 판정하면, 불필요한 props 비교와 자식 재귀를 일찍 막을 수 있습니다.
 *
 * @interview_tip
 * "부분 수정과 전체 교체의 기준이 뭐예요?"라는 질문에는, 노드의 정체성이 유지되는지
 * 여부가 핵심이라고 답하면 됩니다. 타입/태그가 바뀌면 정체성이 달라진 것입니다.
 *
 * @param {VNode} oldNode
 * @param {VNode} newNode
 * @returns {boolean}
 */
function shouldReplaceNode(oldNode, newNode) {
	if (oldNode.type !== newNode.type) {
		return true;
	}

	if (oldNode.type === 'element' && newNode.type === 'element') {
		return oldNode.tagName !== newNode.tagName;
	}

	return false;
}

/**
 * @description
 * 같은 부모 아래에 있는 자식 배열을 순서대로 비교하며 하위 patch를 모읍니다.
 * 재귀가 실제로 "아래로 파고드는" 지점이 바로 여기입니다.
 *
 * @logic
 * 1. old/new 자식 배열의 더 긴 길이를 기준으로 순회합니다.
 * 2. 각 인덱스마다 `childPath = [...parentPath, index]`를 만들어 현재 위치를 기록합니다.
 * 3. 그 경로의 old/new 자식 한 쌍을 `diffNode()`에 다시 넘깁니다.
 * 4. 반환된 patch들을 모두 합쳐 부모 호출자에게 돌려줍니다.
 *
 * @performance
 * 자식 비교도 결국 각 노드를 한 번씩만 방문하는 구조라서, 학습용 구현에서는 충분히
 * 직관적이고 합리적입니다. path를 미리 만들어 두면 나중에 patch 단계가 목표 DOM을
 * 바로 찾을 수 있어 추가 탐색 비용도 줄어듭니다.
 *
 * @interview_tip
 * 재귀를 설명할 때 "부모가 같으면, 자식도 같은 검사표로 다시 검사한다"라고 말해 보세요.
 * 핵심은 큰 문제를 같은 모양의 작은 문제들로 쪼개는 것입니다.
 *
 * @param {VNode[]} oldChildren
 * @param {VNode[]} newChildren
 * @param {number[]} parentPath
 * @returns {Patch[]}
 */
function diffChildren(oldChildren, newChildren, parentPath) {
	const patches = [];
	// 둘 중 더 긴 쪽을 기준으로 반복
	const maxLength = Math.max(oldChildren.length, newChildren.length);

	for (let index = 0; index < maxLength; index += 1) {
		const childPath = [...parentPath, index]; // 네비게이션 주소 업데이트! (예: 부모 주소가 [0]이면 나는 [0, 0])
		// 자식 한 쌍을 꺼내서 다시 탐정(diffNode)에게 보냅니다! (함수가 자기 자신을 또 부름)
		const childPatches = diffNode(
			oldChildren[index],
			newChildren[index],
			childPath
		);

		patches.push(...childPatches);
	}

	return patches;
}

/**
 * @description
 * 객체 안에 실제 변경 키가 하나라도 있는지 확인하는 작은 헬퍼입니다.
 *
 * @logic
 * 1. 객체 자신의 key 목록을 가져옵니다.
 * 2. 길이가 0보다 크면 변경이 있다고 판단합니다.
 *
 * @performance
 * 매우 작은 O(k) 검사이지만, 이 덕분에 변경이 없을 때 불필요한 PROPS patch를
 * 만들지 않아 patch 배열이 더 작고 깔끔해집니다.
 *
 * @interview_tip
 * "왜 빈 patch를 만들지 않나요?"라는 질문에는, patch 목록은 실행 계획이므로
 * 실제 할 일이 없는 항목은 애초에 담지 않는 편이 더 명확하다고 설명하면 됩니다.
 *
 * @param {Record<string, string | null>} value
 * @returns {boolean}
 */
function hasOwnKeys(value) {
	return Object.keys(value).length > 0;
}

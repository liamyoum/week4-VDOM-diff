import { createVNodeFromHTML } from "./core/vdom.js";
import { diffTrees } from "./core/diff.js";
import { applyPatches, createRealNode } from "./core/patch.js";

/**
 * @typedef {import("./core/vdom.js").VNode} VNode
 */

/**
 * @typedef {import("./core/diff.js").Patch} Patch
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} html
 * @property {VNode} vnode
 * @property {string[]} patchSummary
 */

const initialMarkupTemplate = document.querySelector("#initial-markup");
const liveRoot = document.querySelector("#live-root");
const editInput = document.querySelector("#edit-input");
const patchButton = document.querySelector("#patch-btn");
const undoButton = document.querySelector("#undo-btn");
const redoButton = document.querySelector("#redo-btn");
const resetButton = document.querySelector("#reset-btn");
const patchLog = document.querySelector("#patch-log");
const historyList = document.querySelector("#history-list");
const statusBar = document.querySelector("#status-bar");

const initialHTML = initialMarkupTemplate?.innerHTML.trim() ?? "";

const appState = {
  currentVNode: /** @type {VNode | null} */ (null),
  history: /** @type {Snapshot[]} */ ([]),
  historyIndex: -1,
};

/**
 * @description
 * 앱 전체를 시작하는 초기화 함수입니다. 이 파일에서 "지휘자(Orchestrator)" 역할을
 * 가장 잘 보여 주는 시작점으로, 화면 준비와 상태 준비를 한 번에 수행합니다.
 *
 * @logic
 * 1. 필수 DOM 훅이 모두 존재하는지 확인합니다.
 * 2. 초기 HTML 문자열로 첫 번째 VDOM 스냅샷을 만듭니다.
 * 3. 그 스냅샷을 실제 Live View에 첫 렌더링합니다.
 * 4. Edit View, History, Patch Log, 버튼 상태를 초기 스냅샷 기준으로 동기화합니다.
 * 5. 마지막으로 버튼 이벤트를 연결합니다.
 *
 * @performance
 * 초기화 시점에는 patch 계산이 필요 없으므로, 초기 VNode를 바로 실제 DOM으로 렌더링하는 편이
 * 가장 단순합니다. 이후부터는 snapshot 비교를 통해 최소 변경만 적용합니다.
 *
 * @interview_tip
 * 상태 기반 UI에서 초기화는 단순히 "화면을 그린다"가 아니라, "초기 상태와 현재 UI를 일치시킨다"에
 * 가깝습니다. 이 관점을 알고 있으면 state-driven UI 설명이 훨씬 자연스러워집니다.
 */
function initializeApp() {
  assertRequiredElements();

  const initialSnapshot = createSnapshotFromHTML(initialHTML, [
    "초기 스냅샷입니다. 아직 비교 전이므로 변경 패치는 없습니다.",
  ]);

  restoreSnapshot(initialSnapshot);
  appState.currentVNode = initialSnapshot.vnode;
  appState.history = [initialSnapshot];
  appState.historyIndex = 0;

  renderPatchLog(initialSnapshot.patchSummary);
  renderHistory();
  updateControls();
  updateStatus(
    "초기 스냅샷을 저장했습니다. 이제 편집 영역 HTML을 바꾸고 '패치 적용'을 눌러 비교 흐름을 확인해 보세요."
  );

  bindInteractions();
}

/**
 * @description
 * 패치 적용, 되돌리기, 다시 실행, 초기화 버튼을 실제 앱 로직과 연결합니다.
 *
 * @logic
 * 1. Patch 버튼은 snapshot flow 전체를 실행합니다.
 * 2. Undo 버튼은 history index를 하나 뒤로 이동합니다.
 * 3. Redo 버튼은 history index를 하나 앞으로 이동합니다.
 * 4. Reset 버튼은 초기 스냅샷 하나만 남기고 앱 상태를 되돌립니다.
 *
 * @performance
 * 이벤트 핸들러는 실제로 버튼을 눌렀을 때만 동작합니다. 무거운 작업인 diff와 patch는
 * 필요할 때만 실행되므로, 유휴 상태에서는 비용이 거의 없습니다.
 *
 * @interview_tip
 * 이벤트 핸들러를 상태 변경 함수와 분리해 두면, "입력 이벤트"와 "상태 전이"를 따로
 * 설명할 수 있어서 면접에서 설계 의도를 말하기 쉬워집니다.
 */
function bindInteractions() {
  patchButton?.addEventListener("click", handlePatch);
  undoButton?.addEventListener("click", handleUndo);
  redoButton?.addEventListener("click", handleRedo);
  resetButton?.addEventListener("click", handleReset);
}

/**
 * @description
 * 사용자가 Patch 버튼을 눌렀을 때 실행되는 "스냅샷 방식"의 핵심 흐름입니다.
 * 이 함수 하나 안에 우리가 배우는 Snapshot Flow가 순서대로 들어 있습니다.
 *
 * @logic
 * 1. Edit View textarea에서 최신 HTML 문자열을 읽습니다.
 * 2. 그 문자열로 "새 스냅샷(newVNode)"을 만듭니다.
 * 3. 기존 스냅샷(oldVNode)과 새 스냅샷을 비교해 patches를 만듭니다.
 * 4. patches를 실제 DOM에 적용해 Live View를 갱신합니다.
 * 5. 성공하면 새 상태를 history에 저장하고, 패치 로그와 상태 바도 갱신합니다.
 *
 * @performance
 * 이 방식의 장점은 브라우저 DOM을 바로 뒤집지 않고, 메모리 안에서 먼저 비교한 뒤
 * 정말 필요한 조작만 실행한다는 점입니다. 즉, "비싼 공사" 전에 "싼 설계도 비교"를 합니다.
 *
 * @interview_tip
 * 면접에서는 이 흐름을 "입력 -> 새 스냅샷 생성 -> diff -> patch -> 상태 커밋"으로
 * 말해 보세요. React의 렌더-커밋 모델을 설명할 때도 비슷한 구조가 나옵니다.
 */
function handlePatch() {
  if (!editInput) {
    return;
  }

  try {
    /**
     * Snapshot Flow 1단계: 사용자의 최신 입력을 읽습니다.
     * textarea는 아직 "실제 화면"이 아니라, 다음 상태 후보를 적어 두는 작업 공간입니다.
     */
    const nextHTML = editInput.value;

    /**
     * Snapshot Flow 2단계: 새 HTML을 새 VDOM 스냅샷으로 변환합니다.
     * 여기서 실제 DOM을 직접 건드리지 않는 것이 핵심입니다.
     */
    const nextVNode = createVNodeFromHTML(nextHTML);

    if (!appState.currentVNode) {
      throw new Error("현재 VDOM 상태가 비어 있습니다. 초기화부터 다시 확인해 주세요.");
    }

    /**
     * Snapshot Flow 3단계: 과거 스냅샷(oldVNode)과 새 스냅샷(newVNode)을 비교합니다.
     * 결과물은 "무엇을 바꿔야 하는지"만 적힌 patches 배열입니다.
     */
    const patches = diffTrees(appState.currentVNode, nextVNode);

    if (patches.length === 0) {
      renderPatchLog(["변경 사항이 없습니다. 현재 스냅샷과 새 스냅샷이 동일합니다."]);
      updateStatus("변경된 내용이 없어 실제 영역은 그대로 유지되었습니다.");
      return;
    }

    /**
     * Snapshot Flow 4단계: diff 결과를 실제 DOM에 커밋합니다.
     * 이 시점이 되어서야 브라우저의 진짜 DOM이 수정됩니다.
     */
    applyPatches(liveRoot, patches);

    /**
     * Snapshot Flow 5단계: 성공한 새 상태를 history에 저장합니다.
     * 여기서의 핵심이 상태 관리(State Management)입니다.
     * 현재 상태를 저장해 두어야 undo/redo 같은 시간 여행 기능이 가능해집니다.
     */
    const patchSummary = summarizePatches(patches);
    const nextSnapshot = {
      html: nextHTML,
      vnode: nextVNode,
      patchSummary,
    };

    commitSnapshot(nextSnapshot);
    renderPatchLog(patchSummary);
    renderHistory();
    updateControls();
    updateStatus(
      `패치 적용 완료: ${patches.length}개의 변경 사항을 실제 영역에 반영하고 새 스냅샷을 저장했습니다.`
    );
  } catch (error) {
    handleFailure(error, "패치 적용에 실패했습니다.");
  }
}

/**
 * @description
 * history를 한 단계 뒤로 이동해 과거 스냅샷으로 복구합니다.
 *
 * @logic
 * 1. 현재 history index가 0인지 확인합니다.
 * 2. 가능하면 index를 하나 감소시킵니다.
 * 3. 해당 스냅샷으로 Live View와 Edit View를 동시에 복구합니다.
 *
 * @performance
 * undo는 patch를 다시 계산하지 않고 이미 저장된 스냅샷을 복원합니다.
 * 계산보다 복원 비용이 예측 가능하므로 시간 여행 기능이 안정적입니다.
 *
 * @interview_tip
 * 상태 관리가 중요한 이유를 묻는다면, "이전 상태를 기억해야 복구도 가능하고 디버깅도 쉬워진다"라고
 * 답하면 됩니다. 상태 기록이 없으면 undo/redo는 사실상 구현할 수 없습니다.
 */
function handleUndo() {
  if (appState.historyIndex <= 0) {
    updateStatus("더 이전 스냅샷은 없습니다.");
    return;
  }

  appState.historyIndex -= 1;
  const snapshot = appState.history[appState.historyIndex];

  restoreSnapshot(snapshot);
  renderPatchLog([
    `히스토리 되돌리기: ${appState.historyIndex + 1}번째 스냅샷으로 복구했습니다.`,
    ...snapshot.patchSummary,
  ]);
  renderHistory();
  updateControls();
  updateStatus("이전 스냅샷으로 되돌렸습니다. 실제 영역과 편집 영역이 함께 복구되었습니다.");
}

/**
 * @description
 * history를 한 단계 앞으로 이동해 나중 스냅샷으로 다시 복구합니다.
 *
 * @logic
 * 1. 현재 history index가 마지막인지 확인합니다.
 * 2. 가능하면 index를 하나 증가시킵니다.
 * 3. 해당 스냅샷으로 Live View와 Edit View를 동시에 복구합니다.
 *
 * @performance
 * redo도 이미 저장된 스냅샷을 재사용하므로, 매번 새로 diff를 계산할 필요가 없습니다.
 *
 * @interview_tip
 * undo/redo를 구현할 때 중요한 건 "현재 index"와 "스냅샷 배열"을 분리해 관리하는 것입니다.
 * 그래야 시간 축 위에서 앞뒤 이동을 쉽게 설명할 수 있습니다.
 */
function handleRedo() {
  if (appState.historyIndex >= appState.history.length - 1) {
    updateStatus("더 이후 스냅샷은 없습니다.");
    return;
  }

  appState.historyIndex += 1;
  const snapshot = appState.history[appState.historyIndex];

  restoreSnapshot(snapshot);
  renderPatchLog([
    `히스토리 다시 실행: ${appState.historyIndex + 1}번째 스냅샷으로 이동했습니다.`,
    ...snapshot.patchSummary,
  ]);
  renderHistory();
  updateControls();
  updateStatus("다음 스냅샷으로 이동했습니다. 실제 영역과 편집 영역이 함께 복구되었습니다.");
}

/**
 * @description
 * 앱을 초기 스냅샷 하나만 남긴 상태로 되돌립니다.
 *
 * @logic
 * 1. 초기 HTML로 새 초기 스냅샷을 다시 만듭니다.
 * 2. history를 초기 스냅샷 하나로 교체합니다.
 * 3. Live View, Edit View, Patch Log, 상태 바를 모두 초기 상태로 되돌립니다.
 *
 * @performance
 * reset은 복잡한 patch를 계산하지 않고, 초기 상태를 직접 복원하는 편이 더 단순합니다.
 *
 * @interview_tip
 * reset을 별도 처리하는 이유는, "과거 상태를 순차적으로 되감는 것"과 "기준 상태로 즉시 복귀하는 것"이
 * 제품 의도상 다른 동작이기 때문입니다.
 */
function handleReset() {
  try {
    const initialSnapshot = createSnapshotFromHTML(initialHTML, [
      "초기 상태로 재설정했습니다. 기준 스냅샷부터 다시 시작합니다.",
    ]);

    appState.history = [initialSnapshot];
    appState.historyIndex = 0;
    appState.currentVNode = initialSnapshot.vnode;

    restoreSnapshot(initialSnapshot);
    renderPatchLog(initialSnapshot.patchSummary);
    renderHistory();
    updateControls();
    updateStatus("앱을 초기 스냅샷으로 재설정했습니다.");
  } catch (error) {
    handleFailure(error, "초기화에 실패했습니다.");
  }
}

/**
 * @description
 * HTML 문자열 하나를 "저장 가능한 스냅샷 객체"로 변환합니다.
 *
 * @logic
 * 1. HTML 문자열을 VNode로 변환합니다.
 * 2. VNode, HTML, 패치 요약을 묶어 snapshot 객체로 만듭니다.
 *
 * @performance
 * 스냅샷을 한 덩어리 객체로 관리하면 history 저장과 복원이 단순해집니다.
 *
 * @param {string} html
 * @param {string[]} patchSummary
 * @returns {Snapshot}
 */
function createSnapshotFromHTML(html, patchSummary) {
  return {
    html,
    vnode: createVNodeFromHTML(html),
    patchSummary,
  };
}

/**
 * @description
 * 새 스냅샷을 현재 상태로 커밋하고, redo가 가능했던 미래 스냅샷은 잘라냅니다.
 *
 * @logic
 * 1. 현재 index 뒤에 남아 있는 history를 제거합니다.
 * 2. 새 스냅샷을 push합니다.
 * 3. history index를 마지막으로 이동합니다.
 * 4. currentVNode도 같은 스냅샷 기준으로 갱신합니다.
 *
 * @performance
 * undo 후 새 patch를 적용하면 기존 redo 경로는 더 이상 유효하지 않으므로 잘라내는 편이
 * 상태 일관성을 유지하는 가장 단순한 방법입니다.
 *
 * @interview_tip
 * 상태 관리 질문에서 자주 나오는 포인트입니다. "undo 후 새로운 변경이 생기면 redo branch는 폐기된다"는
 * 규칙을 말할 수 있으면 history 설계를 제대로 이해하고 있다는 신호가 됩니다.
 *
 * @param {Snapshot} snapshot
 * @returns {void}
 */
function commitSnapshot(snapshot) {
  const nextHistory = appState.history.slice(0, appState.historyIndex + 1);

  nextHistory.push(snapshot);

  appState.history = nextHistory;
  appState.historyIndex = nextHistory.length - 1;
  appState.currentVNode = snapshot.vnode;
}

/**
 * @description
 * 스냅샷 하나를 기준으로 실제 영역과 편집 영역을 동시에 복구합니다.
 *
 * @logic
 * 1. Edit View textarea에 snapshot의 HTML을 다시 넣습니다.
 * 2. Live View 컨테이너를 비웁니다.
 * 3. snapshot의 VNode를 실제 DOM으로 다시 만들어 붙입니다.
 * 4. currentVNode를 같은 스냅샷으로 갱신합니다.
 *
 * @performance
 * history 복원은 정확성이 우선이므로, 저장된 VNode에서 실제 DOM을 다시 만드는 편이 안전합니다.
 * undo/redo 중에 굳이 diff를 다시 계산할 필요가 없습니다.
 *
 * @interview_tip
 * 스냅샷 복원은 "현재 상태를 계산"하는 것이 아니라 "저장해 둔 상태를 재생"하는 개념입니다.
 * 이 차이를 설명할 수 있으면 상태 기반 UI 이해도가 높아 보입니다.
 *
 * @param {Snapshot} snapshot
 * @returns {void}
 */
function restoreSnapshot(snapshot) {
  if (!liveRoot || !editInput) {
    return;
  }

  editInput.value = snapshot.html;
  liveRoot.replaceChildren(createRealNode(snapshot.vnode));
  appState.currentVNode = snapshot.vnode;
}

/**
 * @description
 * patch 배열을 사람이 읽기 쉬운 로그 문자열 목록으로 바꿉니다.
 *
 * @logic
 * 1. patch를 하나씩 읽습니다.
 * 2. type에 맞는 설명 문장을 만듭니다.
 * 3. path와 payload 핵심 정보만 요약해 로그 배열로 반환합니다.
 *
 * @performance
 * 로그는 UI 설명용 문자열만 만드므로 비용이 매우 낮습니다.
 *
 * @param {Patch[]} patches
 * @returns {string[]}
 */
function summarizePatches(patches) {
  return patches.map((patch, index) => {
    const pathLabel = formatPath(patch.path);

    switch (patch.type) {
      case "REPLACE":
        return `${index + 1}. REPLACE ${pathLabel}: 노드 정체성이 바뀌어 새 요소로 교체합니다.`;
      case "PROPS":
        return `${index + 1}. PROPS ${pathLabel}: ${formatPropsPayload(
          /** @type {Record<string, string | null>} */ (patch.payload)
        )}`;
      case "TEXT":
        return `${index + 1}. TEXT ${pathLabel}: 텍스트를 "${String(patch.payload)}"(으)로 바꿉니다.`;
      case "INSERT":
        return `${index + 1}. INSERT ${pathLabel}: 새 자식 노드를 이 위치에 삽입합니다.`;
      case "REMOVE":
        return `${index + 1}. REMOVE ${pathLabel}: 기존 노드를 제거합니다.`;
      default:
        return `${index + 1}. 알 수 없는 패치`;
    }
  });
}

/**
 * @description
 * 패치 로그 패널을 현재 patch 요약으로 다시 그립니다.
 *
 * @param {string[]} items
 * @returns {void}
 */
function renderPatchLog(items) {
  if (!patchLog) {
    return;
  }

  patchLog.replaceChildren(
    ...items.map((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      return listItem;
    })
  );
}

/**
 * @description
 * history 스택 전체와 현재 커서를 시각적으로 다시 그립니다.
 * 현재 스냅샷에는 '(현재)' 표시를 붙여 시간 여행 위치를 쉽게 추적하게 합니다.
 *
 * @returns {void}
 */
function renderHistory() {
  if (!historyList) {
    return;
  }

  const items = appState.history.map((snapshot, index) => {
    const listItem = document.createElement("li");
    const isCurrent = index === appState.historyIndex;
    const patchCount = snapshot.patchSummary.length;
    const label = isCurrent ? " (현재)" : "";

    listItem.textContent = `${index + 1}번 스냅샷${label} - 요약 ${patchCount}개`;
    return listItem;
  });

  historyList.replaceChildren(...items);
}

/**
 * @description
 * undo/redo 버튼 활성화 상태를 현재 history index 기준으로 갱신합니다.
 *
 * @returns {void}
 */
function updateControls() {
  if (undoButton) {
    undoButton.disabled = appState.historyIndex <= 0;
  }

  if (redoButton) {
    redoButton.disabled = appState.historyIndex >= appState.history.length - 1;
  }
}

/**
 * @description
 * 상태 바에 현재 단계의 성공/실패/안내 메시지를 표시합니다.
 *
 * @param {string} message
 * @returns {void}
 */
function updateStatus(message) {
  if (statusBar) {
    statusBar.textContent = message;
  }
}

/**
 * @description
 * 필수 DOM 요소가 빠졌을 때 앱이 조용히 망가지지 않도록 초기에 검사합니다.
 *
 * @returns {void}
 */
function assertRequiredElements() {
  if (
    !initialMarkupTemplate ||
    !liveRoot ||
    !editInput ||
    !patchButton ||
    !undoButton ||
    !redoButton ||
    !resetButton ||
    !patchLog ||
    !historyList ||
    !statusBar
  ) {
    throw new Error("index.html의 필수 앱 요소를 찾지 못했습니다.");
  }

  if (!initialHTML) {
    throw new Error("초기 HTML 템플릿이 비어 있습니다.");
  }
}

/**
 * @description
 * 실패 상황을 공통 포맷으로 처리합니다.
 *
 * @param {unknown} error
 * @param {string} fallbackMessage
 * @returns {void}
 */
function handleFailure(error, fallbackMessage) {
  const message = error instanceof Error ? error.message : fallbackMessage;

  renderPatchLog([`실패: ${message}`]);
  updateStatus(message);
}

/**
 * @description
 * path 배열을 로그용 문자열로 바꿉니다.
 *
 * @param {number[]} path
 * @returns {string}
 */
function formatPath(path) {
  return path.length === 0 ? "root([])" : `[${path.join(", ")}]`;
}

/**
 * @description
 * PROPS patch payload를 사람이 읽기 쉬운 짧은 문장으로 요약합니다.
 *
 * @param {Record<string, string | null>} payload
 * @returns {string}
 */
function formatPropsPayload(payload) {
  const parts = Object.entries(payload).map(([key, value]) => {
    if (value === null) {
      return `${key} 삭제`;
    }

    return `${key}="${value}"`;
  });

  return parts.join(", ");
}

initializeApp();

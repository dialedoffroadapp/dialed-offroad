// Test stub for react-native. Two consumers:
// - pure lib tests, which only touch Platform
// - component tests (react-test-renderer, node env), which render the small
//   set of primitives below as host elements (string types) — no native code.
//
// AppState exposes __emit/__listenerCount test hooks so suites can drive
// background→active transitions; Animated's timing/parallel complete
// synchronously so animation callbacks (e.g. animateOut → setCard(null)) run
// deterministically inside act().

const appStateListeners = new Set();

const AppState = {
  currentState: "active",
  addEventListener: (type, handler) => {
    const entry = { type, handler };
    appStateListeners.add(entry);
    return { remove: () => appStateListeners.delete(entry) };
  },
  // test hooks
  __emit: (state) => {
    for (const e of appStateListeners) {
      if (e.type === "change") e.handler(state);
    }
  },
  __listenerCount: () => appStateListeners.size,
};

class AnimatedValue {
  constructor(v) {
    this._value = v;
  }
  setValue(v) {
    this._value = v;
  }
  interpolate() {
    return this;
  }
}

const finishNow = () => ({
  start: (cb) => {
    if (cb) cb({ finished: true });
  },
});

const Animated = {
  Value: AnimatedValue,
  timing: finishNow,
  parallel: finishNow,
  View: "Animated.View",
};

const Easing = {
  in: (f) => f,
  out: (f) => f,
  quad: () => 0,
  linear: () => 0,
};

module.exports = {
  Platform: { OS: "ios", select: (obj) => obj.ios },
  AppState,
  Animated,
  Easing,
  StyleSheet: { create: (s) => s, flatten: (s) => s },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
};
